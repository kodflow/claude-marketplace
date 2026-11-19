"""Move a pinned third-party catalog entry to a newer upstream commit.

Exit codes of the result: 0 pinned (or already current), 3 pinned although the
upstream content changed under an unchanged version, 4 refused because the
upstream version would go down, 1 any other refusal.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any
from urllib.parse import urlsplit


SHA = re.compile(r"[0-9a-f]{40}")
VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)(?:[-+].*)?")
UPSTREAM_MANIFEST = ".claude-plugin/plugin.json"
EXIT_SAME_VERSION = 3
EXIT_DOWNGRADE = 4


class BumpError(Exception):
    """A refused bump, carrying its JSON report and exit code."""

    def __init__(self, message: str, report: dict[str, Any] | None = None, exit_code: int = 1) -> None:
        super().__init__(message)
        self.report = {**(report or {}), "status": "refused", "reason": message}
        self.exit_code = exit_code


@dataclass
class BumpResult:
    report: dict[str, Any] = field(default_factory=dict)
    changed: bool = False
    exit_code: int = 0


def _git(*args: str, cwd: Path | None = None) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )
    if result.returncode:
        raise BumpError(f"git {args[0]} failed: {result.stderr.strip()}")
    return result.stdout


def remote_head(url: str) -> str:
    lines = _git("ls-remote", "--", url, "HEAD").split()
    if not lines or SHA.fullmatch(lines[0]) is None:
        raise BumpError(f"cannot resolve HEAD of {url}")
    return lines[0]


def _fetch(repository: Path, url: str, sha: str) -> None:
    try:
        _git("fetch", "--quiet", "--depth", "1", "--", url, sha, cwd=repository)
    except BumpError:
        # Some servers refuse a want for an unadvertised commit; fetch the refs.
        _git("fetch", "--quiet", "--", url, "+refs/heads/*:refs/remotes/upstream/*", cwd=repository)
    _git("cat-file", "-e", f"{sha}^{{commit}}", cwd=repository)


def _snapshot(repository: Path, sha: str) -> tuple[str | None, str]:
    """Return the upstream manifest version and the tree id at one commit."""
    tree = _git("rev-parse", f"{sha}^{{tree}}", cwd=repository).strip()
    try:
        raw = _git("show", f"{sha}:{UPSTREAM_MANIFEST}", cwd=repository)
    except BumpError:
        return None, tree
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as error:
        raise BumpError(f"{UPSTREAM_MANIFEST} at {sha} is not JSON: {error}") from error
    version = manifest.get("version") if isinstance(manifest, dict) else None
    return (version if isinstance(version, str) else None), tree


def _order(version: str | None) -> tuple[int, int, int] | None:
    match = VERSION.fullmatch(version) if version else None
    return tuple(int(part) for part in match.groups()) if match else None  # type: ignore[return-value]


def bump_external(
    catalog_path: Path, name: str, sha: str | None = None, *, schemes: tuple[str, ...] = ("https",),
) -> BumpResult:
    """Pin ``name`` to ``sha`` (default: upstream HEAD) and rewrite catalog.json."""
    text = catalog_path.read_text(encoding="utf-8")
    catalog = json.loads(text)
    entries = [entry for entry in catalog.get("externals", []) if entry.get("name") == name]
    if len(entries) != 1:
        raise BumpError(f"no single external named {name!r} in {catalog_path.name}")
    source = entries[0]["source"]
    url, current = source["url"], source["sha"]
    report: dict[str, Any] = {"name": name, "url": url, "from": {"sha": current}}
    if urlsplit(url).scheme not in schemes:
        raise BumpError(f"source.url must use {' or '.join(schemes)}", report)
    if SHA.fullmatch(current) is None:
        raise BumpError("the current pin is not a 40-character commit", report)
    target = sha if sha is not None else remote_head(url)
    if SHA.fullmatch(target) is None:
        raise BumpError(f"--sha must be 40 lowercase hexadecimal characters, got {target!r}", report)
    report["to"] = {"sha": target}
    with tempfile.TemporaryDirectory(prefix="bump-external-") as scratch:
        repository = Path(scratch)
        _git("init", "--quiet", cwd=repository)
        for commit in dict.fromkeys((current, target)):
            _fetch(repository, url, commit)
        before_version, before_tree = _snapshot(repository, current)
        after_version, after_tree = _snapshot(repository, target)
    report["from"]["version"], report["to"]["version"] = before_version, after_version
    report["contentChanged"] = before_tree != after_tree
    before, after = _order(before_version), _order(after_version)
    if before is not None and (after is None or after < before):
        raise BumpError(f"upstream version goes down: {before_version} -> {after_version}", report, EXIT_DOWNGRADE)
    if target == current:
        return BumpResult({**report, "status": "unchanged"})
    if text.count(current) != 1:
        raise BumpError("the current pin appears more than once in catalog.json", report)
    catalog_path.write_text(text.replace(current, target), encoding="utf-8")
    if report["contentChanged"] and before_version == after_version:
        return BumpResult({**report, "status": "content-changed-same-version"}, True, EXIT_SAME_VERSION)
    return BumpResult({**report, "status": "bumped"}, True)
