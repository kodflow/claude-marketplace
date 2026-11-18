from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "stamp-versions.py"


class PluginVersionTests(unittest.TestCase):
    def test_stamp_then_two_checks_is_stable_and_source_changes_version(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Path(temporary)
            plugin = fixture / "plugins" / "fixture"
            (plugin / ".claude-plugin").mkdir(parents=True)
            portable = {"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": "fixture", "version": "old"}
            legacy = {"name": "fixture", "version": "old"}
            (plugin / "plugin.json").write_text(json.dumps(portable))
            (plugin / ".claude-plugin" / "plugin.json").write_text(json.dumps(legacy))
            (plugin / "source.txt").write_text("one\n")
            subprocess.run(["git", "init", "-q", str(fixture)], check=True)
            subprocess.run(["git", "-C", str(fixture), "add", "."], check=True)
            subprocess.run([str(SCRIPT), "--root", str(fixture)], check=True)
            first = json.loads((plugin / "plugin.json").read_text())["version"]
            for _ in range(2):
                subprocess.run([str(SCRIPT), "--root", str(fixture), "--check"], check=True)
            self.assertEqual(first, json.loads((plugin / ".claude-plugin" / "plugin.json").read_text())["version"])
            (plugin / "source.txt").write_text("two\n")
            subprocess.run([str(SCRIPT), "--root", str(fixture)], check=True)
            self.assertNotEqual(first, json.loads((plugin / "plugin.json").read_text())["version"])
