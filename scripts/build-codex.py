#!/usr/bin/env python3
"""Generate the Codex side from the Claude side, so one source feeds both.

The skill container is nearly the same shape on both CLIs, but the frontmatter
is not a superset in either direction and the agent format is different
entirely: Codex custom agents are TOML with `developer_instructions`, not
Markdown with YAML. Generating rather than hand-porting is what keeps the two
from drifting — a hand port is correct once.
"""
import pathlib, re, sys, yaml
try:
    import tomli_w
except ImportError:
    tomli_w = None

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")

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

def neutralise(t):
    for pat, rep in NEUTRALISE:
        t = re.sub(pat, rep, t)
    return t

def split(raw):
    if not raw.startswith("---\n"): return {}, raw
    e = raw.find("\n---\n", 4)
    return (yaml.safe_load(raw[4:e+1]) or {}), raw[e+5:]

def toml_escape(s):
    return s.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')

skills_out = ROOT / "codex" / "skills"
agents_out = ROOT / "codex" / "agents"
for d in (skills_out, agents_out):
    d.mkdir(parents=True, exist_ok=True)

# ---- skills ---------------------------------------------------------------
n_sk = 0
for src in sorted(ROOT.glob("plugins/*/skills/*")):
    if not src.is_dir(): continue
    name = src.name
    dst = skills_out / name
    dst.mkdir(parents=True, exist_ok=True)
    entry = src / "SKILL.md"
    if entry.exists():
        fm, body = split(entry.read_text())
        desc = " ".join(str(fm.get("description", "")).split())
        # when_to_use is free text that often already starts with "Use when":
        # strip that prefix so the join never reads "Use when when".
        wtu = re.sub(r"^(use\s+)?(when\s+)?", "", " ".join(str(fm.get("when_to_use", "")).split()), flags=re.I)
        if wtu: desc = f"{desc} Use when {wtu}"
        meta = {"short-description": desc.split(".")[0][:80], "generated-from": f"plugins/*/skills/{name}"}
        if fm.get("argument-hint"): meta["argument-hint"] = fm["argument-hint"]
        out = {"name": fm.get("name", name), "description": desc, "metadata": meta}
        entry_text = ("---\n" + yaml.safe_dump(out, sort_keys=False, allow_unicode=True, width=88).rstrip("\n")
                      + "\n---\n" + neutralise(body))
        (dst / "SKILL.md").write_text(entry_text)
        n_sk += 1
    for f in src.rglob("*"):
        if f.is_file() and f.name != "SKILL.md":
            tgt = dst / f.relative_to(src)
            tgt.parent.mkdir(parents=True, exist_ok=True)
            try: tgt.write_text(neutralise(f.read_text()))
            except UnicodeDecodeError: tgt.write_bytes(f.read_bytes())
            if f.suffix == ".sh": tgt.chmod(0o755)

# ---- agents ---------------------------------------------------------------
n_ag = 0
for src in sorted(ROOT.glob("plugins/*/agents/*.md")):
    fm, body = split(src.read_text())
    name = fm.get("name", src.stem)
    model, effort = TIER.get(str(fm.get("model", "sonnet")), TIER["sonnet"])
    desc = " ".join(str(fm.get("description", "")).split())
    instr = neutralise(body).strip()
    (agents_out / f"{name}.toml").write_text(
        f'name = "{name}"\n'
        f'description = """{toml_escape(desc)}"""\n'
        f'model = "{model}"\n'
        f'model_reasoning_effort = "{effort}"\n\n'
        f'developer_instructions = """\n{toml_escape(instr)}\n"""\n'
    )
    n_ag += 1

print(f"  codex/skills: {n_sk} · codex/agents: {n_ag}")
