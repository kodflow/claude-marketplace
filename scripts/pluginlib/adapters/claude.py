"""Claude Code marketplace projection."""

from __future__ import annotations

from typing import Any

from ..model import Catalog, PluginPackage


def render_marketplace(catalog: Catalog, packages: list[PluginPackage] | None = None) -> dict[str, Any]:
    plugins = []
    snapshot = catalog.packages() if packages is None else packages
    for entry, package in zip(catalog.plugins, snapshot, strict=True):
        if package.target("claude").get("enabled") is not True:
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
