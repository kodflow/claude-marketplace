"""Deterministic Perplexity Agent Plugin ZIP projection."""

from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile, ZipInfo

from ..model import PluginPackage
from ..sources import source_files


MAX_SKILLS = 32
MAX_FILES = 1000
MAX_BYTES = 20 * 1024 * 1024
MAX_MCP_SERVERS = 15
MAX_DESCRIPTION_BYTES = 1024


def _files(package: PluginPackage) -> list[Path]:
    root = package.root.resolve(strict=True)
    for relative in ("skills", "assets"):
        if not (root / relative).resolve().is_relative_to(root):
            raise ValueError(f"archive sources are outside {package.name}: {relative}")

    # A release snapshot may itself be staged inside another Git checkout.
    checkout = root
    selection = "."
    for parent in (root, *root.parents):
        if (parent / ".git").exists():
            checkout = parent
            selection = f":(literal){root.relative_to(checkout).as_posix()}"
            break
        if (parent / "catalog/catalog.json").is_file():
            break

    scope = root.relative_to(checkout)
    files = []
    for source in source_files(checkout, selection):
        relative = source.path.relative_to(scope)
        candidate = package.root / relative
        if (relative.parts[:1] in {("skills",), ("assets",)} or relative == Path("mcp.json")) and candidate.is_file():
            files.append(candidate)
    return files


def build_archive(package: PluginPackage) -> bytes:
    """Build byte-for-byte reproducible ZIP content."""

    output = BytesIO()
    root = package.root.resolve(strict=True)
    manifest = json.dumps(package.manifest, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        files: dict[str, Path | None] = {
            path.relative_to(package.root).as_posix(): path for path in _files(package)
        }
        files["plugin.json"] = None
        total = len(manifest)
        for name, source in sorted(files.items()):
            mode = 0o100644
            if source is not None:
                source = source.resolve(strict=True)
                if not source.is_relative_to(root):
                    raise ValueError(f"archive source is outside {package.name}: {name}")
                metadata = source.stat()
                total += metadata.st_size
                if total > MAX_BYTES:
                    raise ValueError(f"archive exceeds {MAX_BYTES} uncompressed bytes")
                if metadata.st_mode & 0o111:
                    mode = 0o100755
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = mode << 16
            info.create_system = 3
            archive.writestr(info, manifest if source is None else source.read_bytes(),
                            compress_type=ZIP_DEFLATED, compresslevel=9)
    return output.getvalue()


def _https_endpoint(value: object) -> bool:
    if not isinstance(value, str) or any(c in "{}" or c.isspace() for c in value):
        return False
    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError:
        return False
    return parsed.scheme == "https" and bool(parsed.hostname) and parsed.username is None


def validate_archive(data: bytes, *, require_skills: bool = False) -> list[str]:
    """Enforce Perplexity's documented import limits and MCP subset."""

    try:
        with ZipFile(BytesIO(data)) as archive:
            return _validate_members(archive, require_skills=require_skills)
    except (BadZipFile, OSError, RuntimeError, ValueError) as error:
        return [f"invalid archive: {error}"]


def _validate_members(archive: ZipFile, *, require_skills: bool) -> list[str]:
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
    if require_skills and not skill_names:
        errors.append("archive must contain a skill for the skills capability")
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
            transport = server.get("type")
            if not isinstance(transport, str) or transport not in {"streamable-http", "http", "sse"}:
                errors.append(f"MCP server {name!r} is not remote HTTP")
            if not _https_endpoint(server.get("url")):
                errors.append(f"MCP server {name!r} needs a resolved HTTPS URL")
            if server.get("headers"):
                errors.append(f"MCP server {name!r} has fixed headers Perplexity skips")
    if not skill_names and not servers:
        errors.append("archive must contain at least one skill or remote MCP connector")
    return sorted(set(errors))
