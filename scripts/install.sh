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
    for p in kodflow-workflow kodflow-review kodflow-devops kodflow-specialists kodflow-hooks; do
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
    # Stage, then swap. Removing the destination before the copy meant a copy
    # that failed had already destroyed the previous skill and "done" was
    # printed regardless. Now nothing is removed until its replacement exists.
    STAGE=$(mktemp -d) || { echo "cannot create a staging directory" >&2; exit 1; }
    trap 'rm -rf "$STAGE"' EXIT
    failed=0
    for d in "$HERE"/codex/skills/*/; do
      [ -d "$d" ] || continue
      n=$(basename "$d")
      if [ "$CHECK" -eq 1 ]; then say "would: install skill $n"; continue; fi
      if cp -r "$d" "$STAGE/$n" && rm -rf "$HOME/.codex/skills/$n" && mv "$STAGE/$n" "$HOME/.codex/skills/$n"; then
        say "skill $n"
      else
        say "FAILED skill $n — previous version left in place"; failed=1
      fi
    done
    for f in "$HERE"/codex/agents/*.toml; do
      [ -f "$f" ] || continue
      if [ "$CHECK" -eq 1 ]; then continue; fi
      cp "$f" "$STAGE/agent.toml" && mv "$STAGE/agent.toml" "$HOME/.codex/agents/$(basename "$f")" \
        || { say "FAILED agent $(basename "$f")"; failed=1; }
    done
    # Retire what this repository used to ship and no longer does. Copying
    # only what exists leaves a deleted skill installed and discoverable for
    # ever — the user goes on typing a command the project has dropped.
    # Nothing is removed unless it carries the generator's marker, so a skill
    # or agent the user wrote themselves is never a candidate.
    for d in "$HOME"/.codex/skills/*/; do
      [ -d "$d" ] || continue
      n=$(basename "$d")
      [ -d "$HERE/codex/skills/$n" ] && continue
      grep -q 'generated-from: plugins/\*/skills/' "$d/SKILL.md" 2>/dev/null || continue
      if [ "$CHECK" -eq 1 ]; then say "would: retire skill $n (no longer shipped)"; continue; fi
      run rm -rf "$d" && say "retired skill $n (no longer shipped)"
    done
    for f in "$HOME"/.codex/agents/*.toml; do
      [ -f "$f" ] || continue
      b=$(basename "$f")
      [ -f "$HERE/codex/agents/$b" ] && continue
      head -1 "$f" | grep -q '^# generated-from: plugins/\*/agents/' || continue
      if [ "$CHECK" -eq 1 ]; then say "would: retire agent $b (no longer shipped)"; continue; fi
      run rm -f "$f" && say "retired agent $b (no longer shipped)"
    done

    [ "$failed" -eq 0 ] || { echo "install incomplete — see FAILED lines above" >&2; exit 1; }
    c=$(find "$HERE/codex/agents" -name '*.toml' 2>/dev/null | wc -l | tr -d ' ')
    say "$c custom agents"
  else
    say "codex CLI not found — skipping (npm i -g @openai/codex)"
  fi
fi

echo
if [ "$CHECK" -eq 1 ]; then say "done — check mode, nothing was written"; else say "done"; fi
