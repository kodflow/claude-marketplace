#!/usr/bin/env python3
"""CodeRabbit review-limit probe and relauncher.

Single source of the CodeRabbit quota logic: kodflow-hooks' PreToolUse hint
(`capacity`, via hooks/scripts/lib/coderabbit.sh) and kodflow/labs' scheduled
relaunch workflow (`probe` and `relaunch`, which checks this file out at a
pinned commit) both run THIS file. Nothing else reads CodeRabbit's messages.

Four subcommands, standard library only (Python 3.9+), no third-party import:

  probe      list the open, non-draft pull requests whose last CodeRabbit action
             is a refusal (rate limit or pause) that no review has followed, and,
             with --policy-dir, the review-eligible ones whose head CodeRabbit
             positively did not review. Prints ONE JSON document on stdout;
             writes nothing, posts nothing.
  relaunch   post `@coderabbitai review` (marked `:cron`) on the candidates of a
             probe document (at most one pull request per owner), after
             re-checking each one.
  capacity   for ONE repository and the action about to run (`gh pr create`,
             `git push`): is CodeRabbit rate limited there, for how long, and
             what to do. Cached, bounded by a deadline, never raises: the answer
             is JSON on stdout, exit 0, `state` unknown on any failure.
  covered    for ONE pull request: the commit CodeRabbit last reviewed, whether
             CodeRabbit would review the pull request at all (`eligible`, read
             from the policy files as CodeRabbit resolves them), and whether the
             head is covered. Cached per head, bounded by a deadline, never
             raises: `unknown` wherever a fact could not be established.

The JSON contract of `probe` is the stable interface (it feeds a workflow now,
a Claude Code hook later). `schema_version` moves only on a breaking change;
fields may be added. See docs/runbooks/coderabbit-relaunch.md for the schema.

What counts as what (read from real comments, 2026-11-08):

  refusal      a comment of `coderabbitai[bot]` on the pull request whose body
               carries the marker `rate limited by coderabbit.ai` (an HTML
               comment), the heading `Review limit reached`, the reply `Review
               rate limited` (kind `rate_limited`), or the marker `review paused
               by coderabbit.ai` (kind `paused`: auto_pause_after_reviewed_commits
               reached, not a quota). The comment is edited in place, so its
               `updated_at` is when it was written.
                 free OSS plan  "Next included review available in N minutes."
                 paid plan      "...has disabled usage-based review continuation"
                                (no delay announced)
  real review  a pull request review of the bot whose body contains
               `Actionable comments posted` or `No actionable comments were
               generated` (or whose state is APPROVED / CHANGES_REQUESTED).
  covered      a real review on the head commit, or submitted after the refusal.
  relaunch     a comment of a NON-bot account that starts with `@coderabbitai
               review` or `@coderabbitai full review`. CodeRabbit ignores commands
               from bot accounts (github-actions[bot] included), so the comment
               must come from a person's token. Ours carry, AFTER the command (the
               command must open the comment), `<!-- kodflow-relaunch:cron
               head=<sha> -->` (this file's relaunch) or `:hook` (the /git watch
               loop); a command with no marker is `manual`. Only `:cron` holds the
               owner slot and counts toward abandoning; every origin counts toward
               the per-head cap and suppresses a new command while pending.
  last reviewed  read from CodeRabbit's summary comment, never from a review's
               `commit_id` (empty-body thread replies are stamped at the head,
               a zero-finding review leaves no review object): the JSON marker
               `final_review_risk_coverage` (`coveredCommitId`), else `Last
               reviewed commit: <sha>`, else the `between X and Y` range of the
               recent-review section (both layouts: `recent_review_start`, and
               the newer `coderabbit-ai-generated:v1` one), else the range of the
               latest review body carrying `coderabbit-review-publication`.

Authentication, per owner (a fine-grained token has ONE resource owner):
  GH_TOKEN_<OWNER> (upper case, every non-alphanumeric as `_`), then GH_TOKEN,
  then GITHUB_TOKEN, then `gh auth token` for a laptop. A token is never
  printed, logged or put on a command line.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple

SCHEMA_VERSION = 1
API = "https://api.github.com"
BOT_LOGIN = "coderabbitai[bot]"
COMMAND = "@coderabbitai review"

# The HTML marker is the stable signal; the headings vary ("Review limit reached",
# "Review paused — included plan limit reached").
REFUSAL_RE = re.compile(r"rate limited by coderabbit\.ai|Review limit reached|Review rate limited|Review paused|review paused by coderabbit\.ai", re.I)
# A pause (auto_pause_after_reviewed_commits) is not a quota: only its HTML
# marker says so, the heading "Review paused — included plan limit reached" is
# a rate limit. Rate-limit signals win when a body carries both.
RATE_LIMITED_RE = re.compile(r"rate limited by coderabbit\.ai|Review limit reached|Review rate limited|plan limit reached", re.I)
PAUSED_RE = re.compile(r"review paused by coderabbit\.ai", re.I)
USAGE_BASED_RE = re.compile(r"usage-based review continuation", re.I)
REAL_REVIEW_RE = re.compile(
    r"Actionable comments posted|No actionable comments were generated", re.I
)
COMMAND_RE = re.compile(r"^\s*@coderabbitai\s+(?:full\s+)?review\b", re.I)
# "Next included review available in 16 minutes." / "in: 1 hour 5 minutes" /
# "Or wait 40 minutes for your next included review."
WAIT_RE = re.compile(r"available\s+in\s*:?\s*[*_ ]*([^\n]{0,80})|\bwait\s+([^\n]{0,40}?)\s+for\s+your\s+next", re.I)
UNIT_RE = re.compile(r"(\d+)\s*(hour|hr|minute|min|second|sec)", re.I)
UNIT_MINUTES = {"hour": 60.0, "hr": 60.0, "minute": 1.0, "min": 1.0, "second": 1 / 60, "sec": 1 / 60}

DEFAULT_BUFFER_MINUTES = 2      # past the announced delay, as the stated reset is exact
DEFAULT_UNKNOWN_WAIT_MINUTES = 60  # no delay announced (paid plan): rolling hourly refill
DEFAULT_STALE_MINUTES = 30      # a relaunch with no answer after this is lost
DEFAULT_MAX_ATTEMPTS = 3        # :cron relaunches left unanswered before giving up on a PR
DEFAULT_HEAD_CAP = 3            # commands of any origin on one head commit
DEFAULT_PUSH_QUIET_MINUTES = 20  # an uncovered head younger than this may still be under review
RELAUNCH_MARKER_RE = re.compile(r"<!--\s*kodflow-relaunch:(cron|hook)\b([^>]*?)-->")
MARKER_HEAD_RE = re.compile(r"\bhead=([0-9a-fA-F]{7,40})\b")
DEFAULT_EXCLUDE = r"-ghsa-"     # temporary private forks of security advisories


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


# ---------------------------------------------------------------- time helpers


def parse_time(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def fmt_time(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------- GitHub API


def token_for(owner: str, timeout: float = 3.0) -> Optional[str]:
    suffix = re.sub(r"[^A-Za-z0-9]", "_", owner).upper()
    for var in (f"GH_TOKEN_{suffix}", "GH_TOKEN", "GITHUB_TOKEN"):
        if os.environ.get(var):
            return os.environ[var]
    if timeout <= 0.2:
        return None
    try:
        out = subprocess.run(
            ["gh", "auth", "token"], capture_output=True, text=True, timeout=timeout, check=False
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return None


class Api:
    """Minimal GitHub REST client; one token per owner."""

    def __init__(self, deadline: Optional[float] = None) -> None:
        self._tokens: Dict[str, Optional[str]] = {}
        self.calls = 0                       # requests actually sent
        self._deadline = deadline            # time.monotonic() instant, or None

    def _token(self, owner: str) -> Optional[str]:
        if owner not in self._tokens:
            budget = 3.0 if self._deadline is None else min(3.0, self._deadline - time.monotonic())
            self._tokens[owner] = token_for(owner, budget)
        return self._tokens[owner]

    def _request(self, owner: str, url: str, method: str = "GET", payload: Any = None) -> Tuple[Any, Dict[str, str]]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "kodflow-coderabbit-probe",
        }
        token = self._token(owner)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        for attempt in range(3):
            timeout = 30.0
            if self._deadline is not None:
                timeout = min(timeout, self._deadline - time.monotonic())
                if timeout <= 0.2:
                    raise ApiError(0, "deadline reached")
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https only)
                    body = resp.read()
                    return (json.loads(body) if body else None), dict(resp.headers)
            except urllib.error.HTTPError as err:
                # Only the status and GitHub's message: never headers (the token).
                try:
                    message = json.loads(err.read()).get("message", err.reason)
                except (ValueError, AttributeError):
                    message = str(err.reason)
                if err.code in (502, 503, 504) and attempt < 2 and self._deadline is None:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise ApiError(err.code, message) from None
            except (urllib.error.URLError, OSError) as err:
                if attempt < 2 and self._deadline is None:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise ApiError(0, str(getattr(err, "reason", err))) from None
        raise ApiError(0, "unreachable")

    def paginate(self, owner: str, path: str, params: Optional[Dict[str, Any]] = None, key: Optional[str] = None, max_pages: Optional[int] = None) -> List[Any]:
        query = dict(params or {})
        query.setdefault("per_page", 100)
        url = f"{API}{path}?{urllib.parse.urlencode(query)}"
        out: List[Any] = []
        pages = 0
        while url:
            data, headers = self._request(owner, url)
            out.extend(data[key] if key else data)
            pages += 1
            if max_pages is not None and pages >= max_pages:
                break
            link = {k.lower(): v for k, v in headers.items()}.get("link", "")
            m = re.search(r'<([^>]+)>;\s*rel="next"', link)
            url = m.group(1) if m else ""
        return out

    def post_comment(self, owner: str, repo: str, number: int, body: str) -> None:
        self._request(owner, f"{API}/repos/{repo}/issues/{number}/comments", "POST", {"body": body})

    def get(self, owner: str, path: str) -> Any:
        return self._request(owner, f"{API}{path}")[0]


# ---------------------------------------------------------------------- parsing


def parse_wait_minutes(body: str) -> Optional[int]:
    """Minutes announced by "available in ...", rounded up; None when absent."""
    m = WAIT_RE.search(body)
    if not m:
        return None
    segment = m.group(1) or m.group(2) or ""
    total = sum(int(n) * UNIT_MINUTES[u.lower()] for n, u in UNIT_RE.findall(segment))
    if total:
        return int(math.ceil(total))
    if re.search(r"\ban?\s+hour\b", segment, re.I):
        return 60
    if re.search(r"\b(?:less than )?an?\s+minute\b", segment, re.I):
        return 1
    return None


def refusal_kind(body: str) -> str:
    """`rate_limited` (a quota) or `paused` (auto-pause after N reviewed commits)."""
    if RATE_LIMITED_RE.search(body) or not PAUSED_RE.search(body):
        return "rate_limited"
    return "paused"


def refusal_reason(body: str) -> str:
    if USAGE_BASED_RE.search(body):
        return "usage_based_disabled"
    if parse_wait_minutes(body) is not None:
        return "hourly_limit"
    return "unknown"


def is_bot(user: Optional[Dict[str, Any]]) -> bool:
    return bool(user) and (user.get("type") == "Bot" or str(user.get("login", "")).endswith("[bot]"))


def latest_refusal(comments: Iterable[Dict[str, Any]], kind: Optional[str] = None) -> Optional[Dict[str, Any]]:
    best = None
    for c in comments:
        if (c.get("user") or {}).get("login") != BOT_LOGIN:
            continue
        if not REFUSAL_RE.search(c.get("body") or ""):
            continue
        if kind is not None and refusal_kind(c.get("body") or "") != kind:
            continue
        stamp = c.get("updated_at") or c.get("created_at")
        if best is None or stamp > (best.get("updated_at") or best.get("created_at")):
            best = c
    return best


def covering_review(reviews: Iterable[Dict[str, Any]], head_sha: str, refused_at: dt.datetime) -> Optional[Dict[str, Any]]:
    for r in reviews:
        if (r.get("user") or {}).get("login") != BOT_LOGIN:
            continue
        real = bool(REAL_REVIEW_RE.search(r.get("body") or "")) or r.get("state") in ("APPROVED", "CHANGES_REQUESTED")
        if not real or not r.get("submitted_at"):
            continue
        if r.get("commit_id") == head_sha or parse_time(r["submitted_at"]) > refused_at:
            return r
    return None


def same_sha(a: Optional[str], b: Optional[str]) -> bool:
    """Equal commits, a short sha (7+) matching the start of a full one."""
    if not a or not b:
        return False
    a, b = a.lower(), b.lower()
    return min(len(a), len(b)) >= 7 and (a.startswith(b) or b.startswith(a))


def command_body(origin: str, head_sha: Optional[str] = None) -> str:
    """The command, then the marker: COMMAND_RE is anchored, the command opens the comment."""
    head = f" head={head_sha}" if head_sha else ""
    return f"{COMMAND}\n\n<!-- kodflow-relaunch:{origin}{head} -->"


def parse_command(c: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A review command of a person: its origin (cron, hook, manual), head and time."""
    body = c.get("body") or ""
    if is_bot(c.get("user")) or not COMMAND_RE.match(body):
        return None
    m = RELAUNCH_MARKER_RE.search(body)
    h = MARKER_HEAD_RE.search(m.group(2)) if m else None
    return {
        "origin": m.group(1) if m else "manual",
        "head": h.group(1).lower() if h else None,
        "at": parse_time(c["created_at"]),
    }


def relaunch_state(comments: Iterable[Dict[str, Any]], refused_at: dt.datetime, now: dt.datetime, stale_minutes: int,
                   max_attempts: int, head_sha: Optional[str] = None, head_cap: int = DEFAULT_HEAD_CAP) -> Dict[str, Any]:
    """Where the commands of a pull request stand.

    `refused_at` is the instant commands are counted from (the refusal, or the
    last push for an uncovered head): an older command was answered already.
      pending        a command of any origin newer than `stale_minutes`: no new one
      owner_pending  the same, `:cron` only: holds the owner's one slot
      attempts       `:cron` commands since `refused_at`; `max_attempts` = abandoned
      head_attempts  commands of any origin on this head (by the marker's head=,
                     else posted since `refused_at`); `head_cap` = capped
    """
    cmds = sorted(filter(None, (parse_command(c) for c in comments)), key=lambda c: c["at"])
    after = [c for c in cmds if c["at"] > refused_at]
    cron = [c for c in after if c["origin"] == "cron"]
    on_head = [c for c in cmds if same_sha(c["head"], head_sha)] if head_sha else []
    on_head += [c for c in after if not c["head"] or not head_sha]
    window = dt.timedelta(minutes=stale_minutes)
    pending = bool(after) and now - after[-1]["at"] < window
    owner_pending = bool(cron) and now - cron[-1]["at"] < window
    if len(cron) >= max_attempts:
        state = "abandoned"
    elif len(on_head) >= head_cap:
        state = "capped"
    elif pending:
        state = "pending"
    elif after:
        state = "stale"
    else:
        state = "none"
    return {
        "state": state,
        "attempts": len(cron),
        "head_attempts": len(on_head),
        "owner_pending": owner_pending,
        "last_commented_at": fmt_time(after[-1]["at"]) if after else None,
    }


# ------------------------------------------------------------- minimal YAML
#
# The policy files and a repository's .coderabbit.yaml are YAML, and this file
# imports nothing outside the standard library: the hook runs it as
# `python3 -I` on any laptop, the relaunch workflow checks out this one file.
# PyYAML may or may not be installed (and -I hides a user install), so a reader
# that depends on it would answer differently on two machines. This is a
# block-style subset: mappings, sequences, plain and quoted scalars (one or
# several lines), flow collections `[...]` / `{...}`, block scalars `|` and `>`
# (read loosely: their text is never used here), comments, `---`. Anchors,
# aliases, tags, complex keys and anything else raise YamlError, which every
# caller turns into `eligible: unknown`: a file read wrongly must never decide.


class YamlError(ValueError):
    pass


_YAML_INT = re.compile(r"[-+]?\d+")
_YAML_FLOAT = re.compile(r"[-+]?(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?")


def _yaml_strip_comment(s: str) -> str:
    quote = None
    i = 0
    while i < len(s):
        ch = s[i]
        if quote:
            if quote == '"' and ch == "\\":
                i += 2
                continue
            if ch == quote:
                if quote == "'" and s[i + 1:i + 2] == "'":
                    i += 2
                    continue
                quote = None
        elif ch in "\"'" and (i == 0 or s[i - 1] in " \t[{,:"):
            quote = ch
        elif ch == "#" and (i == 0 or s[i - 1] in " \t"):
            return s[:i].rstrip()
        i += 1
    return s.rstrip()


def _yaml_lines(text: str) -> List[List[Any]]:
    out: List[List[Any]] = []
    for raw in text.splitlines():
        body = raw.lstrip(" ")
        if body.startswith("\t"):
            raise YamlError("tab in indentation")
        line = _yaml_strip_comment(body)
        if not line or line in ("---", "...") or line.startswith("%"):
            continue
        if line.startswith("--- "):
            line = line[4:].strip()
        out.append([len(raw) - len(body), line])
    return out


def _yaml_quoted_end(t: str) -> int:
    """Index of the quote closing the scalar that opens `t`, -1 when unclosed."""
    q = t[0]
    i = 1
    while i < len(t):
        if q == '"' and t[i] == "\\":
            i += 2
            continue
        if t[i] == q:
            if q == "'" and t[i + 1:i + 2] == "'":
                i += 2
                continue
            return i
        i += 1
    return -1


def _yaml_key(t: str) -> Optional[Tuple[str, str]]:
    """(key, rest) when the line opens a mapping entry, else None."""
    if not t or t[0] in "[{":
        return None
    if t[0] in "\"'":
        end = _yaml_quoted_end(t)
        if end < 0:
            return None
        after = t[end + 1:].lstrip()
        if after == ":" or after.startswith(": "):
            return str(_yaml_scalar(t[:end + 1])), after[1:].strip()
        return None
    if t[0] in "&*!|>%@`":
        if t[0] in "&*!":
            raise YamlError("anchors, aliases and tags are not supported")
        return None
    for j, ch in enumerate(t):
        if ch == ":" and (j + 1 == len(t) or t[j + 1] in " \t"):
            key = t[:j].strip()
            if key.startswith("? "):
                raise YamlError("complex keys are not supported")
            return key, t[j + 1:].strip()
    return None


def _yaml_scalar(text: str) -> Any:
    t = text.strip()
    if not t:
        return None
    if t[0] == '"':
        if _yaml_quoted_end(t) != len(t) - 1:
            raise YamlError("unterminated double-quoted scalar")
        try:
            return json.loads(t)
        except ValueError:
            return t[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    if t[0] == "'":
        if _yaml_quoted_end(t) != len(t) - 1:
            raise YamlError("unterminated single-quoted scalar")
        return t[1:-1].replace("''", "'")
    if t[0] in "&*!":
        raise YamlError("anchors, aliases and tags are not supported")
    if t in ("~", "null", "Null", "NULL"):
        return None
    if t in ("true", "True", "TRUE"):
        return True
    if t in ("false", "False", "FALSE"):
        return False
    if _YAML_INT.fullmatch(t):
        return int(t)
    if _YAML_FLOAT.fullmatch(t):
        return float(t)
    return t


class _YamlFlow:
    def __init__(self, text: str) -> None:
        self.t, self.i = text, 0

    def ws(self) -> None:
        while self.i < len(self.t) and self.t[self.i] in " \t":
            self.i += 1

    def value(self, stops: str) -> Any:
        self.ws()
        if self.i >= len(self.t):
            raise YamlError("unterminated flow collection")
        ch = self.t[self.i]
        if ch in "[{":
            return self.collection(ch)
        if ch in "\"'":
            end = _yaml_quoted_end(self.t[self.i:])
            if end < 0:
                raise YamlError("unterminated quoted scalar")
            out = _yaml_scalar(self.t[self.i:self.i + end + 1])
            self.i += end + 1
            return out
        start = self.i
        while self.i < len(self.t) and self.t[self.i] not in stops:
            if self.t[self.i] == ":" and ":" in stops and self.t[self.i + 1:self.i + 2] in (" ", ",", "}", ""):
                break
            self.i += 1
        return _yaml_scalar(self.t[start:self.i])

    def collection(self, opener: str) -> Any:
        closer = "]" if opener == "[" else "}"
        self.i += 1
        out: Any = [] if opener == "[" else {}
        while True:
            self.ws()
            if self.i < len(self.t) and self.t[self.i] == closer:
                self.i += 1
                return out
            if opener == "[":
                out.append(self.value(",]"))
            else:
                key = self.value(",}:")
                self.ws()
                if self.i < len(self.t) and self.t[self.i] == ":":
                    self.i += 1
                    out[str(key)] = self.value(",}")
                else:
                    out[str(key)] = None
            self.ws()
            if self.i < len(self.t) and self.t[self.i] == ",":
                self.i += 1
            elif not (self.i < len(self.t) and self.t[self.i] == closer):
                raise YamlError("malformed flow collection")


def _yaml_flow(text: str) -> Any:
    p = _YamlFlow(text)
    out = p.value("")
    p.ws()
    if p.i != len(text):
        raise YamlError("text after a flow collection")
    return out


def _yaml_is_dash(t: str) -> bool:
    return t == "-" or t.startswith("- ")


def _yaml_value(lines: List[List[Any]], i: int, ind: int, rest: str, in_map: bool) -> Tuple[Any, int]:
    """The value of an entry at indent `ind` whose inline text is `rest`."""
    n = len(lines)
    if rest == "":
        if i < n and lines[i][0] > ind:
            return _yaml_block(lines, i, lines[i][0])
        if in_map and i < n and lines[i][0] == ind and _yaml_is_dash(lines[i][1]):
            return _yaml_seq(lines, i, ind)
        return None, i
    if rest[0] in "|>":
        parts = []
        while i < n and lines[i][0] > ind:
            parts.append(lines[i][1])
            i += 1
        return ("\n" if rest[0] == "|" else " ").join(parts), i
    text = rest
    while i < n and lines[i][0] > ind:
        if rest[0] not in "\"'[{" and _yaml_key(lines[i][1]) is not None:
            raise YamlError("a mapping inside a plain scalar")   # PyYAML: mapping values are not allowed here
        text += " " + lines[i][1]
        i += 1
    if text[0] in "[{":
        return _yaml_flow(text), i
    return _yaml_scalar(text), i


def _yaml_map(lines: List[List[Any]], i: int, ind: int) -> Tuple[Dict[str, Any], int]:
    out: Dict[str, Any] = {}
    while i < len(lines) and lines[i][0] == ind:
        t = lines[i][1]
        if _yaml_is_dash(t):
            break
        kv = _yaml_key(t)
        if kv is None:
            raise YamlError(f"expected a key: {t[:40]!r}")
        out[kv[0]], i = _yaml_value(lines, i + 1, ind, kv[1], True)
    if i < len(lines) and lines[i][0] > ind:
        raise YamlError("bad indentation")
    return out, i


def _yaml_seq(lines: List[List[Any]], i: int, ind: int) -> Tuple[List[Any], int]:
    out: List[Any] = []
    while i < len(lines) and lines[i][0] == ind and _yaml_is_dash(lines[i][1]):
        t = lines[i][1]
        rest = t[1:].lstrip()
        col = ind + len(t) - len(rest)
        if rest and (_yaml_is_dash(rest) or _yaml_key(rest) is not None):
            lines[i] = [col, rest]                 # the item's first line, at its own column
            value, i = _yaml_block(lines, i, col)
        else:
            value, i = _yaml_value(lines, i + 1, ind, rest, False)
        out.append(value)
    if i < len(lines) and lines[i][0] > ind:
        raise YamlError("bad indentation")
    return out, i


def _yaml_block(lines: List[List[Any]], i: int, ind: int) -> Tuple[Any, int]:
    t = lines[i][1]
    if _yaml_is_dash(t):
        return _yaml_seq(lines, i, ind)
    if _yaml_key(t) is not None:
        return _yaml_map(lines, i, ind)
    return _yaml_value(lines, i + 1, ind - 1, t, False)


def parse_yaml(text: str) -> Any:
    lines = _yaml_lines(text)
    if not lines:
        return None
    value, i = _yaml_block(lines, 0, lines[0][0])
    if i != len(lines):
        raise YamlError("text past the document")
    return value


# ------------------------------------------------------------ eligibility


def _dig(doc: Any, *keys: str) -> Any:
    for k in keys:
        if not isinstance(doc, dict):
            return None
        doc = doc.get(k)
    return doc


def _str_list(value: Any) -> List[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if v is not None and str(v).strip()]


def _read_yaml_file(path: str) -> Any:
    with open(path, encoding="utf-8") as fh:
        return parse_yaml(fh.read())


def load_policy(policy_dir: Optional[str], owner: str) -> Optional[Dict[str, Any]]:
    """The organisation layer of `owner`, or None when it cannot be read.

    `settings.yaml` is the organisation settings (CodeRabbit's layer under a
    repository file); `override-<owner>.yaml` holds the lists that apply on top
    of whatever file a repository has. A missing override is an empty one; a
    missing settings.yaml is only needed for a repository without its own file.
    """
    if not policy_dir or not os.path.isdir(policy_dir):
        return None
    settings: Any = None
    path = os.path.join(policy_dir, "settings.yaml")
    if os.path.isfile(path):
        settings = _read_yaml_file(path)
    override: Any = {}
    for name in (f"override-{owner}.yaml", f"override-{owner.lower()}.yaml"):
        path = os.path.join(policy_dir, name)
        if os.path.isfile(path):
            override = _read_yaml_file(path) or {}
            break
    auto = _dig(override, "reviews", "auto_review")
    if not isinstance(auto, dict):
        auto = override if isinstance(override, dict) else {}
    return {
        "settings": settings if isinstance(settings, dict) else None,
        "override": {
            "ignore_usernames": _str_list(auto.get("ignore_usernames")),
            "ignore_title_keywords": _str_list(auto.get("ignore_title_keywords")),
        },
    }


def _glob_part(pat: str) -> str:
    out = ""
    i = 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pat.startswith("**", i):
            out += ".*"
            i += 2
        elif pat[i] == "*":
            out += "[^/]*"
            i += 1
        elif pat[i] == "?":
            out += "[^/]"
            i += 1
        elif pat[i] == "{" and "}" in pat[i:]:
            j = pat.index("}", i)
            out += "(?:" + "|".join(_glob_part(a) for a in pat[i + 1:j].split(",")) + ")"
            i = j + 1
        elif pat[i] == "[" and "]" in pat[i + 1:]:
            j = pat.index("]", i + 1)
            body = pat[i + 1:j]
            if body.startswith("!"):
                body = "^" + body[1:]
            out += "[" + body.replace("\\", "\\\\") + "]"
            i = j + 1
        else:
            out += re.escape(pat[i])
            i += 1
    return out


def glob_match(pattern: str, path: str) -> bool:
    """minimatch's reading of CodeRabbit's path_filters: `**` spans directories."""
    try:
        return re.fullmatch(_glob_part(pattern.lstrip("/")), path) is not None
    except re.error:
        return False


def path_kept(path: str, filters: List[str]) -> bool:
    includes = [f for f in filters if not f.startswith("!")]
    excludes = [f[1:] for f in filters if f.startswith("!")]
    if includes and not any(glob_match(f, path) for f in includes):
        return False
    return not any(glob_match(f, path) for f in excludes)


def resolve_eligibility(pr: Dict[str, Any], settings: Dict[str, Any], override: Dict[str, List[str]],
                        files: Any) -> Tuple[bool, str]:
    """Would CodeRabbit review this pull request on its own: (eligible, reason).

    `settings` is the repository's file if it has one, else the organisation's;
    `override` lists are unioned on top unconditionally. `files` is a callable
    returning the changed paths, called only when path_filters decide.
    """
    auto = _dig(settings, "reviews", "auto_review")
    auto = auto if isinstance(auto, dict) else {}
    if auto.get("enabled") is False:
        return False, "auto_review disabled"
    login = str((pr.get("user") or {}).get("login") or "")
    if login in set(_str_list(auto.get("ignore_usernames")) + override["ignore_usernames"]):
        return False, f"author {login} is in ignore_usernames"
    title = str(pr.get("title") or "").casefold()
    for kw in _str_list(auto.get("ignore_title_keywords")) + override["ignore_title_keywords"]:
        if kw.casefold() in title:
            return False, f"title contains ignore_title_keywords entry {kw!r}"
    if pr.get("draft") and auto.get("drafts") is not True:
        return False, "draft"
    base = str(_dig(pr, "base", "ref") or "")
    default = _dig(pr, "base", "repo", "default_branch")
    if base != default:
        patterns = _str_list(auto.get("base_branches"))
        if not any(_safe_search(p, base) for p in patterns):
            return False, f"base branch {base} is neither the default branch nor in base_branches"
    filters = _str_list(_dig(settings, "reviews", "path_filters"))
    if filters:
        paths = files()
        if paths and not any(path_kept(p, filters) for p in paths):
            return False, "every changed file is excluded by path_filters"
    return True, "eligible"


def _safe_search(pattern: str, text: str) -> bool:
    try:
        return re.search(pattern, text) is not None   # CodeRabbit: regex, not anchored
    except re.error:
        return False


def repo_settings(api: Api, repo: str, ref: str) -> Optional[Dict[str, Any]]:
    """The repository's own .coderabbit.yaml at `ref`, None when it has none."""
    owner = repo.split("/")[0]
    for name in (".coderabbit.yaml", ".coderabbit.yml"):
        try:
            doc = api.get(owner, f"/repos/{repo}/contents/{name}?ref={urllib.parse.quote(ref, safe='')}")
        except ApiError as err:
            if err.status == 404:
                continue
            raise
        raw = base64.b64decode(doc.get("content") or "").decode("utf-8")
        parsed = parse_yaml(raw)
        return parsed if isinstance(parsed, dict) else {}
    return None


def eligibility(api: Api, repo: str, pr: Dict[str, Any], policy: Optional[Dict[str, Any]]) -> Tuple[Any, str]:
    """(True | False | "unknown", reason). Configuration is read at the head:
    CodeRabbit uses the file of the branch under review."""
    if policy is None:
        return "unknown", "no readable policy directory"
    try:
        settings = repo_settings(api, repo, pr["head"]["sha"])
        if settings is None:
            settings = policy["settings"]
            if settings is None:
                return "unknown", "no .coderabbit.yaml in the repository and no settings.yaml in the policy directory"
        owner = repo.split("/")[0]
        number = pr["number"]

        def files() -> List[str]:
            return [f["filename"] for f in api.paginate(owner, f"/repos/{repo}/pulls/{number}/files", max_pages=30)]

        return resolve_eligibility(pr, settings, policy["override"], files)
    except (ApiError, YamlError, ValueError, KeyError, TypeError) as err:
        return "unknown", f"{type(err).__name__}: {err}"[:200]


# ------------------------------------------------------------- last reviewed

SUMMARY_RE = re.compile(r"summarize by coderabbit\.ai")
COVERAGE_RE = re.compile(r"<!--\s*final_review_risk_coverage:(\{.*?\})\s*-->", re.S)
LAST_REVIEWED_RE = re.compile(r"Last reviewed commit:\s*`?([0-9a-fA-F]{7,40})\b")
RANGE_RE = re.compile(r"\bbetween\s+`?([0-9a-fA-F]{7,40})`?\s+and\s+`?([0-9a-fA-F]{7,40})\b")
RECENT_RE = re.compile(r"<!--\s*recent_review(?:_status)?_start\s*-->(.*?)<!--\s*recent_review(?:_status)?_end\s*-->", re.S)
PUBLICATION_RE = re.compile(r"coderabbit-review-publication")


def summary_comment(comments: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    best = None
    for c in comments:
        if (c.get("user") or {}).get("login") != BOT_LOGIN or not SUMMARY_RE.search(c.get("body") or ""):
            continue
        if best is None or (c.get("updated_at") or "") > (best.get("updated_at") or ""):
            best = c
    return best


def last_reviewed(comments: List[Dict[str, Any]], reviews: Any) -> Tuple[Optional[str], Optional[str]]:
    """(sha, source) of the last commit CodeRabbit reviewed, (None, None) when no marker says.

    `reviews` is a callable returning the pull request's reviews, called only
    when the summary comment says nothing.
    """
    summary = summary_comment(comments)
    body = (summary or {}).get("body") or ""
    for m in COVERAGE_RE.finditer(body):
        try:
            sha = json.loads(m.group(1)).get("coveredCommitId")
        except ValueError:
            continue
        if isinstance(sha, str) and re.fullmatch(r"[0-9a-fA-F]{7,40}", sha):
            return sha.lower(), "final_review_risk_coverage"
    m = LAST_REVIEWED_RE.search(body)
    if m:
        return m.group(1).lower(), "last_reviewed_commit"
    for section in RECENT_RE.findall(body):
        m = RANGE_RE.search(section)
        if m:
            return m.group(2).lower(), "recent_review_range"
    best = None
    for r in reviews():
        text = r.get("body") or ""
        if (r.get("user") or {}).get("login") != BOT_LOGIN or not text.strip() or not PUBLICATION_RE.search(text):
            continue   # empty-body thread replies and approval-only records say nothing
        m = RANGE_RE.search(text)
        if m and r.get("submitted_at") and (best is None or r["submitted_at"] > best[0]):
            best = (r["submitted_at"], m.group(2).lower())
    if best:
        return best[1], "review_range"
    return None, None


def coverage(api: Api, repo: str, pr: Dict[str, Any], comments: List[Dict[str, Any]],
             policy: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """`eligible`, `reason`, `last_reviewed`, `covered` of one pull request."""
    owner = repo.split("/")[0]
    head = pr["head"]["sha"]
    out: Dict[str, Any] = {"head": head}
    out["eligible"], out["reason"] = eligibility(api, repo, pr, policy)
    try:
        sha, source = last_reviewed(comments, lambda: api.paginate(owner, f"/repos/{repo}/pulls/{pr['number']}/reviews"))
    except ApiError as err:
        sha, source = None, None
        out["error"] = f"reviews: {err}"[:200]
    out["last_reviewed"] = sha
    out["last_reviewed_source"] = source
    out["covered"] = "unknown" if sha is None else same_sha(sha, head)
    return out


# --------------------------------------------------------------------- analysis


def standing_refusal(api: Api, repo: str, pr: Dict[str, Any], comments: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The latest refusal no review has followed: a rate limit first, else a pause.

    The summary comment carries the pause and is edited on every event, so it is
    often the newest; it must not hide a rate limit still standing.
    """
    owner = repo.split("/")[0]
    reviews: Optional[List[Dict[str, Any]]] = None
    for kind in ("rate_limited", "paused"):
        refusal = latest_refusal(comments, kind)
        if refusal is None:
            continue
        if reviews is None:
            reviews = api.paginate(owner, f"/repos/{repo}/pulls/{pr['number']}/reviews")
        refused_at = parse_time(refusal.get("updated_at") or refusal["created_at"])
        if not covering_review(reviews, pr["head"]["sha"], refused_at):
            return refusal
    return None


def analyze_pr(api: Api, repo: str, pr: Dict[str, Any], now: dt.datetime, opts: argparse.Namespace,
               comments: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
    """The blocked-PR record, or None when no refusal stands on the PR."""
    owner = repo.split("/")[0]
    number = pr["number"]
    if comments is None:
        comments = api.paginate(owner, f"/repos/{repo}/issues/{number}/comments")
    refusal = standing_refusal(api, repo, pr, comments)
    if refusal is None:
        return None
    refused_at = parse_time(refusal.get("updated_at") or refusal["created_at"])
    head_sha = pr["head"]["sha"]

    body = refusal.get("body") or ""
    wait = parse_wait_minutes(body)
    wait_used = wait if wait is not None else opts.unknown_wait_minutes
    available_at = refused_at + dt.timedelta(minutes=wait_used)
    ready_at = available_at + dt.timedelta(minutes=opts.buffer_minutes)
    relaunch = relaunch_state(comments, refused_at, now, opts.stale_minutes, opts.max_attempts,
                              head_sha, getattr(opts, "head_cap", DEFAULT_HEAD_CAP))
    ready = now >= ready_at
    seconds_left = max(0.0, (ready_at - now).total_seconds())
    return {
        "repo": repo,
        "owner": owner,
        "number": number,
        "title": pr.get("title", ""),
        "url": pr.get("html_url", f"https://github.com/{repo}/pull/{number}"),
        "author": (pr.get("user") or {}).get("login"),
        "created_at": pr["created_at"],
        "head_sha": head_sha,
        "kind": refusal_kind(body),
        "reason": refusal_reason(body),
        "refused_at": fmt_time(refused_at),
        "refusal_comment_url": refusal.get("html_url"),
        "next_available_minutes": wait,
        "next_available_at": fmt_time(available_at) if wait is not None else None,
        "ready_at": fmt_time(ready_at),
        "ready": ready,
        "minutes_until_ready": int(math.ceil(seconds_left / 60)),
        "relaunch": relaunch,
        "eligible": ready and relaunch["state"] in ("none", "stale"),
    }


def review_in_progress(api: Api, repo: str, sha: str) -> bool:
    """A CodeRabbit commit status or check run on `sha` that has not finished."""
    owner = repo.split("/")[0]
    status = api.get(owner, f"/repos/{repo}/commits/{sha}/status") or {}
    for st in status.get("statuses") or []:
        if str(st.get("context", "")).lower().startswith("coderabbit") and st.get("state") == "pending":
            return True
    runs = api.get(owner, f"/repos/{repo}/commits/{sha}/check-runs") or {}
    for run in runs.get("check_runs") or []:
        if (run.get("app") or {}).get("slug") == "coderabbitai" and run.get("status") != "completed":
            return True
    return False


def analyze_uncovered(api: Api, repo: str, pr: Dict[str, Any], comments: List[Dict[str, Any]], now: dt.datetime,
                      opts: argparse.Namespace, policy: Optional[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """(record, coverage): a record only for a review-eligible PR whose head is
    POSITIVELY not covered; `unknown` on either side never makes one."""
    cov = coverage(api, repo, pr, comments, policy)
    if cov["eligible"] is not True or cov["covered"] is not False:
        return None, cov
    owner = repo.split("/")[0]
    head = pr["head"]["sha"]
    commit = api.get(owner, f"/repos/{repo}/commits/{head}") or {}
    # The committer date of the head: a push is never older than it, so the
    # quiet period it measures is a lower bound of the real one.
    pushed_at = parse_time(_dig(commit, "commit", "committer", "date") or pr.get("updated_at") or fmt_time(now))
    quiet = now - pushed_at >= dt.timedelta(minutes=getattr(opts, "push_quiet_minutes", DEFAULT_PUSH_QUIET_MINUTES))
    in_progress = review_in_progress(api, repo, head) if quiet else None
    relaunch = relaunch_state(comments, pushed_at, now, opts.stale_minutes, opts.max_attempts,
                              head, getattr(opts, "head_cap", DEFAULT_HEAD_CAP))
    return {
        "repo": repo,
        "owner": owner,
        "number": pr["number"],
        "title": pr.get("title", ""),
        "url": pr.get("html_url", f"https://github.com/{repo}/pull/{pr['number']}"),
        "author": (pr.get("user") or {}).get("login"),
        "created_at": pr["created_at"],
        "head_sha": head,
        "last_reviewed": cov["last_reviewed"],
        "last_reviewed_source": cov["last_reviewed_source"],
        "pushed_at": fmt_time(pushed_at),
        "quiet": quiet,
        "review_in_progress": in_progress,
        "relaunch": relaunch,
        "eligible": bool(quiet and in_progress is False and relaunch["state"] in ("none", "stale")),
    }, cov


def select_candidates(blocked: List[Dict[str, Any]], uncovered: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """At most one PR per owner, none while a `:cron` relaunch of that owner awaits its answer.

    First the oldest ready rate-limited PR; else, when no rate limit of the
    owner is still running, the oldest uncovered head (eligible, quiet, no
    review in progress). A pause alone is not a class: a paused PR is relaunched
    through the uncovered class, on a positive `covered: false` only.
    """
    uncovered = uncovered or []
    by_owner: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    for rec in blocked:
        by_owner.setdefault(rec["owner"], {"b": [], "u": []})["b"].append(rec)
    for rec in uncovered:
        by_owner.setdefault(rec["owner"], {"b": [], "u": []})["u"].append(rec)

    def oldest(recs: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        ok = sorted((r for r in recs if r["eligible"]), key=lambda r: (r["created_at"], r["repo"], r["number"]))
        return ok[0] if ok else None

    out = []
    for owner in sorted(by_owner):
        recs = by_owner[owner]
        if any(r["relaunch"].get("owner_pending") for r in recs["b"] + recs["u"]):
            continue
        limited = [r for r in recs["b"] if r.get("kind", "rate_limited") == "rate_limited"]
        pick = oldest(limited)
        cls = "rate_limited"
        if pick is None and not any(not r.get("ready", True) for r in limited):
            pick, cls = oldest(recs["u"]), "uncovered"
        if pick:
            out.append({"owner": owner, "repo": pick["repo"], "number": pick["number"], "class": cls})
    return out


def list_open_prs(api: Api, repo: str) -> List[Dict[str, Any]]:
    owner = repo.split("/")[0]
    prs = api.paginate(owner, f"/repos/{repo}/pulls", {"state": "open"})
    return [p for p in prs if not p.get("draft")]


def repos_of_owner(api: Api, owner: str) -> List[str]:
    items = api.paginate(owner, "/search/issues", {"q": f"is:pr is:open archived:false user:{owner}"}, key="items")
    seen = []
    for it in items:
        name = "/".join(it["repository_url"].split("/")[-2:])
        if name not in seen:
            seen.append(name)
    return seen


def probe(api: Api, repos: List[str], owners: List[str], now: dt.datetime, opts: argparse.Namespace) -> Dict[str, Any]:
    errors: List[Dict[str, str]] = []
    exclude = re.compile(opts.exclude) if opts.exclude else None
    targets: List[str] = []
    for owner in owners:
        try:
            targets.extend(repos_of_owner(api, owner))
        except ApiError as err:
            errors.append({"scope": owner, "error": str(err)})
    targets.extend(repos)
    targets = [r for i, r in enumerate(targets) if r not in targets[:i] and not (exclude and exclude.search(r))]

    blocked: List[Dict[str, Any]] = []
    uncovered: List[Dict[str, Any]] = []
    coverage_counts = {"covered": 0, "uncovered": 0, "ineligible": 0, "unknown": 0}
    policies: Dict[str, Optional[Dict[str, Any]]] = {}
    policy_dir = getattr(opts, "policy_dir", None)
    scanned_prs = 0
    scanned_repos = 0
    for repo in targets:
        try:
            prs = list_open_prs(api, repo)
            scanned_repos += 1
            scanned_prs += len(prs)
            owner = repo.split("/")[0]
            for pr in prs:
                comments = api.paginate(owner, f"/repos/{repo}/issues/{pr['number']}/comments")
                rec = analyze_pr(api, repo, pr, now, opts, comments)
                if rec:
                    blocked.append(rec)
                if not policy_dir or (rec and rec["kind"] == "rate_limited"):
                    continue
                if owner not in policies:
                    try:
                        policies[owner] = load_policy(policy_dir, owner)
                    except (OSError, YamlError, ValueError) as err:
                        policies[owner] = None
                        errors.append({"scope": f"policy {owner}", "error": f"{type(err).__name__}: {err}"[:200]})
                u, cov = analyze_uncovered(api, repo, pr, comments, now, opts, policies[owner])
                if cov["eligible"] is False:
                    coverage_counts["ineligible"] += 1
                elif cov["eligible"] == "unknown" or cov["covered"] == "unknown":
                    coverage_counts["unknown"] += 1
                else:
                    coverage_counts["covered" if cov["covered"] else "uncovered"] += 1
                if u:
                    uncovered.append(u)
        except ApiError as err:
            errors.append({"scope": repo, "error": str(err)})
    blocked.sort(key=lambda r: (r["created_at"], r["repo"], r["number"]))
    uncovered.sort(key=lambda r: (r["created_at"], r["repo"], r["number"]))
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": fmt_time(now),
        "bot_login": BOT_LOGIN,
        "scanned": {"repos": scanned_repos, "pull_requests": scanned_prs},
        "blocked": blocked,
        "uncovered": uncovered,
        "coverage": coverage_counts if policy_dir else None,
        "candidates": select_candidates(blocked, uncovered),
        "errors": errors,
    }


# ------------------------------------------------------------------- relaunching


def relaunch(api: Api, document: Dict[str, Any], now: dt.datetime, opts: argparse.Namespace) -> int:
    if document.get("schema_version") != SCHEMA_VERSION:
        print(f"unsupported schema_version {document.get('schema_version')!r}", file=sys.stderr)
        return 1
    status = 0
    for cand in document.get("candidates", []):
        repo, number = cand["repo"], cand["number"]
        cls = cand.get("class", "rate_limited")
        # Re-read the pull request just before posting: the document may be minutes old.
        try:
            pr = api.get(cand["owner"], f"/repos/{repo}/pulls/{number}")
            if pr.get("state") != "open" or pr.get("draft"):
                print(f"skip {repo}#{number}: no longer an open non-draft pull request")
                continue
            comments = api.paginate(cand["owner"], f"/repos/{repo}/issues/{number}/comments")
            rec = analyze_pr(api, repo, pr, now, opts, comments)
            if cls == "uncovered":
                if rec and rec["kind"] == "rate_limited":
                    print(f"skip {repo}#{number}: refused for quota since the probe")
                    continue
                policy = load_policy(getattr(opts, "policy_dir", None), cand["owner"])
                rec, _ = analyze_uncovered(api, repo, pr, comments, now, opts, policy)
                if rec is None or not rec["eligible"]:
                    print(f"skip {repo}#{number}: covered, not review-eligible, or not ready any more")
                    continue
            elif rec is None or rec["kind"] != "rate_limited" or not rec["eligible"]:
                print(f"skip {repo}#{number}: no longer blocked or not eligible")
                continue
            body = command_body("cron", pr["head"]["sha"])
            if opts.dry_run:
                print(f"dry-run: would post '{COMMAND}' (cron, {cls}) on {repo}#{number}")
                continue
            api.post_comment(cand["owner"], repo, number, body)
            print(f"posted '{COMMAND}' (cron, {cls}) on {repo}#{number}")
            time.sleep(opts.delay)
        except (ApiError, OSError, YamlError, ValueError) as err:
            print(f"error on {repo}#{number}: {type(err).__name__}: {err}", file=sys.stderr)
            status = 1
    return status


# ---------------------------------------------------------------------- capacity

DEFAULT_CACHE_MINUTES = 5
DEFAULT_RECENT = 5          # open non-draft PRs read per refresh (one comments call each)
DEFAULT_WINDOW_HOURS = 3    # a PR untouched for longer cannot hold a live refusal
DEFAULT_DEADLINE_SECONDS = 4.0
# GitHub's own alphabet: an owner is alphanumerics and single hyphens, a name
# alphanumerics, `_`, `-` and `.`, never `.` or `..` alone.
_OWNER = r"([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*)"
_NAME = r"((?!\.{1,2}(?:\.git)?/?$)[A-Za-z0-9_.-]+?)"
REMOTE_RES = (
    re.compile(r"^https?://(?:[^/@]*@)?github\.com/" + _OWNER + "/" + _NAME + r"(?:\.git)?/?$"),
    re.compile(r"^(?:ssh://)?git@github\.com[:/]" + _OWNER + "/" + _NAME + r"(?:\.git)?/?$"),
)


def git_output(cwd: str, *args: str, timeout: float = 3.0) -> Optional[str]:
    if timeout <= 0.2:
        return None
    try:
        out = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else None


def valid_repo(repo: str) -> bool:
    """OWNER/NAME in GitHub's alphabet, with no `.` or `..` segment."""
    return bool(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)) and not {".", ".."} & set(repo.split("/"))


def repo_from_remote(url: str) -> Optional[str]:
    for rx in REMOTE_RES:
        m = rx.match(url.strip())
        if m:
            return f"{m.group(1)}/{m.group(2)}"
    return None


def _cache_path(cache_dir: str, repo: str) -> str:
    return os.path.join(cache_dir, re.sub(r"[^A-Za-z0-9_.-]", "_", repo.replace("/", "__")) + ".json")


def _read_cache(path: str, now: dt.datetime, minutes: int) -> Optional[Dict[str, Any]]:
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        if doc.get("v") == SCHEMA_VERSION and 0 <= (now - parse_time(doc["fetched_at"])).total_seconds() < minutes * 60:
            return doc["sample"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def _write_cache(path: str, sample: Dict[str, Any], now: dt.datetime) -> None:
    try:
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        tmp = f"{path}.{os.getpid()}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"v": SCHEMA_VERSION, "fetched_at": fmt_time(now), "sample": sample}, fh)
        os.replace(tmp, path)
    except OSError:
        pass  # a cache that cannot be written only costs the next call


def sample_repo(api: Api, repo: str, now: dt.datetime, opts: argparse.Namespace) -> Dict[str, Any]:
    """What the hint needs of a repository: its open PRs and the refusals still standing.

    Calls: 1 (the list) + 1 per recent non-draft PR (its comments) + 1 per PR
    whose comments hold a refusal (its reviews): at most 1 + 2 * `recent`.
    """
    owner = repo.split("/")[0]
    prs = api.paginate(owner, f"/repos/{repo}/pulls", {"state": "open", "sort": "updated", "direction": "desc", "per_page": 30}, max_pages=1)
    horizon = now - dt.timedelta(hours=opts.window_hours)
    blocked = []
    checked = 0
    for pr in prs:
        if pr.get("draft") or checked >= opts.recent or parse_time(pr["updated_at"]) < horizon:
            continue
        checked += 1
        rec = analyze_pr(api, repo, pr, now, opts)
        if rec and rec["kind"] == "rate_limited":   # a pause spends no quota
            blocked.append({"number": rec["number"], "ready_at": rec["ready_at"], "reason": rec["reason"]})
    return {
        "prs": [{"number": p["number"], "head_ref": p["head"]["ref"], "draft": bool(p.get("draft"))} for p in prs],
        "blocked": blocked,
    }


def advise(action: str, repo: str, minutes: int, refused: int, branch_pr: Optional[Dict[str, Any]], others: List[int]) -> str:
    """The text Claude reads; empty when there is nothing to say."""
    if action == "push":
        if not branch_pr or branch_pr["draft"]:
            return ""  # no PR, or a draft CodeRabbit skips: a push spends nothing
        return (
            f"CodeRabbit is rate limited on {repo}: {refused} recent pull request(s) were refused, the next included review frees up in about {minutes} min. "
            f"This branch has PR #{branch_pr['number']}, so this push triggers a review that would be refused. "
            f"If more commits are coming, group them and push once. A refused review is re-requested with a comment `@coderabbitai review` after about {minutes} min."
        )
    lines = [
        f"CodeRabbit is rate limited on {repo}: {refused} recent pull request(s) were refused, the next included review frees up in about {minutes} min "
        "(the quota is per developer: one more ready PR now only queues behind them). Before `gh pr create`, pick one:"
    ]
    n = 1
    if others:
        refs = ", ".join(f"#{x}" for x in others)
        lines.append(f"{n}. An open PR already covers this topic ({refs})? Add the commits there and push once instead of opening another.")
        n += 1
    lines.append(
        f"{n}. Open it as a draft (`gh pr create --draft`): CodeRabbit skips drafts by default (reviews.auto_review.drafts, unless the repo's "
        f".coderabbit.yaml turns it on), so no review is spent; mark it ready in about {minutes} min or comment `@coderabbitai review`."
    )
    n += 1
    if minutes <= 15:
        lines.append(f"{n}. Wait about {minutes} min, then open it ready for review.")
    return "\n".join(lines)


def capacity(opts: argparse.Namespace, now: dt.datetime, api: Optional[Api] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION, "state": "unknown", "action": opts.action, "repo": None, "branch": None,
        "minutes_until_review": None, "refused_pull_requests": [], "branch_pr": None,
        "context": "", "cache": "none", "api_calls": 0,
    }
    end = time.monotonic() + opts.deadline   # one budget for git, gh and the API alike

    def left() -> float:
        return min(3.0, end - time.monotonic())

    api = api or Api(deadline=end)
    try:
        if opts.repo and not valid_repo(opts.repo):
            out["error"] = "--repo is not OWNER/NAME"
            return out
        repo = opts.repo or repo_from_remote(git_output(opts.cwd, "remote", "get-url", "origin", timeout=left()) or "")
        out["repo"] = repo
        if not repo:
            out["error"] = "no github.com remote"
            return out
        branch = opts.branch or git_output(opts.cwd, "symbolic-ref", "--short", "HEAD", timeout=left())
        out["branch"] = branch
        path = _cache_path(opts.cache_dir, repo) if opts.cache_dir else None
        sample = _read_cache(path, now, opts.cache_minutes) if path else None
        if sample is not None:
            out["cache"] = "hit"
        else:
            sample = sample_repo(api, repo, now, opts)
            out["cache"] = "miss"
            if path:
                _write_cache(path, sample, now)
        out["api_calls"] = api.calls
        waiting = []
        for rec in sample["blocked"]:
            left = math.ceil((parse_time(rec["ready_at"]) - now).total_seconds() / 60)
            if left > 0:
                waiting.append((left, rec["number"]))
        branch_pr = next(({"number": p["number"], "draft": p["draft"]} for p in sample["prs"] if p["head_ref"] == branch), None)
        out["branch_pr"] = branch_pr
        out["state"] = "limited" if waiting else "available"
        if waiting:
            minutes = min(w[0] for w in waiting)
            others = [p["number"] for p in sample["prs"] if not p["draft"] and p["head_ref"] != branch][:3]
            out["minutes_until_review"] = minutes
            out["refused_pull_requests"] = sorted(w[1] for w in waiting)
            out["context"] = advise(opts.action, repo, minutes, len(waiting), branch_pr, others)
    except Exception as err:  # noqa: BLE001 - a hint never raises
        out["state"] = "unknown"
        out["error"] = f"{type(err).__name__}: {err}"[:200]
        out["context"] = ""
        out["api_calls"] = api.calls
    return out


# ----------------------------------------------------------------------- covered


def covered(opts: argparse.Namespace, now: dt.datetime, api: Optional[Api] = None) -> Dict[str, Any]:
    """Is the head of ONE pull request reviewed by CodeRabbit, and would it be at all.

    Calls: 1 (the pull request, every time: the cache is keyed by its head) and,
    on a miss, the comments, the repository's .coderabbit.yaml (1, or 2 without
    one), the changed files only when path_filters decide, the reviews only when
    the summary comment carries no marker.
    """
    out: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION, "repo": opts.repo, "pr": opts.pr, "head": None,
        "last_reviewed": None, "last_reviewed_source": None,
        "eligible": "unknown", "reason": None, "covered": "unknown",
        "cache": "none", "api_calls": 0,
    }
    end = time.monotonic() + opts.deadline
    api = api or Api(deadline=end)
    try:
        if not valid_repo(opts.repo or ""):
            out["error"] = "--repo is not OWNER/NAME"
            return out
        owner = opts.repo.split("/")[0]
        pr = api.get(owner, f"/repos/{opts.repo}/pulls/{int(opts.pr)}")
        head = pr["head"]["sha"]
        out["head"] = head
        path = _cache_path(opts.cache_dir, f"covered/{opts.repo}/{opts.pr}/{head}") if opts.cache_dir else None
        cached = _read_cache(path, now, opts.cache_minutes) if path else None
        if cached is not None:
            out.update(cached)
            out["cache"] = "hit"
        else:
            comments = api.paginate(owner, f"/repos/{opts.repo}/issues/{int(opts.pr)}/comments")
            try:
                policy = load_policy(opts.policy_dir, owner)
            except (OSError, YamlError, ValueError) as err:
                policy = None
                out["error"] = f"policy: {type(err).__name__}: {err}"[:200]
            res = coverage(api, opts.repo, pr, comments, policy)
            out.update(res)
            out["cache"] = "miss"
            if path and "error" not in out and out["eligible"] != "unknown":
                _write_cache(path, {k: out[k] for k in ("last_reviewed", "last_reviewed_source", "eligible", "reason", "covered")}, now)
    except Exception as err:  # noqa: BLE001 - an answer, never a traceback
        out["error"] = f"{type(err).__name__}: {err}"[:200]
    out["api_calls"] = api.calls
    return out


# --------------------------------------------------------------------------- CLI


def add_policy_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--buffer-minutes", type=int, default=DEFAULT_BUFFER_MINUTES, help="cushion past the announced delay (default %(default)s)")
    p.add_argument("--unknown-wait-minutes", type=int, default=DEFAULT_UNKNOWN_WAIT_MINUTES, help="delay assumed when none is announced (default %(default)s)")
    p.add_argument("--stale-minutes", type=int, default=DEFAULT_STALE_MINUTES, help="a relaunch unanswered after this is lost (default %(default)s)")
    p.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS, help="unanswered relaunches before giving up on a PR (default %(default)s)")
    p.add_argument("--head-cap", type=int, default=DEFAULT_HEAD_CAP, help="commands of any origin on one head before it is left alone (default %(default)s)")
    p.add_argument("--push-quiet-minutes", type=int, default=DEFAULT_PUSH_QUIET_MINUTES, help="an uncovered head is relaunched only this long after its push (default %(default)s)")
    p.add_argument("--policy-dir", help="directory of settings.yaml and override-<owner>.yaml; without it no uncovered head is ever relaunched")
    p.add_argument("--now", help="ISO UTC instant to use as now (tests), e.g. 2026-11-08T10:00:00Z")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("probe", help="print the blocked pull requests as JSON")
    p.add_argument("--repo", action="append", default=[], metavar="OWNER/NAME", help="repository to scan (repeatable)")
    p.add_argument("--owner", action="append", default=[], metavar="OWNER", help="scan every repository of this owner that has an open PR (repeatable)")
    p.add_argument("--exclude", default=DEFAULT_EXCLUDE, help="regex of repositories to skip (default %(default)r; empty keeps all)")
    add_policy_args(p)
    c = sub.add_parser("capacity", help="is CodeRabbit rate limited on this repository, and what to do before the action")
    c.add_argument("--action", choices=("pr_create", "push"), required=True)
    c.add_argument("--cwd", default=".", help="directory whose origin remote and branch are read")
    c.add_argument("--repo", help="OWNER/NAME, instead of the origin remote of --cwd")
    c.add_argument("--branch", help="branch, instead of the one checked out in --cwd")
    c.add_argument("--cache-dir", default="", help="directory of the per-repository cache (none: no cache)")
    c.add_argument("--cache-minutes", type=int, default=DEFAULT_CACHE_MINUTES)
    c.add_argument("--recent", type=int, default=DEFAULT_RECENT, help="open non-draft PRs read per refresh")
    c.add_argument("--window-hours", type=int, default=DEFAULT_WINDOW_HOURS, help="ignore PRs not updated within this")
    c.add_argument("--deadline", type=float, default=DEFAULT_DEADLINE_SECONDS, help="seconds the whole call may take")
    add_policy_args(c)
    v = sub.add_parser("covered", help="the commit CodeRabbit last reviewed on a pull request, and whether it would review it")
    v.add_argument("--repo", required=True, metavar="OWNER/NAME")
    v.add_argument("--pr", required=True, type=int, metavar="N")
    v.add_argument("--policy-dir", help="directory of settings.yaml and override-<owner>.yaml (none: eligible is unknown)")
    v.add_argument("--cache-dir", default="", help="directory of the cache, keyed by repository, PR and head (none: no cache)")
    v.add_argument("--cache-minutes", type=int, default=DEFAULT_CACHE_MINUTES)
    v.add_argument("--deadline", type=float, default=DEFAULT_DEADLINE_SECONDS, help="seconds the whole call may take")
    v.add_argument("--now", help="ISO UTC instant to use as now (tests)")
    r = sub.add_parser("relaunch", help="post the command on the candidates of a probe document")
    r.add_argument("--input", default="-", help="probe JSON file, '-' for stdin (default)")
    r.add_argument("--dry-run", action="store_true", help="re-check and report, post nothing")
    r.add_argument("--delay", type=float, default=5.0, help="seconds between two posts")
    add_policy_args(r)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    opts = build_parser().parse_args(argv)
    now = parse_time(opts.now) if opts.now else dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    if opts.command in ("capacity", "covered"):
        # Fail open by contract: whatever happens, one JSON document and exit 0.
        json.dump((capacity if opts.command == "capacity" else covered)(opts, now), sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    api = Api()
    if opts.command == "probe":
        if not opts.repo and not opts.owner:
            print("probe: give at least one --repo or --owner", file=sys.stderr)
            return 2
        for repo in opts.repo:
            if not valid_repo(repo):
                print(f"probe: '{repo}' is not OWNER/NAME", file=sys.stderr)
                return 2
        doc = probe(api, opts.repo, opts.owner, now, opts)
        json.dump(doc, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
        # Total failure (nothing scanned, only errors) is the one non-zero exit.
        return 1 if doc["errors"] and doc["scanned"]["repos"] == 0 else 0
    text = sys.stdin.read() if opts.input == "-" else open(opts.input, encoding="utf-8").read()
    return relaunch(api, json.loads(text), now, opts)


if __name__ == "__main__":
    sys.exit(main())
