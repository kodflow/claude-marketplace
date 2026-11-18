"""Deterministic Perplexity Agent Plugin ZIP projection."""

from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile, ZipInfo

from ..model import PluginPackage


MAX_SKILLS = 32
MAX_FILES = 1000
MAX_BYTES = 20 * 1024 * 1024
MAX_MCP_SERVERS = 15
MAX_DESCRIPTION_BYTES = 1024


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
        files = {path.relative_to(package.root).as_posix(): path for path in _files(package)}
        for workflow in ("search", "review"):
            source = package.root / f"io.github.kodflow/projections/workflows/{workflow}-perplexity.md"
            if source.is_file():
                if f"skills/{workflow}/SKILL.md" not in files:
                    raise ValueError(f"workflow {workflow} has no skill in {package.name}")
                files[f"skills/{workflow}/workflow-perplexity.md"] = source
        for name, source in sorted(files.items()):
            source = source.resolve(strict=True)
            if not source.is_relative_to(package.root.resolve(strict=True)):
                raise ValueError(f"archive source is outside {package.name}: {name}")
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = (0o100755 if source.stat().st_mode & 0o111 else 0o100644) << 16
            info.create_system = 3
            archive.writestr(info, source.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    return output.getvalue()


def _https_endpoint(value: object) -> bool:
    if not isinstance(value, str) or any(c in "{}$" or c.isspace() for c in value):
        return False
    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError:
        return False
    return parsed.scheme == "https" and bool(parsed.hostname) and parsed.username is None


def validate_archive(data: bytes) -> list[str]:
    """Enforce Perplexity's documented import limits and MCP subset."""

    try:
        with ZipFile(BytesIO(data)) as archive:
            return _validate_members(archive)
    except (BadZipFile, OSError, RuntimeError, ValueError) as error:
        return [f"invalid archive: {error}"]


def _validate_members(archive: ZipFile) -> list[str]:
    errors: list[str] = []
    names = archive.namelist()
    if sum(member.file_size for member in archive.infolist()) > MAX_BYTES:
        return [f"archive exceeds {MAX_BYTES} uncompressed bytes"]
    if len(names) > MAX_FILES:
        errors.append(f"archive has more than {MAX_FILES} files")
    if "plugin.json" not in names:
        errors.append("plugin.json must be at archive root")
    if len(set(names)) != len(names):
        errors.append("duplicate archive member names")
    if "plugin.json" in names:
        manifest = json.loads(archive.read("plugin.json"))
        if not isinstance(manifest, dict) or not isinstance(manifest.get("name"), str) or not manifest["name"]:
            errors.append("plugin.json must define a plugin name")
        else:
            description = manifest.get("description", "")
            if not isinstance(description, str) or len(description.encode("utf-8")) > MAX_DESCRIPTION_BYTES:
                errors.append(f"plugin description exceeds {MAX_DESCRIPTION_BYTES} UTF-8 bytes or is not text")
    for name in names:
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or "\\" in name:
            errors.append(f"unsafe archive path: {name}")
    skill_names = {
        PurePosixPath(name).parts[1]
        for name in names
        if len(PurePosixPath(name).parts) == 3
        and PurePosixPath(name).parts[0] == "skills"
        and PurePosixPath(name).name == "SKILL.md"
    }
    if len(skill_names) > MAX_SKILLS:
        errors.append(f"archive has more than {MAX_SKILLS} skills")
    servers = {}
    if "mcp.json" in names:
        mcp = json.loads(archive.read("mcp.json"))
        servers = mcp.get("mcpServers", {}) if isinstance(mcp, dict) else None
        if not isinstance(servers, dict):
            return sorted({*errors, "mcp.json must contain an object of servers"})
        if len(servers) > MAX_MCP_SERVERS:
            errors.append(f"archive has more than {MAX_MCP_SERVERS} MCP servers")
        for name, server in sorted(servers.items()):
            if not isinstance(server, dict):
                errors.append(f"MCP server {name!r} must be an object")
                continue
            if server.get("type") not in {"streamable-http", "http", "sse"}:
                errors.append(f"MCP server {name!r} is not remote HTTP")
            if not _https_endpoint(server.get("url")):
                errors.append(f"MCP server {name!r} needs a resolved HTTPS URL")
            if server.get("headers"):
                errors.append(f"MCP server {name!r} has fixed headers Perplexity skips")
    if not skill_names and not servers:
        errors.append("archive must contain at least one skill or remote MCP connector")
    return sorted(set(errors))
