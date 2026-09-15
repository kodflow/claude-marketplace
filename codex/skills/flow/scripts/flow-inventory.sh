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

# Resolve the tree that holds the kodflow plugins. CLAUDE_PLUGIN_ROOT points at
# ONE plugin; its siblings live two or three levels up depending on whether this
# is an installed cache (<cache>/kodflow/<plugin>/<rev>) or the source clone
# (<repo>/plugins/<plugin>). Walking up and globbing covers both without
# encoding either layout.
roots=""
seed="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
d="$seed"
for _ in 1 2 3 4; do
    d="$(dirname "$d")"
    [ "$d" = "/" ] && break
    for cand in "$d"/kodflow-*; do
        [ -d "$cand" ] || continue
        roots="$roots $cand"
    done
done
# Fallback: the default install location, if the walk found nothing.
[ -z "$roots" ] && roots="$HOME/.claude/plugins/cache/kodflow"

# A plugin may be present at several revisions in the cache. Keep the newest
# SKILL.md per skill name so a stale revision cannot inflate the inventory.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

for r in $roots; do
    find "$r" -maxdepth 6 -type f -name SKILL.md 2>/dev/null
done | while read -r f; do
    skill="$(basename "$(dirname "$f")")"
    case "$skill" in _shared|.*) continue ;; esac
    plugin="$(echo "$f" | grep -oE 'kodflow-(workflow|review|devops|specialists|hooks)' | head -1)"
    echo "${skill}	${plugin:-unknown}"
done | sort -u > "$tmp"

if [ "$NAMES_ONLY" = "1" ]; then
    cut -f1 "$tmp" | sort -u
    exit 0
fi

n_skills=$(cut -f1 "$tmp" | sort -u | wc -l | tr -d ' ')

n_agents=0
for r in $roots; do
    c=$(find "$r" -maxdepth 4 -type f -path '*/agents/*.md' 2>/dev/null | xargs -r -n1 basename | sort -u | wc -l)
    [ "$c" -gt "$n_agents" ] && n_agents=$c
done

n_hooks=0
for r in $roots; do
    c=$(find "$r" -maxdepth 4 -type f -path '*/hooks/scripts/*' 2>/dev/null | xargs -r -n1 basename | sort -u | wc -l)
    [ "$c" -gt "$n_hooks" ] && n_hooks=$c
done

echo "# skill<TAB>plugin"
cat "$tmp"
echo "# totals: skills=${n_skills} agents=${n_agents} hook-scripts=${n_hooks}"
