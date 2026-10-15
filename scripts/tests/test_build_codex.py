#!/usr/bin/env python3
"""build-codex.py must delete the output whose source is gone.

Generating without pruning is invisible to a diff-based freshness check:
nothing changes, something merely fails to disappear, and a deleted skill
stays installed for ever. So the deletion is what this exercises — against a
fixture seeded with stale files, a stale directory, and a stale agent, plus
live ones that must survive untouched.
"""
import pathlib, subprocess, sys, tempfile

GEN = pathlib.Path(__file__).resolve().parents[1] / "build-codex.py"

SKILL = "---\nname: {n}\ndescription: A skill named {n}.\nmodel: haiku\n---\n\nBody of {n}.\n"
AGENT = "---\nname: {n}\ndescription: An agent named {n}.\nmodel: sonnet\n---\n\nInstructions for {n}.\n"

def write(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)

def main():
    root = pathlib.Path(tempfile.mkdtemp())

    # --- sources ---
    plug = root / "plugins" / "kodflow-demo"
    for n in ("alpha", "beta"):
        write(plug / "skills" / n / "SKILL.md", SKILL.format(n=n))
    write(plug / "skills" / "alpha" / "helper.md", "a support file\n")
    write(plug / "agents" / "keeper.md", AGENT.format(n="keeper"))
    # The agent's own effort, not the tier's: as written, and max as xhigh
    write(plug / "agents" / "deep.md", "---\nname: deep\ndescription: d.\nmodel: opus\neffort: xhigh\n---\n\nx\n")
    write(plug / "agents" / "maxed.md", "---\nname: maxed\ndescription: d.\nmodel: opus\neffort: max\n---\n\nx\n")
    write(plug / "agents" / "cheap.md", "---\nname: cheap\ndescription: d.\nmodel: haiku\neffort: medium\n---\n\nx\n")

    # --- output left over from a previous run whose sources are gone ---
    codex = root / "codex"
    write(codex / "skills" / "removed" / "SKILL.md", "stale skill\n")
    write(codex / "skills" / "removed" / "nested" / "deep.md", "stale nested file\n")
    write(codex / "skills" / "alpha" / "orphan.md", "support file deleted at source\n")
    write(codex / "agents" / "retired.toml", 'name = "retired"\n')

    r = subprocess.run([sys.executable, str(GEN), str(root)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("generator failed:\n" + r.stderr)
        return 1

    cases = [
        ("a skill with a source survives",        codex / "skills" / "alpha" / "SKILL.md", True),
        ("a second skill survives",               codex / "skills" / "beta" / "SKILL.md",  True),
        ("a support file with a source survives", codex / "skills" / "alpha" / "helper.md", True),
        ("an agent with a source survives",       codex / "agents" / "keeper.toml",        True),
        ("a skill whose source is gone is removed",   codex / "skills" / "removed" / "SKILL.md", False),
        ("its nested file goes with it",              codex / "skills" / "removed" / "nested" / "deep.md", False),
        ("the emptied directory is removed",          codex / "skills" / "removed",        False),
        ("a support file deleted at source is removed", codex / "skills" / "alpha" / "orphan.md", False),
        ("an agent whose source is gone is removed",  codex / "agents" / "retired.toml",   False),
    ]
    ok = 0
    for label, path, want in cases:
        if path.exists() == want:
            ok += 1
        else:
            print(f"FAIL {label}\n  {path} exists={path.exists()}, expected {want}")

    # The marker is what the installer keys on to retire a file it produced.
    marker = (codex / "agents" / "keeper.toml").read_text().splitlines()[0]
    if marker.startswith("# generated-from: plugins/*/agents/"):
        ok += 1
    else:
        print(f"FAIL generated agents carry the marker\n  first line: {marker!r}")

    efforts = [("deep", "xhigh"), ("maxed", "xhigh"), ("cheap", "medium"), ("keeper", "medium")]
    for name, want in efforts:
        text = (codex / "agents" / f"{name}.toml").read_text()
        if f'model_reasoning_effort = "{want}"' in text:
            ok += 1
        else:
            print(f"FAIL {name}.toml carries effort {want}\n  {[l for l in text.splitlines() if 'effort' in l]}")

    total = len(cases) + 1 + len(efforts)
    print(f"build-codex: {ok}/{total} pruning and effort cases correct")
    return 0 if ok == total else 1

if __name__ == "__main__":
    sys.exit(main())
