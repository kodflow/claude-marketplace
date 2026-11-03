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

# Plugins whose agents no routing table lists — a skill of theirs briefs them
# by subagent_type — carry the same section: every agent file of the plugin
# is read, so an agent added there is covered without touching this test.
for plugin in ("kodflow-gamedev",):
    files = sorted((ROOT / "plugins" / plugin / "agents").glob("*.md"))
    check(f"{plugin} has agents", len(files) > 0, "none found")
    for f in files:
        got = section(f.read_text())
        check(f"{plugin}:{f.stem} carries the section", got is not None)
        if got is not None:
            check(f"{plugin}:{f.stem} copy is identical", got == canon)

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
      "A technology objection cites in consulted at least one reference\nsource that substantiates the claim" in brief
      and "a cited\nentry that does not say what the objection says is no evidence" in brief
      and "citing no source, listed or outside,\nthat substantiates it" in brief)
check("debate.md triage adds a substantiating outside source to the list, covered topic or not",
      "add that source to the list for\nthe next round" in brief
      and "whether the list covers that topic or not" in brief)
# A reviewer reporting an accepted fix as wrong reopens that ID before the
# convergence check, or the run converges with the defect still there.
check("debate.md reopens a negative prior-objection verdict under its ID",
      "Negative verdicts reopen, under their existing IDs." in brief
      and "A negative verdict reopens that\nID" in brief
      and "**no accepted objection**, new or reopened" in brief)
# Codex answers the same contract only if it is handed the same brief.
check("debate.md feeds Codex the complete reviewer brief",
      '< "$SCRATCH/codex-brief-r$ROUND.md"' in brief and "< plan.md" not in brief
      and "The **complete reviewer brief** goes in on **stdin**" in brief)
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
# kodflow/claude-marketplace#111, #112, #115, #116. The toolchain checklist
# binds a code change only; author-derived data is labelled; a GitHub source is
# read without a browser and cited at a tag; round N judges from the brief, not
# from history; an agent may give a fallback when no scratch directory is named.
check("canonical text scopes the toolchain checklist to a code change",
      canon is not None and "applies to a code change; a review of a plan, prose or issue drafts runs the caller's checks only" in canon)
check("canonical text labels author-derived measurements",
      canon is not None and '"author-derived, raw source not re-read"' in canon)
check("canonical text reads GitHub without Claude in Chrome and cites at a tag",
      canon is not None and "`mcp__github__*`" in canon and "Never through Claude in Chrome" in canon
      and "`<owner>/<repo>:<path>@<tag>`" in canon)
check("canonical text judges round N from the brief, not from history",
      canon is not None and "Never rebuild the earlier state from conversation history" in canon)
check("canonical text lets an agent section give a no-scratch fallback",
      canon is not None and "unless a section of this file gives a fallback for that case" in canon)
proto = (AGENTS / "developer-specialist-protobuf.md").read_text()
check("protobuf gives the mktemp fallback and its limits",
      "## Checks without a named scratch directory" in proto and "`mktemp -d` outside every repository" in proto
      and "When the brief forbids running anything, write nothing" in proto)
node = (AGENTS / "developer-specialist-nodejs.md").read_text()
check("nodejs runs a measurement script under the brief's scratch directory",
      "`node <scratch>/x.mjs`" in node and "symlink `node_modules`" in node)
rust = (AGENTS / "developer-specialist-rust.md").read_text()
check("rust reads GitHub through read-only gh and cites clippy at the toolchain tag",
      "`Bash(gh issue view:*)`" in rust and "GET only" in rust and "rust-lang/rust-clippy:<path>@rust-1.NN.0" in rust)
# kodflow/claude-marketplace#113 and #126: what the brief says about paths,
# revisions, measurements and the prior-objection verdict lines.
check("debate.md brief gives literal paths and how to test a patch",
      "A brief still carrying a\nplaceholder" in brief and "copy the source\ndirectory into the scratch directory" in brief
      and "| Dispatch a brief that still carries a placeholder path | **FORBIDDEN**" in brief)
check("debate.md brief names the revision and the measurement owner",
      "Revision: review the WORKING TREE" in brief and "(path@HEAD or path@worktree)" in brief
      and "Measurement: tools outside your Command scope" in brief
      and "**A measurement named under `unverified` may be yours to run.**" in brief)
check("debate.md fixes the prior-objection verdict line and the fix-introduced defect",
      "`<ID> — fixed | reopen — <reason>`" in brief
      and "introduced BY an accepted fix is a reopen of that ID, not a new objection" in brief)
check("debate.md hands round N the previous plan and triage files",
      "plan-r<N-1>.md" in brief and "`$SCRATCH/plan-r$ROUND.md`" in brief and "`$SCRATCH/triage-r$ROUND.md`" in brief)
check("canonical text gives a GitHub issue and release fallback, else the lookup to the caller",
      canon is not None and "`https://api.github.com/repos/<owner>/<repo>/issues/<n>`" in canon
      and "the exact lookup goes under `unverified` for the caller to run" in canon)
check("debate.md gives each reviewer its own scratch subdirectory",
      "Scratch directory: <$SCRATCH>/<reviewer>" in brief and "a subdirectory of its own" in brief)
check("debate.md runs a named measurement only in a sandbox or with explicit approval",
      "Where its\noutput goes is not enough." in brief and "makes\nno network request that changes state" in brief
      and "enforced read-only sandbox" in brief and "explicit approval of that command" in brief)
spec = SPEC.read_text()
check("specialists.md names the identity file the hook reads",
      "`KODFLOW_COMMIT_IDENTITY` names" in spec and "`KODFLOW_COMMIT_IDENTITY=off`" in spec)
check("specialists.md asks for literal paths and the commit identity",
      "**Give literal paths.**" in spec and "**Name the commit identity when the brief asks for a commit.**" in spec)
sys.exit(1 if fails else 0)
