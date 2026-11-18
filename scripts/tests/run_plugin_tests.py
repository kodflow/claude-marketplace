#!/usr/bin/env python3
"""Run the universal marketplace suite and refuse an empty discovery."""

from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

suite = unittest.TestSuite(
    unittest.TestLoader().discover(str(Path(__file__).parent), pattern)
    for pattern in ("test_plugin_*.py", "test_role_compiler.py", "test_workflow_engine.py")
)
if suite.countTestCases() == 0:
    raise SystemExit("plugin test discovery found zero tests")
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(not result.wasSuccessful())
