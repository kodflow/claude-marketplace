#!/usr/bin/env bash
# Install this configuration on both agent CLIs.
#
# Idempotent: safe to re-run, reports what it changed and what it left alone.
# It never writes a credential and never overwrites one you already have — the
# MCP template is copied only when no config exists, because clobbering a file
# holding a working token is the one unrecoverable thing an installer can do.
#
#   ./scripts/install.sh              both sides; a missing CLI is skipped
#   ./scripts/install.sh --claude     Claude Code only (CLI required)
#   ./scripts/install.sh --codex      Codex only (CLI required)
#   ./scripts/install.sh --claude --codex   both sides, both required
#   ./scripts/install.sh --legacy     use the flat Codex installation; first
#                                     removes the native plugins (codex plugin
#                                     remove <plugin>@kodflow)
#   ./scripts/install.sh --checkout   register THIS checkout instead of the
#                                     published source: Claude switches an
#                                     existing kodflow marketplace to it (the
#                                     previous source is restored if the add
#                                     fails); Codex keeps a local registration
#                                     instead of the Git source pinned to HEAD
#   ./scripts/install.sh --check      report, change nothing (prints "would: ..."
#                                     and states read from the CLIs)
#   ./scripts/install.sh -h|--help    this text
#
# Without --checkout, Codex registers kodflow/claude-marketplace pinned to the
# commit of this checkout (it must be clean) and the installer verifies the
# pinned revision afterwards.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MARKET_URL="https://github.com/kodflow/claude-marketplace.git"
CODEX_REPO="kodflow/claude-marketplace"
WANT_CLAUDE=0 WANT_CODEX=0 CHECK=0 LEGACY=0 CHECKOUT=0
for a in "$@"; do
  case "$a" in
    --claude) WANT_CLAUDE=1 ;;
    --codex)  WANT_CODEX=1 ;;
    --legacy) LEGACY=1 ;;
    --checkout) CHECKOUT=1; MARKET_URL=$HERE ;;
    --check)  CHECK=1 ;;
    -h|--help) awk 'NR>1 { if ($0 ~ /^#/) print; else exit }' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
# No side named: both, each skipped when its CLI is absent. A side named
# explicitly must be installable, or the run fails.
if [ "$WANT_CLAUDE" -eq 0 ] && [ "$WANT_CODEX" -eq 0 ]; then
  DO_CLAUDE=1 DO_CODEX=1 EXPLICIT=0
else
  DO_CLAUDE=$WANT_CLAUDE DO_CODEX=$WANT_CODEX EXPLICIT=1
fi
say() { printf '  %s\n' "$*"; }
# Names of the manifest's plugins. jq when it is there, an awk walk otherwise
# (this installer runs on machines that have nothing yet): both read the same
# thing, every entry of "plugins", whatever the key order or the layout.
all_names() {
  local m=$1
  if command -v jq >/dev/null 2>&1; then
    jq -r '.plugins[].name' "$m" 2>/dev/null
  else
    manifest_walk "$m" names
  fi
}
# Entries marked "installByDefault": false in the Claude manifest: never
# installed unless asked for, on either side.
nodefault_names() {
  local m="$HERE/.claude-plugin/marketplace.json"
  if command -v jq >/dev/null 2>&1; then
    jq -r '.plugins[] | select(.installByDefault == false) | .name' "$m" 2>/dev/null
  else
    manifest_walk "$m" nodefault
  fi
}
# One token a line (split at braces and commas), then count the braces: a
# plugin is the object at depth 2, its own keys sit at that depth, nested
# objects (author, source) are deeper and ignored.
manifest_walk() {
  sed -e 's/{/\n{\n/g' -e 's/}/\n}\n/g' -e 's/,/\n/g' "$1" 2>/dev/null | awk -v mode="$2" '
    /^[[:space:]]*\{[[:space:]]*$/ { depth++; if (depth == 2) { name = ""; off = 0 } next }
    /^[[:space:]]*\}[[:space:]]*$/ {
      if (depth == 2 && name != "" && (mode == "names" || (mode == "nodefault" && off))) print name
      depth--; next }
    depth == 2 && /"name"[[:space:]]*:/ { n = $0; sub(/.*"name"[[:space:]]*:[[:space:]]*"/, "", n); sub(/".*/, "", n); name = n }
    depth == 2 && /"installByDefault"[[:space:]]*:[[:space:]]*false/ { off = 1 }'
}
# What to install by default: the manifest's names, minus installByDefault:false,
# minus what a project enables for itself.
plugin_names() {
  all_names "$1" | grep -vxF -f <(nodefault_names; per_project) 2>/dev/null
}
# Plugins a project enables for itself (enabledPlugins in its own
# .claude/settings.json), never installed for the user: one name a line in
# scripts/install-exclude.txt, # comments allowed. Read here, so the list is
# data the tests can check, not a second hand-kept list of what to install.
per_project() {
  sed -e 's/#.*//' -e 's/[[:space:]]//g' "$HERE/scripts/install-exclude.txt" 2>/dev/null | grep . || echo '#none'
}
run() { [ "$CHECK" -eq 1 ] && { say "would: $*"; return 0; }; "$@"; }
# Source of the kodflow marketplace as Claude has it, or nothing. Read from
# `claude plugin marketplace list --json`: a directory has a path, a GitHub
# source a repo, a Git source a url.
claude_mp_source() {
  local out
  out=$(claude plugin marketplace list --json 2>/dev/null) || return 0
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$out" | jq -r '.[] | select(.name == "kodflow") | (.path // .repo // .url // empty)' 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$out" | python3 -I -c '
import json, sys
try:
    for m in json.load(sys.stdin):
        if m.get("name") == "kodflow":
            print(m.get("path") or m.get("repo") or m.get("url") or "")
except Exception:
    pass'
  fi
}
same_source() {
  [ "$1" = "$2" ] && return 0
  [ -d "$1" ] && [ -d "$2" ] && [ "$(cd "$1" && pwd -P)" = "$(cd "$2" && pwd -P)" ]
}

# ---------------------------------------------------------------- preflight
command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
# A side named on the command line with its CLI absent is a failure, not a skip.
if [ "$EXPLICIT" -eq 1 ]; then
  if [ "$DO_CLAUDE" -eq 1 ] && ! command -v claude >/dev/null 2>&1; then
    echo "--claude was requested but the claude CLI is not on PATH" >&2; exit 1
  fi
  if [ "$DO_CODEX" -eq 1 ] && ! command -v codex >/dev/null 2>&1; then
    echo "--codex was requested but the codex CLI is not on PATH (npm i -g @openai/codex)" >&2; exit 1
  fi
fi
if command -v python3 >/dev/null 2>&1; then
  python3 "$HERE/scripts/sanitize.py" "$HERE" >/dev/null || {
    echo "refusing to install: the tree failed its own secret scan" >&2; exit 1; }
  say "secret scan: clean"
elif [ "$CHECK" -eq 1 ]; then
  say "secret scan: skipped, python3 is missing (an install would refuse to run)"
else
  echo "refusing to install: python3 is required for the secret scan and is missing" >&2; exit 1
fi

# ------------------------------------------------------------------- Claude
if [ "$DO_CLAUDE" -eq 1 ]; then
  echo "Claude Code"
  if command -v claude >/dev/null 2>&1; then
    prev=$(claude_mp_source)
    [ "$CHECK" -eq 1 ] && say "state: marketplace kodflow source=${prev:-none}"
    if [ "$CHECKOUT" -eq 1 ] && [ -n "$prev" ] && ! same_source "$prev" "$HERE"; then
      # Another source holds the name: `add` would keep it. Switch, and put the
      # previous source back if the new one cannot be added.
      run claude plugin marketplace remove --scope user kodflow || {
        echo "could not remove the kodflow marketplace (source $prev)" >&2; exit 1; }
      if run claude plugin marketplace add "$MARKET_URL"; then
        [ "$CHECK" -eq 1 ] || say "marketplace switched from $prev to $MARKET_URL"
      else
        claude plugin marketplace add "$prev" >/dev/null 2>&1 ||
          echo "could not restore the previous source $prev" >&2
        echo "could not add $MARKET_URL; the previous source $prev was put back" >&2
        exit 1
      fi
    elif [ "$CHECK" -eq 1 ]; then
      run claude plugin marketplace add "$MARKET_URL"
    elif claude plugin marketplace add "$MARKET_URL" >/dev/null 2>&1; then
      say "marketplace registered"
    else
      say "marketplace already registered (or the CLI declined) — continuing"
    fi
    # Read from the manifest, never a second hand-kept list: the previous one
    # silently stopped installing a plugin the day a sixth was added.
    have=""
    [ "$CHECK" -eq 1 ] && have=$(claude plugin list --json 2>/dev/null)
    for p in $(plugin_names "$HERE/.claude-plugin/marketplace.json"); do
      if [ "$CHECK" -eq 1 ]; then
        run claude plugin install "$p@kodflow"
        if [ -n "$have" ]; then
          if printf '%s' "$have" | grep -q "\"id\"[[:space:]]*:[[:space:]]*\"$p@kodflow\""; then
            say "state: $p present"
          else
            say "state: $p absent"
          fi
        fi
      elif claude plugin install "$p@kodflow" >/dev/null 2>&1; then
        say "installed $p"
      else
        say "$p already installed or unavailable"
      fi
    done
  else
    say "claude CLI not found — skipping"
  fi

  # MCP: template only when nothing is there. Never overwrite a live config.
  MCP="$HOME/.claude/mcp.json"
  if [ -e "$MCP" ]; then
    say "mcp.json exists — left untouched (compare with mcp/mcp.example.json yourself)"
  elif [ "$CHECK" -eq 1 ]; then
    say "would: copy mcp/mcp.example.json to $MCP"
  else
    mkdir -p "$HOME/.claude" && cp "$HERE/mcp/mcp.example.json" "$MCP"
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
  # Only files marked by the generator belong to this installer.
  for f in "$directory"/*.toml; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    [ -f "$HERE/codex/agents/$name" ] && continue
    head -1 "$f" | grep -q '^# generated-from: plugins/\*/agents/' || continue
    if [ "$CHECK" -eq 1 ]; then say "would: retire agent $name (no longer shipped)"; continue; fi
    run rm -f "$f" || return 1
    say "retired agent $name (no longer shipped)"
  done
}

# Flat skills this installer copied earlier carry the generator's marker. Once
# the native plugins provide them, the flat copies would shadow or duplicate
# them, so they go; a skill the user wrote has no marker and stays.
retire_flat_skills() {
  local codex_dir=$1 d n
  for d in "$codex_dir"/skills/*/; do
    [ -d "$d" ] || continue
    n=$(basename "$d")
    grep -q 'generated-from: plugins/\*/skills/' "$d/SKILL.md" 2>/dev/null || continue
    if [ "$CHECK" -eq 1 ]; then say "would: retire flat skill $n (provided by the native plugins)"; continue; fi
    rm -rf "$d" && say "retired flat skill $n (provided by the native plugins)"
  done
}
# Root of the kodflow marketplace clone as Codex has it, or nothing.
codex_mp_root() {
  codex plugin marketplace list 2>/dev/null | awk '$1 == "kodflow" { print $2 }'
}
# True when the registered kodflow marketplace is a clone of this repository
# (Git origin of its root), whatever revision it is pinned to. A local path or
# another repository is a foreign source.
codex_mp_is_ours() {
  local root=$1 url
  [ -n "$root" ] || return 1
  url=$(git -C "$root" remote get-url origin 2>/dev/null) || return 1
  url=${url%.git}; url=${url%/}
  case "$url" in
    "${MARKET_URL%.git}"|"git@github.com:$CODEX_REPO"|"ssh://git@github.com/$CODEX_REPO") return 0 ;;
  esac
  return 1
}
# Installed version of a plugin as `codex plugin list --json` reports it.
codex_plugin_version() {
  codex plugin list --json -m kodflow 2>/dev/null | python3 -I -c '
import json, sys
try:
    for p in json.load(sys.stdin).get("installed", []):
        if p.get("pluginId") == sys.argv[1]:
            print(p.get("version") or "")
except Exception:
    pass' "$1"
}
# Moves an existing pinned registration of this repository to a new revision:
# `marketplace add` refuses a different ref, `marketplace upgrade` does not move
# a pinned one, so the registration is removed and added again. Codex keeps the
# plugins' enabled state across the removal; the caller reinstalls them. If the
# add fails, the previous revision is registered again.
switch_codex_marketplace() {
  local sha=$1 root=$2 prev
  prev=$(git -C "$root" rev-parse HEAD 2>/dev/null)
  say "kodflow is registered from this repository at ${prev:-an unknown revision}: replacing it with $sha"
  codex plugin marketplace remove kodflow || return 1
  if codex plugin marketplace add "$CODEX_REPO" --ref "$sha"; then return 0; fi
  if [ -n "$prev" ] && codex plugin marketplace add "$CODEX_REPO" --ref "$prev"; then
    echo "the previous registration ($prev) was restored" >&2
  else
    echo "could not restore the previous registration${prev:+ ($prev)}; inspect it with 'codex plugin marketplace list'" >&2
  fi
  return 1
}
# Registers the marketplace in Codex: pinned to the commit of a clean checkout,
# or this very directory with --checkout. A pinned registration is verified
# afterwards: `codex plugin marketplace list` gives the root of the clone and
# that clone must be at the commit that was asked for. SWITCHED=1 tells the
# caller that an earlier revision was replaced.
SWITCHED=0
register_codex_marketplace() {
  local sha root got out
  if [ "$CHECKOUT" -eq 1 ]; then
    say "native marketplace, local checkout ($HERE)"
    run codex plugin marketplace add "$HERE"
    return
  fi
  sha=$(git -C "$HERE" rev-parse HEAD 2>/dev/null)
  if [ -z "$sha" ] || [ -n "$(git -C "$HERE" status --porcelain 2>/dev/null)" ]; then
    echo "cannot pin the Codex marketplace: $HERE is not a clean Git checkout (commit, or use --checkout to register the directory itself)" >&2
    return 1
  fi
  say "native marketplace, $CODEX_REPO pinned to $sha"
  root=$(codex_mp_root)
  if [ "$CHECK" -eq 1 ]; then
    if codex_mp_is_ours "$root" && [ "$(git -C "$root" rev-parse HEAD 2>/dev/null)" != "$sha" ]; then
      say "would: codex plugin marketplace remove kodflow (replaces the revision registered from this repository)"
    fi
    say "would: codex plugin marketplace add $CODEX_REPO --ref $sha"
    return 0
  fi
  if out=$(codex plugin marketplace add "$CODEX_REPO" --ref "$sha" 2>&1); then
    [ -z "$out" ] || printf '%s\n' "$out"
  else
    case "$out" in *"already added from a different source"*) ;; *) printf '%s\n' "$out" >&2; return 1 ;; esac
    if ! codex_mp_is_ours "$root"; then printf '%s\n' "$out" >&2; return 1; fi
    switch_codex_marketplace "$sha" "$root" || return 1
    SWITCHED=1
  fi
  root=$(codex_mp_root)
  got=$([ -n "$root" ] && git -C "$root" rev-parse HEAD 2>/dev/null)
  if [ "$got" != "$sha" ]; then
    echo "the kodflow marketplace is not at the pinned revision $sha (found: ${got:-unreadable}, root: ${root:-none})" >&2
    return 1
  fi
}

# -------------------------------------------------------------------- Codex
if [ "$DO_CODEX" -eq 1 ]; then
  echo "Codex"
  codex_dir=${CODEX_HOME:-$HOME/.codex}
  if ! command -v codex >/dev/null 2>&1; then
    say "codex CLI not found — skipping (npm i -g @openai/codex)"
  elif native_codex; then
    if [ "$CHECK" -eq 1 ]; then
      state=$(codex plugin marketplace list 2>/dev/null | awk '$1 == "kodflow" { print $2 }')
      say "state: marketplace kodflow root=${state:-none}"
    fi
    run mkdir -p "$codex_dir" || exit 1
    if ! register_codex_marketplace; then
      echo "If Kodflow is registered from another source, inspect it with 'codex plugin marketplace list'." >&2
      echo "To switch to this checkout, remove that registration with 'codex plugin marketplace remove kodflow' and rerun the installer." >&2
      exit 1
    fi
    failed=0
    for p in $(plugin_names "$HERE/.agents/plugins/marketplace.json"); do
      if [ "$SWITCHED" -eq 1 ]; then
        # Reinstalled at the new revision, then checked: the version Codex
        # reports must be the one of the plugin it just installed.
        added=$(codex plugin add "$p@kodflow" 2>&1) || { printf '%s\n' "$added" >&2; failed=1; continue; }
        [ -z "$added" ] || printf '%s\n' "$added"
        want=$(printf '%s\n' "$added" | sed -n 's|^Installed plugin root: .*/||p' | tail -1)
        have=$(codex_plugin_version "$p@kodflow")
        if [ -z "$have" ] || { [ -n "$want" ] && [ "$have" != "$want" ]; }; then
          echo "$p@kodflow: installed version ${have:-unknown} does not match the one just installed (${want:-unknown})" >&2
          failed=1
        else
          say "$p@kodflow at $have"
        fi
      else
        run codex plugin add "$p@kodflow" || failed=1
      fi
    done
    [ "$failed" -eq 0 ] || {
      echo "native Codex installation incomplete; use --legacy to restore the flat installation" >&2
      exit 1
    }
    retire_flat_skills "$codex_dir"
    install_codex_agents "$codex_dir/agents" || exit 1
  else
    say "flat installation ($codex_dir)"
    # Native plugins would shadow the flat skills: take them out first.
    # A plugin that was never added is not an error.
    if [ "$LEGACY" -eq 1 ] && [ -f "$HERE/.agents/plugins/marketplace.json" ]; then
      for p in $(all_names "$HERE/.agents/plugins/marketplace.json"); do
        run codex plugin remove "$p@kodflow"
      done
    fi
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
    c=$(find "$HERE/codex/agents" -name '*.toml' 2>/dev/null | wc -l | tr -d ' ')
    say "$c custom agents"
  fi
fi

echo
if [ "$CHECK" -eq 1 ]; then say "done — check mode, nothing was written"; else say "done"; fi
