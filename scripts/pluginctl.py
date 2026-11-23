#!/usr/bin/env python3
"""Validate, report, and build the universal plugin projections."""

from __future__ import annotations

import argparse
from contextlib import ExitStack, redirect_stdout
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

from pluginlib.adapters import (
    build_archive,
    compatibility_report,
    render_claude_marketplace,
    render_openai_marketplace,
    validate_archive,
)
from pluginlib.codex_package import CODEX_PACKAGES, render_packages as render_codex_packages
from pluginlib.externals import BumpError, bump_external
from pluginlib.inventory import build_inventory, canonical_json
from pluginlib.manifest import CLAUDE_MANIFEST, render_claude_manifest
from pluginlib.model import Catalog, PluginPackage, TARGETS, ValidationIssue
from pluginlib.roles import build_role_artifacts, compile_roles
from pluginlib.sources import trust_executable_mode
from pluginlib.validate import MODES, validate_catalog_packages, validate_package, validate_plugin
from pluginlib.workflows import compile_projections


ROOT = Path(__file__).resolve().parent.parent
SCHEMAS = ROOT / "schemas"
CATALOG_PATH = ROOT / "catalog" / "catalog.json"
TARGET_ALIASES = {"codex": "openai", "openai": "openai", "claude": "claude", "perplexity": "perplexity"}


def _catalog() -> Catalog:
    return Catalog.load(CATALOG_PATH)


def _targets(raw: str) -> list[str]:
    if raw == "all":
        return list(TARGETS)
    result = []
    for value in raw.split(","):
        try:
            target = TARGET_ALIASES[value.strip()]
        except KeyError as error:
            raise SystemExit(f"unknown target: {value}") from error
        if target not in result:
            result.append(target)
    return result


def _stage_write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return temporary


def _atomic_write(path: Path, data: bytes) -> None:
    temporary = _stage_write(path, data)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _projection_destination(path: Path) -> None:
    try:
        inside = path.parent.resolve().is_relative_to(ROOT.resolve())
    except RuntimeError as error:
        raise ValueError(f"projection destination cannot be resolved: {path}") from error
    if not inside or path.is_symlink():
        raise ValueError(f"projection destination escapes the repository or is a symlink: {path}")


def _publish(outputs: dict[Path, bytes | None]) -> None:
    """Stage all outputs and prior bytes before the first replacement."""
    staged: dict[Path, Path | None] = {}
    previous: dict[Path, Path | None] = {}
    retained: set[Path] = set()

    def cleanup(path: Path) -> None:
        if path not in retained:
            path.unlink(missing_ok=True)

    with ExitStack() as clean:
        for path in outputs:
            _projection_destination(path)
        for path, data in outputs.items():
            current = _stage_write(path, data) if data is not None else None
            staged[path] = current
            if current is not None:
                clean.callback(cleanup, current)
            old = _stage_write(path, path.read_bytes()) if path.exists() else None
            previous[path] = old
            if old is not None:
                clean.callback(cleanup, old)
                mode = stat.S_IMODE(path.stat().st_mode)
                old.chmod(mode)
                if current is not None:
                    current.chmod(mode)
        attempted = []
        try:
            for path, source in staged.items():
                attempted.append(path)
                if source is None:
                    path.unlink(missing_ok=True)
                else:
                    os.replace(source, path)
        except (OSError, KeyboardInterrupt) as error:
            failures = []
            for path in reversed(attempted):
                source = staged[path]
                if (source is not None and source.exists()) or (source is None and path.exists()):
                    continue  # Replacement did not consume the staged file.
                backup = previous[path]
                try:
                    if backup is None:
                        path.unlink(missing_ok=True)
                    else:
                        os.replace(backup, path)
                except OSError as rollback_error:
                    if backup is not None:
                        retained.add(backup)
                    failures.append(f"{path} (backup: {backup}): {rollback_error}")
            if failures:
                raise OSError("rollback incomplete: " + "; ".join(failures)) from error
            raise


def _display_path(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def _print_issues(issues: list[ValidationIssue]) -> None:
    for issue in issues:
        print(f"{issue.severity}: {issue.code}: {issue.path}: {issue.message}")


def _catalog_packages(
    mode: str = "publisher-strict",
) -> tuple[Catalog | None, list[PluginPackage], list[ValidationIssue]]:
    try:
        catalog = _catalog()
    except (OSError, ValueError) as error:
        return None, [], [ValidationIssue("error", "catalog-manifest", str(CATALOG_PATH), str(error))]
    packages, issues = validate_catalog_packages(catalog, SCHEMAS, mode)
    return catalog, packages, issues


def _fixture_roots(root: Path) -> list[Path]:
    projections = {".claude-plugin", ".codex-plugin", ".agents"}
    roots = []
    for directory, children, filenames in os.walk(root):
        children[:] = [name for name in children if name not in projections]
        if "plugin.json" in filenames:
            roots.append(Path(directory))
    return sorted(roots)


def command_validate(args: argparse.Namespace) -> int:
    if not (args.all or args.fixtures or args.paths):
        raise SystemExit("validate needs --all, --fixtures, or at least one package path")
    if args.plugin_data_root is not None and (args.all or args.fixtures or len(args.paths) != 1):
        raise SystemExit("--plugin-data-root requires one explicit package path")
    if args.all:
        _, packages, issues = _catalog_packages(args.mode)
        for package in packages:
            issues.extend(validate_package(package, SCHEMAS, args.mode))
    else:
        packages, issues = [], []
    roots = list(args.paths)
    if args.fixtures:
        fixtures = _fixture_roots(args.fixtures)
        if not fixtures:
            issues.append(ValidationIssue("error", "fixture-root", str(args.fixtures), "no portable packages found"))
        roots.extend(fixtures)
    for path in roots:
        issues.extend(validate_plugin(path, SCHEMAS, args.mode, plugin_data_root=args.plugin_data_root))
    issues.sort(key=lambda item: (item.severity, item.path, item.code, item.message))
    _print_issues(issues)
    errors = sum(issue.severity == "error" for issue in issues)
    print(f"validated {len(packages) + len(roots)} plugin(s): {errors} error(s), {len(issues) - errors} warning(s)")
    return int(bool(errors))


def _verified_catalog() -> tuple[Catalog, list[PluginPackage]] | None:
    catalog, packages, issues = _catalog_packages()
    for package in packages:
        issues.extend(validate_package(package, SCHEMAS))
    if issues:
        _print_issues(issues)
    if catalog is None or any(issue.severity == "error" for issue in issues):
        return None
    return catalog, packages


def _reports(
    packages: list[PluginPackage], targets: list[str], archives: dict[str, bytes] | None = None,
) -> list[dict]:
    return [
        compatibility_report(package, target, archive=(archives or {}).get(package.name))
        for package in packages
        for target in targets
    ]


def command_compat(args: argparse.Namespace) -> int:
    snapshot = _verified_catalog()
    if snapshot is None:
        return 1
    _, packages = snapshot
    reports = _reports(packages, _targets(args.targets))
    invalid = []
    for report in reports:
        if report["enabled"] and not report["compatible"]:
            invalid.append(f"{report['plugin']}:{report['target']}")
        if args.write:
            output = ROOT / "dist" / "reports" / f"{report['plugin']}-{report['target']}.json"
            _atomic_write(output, canonical_json(report).encode())
        print(canonical_json(report).rstrip())
    if invalid:
        print("incompatible enabled projections: " + ", ".join(invalid))
    return int(bool(invalid) and args.fail_required_loss)


def _check_or_write(path: Path, data: bytes, check: bool) -> bool:
    if check:
        if not path.is_file() or path.read_bytes() != data:
            print(f"stale projection: {_display_path(path)}")
            return False
        print(f"current projection: {_display_path(path)}")
        return True
    _atomic_write(path, data)
    print(f"wrote projection: {_display_path(path)}")
    return True


def _executable(path: Path) -> bool | None:
    """The execute bit of a projection as Git will commit it.

    A checkout with core.filemode=false (Git for Windows) keeps no mode on
    disk: there the index says. A file it does not track yet (a projection
    just generated) has no mode to compare: None, and the check takes its
    content alone; the commit that adds it sets the mode (git add --chmod).
    """
    if trust_executable_mode(ROOT):
        return bool(path.stat().st_mode & 0o111)
    out = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "--stage", "--", path.relative_to(ROOT).as_posix()],
        capture_output=True, text=True,
    ).stdout
    return out.startswith("100755 ") if out else None

def command_build(args: argparse.Namespace) -> int:
    snapshot = _verified_catalog()
    if snapshot is None:
        return 1
    catalog, packages = snapshot
    targets = _targets(args.targets)
    okay = True
    outputs: dict[Path, bytes | None] = {}
    archives: dict[str, bytes] = {}
    executables: dict[Path, bool] = {}
    if "claude" in targets:
        outputs[ROOT / ".claude-plugin/marketplace.json"] = canonical_json(
            render_claude_marketplace(catalog, packages),
        ).encode("utf-8")
        # The Claude manifest is generated only here, from the root manifest and
        # its claude overlay; run scripts/stamp-versions.py first, then build.
        for package in packages:
            if package.target("claude").get("enabled") is True:
                outputs[package.root / CLAUDE_MANIFEST] = render_claude_manifest(package.manifest)
    if "openai" in targets:
        outputs[ROOT / ".agents/plugins/marketplace.json"] = canonical_json(
            render_openai_marketplace(catalog, packages),
        ).encode("utf-8")
        try:
            codex_files = render_codex_packages(ROOT, catalog, packages)
        except (OSError, ValueError, KeyError) as error:
            print(f"could not render Codex packages: {error}")
            return 1
        for relative, codex_file in codex_files.items():
            outputs[ROOT / relative] = codex_file.data
            executables[ROOT / relative] = codex_file.executable
        # A file left in codex/plugins whose source is gone would still be
        # installed by Codex: it is removed here and reported by --check.
        packages_dir = ROOT / CODEX_PACKAGES
        if packages_dir.is_dir():
            for path in sorted(packages_dir.rglob("*")):
                if (path.is_file() or path.is_symlink()) and path not in executables:
                    outputs[path] = None
    if "perplexity" in targets:
        for package in packages:
            if package.target("perplexity").get("enabled") is not True:
                continue
            try:
                first = build_archive(package)
                errors = validate_archive(first)
                if first != build_archive(package):
                    errors.append("archive is not deterministic")
            except (OSError, RuntimeError, ValueError) as error:
                errors = [str(error)]
            if errors:
                okay = False
                for error in errors:
                    print(f"invalid Perplexity archive {package.name}: {error}")
                continue
            archives[package.name] = first
    reports = _reports(packages, targets, archives)
    incompatible = [report for report in reports if report["enabled"] and not report["compatible"]]
    for report in incompatible:
        print(f"required capability loss: {report['plugin']}:{report['target']}")
    if not okay or incompatible:
        return 1
    if args.check:
        for name in archives:
            print(f"valid deterministic Perplexity archive: {name}")
        verified = []
        for path, data in outputs.items():
            if data is None:
                print(f"obsolete projection: {_display_path(path)}")
                verified.append(False)
                continue
            current = _check_or_write(path, data, True)
            mode = _executable(path) if current and path in executables else None
            if mode is not None and mode != executables[path]:
                print(f"stale projection mode: {_display_path(path)}")
                current = False
            verified.append(current)
        return int(not all(verified))
    for name, data in archives.items():
        outputs[ROOT / "dist/perplexity" / f"{name}.zip"] = data
    for report in reports:
        outputs[ROOT / "dist/reports" / f"{report['plugin']}-{report['target']}.json"] = canonical_json(report).encode("utf-8")
    try:
        _publish(outputs)
        for path, executable in executables.items():
            path.chmod(0o755 if executable else 0o644)
        _prune_empty(ROOT / CODEX_PACKAGES)
    except (OSError, ValueError) as error:
        print(f"could not publish projections: {error}")
        return 1
    for path, data in outputs.items():
        print(f"{'retired' if data is None else 'wrote'} projection: {_display_path(path)}")
    return 0


def _prune_empty(directory: Path) -> None:
    if not directory.is_dir():
        return
    for path in sorted(directory.rglob("*"), reverse=True):
        if path.is_dir() and not path.is_symlink() and not any(path.iterdir()):
            path.rmdir()


def command_inventory(args: argparse.Namespace) -> int:
    rendered = canonical_json(build_inventory(ROOT)).encode()
    path = args.write or args.check
    if not path.is_absolute():
        path = ROOT / path
    return int(not _check_or_write(path, rendered, bool(args.check)))


def _owned_path(kind: str, path: Path) -> bool:
    if path.is_absolute() or ".." in path.parts or "\\" in path.as_posix():
        return False
    if kind == "roles":
        return (
            len(path.parts) == 4 and path.parts[0] == "plugins"
            and path.parts[2] == "agents" and path.suffix == ".md"
        ) or (
            len(path.parts) == 3 and path.parts[:2] == ("codex", "agents") and path.suffix == ".toml"
        ) or (
            path.parts[:3] == ("dist", "roles", "openai") and len(path.parts) == 6
            and path.parts[4] == "agents" and path.suffix == ".toml"
        ) or (
            path.parts[:3] == ("dist", "roles", "perplexity") and len(path.parts) == 7
            and path.parts[4] == "skills" and path.name == "SKILL.md"
        )
    return (
        len(path.parts) == 6 and path.parts[0] == "plugins" and path.suffix == ".md"
        and path.parts[2:5] == ("io.github.kodflow", "projections", "workflows")
    )


def _compiled(
    kind: str, tracked: dict[Path, bytes], artifacts: dict[Path, bytes], check: bool,
) -> int:
    ledger = ROOT / f"catalog/generated-{kind}.json"
    try:
        _projection_destination(ledger)
        previous = set()
        if ledger.is_file():
            data = json.loads(ledger.read_text(encoding="utf-8"))
            if not isinstance(data, list) or not all(isinstance(value, str) for value in data):
                raise ValueError(f"invalid {kind} projection inventory")
            previous = {Path(value) for value in data}
        expected = set(tracked) | set(artifacts)
        for path in previous | expected:
            if not _owned_path(kind, path):
                raise ValueError(f"invalid {kind} projection path: {path}")
            _projection_destination(ROOT / path)
        retired = sorted(previous - expected)
        record = canonical_json(sorted(path.as_posix() for path in expected)).encode("utf-8")
        if check:
            for path in retired:
                print(f"obsolete projection: {path}")
            verified = [
                _check_or_write(ROOT / path, content, True) for path, content in sorted(tracked.items())
            ]
            verified.extend(
                _check_or_write(ROOT / path, content, True)
                for path, content in sorted(artifacts.items()) if (ROOT / path).exists()
            )
            verified.append(_check_or_write(ledger, record, True))
            return int(bool(retired) or not all(verified))
        outputs = {ROOT / path: data for path, data in {**tracked, **artifacts}.items()}
        outputs.update({ROOT / path: None for path in retired})
        outputs[ledger] = record
        _publish(outputs)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"could not publish {kind}: {error}")
        return 1
    for path, data in outputs.items():
        print(f"{'retired' if data is None else 'wrote'} projection: {_display_path(path)}")
    return 0


def command_roles(args: argparse.Namespace) -> int:
    return _compiled(
        "roles", compile_roles(ROOT, SCHEMAS),
        {Path("dist/roles") / path: data for path, data in build_role_artifacts(ROOT, SCHEMAS).items()},
        args.check,
    )


def command_workflows(args: argparse.Namespace) -> int:
    return _compiled("workflows", compile_projections(ROOT), {}, args.check)


def command_bump_external(args: argparse.Namespace) -> int:
    try:
        result = bump_external(CATALOG_PATH, args.name, args.sha)
    except BumpError as error:
        print(canonical_json(error.report).rstrip())
        return error.exit_code
    print(canonical_json(result.report).rstrip())
    if result.changed:
        # Keep stdout to the JSON report; the build log goes to stderr.
        with redirect_stdout(sys.stderr):
            status = command_build(argparse.Namespace(targets="all", check=False))
        if status:
            return status
    return result.exit_code


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    commands = root.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate")
    validate.add_argument("paths", nargs="*", type=Path)
    validate.add_argument("--all", action="store_true")
    validate.add_argument("--fixtures", type=Path)
    validate.add_argument("--plugin-data-root", type=Path, help="data root for checking one explicit package")
    validate.add_argument("--mode", choices=MODES, default="publisher-strict")
    validate.set_defaults(function=command_validate)
    compat = commands.add_parser("compat")
    compat.add_argument("--targets", default="all")
    compat.add_argument("--write", action="store_true")
    compat.add_argument("--fail-required-loss", action="store_true")
    compat.set_defaults(function=command_compat)
    build = commands.add_parser("build")
    build.add_argument("--targets", default="all")
    build.add_argument("--check", action="store_true")
    build.set_defaults(function=command_build)
    inventory = commands.add_parser("inventory")
    inventory_mode = inventory.add_mutually_exclusive_group(required=True)
    inventory_mode.add_argument("--check", type=Path)
    inventory_mode.add_argument("--write", type=Path)
    inventory.set_defaults(function=command_inventory)
    roles = commands.add_parser("roles", help="compile and verify neutral role projections")
    roles.add_argument("--check", action="store_true")
    roles.set_defaults(function=command_roles)
    workflows = commands.add_parser("workflows", help="compile and verify host delegation instructions")
    workflows.add_argument("--check", action="store_true")
    workflows.set_defaults(function=command_workflows)
    bump = commands.add_parser(
        "bump-external",
        help="pin an external plugin to a new upstream commit (exit 3: content changed at an equal version)",
    )
    bump.add_argument("name")
    bump.add_argument("--sha", help="40-character commit to pin; default: the upstream HEAD")
    bump.set_defaults(function=command_bump_external)
    return root


if __name__ == "__main__":
    arguments = parser().parse_args()
    raise SystemExit(arguments.function(arguments))
