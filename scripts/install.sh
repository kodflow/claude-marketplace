#!/usr/bin/env bash
# Install this configuration on both agent CLIs.
#
# Idempotent: safe to re-run, reports what it changed and what it left alone.
# It never writes a credential and never overwrites one you already have — the
# MCP template is copied only when no config exists, because clobbering a file
# holding a working token is the one unrecoverable thing an installer can do.
#
#   ./scripts/install.sh              both sides, if present
#   ./scripts/install.sh --claude     Claude Code only
#   ./scripts/install.sh --codex      Codex only
#   ./scripts/install.sh --check      report, change nothing
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MARKET_URL="https://github.com/kodflow/claude-marketplace.git"
DO_CLAUDE=1 DO_CODEX=1 CHECK=0
for a in "$@"; do
  case "$a" in
    --claude) DO_CODEX=0 ;;
    --codex)  DO_CLAUDE=0 ;;
    --check)  CHECK=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
say() { printf '  %s\n' "$*"; }
run() { [ "$CHECK" -eq 1 ] && { say "would: $*"; return 0; }; "$@"; }

# ---------------------------------------------------------------- preflight
command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
if command -v python3 >/dev/null 2>&1; then
  python3 "$HERE/scripts/sanitize.py" "$HERE" >/dev/null || {
    echo "refusing to install: the tree failed its own secret scan" >&2; exit 1; }
  say "secret scan: clean"
fi

# ------------------------------------------------------------------- Claude
if [ "$DO_CLAUDE" -eq 1 ]; then
  echo "Claude Code"
  if command -v claude >/dev/null 2>&1; then
    # `claude plugin` is the supported path; it resolves the marketplace and
    # installs each plugin at its pinned subdirectory.
    run claude plugin marketplace add "$MARKET_URL" 2>/dev/null \
      && say "marketplace registered" \
      || say "marketplace already registered (or the CLI declined) — continuing"
    for p in kodflow-workflow kodflow-review kodflow-devops kodflow-specialists; do
      run claude plugin install "$p@kodflow" 2>/dev/null \
        && say "installed $p" || say "$p already installed or unavailable"
    done
  else
    say "claude CLI not found — skipping"
  fi

  # MCP: template only when nothing is there. Never overwrite a live config.
  MCP="$HOME/.claude/mcp.json"
  if [ -e "$MCP" ]; then
    say "mcp.json exists — left untouched (compare with mcp/mcp.example.json yourself)"
  else
    run mkdir -p "$HOME/.claude"
    run cp "$HERE/mcp/mcp.example.json" "$MCP"
    say "mcp.json seeded from the template — export the referenced variables before use"
  fi
fi

# -------------------------------------------------------------------- Codex
if [ "$DO_CODEX" -eq 1 ]; then
  echo "Codex"
  if command -v codex >/dev/null 2>&1; then
    run mkdir -p "$HOME/.codex/skills" "$HOME/.codex/agents"
    for d in "$HERE"/codex/skills/*/; do
      [ -d "$d" ] || continue
      n=$(basename "$d")
      run rm -rf "$HOME/.codex/skills/$n"
      run cp -r "$d" "$HOME/.codex/skills/$n"
      say "skill $n"
    done
    for f in "$HERE"/codex/agents/*.toml; do
      [ -f "$f" ] || continue
      run cp "$f" "$HOME/.codex/agents/$(basename "$f")"
    done
    c=$(find "$HERE/codex/agents" -name '*.toml' 2>/dev/null | wc -l | tr -d ' ')
    say "$c custom agents"
  else
    say "codex CLI not found — skipping (npm i -g @openai/codex)"
  fi
fi

echo
if [ "$CHECK" -eq 1 ]; then say "done — check mode, nothing was written"; else say "done"; fi
