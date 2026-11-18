"""Data contracts for portable packages, catalogs, and validation results."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any


EXTENSION_NAMESPACE = "io.github.kodflow"
PLUGIN_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
MCP_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
TARGETS = ("claude", "openai", "perplexity")


@dataclass(frozen=True)
class ValidationIssue:
    """One deterministic validator result."""

    severity: str
    code: str
    path: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {
            "severity": self.severity,
            "code": self.code,
            "path": self.path,
            "message": self.message,
        }


@dataclass(frozen=True)
class PluginPackage:
    """A loaded Agent Plugin package rooted in the repository."""

    root: Path
    manifest: dict[str, Any]

    @classmethod
    def load(cls, root: Path) -> "PluginPackage":
        manifest_path = root / "plugin.json"
        return cls(root=root, manifest=json.loads(manifest_path.read_text()))

    @property
    def name(self) -> str:
        return str(self.manifest.get("name", self.root.name))

    @property
    def extension(self) -> dict[str, Any]:
        extensions = self.manifest.get("extensions", {})
        if not isinstance(extensions, dict):
            return {}
        value = extensions.get(EXTENSION_NAMESPACE, {})
        return value if isinstance(value, dict) else {}

    @property
    def capabilities(self) -> dict[str, str]:
        value = self.extension.get("capabilities", {})
        return value if isinstance(value, dict) else {}

    def target(self, name: str) -> dict[str, Any]:
        targets = self.extension.get("targets", {})
        if not isinstance(targets, dict):
            return {"enabled": False, "profile": "disabled"}
        value = targets.get(name, {"enabled": False, "profile": "disabled"})
        return value if isinstance(value, dict) else {"enabled": False, "profile": "disabled"}

    def skill_directories(self) -> list[Path]:
        skills = self.root / "skills"
        if not skills.is_dir():
            return []
        return sorted(
            path for path in skills.iterdir()
            if path.is_dir() and (path / "SKILL.md").is_file()
        )

    def agent_files(self) -> list[Path]:
        agents = self.root / "agents"
        return sorted(agents.glob("*.md")) if agents.is_dir() else []


@dataclass(frozen=True)
class Catalog:
    """Canonical logical catalog, independent from release SHAs and digests."""

    root: Path
    data: dict[str, Any]

    @classmethod
    def load(cls, path: Path) -> "Catalog":
        return cls(root=path.parent.parent, data=json.loads(path.read_text()))

    @property
    def plugins(self) -> list[dict[str, Any]]:
        value = self.data.get("plugins", [])
        return value if isinstance(value, list) else []

    def packages(self) -> list[PluginPackage]:
        return [PluginPackage.load(self.root / entry["path"]) for entry in self.plugins]
