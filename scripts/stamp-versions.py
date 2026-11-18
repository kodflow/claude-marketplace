#!/usr/bin/env python3
"""Stamp portable and legacy manifests from a cycle-free content digest.

The digest covers canonical plugin sources, including untracked files during a
build, but excludes host projections and distribution output. Both manifest
versions are removed before hashing, so one stamp followed by repeated checks
is stable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import stat
import subprocess
import sys


EXCLUDED_PARTS = {".claude-plugin", ".codex-plugin", "dist", "__pycache__"}
MANIFESTS = ("plugin.json", ".claude-plugin/plugin.json")


def _tracked_and_untracked(root: Path, plugin: str) -> list[str]:
    result = subprocess.run(
        [
            "git", "-C", str(root), "ls-files", "--cached", "--others",
            "--exclude-standard", "-z", "--", f"plugins/{plugin}",
        ],
        check=True,
        capture_output=True,
    )
    return sorted(item for item in result.stdout.decode().split("\0") if item)


def _canonical_bytes(path: Path, relative: str) -> bytes:
    data = path.read_bytes()
    if relative in MANIFESTS:
        document = json.loads(data)
        document.pop("version", None)
        return json.dumps(
            document, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
    return data


def _generated(root: Path, relative: str) -> bool:
    path = Path(relative)
    if any(part in EXCLUDED_PARTS for part in path.parts) and relative not in MANIFESTS:
        return True
    if path.parts[:2] == ("io.github.kodflow", "projections"):
        return True
    return (
        len(path.parts) == 2
        and path.parts[0] == "agents"
        and path.suffix == ".md"
        and (root / "io.github.kodflow" / "roles" / path.stem / "role.yaml").is_file()
    )


def compute(root: Path, plugin: str) -> str:
    digest = hashlib.sha256()
    prefix = f"plugins/{plugin}/"
    for repository_path in _tracked_and_untracked(root, plugin):
        relative = repository_path.removeprefix(prefix)
        if _generated(root / prefix, relative):
            continue
        path = root / repository_path
        if not path.is_file():
            continue
        mode = "100755" if path.stat().st_mode & stat.S_IXUSR else "100644"
        content = hashlib.sha256(_canonical_bytes(path, relative)).hexdigest()
        digest.update(f"{mode} {content} {relative}\n".encode())
    return "0.0.0-r" + digest.hexdigest()[:12]


def _render(path: Path, version: str) -> str:
    document = json.loads(path.read_text())
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
    for directory in sorted((root / "plugins").iterdir()):
        if not directory.is_dir() or not (directory / "plugin.json").is_file():
            continue
        version = compute(root, directory.name)
        for manifest in MANIFESTS:
            path = directory / manifest
            if not path.is_file():
                continue
            current = json.loads(path.read_text()).get("version")
            if current == version:
                continue
            stale.append(f"{path.relative_to(root)}: {current} -> {version}")
            if not args.check:
                path.write_text(_render(path, version))
    for item in stale:
        print(("stale " if args.check else "stamped ") + item)
    if args.check and stale:
        print("run scripts/stamp-versions.py and commit the result", file=sys.stderr)
    return int(args.check and bool(stale))


if __name__ == "__main__":
    raise SystemExit(main())
