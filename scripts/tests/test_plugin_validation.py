from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from pluginlib.model import Catalog, PLUGIN_SCHEMA_ID
from pluginlib.validate import validate_catalog, validate_plugin


ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"


def manifest(name: str, extra: dict | None = None) -> dict:
    value = {"$schema": PLUGIN_SCHEMA_ID, "name": name}
    value.update(extra or {})
    return value


class PluginValidationTests(unittest.TestCase):
    def test_all_real_packages_pass_strict_publisher_validation(self) -> None:
        catalog = Catalog.load(ROOT / "catalog" / "catalog.json")
        issues = validate_catalog(catalog, SCHEMAS)
        for package in catalog.packages():
            issues.extend(validate_plugin(package.root, SCHEMAS, "publisher-strict"))
        self.assertEqual([], [issue.as_dict() for issue in issues])

    def test_loader_warns_where_publisher_rejects_unknown_root_field(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(json.dumps(manifest("fixture", {"future": True})))
            strict = validate_plugin(package, SCHEMAS, "publisher-strict")
            loader = validate_plugin(package, SCHEMAS, "loader-conformance")
        self.assertTrue(any(issue.severity == "error" for issue in strict))
        self.assertFalse(any(issue.severity == "error" for issue in loader))
        self.assertTrue(any(issue.code == "unknown-root-field" for issue in loader))

    def test_skill_symlink_cannot_escape_package(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "package"
            outside = root / "outside"
            package.mkdir()
            outside.mkdir()
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")))
            (outside / "SKILL.md").write_text("---\nname: escaped\ndescription: escaped\n---\n")
            (package / "skills").mkdir()
            (package / "skills" / "escaped").symlink_to(outside, target_is_directory=True)
            issues = validate_plugin(package, SCHEMAS, "publisher-strict")
        self.assertTrue(any(issue.code == "skill-containment" for issue in issues))

    def test_required_dependency_cycle_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "catalog").mkdir()
            entries = []
            for name, dependency in (("alpha", "beta"), ("beta", "alpha")):
                package = root / "plugins" / name
                package.mkdir(parents=True)
                extension = {
                    "schemaVersion": 1,
                    "installByDefault": True,
                    "scope": "user",
                    "dependencies": [{"plugin": dependency, "required": True}],
                    "capabilities": {},
                    "targets": {},
                }
                (package / "plugin.json").write_text(json.dumps(manifest(name, {"extensions": {"io.github.kodflow": extension}})))
                entries.append({"name": name, "path": f"plugins/{name}", "description": name, "category": "test"})
            data = {
                "$schema": "../schemas/kodflow-catalog-v1.schema.json",
                "schemaVersion": 1,
                "name": "fixture",
                "description": "fixture",
                "repository": "https://example.invalid/repo.git",
                "owner": {"name": "fixture", "url": "https://example.invalid"},
                "plugins": entries,
            }
            path = root / "catalog" / "catalog.json"
            path.write_text(json.dumps(data))
            issues = validate_catalog(Catalog.load(path), SCHEMAS)
        self.assertTrue(any(issue.code == "dependency-cycle" for issue in issues))
