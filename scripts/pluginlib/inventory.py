"""Build the reproducible inventory used to prove migration parity."""

from __future__ import annotations

from collections import defaultdict
import hashlib
import json
from pathlib import Path
from typing import Any

from .model import EXTENSION_NAMESPACE
from .sources import SourceFile, source_files


def _classify(path: Path) -> str:
    parts = path.parts
    if parts[0] in {".claude-plugin", ".codex-plugin"}:
        return "host-extension"
    if parts[0] == "skills" or parts in {("plugin.json",), ("mcp.json",)}:
        return "portable"
    if "agents" in parts or "hooks" in parts or "types" in parts:
        return "host-extension"
    if "tests" in parts:
        return "verification"
    return "support"


def _dependencies(content: bytes | None) -> list[dict[str, Any]]:
    if content is None:
        return []
    manifest = json.loads(content.decode("utf-8"))
    return sorted(
        manifest.get("extensions", {}).get(EXTENSION_NAMESPACE, {}).get("dependencies", []),
        key=lambda dependency: dependency["plugin"],
    )


def build_inventory(repo_root: Path) -> dict[str, Any]:
    """Return a stable inventory of every plugin component."""

    plugins: list[dict[str, Any]] = []
    totals = {"plugins": 0, "skills": 0, "agents": 0, "hookBundles": 0, "files": 0}
    packages: dict[Path, list[SourceFile]] = defaultdict(list)
    for source in source_files(repo_root, "plugins"):
        if len(source.path.parts) >= 3:
            packages[Path(*source.path.parts[:2])].append(source)
    for package, files in sorted(packages.items()):
        paths = {source.path.relative_to(package) for source in files}
        skills = sum(path.match("skills/*/SKILL.md") and len(path.parts) == 3 for path in paths)
        agents = sum(path.match("agents/*.md") and len(path.parts) == 2 for path in paths)
        hook_bundle = Path("hooks/hooks.json") in paths
        components = []
        manifest = None
        for source in files:
            relative = source.path.relative_to(package)
            content = source.content(repo_root)
            if relative == Path("plugin.json"):
                manifest = content
            components.append({
                "path": source.path.as_posix(),
                "class": _classify(relative),
                "sha256": hashlib.sha256(content).hexdigest(),
            })
        plugins.append({
            "name": package.name,
            "path": package.as_posix(),
            "skills": skills,
            "agents": agents,
            "hookBundle": hook_bundle,
            "dependencies": _dependencies(manifest),
            "components": components,
        })
        totals["plugins"] += 1
        totals["skills"] += skills
        totals["agents"] += agents
        totals["hookBundles"] += int(hook_bundle)
        totals["files"] += len(files)
    return {"schemaVersion": 1, "plugins": plugins, "totals": totals}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
