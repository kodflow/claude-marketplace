#!/usr/bin/env python3
"""validate-frontmatter.py refuses what the model policy forbids.

Three rules are new and each is one typo away from never firing: an effort
spelt `extra-high` would load as nothing, an agent pinned to a gated model
would run every spawn on it, and a missing gated list would pass every agent
as clean. So each is planted in a fixture and must be refused, next to the
shapes that must pass. The scratch-reproduction Write rule (#105) gets the
same treatment: each grant shape refused without Write, each near miss passed.
"""
import pathlib, subprocess, sys, tempfile

GEN = pathlib.Path(__file__).resolve().parents[1] / "validate-frontmatter.py"
GATED = "plugins/kodflow-workflow/skills/_shared/gated-models.txt"
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" — {detail}"))
    fails += 0 if ok else 1


def fixture(agent_fm="model: sonnet\neffort: medium\n", skill_fm="model: inherit\neffort: low\n", gated=True,
            agent_body="Body."):
    root = pathlib.Path(tempfile.mkdtemp())
    a = root / "plugins/kodflow-demo/agents/demo.md"
    k = root / "plugins/kodflow-demo/skills/demo/SKILL.md"
    for p in (a, k):
        p.parent.mkdir(parents=True, exist_ok=True)
    a.write_text(f"---\nname: demo\ndescription: A demo agent.\n{agent_fm}---\n\n{agent_body}\n")
    k.write_text(f"---\nname: demo\ndescription: A demo skill.\n{skill_fm}---\n\nBody.\n")
    if gated:
        g = root / GATED
        g.parent.mkdir(parents=True, exist_ok=True)
        g.write_text("# gated\nfable   # a trailing comment keeps the token\n")
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
# #105: a Command scope that runs a Go or Cargo test runner under the scratch
# directory needs an effective Write, or the reproduction cannot be written.
AGENT = "plugins/kodflow-demo/agents/demo.md"
LACK = "Command scope runs tests under the scratch directory but tools lack Write"
DENIED = "Command scope runs tests under the scratch directory but disallowedTools removes Write"


def scope(grant, scratch=True):
    tail = " Reproduce under the scratch directory the brief names." if scratch else ""
    return f"## Command scope\n\n- `{grant}`\n{tail}\n\n## Role\n\nReviewer."


def agent(tools=None, disallowed=None):
    fm = "model: sonnet\neffort: medium\n"
    if tools is not None: fm += f"tools: {tools}\n"
    if disallowed is not None: fm += f"disallowedTools: {disallowed}\n"
    return fm


for name, fm, body, reason in (
    ("Bash(go test:*) under scratch without Write", agent("Read, Bash"), scope("Bash(go test:*)"), LACK),
    ("broad Bash(go:*) under scratch without Write", agent("Read, Bash"), scope("Bash(go:*)"), LACK),
    ("Bash(cargo test:*) under scratch without Write", agent("Read, Bash"), scope("Bash(cargo test:*)"), LACK),
    ("Write granted then disallowed", agent("Read, Write, Bash", "Write"), scope("Bash(go test:*)"), DENIED),
    ("Write disallowed with tools inherited", agent(None, "Edit, Write"), scope("Bash(go test:*)"), DENIED),
    ("Write disallowed as a YAML list", agent("Read, Write, Bash", "[Write]"), scope("Bash(go test:*)"), DENIED),
    ("Write disallowed in a block list", agent(None, "\n  - Edit\n  - Write"), scope("Bash(go test:*)"), DENIED),
    ("a tool that only contains the substring Write", agent("Read, NotebookWrite, Bash"), scope("Bash(go test:*)"), LACK),
):
    rc, out = run(fixture(agent_fm=fm, agent_body=body))
    check(f"refuses {name}", rc == 1 and AGENT in out and reason in out, out)

for name, fm, body in (
    ("Bash(go test:*) under scratch with Write", agent("Read, Write, Bash"), scope("Bash(go test:*)")),
    ("Bash(go test:*) under scratch with tools inherited", agent(None), scope("Bash(go test:*)")),
    ("Bash(go vet:*) under scratch without Write", agent("Read, Bash"), scope("Bash(go vet:*)")),
    ("broad Bash(cargo:*) with no scratch wording", agent("Read, Bash"), scope("Bash(cargo:*)", scratch=False)),
    ("cargo test outside Command scope", agent("Read, Bash"),
     "## Command scope\n\n- `Bash(git diff:*)`\n\n## Role\n\n- `Bash(cargo test:*)` under the scratch directory."),
):
    rc, out = run(fixture(agent_fm=fm, agent_body=body))
    check(f"passes {name}", rc == 0, out)

rc, out = run(pathlib.Path(__file__).resolve().parents[2])
check("this repository passes", rc == 0, out)

print(f"{fails} failure(s)")
sys.exit(1 if fails else 0)
