"""Data contracts for portable packages, catalogs, and validation results."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Any


EXTENSION_NAMESPACE = "io.github.kodflow"
PLUGIN_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
MCP_SCHEMA_ID = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
TARGETS = ("claude", "openai", "perplexity")
CATALOG_PACKAGE_PATH = re.compile(r"plugins/[a-z0-9.-]+")


class PathContainmentError(ValueError):
    """A path could not be resolved within its allowed root."""


def contained_path(path: Path, root: Path, *, required: bool = True) -> Path:
    """Resolve a path without masking symlink loops on newer Python versions."""
    try:
        base = root.resolve(strict=True)
        try:
            resolved = path.resolve(strict=True)
        except FileNotFoundError:
            if required:
                raise
            resolved = path.resolve(strict=False)
    except (OSError, RuntimeError, ValueError) as error:
        raise PathContainmentError(f"cannot resolve {path}: {error}") from error
    if not resolved.is_relative_to(base):
        raise PathContainmentError(f"{path} resolves outside {root}")
    return resolved


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
        manifest_path = contained_path(root / "plugin.json", root)
        if not manifest_path.is_file():
            raise PathContainmentError(f"{manifest_path} must be a regular file")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError(f"{manifest_path} must contain an object")
        return cls(root=root, manifest=manifest)

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
        value = targets.get(name)
        if not isinstance(value, dict) or not isinstance(value.get("enabled"), bool):
            return {"enabled": False, "profile": "disabled"}
        return value

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
        root = path.parent.parent
        source = contained_path(path, root)
        if not source.is_file():
            raise PathContainmentError(f"{source} must be a regular file")
        data = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"{path} must contain an object")
        return cls(root=root, data=data)

    @property
    def plugins(self) -> list[dict[str, Any]]:
        value = self.data.get("plugins", [])
        return value if isinstance(value, list) else []

    @property
    def externals(self) -> list[dict[str, Any]]:
        """Third-party entries pinned by commit; never loaded as packages."""
        value = self.data.get("externals", [])
        return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []

    def packages(self) -> list[PluginPackage]:
        return [PluginPackage.load(self.package_root(entry)) for entry in self.plugins]

    def package_root(self, entry: dict[str, Any]) -> Path:
        """Validate the declared path before any package manifest is opened."""
        relative = entry.get("path")
        if not isinstance(relative, str) or not CATALOG_PACKAGE_PATH.fullmatch(relative):
            raise PathContainmentError("catalog path must name a single package under plugins/")
        if relative.removeprefix("plugins/") in {".", ".."}:
            raise PathContainmentError("catalog path must name a package, not a parent directory")
        package = self.root / relative
        # The plugin directory itself can be a link, while plugins/ must still
        # belong to this repository.
        contained_path(package, self.root, required=False)
        contained_path(package, self.root / "plugins", required=False)
        return package
