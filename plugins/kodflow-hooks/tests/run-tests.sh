#!/bin/bash
# run-tests.sh — kodflow-hooks' own suite (the hook scripts are covered by
# scripts/tests/test_hooks.sh at the repository root, the delegation gate by
# test_root_gate.sh here, the routing gate, the gated-model fallback and the
# agent feedback by test_agents.sh, the Go-project rule by test_gomod.sh, the
# cleanup of a subagent's worktree on close by test_cleanup.sh, the mod by tests/mod: run-node.ts under node, the
# *.test.ts files under `claude plugin test`).
set -e
cd "$(dirname "$0")"
# node runs the TypeScript as it is from 22.18 (type stripping on by default);
# an older node, or none, leaves the mod to the CI job that installs one.
if command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)'; then
    node mod/run-node.ts
else
    echo "mod: node >= 22.18 not found, tests/mod/run-node.ts skipped"
fi
bash test_root_gate.sh
bash test_agents.sh
bash test_lock.sh
bash test_zsh_safe.sh
bash test_gomod.sh
bash test_cleanup.sh
