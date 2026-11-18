"""Build the reproducible inventory used to prove migration parity."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _classify(path: Path) -> str:
    parts = path.parts
    if "skills" in parts or path.name in {"plugin.json", "mcp.json"}:
        return "portable"
    if "agents" in parts or "hooks" in parts or "types" in parts:
        return "host-extension"
    if "tests" in parts:
        return "verification"
    return "support"


def build_inventory(repo_root: Path) -> dict[str, Any]:
    """Return a stable inventory of every plugin component."""

    plugins: list[dict[str, Any]] = []
    totals = {"plugins": 0, "skills": 0, "agents": 0, "hookBundles": 0, "files": 0}
    for plugin_root in sorted((repo_root / "plugins").iterdir()):
        if not plugin_root.is_dir():
            continue
        files = sorted(path for path in plugin_root.rglob("*") if path.is_file())
        skills = sorted(plugin_root.glob("skills/*/SKILL.md"))
        agents = sorted(plugin_root.glob("agents/*.md"))
        hook_bundle = plugin_root / "hooks" / "hooks.json"
        components = [
            {
                "path": path.relative_to(repo_root).as_posix(),
                "class": _classify(path.relative_to(plugin_root)),
                "sha256": _sha256(path),
            }
            for path in files
        ]
        plugins.append({
            "name": plugin_root.name,
            "path": plugin_root.relative_to(repo_root).as_posix(),
            "skills": len(skills),
            "agents": len(agents),
            "hookBundle": hook_bundle.is_file(),
            "components": components,
        })
        totals["plugins"] += 1
        totals["skills"] += len(skills)
        totals["agents"] += len(agents)
        totals["hookBundles"] += int(hook_bundle.is_file())
        totals["files"] += len(files)
    return {"schemaVersion": 1, "plugins": plugins, "totals": totals}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
