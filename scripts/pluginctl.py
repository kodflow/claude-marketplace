#!/usr/bin/env python3
"""Validate, report, and build the universal plugin projections."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile

from pluginlib.adapters import (
    build_archive,
    compatibility_report,
    render_claude_marketplace,
    render_openai_marketplace,
    validate_archive,
)
from pluginlib.inventory import build_inventory, canonical_json
from pluginlib.model import Catalog, PluginPackage, TARGETS
from pluginlib.validate import MODES, validate_catalog, validate_plugin


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


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _print_issues(issues: list) -> None:
    for issue in issues:
        print(f"{issue.severity}: {issue.code}: {issue.path}: {issue.message}")


def command_validate(args: argparse.Namespace) -> int:
    catalog = _catalog()
    issues = validate_catalog(catalog, SCHEMAS)
    packages = catalog.packages() if args.all else []
    packages.extend(PluginPackage.load(path.resolve()) for path in args.paths)
    if args.fixtures:
        packages.extend(
            PluginPackage.load(path.parent)
            for path in sorted(args.fixtures.resolve().rglob("plugin.json"))
        )
    if not packages:
        raise SystemExit("validate needs --all, --fixtures, or at least one package path")
    for package in packages:
        issues.extend(validate_plugin(package.root, SCHEMAS, args.mode))
    issues.sort(key=lambda item: (item.severity, item.path, item.code, item.message))
    _print_issues(issues)
    errors = sum(issue.severity == "error" for issue in issues)
    print(f"validated {len(packages)} plugin(s): {errors} error(s), {len(issues) - errors} warning(s)")
    return int(bool(errors))


def _reports(catalog: Catalog, targets: list[str]) -> list[dict]:
    return [
        compatibility_report(package, target)
        for package in catalog.packages()
        for target in targets
    ]


def command_compat(args: argparse.Namespace) -> int:
    catalog = _catalog()
    reports = _reports(catalog, _targets(args.targets))
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
            print(f"stale projection: {path.relative_to(ROOT)}")
            return False
        print(f"current projection: {path.relative_to(ROOT)}")
        return True
    _atomic_write(path, data)
    print(f"wrote projection: {path.relative_to(ROOT)}")
    return True


def command_build(args: argparse.Namespace) -> int:
    catalog = _catalog()
    targets = _targets(args.targets)
    okay = True
    if "claude" in targets:
        data = canonical_json(render_claude_marketplace(catalog)).encode()
        okay &= _check_or_write(ROOT / ".claude-plugin" / "marketplace.json", data, args.check)
    if "openai" in targets:
        data = canonical_json(render_openai_marketplace(catalog)).encode()
        okay &= _check_or_write(ROOT / ".agents" / "plugins" / "marketplace.json", data, args.check)
    if "perplexity" in targets:
        for package in catalog.packages():
            if not package.target("perplexity").get("enabled"):
                continue
            first = build_archive(package)
            second = build_archive(package)
            errors = validate_archive(first)
            if first != second:
                errors.append("archive is not deterministic")
            if errors:
                okay = False
                for error in errors:
                    print(f"invalid Perplexity archive {package.name}: {error}")
                continue
            if args.check:
                print(f"valid deterministic Perplexity archive: {package.name}")
            else:
                path = ROOT / "dist" / "perplexity" / f"{package.name}.zip"
                _atomic_write(path, first)
                print(f"wrote projection: {path.relative_to(ROOT)}")
    reports = _reports(catalog, targets)
    if not args.check:
        for report in reports:
            output = ROOT / "dist" / "reports" / f"{report['plugin']}-{report['target']}.json"
            _atomic_write(output, canonical_json(report).encode())
    incompatible = [report for report in reports if report["enabled"] and not report["compatible"]]
    for report in incompatible:
        print(f"required capability loss: {report['plugin']}:{report['target']}")
    return int(not okay or bool(incompatible))


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
