from __future__ import annotations

from argparse import Namespace
from contextlib import redirect_stdout
import copy
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile

from jsonschema import Draft202012Validator

import pluginctl
from pluginlib.adapters import (
    build_archive, compatibility_report, render_claude_marketplace,
    render_openai_marketplace, validate_archive,
)
from pluginlib.model import Catalog, PluginPackage


ROOT = Path(__file__).resolve().parents[2]


class PluginAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = Catalog.load(ROOT / "catalog" / "catalog.json")

    def test_enabled_targets_never_lose_required_capabilities(self) -> None:
        failures = []
        for package in self.catalog.packages():
            for target in ("claude", "openai", "perplexity"):
                report = compatibility_report(package, target)
                if report["enabled"] and not report["compatible"]:
                    failures.append(f"{package.name}:{target}")
                for capability in report["capabilities"]:
                    if capability["status"] == "equivalent":
                        self.assertTrue(capability["verifierId"])
        self.assertEqual([], failures)

    def test_openai_marketplace_has_local_sources_and_policy(self) -> None:
        marketplace = render_openai_marketplace(self.catalog)
        self.assertEqual("kodflow", marketplace["name"])
        self.assertGreater(len(marketplace["plugins"]), 0)
        for plugin in marketplace["plugins"]:
            self.assertEqual("local", plugin["source"]["source"])
            self.assertTrue(plugin["source"]["path"].startswith("./plugins/"))
            self.assertEqual("AVAILABLE", plugin["policy"]["installation"])
            self.assertEqual("ON_INSTALL", plugin["policy"]["authentication"])
        names = {plugin["name"] for plugin in marketplace["plugins"]}
        self.assertNotIn("kodflow-shell", names)
        self.assertNotIn("kodflow-gamedev", names)
        self.assertNotIn("kodflow-specialists", names)

    def test_claude_sources_inherit_the_marketplace_revision(self) -> None:
        entries = render_claude_marketplace(self.catalog)["plugins"]
        self.assertTrue(entries)
        for entry in entries:
            self.assertEqual(f"./plugins/{entry['name']}", entry["source"])

    def test_declined_and_unverified_openai_capabilities_are_never_equivalent(self) -> None:
        package = self.catalog.packages()[0]
        report = compatibility_report(package, "openai")
        capability = next(item for item in report["capabilities"] if item["name"] == "multi-agent")
        self.assertEqual("advisory-loss", capability["status"])
        self.assertIsNone(capability["verifierId"])
        manifest = copy.deepcopy(package.manifest)
        manifest["extensions"]["io.github.kodflow"]["targets"]["openai"]["enabled"] = "false"
        disabled = PluginPackage(package.root, manifest)
        self.assertFalse(compatibility_report(disabled, "openai")["enabled"])
        catalog = Catalog(self.catalog.root, {**self.catalog.data, "plugins": self.catalog.plugins[:1]})
        self.assertEqual([], render_openai_marketplace(catalog, [disabled])["plugins"])

    def test_claude_hook_verifier_checks_the_bundled_command(self) -> None:
        package = next(package for package in self.catalog.packages() if package.name == "kodflow-hooks")
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".claude-plugin").mkdir()
            (root / ".claude-plugin/plugin.json").write_text('{"name":"kodflow-hooks"}', encoding="utf-8")
            (root / "hooks").mkdir()
            (root / "hooks/hooks.json").write_text(json.dumps({
                "hooks": {"SessionStart": [{"hooks": [{
                    "type": "command", "command": '"${CLAUDE_PLUGIN_ROOT}"/hooks/start.sh',
                }]}]},
            }), encoding="utf-8")
            candidate = PluginPackage(root, package.manifest)
            self.assertFalse(compatibility_report(candidate, "claude")["compatible"])
            script = root / "hooks/start.sh"
            script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            script.chmod(0o755)
            report = compatibility_report(candidate, "claude")
            self.assertTrue(report["compatible"])
            self.assertEqual("claude-hook-layout", report["capabilities"][0]["verifierId"])

    def test_perplexity_archives_are_deterministic_and_within_limits(self) -> None:
        count = 0
        for package in self.catalog.packages():
            if not package.target("perplexity").get("enabled"):
                continue
            count += 1
            first = build_archive(package)
            self.assertEqual(first, build_archive(package))
            self.assertEqual([], validate_archive(first))
        self.assertEqual(4, count)

    def test_perplexity_report_and_archive_agree_on_workflow_companions(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = PluginPackage(root, self.catalog.packages()[0].manifest)
            skill = root / "skills/investigate/SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text("# Investigate", encoding="utf-8")
            projections = root / "io.github.kodflow/projections/workflows"
            projections.mkdir(parents=True)
            (projections / "investigate-perplexity.md").write_text("included", encoding="utf-8")
            (projections / "unpackaged-perplexity.md").write_text("excluded", encoding="utf-8")
            data = build_archive(package)
            with ZipFile(BytesIO(data)) as archive:
                self.assertEqual(b"included", archive.read("skills/investigate/workflow-perplexity.md"))
                self.assertNotIn("skills/unpackaged/workflow-perplexity.md", archive.namelist())
            report = compatibility_report(package, "perplexity", archive=data)
            capability = next(item for item in report["capabilities"] if item["name"] == "multi-agent")
            self.assertEqual("advisory-loss", capability["status"])

    def test_perplexity_limits_uncompressed_bytes(self) -> None:
        buffer = BytesIO()
        with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
            archive.writestr("plugin.json", '{"name":"fixture"}')
            archive.writestr("skills/fixture/SKILL.md", "a" * 4096)
        with patch("pluginlib.adapters.perplexity.MAX_BYTES", 1024):
            self.assertLess(len(buffer.getvalue()), 1024)
            self.assertTrue(any("uncompressed" in error for error in validate_archive(buffer.getvalue())))

    def test_perplexity_rejects_a_connector_the_importer_would_skip(self) -> None:
        buffer = BytesIO()
        with ZipFile(buffer, "w") as archive:
            archive.writestr("plugin.json", '{"name":"fixture"}')
            archive.writestr("mcp.json", json.dumps({"mcpServers": {
                "example": {"type": "http", "url": "https://example.com/${CONNECTOR}"},
            }}))
        self.assertEqual(["MCP server 'example' needs a resolved HTTPS URL"], validate_archive(buffer.getvalue()))

    def test_perplexity_reports_non_string_transports(self) -> None:
        buffer = BytesIO()
        with ZipFile(buffer, "w") as archive:
            archive.writestr("plugin.json", '{"name":"fixture"}')
            archive.writestr("mcp.json", json.dumps({"mcpServers": {
                "example": {"type": [], "url": "https://example.com/mcp"},
            }}))
        self.assertEqual(["MCP server 'example' is not remote HTTP"], validate_archive(buffer.getvalue()))

    def test_perplexity_keeps_tracked_files_and_excludes_ignored_output(self) -> None:
        with TemporaryDirectory() as temporary:
            checkout = Path(temporary)
            package = checkout / "extensions/fixture [library]"
            skills = package / "skills/fixture"
            assets = package / "assets"
            skills.mkdir(parents=True)
            assets.mkdir()
            (checkout / ".gitignore").write_text("__pycache__/\n*.cache\n", encoding="utf-8")
            (skills / "SKILL.md").write_text("fixture", encoding="utf-8")
            (skills / "__pycache__").mkdir()
            (skills / "__pycache__/local.pyc").write_bytes(b"local output")
            tracked = assets / "source.cache"
            tracked.write_bytes(b"tracked source")
            (assets / "local.cache").write_bytes(b"local output")
            subprocess.run(["git", "init", "-q", str(checkout)], check=True)
            subprocess.run(
                ["git", "-C", str(checkout), "--literal-pathspecs", "add", "-f",
                 str(tracked.relative_to(checkout))],
                check=True,
            )

            bundle = build_archive(PluginPackage(package, {"name": "fixture"}))
            with ZipFile(BytesIO(bundle)) as archive:
                self.assertEqual(
                    {"assets/source.cache", "plugin.json", "skills/fixture/SKILL.md"},
                    set(archive.namelist()),
                )
                self.assertEqual(b"tracked source", archive.read("assets/source.cache"))

    def test_perplexity_reads_a_gitless_release_staged_inside_a_checkout(self) -> None:
        with TemporaryDirectory() as temporary:
            checkout = Path(temporary)
            staged = checkout / "dist/release"
            package = staged / "plugins/fixture"
            skills = package / "skills/fixture"
            skills.mkdir(parents=True)
            (staged / "catalog").mkdir()
            (staged / "catalog/catalog.json").touch()
            (checkout / ".gitignore").write_text("dist/\n", encoding="utf-8")
            (skills / "SKILL.md").write_text("fixture", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(checkout)], check=True)

            bundle = build_archive(PluginPackage(package, {"name": "fixture"}))
            with ZipFile(BytesIO(bundle)) as archive:
                self.assertIn("skills/fixture/SKILL.md", archive.namelist())

    def test_perplexity_connector_does_not_substitute_for_required_skill(self) -> None:
        package = self.catalog.packages()[0]
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "mcp.json").write_text(json.dumps({"mcpServers": {
                "connector": {"type": "http", "url": "https://example.com/mcp"},
            }}), encoding="utf-8")
            candidate = PluginPackage(root, package.manifest)
            archive = build_archive(candidate)
            self.assertEqual([], validate_archive(archive))
            self.assertIn("archive must contain a skill for the skills capability",
                          validate_archive(archive, require_skills=True))
            report = compatibility_report(candidate, "perplexity", archive=archive)
            self.assertFalse(report["compatible"])
            self.assertIsNone(next(item["verifierId"] for item in report["capabilities"]
                                   if item["name"] == "skills"))

    def test_perplexity_requires_components_and_counts_utf8_in_description(self) -> None:
        buffer = BytesIO()
        with ZipFile(buffer, "w") as archive:
            archive.writestr("plugin.json", json.dumps({"name": "fixture", "description": "é" * 513}))
        errors = validate_archive(buffer.getvalue())
        self.assertTrue(any("1024 UTF-8 bytes" in error for error in errors))
        self.assertTrue(any("at least one skill" in error for error in errors))

    def test_equivalent_report_requires_a_nonempty_verifier(self) -> None:
        package = self.catalog.packages()[0]
        report = compatibility_report(package, "claude")
        schema = json.loads(
            (ROOT / "schemas" / "compatibility-report-v1.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual([], list(Draft202012Validator(schema).iter_errors(report)))
        invalid = copy.deepcopy(report)
        equivalent = next(item for item in invalid["capabilities"] if item["status"] == "equivalent")
        for value in (None, ""):
            equivalent["verifierId"] = value
            self.assertTrue(list(Draft202012Validator(schema).iter_errors(invalid)))


class PluginCliTests(unittest.TestCase):
    def test_compiler_retires_only_previously_owned_paths(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = Path("plugins/example/agents/first.md")
            second = Path("plugins/example/agents/second.md")
            manual = root / "plugins/example/agents/manual.md"
            manual.parent.mkdir(parents=True)
            manual.write_bytes(b"hand maintained")
            with patch.object(pluginctl, "ROOT", root), redirect_stdout(StringIO()):
                self.assertEqual(0, pluginctl._compiled("roles", {first: b"one"}, {}, False))
                self.assertEqual(1, pluginctl._compiled("roles", {second: b"two"}, {}, True))
                self.assertEqual(0, pluginctl._compiled("roles", {second: b"two"}, {}, False))
                self.assertEqual(0, pluginctl._compiled("roles", {second: b"two"}, {}, True))
            self.assertFalse((root / first).exists())
            self.assertEqual(b"two", (root / second).read_bytes())
            self.assertEqual(b"hand maintained", manual.read_bytes())

    def test_compiler_rejects_escaped_companion_before_writing_anything(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary) / "root"
            outside = root.parent / "outside"
            root.mkdir()
            outside.mkdir()
            (root / "dist").symlink_to(outside, target_is_directory=True)
            tracked = Path("plugins/example/agents/first.md")
            companion = Path("dist/roles/openai/example/agents/first.toml")
            with patch.object(pluginctl, "ROOT", root), redirect_stdout(StringIO()):
                self.assertEqual(1, pluginctl._compiled("roles", {tracked: b"one"}, {companion: b"two"}, False))
            self.assertFalse((root / tracked).exists())
            self.assertEqual([], list(outside.iterdir()))

    def test_fixture_discovery_ignores_legacy_projection_manifests(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "fixture/.claude-plugin").mkdir(parents=True)
            (root / "fixture/.claude-plugin/plugin.json").touch()
            (root / "fixture/plugin.json").touch()
            self.assertEqual([root / "fixture"], pluginctl._fixture_roots(root))

    def test_invalid_catalog_still_prints_the_package_diagnostic(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            data = Catalog.load(ROOT / "catalog/catalog.json").data
            catalog = Catalog(root, {**data, "plugins": data["plugins"][:1]})
            package = root / data["plugins"][0]["path"]
            package.mkdir(parents=True)
            (package / "plugin.json").write_text("{", encoding="utf-8")
            output = StringIO()
            with patch.object(pluginctl, "_catalog", return_value=catalog), redirect_stdout(output):
                result = pluginctl.command_validate(Namespace(
                    all=True, fixtures=None, paths=[], mode="publisher-strict", plugin_data_root=None,
                ))
            self.assertEqual(1, result)
            self.assertIn("catalog-manifest", output.getvalue())
            self.assertNotIn("validate needs", output.getvalue())

    def test_build_reuses_the_manifest_snapshot_and_preserves_previous_outputs_on_failure(self) -> None:
        catalog = Catalog.load(ROOT / "catalog/catalog.json")
        package = catalog.packages()[0]
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = Catalog(root, {**catalog.data, "plugins": catalog.plugins[:1]})
            candidate = PluginPackage(root, package.manifest)
            marketplace = root / ".agents/plugins/marketplace.json"
            marketplace.parent.mkdir(parents=True)
            marketplace.write_bytes(b"previous marketplace")
            output = StringIO()
            with patch.object(pluginctl, "ROOT", root), patch.object(
                pluginctl, "_verified_catalog", return_value=(catalog, [candidate]),
            ), patch.object(PluginPackage, "load", side_effect=AssertionError("manifest reloaded")), redirect_stdout(output):
                result = pluginctl.command_build(Namespace(targets="openai,perplexity", check=False))
            self.assertEqual(1, result)
            self.assertEqual(b"previous marketplace", marketplace.read_bytes())
            self.assertFalse((root / "dist").exists())
            self.assertIn("required capability loss", output.getvalue())

    def test_publication_replace_failure_restores_previous_outputs(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            first, second = root / "first.json", root / "second.json"
            first.write_bytes(b"previous first")
            second.write_bytes(b"previous second")
            replace = os.replace

            def reject_second(source, target):
                if target == second:
                    raise OSError("simulated write failure")
                replace(source, target)

            with patch.object(pluginctl, "ROOT", root), patch.object(
                pluginctl.os, "replace", side_effect=reject_second,
            ), self.assertRaisesRegex(OSError, "simulated write failure"):
                pluginctl._publish({first: b"new first", second: b"new second"})
            self.assertEqual(b"previous first", first.read_bytes())
            self.assertEqual(b"previous second", second.read_bytes())
            self.assertEqual({first, second}, set(root.iterdir()))

    def test_publication_interrupt_after_replace_restores_previous_outputs(self) -> None:
        for previously_present in (True, False):
            with self.subTest(previously_present=previously_present), TemporaryDirectory() as temporary:
                root = Path(temporary)
                first, second = root / "first.json", root / "second.json"
                first.write_bytes(b"previous first")
                if previously_present:
                    second.write_bytes(b"previous second")
                replace = os.replace
                interrupted = False

                def interrupt_second(source, target):
                    nonlocal interrupted
                    replace(source, target)
                    if target == second and not interrupted:
                        interrupted = True
                        raise KeyboardInterrupt

                with patch.object(pluginctl, "ROOT", root), patch.object(
                    pluginctl.os, "replace", side_effect=interrupt_second,
                ), self.assertRaises(KeyboardInterrupt):
                    pluginctl._publish({first: b"new first", second: b"new second"})
                self.assertEqual(b"previous first", first.read_bytes())
                if previously_present:
                    self.assertEqual(b"previous second", second.read_bytes())
                    self.assertEqual({first, second}, set(root.iterdir()))
                else:
                    self.assertEqual({first}, set(root.iterdir()))
