#!/usr/bin/env python3
"""Stamp the root manifest of each plugin from a cycle-free content digest.

The digest covers canonical plugin sources, including untracked files during a
build, but excludes host projections and distribution output. The manifest
version is removed before hashing, so one stamp followed by repeated checks is
stable.

Only the root plugin.json is written. The Claude manifest
(.claude-plugin/plugin.json) is a projection of it: run this script first, then
`scripts/pluginctl.py build`. `--check` also reports a Claude manifest that is
not the projection of the stamped root.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

from pluginlib.manifest import CLAUDE_MANIFEST, render_claude_manifest
from pluginlib.sources import source_files, trust_executable_mode


EXCLUDED_PARTS = {".claude-plugin", ".codex-plugin", "dist", "__pycache__"}
MANIFESTS = ("plugin.json",)


def _canonical_bytes(data: bytes, relative: str) -> bytes:
    if relative in MANIFESTS:
        document = json.loads(data.decode("utf-8"))
        document.pop("version", None)
        return json.dumps(
            document, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    return data


def _generated(plugin: Path, relative: Path) -> bool:
    if any(part in EXCLUDED_PARTS for part in relative.parts) and relative.as_posix() not in MANIFESTS:
        return True
    if relative.parts[:2] == ("io.github.kodflow", "projections"):
        return True
    return (
        len(relative.parts) == 2
        and relative.parts[0] == "agents"
        and relative.suffix == ".md"
        and (plugin / "io.github.kodflow" / "roles" / relative.stem / "role.yaml").is_file()
    )


def compute(root: Path, plugin: str) -> str:
    digest = hashlib.sha256()
    package = Path("plugins") / plugin
    trust_executable = trust_executable_mode(root)
    for source in source_files(root, package.as_posix()):
        relative = source.path.relative_to(package)
        if _generated(root / package, relative):
            continue
        name = relative.as_posix()
        mode = source.mode(root, trust_executable)
        content = hashlib.sha256(_canonical_bytes(source.content(root), name)).hexdigest()
        digest.update(f"{mode} {content} ".encode("ascii") + os.fsencode(name) + b"\n")
    return "0.0.0-r" + digest.hexdigest()[:12]


def _render(path: Path, version: str) -> str:
    document = json.loads(path.read_text(encoding="utf-8"))
    document["version"] = version
    return json.dumps(document, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    arguments = argparse.ArgumentParser()
    arguments.add_argument("--check", action="store_true")
    arguments.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parent.parent
    )
    args = arguments.parse_args()
    root = args.root.resolve()
    stale: list[str] = []
    projections: list[str] = []
    for directory in sorted((root / "plugins").iterdir()):
        if directory.is_symlink() or not directory.is_dir() or not (directory / "plugin.json").is_file():
            continue
        path = directory / "plugin.json"
        claude = directory / CLAUDE_MANIFEST
        if any(item.is_symlink() for item in (path, path.parent, claude, claude.parent)):
            print(f"cannot stamp linked manifest: {path.relative_to(root)}", file=sys.stderr)
            return 1
        version = compute(root, directory.name)
        manifest = json.loads(path.read_text(encoding="utf-8"))
        current = manifest.get("version")
        if current != version:
            stale.append(f"{path.relative_to(root)}: {current} -> {version}")
            if not args.check:
                path.write_bytes(_render(path, version).encode("utf-8"))
        if claude.is_file():
            try:
                expected = render_claude_manifest({**manifest, "version": version})
            except ValueError as error:
                print(f"invalid Claude overlay in {path.relative_to(root)}: {error}", file=sys.stderr)
                return 1
            # A CRLF checkout of the generated file is still the projection.
            if claude.read_bytes().replace(b"\r\n", b"\n") != expected:
                projections.append(claude.relative_to(root).as_posix())
    for item in stale:
        print(("stale " if args.check else "stamped ") + item)
    for item in projections:
        print(f"{'stale' if args.check else 'regenerate'} projection {item}")
    if args.check and (stale or projections):
        print(
            "run scripts/stamp-versions.py, then scripts/pluginctl.py build, and commit the result",
            file=sys.stderr,
        )
    elif projections:
        print("now run scripts/pluginctl.py build to regenerate the Claude manifests", file=sys.stderr)
    return int(args.check and bool(stale or projections))


if __name__ == "__main__":
    raise SystemExit(main())
