from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from pluginlib.model import Catalog, MCP_SCHEMA_ID, PLUGIN_SCHEMA_ID, PluginPackage
from pluginlib.validate import validate_catalog, validate_plugin


ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"


def manifest(name: str, extra: dict | None = None) -> dict:
    value = {"$schema": PLUGIN_SCHEMA_ID, "name": name}
    value.update(extra or {})
    return value


def write_mcp(package: Path, servers: object) -> None:
    (package / "mcp.json").write_text(
        json.dumps({"$schema": MCP_SCHEMA_ID, "mcpServers": servers}),
        encoding="utf-8",
    )


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

    def test_loader_ignores_unimplemented_extension_namespace_values(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(
                json.dumps(manifest("fixture", {"extensions": {"com.example.other": False}})),
                encoding="utf-8",
            )
            strict = validate_plugin(package, SCHEMAS, "publisher-strict")
            loader = validate_plugin(package, SCHEMAS, "loader-conformance")
        self.assertTrue(any(issue.severity == "error" for issue in strict))
        self.assertFalse(any(issue.severity == "error" for issue in loader))
        self.assertTrue(any(issue.code == "ignored-extension-namespace" for issue in loader))

    def test_plugin_name_requires_actual_end_of_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(json.dumps(manifest("fixture\n")), encoding="utf-8")
            issues = validate_plugin(package, SCHEMAS, "publisher-strict")
        self.assertTrue(any(issue.code == "plugin-name" for issue in issues))

    def test_portable_metadata_is_decoded_as_utf8(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(
                json.dumps(manifest("fixture", {"description": "café"}), ensure_ascii=False),
                encoding="utf-8",
            )
            loaded = PluginPackage.load(package)
        self.assertEqual("café", loaded.manifest["description"])

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

    def test_skill_name_and_description_follow_agent_skills_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            skill = package / "skills" / "expected"
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                "---\nname: other\ndescription: " + ("x" * 1025) + "\n---\n",
                encoding="utf-8",
            )
            issues = validate_plugin(package, SCHEMAS, "publisher-strict")
        self.assertTrue(any(issue.code == "skill-name" for issue in issues))
        self.assertTrue(any(issue.code == "skill-description" for issue in issues))

    def test_mcp_semantic_paths_and_urls_are_checked_without_crashing(self) -> None:
        cases = {
            "bad-command": {"type": "stdio", "command": "bin/server"},
            "bad-data": {"type": "stdio", "command": "server", "cwd": "${PLUGIN_DATA}/../cache"},
            "bad-http": {"type": "streamable-http", "url": "http://example.com/mcp"},
            "bad-user": {"type": "streamable-http", "url": "https://user@example.com/mcp"},
            "bad-fragment": {"type": "sse", "url": "https://example.com/mcp#fragment"},
            "bad-parse": {"type": "streamable-http", "url": "https://[broken"},
            "loopback": {"type": "streamable-http", "url": "http://127.0.0.1/mcp"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            write_mcp(package, cases)
            issues = validate_plugin(package, SCHEMAS, "publisher-strict")
        self.assertTrue(any(issue.code == "mcp-command" for issue in issues))
        self.assertTrue(any(issue.code == "mcp-containment" for issue in issues))
        self.assertGreaterEqual(sum(issue.code == "mcp-url" for issue in issues), 4)
        self.assertFalse(any("server 'loopback'" in issue.message for issue in issues))

    def test_mcp_symlink_loop_is_a_containment_error(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            (package / "loop").symlink_to("loop")
            write_mcp(package, {"loop": {"type": "stdio", "command": "./loop"}})
            issues = validate_plugin(package, SCHEMAS, "publisher-strict")
        self.assertTrue(any(issue.code == "mcp-containment" for issue in issues))

    def test_loader_skips_bad_mcp_server_and_keeps_other_components(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            write_mcp(
                package,
                {
                    "bad": {"type": "streamable-http"},
                    "good": {"type": "streamable-http", "url": "https://example.com/mcp"},
                },
            )
            issues = validate_plugin(package, SCHEMAS, "loader-conformance")
        self.assertFalse(any(issue.severity == "error" for issue in issues))
        self.assertTrue(any(issue.code == "mcp-server" and "bad" in issue.message for issue in issues))

    def test_invalid_mcp_envelope_returns_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            write_mcp(package, [])
            issues = validate_plugin(package, SCHEMAS, "publisher-strict")
        self.assertTrue(any(issue.code == "mcp-envelope" for issue in issues))

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

    def test_catalog_reports_invalid_plugin_manifest_and_continues(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "plugins" / "broken"
            package.mkdir(parents=True)
            (package / "plugin.json").write_text("[", encoding="utf-8")
            (root / "catalog").mkdir()
            data = {
                "$schema": "../schemas/kodflow-catalog-v1.schema.json",
                "schemaVersion": 1,
                "name": "fixture",
                "description": "fixture",
                "repository": "https://example.invalid/repo.git",
                "owner": {"name": "fixture", "url": "https://example.invalid"},
                "plugins": [{"name": "broken", "path": "plugins/broken", "description": "broken", "category": "test"}],
            }
            path = root / "catalog" / "catalog.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            issues = validate_catalog(Catalog.load(path), SCHEMAS)
        self.assertTrue(any(issue.code == "catalog-manifest" for issue in issues))
