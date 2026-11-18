"""Claude Code marketplace projection."""

from __future__ import annotations

from typing import Any

from ..model import Catalog, PluginPackage


def render_marketplace(catalog: Catalog) -> dict[str, Any]:
    plugins = []
    for entry in catalog.plugins:
        package = PluginPackage.load(catalog.root / entry["path"])
        if not package.target("claude").get("enabled"):
            continue
        plugins.append({
            "name": entry["name"],
            "description": entry["description"],
            "author": {"name": catalog.data["owner"]["name"]},
            "category": entry["category"],
            # Relative sources inherit the marketplace checkout and its pin.
            "source": f"./{entry['path']}",
        })
    return {
        "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
        "name": catalog.data["name"],
        "description": catalog.data["description"],
        "owner": catalog.data["owner"],
        "plugins": plugins,
    }
