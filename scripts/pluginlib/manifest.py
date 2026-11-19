"""Project the portable root manifest into the Claude Code plugin manifest.

The root ``plugin.json`` is the only hand-edited manifest. The Claude copy at
``.claude-plugin/plugin.json`` is generated from it, plus the Claude-only
fields listed under ``extensions."io.github.kodflow".targets.claude.manifest``
(``types``, ``userConfig``...). This module stays standard-library only so
``scripts/stamp-versions.py`` can run it without the project environment.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .model import EXTENSION_NAMESPACE


CLAUDE_MANIFEST = ".claude-plugin/plugin.json"
# Root fields copied verbatim into the Claude manifest, in this order of
# precedence: the overlay may add fields but never redefine these identities.
SHARED_FIELDS = ("name", "version", "description", "author", "homepage", "license")
RESERVED_OVERLAY_FIELDS = frozenset({"name", "version", "description", "engines"})
# `engines` in a plugin manifest is read from this release on; older engines
# would reject a marketplace whose entry carried it, so it is emitted only when
# the declared floor already excludes them.
ENGINES_FLOOR = (2, 1, 323)
VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)")


def canonical_json(value: Any) -> str:
    """Serialise the way every generated projection of this repository is."""
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _claude_target(manifest: dict[str, Any]) -> Any:
    extensions = manifest.get("extensions")
    extension = extensions.get(EXTENSION_NAMESPACE) if isinstance(extensions, dict) else None
    targets = extension.get("targets") if isinstance(extension, dict) else None
    return targets.get("claude") if isinstance(targets, dict) else None


def _parse_version(value: str) -> tuple[int, int, int] | None:
    match = VERSION.fullmatch(value)
    return tuple(int(part) for part in match.groups()) if match else None  # type: ignore[return-value]


def overlay_issues(manifest: dict[str, Any]) -> list[str]:
    """Return why the Claude overlay of a root manifest cannot be projected."""
    issues: list[str] = []
    extensions = manifest.get("extensions")
    extension = extensions.get(EXTENSION_NAMESPACE) if isinstance(extensions, dict) else None
    targets = extension.get("targets") if isinstance(extension, dict) else None
    if isinstance(targets, dict):
        for name, target in sorted(targets.items()):
            if name != "claude" and isinstance(target, dict) and "manifest" in target:
                issues.append(f"targets.{name}.manifest: only the claude target carries a manifest overlay")
    claude = _claude_target(manifest)
    if not isinstance(claude, dict):
        return issues
    overlay = claude.get("manifest", {})
    if not isinstance(overlay, dict):
        return [*issues, "targets.claude.manifest must be an object"]
    for key in sorted(RESERVED_OVERLAY_FIELDS & set(overlay)):
        issues.append(
            f"targets.claude.manifest.{key} is derived from the root manifest and cannot be redefined"
        )
    floor = claude.get("minimumVersion")
    if floor is not None and (not isinstance(floor, str) or _parse_version(floor) is None):
        issues.append(f"targets.claude.minimumVersion must be MAJOR.MINOR.PATCH, got {floor!r}")
    return issues


def project_claude_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    """Build the Claude manifest, or raise ValueError when the overlay is invalid."""
    issues = overlay_issues(manifest)
    if issues:
        raise ValueError("; ".join(issues))
    projected = {key: manifest[key] for key in SHARED_FIELDS if key in manifest}
    claude = _claude_target(manifest)
    if isinstance(claude, dict):
        floor = claude.get("minimumVersion")
        parsed = _parse_version(floor) if isinstance(floor, str) else None
        if parsed is not None and parsed >= ENGINES_FLOOR:
            projected["engines"] = {"claude-code": f">={floor}"}
        projected.update(claude.get("manifest", {}))
    return projected


def render_claude_manifest(manifest: dict[str, Any]) -> bytes:
    return canonical_json(project_claude_manifest(manifest)).encode("utf-8")
