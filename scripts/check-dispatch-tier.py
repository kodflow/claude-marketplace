#!/usr/bin/env python3
"""check-dispatch-tier.py -- every dispatch site in the skills and agents states
its model and its effort (model-policy.md section 2), or says why not.

WHY: the hazard the policy exists for is silent inheritance. A dispatch to a
built-in agent (general-purpose, Explore, Plan, claude, workflow-subagent) has no
frontmatter of ours, so a call that omits `model` and `effort` runs on the
orchestrator's model at the session's effort, and nothing in the output says so.
Callers are instructions written in markdown; this gate reads them.

A dispatch site is, in a canonical file (plugins/*/skills/**, plugins/*/agents/**
-- the `_shared` mirrors of kodflow-devops and kodflow-review are copies and are
skipped; the canonical copy is kodflow-workflow's):
  1. a `subagent_type` key whose value is a built-in agent;
  2. an `Agent(` or `Task(` call form;
  3. a dispatch verb (dispatch, spawn, launch) tied to a backticked built-in name
     in the same sentence;
  4. `agent(` inside a fenced js/ts block (a Workflow script);
  5. an `agent: "<built-in>"` key, or a built-in named as an agent ("Explore
     agents", "a general-purpose agent") in a sentence with a delegation verb
     (dispatch, spawn, launch, route, give, hand, delegate, send, run).
A call form naming a kodflow-specialists agent is not a site: those definitions
pin model and effort in their frontmatter, so the call passes nothing more
(section 2).
Headings, table rows, `/plan`, `terraform plan` and "Plan review mode" are not
sites. The site's unit is its fenced block, or its blank-line-delimited
paragraph (a list item counts with its continuation lines).

A site passes when its unit carries both `model` and `effort`, or points to the
tier table / model-policy section 2 for both, or carries a
`[tier-exempt: <reason>]` marker. Markers are capped (MAX_EXEMPT).
model-policy.md and specialists.md are allowlisted: they define the table and
the routing, they do not dispatch.

Sites flagged on origin/main 4b37bc2, before the fixes of the commit that added
this script: 13 (0 after).

Usage: check-dispatch-tier.py [--list] [ROOT]    exit 0 clean, 1 on any flagged site
"""
import pathlib
import re
import sys

MAX_EXEMPT = 3
BUILTINS = r"(?:general-purpose|Explore|Plan|claude|workflow-subagent)"
ALLOWLIST = {"model-policy.md", "specialists.md"}
MIRROR_PLUGINS = {"kodflow-devops", "kodflow-review"}

KEY = re.compile(r"""subagent_type["'`]?\s*[:=]\s*["'`]?""" + BUILTINS + r"""\b""")
CALL = re.compile(r"(?<![\w`])(?:Agent|Task)\((?!s\))")
VERB = re.compile(r"\b(?:dispatch|spawn|launch)\w*", re.I)
VERB_PROSE = re.compile(r"\b(?:dispatch|spawn|launch|route|give|hand|delegate|send|run)\w*", re.I)
NAME = re.compile(r"`" + BUILTINS + r"`")
NAME_PROSE = re.compile(r"\b(?:general-purpose|Explore|Plan|claude) (?:sub)?agents?\b")
AGENT_KEY = re.compile(r"""^\s*agent\s*:\s*["']?""" + BUILTINS + r"\b")
JS_AGENT = re.compile(r"(?<![\w.])agent\(")
JS_LANG = {"js", "javascript", "ts", "typescript", "mjs"}
HAS_MODEL = re.compile(r"\bmodel\b", re.I)
HAS_EFFORT = re.compile(r"\beffort\b", re.I)
POINTER = re.compile(r"tier[- ]table|model-policy(?:\.md)?\s*(?:§|section)\s*2", re.I)
EXEMPT = re.compile(r"\[tier-exempt:\s*[^\]]+\]")
FENCE = re.compile(r"^\s*(```+|~~~+)\s*(\w*)")


def canonical(root):
    for p in sorted(root.glob("plugins/*/*/**/*.md")):
        parts = p.relative_to(root).parts
        plugin, kind = parts[1], parts[2]
        if kind not in ("skills", "agents"):
            continue
        if kind == "skills" and len(parts) > 3 and parts[3] == "_shared" and plugin in MIRROR_PLUGINS:
            continue
        if p.name in ALLOWLIST:
            continue
        yield p


def units(text):
    """Yield (start_line, lines, lang) per fenced block and per paragraph."""
    lines = text.splitlines()
    i, n = 0, len(lines)
    if lines and lines[0].strip() == "---":   # frontmatter lists tools, it dispatches nothing
        i = next((k for k in range(1, n) if lines[k].strip() == "---"), -1) + 1
    while i < n:
        m = FENCE.match(lines[i])
        if m:
            j = i + 1
            while j < n and not lines[j].lstrip().startswith(m.group(1)[:3]):
                j += 1
            yield i + 1, lines[i:j + 1], m.group(2).lower()
            i = j + 1
        elif not lines[i].strip():
            i += 1
        else:
            j = i
            while j < n and lines[j].strip() and not FENCE.match(lines[j]):
                j += 1
            yield i + 1, lines[i:j], None
            i = j


def specialists(root):
    return {p.stem for p in (root / "plugins/kodflow-specialists/agents").glob("*.md")}


SUBTYPE = re.compile(r"""subagent_type["'`]?\s*[:=]\s*["'`]?(?:kodflow-specialists:)?([\w-]+)""")


def pinned_call(line, pinned):
    """A call form whose subagent_type is a specialist: its frontmatter pins both."""
    m = SUBTYPE.search(line)
    return bool(m and m.group(1) in pinned)


def sites_in(unit_lines, lang, pinned=frozenset()):
    """Line offsets of dispatch sites in one unit."""
    hits = []
    for off, line in enumerate(unit_lines):
        s = line.lstrip()
        if lang is None and (s.startswith("#") or s.startswith("|")):
            continue
        if KEY.search(line) or AGENT_KEY.search(line) or (
                CALL.search(line) and not pinned_call(line, pinned)):
            hits.append(off)
        elif lang in JS_LANG and JS_AGENT.search(line):
            hits.append(off)
    if lang not in JS_LANG:
        text = " ".join(l for l in unit_lines
                        if not l.lstrip().startswith(("#", "|")) and not FENCE.match(l))
        for sent in re.split(r"(?<=[.!?:;])\s+", text):
            if (VERB.search(sent) and NAME.search(sent)) or (
                    VERB_PROSE.search(sent) and NAME_PROSE.search(sent)):
                hits.append(0)
                break
    return hits


def scan(root):
    """Return (flagged, exempt_count). flagged: [(path, line, why)]."""
    flagged, exempt = [], 0
    pinned = specialists(root)
    for p in canonical(root):
        rel = p.relative_to(root)
        for start, ul, lang in units(p.read_text(encoding="utf-8")):
            hits = sites_in(ul, lang, pinned)
            if not hits:
                continue
            blob = "\n".join(ul)
            if EXEMPT.search(blob):
                exempt += 1
                continue
            if POINTER.search(blob) or (HAS_MODEL.search(blob) and HAS_EFFORT.search(blob)):
                continue
            missing = [w for w, r in (("model", HAS_MODEL), ("effort", HAS_EFFORT)) if not r.search(blob)]
            flagged.append((str(rel), start + hits[0], "no " + " / ".join(missing)))
    return flagged, exempt


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    root = pathlib.Path(args[0] if args else ".").resolve()
    flagged, exempt = scan(root)
    for path, line, why in flagged:
        print(f"{path}:{line}: dispatch site with {why}")
    if exempt > MAX_EXEMPT:
        print(f"{exempt} [tier-exempt] markers, the cap is {MAX_EXEMPT}")
        return 1
    print(f"{len(flagged)} flagged, {exempt} exempt (cap {MAX_EXEMPT})")
    return 1 if flagged else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
