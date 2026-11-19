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
#   ./scripts/install.sh --legacy     use the flat Codex installation
#   ./scripts/install.sh --checkout  register this checkout in Claude as well
#   ./scripts/install.sh --check      report, change nothing
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MARKET_URL="https://github.com/kodflow/claude-marketplace.git"
DO_CLAUDE=1 DO_CODEX=1 CHECK=0 LEGACY=0
for a in "$@"; do
  case "$a" in
    --claude) DO_CODEX=0 ;;
    --codex)  DO_CLAUDE=0 ;;
    --legacy) LEGACY=1 ;;
    --checkout) MARKET_URL=$HERE ;;
    --check)  CHECK=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
say() { printf '  %s\n' "$*"; }
# The marketplace manifest is the list of plugins. jq when it is there, a plain
# grep otherwise: this installer runs on machines that have nothing yet.
plugin_names() {
  local m=$1
  if command -v jq >/dev/null 2>&1; then
    jq -r '.plugins[].name' "$m" 2>/dev/null
  else
    grep -o '"name"[[:space:]]*:[[:space:]]*"kodflow-[^"]*"' "$m" 2>/dev/null |
      sed 's/.*"\(kodflow-[^"]*\)"/\1/'
  fi | grep -vxF -f <(per_project) 2>/dev/null
}
# Plugins a project enables for itself (enabledPlugins in its own
# .claude/settings.json), never installed for the user: one name a line in
# scripts/install-exclude.txt, # comments allowed. Read here, so the list is
# data the tests can check, not a second hand-kept list of what to install.
per_project() {
  sed -e 's/#.*//' -e 's/[[:space:]]//g' "$HERE/scripts/install-exclude.txt" 2>/dev/null | grep . || echo '#none'
}
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
    # Read from the manifest, never a second hand-kept list: the previous one
    # silently stopped installing a plugin the day a sixth was added.
    for p in $(plugin_names "$HERE/.claude-plugin/marketplace.json"); do
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

native_codex() {
  [ "$LEGACY" -eq 0 ] &&
    [ -f "$HERE/.agents/plugins/marketplace.json" ] &&
    codex plugin marketplace add --help >/dev/null 2>&1 &&
    codex plugin add --help >/dev/null 2>&1
}

install_codex_agents() {
  local directory=$1 f name
  run mkdir -p "$directory" || return 1
  for f in "$HERE"/codex/agents/*.toml; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    if [ "$CHECK" -eq 1 ]; then say "would: install agent $name"; continue; fi
    local staged
    staged=$(mktemp "$directory/.kodflow-agent.XXXXXXXX") || return 1
    if ! cp "$f" "$staged" || ! mv -f "$staged" "$directory/$name"; then
      rm -f "$staged"
      say "FAILED agent $name"
      return 1
    fi
  done
}

# -------------------------------------------------------------------- Codex
if [ "$DO_CODEX" -eq 1 ]; then
  echo "Codex"
  codex_dir=${CODEX_HOME:-$HOME/.codex}
  if ! command -v codex >/dev/null 2>&1; then
    say "codex CLI not found — skipping (npm i -g @openai/codex)"
  elif native_codex; then
    # A checkout pinned to a Git SHA registers that checkout's marketplace.
    say "native marketplace ($HERE)"
    run mkdir -p "$codex_dir" || exit 1
    if ! run codex plugin marketplace add "$HERE"; then
      echo "If Kodflow is registered from another checkout, inspect it with 'codex plugin marketplace list'." >&2
      echo "To switch sources, remove that registration with 'codex plugin marketplace remove kodflow' and rerun the installer." >&2
      exit 1
    fi
    failed=0
    for p in $(plugin_names "$HERE/.agents/plugins/marketplace.json"); do
      run codex plugin add "$p@kodflow" || failed=1
    done
    [ "$failed" -eq 0 ] || {
      echo "native Codex installation incomplete; use --legacy to restore the flat installation" >&2
      exit 1
    }
    # Codex discovers custom roles in its agent directory.
    install_codex_agents "$codex_dir/agents" || exit 1
  else
    say "flat installation ($codex_dir)"
    run mkdir -p "$codex_dir/skills" || exit 1
    # Stage, then swap. Removing the destination before the copy meant a copy
    # that failed had already destroyed the previous skill and "done" was
    # printed regardless. Now nothing is removed until its replacement exists.
    if [ "$CHECK" -eq 0 ]; then
      STAGE=$(mktemp -d "$codex_dir/.kodflow-install.XXXXXXXX") || exit 1
      trap 'rm -rf "$STAGE"' EXIT
    fi
    failed=0
    for d in "$HERE"/codex/skills/*/; do
      [ -d "$d" ] || continue
      n=$(basename "$d")
      if [ "$CHECK" -eq 1 ]; then say "would: install skill $n"; continue; fi
      dest=$codex_dir/skills/$n
      backup=$STAGE/previous-$n
      if ! cp -r "$d" "$STAGE/$n"; then
        say "FAILED skill $n — previous version left in place"; failed=1
        continue
      fi
      if { [ -e "$dest" ] || [ -L "$dest" ]; } && ! mv "$dest" "$backup"; then
        say "FAILED skill $n — previous version left in place"; failed=1
        continue
      fi
      if mv "$STAGE/$n" "$dest"; then
        say "skill $n"
      else
        if [ -e "$backup" ] || [ -L "$backup" ]; then
          mv "$backup" "$dest" || {
            trap - EXIT
            echo "could not restore $dest; previous copy retained in $backup" >&2
            exit 1
          }
        fi
        say "FAILED skill $n — previous version left in place"; failed=1
      fi
    done
    install_codex_agents "$codex_dir/agents" || failed=1
    [ "$failed" -eq 0 ] || { echo "install incomplete — see FAILED lines above" >&2; exit 1; }
    # Retire what this repository used to ship and no longer does. Copying
    # only what exists leaves a deleted skill installed and discoverable for
    # ever — the user goes on typing a command the project has dropped.
    # Nothing is removed unless it carries the generator's marker, so a skill
    # or agent the user wrote themselves is never a candidate.
    for d in "$codex_dir"/skills/*/; do
      [ -d "$d" ] || continue
      n=$(basename "$d")
      [ -d "$HERE/codex/skills/$n" ] && continue
      grep -q 'generated-from: plugins/\*/skills/' "$d/SKILL.md" 2>/dev/null || continue
      if [ "$CHECK" -eq 1 ]; then say "would: retire skill $n (no longer shipped)"; continue; fi
      run rm -rf "$d" && say "retired skill $n (no longer shipped)"
    done
    for f in "$codex_dir"/agents/*.toml; do
      [ -f "$f" ] || continue
      b=$(basename "$f")
      [ -f "$HERE/codex/agents/$b" ] && continue
      head -1 "$f" | grep -q '^# generated-from: plugins/\*/agents/' || continue
      if [ "$CHECK" -eq 1 ]; then say "would: retire agent $b (no longer shipped)"; continue; fi
      run rm -f "$f" && say "retired agent $b (no longer shipped)"
    done

    c=$(find "$HERE/codex/agents" -name '*.toml' 2>/dev/null | wc -l | tr -d ' ')
    say "$c custom agents"
  fi
fi

echo
if [ "$CHECK" -eq 1 ]; then say "done — check mode, nothing was written"; else say "done"; fi
