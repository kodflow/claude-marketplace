"""The /review triage rules for CodeRabbit `--agent` NDJSON, run on a fixture.

The rules live as instructions in plugins/kodflow-review/skills/review/triage.md;
this reference implementation pins them so the documented mapping stays checkable
without network access or a CodeRabbit account.
"""

from __future__ import annotations

import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
FIXTURE = Path(__file__).parent / "fixtures" / "coderabbit-agent.ndjson"
TRIAGE = ROOT / "plugins/kodflow-review/skills/review/triage.md"
TIERS = ROOT / "plugins/kodflow-review/skills/review/tiers.md"
SEVERITY = {"critical": "CRITICAL", "major": "HIGH", "minor": "MEDIUM", "trivial": "LOW", "info": "LOW"}


def parse(text: str) -> tuple[list[dict], bool]:
    """Return (findings, completed-with-a-review)."""
    findings, ran = [], False
    for line in text.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "complete":
            ran = event.get("status") != "review_skipped"
        if "severity" not in event or "fileName" not in event:
            continue
        severity = SEVERITY.get(event["severity"])
        if severity is None:
            continue
        recommendation = event.get("codegenInstructions") or "; ".join(event.get("suggestions") or []) or event.get("comment", "")
        findings.append({"severity": severity, "file": event["fileName"],
                         "evidence": event.get("comment", ""), "recommendation": recommendation,
                         "impact": "external-coderabbit", "source": "coderabbit"})
    return findings, ran


class CodeRabbitNdjsonTests(unittest.TestCase):
    def test_fixture_maps_to_the_review_schema(self) -> None:
        findings, ran = parse(FIXTURE.read_text(encoding="utf-8"))
        self.assertTrue(ran)
        self.assertEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"], [f["severity"] for f in findings])
        self.assertEqual("In src/auth/session.go replace the == comparison with subtle.ConstantTimeCompare.",
                         findings[0]["recommendation"])
        self.assertEqual("State Go 1.22 or later.", findings[2]["recommendation"])
        self.assertEqual(findings[3]["evidence"], findings[3]["recommendation"])

    def test_a_skipped_review_is_not_a_clean_one(self) -> None:
        findings, ran = parse('{"type":"complete","status":"review_skipped","findings":0}\n')
        self.assertEqual(([], False), (findings, ran))
        self.assertEqual(([], False), parse('{"type":"heartbeat"}\n'))

    def test_instructions_match_the_documented_command(self) -> None:
        tiers = TIERS.read_text(encoding="utf-8")
        self.assertIn("coderabbit review --agent --committed", tiers)
        for stale in ("--plain", "--type", "--no-color"):
            self.assertNotIn(stale, tiers)
        triage = TRIAGE.read_text(encoding="utf-8")
        for word in ("NDJSON", "fileName", "codegenInstructions", "suggestions", "review_skipped",
                     "critical", "major", "minor", "trivial", "info"):
            self.assertIn(word, triage)
        self.assertNotIn("plain text output", triage)


if __name__ == "__main__":
    unittest.main()
