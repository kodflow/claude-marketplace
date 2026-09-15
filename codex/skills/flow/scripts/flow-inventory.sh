#!/bin/bash
# ============================================================================
# flow-inventory.sh - Enumerate what kodflow actually ships, right now
# Usage: flow-inventory.sh [--names-only]
# Exit 0 = always (fail-open; an empty inventory is reported, never fatal)
# ============================================================================
# The diagrams in diagrams.md are hand-laid-out, because a generated box tree
# is unreadable. Hand-laid-out means they can fall behind the plugins. This
# script is the other half of that bargain: it reports the live skill set so
# /flow --check can name the drift instead of drawing a diagram that lies.
# ============================================================================

set +e

NAMES_ONLY=0
[ "$1" = "--names-only" ] && NAMES_ONLY=1

# --- Discovery -------------------------------------------------------------
# Three layouts ship this file, and they nest differently:
#   source clone  <repo>/plugins/<plugin>/skills/flow/scripts/
#   Claude cache  <cache>/kodflow/<plugin>/<revision>/skills/flow/scripts/
#   Codex home    ${CODEX_HOME:-~/.codex}/skills/flow/scripts/   (flat, no plugins)
# Arrays throughout: a path containing a space used to be split into fragments
# that matched nothing, which silently emptied the inventory instead of failing.
roots=()

self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
codex_home="${CODEX_HOME:-$HOME/.codex}"

# Codex installs the skills flat under one directory and keeps no plugin dirs,
# so the walk below would find nothing and fall through to the Claude cache —
# reporting another runtime's inventory, or none. Detect it from our own path.
case "$self_dir" in
    "$codex_home"/skills/*) roots=("$codex_home/skills") ;;
esac

if [ ${#roots[@]} -eq 0 ]; then
    # CLAUDE_PLUGIN_ROOT points at ONE plugin; its siblings live two or three
    # levels up. Walking up and globbing covers clone and cache without
    # encoding either layout.
    seed="${CLAUDE_PLUGIN_ROOT:-$(cd "$self_dir/../../../.." && pwd)}"
    d="$seed"
    for _ in 1 2 3 4; do
        d="$(dirname "$d")"
        [ "$d" = "/" ] && break
        for cand in "$d"/kodflow-*; do
            [ -d "$cand" ] || continue
            roots+=("$cand")
        done
    done
    # Fallback: the default install location, if the walk found nothing.
    [ ${#roots[@]} -eq 0 ] && roots=("$HOME/.claude/plugins/cache/kodflow")
fi

# --- Resolve each root to the one tree that is actually active --------------
# A plugin stays in the cache at several revisions after an update. Searching
# all of them reports skills that were deleted revisions ago as installed, and
# no amount of deduplication downstream can tell a stale name from a live one:
# the choice has to happen here, by keeping only the newest revision per plugin.
scan=()
for r in "${roots[@]}"; do
    [ -d "$r" ] || continue
    if [ -d "$r/skills" ] || [ -d "$r/agents" ] || [ -d "$r/hooks" ]; then
        scan+=("$r")                      # clone, or a revision passed directly
        continue
    fi
    newest=""
    for rev in "$r"/*/; do
        [ -d "${rev}skills" ] || [ -d "${rev}agents" ] || [ -d "${rev}hooks" ] || continue
        if [ -z "$newest" ] || [ "$rev" -nt "$newest" ]; then
            newest="$rev"
        fi
    done
    [ -n "$newest" ] && scan+=("${newest%/}")
done
[ ${#scan[@]} -eq 0 ] && scan=("${roots[@]}")

# --- Skills ----------------------------------------------------------------
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

for r in "${scan[@]}"; do
    find "$r" -maxdepth 4 -type f -name SKILL.md 2>/dev/null
done | while read -r f; do
    skill="$(basename "$(dirname "$f")")"
    case "$skill" in _shared|.*) continue ;; esac
    plugin="$(echo "$f" | grep -oE 'kodflow-(workflow|review|devops|specialists|hooks)' | head -1)"
    if [ -z "$plugin" ]; then
        case "$f" in "$codex_home"/*) plugin="codex" ;; *) plugin="unknown" ;; esac
    fi
    printf '%s\t%s\n' "$skill" "$plugin"
done | sort -u > "$tmp"

if [ "$NAMES_ONLY" = "1" ]; then
    cut -f1 "$tmp" | sort -u
    exit 0
fi

n_skills=$(cut -f1 "$tmp" | sort -u | wc -l | tr -d ' ')

# Union, not max: agents and hook scripts are split across plugins, so taking
# the largest single root undercounts whenever more than one root carries some.
count_unique() {
    local pattern="$1" r
    for r in "${scan[@]}"; do
        find "$r" -maxdepth 4 -type f -path "$pattern" 2>/dev/null
    done | xargs -r -n1 basename | sort -u | wc -l | tr -d ' '
}
n_agents=$(count_unique '*/agents/*.md')
n_hooks=$(count_unique '*/hooks/scripts/*')

echo "# skill<TAB>plugin"
cat "$tmp"
echo "# totals: skills=${n_skills} agents=${n_agents} hook-scripts=${n_hooks}"
