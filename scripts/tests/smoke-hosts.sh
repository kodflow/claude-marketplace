#!/usr/bin/env bash
# The required CI lane must demonstrate real loader behavior.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
case "${1:---available}" in
  --available) required=0 ;;
  --require-both) required=1 ;;
  *) echo "usage: $0 [--available|--require-both]" >&2; exit 2 ;;
esac
python3 - "$root" "$required" <<'PY'
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

repo = Path(sys.argv[1])
required = bool(int(sys.argv[2]))
plugin_id = "kodflow-workflow@kodflow"
hosts = [name for name in ("claude", "codex") if shutil.which(name)]
if required and len(hosts) != 2:
    sys.exit("Required loaders missing: " + ", ".join(sorted({"claude", "codex"} - set(hosts))))

def profile_env(host, home):
    env = dict(os.environ, HOME=str(home))
    env["CLAUDE_CONFIG_DIR" if host == "claude" else "CODEX_HOME"] = str(home / "config")
    return env

def call(host, home, args):
    env = profile_env(host, home)
    output = subprocess.check_output([host, "plugin", *args, "--json"], env=env, text=True, timeout=60)
    return json.loads(output.splitlines()[-1] if host == "claude" else output)

def codex_skills(home, installed, source):
    """The rewritten root must be where Codex put the package, and work there."""
    claude = (repo / "plugins/kodflow-workflow/skills/recap/SKILL.md").read_bytes()
    if (installed / "skills/recap/SKILL.md").read_bytes() == claude:
        sys.exit("codex: installed the Claude skill, not the Codex projection")
    version = json.loads((source / "plugin.json").read_text())["version"]
    expression = "${CODEX_HOME:-$HOME/.codex}/plugins/cache/kodflow/kodflow-workflow/" + version
    resolved = subprocess.check_output(
        ["bash", "-c", f'printf %s "{expression}"'], env=profile_env("codex", home), text=True,
    )
    if Path(resolved).resolve() != installed.resolve():
        sys.exit(f"codex: skills are rooted at {resolved}, the package is at {installed}")
    entries = sorted(installed.glob("skills/*/SKILL.md"))
    referenced = {
        match for entry in entries
        for match in re.findall(re.escape(expression) + r'"?(/[\w./-]+\.(?:sh|py))', entry.read_text())
    }
    missing = sorted(path for path in referenced if not (installed / path.lstrip("/")).is_file())
    if not referenced or missing:
        sys.exit(f"codex: script paths missing from the installed package: {missing or 'none found'}")
    script = f'"{expression}"/skills/_shared/scripts/detect-models.sh'
    subprocess.run(["bash", "-c", f"bash {script} >/dev/null"], env=profile_env("codex", home), check=True, timeout=60)
    print(f"codex: {len(referenced)} skill script paths resolve in the installed package; one ran")

with tempfile.TemporaryDirectory(prefix="kodflow-load-") as directory:
    for host in hosts:
        home = Path(directory) / host
        (home / "config").mkdir(parents=True)
        scope = ["--scope", "user"] if host == "claude" else []
        marketplace = call(host, home, ["marketplace", "add", *scope, str(repo)])
        if marketplace.get("marketplace", marketplace.get("marketplaceName")) != "kodflow":
            sys.exit(f"{host}: installed the wrong marketplace")
        install = "install" if host == "claude" else "add"
        plugin = call(host, home, [install, *scope, plugin_id])
        if plugin.get("pluginId") != plugin_id:
            sys.exit(f"{host}: did not install {plugin_id}")
        if host == "codex":
            installed = [Path(plugin["installedPath"])]
        else:
            installed = list((home / "config/plugins/cache/kodflow/kodflow-workflow").iterdir())
        # Codex installs the generated Codex package (codex/plugins), whose
        # skills carry Codex paths; Claude installs the package itself.
        source = repo / ("plugins" if host == "claude" else "codex/plugins") / "kodflow-workflow"
        manifest = ".claude-plugin/plugin.json" if host == "claude" else "plugin.json"
        paths = (manifest, "skills/search/SKILL.md", "skills/recap/SKILL.md")
        if not any(all((path / member).is_file() and
                       (path / member).read_bytes() == (source / member).read_bytes()
                       for member in paths) for path in installed):
            sys.exit(f"{host}: installed manifest or skill differs from this checkout")
        print(f"{host}: {plugin_id} loaded with the checked-out manifest and skills")
        if host == "codex":
            codex_skills(home, installed[0], source)
        if host == "codex":
            names = [f"developer-executor-{kind}" for kind in ("correctness", "security", "quality")]
            agents = home / "config/agents"
            agents.mkdir(exist_ok=True)
            for name in names:
                shutil.copyfile(repo / f"codex/agents/{name}.toml", agents / f"{name}.toml")
            prompt = subprocess.check_output(
                ["codex", "debug", "prompt-input"], env=profile_env(host, home), cwd=home, text=True, timeout=60,
            )
            if not all(name in prompt for name in names):
                sys.exit("Codex: the three staged custom roles were not discovered")
            print("Codex: discovered the three staged custom roles")
if not hosts:
    print("SKIP: no installed host CLI; use --require-both in CI")
PY
