#!/usr/bin/env python3
"""What this machine's Claude Code sessions would have cost at list price.

Reads the transcripts the CLI already writes under ~/.claude/projects and prints
aggregates. It opens no socket: the token counts are in the transcripts and the
prices are in the table below, so the report is the same on a plane as on a LAN.

The output names sessions and project directories. That is deliberate — it is
what makes a spike attributable — and it is also why this is a local tool: see
the skill for where its output may and may not go.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, NamedTuple

# --- prices -----------------------------------------------------------------
# Per-million-token list prices in USD, one row per model id, each carrying the
# date it was last verified. When a row's date is older than the release it
# claims to price, that row is the one to suspect.
#
# Only `input` and `output` are published per model. The cache columns are the
# published multipliers applied to `input`, spelled out rather than computed, so
# that a model breaking the pattern is a row and not a branch in the code:
#
#   cache read   0.10x input      (Fable 5.1 reads at 0.025x and Opus/Sonnet 5.5 at
#                                  0.05x, hence their own rows)
#   cache write  1.25x input on the 5-minute TTL, 2.00x on the 1-hour TTL
#
# Rows dated 2026-09-15 were verified against the claude-api skill's model
# table, the 5.5 rows on 2026-11-10 against
# https://platform.claude.com/docs/en/about-claude/pricing (Anthropic
# first-party API rates). Bedrock and Vertex are partner-priced and are NOT
# covered here; a transcript produced against those endpoints is priced wrong.


class Price(NamedTuple):
    """Per-million-token USD prices for one model id."""

    inp: float
    cache_read: float
    cache_write_5m: float
    cache_write_1h: float
    out: float
    verified: str


PRICES: dict[str, Price] = {
    #                      input  cache_rd  write5m  write1h  output   verified
    "claude-fable-5-1":  Price(10.00,  0.25,   12.50,   20.00,  50.00, "2026-09-15"),
    "claude-fable-5":    Price(10.00,  1.00,   12.50,   20.00,  50.00, "2026-09-15"),
    "claude-opus-5":     Price( 5.00,  0.50,    6.25,   10.00,  25.00, "2026-09-15"),
    "claude-opus-4-8":   Price( 5.00,  0.50,    6.25,   10.00,  25.00, "2026-09-15"),
    "claude-opus-4-7":   Price( 5.00,  0.50,    6.25,   10.00,  25.00, "2026-09-15"),
    "claude-opus-4-6":   Price( 5.00,  0.50,    6.25,   10.00,  25.00, "2026-09-15"),
    "claude-sonnet-5":   Price( 2.00,  0.20,    2.50,    4.00,  10.00, "2026-09-15"),
    "claude-sonnet-4-6": Price( 3.00,  0.30,    3.75,    6.00,  15.00, "2026-09-15"),
    "claude-haiku-4-5":  Price( 1.00,  0.10,    1.25,    2.00,   5.00, "2026-09-15"),
    "claude-opus-5-5":   Price( 4.00,  0.20,    5.00,    8.00,  20.00, "2026-11-10"),
    "claude-sonnet-5-5": Price( 2.00,  0.10,    2.50,    4.00,  10.00, "2026-11-10"),
    "claude-haiku-5-5":  Price( 0.10,  0.01,    0.125,   0.20,   0.50, "2026-11-10"),
}

# A model whose whole request is billed at a higher rate once its prompt
# (input + cache reads + cache writes, i.e. Event.context) exceeds a threshold.
# The tier replaces the base row for that request; it is not a marginal rate.
LONG_PROMPT_TIERS: dict[str, tuple[int, Price]] = {
    "claude-haiku-5-5": (100_000, Price(0.50, 0.05, 0.625, 1.00, 2.50, "2026-11-10")),
}

# Bands for the main-thread context histogram, in tokens.
# Claude Code writes an assistant record for things it produced itself — an
# interrupt notice, a local error. They carry no real usage and were never sent
# to the API, so pricing them as an unknown model raises a false alarm.
SYNTHETIC_MODELS = {"<synthetic>"}

BAND_SMALL = 150_000
BAND_LARGE = 400_000

# A main-thread request that rewrites more than this share of its context after
# a gap this long is reloading an expired cache, not doing new work.
REPRIME_IDLE_SECONDS = 3600
REPRIME_WRITE_SHARE = 0.5

# Fixed grid, aligned to the epoch rather than to each session's first request:
# two sessions running at the same time must land in the same bucket, which a
# per-session sliding window cannot guarantee.
WINDOW_SECONDS = 5 * 3600


def normalise_model(model: str | None) -> str:
    """Reduce a transcript's model string to a key in PRICES.

    Transcripts carry context-window markers (`claude-opus-5[1m]`) and dated
    snapshots (`claude-haiku-4-5-20251001`); both bill as the base model.
    """
    if not model:
        return "unknown"
    name = model.split("[", 1)[0].strip()
    if name in PRICES:
        return name
    head, _, tail = name.rpartition("-")
    if head and len(tail) == 8 and tail.isdigit() and head in PRICES:
        return head
    return name


class Event(NamedTuple):
    """One billable assistant response, as read from a transcript."""

    msg_id: str
    when: datetime
    project: str
    session: str
    agent: str | None  # None for the main thread
    model: str
    effort: str
    inp: int
    cache_read: int
    write_5m: int
    write_1h: int
    out: int
    run: str | None = None  # transcript key of the subagent run, None on the main thread

    @property
    def context(self) -> int:
        """Everything the model had to be given to answer, cached or not."""
        return self.inp + self.cache_read + self.write_5m + self.write_1h

    @property
    def cache_write(self) -> int:
        return self.write_5m + self.write_1h


class Cost(NamedTuple):
    inp: float
    cache_read: float
    cache_write: float
    out: float

    @property
    def total(self) -> float:
        return self.inp + self.cache_read + self.cache_write + self.out


ZERO = Cost(0.0, 0.0, 0.0, 0.0)


def add(a: Cost, b: Cost) -> Cost:
    return Cost(a.inp + b.inp, a.cache_read + b.cache_read,
                a.cache_write + b.cache_write, a.out + b.out)


def price_of(event: Event) -> Cost:
    """Cost of one event, or four zeros when the model id is not in the table."""
    p = PRICES.get(event.model)
    if p is None:
        return ZERO
    tier = LONG_PROMPT_TIERS.get(event.model)
    if tier is not None and event.context > tier[0]:
        p = tier[1]
    return Cost(
        event.inp * p.inp / 1e6,
        event.cache_read * p.cache_read / 1e6,
        (event.write_5m * p.cache_write_5m + event.write_1h * p.cache_write_1h) / 1e6,
        event.out * p.out / 1e6,
    )


# --- reading ----------------------------------------------------------------


def iter_json_lines(path: Path) -> Iterator[dict]:
    """Yield the parseable objects of a JSONL file, one line at a time.

    Transcripts are appended to while the session runs, so the last line is
    routinely half-written; and a 10 MB transcript has no business being held in
    memory. Both are handled by reading line by line and dropping what does not
    parse rather than raising.
    """
    try:
        handle = path.open("r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if isinstance(obj, dict):
                yield obj


def parse_time(raw: object) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return when.astimezone(timezone.utc) if when.tzinfo else when.replace(tzinfo=timezone.utc)


def agent_type_of(record: dict, transcript: Path) -> str:
    """Name the subagent that produced a record.

    The record's own `attributionAgent` is authoritative when present; older
    ones only have the sibling `<agent>.meta.json`, which carries `agentType`.
    """
    named = record.get("attributionAgent")
    if isinstance(named, str) and named:
        return named
    meta = transcript.with_suffix(".meta.json")
    if meta.exists():
        for obj in iter_json_lines(meta):
            kind = obj.get("agentType") or obj.get("name")
            if isinstance(kind, str) and kind:
                return kind
        try:
            obj = json.loads(meta.read_text(encoding="utf-8", errors="replace"))
            kind = obj.get("agentType") or obj.get("name")
            if isinstance(kind, str) and kind:
                return kind
        except (OSError, ValueError, AttributeError):
            pass
    return "unknown-agent"


def transcripts(projects: Path) -> Iterator[tuple[Path, str, str, bool]]:
    """Yield (file, project dir name, session id, is_subagent).

    Layout, verified against a real tree: `<project>/<session>.jsonl` is the
    main thread and `<project>/<session>/subagents/**/*.jsonl` are its agents,
    nested one further level when a workflow spawned them.
    """
    if not projects.is_dir():
        return
    for project_dir in sorted(p for p in projects.iterdir() if p.is_dir()):
        for path in sorted(project_dir.glob("*.jsonl")):
            yield path, project_dir.name, path.stem, False
        for session_dir in sorted(p for p in project_dir.iterdir() if p.is_dir()):
            sub = session_dir / "subagents"
            if sub.is_dir():
                for path in sorted(sub.rglob("*.jsonl")):
                    yield path, project_dir.name, session_dir.name, True


def read_meta(transcript: Path) -> dict:
    """The sibling `<agent>.meta.json` of a subagent transcript, or {}."""
    meta = transcript.with_suffix(".meta.json")
    try:
        obj = json.loads(meta.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return {}
    return obj if isinstance(obj, dict) else {}


def clean(value: object) -> str | None:
    """A non-empty string field, else None. Never anything else."""
    return value.strip() if isinstance(value, str) and value.strip() else None


def workflow_run_id(path: Path, projects: Path) -> str | None:
    """The run id of a workflow transcript: the path segment after `workflows`."""
    parts = path.relative_to(projects).parts
    if "workflows" in parts:
        index = parts.index("workflows")
        if index + 1 < len(parts) - 1:
            return parts[index + 1]
    return None


DISPATCH_TOOLS = {"Agent", "Task"}


def collect(projects: Path, since: datetime | None, until: datetime | None,
            fragment: str | None) -> tuple[list[Event], dict, dict]:
    """Read every transcript once; return events, stats and the dispatch trace.

    The trace holds what the cost events cannot say: which Agent calls were made
    and with which fields, and when each subagent run started and ended.
    Message content is read only to find `tool_use` blocks; none of it is kept.
    """
    seen: set[str] = set()
    events: list[Event] = []
    runs: dict[str, dict] = {}
    dispatches: dict[str, dict] = {}
    stats = {"files": 0, "records": 0, "duplicates": 0, "undated": 0,
             "filtered": 0, "synthetic": 0}

    for path, project, session, is_sub in transcripts(projects):
        if fragment and fragment not in project:
            continue
        stats["files"] += 1
        agent = agent_type_of({}, path) if is_sub else None
        run_key = str(path.relative_to(projects)) if is_sub else None
        if is_sub:
            meta = read_meta(path)
            phase = clean(meta.get("workflowPhase"))
            run_id = workflow_run_id(path, projects)
            runs[run_key] = {
                "session": session, "agent": agent,
                "description": clean(meta.get("description")),
                "tool_use_id": clean(meta.get("toolUseId")),
                "model": clean(meta.get("model")), "effort": clean(meta.get("effort")),
                "phase": phase, "run_id": run_id,
                "workflow": run_id is not None or phase is not None,
                "first": None, "last": None,
            }
        for record in iter_json_lines(path):
            stamp = parse_time(record.get("timestamp"))
            if is_sub and stamp is not None:
                run = runs[run_key]
                run["first"] = stamp if run["first"] is None else min(run["first"], stamp)
                run["last"] = stamp if run["last"] is None else max(run["last"], stamp)
            if record.get("type") != "assistant":
                continue
            message = record.get("message")
            if not isinstance(message, dict):
                continue
            content = message.get("content")
            if isinstance(content, list) and stamp is not None \
                    and not ((since and stamp < since) or (until and stamp >= until)):
                for block in content:
                    if not (isinstance(block, dict) and block.get("type") == "tool_use"
                            and block.get("name") in DISPATCH_TOOLS):
                        continue
                    call_id = block.get("id")
                    fields = block.get("input")
                    if not isinstance(call_id, str) or not isinstance(fields, dict) \
                            or call_id in dispatches:
                        continue
                    kind = clean(fields.get("subagent_type"))
                    dispatches[call_id] = {
                        "when": stamp, "caller": agent, "type": kind or "general-purpose",
                        "model": clean(fields.get("model")),
                        "effort": clean(fields.get("effort")),
                        "fork": kind == "fork" or fields.get("fork") is True,
                    }
            usage = message.get("usage")
            if not isinstance(usage, dict):
                continue
            msg_id = message.get("id")
            if not isinstance(msg_id, str) or not msg_id:
                continue
            stats["records"] += 1
            if normalise_model(message.get("model")) in SYNTHETIC_MODELS:
                stats["synthetic"] += 1
                continue
            # The same assistant message is re-appended as the response streams
            # and again when a session is resumed. Identical usage every time —
            # so first wins, and counting them all would inflate every figure.
            if msg_id in seen:
                stats["duplicates"] += 1
                continue
            seen.add(msg_id)

            when = parse_time(record.get("timestamp"))
            if when is None:
                stats["undated"] += 1
                continue
            if (since and when < since) or (until and when >= until):
                stats["filtered"] += 1
                continue

            # A 1-hour cache write costs 2x input and a 5-minute one 1.25x, so
            # the split matters. `cache_creation` carries it; when that field is
            # absent or disagrees with the scalar total, the scalar is the one
            # that was billed, and the cheaper TTL is the conservative guess.
            total_write = int(usage.get("cache_creation_input_tokens") or 0)
            creation = usage.get("cache_creation")
            write_5m, write_1h = total_write, 0
            if isinstance(creation, dict):
                five = int(creation.get("ephemeral_5m_input_tokens") or 0)
                hour = int(creation.get("ephemeral_1h_input_tokens") or 0)
                if five + hour == total_write:
                    write_5m, write_1h = five, hour

            events.append(Event(
                msg_id=msg_id,
                when=when,
                project=project,
                session=session,
                agent=(record.get("attributionAgent") or agent) if is_sub else None,
                model=normalise_model(message.get("model")),
                effort=str(record.get("effort") or record.get("perTurnEffort") or "n/a"),
                inp=int(usage.get("input_tokens") or 0),
                cache_read=int(usage.get("cache_read_input_tokens") or 0),
                write_5m=write_5m,
                write_1h=write_1h,
                out=int(usage.get("output_tokens") or 0),
                run=run_key,
            ))
    runs = {k: r for k, r in runs.items()
            if r["first"] is not None and not ((since and r["first"] < since)
                                               or (until and r["first"] >= until))}
    return events, stats, {"runs": runs, "dispatches": dispatches}


# --- aggregation ------------------------------------------------------------


def iso_week(when: datetime) -> str:
    year, week, _ = when.isocalendar()
    return f"{year}-W{week:02d}"


def find_reprimes(events: list[Event]) -> set[str]:
    """Main-thread requests that paid to reload a cache that had expired.

    A long silence, then a request that rewrites most of its own context: the
    session resumed, the cache was gone, and the whole prefix was billed as a
    write instead of a read.
    """
    by_session: dict[str, list[Event]] = defaultdict(list)
    for event in events:
        if event.agent is None:
            by_session[event.session].append(event)

    flagged: set[str] = set()
    for session_events in by_session.values():
        session_events.sort(key=lambda e: e.when)
        previous: datetime | None = None
        for event in session_events:
            idle = (event.when - previous).total_seconds() if previous else None
            previous = event.when
            if idle is None or idle <= REPRIME_IDLE_SECONDS:
                continue
            if event.context and event.cache_write > REPRIME_WRITE_SHARE * event.context:
                flagged.add(event.msg_id)
    return flagged


def analyse_dispatches(trace: dict) -> dict:
    """How each Agent call fixed its model and effort.

    Per field, one of three states: explicit on the call, explicit in the
    definition (the subagent's `.meta.json`, joined by tool_use id), or
    unresolved — the run inherited it and the transcripts cannot say from where.
    Forks are counted apart: they continue the orchestrator, they are no worker.
    """
    by_call = {r["tool_use_id"]: r for r in trace["runs"].values() if r["tool_use_id"]}
    out = {"total": 0, "forks": 0, "by_week": {}, "by_type": {}}

    def blank() -> dict:
        return {"dispatches": 0,
                "model": {"call": 0, "definition": 0, "unresolved": 0},
                "effort": {"call": 0, "definition": 0, "unresolved": 0}}

    for call_id, d in trace["dispatches"].items():
        if d["fork"]:
            out["forks"] += 1
            continue
        out["total"] += 1
        run = by_call.get(call_id)
        slots = (out["by_week"].setdefault(iso_week(d["when"]), blank()),
                 out["by_type"].setdefault(d["type"], blank()))
        for slot in slots:
            slot["dispatches"] += 1
        for field in ("model", "effort"):
            if d[field]:
                state = "call"
            elif run and run[field]:
                state = "definition"
            else:
                state = "unresolved"
            for slot in slots:
                slot[field][state] += 1
    return out


def analyse_workflows(events: list[Event], trace: dict) -> list[dict]:
    """One row per workflow run: cost, and the (model, effort) mix by phase."""
    rows: dict[str, dict] = {}
    for key, run in trace["runs"].items():
        if not run["workflow"]:
            continue
        rows.setdefault(run["run_id"] or "(no run id)", {
            "run_id": run["run_id"] or "(no run id)", "session": run["session"],
            "agents": 0, "cost": ZERO, "requests": 0, "phases": {}})["agents"] += 1
    for event in events:
        run = trace["runs"].get(event.run) if event.run else None
        if run is None or not run["workflow"]:
            continue
        row = rows[run["run_id"] or "(no run id)"]
        cost = price_of(event)
        row["cost"] = add(row["cost"], cost)
        row["requests"] += 1
        slot = row["phases"].setdefault(run["phase"] or "(no phase)", {}) \
                            .setdefault((event.model, event.effort),
                                        {"cost": ZERO, "requests": 0})
        slot["cost"] = add(slot["cost"], cost)
        slot["requests"] += 1
    return sorted(rows.values(), key=lambda r: r["cost"].total, reverse=True)


def find_repeats(trace: dict) -> dict:
    """Subagent runs that repeat an earlier same-type run, one after the other.

    A candidate starts after a run of the same agent type has finished and has
    the same description, to the character. A parallel group shares a start
    window, so none of its members starts after another has finished. This is a
    prompt for a look at the sessions, not a rate of corrections: a repeated
    description is also what a deliberate second pass looks like.
    """
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for run in trace["runs"].values():
        if run["description"]:
            groups[(run["session"], run["agent"])].append(run)
    by_agent: dict[str, int] = defaultdict(int)
    total = 0
    for (_, agent), members in groups.items():
        members.sort(key=lambda r: r["first"])
        for index, run in enumerate(members):
            if any(prev["description"] == run["description"] and prev["last"] <= run["first"]
                   for prev in members[:index]):
                by_agent[agent] += 1
                total += 1
    return {"candidates": total, "by_agent": dict(sorted(by_agent.items()))}


def build_report(events: list[Event], stats: dict, trace: dict | None = None) -> dict:
    trace = trace or {"runs": {}, "dispatches": {}}
    reprimes = find_reprimes(events)
    unknown: dict[str, dict] = defaultdict(lambda: {"requests": 0, "tokens": 0})
    weeks: dict[str, dict] = {}
    windows: dict[int, dict] = defaultdict(
        lambda: {"cost": ZERO, "sessions": set(), "requests": 0})

    def blank_week() -> dict:
        return {
            "cost": ZERO,
            "requests": 0,
            "tokens": {"input": 0, "cache_read": 0, "cache_write": 0, "output": 0},
            "main": {"cost": ZERO, "requests": 0},
            "agents": defaultdict(lambda: {"cost": ZERO, "requests": 0}),
            "pairs": defaultdict(lambda: {"cost": ZERO, "requests": 0}),
            "subagent_pairs": defaultdict(lambda: {"cost": ZERO, "requests": 0}),
            "agent_models": defaultdict(lambda: {"cost": ZERO, "requests": 0}),
            "bands": {k: {"cost": ZERO, "requests": 0}
                      for k in ("<150k", "150k-400k", ">400k")},
            "reprimes": {"cost": ZERO, "requests": 0, "where": []},
            "sessions": set(),
        }

    for event in events:
        cost = price_of(event)
        if event.model not in PRICES:
            slot = unknown[event.model]
            slot["requests"] += 1
            slot["tokens"] += event.context + event.out

        week = weeks.setdefault(iso_week(event.when), blank_week())
        week["cost"] = add(week["cost"], cost)
        week["requests"] += 1
        week["sessions"].add(event.session)
        week["tokens"]["input"] += event.inp
        week["tokens"]["cache_read"] += event.cache_read
        week["tokens"]["cache_write"] += event.cache_write
        week["tokens"]["output"] += event.out

        pair = week["pairs"][(event.model, event.effort)]
        pair["cost"] = add(pair["cost"], cost)
        pair["requests"] += 1

        if event.agent is None:
            week["main"]["cost"] = add(week["main"]["cost"], cost)
            week["main"]["requests"] += 1
            band = ("<150k" if event.context < BAND_SMALL
                    else "150k-400k" if event.context <= BAND_LARGE else ">400k")
            week["bands"][band]["cost"] = add(week["bands"][band]["cost"], cost)
            week["bands"][band]["requests"] += 1
            if event.msg_id in reprimes:
                week["reprimes"]["cost"] = add(week["reprimes"]["cost"], cost)
                week["reprimes"]["requests"] += 1
                week["reprimes"]["where"].append(
                    {"session": event.session, "project": event.project,
                     "at": event.when.strftime("%Y-%m-%d %H:%M"),
                     "cache_write_tokens": event.cache_write,
                     "context_tokens": event.context,
                     "cost": round(price_of(event).total, 4)})
        else:
            agent = week["agents"][event.agent]
            agent["cost"] = add(agent["cost"], cost)
            agent["requests"] += 1
            for table, key in (("subagent_pairs", (event.model, event.effort)),
                               ("agent_models", (event.agent, event.model, event.effort))):
                slot = week[table][key]
                slot["cost"] = add(slot["cost"], cost)
                slot["requests"] += 1

        slot = windows[int(event.when.timestamp()) // WINDOW_SECONDS]
        slot["cost"] = add(slot["cost"], cost)
        slot["sessions"].add(event.session)
        slot["requests"] += 1

    top = sorted(windows.items(), key=lambda kv: kv[1]["cost"].total, reverse=True)[:10]
    return {
        "stats": stats,
        "dispatches": analyse_dispatches(trace),
        "workflows": analyse_workflows(events, trace),
        "repeats": find_repeats(trace),
        "weeks": weeks,
        "unknown_models": unknown,
        "windows": [
            {
                "start": datetime.fromtimestamp(index * WINDOW_SECONDS, timezone.utc)
                                 .strftime("%Y-%m-%d %H:%M"),
                "cost": slot["cost"],
                "requests": slot["requests"],
                "parallel_sessions": len(slot["sessions"]),
            }
            for index, slot in top
        ],
    }


# --- output -----------------------------------------------------------------


def money(value: float) -> str:
    return f"${value:,.2f}"


def tokens(value: int) -> str:
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"{value / 1_000:.0f}k"
    return str(value)


def print_text(report: dict, projects: Path, since: str | None, until: str | None) -> None:
    stats = report["stats"]
    span = f"{since or 'the beginning'} to {until or 'now'}"
    print(f"Claude Code usage — {span}")
    print(f"source: {projects}  (local read only, no network)")
    print(f"{stats['files']} transcripts · {stats['records']} assistant records · "
          f"{stats['duplicates']} duplicate ids dropped · {stats['filtered']} outside the range"
          f" · {stats['synthetic']} local (unbilled) records")

    if report["unknown_models"]:
        print()
        print("!! UNKNOWN MODEL IDS — their tokens are counted, their cost is $0.00")
        print("!! every total below is an UNDERSTATEMENT until these get a price row:")
        for model, slot in sorted(report["unknown_models"].items()):
            print(f"!!   {model}: {slot['requests']} requests, {tokens(slot['tokens'])} tokens")

    if not report["weeks"]:
        print("\nno priced requests in range")
        return

    for name in sorted(report["weeks"]):
        week = report["weeks"][name]
        cost = week["cost"]
        print()
        print(f"── {name} ── {money(cost.total)} over {week['requests']} requests, "
              f"{len(week['sessions'])} sessions")
        for label, value, token_count in (
            ("input", cost.inp, week["tokens"]["input"]),
            ("cache read", cost.cache_read, week["tokens"]["cache_read"]),
            ("cache write", cost.cache_write, week["tokens"]["cache_write"]),
            ("output", cost.out, week["tokens"]["output"]),
        ):
            share = 100 * value / cost.total if cost.total else 0.0
            print(f"   {label:<12} {money(value):>10}  {share:4.1f}%  {tokens(token_count):>7} tok")

        main = week["main"]
        print(f"   {'main thread':<12} {money(main['cost'].total):>10}"
              f"          {main['requests']:>4} requests")
        agents = sorted(week["agents"].items(),
                        key=lambda kv: kv[1]["cost"].total, reverse=True)
        agent_total = sum(slot["cost"].total for _, slot in agents)
        agent_requests = sum(slot["requests"] for _, slot in agents)
        print(f"   {'subagents':<12} {money(agent_total):>10}"
              f"          {agent_requests:>4} requests")
        for agent, slot in agents:
            print(f"     {agent:<30} {money(slot['cost'].total):>10}  "
                  f"{slot['requests']:>4} requests")

        pairs = sorted(week["pairs"].items(), key=lambda kv: kv[1]["cost"].total, reverse=True)
        print("   model / effort observed:")
        for (model, effort), slot in pairs:
            mark = "" if model in PRICES else "  (UNPRICED)"
            label = f"{model} / {effort}"
            print(f"     {label:<30} {money(slot['cost'].total):>10}  "
                  f"{slot['requests']:>4} requests{mark}")
        if len(pairs) > 1:
            print(f"   ! {len(pairs)} (model, effort) pairs in one week — drift, and drift is "
                  f"what makes a week cost more than the week before for no visible reason")

        print("   main-thread context size:")
        for band in ("<150k", "150k-400k", ">400k"):
            slot = week["bands"][band]
            print(f"     {band:<30} {money(slot['cost'].total):>10}  "
                  f"{slot['requests']:>4} requests")

        reprimes = week["reprimes"]
        if reprimes["requests"]:
            print(f"   re-primes: {reprimes['requests']} request(s), "
                  f"{money(reprimes['cost'].total)} — a session resumed after its cache "
                  f"expired and paid to reload the context")
            for where in reprimes["where"][:5]:
                print(f"     {where['at']}  {where['session'][:8]}  "
                      f"{tokens(where['cache_write_tokens'])} rewritten of "
                      f"{tokens(where['context_tokens'])}  {money(where['cost'])}")
            if len(reprimes["where"]) > 5:
                print(f"     … and {len(reprimes['where']) - 5} more")
        else:
            print("   re-primes: none")

    dispatch = report["dispatches"]
    if dispatch["total"] or dispatch["forks"]:
        print()
        print(f"── dispatches: {dispatch['total']} Agent calls, {dispatch['forks']} forks "
              f"(counted apart)")
        for week_name, slot in sorted(dispatch["by_week"].items()):
            states = " · ".join(
                f"{f} {slot[f]['call']} call / {slot[f]['definition']} definition / "
                f"{slot[f]['unresolved']} unresolved" for f in ("model", "effort"))
            print(f"   {week_name}  {slot['dispatches']:>4}  {states}")
    if report["workflows"]:
        print()
        print(f"── {len(report['workflows'])} workflow run(s)")
        for run in report["workflows"][:10]:
            print(f"   {run['run_id']:<20} {money(run['cost'].total):>10}  "
                  f"{run['requests']:>5} requests  {run['agents']} agents")
            for phase, mix in run["phases"].items():
                shown = ", ".join(f"{m}/{e} x{sl['requests']}" for (m, e), sl in mix.items())
                print(f"     {phase:<18} {shown}")
    repeats = report["repeats"]
    if repeats["candidates"]:
        print()
        print(f"── sequential repetition candidates: {repeats['candidates']} "
              f"(same agent type, same description, started after the previous one finished; "
              f"a prompt to look, not a correction rate)")
        for agent, count in repeats["by_agent"].items():
            print(f"   {agent:<30} {count:>4}")

    print()
    # "the ten most expensive" is a ceiling: a short range simply has fewer
    # windows, and claiming ten while printing four reads like a bug.
    print(f"── {len(report['windows'])} most expensive 5-hour windows "
          f"(UTC, grid aligned to the epoch)")
    for window in report["windows"]:
        print(f"   {window['start']}  {money(window['cost'].total):>10}  "
              f"{window['requests']:>4} requests  "
              f"{window['parallel_sessions']} session(s) in parallel")


def jsonable(report: dict) -> dict:
    def cost(value: Cost) -> dict:
        return {"input": round(value.inp, 6), "cache_read": round(value.cache_read, 6),
                "cache_write": round(value.cache_write, 6), "output": round(value.out, 6),
                "total": round(value.total, 6)}

    return {
        "stats": report["stats"],
        "unknown_models": {k: dict(v) for k, v in report["unknown_models"].items()},
        "dispatches": report["dispatches"],
        "workflows": [{
            "run_id": w["run_id"], "session": w["session"], "agents": w["agents"],
            "requests": w["requests"], "cost": cost(w["cost"]),
            "phases": {ph: [{"model": m, "effort": e, "cost": cost(sl["cost"]),
                             "requests": sl["requests"]}
                            for (m, e), sl in mix.items()]
                       for ph, mix in w["phases"].items()},
        } for w in report["workflows"]],
        "sequential_repeat_candidates": report["repeats"],
        "weeks": {
            name: {
                "cost": cost(week["cost"]),
                "requests": week["requests"],
                "sessions": sorted(week["sessions"]),
                "tokens": week["tokens"],
                "main": {"cost": cost(week["main"]["cost"]),
                         "requests": week["main"]["requests"]},
                "agents": {a: {"cost": cost(s["cost"]), "requests": s["requests"]}
                           for a, s in week["agents"].items()},
                "pairs": [{"model": m, "effort": e, "cost": cost(s["cost"]),
                           "requests": s["requests"]}
                          for (m, e), s in week["pairs"].items()],
                "subagent_pairs": [{"model": m, "effort": e, "cost": cost(s["cost"]),
                                    "requests": s["requests"]}
                                   for (m, e), s in week["subagent_pairs"].items()],
                "by_agent_model": [{"agent": a, "model": m, "effort": e,
                                    "cost": cost(s["cost"]), "requests": s["requests"]}
                                   for (a, m, e), s in week["agent_models"].items()],
                "bands": {b: {"cost": cost(s["cost"]), "requests": s["requests"]}
                          for b, s in week["bands"].items()},
                "reprimes": {"cost": cost(week["reprimes"]["cost"]),
                             "requests": week["reprimes"]["requests"],
                             "where": week["reprimes"]["where"]},
            }
            for name, week in sorted(report["weeks"].items())
        },
        "windows": [{"start": w["start"], "cost": cost(w["cost"]),
                     "requests": w["requests"],
                     "parallel_sessions": w["parallel_sessions"]}
                    for w in report["windows"]],
        "prices_verified": sorted({p.verified for p in PRICES.values()}),
    }


def parse_day(raw: str | None, end: bool = False) -> datetime | None:
    if not raw:
        return None
    try:
        day = datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        sys.exit(f"usage_report: not a YYYY-MM-DD date: {raw}")
    # --until names a day the user means to include, so the cut is its end.
    return day.replace(hour=23, minute=59, second=59) if end else day


def default_projects() -> Path:
    config = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(config).expanduser() / "projects" if config else Path.home() / ".claude" / "projects"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Local usage and cost report for Claude Code sessions. "
                    "Reads transcripts, makes no network call.")
    parser.add_argument("--since", metavar="YYYY-MM-DD")
    parser.add_argument("--until", metavar="YYYY-MM-DD")
    parser.add_argument("--project", metavar="FRAGMENT",
                        help="only project directories containing this fragment")
    parser.add_argument("--projects", metavar="DIR", default=None,
                        help="transcript root (default: ~/.claude/projects)")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    projects = Path(args.projects).expanduser() if args.projects else default_projects()
    events, stats, trace = collect(projects, parse_day(args.since), parse_day(args.until, end=True),
                            args.project)
    report = build_report(events, stats, trace)

    if args.json:
        json.dump(jsonable(report), sys.stdout, indent=2, sort_keys=False)
        sys.stdout.write("\n")
    else:
        print_text(report, projects, args.since, args.until)
    return 0


if __name__ == "__main__":
    sys.exit(main())
