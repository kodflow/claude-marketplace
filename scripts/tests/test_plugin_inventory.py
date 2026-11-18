from __future__ import annotations

import json
from pathlib import Path
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

    def test_committed_inventory_is_current(self) -> None:
        path = ROOT / "docs" / "marketplace" / "inventory.json"
        self.assertEqual(canonical_json(build_inventory(ROOT)), path.read_text())
        self.assertEqual(1, json.loads(path.read_text())["schemaVersion"])
