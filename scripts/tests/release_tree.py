#!/usr/bin/env python3
"""Unpack a release's claude-full profile into a marketplace tree, after proof
that it is the checked-out commit.

  release_tree.py <release dir> <destination>

The release directory is what scripts/plugin-release.py wrote (the canary's
marketplace-<sha> artifact). Refused unless: every file named by
release-lock.json has its digest and size, the lock's sourceCommit is HEAD,
and every member of claude-full.zip is the file of the same path at HEAD, byte
for byte and executable bit included. The destination then holds the members
with their modes, ready for scripts/tests/smoke-plugins.sh --tree.
"""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys
from zipfile import ZipFile


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    release, destination = Path(sys.argv[1]), Path(sys.argv[2])
    root = Path(__file__).resolve().parents[2]
    head = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    lock = json.loads((release / "release-lock.json").read_text(encoding="utf-8"))
    bad = []
    if lock.get("sourceCommit") != head:
        bad.append(f"release of {lock.get('sourceCommit')}, checkout at {head}")
    for artifact in lock["artifacts"]:
        data = (release / artifact["file"]).read_bytes()
        if sha256(data).hexdigest() != artifact["sha256"] or len(data) != artifact["bytes"]:
            bad.append(f"{artifact['file']} does not match release-lock.json")
    members = 0
    with ZipFile(release / "claude-full.zip") as archive:
        for info in archive.infolist():
            name = PurePosixPath(info.filename)
            if info.is_dir() or name.is_absolute() or ".." in name.parts:
                bad.append(f"unexpected member {info.filename}")
                continue
            if name.parts[0] not in ("plugins", ".claude-plugin"):
                continue  # compatibility.json, provenance.json: release metadata
            data = archive.read(info)
            executable = bool((info.external_attr >> 16) & 0o111)
            listed = subprocess.run(["git", "-C", str(root), "ls-files", "-s", "--", info.filename],
                                    capture_output=True, text=True, check=True).stdout.split()
            source = root / info.filename
            if not listed or not source.is_file() or source.read_bytes() != data:
                bad.append(f"{info.filename} differs from HEAD")
            elif (listed[0] == "100755") != executable:
                bad.append(f"{info.filename}: executable bit differs from HEAD")
            target = destination / info.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o755 if executable else 0o644)
            members += 1
    for item in bad:
        print(f"::error::release: {item}")
    if bad:
        return 1
    print(f"release {head}: claude-full holds {members} files, each the checkout's")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
