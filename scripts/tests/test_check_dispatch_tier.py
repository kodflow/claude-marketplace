#!/usr/bin/env python3
"""check-dispatch-tier.py: each kind of site fires, each lookalike stays quiet.

Fixtures are written under a temporary plugins/ tree, so the checker is run on
exactly what it is told to read, never on this repository.
"""
import importlib.util
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("cdt", ROOT / "scripts/check-dispatch-tier.py")
cdt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdt)

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" - {detail}"))
    fails += 0 if ok else 1


def run(files):
    """files: {relative path under plugins/: text} -> (flagged, exempt)."""
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        (root / "plugins/kodflow-specialists/agents").mkdir(parents=True)
        (root / "plugins/kodflow-specialists/agents/developer-specialist-go.md").write_text("x")
        for rel, text in files.items():
            p = root / "plugins" / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        return cdt.scan(root)


S = "kodflow-workflow/skills/x/SKILL.md"
POSITIVE = {
    "subagent_type key": 'Use `subagent_type: "general-purpose"` for this.\n',
    "Agent( call": 'Call Agent(prompt="go") for it.\n',
    "Task( call": 'Task({ subagent_type: "Explore", prompt: "x" })\n',
    "verb + backticked name": "Launch the probes on `Explore`, all at once.\n",
    "prose built-in agent": "Give the fix to a general-purpose agent that can commit.\n",
    "yaml agent key": "```yaml\nprobes:\n  agent: \"Explore\"\n```\n",
    "agent( in a js fence": "```js\nconst r = await agent('read it', { label: 'x' })\n```\n",
    "only model": 'Dispatch `general-purpose` with model: "sonnet".\n',
}
for name, text in POSITIVE.items():
    flagged, _ = run({S: text})
    check("flags " + name, len(flagged) == 1, flagged)

NEGATIVE = {
    "Plan review mode": "Every brief opens with Plan review mode and a six-field contract.\n",
    "/plan": "Run /plan first, then launch the build.\n",
    "terraform plan": "Run terraform plan and dispatch nothing.\n",
    "heading": "# Launch `Explore` and Agent( calls\n",
    "routing-table row": "| /search | external | dispatch `general-purpose` | Task( |\n",
    "frontmatter tools": "---\nname: x\ntools: Agent(*), Task(*)\n---\nbody\n",
    "call to a pinned specialist": 'Task(subagent_type="developer-specialist-go", prompt="x")\n',
    "agent( in a prose paragraph": "The agent(s) are listed below.\n",
    "agent( outside js": "```bash\nagent(foo)\n```\n",
}
for name, text in NEGATIVE.items():
    flagged, _ = run({S: text})
    check("quiet on " + name, not flagged, flagged)

PASSING = {
    "model and effort": 'Dispatch `general-purpose`, model: "sonnet", effort: "low".\n',
    "tier table pointer": "Launch `Explore` per the tier table.\n",
    "model-policy section 2": "Launch `Explore` as model-policy.md §2 says.\n",
    "marker": "Launch `Explore` [tier-exempt: doc-pinned by the vendor].\n",
    "fence carries both": 'Task({ subagent_type: "Explore",\n  model: "haiku", effort: "low" })\n',
}
for name, text in PASSING.items():
    flagged, _ = run({S: text})
    check("passes with " + name, not flagged, flagged)

_, ex = run({S: "Launch `Explore` [tier-exempt: a reason].\n"})
check("exempt markers are counted", ex == 1, ex)

# paths: policy files allowlisted, mirrors skipped, canonical _shared read
text = "Launch `Explore` now.\n"
for rel, want in (
    ("kodflow-workflow/skills/_shared/model-policy.md", 0),
    ("kodflow-workflow/skills/_shared/specialists.md", 0),
    ("kodflow-devops/skills/_shared/team-mode.md", 0),
    ("kodflow-review/skills/_shared/team-mode.md", 0),
    ("kodflow-workflow/skills/_shared/team-mode.md", 1),
    ("kodflow-specialists/agents/x.md", 1),
    ("kodflow-devops/skills/infra/x.md", 1),
):
    flagged, _ = run({rel: text})
    check(f"path {rel}", len(flagged) == want, flagged)

# the cap on markers
many = "\n\n".join("Launch `Explore` [tier-exempt: r%d]." % i for i in range(cdt.MAX_EXEMPT + 1)) + "\n"
with tempfile.TemporaryDirectory() as d:
    p = pathlib.Path(d) / "plugins/kodflow-workflow/skills/x"
    p.mkdir(parents=True)
    (p / "SKILL.md").write_text(many)
    check("more markers than the cap fails", cdt.main([d]) == 1)

# the repository itself
check("this repository is clean", cdt.main([str(ROOT)]) == 0)

sys.exit(1 if fails else 0)
