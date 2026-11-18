from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from pluginlib.model import Catalog, MCP_SCHEMA_ID, PLUGIN_SCHEMA_ID, PathContainmentError, PluginPackage
from pluginlib.validate import validate_catalog, validate_catalog_packages, validate_package, validate_plugin


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


def fixture_catalog(root: Path, *names: str) -> Catalog:
    return Catalog(root, {
        "$schema": "../schemas/kodflow-catalog-v1.schema.json",
        "schemaVersion": 1,
        "name": "fixture",
        "description": "fixture",
        "repository": "https://example.invalid/repo.git",
        "owner": {"name": "fixture", "url": "https://example.invalid"},
        "plugins": [
            {"name": name, "path": f"plugins/{name}", "description": name, "category": "test"}
            for name in names
        ],
    })


class PluginValidationTests(unittest.TestCase):
    def test_all_real_packages_pass_strict_publisher_validation(self) -> None:
        catalog = Catalog.load(ROOT / "catalog" / "catalog.json")
        packages, issues = validate_catalog_packages(catalog, SCHEMAS)
        self.assertEqual(
            {path.name for path in (ROOT / "plugins").iterdir() if path.is_dir()},
            {package.name for package in packages},
        )
        for package in packages:
            issues.extend(validate_package(package, SCHEMAS, "publisher-strict"))
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

    def test_manifest_cannot_be_loaded_through_an_external_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "plugins" / "fixture"
            package.mkdir(parents=True)
            other = root / "stub.json"
            other.write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            (package / "plugin.json").symlink_to(other)
            with self.assertRaises(PathContainmentError):
                PluginPackage.load(package)
            self.assertEqual(["manifest"], [issue.code for issue in validate_plugin(package, SCHEMAS)])
            issues = validate_catalog(fixture_catalog(root, "fixture"), SCHEMAS)
        self.assertEqual(["catalog-path"], [issue.code for issue in issues])

    def test_manifest_and_mcp_invalid_utf8_produce_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            path = package / "plugin.json"
            path.write_bytes(b"\xff")
            self.assertEqual(["manifest-json"], [issue.code for issue in validate_plugin(package, SCHEMAS)])
            path.write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            (package / "mcp.json").write_bytes(b"\xff")
            for mode, severity in (("publisher-strict", "error"), ("loader-conformance", "warning")):
                issues = validate_plugin(package, SCHEMAS, mode)
                self.assertEqual([("mcp-json", severity)], [(issue.code, issue.severity) for issue in issues])

    def test_invalid_skill_text_does_not_prevent_sibling_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            skills = package / "skills"
            for name, content in {
                "a-encoding": b"\xff",
                "b-description": b'---\nname: b-description\ndescription: "   "\n---\n',
            }.items():
                destination = skills / name / "SKILL.md"
                destination.parent.mkdir(parents=True)
                destination.write_bytes(content)
            issues = validate_plugin(package, SCHEMAS, "loader-conformance")
        self.assertEqual(["skill-frontmatter", "skill-frontmatter"], [issue.code for issue in issues])
        self.assertTrue(all(issue.severity == "warning" for issue in issues))
        self.assertIn("cannot read SKILL.md as UTF-8", issues[0].message)
        self.assertIn("missing non-empty description", issues[1].message)

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
            "bad-cwd": {"type": "stdio", "command": "server", "cwd": "${PLUGIN_ROOT}\n"},
            "bad-http": {"type": "streamable-http", "url": "http://example.com/mcp"},
            "bad-user": {"type": "streamable-http", "url": "https://user@example.com/mcp"},
            "bad-fragment": {"type": "sse", "url": "https://example.com/mcp#fragment"},
            "bad-empty-fragment": {"type": "sse", "url": "https://example.com/mcp#"},
            "bad-parse": {"type": "streamable-http", "url": "https://[broken"},
            "bad-port": {"type": "streamable-http", "url": "https://example.com:65536/mcp"},
            "bad-headers": {"type": "sse", "url": "https://example.com/mcp", "headers": {"X-Tag": "a", "x-tag": "b"}},
            "loopback": {"type": "streamable-http", "url": "http://127.0.0.1/mcp"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary)
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            write_mcp(package, cases)
            issues = validate_plugin(package, SCHEMAS, "publisher-strict")
        self.assertTrue(any(issue.code == "mcp-command" for issue in issues))
        self.assertTrue(any(issue.code == "mcp-containment" for issue in issues))
        self.assertTrue(any(issue.code == "mcp-cwd" for issue in issues))
        self.assertTrue(any(issue.code == "mcp-headers" for issue in issues))
        self.assertEqual(6, sum(issue.code == "mcp-url" for issue in issues))
        self.assertFalse(any("server 'loopback'" in issue.message for issue in issues))

    def test_plugin_data_symlinks_are_checked_when_host_root_is_known(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package, data, outside = (root / name for name in ("package", "data", "other"))
            for directory in (package, data, outside):
                directory.mkdir()
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            (data / "contained").mkdir()
            (data / "entry").symlink_to(outside, target_is_directory=True)
            write_mcp(package, {
                "default": {"type": "stdio", "command": "server", "cwd": "${PLUGIN_DATA}"},
                "nested": {"type": "stdio", "command": "server", "cwd": "${PLUGIN_DATA}/contained"},
                "uncontained": {"type": "stdio", "command": "server", "cwd": "${PLUGIN_DATA}/entry"},
            })
            self.assertEqual([], validate_plugin(package, SCHEMAS))
            issues = validate_plugin(package, SCHEMAS, plugin_data_root=data)
        self.assertEqual(["mcp-containment"], [issue.code for issue in issues])
        self.assertIn("server 'uncontained'", issues[0].message)

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
                    "z-bad-url": {"type": "streamable-http", "url": "http://example.com/mcp"},
                },
            )
            issues = validate_plugin(package, SCHEMAS, "loader-conformance")
        self.assertFalse(any(issue.severity == "error" for issue in issues))
        self.assertTrue(any(issue.code == "mcp-server" and "server 'bad'" in issue.message for issue in issues))
        self.assertTrue(any(issue.code == "mcp-url" and "server 'z-bad-url'" in issue.message for issue in issues))
        self.assertFalse(any("server 'good'" in issue.message for issue in issues))

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
            (root / "plugins" / "later").mkdir()
            packages, issues = validate_catalog_packages(fixture_catalog(root, "broken", "later"), SCHEMAS)
        self.assertEqual([], packages)
        self.assertTrue(any(issue.code == "catalog-manifest" and "broken" in issue.path for issue in issues))
        self.assertTrue(any(issue.code == "catalog-path" and "later" in issue.message for issue in issues))

    def test_catalog_reports_unlisted_packages_and_mismatched_names(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for directory, name in (("listed", "different"), ("unlisted", "unlisted")):
                package = root / "plugins" / directory
                package.mkdir(parents=True)
                (package / "plugin.json").write_text(json.dumps(manifest(name)), encoding="utf-8")
            packages, issues = validate_catalog_packages(fixture_catalog(root, "listed"), SCHEMAS)
        self.assertEqual([], packages)
        self.assertTrue(any(issue.code == "unlisted-plugin" and "unlisted" in issue.message for issue in issues))
        self.assertTrue(any(issue.code == "catalog-name" and "listed" in issue.path for issue in issues))

    def test_catalog_rejects_paths_outside_the_package_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / "stub"
            package.mkdir()
            (package / "plugin.json").write_text(json.dumps(manifest("fixture")), encoding="utf-8")
            (root / "plugins").mkdir()
            (root / "plugins" / "fixture").symlink_to(package, target_is_directory=True)
            packages, issues = validate_catalog_packages(fixture_catalog(root, "fixture"), SCHEMAS)
        self.assertEqual([], packages)
        self.assertTrue(any(issue.code == "catalog-path" for issue in issues))

    def test_target_does_not_treat_non_boolean_enabled_as_true(self) -> None:
        package = PluginPackage(Path("."), manifest("fixture", {
            "extensions": {
                "io.github.kodflow": {
                    "targets": {"openai": {"enabled": "false", "profile": "native"}},
                },
            },
        }))
        self.assertIs(package.target("openai")["enabled"], False)
