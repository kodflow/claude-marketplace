from __future__ import annotations

from argparse import Namespace
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import pluginctl
from pluginlib.externals import EXIT_DOWNGRADE, EXIT_SAME_VERSION, BumpError, bump_external
from pluginlib.manifest import CLAUDE_MANIFEST, project_claude_manifest, render_claude_manifest
from pluginlib.model import Catalog
from pluginlib.validate import validate_catalog, validate_catalog_packages


ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"
FIXTURES = Path(__file__).parent / "fixtures" / "manifest-overlay"
GIT = ["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"]


def root_manifest(minimum: str | None = None, overlay: dict | None = None) -> dict:
    claude = {"enabled": True, "profile": "native"}
    if minimum is not None:
        claude["minimumVersion"] = minimum
    if overlay is not None:
        claude["manifest"] = overlay
    return {
        "name": "fixture", "version": "1.0.0", "description": "Long description.",
        "author": {"name": "kodflow"}, "homepage": "https://example.invalid", "license": "MIT",
        "repository": "https://example.invalid/repo.git", "keywords": ["x"],
        "extensions": {"io.github.kodflow": {"targets": {"claude": claude}}},
    }


class ClaudeManifestProjectionTests(unittest.TestCase):
    def test_committed_claude_manifests_are_the_projection_of_the_root(self) -> None:
        catalog = Catalog.load(ROOT / "catalog" / "catalog.json")
        for package in catalog.packages():
            with self.subTest(package=package.name):
                self.assertEqual(
                    render_claude_manifest(package.manifest),
                    (package.root / CLAUDE_MANIFEST).read_bytes(),
                )

    def test_projection_copies_shared_fields_and_merges_the_overlay(self) -> None:
        projected = project_claude_manifest(root_manifest(overlay={"types": "./types/index.d.ts"}))
        self.assertEqual(
            {"name", "version", "description", "author", "homepage", "license", "types"}, set(projected),
        )
        self.assertEqual("Long description.", projected["description"])

    def test_engines_are_emitted_only_from_the_first_engine_that_reads_them(self) -> None:
        for minimum, expected in (
            (None, None), ("2.1.293", None), ("2.1.322", None),
            ("2.1.323", {"claude-code": ">=2.1.323"}), ("2.2.0", {"claude-code": ">=2.2.0"}),
        ):
            with self.subTest(minimum=minimum):
                self.assertEqual(expected, project_claude_manifest(root_manifest(minimum)).get("engines"))

    def test_overlay_redefining_a_derived_field_fails_validation(self) -> None:
        cases = sorted(path for path in FIXTURES.iterdir() if (path / "plugin.json").is_file())
        self.assertEqual(4, len(cases))
        for case in cases:
            with self.subTest(case=case.name):
                result = subprocess.run(
                    [sys.executable, str(ROOT / "scripts/pluginctl.py"), "validate", str(case)],
                    capture_output=True, text=True,
                )
                self.assertNotEqual(0, result.returncode, result.stdout)
                self.assertIn("claude-manifest-overlay", result.stdout)
                with self.assertRaises(ValueError):
                    project_claude_manifest(json.loads((case / "plugin.json").read_text(encoding="utf-8")))

    def test_build_check_detects_a_hand_edited_claude_manifest(self) -> None:
        source = json.loads((ROOT / "catalog/catalog.json").read_text(encoding="utf-8"))
        kept = ("kodflow-hooks", "kodflow-hud")
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "catalog").mkdir()
            for name in kept:
                shutil.copytree(ROOT / "plugins" / name, root / "plugins" / name, symlinks=True)
            data = {key: value for key, value in source.items() if key != "externals"}
            data["plugins"] = [entry for entry in source["plugins"] if entry["name"] in kept]
            catalog = root / "catalog/catalog.json"
            catalog.write_text(json.dumps(data), encoding="utf-8")
            with patch.object(pluginctl, "ROOT", root), patch.object(pluginctl, "CATALOG_PATH", catalog), \
                    redirect_stdout(StringIO()) as output:
                self.assertEqual(0, pluginctl.command_build(Namespace(targets="claude", check=False)))
                self.assertEqual(0, pluginctl.command_build(Namespace(targets="claude", check=True)))
                manifest = root / "plugins/kodflow-hud" / CLAUDE_MANIFEST
                edited = json.loads(manifest.read_text(encoding="utf-8"))
                edited["description"] = "edited by hand"
                manifest.write_text(json.dumps(edited, indent=2) + "\n", encoding="utf-8")
                self.assertEqual(1, pluginctl.command_build(Namespace(targets="claude", check=True)))
            self.assertIn(f"stale projection: plugins/kodflow-hud/{CLAUDE_MANIFEST}", output.getvalue())


def catalog_with(externals: list[dict], plugins: tuple[str, ...] = ()) -> dict:
    return {
        "$schema": "../schemas/kodflow-catalog-v1.schema.json",
        "schemaVersion": 1, "name": "fixture", "description": "fixture",
        "repository": "https://example.invalid/repo.git",
        "owner": {"name": "fixture", "url": "https://example.invalid"},
        "plugins": [{"name": name, "path": f"plugins/{name}", "category": "test"} for name in plugins],
        "externals": externals,
    }


def external(url: str = "https://example.invalid/skills.git", sha: str = "a" * 40, name: str = "third") -> dict:
    return {
        "name": name, "description": "Third-party plugin.", "category": "review",
        "source": {"url": url, "sha": sha}, "installByDefault": False, "targets": ["claude"],
    }


class ExternalCatalogTests(unittest.TestCase):
    def issues(self, data: dict, mode: str = "publisher-strict", local: tuple[str, ...] = ()) -> list:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in local:
                (root / "plugins" / name).mkdir(parents=True)
                (root / "plugins" / name / "plugin.json").write_text(
                    json.dumps({"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": name}),
                    encoding="utf-8",
                )
            return validate_catalog_packages(Catalog(root, data), SCHEMAS, mode)[1]

    def test_valid_external_passes(self) -> None:
        self.assertEqual([], self.issues(catalog_with([external()])))

    def test_sha_must_be_exactly_forty_hex_characters(self) -> None:
        for sha in ("a" * 39, "a" * 41, "A" * 40):
            with self.subTest(length=len(sha)):
                codes = {issue.code for issue in self.issues(catalog_with([external(sha=sha)]))}
                self.assertEqual({"schema"}, codes)

    def test_non_https_urls_are_refused_by_the_publisher(self) -> None:
        for url in ("http://example.invalid/skills.git", "file:///srv/skills.git",
                    "https://user:token@example.invalid/skills.git"):
            with self.subTest(url=url):
                issues = self.issues(catalog_with([external(url=url)]))
                self.assertEqual([("error", "external-source")], [(i.severity, i.code) for i in issues])
        loader = self.issues(catalog_with([external(url="file:///srv/skills.git")]), "loader-conformance")
        self.assertEqual([("warning", "external-source")], [(i.severity, i.code) for i in loader])

    def test_install_by_default_must_be_false(self) -> None:
        entry = {**external(), "installByDefault": True}
        self.assertEqual({"schema"}, {issue.code for issue in self.issues(catalog_with([entry]))})

    def test_external_name_cannot_shadow_a_local_plugin_or_repeat(self) -> None:
        shadow = self.issues(catalog_with([external(name="local")], ("local",)), local=("local",))
        self.assertIn("duplicate-plugin", {issue.code for issue in shadow})
        twice = self.issues(catalog_with([external(), external()]))
        self.assertIn("duplicate-plugin", {issue.code for issue in twice})

    def test_real_catalog_external_is_never_a_package(self) -> None:
        catalog = Catalog.load(ROOT / "catalog/catalog.json")
        self.assertEqual([], validate_catalog(catalog, SCHEMAS))
        names = {entry["name"] for entry in catalog.externals}
        self.assertTrue(names)
        self.assertFalse(names & {package.name for package in catalog.packages()})
        self.assertFalse(names & {path.name for path in (ROOT / "plugins").iterdir()})


class BumpExternalTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.upstream = self.base / "upstream"
        subprocess.run(["git", "init", "-q", "-b", "main", str(self.upstream)], check=True)
        self.commits = {
            label: self.commit(version, body)
            for label, version, body in (
                ("first", "1.0.0", "one"), ("newer", "1.1.0", "two"),
                ("same", "1.1.0", "three"), ("older", "1.0.5", "four"),
            )
        }
        self.catalog = self.base / "catalog.json"
        self.pin(self.commits["first"])

    def commit(self, version: str, body: str) -> str:
        manifest = self.upstream / ".claude-plugin/plugin.json"
        manifest.parent.mkdir(exist_ok=True)
        manifest.write_text(json.dumps({"name": "third", "version": version}), encoding="utf-8")
        (self.upstream / "skill.md").write_text(body, encoding="utf-8")
        subprocess.run([*GIT, "-C", str(self.upstream), "add", "."], check=True)
        subprocess.run([*GIT, "-C", str(self.upstream), "commit", "-qm", body], check=True)
        return subprocess.check_output(["git", "-C", str(self.upstream), "rev-parse", "HEAD"], text=True).strip()

    def pin(self, sha: str) -> None:
        data = catalog_with([external(url=self.upstream.as_uri(), sha=sha)])
        self.catalog.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    def pinned(self) -> str:
        return json.loads(self.catalog.read_text(encoding="utf-8"))["externals"][0]["source"]["sha"]

    def bump(self, sha: str | None = None):
        return bump_external(self.catalog, "third", sha, schemes=("https", "file"))

    def test_upward_version_is_pinned(self) -> None:
        result = self.bump(self.commits["newer"])
        self.assertEqual((0, "bumped", True), (result.exit_code, result.report["status"], result.changed))
        self.assertEqual({"sha": self.commits["newer"], "version": "1.1.0"}, result.report["to"])
        self.assertEqual(self.commits["newer"], self.pinned())

    def test_default_target_is_the_upstream_head(self) -> None:
        result = self.bump()
        self.assertEqual(self.commits["older"], result.report["to"]["sha"])

    def test_downgrade_is_refused_and_nothing_is_written(self) -> None:
        self.pin(self.commits["newer"])
        with self.assertRaises(BumpError) as caught:
            self.bump(self.commits["older"])
        self.assertEqual(EXIT_DOWNGRADE, caught.exception.exit_code)
        self.assertEqual(self.commits["newer"], self.pinned())

    def test_content_change_at_an_equal_version_is_flagged(self) -> None:
        self.pin(self.commits["newer"])
        result = self.bump(self.commits["same"])
        self.assertEqual((EXIT_SAME_VERSION, "content-changed-same-version"),
                         (result.exit_code, result.report["status"]))
        self.assertEqual(self.commits["same"], self.pinned())

    def test_malformed_sha_and_plain_http_are_refused(self) -> None:
        for sha in ("a" * 39, "a" * 41):
            with self.subTest(sha=len(sha)), self.assertRaises(BumpError):
                self.bump(sha)
        data = catalog_with([external(url="http://example.invalid/skills.git", sha=self.commits["first"])])
        self.catalog.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(BumpError, "https"):
            bump_external(self.catalog, "third", self.commits["newer"])
        self.assertEqual(self.commits["first"], self.pinned())

    def test_file_urls_are_refused_outside_tests(self) -> None:
        with self.assertRaisesRegex(BumpError, "https"):
            bump_external(self.catalog, "third", self.commits["newer"])
        self.assertEqual(self.commits["first"], self.pinned())


if __name__ == "__main__":
    unittest.main()
