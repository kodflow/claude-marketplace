#!/usr/bin/env bash
# Load one portable package through every installed host in isolated homes.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
smoke_root=$(mktemp -d)
ran=0

if command -v claude >/dev/null 2>&1; then
  claude_home="$smoke_root/claude-home"
  mkdir -p "$claude_home/config"
  CLAUDE_CONFIG_DIR="$claude_home/config" HOME="$claude_home" \
    claude plugin validate --strict "$repo/plugins/kodflow-workflow"
  CLAUDE_CONFIG_DIR="$claude_home/config" HOME="$claude_home" \
    claude plugin marketplace add --scope user --json "$repo"
  result=$(CLAUDE_CONFIG_DIR="$claude_home/config" HOME="$claude_home" \
    claude plugin install --scope user --json kodflow-workflow@kodflow)
  grep -q 'kodflow-workflow' <<<"$result"
  echo "Claude loaded kodflow-workflow in an isolated home"
  ran=$((ran + 1))
fi

if command -v codex >/dev/null 2>&1; then
  codex_home="$smoke_root/codex-home"
  mkdir -p "$codex_home/config"
  CODEX_HOME="$codex_home/config" HOME="$codex_home" \
    codex plugin marketplace add --json "$repo"
  result=$(CODEX_HOME="$codex_home/config" HOME="$codex_home" \
    codex plugin add kodflow-workflow@kodflow --json)
  grep -q 'kodflow-workflow' <<<"$result"
  echo "Codex loaded kodflow-workflow in an isolated home"
  ran=$((ran + 1))
fi

if (( ran == 0 )); then
  echo "No supported host CLI is installed; loader smoke test skipped"
fi
