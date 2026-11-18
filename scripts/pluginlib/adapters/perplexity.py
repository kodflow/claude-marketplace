"""Deterministic Perplexity Agent Plugin ZIP projection."""

from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from ..model import PluginPackage


MAX_SKILLS = 32
MAX_FILES = 1000
MAX_BYTES = 20 * 1024 * 1024
MAX_MCP_SERVERS = 15


def _files(package: PluginPackage) -> list[Path]:
    files = [package.root / "plugin.json"]
    for relative in ("skills", "assets"):
        root = package.root / relative
        if root.is_dir():
            files.extend(path for path in root.rglob("*") if path.is_file())
    if (package.root / "mcp.json").is_file():
        files.append(package.root / "mcp.json")
    return sorted(set(files), key=lambda path: path.relative_to(package.root).as_posix())


def build_archive(package: PluginPackage) -> bytes:
    """Build byte-for-byte reproducible ZIP content."""

    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for source in _files(package):
            name = source.relative_to(package.root).as_posix()
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = (0o100755 if source.stat().st_mode & 0o111 else 0o100644) << 16
            info.create_system = 3
            archive.writestr(info, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    return output.getvalue()


def validate_archive(data: bytes) -> list[str]:
    """Enforce Perplexity's documented import limits and MCP subset."""

    errors: list[str] = []
    if len(data) > MAX_BYTES:
        errors.append(f"archive exceeds {MAX_BYTES} bytes")
    with ZipFile(BytesIO(data)) as archive:
        names = archive.namelist()
        if len(names) > MAX_FILES:
            errors.append(f"archive has more than {MAX_FILES} files")
        if "plugin.json" not in names:
            errors.append("plugin.json must be at archive root")
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts:
                errors.append(f"unsafe archive path: {name}")
        skill_names = {
            PurePosixPath(name).parts[1]
            for name in names
            if len(PurePosixPath(name).parts) >= 3
            and PurePosixPath(name).parts[0] == "skills"
            and PurePosixPath(name).name == "SKILL.md"
        }
        if len(skill_names) > MAX_SKILLS:
            errors.append(f"archive has more than {MAX_SKILLS} skills")
        if "mcp.json" in names:
            mcp = json.loads(archive.read("mcp.json"))
            servers = mcp.get("mcpServers", {})
            if len(servers) > MAX_MCP_SERVERS:
                errors.append(f"archive has more than {MAX_MCP_SERVERS} MCP servers")
            for name, server in sorted(servers.items()):
                if server.get("type") not in {"streamable-http", "sse"}:
                    errors.append(f"MCP server {name!r} is not remote HTTP")
                if not str(server.get("url", "")).startswith("https://"):
                    errors.append(f"MCP server {name!r} needs an HTTPS URL")
                if server.get("headers"):
                    errors.append(f"MCP server {name!r} has fixed headers Perplexity skips")
    return sorted(set(errors))
