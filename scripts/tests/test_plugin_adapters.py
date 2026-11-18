from __future__ import annotations

from pathlib import Path
import copy
import json
import unittest

from jsonschema import Draft202012Validator

from pluginlib.adapters import build_archive, compatibility_report, render_openai_marketplace, validate_archive
from pluginlib.model import Catalog


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

    def test_equivalent_report_requires_a_nonempty_verifier(self) -> None:
        package = self.catalog.packages()[0]
        report = compatibility_report(package, "claude")
        schema = json.loads(
            (ROOT / "schemas" / "compatibility-report-v1.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual([], list(Draft202012Validator(schema).iter_errors(report)))
        invalid = copy.deepcopy(report)
        equivalent = next(item for item in invalid["capabilities"] if item["status"] == "equivalent")
        equivalent["verifierId"] = None
        self.assertTrue(list(Draft202012Validator(schema).iter_errors(invalid)))
