#!/bin/bash
# ============================================================================
# test_flow_inventory.sh - flow-inventory.sh against the three shipped layouts
# ============================================================================
# The script picks its search roots from its own location and the environment,
# so the layouts are the thing under test: a source clone, a Claude cache that
# still holds an obsolete revision, and a flat Codex home. Each one gets a
# throwaway tree with a known skill set, and the inventory must name exactly it.
# ============================================================================

set -u

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/../plugins/kodflow-workflow/skills/flow/scripts/flow-inventory.sh"
SRC="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"
pass=0; fail=0

check() { # name expected actual
    if [ "$2" = "$3" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3"
    fi
}

mkskill() { mkdir -p "$1/$2" && printf -- '---\nname: %s\n---\n' "$2" > "$1/$2/SKILL.md"; }

# --- Layout 1: source clone ------------------------------------------------
t1="$(mktemp -d)"
repo="$t1/claude-marketplace"
for p in workflow review; do mkdir -p "$repo/plugins/kodflow-$p/skills"; done
mkskill "$repo/plugins/kodflow-workflow/skills" plan
mkskill "$repo/plugins/kodflow-workflow/skills" flow
mkskill "$repo/plugins/kodflow-workflow/skills" _shared
mkskill "$repo/plugins/kodflow-review/skills" review
install -D "$SRC" "$repo/plugins/kodflow-workflow/skills/flow/scripts/flow-inventory.sh"
got="$(CLAUDE_PLUGIN_ROOT="$repo/plugins/kodflow-workflow" CODEX_HOME="$t1/none" \
    bash "$repo/plugins/kodflow-workflow/skills/flow/scripts/flow-inventory.sh" --names-only | tr '\n' ' ')"
check "source clone lists every skill and drops _shared" "flow plan review " "$got"

# --- Layout 2: Claude cache with a stale revision --------------------------
# The old revision carries a skill that the new one deleted. The deleted skill
# must not be reported as installed — this is what deduplication cannot fix.
t2="$(mktemp -d)"
cache="$t2/.claude/plugins/cache/kodflow"
mkdir -p "$cache/kodflow-workflow/aaaa-old/skills" "$cache/kodflow-workflow/bbbb-new/skills"
mkskill "$cache/kodflow-workflow/aaaa-old/skills" plan
mkskill "$cache/kodflow-workflow/aaaa-old/skills" retired
mkskill "$cache/kodflow-workflow/bbbb-new/skills" plan
mkskill "$cache/kodflow-workflow/bbbb-new/skills" flow
touch -d '2020-01-01' "$cache/kodflow-workflow/aaaa-old"
touch -d '2030-01-01' "$cache/kodflow-workflow/bbbb-new"
install -D "$SRC" "$cache/kodflow-workflow/bbbb-new/skills/flow/scripts/flow-inventory.sh"
got="$(CLAUDE_PLUGIN_ROOT="$cache/kodflow-workflow/bbbb-new" CODEX_HOME="$t2/none" \
    bash "$cache/kodflow-workflow/bbbb-new/skills/flow/scripts/flow-inventory.sh" --names-only | tr '\n' ' ')"
check "stale revision does not inflate the inventory" "flow plan " "$got"

# --- Layout 3: flat Codex home ---------------------------------------------
# A decoy Claude cache sits in the same HOME: picking it up would report the
# wrong runtime's skills, which is exactly the fallback this layout must avoid.
t3="$(mktemp -d)"
mkdir -p "$t3/.claude/plugins/cache/kodflow/kodflow-workflow/rev/skills"
mkskill "$t3/.claude/plugins/cache/kodflow/kodflow-workflow/rev/skills" decoy
mkdir -p "$t3/.codex/skills"
mkskill "$t3/.codex/skills" plan
mkskill "$t3/.codex/skills" flow
install -D "$SRC" "$t3/.codex/skills/flow/scripts/flow-inventory.sh"
got="$(env -u CLAUDE_PLUGIN_ROOT HOME="$t3" CODEX_HOME="$t3/.codex" \
    bash "$t3/.codex/skills/flow/scripts/flow-inventory.sh" --names-only | tr '\n' ' ')"
check "codex home is scanned instead of the claude cache" "flow plan " "$got"

# --- Layout 4: a path containing a space -----------------------------------
t4="$(mktemp -d)/my projects"
mkdir -p "$t4/plugins/kodflow-workflow/skills"
mkskill "$t4/plugins/kodflow-workflow/skills" plan
mkskill "$t4/plugins/kodflow-workflow/skills" flow
install -D "$SRC" "$t4/plugins/kodflow-workflow/skills/flow/scripts/flow-inventory.sh"
got="$(CLAUDE_PLUGIN_ROOT="$t4/plugins/kodflow-workflow" CODEX_HOME="$t4/none" \
    bash "$t4/plugins/kodflow-workflow/skills/flow/scripts/flow-inventory.sh" --names-only | tr '\n' ' ')"
check "a space in the path does not empty the inventory" "flow plan " "$got"

# --- Totals line -----------------------------------------------------------
mkdir -p "$repo/plugins/kodflow-specialists/agents" "$repo/plugins/kodflow-hooks/hooks/scripts"
printf -- '---\nname: a\n---\n' > "$repo/plugins/kodflow-specialists/agents/a.md"
printf -- '---\nname: b\n---\n' > "$repo/plugins/kodflow-specialists/agents/b.md"
printf '#!/bin/sh\n' > "$repo/plugins/kodflow-hooks/hooks/scripts/on-stop.sh"
got="$(CLAUDE_PLUGIN_ROOT="$repo/plugins/kodflow-workflow" CODEX_HOME="$t1/none" \
    bash "$repo/plugins/kodflow-workflow/skills/flow/scripts/flow-inventory.sh" | tail -1)"
check "totals count agents and hook scripts across plugins" \
    "# totals: skills=3 agents=2 hook-scripts=1" "$got"

rm -rf "$t1" "$t2" "$t3" "$(dirname "$t4")"

printf 'flow-inventory: %d/%d layouts correct\n' "$pass" "$((pass + fail))"
[ "$fail" -eq 0 ]
