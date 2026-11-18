#!/usr/bin/env python3
"""Generate the Codex side from the Claude side, so one source feeds both.

The skill container is nearly the same shape on both CLIs, but the frontmatter
is not a superset in either direction and the agent format is different
entirely: Codex custom agents are TOML with `developer_instructions`, not
Markdown with YAML. Generating rather than hand-porting is what keeps the two
from drifting — a hand port is correct once.
"""
import pathlib, re, sys, yaml

from pluginlib.codex_text import neutralise, render_agent, role_agent_fields
try:
    import tomli_w
except ImportError:
    tomli_w = None

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")

# Plugins a project enables for itself and nobody installs for the user
# (scripts/install-exclude.txt, which install.sh reads too): their skills and
# agents only make sense inside such a project, so Codex gets none of them.
def excluded_plugins(root):
    f = root / "scripts" / "install-exclude.txt"
    if not f.is_file():
        return set()
    return {l.split("#", 1)[0].strip() for l in f.read_text().splitlines()} - {""}

EXCLUDE_PLUGINS = excluded_plugins(ROOT)

def plugin_of(path):
    return path.relative_to(ROOT).parts[1]

def split(raw):
    if not raw.startswith("---\n"): return {}, raw
    e = raw.find("\n---\n", 4)
    return (yaml.safe_load(raw[4:e+1]) or {}), raw[e+5:]

skills_out = ROOT / "codex" / "skills"
agents_out = ROOT / "codex" / "agents"
for d in (skills_out, agents_out):
    d.mkdir(parents=True, exist_ok=True)

# ---- skills ---------------------------------------------------------------
# Every path written below is recorded, so whatever is left over afterwards is
# output whose source is gone. Generating without pruning leaves a deleted
# skill installed on the Codex side forever, and a diff-based freshness check
# cannot see it: nothing changed, something merely failed to disappear.
written = set()
n_sk = 0
for src in sorted(ROOT.glob("plugins/*/skills/*")):
    if not src.is_dir() or plugin_of(src) in EXCLUDE_PLUGINS: continue
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
        written.add(dst / "SKILL.md")
        n_sk += 1
    for f in src.rglob("*"):
        if f.is_file() and f.name != "SKILL.md":
            tgt = dst / f.relative_to(src)
            tgt.parent.mkdir(parents=True, exist_ok=True)
            try: tgt.write_text(neutralise(f.read_text()))
            except UnicodeDecodeError: tgt.write_bytes(f.read_bytes())
            if f.suffix == ".sh": tgt.chmod(0o755)
            written.add(tgt)

# ---- agents ---------------------------------------------------------------
n_ag = 0
for src in sorted(ROOT.glob("plugins/*/agents/*.md")):
    if plugin_of(src) in EXCLUDE_PLUGINS: continue
    fm, body = split(src.read_text())
    package = src.parent.parent.resolve()
    role = package / "io.github.kodflow" / "roles" / src.stem / "role.yaml"
    if role.is_file():
        if not role.resolve().is_relative_to(package):
            raise ValueError(f"{role}: role leaves the package")
        data = yaml.safe_load(role.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("id") != src.stem:
            raise ValueError(f"{role}: role id must match {src.stem!r}")
        instructions = (role.parent / data["instructions"]).resolve()
        if not instructions.is_relative_to(role.parent.resolve()):
            raise ValueError(f"{role}: instructions leave the role")
        fm = role_agent_fields(data)
        body = instructions.read_text(encoding="utf-8")
    name = fm.get("name", src.stem)
    (agents_out / f"{name}.toml").write_text(render_agent(fm, body, src.name))
    written.add(agents_out / f"{name}.toml")
    n_ag += 1

# ---- prune ----------------------------------------------------------------
n_rm = 0
for out in (skills_out, agents_out):
    for f in sorted(out.rglob("*"), reverse=True):
        if f.is_file() and f not in written:
            f.unlink(); n_rm += 1
        elif f.is_dir() and not any(f.iterdir()):
            f.rmdir()

print(f"  codex/skills: {n_sk} · codex/agents: {n_ag}"
      + (f" · pruned: {n_rm}" if n_rm else ""))
