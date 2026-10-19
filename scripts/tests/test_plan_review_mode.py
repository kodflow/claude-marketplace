#!/usr/bin/env python3
"""Every agent /challenge routes to carries the plan review mode, verbatim.

An invoked agent does not receive the shared files, so the contract lives in the
body of each agent. A routed agent without the section, or with a drifted copy,
would arbitrate between its own output format and the caller's by itself, which
is the defect this mode removes. The routed agents are read from the routing
table, so a new row is covered without touching this test.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = ROOT / "plugins/kodflow-workflow/skills/_shared/specialists.md"
AGENTS = ROOT / "plugins/kodflow-specialists/agents"
DEBATE = ROOT / "plugins/kodflow-workflow/skills/challenge/debate.md"
HEAD = "## Plan review mode\n"
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" - {detail}"))
    fails += 0 if ok else 1


def section(text):
    i = text.find("\n" + HEAD)
    if i < 0:
        return None
    i += 1
    j = text.find("\n## ", i + len(HEAD))
    return text[i:j if j >= 0 else len(text)].strip()


canon = section(SPEC.read_text())
check("canonical section exists in specialists.md", canon is not None)
for field in ("severity", "claim", "evidence", "remedy", "consulted", "unverified"):
    check(f"canonical text names {field}", canon is not None and f"`{field}`" in canon)

routed = sorted(set(re.findall(r"^\|.*\| `([a-z0-9-]+)` \|", SPEC.read_text(), re.M)))
routed = [a for a in routed if (AGENTS / f"{a}.md").exists()]
check("routing table yields agents", len(routed) >= 20, f"{len(routed)} found")
for a in routed:
    got = section((AGENTS / f"{a}.md").read_text())
    check(f"{a} carries the section", got is not None)
    if got is not None:
        check(f"{a} copy is identical", got == canon)

brief = DEBATE.read_text()
check("debate.md brief uses the Plan review mode marker", "Plan review\nmode" in brief or "Plan review mode" in brief)
check("debate.md names the six fields", all(f in brief for f in ("severity", "claim", "evidence", "remedy", "consulted", "unverified")))
sys.exit(1 if fails else 0)
