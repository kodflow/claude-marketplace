"""Render instructions and custom agents for the Codex compatibility projection."""

import re

# Names that mean nothing on the other CLI. Rewritten, not deleted: an agent
# told to "use mcp__context7__query-docs" on Codex would simply fail to find it.
NEUTRALISE = [
    (r"`mcp__context7__resolve-library-id`\s*then\s*`mcp__context7__query-docs`",
     "the library-documentation tool available to you"),
    (r"`mcp__context7__[a-z_-]+`", "the library-documentation tool"),
    (r"`mcp__github__[a-z_*]+`",   "the GitHub tool"),
    (r"`mcp__gitlab__[a-z_*]+`",   "the GitLab tool"),
    (r"`AskUserQuestion`",         "a multiple-choice question to the user"),
    (r"`Agent\(\*\)`|the `Agent` tool", "a subagent"),
    (r'Skill\(skill="([a-z-]+)"[^)]*\)', r"the /\1 skill"),
    (r"~/\.claude/skills/",        "~/.codex/skills/"),
    (r"~/\.claude/agents/",        "~/.codex/agents/"),
    # Plugin-root resolution has no Codex equivalent: skills are installed flat
    # under ~/.codex/skills, so the fallback must point there, not at ~/.claude.
    (r'\$\{CLAUDE_PLUGIN_ROOT:-\$HOME/\.claude\}', '${CODEX_HOME:-$HOME/.codex}'),
    (r"\$ARGUMENTS",               "the arguments"),
]

# Claude tier -> Codex model + effort. Verified current 2026-09: GPT-6 Astra is
# the flagship; the 5.6 family covers the tiers below it. Confirm before
# trusting: this mapping is a starting point, not a measurement.
TIER = {
    "opus":   ("gpt-6-astra",   "high"),
    "sonnet": ("gpt-5.6-sol",   "medium"),
    "haiku":  ("gpt-5.6-luna",  "low"),
    "fable":  ("gpt-6-astra",   "xhigh"),
}

CODEX_EFFORTS = {"low", "medium", "high", "xhigh"}
CLASS_PRESETS = {
    "fast": ("haiku", "low"), "standard": ("sonnet", "medium"),
    "deep": ("opus", "medium"), "verify": ("opus", "xhigh"),
}


def role_agent_fields(role: dict) -> dict[str, str]:
    """Resolve the role's abstract model class to Codex settings."""
    model, effort = CLASS_PRESETS[role["modelClass"]]
    return {
        "name": role["id"], "description": role["description"], "model": model,
        "effort": role.get("codexEffort", effort),
    }

def neutralise(t):
    for pat, rep in NEUTRALISE:
        t = re.sub(pat, rep, t)
    return t

def toml_escape(s):
    return s.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')

def render_agent(fm: dict, body: str, source_name: str) -> str:
    """Project the legacy TOML custom-agent contract without changing its format."""
    name = fm.get("name", source_name.removesuffix('.md'))
    model, effort = TIER.get(str(fm.get("model", "sonnet")), TIER["sonnet"])
    # The agent's own effort wins over the tier's default. Codex agent TOML
    # takes low/medium/high/xhigh; `max` is model-dependent there, so it is
    # written as the highest level every Codex model accepts.
    if str(fm.get("effort", "")) in CODEX_EFFORTS:
        effort = str(fm["effort"])
    elif str(fm.get("effort", "")) == "max":
        effort = "xhigh"
    desc = " ".join(str(fm.get("description", "")).split())
    instr = neutralise(body).strip()
    return (
        # The marker is what lets the installer tell a file it produced from a
        # file the user wrote, so it can retire the first and never the second.
        f'# generated-from: plugins/*/agents/{source_name}\n'
        f'name = "{name}"\n'
        f'description = """{toml_escape(desc)}"""\n'
        f'model = "{model}"\n'
        f'model_reasoning_effort = "{effort}"\n\n'
        f'developer_instructions = """\n{toml_escape(instr)}\n"""\n'
    )
