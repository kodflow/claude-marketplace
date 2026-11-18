"""Agent Plugins package validation with strict publisher and loader modes."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from jsonschema import Draft202012Validator
import yaml

from .model import Catalog, EXTENSION_NAMESPACE, MCP_SCHEMA_ID, PluginPackage, ValidationIssue


MODES = ("publisher-strict", "loader-conformance")


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _issue(severity: str, code: str, path: Path | str, message: str) -> ValidationIssue:
    return ValidationIssue(severity, code, str(path), message)


def _schema_issues(
    data: dict[str, Any], schema: dict[str, Any], path: Path, mode: str
) -> list[ValidationIssue]:
    candidate = copy.deepcopy(data)
    issues: list[ValidationIssue] = []
    if mode == "loader-conformance":
        known = set(schema.get("properties", {}))
        for key in sorted(set(candidate) - known):
            issues.append(_issue("warning", "unknown-root-field", path, f"ignored root field {key!r}"))
            candidate.pop(key)
        if "extensions" in candidate and not isinstance(candidate["extensions"], dict):
            issues.append(_issue("warning", "invalid-extensions", path, "ignored non-object extensions field"))
            candidate.pop("extensions")
    for error in sorted(
        Draft202012Validator(schema).iter_errors(candidate),
        key=lambda item: tuple(str(part) for part in item.path),
    ):
        location = "/".join(str(item) for item in error.path) or "."
        issues.append(_issue("error", "schema", path, f"{location}: {error.message}"))
    return issues


def _inside(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=True))
        return True
    except (OSError, ValueError):
        return False


def _frontmatter(path: Path) -> tuple[dict[str, Any], str | None]:
    raw = path.read_text()
    if not raw.startswith("---\n"):
        return {}, "missing YAML frontmatter"
    end = raw.find("\n---\n", 4)
    if end < 0:
        return {}, "unterminated YAML frontmatter"
    try:
        parsed = yaml.safe_load(raw[4:end + 1]) or {}
    except yaml.YAMLError as error:
        return {}, f"invalid YAML frontmatter: {error}"
    return parsed if isinstance(parsed, dict) else {}, None


def _validate_skills(package: PluginPackage, mode: str) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    skills_root = package.root / "skills"
    if not skills_root.exists():
        return issues
    if not skills_root.is_dir() or not _inside(skills_root, package.root):
        return [_issue("error", "skills-root", skills_root, "skills must be a contained directory")]
    for skill_dir in sorted(path for path in skills_root.iterdir() if path.is_dir()):
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.exists():
            continue
        if not skill_file.is_file() or not _inside(skill_file, package.root):
            severity = "error" if mode == "publisher-strict" else "warning"
            issues.append(_issue(severity, "skill-containment", skill_file, "SKILL.md resolves outside the plugin"))
            continue
        frontmatter, error = _frontmatter(skill_file)
        if error:
            issues.append(_issue("error", "skill-frontmatter", skill_file, error))
            continue
        for required in ("name", "description"):
            if not isinstance(frontmatter.get(required), str) or not frontmatter[required].strip():
                issues.append(_issue("error", "skill-frontmatter", skill_file, f"missing non-empty {required}"))
    return issues


def _path_value(value: str, package: PluginPackage) -> Path | None:
    if value.startswith("./"):
        return package.root / value[2:]
    if value == "${PLUGIN_ROOT}":
        return package.root
    if value.startswith("${PLUGIN_ROOT}/"):
        return package.root / value[len("${PLUGIN_ROOT}/"):]
    return None


def _validate_mcp(package: PluginPackage, schemas_root: Path, mode: str) -> list[ValidationIssue]:
    path = package.root / "mcp.json"
    if not path.exists():
        return []
    if not path.is_file() or not _inside(path, package.root):
        return [_issue("error", "mcp-root", path, "mcp.json must be a contained file")]
    try:
        data = _load_json(path)
    except (OSError, json.JSONDecodeError) as error:
        return [_issue("error", "mcp-json", path, str(error))]
    schema = _load_json(schemas_root / "agent-plugins" / "1.0.0" / "mcp.schema.json")
    issues = _schema_issues(data, schema, path, mode)
    if data.get("$schema") != MCP_SCHEMA_ID:
        return issues
    for name, server in sorted(data.get("mcpServers", {}).items()):
        if not isinstance(server, dict):
            continue
        for field in ("command", "cwd"):
            value = server.get(field)
            if not isinstance(value, str):
                continue
            resolved = _path_value(value, package)
            if resolved is not None and not _inside(resolved, package.root):
                issues.append(_issue("error", "mcp-containment", path, f"server {name!r} {field} escapes plugin root"))
        if server.get("type") in {"streamable-http", "sse"}:
            url = server.get("url", "")
            parsed = urlparse(url) if isinstance(url, str) else None
            if parsed is None or parsed.scheme not in {"http", "https"} or not parsed.netloc:
                issues.append(_issue("error", "mcp-url", path, f"server {name!r} needs an absolute HTTP(S) URL"))
    return issues


def validate_plugin(package_root: Path, schemas_root: Path, mode: str = "publisher-strict") -> list[ValidationIssue]:
    """Validate one package and return all errors and conformance warnings."""

    if mode not in MODES:
        raise ValueError(f"unknown validation mode: {mode}")
    manifest_path = package_root / "plugin.json"
    if not manifest_path.is_file() or not _inside(manifest_path, package_root):
        return [_issue("error", "manifest", manifest_path, "plugin.json is missing or escapes the plugin root")]
    try:
        manifest = _load_json(manifest_path)
    except (OSError, json.JSONDecodeError) as error:
        return [_issue("error", "manifest-json", manifest_path, str(error))]
    if not isinstance(manifest, dict):
        return [_issue("error", "manifest-json", manifest_path, "plugin.json must contain an object")]
    plugin_schema = _load_json(schemas_root / "agent-plugins" / "1.0.0" / "plugin.schema.json")
    issues = _schema_issues(manifest, plugin_schema, manifest_path, mode)
    extension = manifest.get("extensions", {})
    if isinstance(extension, dict) and EXTENSION_NAMESPACE in extension:
        value = extension[EXTENSION_NAMESPACE]
        schema = _load_json(schemas_root / "kodflow-extension-v1.schema.json")
        if isinstance(value, dict):
            issues.extend(_schema_issues(value, schema, manifest_path, "publisher-strict"))
        else:
            issues.append(_issue("error", "kodflow-extension", manifest_path, "Kodflow extension must be an object"))
    package = PluginPackage(package_root, manifest)
    issues.extend(_validate_skills(package, mode))
    issues.extend(_validate_mcp(package, schemas_root, mode))
    return sorted(issues, key=lambda item: (item.path, item.code, item.message))


def validate_catalog(catalog: Catalog, schemas_root: Path) -> list[ValidationIssue]:
    path = catalog.root / "catalog" / "catalog.json"
    schema = _load_json(schemas_root / "kodflow-catalog-v1.schema.json")
    issues = _schema_issues(catalog.data, schema, path, "publisher-strict")
    names: set[str] = set()
    graph: dict[str, list[str]] = {}
    for entry in catalog.plugins:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        plugin_path = entry.get("path")
        if not isinstance(name, str) or not isinstance(plugin_path, str):
            continue
        if name in names:
            issues.append(_issue("error", "duplicate-plugin", path, f"duplicate catalog plugin {name!r}"))
            continue
        names.add(name)
        package_root = catalog.root / plugin_path
        if not _inside(package_root, catalog.root):
            issues.append(_issue("error", "catalog-path", path, f"plugin {name!r} escapes repository root"))
            continue
        if not (package_root / "plugin.json").is_file():
            issues.append(_issue("error", "catalog-path", path, f"plugin {name!r} has no root plugin.json"))
            continue
        package = PluginPackage.load(package_root)
        dependencies = package.extension.get("dependencies", [])
        if not isinstance(dependencies, list):
            dependencies = []
        graph[name] = [
            item["plugin"]
            for item in dependencies
            if isinstance(item, dict)
            and item.get("required") is True
            and isinstance(item.get("plugin"), str)
        ]
    for name, dependencies in sorted(graph.items()):
        for dependency in dependencies:
            if dependency not in names:
                issues.append(_issue("error", "missing-dependency", path, f"{name!r} requires unknown {dependency!r}"))

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(name: str, trail: list[str]) -> None:
        if name in visiting:
            cycle = " -> ".join(trail + [name])
            issues.append(_issue("error", "dependency-cycle", path, cycle))
            return
        if name in visited:
            return
        visiting.add(name)
        for dependency in graph.get(name, []):
            visit(dependency, trail + [name])
        visiting.remove(name)
        visited.add(name)

    for name in sorted(graph):
        visit(name, [])
    return sorted(issues, key=lambda item: (item.path, item.code, item.message))
