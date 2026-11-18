"""Capability semantics shared by all host adapters."""

from __future__ import annotations

from collections.abc import Callable
import json
from pathlib import Path
import shlex
from typing import Any

from ..model import PluginPackage
from .perplexity import build_archive, validate_archive


SUPPORT: dict[str, dict[str, tuple[str, str, str]]] = {
    "claude": {
        "skills": ("equivalent", "native", "claude-skill-layout"),
        "agents": ("equivalent", "native", "claude-agent-layout"),
        "hooks": ("equivalent", "native", "claude-hook-layout"),
        "mods": ("equivalent", "native", "claude-module-layout"),
        "shell-integration": ("equivalent", "native", "claude-session-hook-layout"),
        "multi-agent": ("advisory-loss", "generated", ""),
    },
    "openai": {
        "skills": ("equivalent", "native", "codex-skill-layout"),
        "agents": ("advisory-loss", "generated", ""),
        "hooks": ("absent", "none", ""),
        "mods": ("absent", "none", ""),
        "shell-integration": ("advisory-loss", "generated", ""),
        "multi-agent": ("advisory-loss", "generated", ""),
    },
    "perplexity": {
        "skills": ("equivalent", "native", "perplexity-zip-validation"),
        "agents": ("absent", "none", ""),
        "hooks": ("absent", "none", ""),
        "mods": ("absent", "none", ""),
        "shell-integration": ("absent", "none", ""),
        "multi-agent": ("absent", "none", ""),
    },
}


def _file(package: PluginPackage, source: Path) -> bool:
    resolved = source.resolve(strict=True)
    return resolved.is_relative_to(package.root.resolve(strict=True)) and resolved.is_file()


def _manifest(package: PluginPackage) -> bool:
    path = package.root / ".claude-plugin/plugin.json"
    if not _file(package, path):
        return False
    manifest = json.loads(path.read_text(encoding="utf-8"))
    return isinstance(manifest, dict) and manifest.get("name") == package.name


def _skills(package: PluginPackage) -> bool:
    entries = package.skill_directories()
    return bool(entries) and all(_file(package, path / "SKILL.md") for path in entries)


def _agents(package: PluginPackage) -> bool:
    entries = package.agent_files()
    return _manifest(package) and bool(entries) and all(_file(package, path) for path in entries)


def _hook_config(package: PluginPackage) -> dict:
    path = package.root / "hooks/hooks.json"
    if not _manifest(package) or not _file(package, path):
        return {}
    config = json.loads(path.read_text(encoding="utf-8"))
    return config if isinstance(config, dict) else {}


def _modules(package: PluginPackage, config: dict) -> bool:
    entries = config.get("modules")
    return isinstance(entries, list) and bool(entries) and all(
        isinstance(path, str) and path.startswith("./") and _file(package, package.root / "hooks" / path)
        for path in entries
    )


def _commands(package: PluginPackage, groups: object) -> bool:
    if not isinstance(groups, list) or not groups:
        return False
    for group in groups:
        entries = group.get("hooks") if isinstance(group, dict) else None
        if not isinstance(entries, list) or not entries:
            return False
        for entry in entries:
            command = entry.get("command") if isinstance(entry, dict) and entry.get("type") == "command" else None
            parts = shlex.split(command) if isinstance(command, str) else []
            if not parts or not parts[0].startswith("${CLAUDE_PLUGIN_ROOT}/"):
                return False
            path = package.root / parts[0].removeprefix("${CLAUDE_PLUGIN_ROOT}/")
            if not _file(package, path) or not path.stat().st_mode & 0o111:
                return False
    return True


def _hooks(package: PluginPackage) -> bool:
    config = _hook_config(package)
    hooks = config.get("hooks", {})
    if not isinstance(hooks, dict) or not all(_commands(package, groups) for groups in hooks.values()):
        return False
    if "modules" in config:
        return _modules(package, config)
    return bool(hooks)


def _session_hook(package: PluginPackage) -> bool:
    hooks = _hook_config(package).get("hooks")
    return isinstance(hooks, dict) and _commands(package, hooks.get("SessionStart"))


def _perplexity_skills(package: PluginPackage, archive: bytes | None) -> bool:
    return not validate_archive(build_archive(package) if archive is None else archive, require_skills=True)


_VERIFIERS: dict[str, Callable[[PluginPackage], bool]] = {
    "claude-skill-layout": lambda package: _manifest(package) and _skills(package),
    "claude-agent-layout": _agents,
    "claude-hook-layout": _hooks,
    "claude-module-layout": lambda package: _modules(package, _hook_config(package)),
    "claude-session-hook-layout": _session_hook,
    "codex-skill-layout": _skills,
}


def _verify(verifier: str, package: PluginPackage, archive: bytes | None) -> bool:
    try:
        if verifier == "perplexity-zip-validation":
            return _perplexity_skills(package, archive)
        check = _VERIFIERS.get(verifier)
        return check is not None and check(package)
    except (OSError, RuntimeError, ValueError):
        return False


def compatibility_report(
    package: PluginPackage, target: str, *, archive: bytes | None = None,
) -> dict[str, Any]:
    """Report equivalence only for enabled projections with a successful check."""
    target_config = package.target(target)
    enabled = target_config.get("enabled") is True
    capabilities: list[dict[str, Any]] = []
    compatible = enabled
    for name, policy in sorted(package.capabilities.items()):
        status, origin, verifier = SUPPORT[target].get(name, ("absent", "none", ""))
        if status == "equivalent" and (not enabled or not _verify(verifier, package, archive)):
            status, origin = "absent", "none"
            reason = f"{verifier} did not pass" if enabled else f"{target} projection is disabled"
            verifier = ""
        elif status == "equivalent":
            reason = f"verified by {verifier}"
        elif status == "advisory-loss":
            reason = f"{target} keeps the portable instructions but not the host integration"
        else:
            reason = f"{target} has no projection for this capability"
        if enabled and policy == "required" and status != "equivalent":
            compatible = False
        capabilities.append({
            "name": name,
            "policy": policy,
            "status": status,
            "origin": origin,
            "verifierId": verifier or None,
            "reason": reason,
        })
    return {
        "schemaVersion": 1,
        "plugin": package.name,
        "target": target,
        "enabled": enabled,
        "compatible": compatible,
        "capabilities": capabilities,
    }
