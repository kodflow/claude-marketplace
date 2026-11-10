#!/usr/bin/env python3
"""collect.py -- the agent feedback kodflow-hooks kept, grouped by the file it is about.

kodflow-hooks (hooks/scripts/lib/feedback.sh, at SubagentStop) appends one
line per subagent report to <config>/kodflow/sessions/<session>/agent-feedback.jsonl.
This reads those files, one session or all of them, and prints one JSON object
per target on stdout: the marketplace file the feedback is about, how often and
in how many sessions it was said, and each distinct text once.

Its output is for the local session only. It carries session ids, paths and the
subagents' own words, none of which may reach a public tree (SKILL.md, "What
never leaves the machine").

Target, most specific first:
  1. the record's definition, when it lies in the kodflow plugin cache;
  2. an agent type namespaced by a kodflow plugin (kodflow-x:name);
  3. for an agent with no kodflow definition (a built-in, a fork), the first
     marketplace file the text names that exists in --tree: a path under
     plugins/, a plugin:skill name, a /skill command, then a bare plugin name.
     The kind is skill, agent, hook (anything under kodflow-hooks) or plugin.
     Without --tree, or with no match, the kind is "brief": nothing to diff.
An agent defined outside kodflow is kind "external": its owner changes it.

  collect.py [--config DIR] [--session SID] [--since DAYS] [--agent TYPE]
             [--target PREFIX] [--tree DIR] [--handled FILE]
  collect.py --handled FILE --mark KEY=VERDICT [--mark ...]

Exit 0, also when there is nothing to report (no output line). Exit 2 on a
usage error. A malformed line is counted on stderr, never fatal.
"""
import argparse
import collections
import datetime
import hashlib
import json
import os
import pathlib
import re
import sys
import time

CACHE = re.compile(r"/plugins/cache/kodflow/([a-z0-9-]+)/[^/]+/(agents|skills)/(.+)$")
NAMESPACED = re.compile(r"^(kodflow-[a-z0-9-]+):([a-z0-9][a-z0-9-]*)$")
PATH_REF = re.compile(r"\bplugins/(kodflow-[a-z0-9-]+)/[A-Za-z0-9_./-]*[A-Za-z0-9_-]")
PREFIXED = re.compile(r"\b(kodflow-[a-z0-9-]+):([a-z0-9][a-z0-9-]*)\b")
SLASH = re.compile(r"(?<![\w/.~-])/([a-z][a-z0-9-]+)\b")
PLUGIN = re.compile(r"\b(kodflow-[a-z0-9-]+)\b")
VERDICTS = {"fixed", "open", "out-of-scope", "delivered", "declined"}


def norm(text):
    """The text a duplicate shares: case, punctuation and spacing dropped."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def key_of(target, text):
    return hashlib.sha1((target + "\n" + norm(text)).encode()).hexdigest()[:12]


def tree_target(tree, text):
    """The first marketplace file the text names that exists in the tree."""
    if tree is None:
        return None
    for m in PATH_REF.finditer(text):
        p = m.group(0).rstrip(".")
        if (tree / p).exists():
            return p
    for m in PREFIXED.finditer(text):
        plugin, name = m.groups()
        for rel in (f"plugins/{plugin}/skills/{name}/SKILL.md", f"plugins/{plugin}/agents/{name}.md"):
            if (tree / rel).is_file():
                return rel
    for m in SLASH.finditer(text):
        hits = sorted(tree.glob(f"plugins/*/skills/{m.group(1)}/SKILL.md"))
        if len(hits) == 1:
            return str(hits[0].relative_to(tree))
    for m in PLUGIN.finditer(text):
        if (tree / "plugins" / m.group(1)).is_dir():
            return f"plugins/{m.group(1)}/"
    return None


def resolve(rec, tree):
    """(kind, target, owner) for one record."""
    definition = rec.get("definition") or ""
    m = CACHE.search(definition)
    if m:
        plugin, sub, rest = m.groups()
        return ("agent" if sub == "agents" else "skill"), f"plugins/{plugin}/{sub}/{rest}", "kodflow"
    m = NAMESPACED.match(rec.get("agent_type") or "")
    if m:
        return "agent", f"plugins/{m.group(1)}/agents/{m.group(2)}.md", "kodflow"
    if definition:
        return "external", definition, rec.get("owner") or "local"
    target = tree_target(tree, rec.get("feedback") or "")
    if target:
        kind = ("skill" if "/skills/" in target else "agent" if "/agents/" in target
                else "hook" if target.startswith("plugins/kodflow-hooks/") else "plugin")
        return kind, target, "kodflow"
    return "brief", "", "local"


def load_handled(path):
    handled = {}
    if path and path.is_file():
        for line in path.read_text().splitlines():
            parts = line.split("\t")
            if len(parts) >= 2 and parts[0]:
                handled[parts[0]] = parts[1]
    return handled


def mark(path, pairs):
    path.parent.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().isoformat()
    with path.open("a") as out:
        for pair in pairs:
            key, _, verdict = pair.partition("=")
            if not re.fullmatch(r"[0-9a-f]{12}", key) or verdict not in VERDICTS:
                sys.exit(f"--mark {pair!r}: want <12 hex>=<{'|'.join(sorted(VERDICTS))}>")
            out.write(f"{key}\t{verdict}\t{today}\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--config", default=os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude"))
    ap.add_argument("--session")
    ap.add_argument("--since", type=float, help="days")
    ap.add_argument("--agent", help="agent type, exact")
    ap.add_argument("--target", help="keep the targets starting with this prefix, e.g. plugins/kodflow-specialists/")
    ap.add_argument("--tree", help="a checkout of the marketplace, to attribute built-in agents' feedback")
    ap.add_argument("--handled", help="TSV ledger: key, verdict, date")
    ap.add_argument("--mark", action="append", default=[], metavar="KEY=VERDICT")
    a = ap.parse_args()

    handled_path = pathlib.Path(a.handled).expanduser() if a.handled else None
    if a.mark:
        if handled_path is None:
            ap.error("--mark needs --handled")
        mark(handled_path, a.mark)
        return 0

    sessions = pathlib.Path(a.config).expanduser() / "kodflow" / "sessions"
    files = [sessions / a.session / "agent-feedback.jsonl"] if a.session else sorted(sessions.glob("*/agent-feedback.jsonl"))
    tree = pathlib.Path(a.tree).expanduser() if a.tree else None
    if tree is not None and not (tree / "plugins").is_dir():
        ap.error(f"--tree {tree}: no plugins/ directory")
    floor = time.time() - a.since * 86400 if a.since else None
    handled = load_handled(handled_path)

    groups = collections.OrderedDict()
    bad = 0
    for f in files:
        if not f.is_file():
            continue
        for line in f.read_text(errors="replace").splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                bad += 1
                continue
            if not isinstance(rec, dict) or not isinstance(rec.get("feedback"), str) or not rec["feedback"].strip():
                bad += 1
                continue
            ts = rec.get("ts") if isinstance(rec.get("ts"), (int, float)) else 0
            if floor and ts < floor:
                continue
            if a.agent and rec.get("agent_type") != a.agent:
                continue
            kind, target, owner = resolve(rec, tree)
            if a.target and not target.startswith(a.target):
                continue
            text = rec["feedback"].strip()
            k = key_of(target or kind, text)
            if k in handled:
                continue
            g = groups.setdefault((kind, target), {
                "kind": kind, "target": target, "owner": owner, "count": 0,
                "sessions": set(), "agent_types": set(), "models": set(), "efforts": set(),
                "first": ts, "last": ts, "needs": collections.OrderedDict()})
            g["count"] += 1
            g["sessions"].add(rec.get("sid") or f.parent.name)
            for field, bucket in (("agent_type", "agent_types"), ("model", "models"), ("effort", "efforts")):
                if rec.get(field):
                    g[bucket].add(str(rec[field]))
            g["first"], g["last"] = min(g["first"], ts), max(g["last"], ts)
            need = g["needs"].setdefault(k, {"key": k, "count": 0, "text": text})
            need["count"] += 1

    if bad:
        print(f"collect.py: {bad} malformed line(s) skipped", file=sys.stderr)
    order = {"agent": 0, "skill": 1, "hook": 2, "plugin": 3, "brief": 4, "external": 5}
    for g in sorted(groups.values(), key=lambda g: (order[g["kind"]], -g["count"], g["target"])):
        for field in ("sessions",):
            g[field] = len(g[field])
        for field in ("agent_types", "models", "efforts"):
            g[field] = sorted(g[field])
        g["needs"] = sorted(g["needs"].values(), key=lambda n: -n["count"])
        print(json.dumps(g, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
