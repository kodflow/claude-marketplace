"""OpenAI Codex local marketplace projection."""

from __future__ import annotations

from typing import Any

from ..codex_package import CODEX_PACKAGES
from ..model import Catalog, PluginPackage


def render_marketplace(catalog: Catalog, packages: list[PluginPackage] | None = None) -> dict[str, Any]:
    plugins = []
    snapshot = catalog.packages() if packages is None else packages
    for entry, package in zip(catalog.plugins, snapshot, strict=True):
        if package.target("openai").get("enabled") is not True:
            continue
        plugins.append({
            "name": entry["name"],
            # The Codex package, not the Claude one: its skills carry paths
            # Codex can resolve (see pluginlib/codex_package.py).
            "source": {"source": "local", "path": f"./{CODEX_PACKAGES / entry['name']}"},
            "policy": {
                "installation": "AVAILABLE",
                "authentication": "ON_INSTALL",
            },
            "category": entry["category"],
        })
    return {"name": catalog.data["name"], "plugins": plugins}
