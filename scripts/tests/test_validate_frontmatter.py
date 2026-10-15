#!/usr/bin/env python3
"""validate-frontmatter.py refuses what the model policy forbids.

Three rules are new and each is one typo away from never firing: an effort
spelt `extra-high` would load as nothing, an agent pinned to a gated model
would run every spawn on it, and a missing gated list would pass every agent
as clean. So each is planted in a fixture and must be refused, next to the
shapes that must pass.
"""
import pathlib, subprocess, sys, tempfile

GEN = pathlib.Path(__file__).resolve().parents[1] / "validate-frontmatter.py"
GATED = "plugins/kodflow-workflow/skills/_shared/gated-models.txt"
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" — {detail}"))
    fails += 0 if ok else 1


def fixture(agent_fm="model: sonnet\neffort: medium\n", skill_fm="model: inherit\neffort: low\n", gated=True):
    root = pathlib.Path(tempfile.mkdtemp())
    a = root / "plugins/kodflow-demo/agents/demo.md"
    k = root / "plugins/kodflow-demo/skills/demo/SKILL.md"
    for p in (a, k):
        p.parent.mkdir(parents=True, exist_ok=True)
    a.write_text(f"---\nname: demo\ndescription: A demo agent.\n{agent_fm}---\n\nBody.\n")
    k.write_text(f"---\nname: demo\ndescription: A demo skill.\n{skill_fm}---\n\nBody.\n")
    if gated:
        g = root / GATED
        g.parent.mkdir(parents=True, exist_ok=True)
        g.write_text("# gated\nfable\n")
    return root


def run(root):
    r = subprocess.run([sys.executable, str(GEN), str(root)], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


rc, out = run(fixture())
check("a pinned agent and an inheriting skill pass", rc == 0, out)
for effort in ("low", "medium", "high", "xhigh", "max"):
    rc, out = run(fixture(agent_fm=f"model: opus\neffort: {effort}\n"))
    check(f"effort {effort} passes", rc == 0, out)
rc, out = run(fixture(agent_fm="model: claude-opus-5-5\neffort: high\n"))
check("a full model id passes", rc == 0, out)

for name, kw in (
    ("an agent effort outside the five levels", dict(agent_fm="model: sonnet\neffort: extra-high\n")),
    ("a skill effort outside the five levels", dict(skill_fm="model: inherit\neffort: hgh\n")),
    ("an unknown skill model", dict(skill_fm="model: gpt\neffort: low\n")),
    ("an agent pinned to fable", dict(agent_fm="model: fable\neffort: high\n")),
    ("an agent pinned to a full gated id", dict(agent_fm="model: claude-fable-5-1\neffort: high\n")),
    ("a tree without the gated list", dict(gated=False)),
):
    rc, out = run(fixture(**kw))
    check(f"refuses {name}", rc == 1, out)

rc, out = run(fixture(skill_fm="model: fable\neffort: high\ncontext: fork\n"))
check("a skill may name a gated model: the hooks gate it at run time", rc == 0, out)
rc, out = run(pathlib.Path(__file__).resolve().parents[2])
check("this repository passes", rc == 0, out)

print(f"{fails} failure(s)")
sys.exit(1 if fails else 0)
