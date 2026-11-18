"""OpenAI Codex local marketplace projection."""

from __future__ import annotations

from typing import Any

from ..model import Catalog, PluginPackage


def render_marketplace(catalog: Catalog) -> dict[str, Any]:
    plugins = []
    for entry in catalog.plugins:
        package = PluginPackage.load(catalog.root / entry["path"])
        if not package.target("openai").get("enabled"):
            continue
        plugins.append({
            "name": entry["name"],
            "source": {"source": "local", "path": f"./{entry['path']}"},
            "policy": {
                "installation": "AVAILABLE",
                "authentication": "ON_INSTALL",
            },
            "category": entry["category"],
        })
    return {"name": catalog.data["name"], "plugins": plugins}
