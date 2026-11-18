"""Agent Plugins package validation with strict publisher and loader modes."""

from __future__ import annotations

import copy
import ipaddress
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator
import yaml

from .model import Catalog, EXTENSION_NAMESPACE, MCP_SCHEMA_ID, PluginPackage, ValidationIssue


MODES = ("publisher-strict", "loader-conformance")
PLUGIN_NAME = re.compile(r"(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?")
SKILL_NAME = re.compile(r"(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?")


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


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
        extensions = candidate.get("extensions")
        if "extensions" in candidate and not isinstance(extensions, dict):
            issues.append(_issue("warning", "invalid-extensions", path, "ignored non-object extensions field"))
            candidate.pop("extensions")
        elif isinstance(extensions, dict):
            for namespace in sorted(set(extensions) - {EXTENSION_NAMESPACE}):
                issues.append(
                    _issue(
                        "warning",
                        "ignored-extension-namespace",
                        path,
                        f"ignored unimplemented extension namespace {namespace!r}",
                    )
                )
            candidate["extensions"] = {
                namespace: value
                for namespace, value in extensions.items()
                if namespace == EXTENSION_NAMESPACE
            }
    for error in sorted(
        Draft202012Validator(schema).iter_errors(candidate),
        key=lambda item: tuple(str(part) for part in item.path),
    ):
        location = "/".join(str(item) for item in error.path) or "."
        issues.append(_issue("error", "schema", path, f"{location}: {error.message}"))
    return issues


def _inside(path: Path, root: Path) -> bool:
    try:
        resolved = path.resolve(strict=True) if path.is_symlink() else path.resolve(strict=False)
        resolved.relative_to(root.resolve(strict=True))
        return True
    except (OSError, RuntimeError, ValueError):
        return False


def _frontmatter(path: Path) -> tuple[dict[str, Any], str | None]:
    raw = path.read_text(encoding="utf-8")
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
    severity = "error" if mode == "publisher-strict" else "warning"
    skills_root = package.root / "skills"
    if not skills_root.exists():
        return issues
    if not skills_root.is_dir() or not _inside(skills_root, package.root):
        return [_issue(severity, "skills-root", skills_root, "skills must be a contained directory")]
    for skill_dir in sorted(path for path in skills_root.iterdir() if path.is_dir()):
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.exists():
            continue
        if not skill_file.is_file() or not _inside(skill_file, package.root):
            issues.append(_issue(severity, "skill-containment", skill_file, "SKILL.md resolves outside the plugin"))
            continue
        frontmatter, error = _frontmatter(skill_file)
        if error:
            issues.append(_issue(severity, "skill-frontmatter", skill_file, error))
            continue
        name = frontmatter.get("name")
        description = frontmatter.get("description")
        if not isinstance(name, str) or not name:
            issues.append(_issue(severity, "skill-frontmatter", skill_file, "missing non-empty name"))
        elif SKILL_NAME.fullmatch(name) is None or len(name) > 64:
            issues.append(_issue(severity, "skill-name", skill_file, f"invalid skill name {name!r}"))
        elif name != skill_dir.name:
            issues.append(
                _issue(
                    severity,
                    "skill-name",
                    skill_file,
                    f"skill name {name!r} must match directory {skill_dir.name!r}",
                )
            )
        if not isinstance(description, str) or not description:
            issues.append(_issue(severity, "skill-frontmatter", skill_file, "missing non-empty description"))
        elif len(description) > 1024:
            issues.append(_issue(severity, "skill-description", skill_file, "description exceeds 1024 characters"))
    return issues


def _plugin_path(value: str, package: PluginPackage) -> Path | None:
    if value.startswith("./"):
        return package.root / value[2:]
    if value == "${PLUGIN_ROOT}":
        return package.root
    if value.startswith("${PLUGIN_ROOT}/"):
        return package.root / value[len("${PLUGIN_ROOT}/"):]
    return None


def _placeholder_stays_within(value: str, placeholder: str) -> bool:
    if value == placeholder:
        return True
    prefix = f"{placeholder}/"
    if not value.startswith(prefix) or "\\" in value:
        return False
    relative = value[len(prefix):]
    if not relative or relative.startswith("/"):
        return False
    depth = 0
    for part in PurePosixPath(relative).parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if depth == 0:
                return False
            depth -= 1
        else:
            depth += 1
    return True


def _validator_issues(
    data: Any,
    schema: dict[str, Any],
    path: Path,
    severity: str,
    code: str,
    prefix: str = "",
) -> list[ValidationIssue]:
    issues = []
    for error in sorted(
        Draft202012Validator(schema).iter_errors(data),
        key=lambda item: tuple(str(part) for part in item.path),
    ):
        location = "/".join(str(item) for item in error.path) or "."
        message = f"{prefix}{location}: {error.message}"
        issues.append(_issue(severity, code, path, message))
    return issues


def _remote_url_error(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        username = parsed.username
        password = parsed.password
    except ValueError as error:
        return f"invalid URL: {error}"
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or not hostname:
        return "needs an absolute HTTP(S) URL"
    if username is not None or password is not None:
        return "URL must not contain user information"
    if parsed.fragment:
        return "URL must not contain a fragment"
    if parsed.scheme == "http":
        loopback = hostname.lower() == "localhost"
        if not loopback:
            try:
                loopback = ipaddress.ip_address(hostname).is_loopback
            except ValueError:
                loopback = False
        if not loopback:
            return "non-loopback MCP endpoints require HTTPS"
    return None


def _validate_server_semantics(
    name: str,
    server: dict[str, Any],
    package: PluginPackage,
    path: Path,
    severity: str,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    server_type = server.get("type")
    if server_type == "stdio":
        command = server.get("command")
        if isinstance(command, str):
            if command.startswith("./"):
                if not _inside(package.root / command[2:], package.root):
                    issues.append(_issue(severity, "mcp-containment", path, f"server {name!r} command escapes plugin root"))
            elif "/" in command or "\\" in command or command in {".", ".."}:
                issues.append(
                    _issue(
                        severity,
                        "mcp-command",
                        path,
                        f"server {name!r} command must be a bare name or start with './'",
                    )
                )
        cwd = server.get("cwd")
        if isinstance(cwd, str):
            if cwd.startswith("${PLUGIN_DATA}"):
                if not _placeholder_stays_within(cwd, "${PLUGIN_DATA}"):
                    issues.append(_issue(severity, "mcp-containment", path, f"server {name!r} cwd escapes plugin data"))
            else:
                resolved = _plugin_path(cwd, package)
                if resolved is not None and not _inside(resolved, package.root):
                    issues.append(_issue(severity, "mcp-containment", path, f"server {name!r} cwd escapes plugin root"))
    elif server_type in {"streamable-http", "sse"}:
        url = server.get("url")
        if isinstance(url, str) and (message := _remote_url_error(url)):
            issues.append(_issue(severity, "mcp-url", path, f"server {name!r} {message}"))
    return issues


def _validate_mcp(package: PluginPackage, schemas_root: Path, mode: str) -> list[ValidationIssue]:
    path = package.root / "mcp.json"
    if not path.exists():
        return []
    severity = "error" if mode == "publisher-strict" else "warning"
    if not path.is_file() or not _inside(path, package.root):
        return [_issue(severity, "mcp-root", path, "mcp.json must be a contained file")]
    try:
        data = _load_json(path)
    except (OSError, json.JSONDecodeError) as error:
        return [_issue(severity, "mcp-json", path, str(error))]
    if not isinstance(data, dict):
        return [_issue(severity, "mcp-envelope", path, "mcp.json must contain an object")]

    schema = _load_json(schemas_root / "agent-plugins" / "1.0.0" / "mcp.schema.json")
    envelope_schema = copy.deepcopy(schema)
    envelope_schema["properties"]["mcpServers"] = {"type": "object"}
    envelope = _validator_issues(data, envelope_schema, path, severity, "mcp-envelope")
    if envelope and mode == "loader-conformance":
        return envelope
    issues = list(envelope)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        return issues
    if data.get("$schema") != MCP_SCHEMA_ID:
        return issues

    server_schema = {
        "$schema": schema["$schema"],
        "$defs": schema["$defs"],
        **schema["$defs"]["server"],
    }
    for name, server in sorted(servers.items()):
        server_issues = _validator_issues(
            server,
            server_schema,
            path,
            severity,
            "mcp-server",
            f"server {name!r} ",
        )
        issues.extend(server_issues)
        if server_issues or not isinstance(server, dict):
            continue
        issues.extend(_validate_server_semantics(name, server, package, path, severity))
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
    name = manifest.get("name")
    if isinstance(name, str) and PLUGIN_NAME.fullmatch(name) is None:
        issues.append(_issue("error", "plugin-name", manifest_path, f"invalid plugin name {name!r}"))
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
        manifest_path = package_root / "plugin.json"
        if not manifest_path.is_file():
            issues.append(_issue("error", "catalog-path", path, f"plugin {name!r} has no root plugin.json"))
            continue
        try:
            package = PluginPackage.load(package_root)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            issues.append(_issue("error", "catalog-manifest", manifest_path, str(error)))
            continue
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
            issues.append(_issue("error", "dependency-cycle", path, " -> ".join([*trail, name])))
            return
        if name in visited:
            return
        visiting.add(name)
        for dependency in graph.get(name, []):
            visit(dependency, [*trail, name])
        visiting.remove(name)
        visited.add(name)

    for name in sorted(graph):
        visit(name, [])
    return sorted(issues, key=lambda item: (item.path, item.code, item.message))
