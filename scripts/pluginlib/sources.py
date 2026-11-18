"""Select plugin sources using Git's ignore rules and text classification."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import stat
import subprocess


@dataclass(frozen=True)
class SourceFile:
    path: Path
    index_mode: str | None = None
    normalize_eol: bool = False

    def content(self, root: Path) -> bytes:
        path = root / self.path
        if path.is_symlink():
            return os.fsencode(os.readlink(path))
        real = path.resolve(strict=True)
        if not real.is_relative_to(root.resolve()):
            raise ValueError(f"source leaves the checkout: {self.path.as_posix()}")
        data = real.read_bytes()
        return data.replace(b"\r\n", b"\n") if self.normalize_eol else data

    def mode(self, root: Path, trust_executable: bool) -> str:
        path = root / self.path
        if path.is_symlink():
            return "120000"
        if self.index_mode and (not trust_executable or self.index_mode == "120000"):
            return self.index_mode
        return "100755" if path.stat().st_mode & stat.S_IXUSR else "100644"


def _git_sources(root: Path, scope: str) -> dict[Path, SourceFile]:
    result = subprocess.run(
        [
            "git", "-C", str(root), "ls-files", "--stage", "--eol", "-z",
            "--cached", "--others", "--exclude-standard", "--", scope,
        ],
        check=True,
        capture_output=True,
    )
    files = {}
    for entry in result.stdout.split(b"\0"):
        if not entry:
            continue
        metadata, rest = entry.split(b"\t", 1)
        index_mode = None
        if not metadata.startswith(b"i/"):
            mode, _, stage = metadata.split()
            if stage != b"0":
                raise ValueError("cannot inventory or stamp sources with unresolved Git conflicts")
            index_mode = mode.decode("ascii")
            metadata, rest = rest.split(b"\t", 1)
        path = Path(os.fsdecode(rest))
        absolute = root / path
        if not (absolute.is_symlink() or absolute.is_file()):
            continue  # A tracked file may have been removed from the working tree.
        index_and_worktree, attributes = metadata.split(b"attr/", 1)
        _, worktree = index_and_worktree.split()
        # Git identifies text checkout conversions. A binary attribute or a
        # binary worktree classification keeps the original bytes verbatim.
        normalize = worktree in {b"w/crlf", b"w/mixed"} and b"-text" not in attributes.split()
        files[path] = SourceFile(path, index_mode, normalize)
    return files


def source_files(root: Path, scope: str) -> list[SourceFile]:
    """Include tracked files and new sources, omitting ignored local output."""
    if (root / ".git").exists():
        return sorted(
            _git_sources(root, scope).values(),
            key=lambda source: os.fsencode(source.path.as_posix()),
        )
    # Release tarballs already contain the source selection and canonical bytes.
    return [
        SourceFile(path.relative_to(root))
        for path in sorted((root / scope).rglob("*"), key=lambda entry: os.fsencode(entry.as_posix()))
        if path.is_symlink() or path.is_file()
    ]


def trust_executable_mode(root: Path) -> bool:
    if not (root / ".git").exists():
        return True
    result = subprocess.run(
        ["git", "-C", str(root), "config", "--bool", "--get", "core.filemode"],
        capture_output=True,
    )
    return result.stdout.strip() != b"false"
