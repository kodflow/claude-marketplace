"""Capability semantics shared by all host adapters."""

from __future__ import annotations

from typing import Any

from ..model import PluginPackage


SUPPORT: dict[str, dict[str, tuple[str, str, str]]] = {
    "claude": {
        "skills": ("equivalent", "native", "claude-skill-load"),
        "agents": ("equivalent", "native", "claude-agent-load"),
        "hooks": ("equivalent", "native", "claude-hook-load"),
        "mods": ("equivalent", "native", "claude-mod-load"),
        "shell-integration": ("equivalent", "native", "claude-session-hook"),
        "multi-agent": ("advisory-loss", "generated", ""),
    },
    "openai": {
        "skills": ("equivalent", "native", "codex-skill-load"),
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
        "multi-agent": ("advisory-loss", "generated", ""),
    },
}


def compatibility_report(package: PluginPackage, target: str) -> dict[str, Any]:
    """Describe losses explicitly; equivalence always names its verifier."""

    target_config = package.target(target)
    enabled = bool(target_config.get("enabled"))
    capabilities: list[dict[str, Any]] = []
    compatible = enabled
    for name, policy in sorted(package.capabilities.items()):
        status, origin, verifier = SUPPORT[target].get(name, ("absent", "none", ""))
        if name == "multi-agent" and not any(
            (package.root / "io.github.kodflow/projections/workflows").glob(f"*-{target}.md")
        ):
            status, origin, verifier = "absent", "none", ""
        if status == "equivalent":
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
