#!/usr/bin/env python3
"""Copy the canonical Plan review mode into every agent that carries it.

An invoked agent does not receive the shared files, so the section lives in
the body of each agent (scripts/tests/test_plan_review_mode.py checks the
copies). The canonical text is the section of
plugins/kodflow-workflow/skills/_shared/specialists.md; this script is how it
reaches the copies, so nobody edits 38 files by hand:

- every agent file under plugins/*/agents that has a `## Plan review mode`
  heading gets the canonical section in place of its own, wherever the
  section sits (in the middle of the file or at its end);
- the two mirrors of _shared/specialists.md (kodflow-review, kodflow-devops)
  get the canonical file whole, as CI's `diff -r` of the _shared trees wants.

    python3 scripts/sync_plan_review_mode.py [root]           write the copies
    python3 scripts/sync_plan_review_mode.py --check [root]   exit 1 when one is stale

The test keeps its own enumeration on purpose: a bug here cannot hide itself.
"""
import pathlib, sys

CANON = "plugins/kodflow-workflow/skills/_shared/specialists.md"
MIRRORS = ("plugins/kodflow-review/skills/_shared/specialists.md",
           "plugins/kodflow-devops/skills/_shared/specialists.md")
HEAD = "## Plan review mode\n"


def span(text):
    """(start, end) of the section in text, heading included, or None.

    The section runs from its heading to the next `## ` heading or the end of
    the file; trailing blank lines are not part of it."""
    i = text.find("\n" + HEAD)
    if i < 0:
        return None
    i += 1
    j = text.find("\n## ", i + len(HEAD))
    j = len(text) if j < 0 else j + 1
    body = text[i:j].rstrip()
    return i, i + len(body)


def section(text):
    s = span(text)
    return None if s is None else text[s[0]:s[1]]


def with_section(text, canon):
    """text with its section replaced by canon; text unchanged if it has none."""
    s = span(text)
    if s is None:
        return text
    return text[:s[0]] + canon + text[s[1]:]


def targets(root):
    """The agent files that carry the section."""
    for f in sorted(root.glob("plugins/*/agents/*.md")):
        if span(f.read_text()) is not None:
            yield f


def plan(root):
    """[(path, wanted text)] for every file this script owns."""
    root = pathlib.Path(root)
    src = (root / CANON).read_text()
    canon = section(src)
    if canon is None:
        raise ValueError(f"{CANON} has no {HEAD.strip()} section")
    out = [(root / m, src) for m in MIRRORS if (root / m).parent.is_dir()]
    out += [(f, with_section(f.read_text(), canon)) for f in targets(root)]
    return out


def main(argv):
    check = "--check" in argv
    args = [a for a in argv if a != "--check"]
    root = pathlib.Path(args[0] if args else ".")
    try:
        todo = plan(root)
    except (OSError, ValueError) as e:
        print(f"sync_plan_review_mode: {e}", file=sys.stderr)
        return 1
    stale = [p for p, want in todo if not p.is_file() or p.read_text() != want]
    if check:
        for p in stale:
            print(f"stale: {p.relative_to(root)}", file=sys.stderr)
        if stale:
            print("run python3 scripts/sync_plan_review_mode.py", file=sys.stderr)
            return 1
        print(f"plan review mode in sync ({len(todo)} files)")
        return 0
    for p in stale:
        p.write_text(dict(todo)[p])
    print(f"wrote {len(stale)} of {len(todo)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
