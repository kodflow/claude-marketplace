#!/usr/bin/env python3
"""Validate, report, and build the universal plugin projections."""

from __future__ import annotations

import argparse
from contextlib import ExitStack
import os
from pathlib import Path
import stat
import tempfile

from pluginlib.adapters import (
    build_archive,
    compatibility_report,
    render_claude_marketplace,
    render_openai_marketplace,
    validate_archive,
)
from pluginlib.inventory import build_inventory, canonical_json
from pluginlib.model import Catalog, PluginPackage, TARGETS, ValidationIssue
from pluginlib.validate import MODES, validate_catalog_packages, validate_package, validate_plugin


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


def _publish(outputs: dict[Path, bytes]) -> None:
    """Stage all outputs and prior bytes before the first replacement."""
    staged: dict[Path, Path] = {}
    previous: dict[Path, Path | None] = {}
    retained: set[Path] = set()

    def cleanup(path: Path) -> None:
        if path not in retained:
            path.unlink(missing_ok=True)

    with ExitStack() as clean:
        for path, data in outputs.items():
            if not path.parent.resolve().is_relative_to(ROOT.resolve()) or path.is_symlink():
                raise ValueError(f"projection destination escapes the repository or is a symlink: {path}")
            staged[path] = _stage_write(path, data)
            clean.callback(cleanup, staged[path])
            old = _stage_write(path, path.read_bytes()) if path.exists() else None
            previous[path] = old
            if old is not None:
                clean.callback(cleanup, old)
                mode = stat.S_IMODE(path.stat().st_mode)
                old.chmod(mode)
                staged[path].chmod(mode)
        attempted = []
        try:
            for path, source in staged.items():
                attempted.append(path)
                os.replace(source, path)
        except (OSError, KeyboardInterrupt) as error:
            failures = []
            for path in reversed(attempted):
                if staged[path].exists():
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


def _catalog_packages() -> tuple[Catalog | None, list[PluginPackage], list[ValidationIssue]]:
    try:
        catalog = _catalog()
    except (OSError, ValueError) as error:
        return None, [], [ValidationIssue("error", "catalog-manifest", str(CATALOG_PATH), str(error))]
    packages, issues = validate_catalog_packages(catalog, SCHEMAS)
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
        _, packages, issues = _catalog_packages()
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


def command_build(args: argparse.Namespace) -> int:
    snapshot = _verified_catalog()
    if snapshot is None:
        return 1
    catalog, packages = snapshot
    targets = _targets(args.targets)
    okay = True
    outputs: dict[Path, bytes] = {}
    archives: dict[str, bytes] = {}
    if "claude" in targets:
        outputs[ROOT / ".claude-plugin/marketplace.json"] = canonical_json(
            render_claude_marketplace(catalog, packages),
        ).encode("utf-8")
    if "openai" in targets:
        outputs[ROOT / ".agents/plugins/marketplace.json"] = canonical_json(
            render_openai_marketplace(catalog, packages),
        ).encode("utf-8")
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
        return int(not all([_check_or_write(path, data, True) for path, data in outputs.items()]))
    for name, data in archives.items():
        outputs[ROOT / "dist/perplexity" / f"{name}.zip"] = data
    for report in reports:
        outputs[ROOT / "dist/reports" / f"{report['plugin']}-{report['target']}.json"] = canonical_json(report).encode("utf-8")
    try:
        _publish(outputs)
    except (OSError, ValueError) as error:
        print(f"could not publish projections: {error}")
        return 1
    for path in outputs:
        print(f"wrote projection: {_display_path(path)}")
    return 0


def command_inventory(args: argparse.Namespace) -> int:
    rendered = canonical_json(build_inventory(ROOT)).encode()
    path = args.write or args.check
    if not path.is_absolute():
        path = ROOT / path
    return int(not _check_or_write(path, rendered, bool(args.check)))


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
    return root


if __name__ == "__main__":
    arguments = parser().parse_args()
    raise SystemExit(arguments.function(arguments))
