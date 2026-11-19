#!/usr/bin/env python3
"""Prepare release artifacts from an exact Git commit."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def _render_snapshot(source: Path, commit: str, staged: Path) -> None:
    staged.mkdir()
    subprocess.run([
        sys.executable, "-I", "-c",
        """
import sys
from pathlib import Path

source = Path.cwd()
sys.path.insert(0, str(source / "scripts"))
from pluginlib.release import render_profiles

for name, data in render_profiles(source, sys.argv[1]).items():
    (Path(sys.argv[2]) / name).write_bytes(data)
""",
        commit, str(staged),
    ], cwd=source, check=True)


def release_at(commit: str, output: Path) -> Path:
    if re.fullmatch(r"[a-f0-9]{40}", commit) is None:
        raise ValueError("--ref must be the full 40-character Git commit SHA")
    actual = subprocess.check_output(
        ["git", "-C", str(ROOT), "rev-parse", "--verify", f"{commit}^{{commit}}"], text=True,
    ).strip()
    if actual != commit:
        raise ValueError("--ref must refer directly to the content commit")

    output.mkdir(parents=True, exist_ok=True)
    destination = output / commit
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=output) as staging:
        staging = Path(staging)
        bundle = staging / "source.tar"
        subprocess.run(["git", "-C", str(ROOT), "archive", "--output", str(bundle), commit], check=True)
        source = staging / "source"
        with tarfile.open(bundle) as archive:
            archive.extractall(source, filter="data")
        subprocess.run([sys.executable, "scripts/sanitize.py", "."], cwd=source, check=True)
        for command in (
            ("validate", "--all"),
            ("build", "--targets", "all", "--check"),
            ("compat", "--targets", "all", "--fail-required-loss"),
            ("roles", "--check"),
            ("workflows", "--check"),
        ):
            subprocess.run(
                [sys.executable, "scripts/pluginctl.py", *command], cwd=source, check=True,
                stdout=subprocess.DEVNULL if command[0] == "compat" else None,
            )
        staged = staging / "artifacts"
        _render_snapshot(source, commit, staged)
        files = list(staged.iterdir())
        if destination.exists():
            if (destination.is_symlink() or not destination.is_dir()
                or {path.name for path in destination.iterdir()} != {path.name for path in files}
                or any((destination / path.name).is_symlink() or
                       (destination / path.name).read_bytes() != path.read_bytes() for path in files)):
                raise ValueError(f"release output already exists with different contents: {destination}")
            return destination
        staged.rename(destination)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/releases")
    args = parser.parse_args()
    try:
        print(release_at(args.ref, args.output.resolve()))
    except (OSError, ValueError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(f"release: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
