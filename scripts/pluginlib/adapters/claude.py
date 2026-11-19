"""Claude Code marketplace projection."""

from __future__ import annotations

from typing import Any

from ..model import Catalog, PluginPackage


def render_external(entry: dict[str, Any]) -> dict[str, Any]:
    """Render one pinned third-party entry; it is never installed by default."""
    return {
        "name": entry["name"],
        "description": entry["description"],
        "category": entry["category"],
        "source": {"source": "url", "url": entry["source"]["url"], "sha": entry["source"]["sha"]},
        # Read by scripts/install.sh: an entry set to false is left out of the
        # default installation and only installed on explicit request.
        "installByDefault": False,
    }


def render_marketplace(catalog: Catalog, packages: list[PluginPackage] | None = None) -> dict[str, Any]:
    plugins = []
    snapshot = catalog.packages() if packages is None else packages
    for entry, package in zip(catalog.plugins, snapshot, strict=True):
        if package.target("claude").get("enabled") is not True:
            continue
        plugins.append({
            "name": entry["name"],
            # The root plugin.json is the only source of a package's description.
            "description": package.manifest["description"],
            "author": {"name": catalog.data["owner"]["name"]},
            "category": entry["category"],
            # Relative sources inherit the marketplace checkout and its pin.
            "source": f"./{entry['path']}",
        })
    plugins.extend(
        render_external(entry) for entry in catalog.externals if "claude" in entry.get("targets", [])
    )
    return {
        "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
        "name": catalog.data["name"],
        "description": catalog.data["description"],
        "owner": catalog.data["owner"],
        "plugins": plugins,
    }
