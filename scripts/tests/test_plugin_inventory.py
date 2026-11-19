from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from pluginlib.inventory import build_inventory, canonical_json


ROOT = Path(__file__).resolve().parents[2]


class PluginInventoryTests(unittest.TestCase):
    def test_inventory_covers_the_migration_baseline(self) -> None:
        inventory = build_inventory(ROOT)
        self.assertEqual(9, inventory["totals"]["plugins"])
        self.assertEqual(30, inventory["totals"]["skills"])
        self.assertEqual(49, inventory["totals"]["agents"])
        self.assertEqual(5, inventory["totals"]["hookBundles"])
        workflow = next(plugin for plugin in inventory["plugins"] if plugin["name"] == "kodflow-workflow")
        self.assertIn({"plugin": "kodflow-specialists", "required": False}, workflow["dependencies"])
        by_path = {item["path"]: item["class"] for item in workflow["components"]}
        self.assertEqual("portable", by_path["plugins/kodflow-workflow/plugin.json"])
        self.assertEqual("host-extension", by_path["plugins/kodflow-workflow/.claude-plugin/plugin.json"])

    def test_inventory_omits_ignored_local_output_but_keeps_tracked_fixtures(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Path(temporary)
            plugin = fixture / "plugins/fixture"
            cache = plugin / "__pycache__"
            cache.mkdir(parents=True)
            (fixture / ".gitignore").write_text("__pycache__/\n", encoding="utf-8")
            (cache / "local.pyc").write_bytes(b"local output")
            tracked = cache / "tracked.pyc"
            tracked.write_bytes(b"tracked fixture")
            (plugin / "entrée.txt").write_text("métadonnées", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(fixture)], check=True)
            subprocess.run(["git", "-C", str(fixture), "add", "-f", str(tracked)], check=True)
            inventory = build_inventory(fixture)
        components = {item["path"] for item in inventory["plugins"][0]["components"]}
        self.assertEqual(
            {"plugins/fixture/__pycache__/tracked.pyc", "plugins/fixture/entrée.txt"},
            components,
        )

    def test_committed_inventory_is_current(self) -> None:
        path = ROOT / "docs" / "marketplace" / "inventory.json"
        self.assertEqual(canonical_json(build_inventory(ROOT)).encode("utf-8"), path.read_bytes())
        self.assertEqual(1, json.loads(path.read_text(encoding="utf-8"))["schemaVersion"])

    def test_cli_can_write_and_check_an_external_absolute_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "inventory.json"
            write = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "pluginctl.py"), "inventory", "--write", str(output)],
                check=True,
                capture_output=True,
                text=True,
            )
            check = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "pluginctl.py"), "inventory", "--check", str(output)],
                check=True,
                capture_output=True,
                text=True,
            )
            standalone = [sys.executable, str(ROOT / "scripts" / "plugin-inventory.py")]
            canonical = Path(temporary) / "indépendant.json"
            standalone_write = subprocess.run(
                [*standalone, "--write", str(canonical)], check=True, capture_output=True, text=True,
            )
            self.assertEqual(output.read_bytes(), canonical.read_bytes())
            standalone_check = subprocess.run(
                [*standalone, "--check", str(output)], check=True, capture_output=True, text=True,
            )
            output.write_bytes(b"stale")
            stale = subprocess.run(
                [*standalone, "--check", str(output)], capture_output=True, text=True,
            )
        self.assertIn(str(output), write.stdout)
        self.assertIn(str(output), check.stdout)
        self.assertIn(str(canonical), standalone_write.stdout)
        self.assertIn(str(output), standalone_check.stdout)
        self.assertEqual(1, stale.returncode)
        self.assertIn(str(output), stale.stderr)
