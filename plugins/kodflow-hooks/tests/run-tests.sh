#!/bin/bash
# run-tests.sh — kodflow-hooks' own suite (the hook scripts are covered by
# scripts/tests/test_hooks.sh at the repository root, the reviewer gate by
# test_root_gate.sh here).
set -e
cd "$(dirname "$0")"
python3 -m unittest -v test_tasks_mcp 2>&1
bash test_root_gate.sh
