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

def call(host, home, args):
    env = dict(os.environ, HOME=str(home))
    env["CLAUDE_CONFIG_DIR" if host == "claude" else "CODEX_HOME"] = str(home / "config")
    output = subprocess.check_output([host, "plugin", *args, "--json"], env=env, text=True)
    return json.loads(output.splitlines()[-1] if host == "claude" else output)

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
        source = repo / "plugins/kodflow-workflow/skills/search/SKILL.md"
        if not any((path / "skills/search/SKILL.md").read_bytes() == source.read_bytes()
                   for path in installed if (path / "skills/search/SKILL.md").is_file()):
            sys.exit(f"{host}: installed skill differs from this checkout")
        print(f"{host}: {plugin_id} loaded with the checked-out search skill")
if not hosts:
    print("SKIP: no installed host CLI; use --require-both in CI")
PY
