#!/usr/bin/env python3
"""build-tier-table.py refuses what the hooks must never read, and the
committed copies are exactly what it writes.

The table is injected into every orchestrator and every delegating sub-agent:
a role dropped from the policy, a model outside the closed vocabulary or a
stale committed copy would silently teach the wrong tier. Each is planted in a
fixture and must exit 1.
"""
import pathlib, re, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
GEN = ROOT / "scripts" / "build-tier-table.py"
SRC = "plugins/kodflow-workflow/skills/_shared/model-policy.md"
OUTS = ("plugins/kodflow-hooks/hooks/tier-table.tsv",
        "plugins/kodflow-workflow/skills/_shared/tier-table.tsv")
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" — {detail}"))
    fails += 0 if ok else 1


def fixture(edit=None, drop=False):
    root = pathlib.Path(tempfile.mkdtemp())
    p = root / SRC
    p.parent.mkdir(parents=True)
    if not drop:
        text = (ROOT / SRC).read_text()
        p.write_text(edit(text) if edit else text)
    return root


def run(root, *args):
    return subprocess.run([sys.executable, str(GEN), *args, str(root)], capture_output=True, text=True)


# The committed copies are current, identical, and in the documented shape
r = run(ROOT, "--check")
check("committed copies match model-policy.md", r.returncode == 0, r.stderr.strip())
a, b = ((ROOT / o).read_text() for o in OUTS)
check("the two copies are byte-identical", a == b)
mirrors = [ROOT / f"plugins/{p}/skills/_shared/tier-table.tsv" for p in ("kodflow-devops", "kodflow-review")]
check("the _shared mirrors carry the same bytes", all(m.is_file() and m.read_text() == a for m in mirrors))
lines = a.splitlines()
import hashlib
want = "# sha256 " + hashlib.sha256((ROOT / SRC).read_bytes()).hexdigest()
check("header is the sha256 of the whole canonical policy", lines[0] == want, lines[0])
check("preamble carries the explicit-effort and Workflow sentences",
      any("explicitly asks for an effort" in l for l in lines) and any("replaces the built-in guidance" in l for l in lines))
rows = [l.split("\t") for l in lines if not l.startswith("#")]
check("four tab-separated cells per row", all(len(r) == 4 for r in rows), rows)
check("kinds are role|exempt|fork|mode", all(r[0] in ("role", "exempt", "fork", "mode") for r in rows))
roles = [r for r in rows if r[0] == "role"]
check("role rows stay in the closed vocabulary",
      all(r[2] in ("sonnet", "opus", "haiku") and r[3] in ("low", "medium", "high", "xhigh", "max") for r in roles))
check("orchestrator rendered without a placeholder",
      ["mode", "Orchestrator", "main session, not delegated", "high"] in rows and "CLAUDE_TOP_UNGATED" not in a)

# Refusals
r = run(fixture(drop=True))
check("absent policy: exit 1", r.returncode == 1 and "missing" in r.stderr, r.stderr)
r = run(fixture(lambda t: t.replace("| **Mechanical worker** | Sonnet |", "| **Fast worker** | Sonnet |")))
check("a role missing: exit 1", r.returncode == 1 and "Mechanical worker" in r.stderr, r.stderr)
r = run(fixture(lambda t: t.replace("| **Bulk / triage worker** | Haiku | `low` |", "| **Bulk / triage worker** | Gpt | `low` |")))
check("unknown model cell: exit 1", r.returncode == 1 and "gpt" in r.stderr, r.stderr)
r = run(fixture(lambda t: t.replace("| **Mechanical worker** | Sonnet | `low` |", "| **Mechanical worker** | Sonnet | `ultra` |")))
check("unknown effort cell: exit 1", r.returncode == 1 and "ultra" in r.stderr, r.stderr)
r = run(fixture(lambda t: t.replace("| Role | Model | Effort | Why this one |", "| Role | Model | Effort | Tier | Why this one |")
                .replace("|------|-------|--------|--------------|", "|------|-------|--------|------|--------------|")))
check("an extra column: exit 1", r.returncode == 1 and "columns" in r.stderr, r.stderr)
r = run(fixture(lambda t: t.replace("| `web-fetch` | exempt, with no default claimed for it |", "")))
check("an exemption dropped: exit 1", r.returncode == 1 and "web-fetch" in r.stderr, r.stderr)
r = run(fixture(lambda t: t.replace("A **fork** only", "A spoon only")))
check("the fork paragraph dropped: exit 1", r.returncode == 1 and "fork" in r.stderr, r.stderr)

# --check on a drifted or absent committed file
root = fixture()
r = run(root)
check("generation writes both copies", r.returncode == 0 and all((root / o).is_file() for o in OUTS), r.stderr)
check("--check passes right after", run(root, "--check").returncode == 0)
(root / OUTS[0]).write_text((root / OUTS[0]).read_text().replace("sonnet", "opus", 1))
r = run(root, "--check")
check("drifted committed file: --check exits 1", r.returncode == 1 and "stale" in r.stderr, r.stderr)
(root / OUTS[0]).unlink()
check("absent committed file: --check exits 1", run(root, "--check").returncode == 1)
shutil.rmtree(root)

print("FAILED" if fails else "all passed")
sys.exit(1 if fails else 0)
