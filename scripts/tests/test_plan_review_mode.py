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

# Evidence a reviewer can produce without leaving read-only: a read at a
# revision and a measurement under the brief's scratch directory, never a write
# in the reviewed repository.
check("canonical text accepts a read at a revision", canon is not None and "`path@rev`" in canon)
check("canonical text bounds writes to the brief's scratch directory",
      canon is not None and "scratch directory the brief names" in canon and "read-only on the reviewed repository" in canon)
# Round N must be able to judge how round N-1 was answered: the objection text,
# not its ID alone.
check("debate.md brief carries prior objections with their text",
      "Prior objections" in brief and all(f in brief for f in ("ID, claim verbatim", "remedy", "disposition")))
check("debate.md brief names a scratch directory", "Scratch directory: <$SCRATCH>" in brief and "mktemp -d" in brief)
check("debate.md brief names the project records", "Project records:" in brief)
# kodflow/claude-marketplace#107. Sources that settle a technology claim are
# named per topic before round 1, and a topic with none blocks dispatch.
check("debate.md brief carries the reference sources", "Reference sources:" in brief
      and "topic — URL or path" in brief and "A topic with no entry blocks dispatch" in brief)
check("debate.md ties a technology objection to a reference source",
      "A technology objection cites at least one reference source" in brief
      and "names the topic the list does not cover" in brief)
check("debate.md triage adds a justified outside source to the list",
      "add that source to the list for the next" in brief)
# Each reviewer gets back its own numbering against the triage IDs, merged
# objections included, and answers by triage ID.
check("debate.md brief hands each reviewer its triage ID table",
      "| triage ID | your local number | round |" in brief and "merged ones included" in brief
      and "one verdict per triage ID" in brief)
check("debate.md triage records the local number and keeps merged ones",
      "that reviewer's local\nnumber" in brief and "keeps every contributing reviewer and local number" in brief)
# A count, not a length: a word limit cannot hold the six fields.
check("debate.md brief states the objection budget",
      "At most 8 objections, each with the six fields" in brief
      and '"at most 8\nobjections, each with the six fields"' in brief)
check("debate.md forbids a word or character limit",
      "no brief sets a word or character\nlimit" in brief
      and "| Set a word or character limit on a reviewer's response | **FORBIDDEN**" in brief)
check("debate.md has no word limit left", re.search(r"\b\d+\s*(?:-|–|to)?\s*\d*\s*words\b", brief) is None)
sys.exit(1 if fails else 0)
