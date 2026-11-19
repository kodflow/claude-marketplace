from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from pluginlib.manifest import render_claude_manifest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "stamp-versions.py"


class PluginVersionTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.fixture = Path(temporary.name) / "source"
        self.plugin = self.fixture / "plugins" / "fixture"
        self.legacy = self.plugin / ".claude-plugin/plugin.json"
        self.legacy.parent.mkdir(parents=True)
        metadata = {"name": "fixture", "version": "old", "description": "Révision А"}
        encoded = json.dumps(metadata, ensure_ascii=False).encode("utf-8")
        (self.plugin / "plugin.json").write_bytes(encoded)
        self.legacy.write_bytes(encoded)
        (self.plugin / "source.txt").write_bytes(b"one\n")
        subprocess.run(["git", "init", "-q", str(self.fixture)], check=True)
        self.git("config", "core.autocrlf", "false")
        self.git("add", ".")

    def git(self, *args: str) -> None:
        subprocess.run(["git", "-C", str(self.fixture), *args], check=True, capture_output=True)

    def stamp(self, *args: str, root: Path | None = None) -> subprocess.CompletedProcess:
        env = {**os.environ, "LC_ALL": "C", "PYTHONUTF8": "0", "PYTHONCOERCECLOCALE": "0"}
        return subprocess.run(
            [str(SCRIPT), "--root", str(root or self.fixture), *args], env=env, capture_output=True,
        )

    def version(self, manifest: Path | None = None) -> str:
        return json.loads((manifest or self.plugin / "plugin.json").read_text(encoding="utf-8"))["version"]

    def assert_stamp(self, *args: str, root: Path | None = None, returncode: int = 0) -> None:
        result = self.stamp(*args, root=root)
        self.assertEqual(returncode, result.returncode, result.stderr.decode("utf-8"))

    def project(self, root: Path | None = None) -> None:
        """Regenerate the Claude manifest the way `pluginctl build` does."""
        plugin = (root or self.fixture) / self.plugin.relative_to(self.fixture)
        manifest = json.loads((plugin / "plugin.json").read_text(encoding="utf-8"))
        (plugin / ".claude-plugin/plugin.json").write_bytes(render_claude_manifest(manifest))

    def test_stamp_then_two_checks_is_stable_and_source_changes_version(self) -> None:
        self.assert_stamp()
        self.project()
        first = self.version()
        for _ in range(2):
            self.assert_stamp("--check")
        self.assertEqual(first, self.version(self.legacy))
        (self.plugin / "source.txt").write_bytes(b"two\n")
        self.assert_stamp("--check", returncode=1)
        self.assertEqual(first, self.version())
        self.assert_stamp()
        self.assertNotEqual(first, self.version())

    def test_stamp_writes_only_the_root_and_check_reports_a_stale_claude_manifest(self) -> None:
        self.assert_stamp()
        self.assertEqual("old", self.version(self.legacy))
        result = self.stamp("--check")
        self.assertEqual(1, result.returncode)
        self.assertIn(b"stale projection plugins/fixture/.claude-plugin/plugin.json", result.stdout)
        self.project()
        self.assert_stamp("--check")

    def test_root_metadata_and_new_sources_change_version_but_not_projections(self) -> None:
        self.assert_stamp()
        self.project()
        first = self.version()
        projection = self.plugin / "io.github.kodflow/projections/workflows/example.md"
        projection.parent.mkdir(parents=True)
        projection.write_bytes(b"generated output")
        self.assert_stamp("--check")
        metadata = json.loads(self.legacy.read_text(encoding="utf-8"))
        metadata["description"] = "Nouveau réglage"
        self.legacy.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        # A hand edit of the generated Claude manifest is stale, not a new version.
        self.assert_stamp("--check", returncode=1)
        self.assert_stamp()
        self.assertEqual(first, self.version())
        self.project()
        self.assert_stamp("--check")
        metadata = json.loads((self.plugin / "plugin.json").read_text(encoding="utf-8"))
        metadata["description"] = "Nouveau réglage"
        (self.plugin / "plugin.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        self.assert_stamp("--check", returncode=1)
        self.assert_stamp()
        self.assertNotEqual(first, self.version())
        (self.plugin / "new-input.txt").write_bytes(b"new untracked source\n")
        self.assert_stamp("--check", returncode=1)

    def test_crlf_checkout_is_stable_and_binary_bytes_are_significant(self) -> None:
        (self.fixture / ".gitattributes").write_bytes(b"*.blob -text\n")
        binary = self.plugin / "binary.blob"
        binary.write_bytes(b"raw\r\nimage\r\n")
        self.git("add", ".")
        self.assert_stamp()
        self.project()
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "-qm", "Create stamped source")
        checkout = self.fixture.parent / "crlf"
        subprocess.run(
            ["git", "-c", "core.autocrlf=true", "clone", "-q", str(self.fixture), str(checkout)],
            check=True, capture_output=True,
        )
        checked_plugin = checkout / self.plugin.relative_to(self.fixture)
        self.assertEqual(b"one\r\n", (checked_plugin / "source.txt").read_bytes())
        self.assert_stamp("--check", root=checkout)
        (checked_plugin / "binary.blob").write_bytes(b"raw\nimage\n")
        self.assert_stamp("--check", root=checkout, returncode=1)
