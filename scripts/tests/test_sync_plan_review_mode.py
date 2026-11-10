#!/usr/bin/env python3
"""sync_plan_review_mode.py replaces the section wherever it sits, and only it.

A copy in the middle of an agent file must keep the sections after it; a copy
at the end must not swallow or add anything; a file without the section is
left alone; the _shared mirrors receive the canonical file; --check fails on
any drift and passes right after a sync.
"""
import pathlib, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
GEN = ROOT / "scripts" / "sync_plan_review_mode.py"
sys.path.insert(0, str(ROOT / "scripts"))
import sync_plan_review_mode as sync  # noqa: E402

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" — {detail}"))
    fails += 0 if ok else 1


def run(root, *args):
    return subprocess.run([sys.executable, str(GEN), *args, str(root)], capture_output=True, text=True)


NEW = "## Plan review mode\n\nNew rule.\n\n- one\n- two"
root = pathlib.Path(tempfile.mkdtemp())
for d in ("kodflow-workflow", "kodflow-review", "kodflow-devops"):
    (root / f"plugins/{d}/skills/_shared").mkdir(parents=True)
(root / sync.CANON).write_text("# Specialists\n\n## Plan review, one contract\n\nprose\n\n" + NEW + "\n")
(root / sync.MIRRORS[0]).write_text("old mirror\n")
agents = root / "plugins/kodflow-specialists/agents"
agents.mkdir(parents=True)
mid = agents / "mid.md"
mid.write_text("---\nname: mid\n---\n\n# Mid\n\n## Plan review mode\n\nOld rule.\n\n## Role\n\nKept.\n")
end = agents / "end.md"
end.write_text("---\nname: end\n---\n\n# End\n\n## Plan review mode\n\nOld rule.\n- old\n\n\n")
none = agents / "none.md"
none.write_text("---\nname: none\n---\n\n# None\n\n## Role\n\nNo section.\n")
gd = root / "plugins/kodflow-gamedev/agents"
gd.mkdir(parents=True)
(gd / "g.md").write_text("# G\n\n## Plan review mode\n\nOld.\n")

check("--check fails before a sync", run(root, "--check").returncode == 1)
r = run(root)
check("sync runs", r.returncode == 0, r.stderr)
check("a section in the middle is replaced, the next section kept",
      mid.read_text() == "---\nname: mid\n---\n\n# Mid\n\n" + NEW + "\n\n## Role\n\nKept.\n", repr(mid.read_text()))
check("a section at the end is replaced, the file ending kept",
      end.read_text() == "---\nname: end\n---\n\n# End\n\n" + NEW + "\n\n\n", repr(end.read_text()))
check("a file without the section is left alone", "No section." in none.read_text() and "New rule" not in none.read_text())
check("another plugin's agents are covered", sync.section((gd / "g.md").read_text()) == NEW)
check("the mirrors receive the canonical file",
      all((root / m).read_text() == (root / sync.CANON).read_text() for m in sync.MIRRORS))
check("--check passes right after a sync", run(root, "--check").returncode == 0)
check("a second sync writes nothing", "wrote 0 of" in run(root).stdout)
mid.write_text(mid.read_text().replace("New rule.", "Drifted rule."))
check("--check fails on a drifted copy", run(root, "--check").returncode == 1)
(root / sync.CANON).write_text("# no section\n")
check("a canonical file without the section is refused", run(root).returncode == 1)

# The repository itself is in sync
r = run(ROOT, "--check")
check("the repository's copies are in sync", r.returncode == 0, r.stderr.strip())

print(f"{fails} failure(s)")
sys.exit(1 if fails else 0)
