"""Create reproducible, Git-pinned release profiles."""

from __future__ import annotations

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from .adapters import build_archive, compatibility_report, validate_archive
from .inventory import canonical_json
from .model import Catalog, PluginPackage
from .roles import perplexity_role_skills


PROFILES = ("portable", "claude-full", "openai-local", "openai-public", "perplexity")
# The projections travel with the skills: their SKILL.md links them by package path.
PORTABLE = ("plugin.json", "mcp.json", "skills", "assets", "bin", "io.github.kodflow/projections")
LOCAL_OPENAI = (*PORTABLE, ".codex-plugin", "hooks", "io.github.kodflow")


def _bytes(data: object) -> bytes:
    return canonical_json(data).encode("utf-8")


def zip_members(files: dict[str, tuple[bytes, bool]]) -> bytes:
    """Archive named members with stable timestamps, order, and modes."""
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for name, (data, executable) in sorted(files.items()):
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name:
                raise ValueError(f"unsafe archive member: {name}")
            info = ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.external_attr = (0o100755 if executable else 0o100644) << 16
            info.create_system = 3
            archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
    return output.getvalue()


def _add(files: dict, root: Path, source: Path, prefix: str = "") -> None:
    if source.is_dir() and not source.is_symlink():
        for child in sorted(source.iterdir()):
            _add(files, root, child, prefix)
        return
    if not source.is_file() and not source.is_symlink():
        return
    real = source.resolve(strict=True)
    if not real.is_file() or not real.is_relative_to(root.resolve()):
        raise ValueError(f"release source escapes its root: {source.relative_to(root)}")
    name = prefix + source.relative_to(root).as_posix()
    files[name] = (real.read_bytes(), bool(real.stat().st_mode & 0o111))


def _package(files: dict, package: PluginPackage, paths: tuple[str, ...]) -> None:
    for path in paths:
        _add(files, package.root, package.root / path, f"plugins/{package.name}/")


def _profile_catalog(source: dict, included: set[str]) -> bytes:
    # Pinned third-party entries are a Claude marketplace concern only; no
    # release profile ships or describes them.
    kept = {key: value for key, value in source.items() if key != "externals"}
    return _bytes({**kept, "plugins": [entry for entry in source["plugins"] if entry["name"] in included]})


def _role_archives(root: Path, packages: list[PluginPackage], files: dict) -> None:
    for package in packages:
        roles = sorted(perplexity_role_skills(package.root, root / "schemas").items())
        for start in range(0, len(roles), 15):
            batch = start // 15 + 1
            name = f"{package.name}-role-skills-{batch}"
            members = {path: (data, False) for path, data in roles[start:start + 15]}
            members["plugin.json"] = (_bytes({
                "name": name,
                "version": package.manifest["version"],
                "description": "Advisory role skills. No autonomous subagent identity or sandbox is provided.",
            }), False)
            bundle = zip_members(members)
            if errors := validate_archive(bundle):
                raise ValueError(f"{name}: {', '.join(errors)}")
            files[f"{name}.zip"] = (bundle, False)


def render_profiles(root: Path, commit: str) -> dict[str, bytes]:
    """Build all five profiles and a separate lock with SHA-256 digests."""
    catalog = Catalog.load(root / "catalog/catalog.json")
    packages = catalog.packages()
    openai_index = json.loads(
        (root / ".agents/plugins/marketplace.json").read_text(encoding="utf-8")
    )
    profiles: dict[str, bytes] = {}
    for profile in PROFILES:
        files: dict[str, tuple[bytes, bool]] = {}
        reports = []
        for package in packages:
            if profile == "portable":
                absent = [
                    {"name": name, "policy": policy, "status": "absent"}
                    for name, policy in sorted(package.capabilities.items())
                    if name not in {"skills", "mcp"}
                ]
                enabled = (
                    package.skill_directories() or (package.root / "mcp.json").is_file()
                ) and not any(cap["policy"] == "required" for cap in absent)
                if enabled:
                    _package(files, package, PORTABLE)
                reports.append({
                    "plugin": package.name,
                    "enabled": bool(enabled),
                    "capabilities": absent,
                })
                continue
            target = "openai" if profile.startswith("openai-") else ("claude" if profile == "claude-full" else profile)
            report = compatibility_report(package, target)
            reports.append(report)
            if not report["enabled"]:
                continue
            if not report["compatible"]:
                raise ValueError(f"incompatible {target} projection: {package.name}")
            if profile == "perplexity":
                archive = build_archive(package)
                if errors := validate_archive(archive):
                    raise ValueError(f"{package.name}: {', '.join(errors)}")
                files[f"{package.name}.zip"] = (archive, False)
            elif profile == "claude-full":
                _package(files, package, tuple(path.name for path in package.root.iterdir()))
            else:
                _package(files, package, LOCAL_OPENAI if profile == "openai-local" else PORTABLE)
                if profile == "openai-public":
                    for capability in report["capabilities"]:
                        if capability["name"] not in {"skills", "mcp"} and capability["status"] == "equivalent":
                            capability.update(status="advisory-loss", origin="generated", verifierId=None,
                                              reason="the public profile ships portable content")
                            if capability["policy"] == "required":
                                raise ValueError(f"public profile loses required {capability['name']}: {package.name}")
        if profile == "claude-full":
            _add(files, root, root / ".claude-plugin/marketplace.json")
        if profile.startswith("openai-"):
            names = {report["plugin"] for report in reports if report["enabled"]}
            files[".agents/plugins/marketplace.json"] = (_profile_catalog(openai_index, names), False)
        if profile == "openai-local":
            _add(files, root, root / "codex/agents")
        if profile == "perplexity":
            _role_archives(root, packages, files)
        if profile == "portable":
            names = {report["plugin"] for report in reports if report["enabled"]}
            files["catalog/catalog.json"] = (_profile_catalog(catalog.data, names), False)

        omitted = [
            {"plugin": report["plugin"], "name": cap["name"], "policy": cap["policy"], "status": cap["status"]}
            for report in reports for cap in report["capabilities"]
            if not report["enabled"] or cap["status"] != "equivalent"
        ]
        files["compatibility.json"] = (_bytes(reports), False)
        files["provenance.json"] = (_bytes({
            "schemaVersion": 1, "sourceCommit": commit, "profile": profile, "omittedCapabilities": omitted,
        }), False)
        profiles[f"{profile}.zip"] = zip_members(files)

    profiles["release-lock.json"] = _bytes({
        "schemaVersion": 1,
        "sourceCommit": commit,
        "artifacts": [
            {"file": name, "sha256": sha256(data).hexdigest(), "bytes": len(data)}
            for name, data in sorted(profiles.items())
        ],
    })
    return profiles
