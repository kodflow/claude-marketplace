#!/usr/bin/env python3
"""The canonical model policy states what the dispatch gates enforce.

The hooks and the dispatch checker judge a call against model-policy.md; if the
file stops saying that every dispatch passes model and effort, that this table
is the explicit effort instruction, or how forks and exemptions work, the
gates enforce a rule nobody wrote down.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
POLICY = ROOT / "plugins/kodflow-workflow/skills/_shared/model-policy.md"
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f" - {detail}"))
    fails += 0 if ok else 1


text = POLICY.read_text()
flat = re.sub(r"\s+", " ", text)

STATEMENTS = {
    "s2: every dispatch passes model and effort the definition does not pin":
        "Every dispatch passes on the call the model and the effort that the agent definition does not pin",
    "s2: the table is the explicit effort instruction":
        "this table is that instruction",
    "s2: Agent tool sets effort only when asked":
        "sets `effort` only when instructions explicitly ask for it",
    "s2: Workflow agent() replaces the omit guidance":
        "For `agent()` in a Workflow, this rule replaces the built-in guidance to omit `model` and `effort`",
    "fork: only continues the orchestrator's own work":
        "A **fork** only continues the orchestrator's own work",
    "fork: never a worker role": "it is never a worker role",
    "fork: counted apart": "Forks are counted apart from dispatches",
    "exempt: claude-code-guide Haiku": "| `claude-code-guide` | Haiku",
    "exempt: statusline-setup Sonnet": "| `statusline-setup` | Sonnet",
    "exempt: web-fetch no default claimed": "| `web-fetch` | exempt, with no default claimed",
    "s3: governs overrides of a pinned frontmatter":
        "when a call may override a pinned frontmatter",
    "s7: override row scoped to pinned frontmatter":
        "| Override a pinned frontmatter model or effort outside §3 |",
}
for name, phrase in STATEMENTS.items():
    check(name, re.sub(r"\s+", " ", phrase) in flat, phrase)

check("old unscoped s7 override row is gone",
      "| Override a call's model or effort outside §3 |" not in text)
check("old s3 sentence 'no override: the frontmatter is the decision' is gone",
      "dispatches with no override: the frontmatter is the decision" not in flat)

for plugin in ("kodflow-review", "kodflow-devops"):
    mirror = ROOT / f"plugins/{plugin}/skills/_shared/model-policy.md"
    check(f"{plugin} mirror identical", mirror.read_text() == text)

sys.exit(1 if fails else 0)
