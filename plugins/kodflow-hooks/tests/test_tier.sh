#!/bin/bash
# test_tier.sh — on-tier.sh: the tier table reaches the orchestrator and the
# sub-agents that can delegate, nobody else; the budget and every error fail
# open (nothing emitted, exit 0); the markers and the skew files are written
# only when they should be. bash 3.2-safe: macOS CI runs it with /bin/bash.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts/on-tier.sh
TBL=$ROOT/plugins/kodflow-hooks/hooks/tier-table.tsv
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home CLAUDE_CONFIG_DIR=$T/home/.claude CLAUDE_PLUGIN_ROOT=$ROOT/plugins/kodflow-hooks
CFG=$CLAUDE_CONFIG_DIR
SD=$CFG/kodflow/sessions/s1
mkdir -p "$T/repo" "$CFG/plugins" "$CFG/agents"
cd "$T" || exit 1

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
check() { if [ "$2" = yes ]; then ok "$1"; else bad "$1" "${3:-}"; fi; }

run() {   # $1 event, $2 agent_type, $3 agent_id
    printf '{"hook_event_name":"%s","session_id":"s1","agent_type":"%s","agent_id":"%s"}' "$1" "$2" "$3" | /bin/bash "$S"
}
agent() { printf -- '---\nname: %s\n%b---\nbody\n' "$1" "${2:-}" > "$CFG/agents/$1.md"; }
emits() { run SubagentStart "$1" "id-$1" | jq -e '.hookSpecificOutput.additionalContext | contains("Tier table")' >/dev/null 2>&1; }

# SessionStart
out=$(run SessionStart "" "")
check "SessionStart emits the table" "$(printf '%s' "$out" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"' >/dev/null 2>&1 && echo yes)" "$out"
n=$(printf '%s' "$out" | jq '.hookSpecificOutput.additionalContext | length')
check "within the 10000-character budget ($n)" "$([ "$n" -le 10000 ] && echo yes)"
check "orchestrator row and plan mode rendered" "$(printf '%s' "$out" | grep -q 'Orchestrator: main session, not delegated, effort medium' && printf '%s' "$out" | grep -q 'plan mode: exempt' && echo yes)"
check "preamble names the explicit-effort instruction" "$(printf '%s' "$out" | grep -q 'explicitly asks for an effort' && echo yes)"
check "marker main written" "$([ -f "$SD/tier-seen/main" ] && echo yes)"
check "no plugin installed: tier-skew-none, no tier-skew" "$([ -f "$SD/tier-skew-none" ] && [ ! -f "$SD/tier-skew" ] && echo yes)"

# Skew
mkp() {   # $1 plugin, $2 header line or empty for no table file
    mkdir -p "$T/cache/$1/skills/_shared"
    [ -n "$2" ] && printf '%s\nrow\n' "$2" > "$T/cache/$1/skills/_shared/tier-table.tsv"
}
inst() {
    local first=1 p
    printf '{"version":2,"plugins":{' > "$CFG/plugins/installed_plugins.json"
    for p in "$@"; do
        [ $first = 1 ] || printf ',' >> "$CFG/plugins/installed_plugins.json"; first=0
        printf '"%s@kodflow":[{"installPath":"%s"}]' "$p" "$T/cache/$p" >> "$CFG/plugins/installed_plugins.json"
    done
    printf '}}' >> "$CFG/plugins/installed_plugins.json"
}
HEAD=$(head -n 1 "$TBL")
mkp kodflow-workflow "$HEAD"; mkp kodflow-review "$HEAD"; inst kodflow-workflow kodflow-review
run SessionStart "" "" >/dev/null
check "matching headers: neither skew file" "$([ ! -f "$SD/tier-skew" ] && [ ! -f "$SD/tier-skew-none" ] && echo yes)"
mkp kodflow-review "# sha256 deadbeef"
run SessionStart "" "" >/dev/null
check "drifted header: tier-skew names the plugin" "$(grep -q kodflow-review "$SD/tier-skew" 2>/dev/null && echo yes)"
rm -f "$T/cache/kodflow-review/skills/_shared/tier-table.tsv"
run SessionStart "" "" >/dev/null
check "installed plugin without a table: tier-skew" "$([ -f "$SD/tier-skew" ] && echo yes)"
mkp kodflow-review "$HEAD"
run SessionStart "" "" >/dev/null
check "skew file cleared when the headers agree again" "$([ ! -f "$SD/tier-skew" ] && echo yes)"
printf '{not json' > "$CFG/plugins/installed_plugins.json"
run SessionStart "" "" >/dev/null
check "unreadable installed_plugins.json: no skew file claimed" "$([ ! -f "$SD/tier-skew" ] && echo yes)"

# SubagentStart: who can delegate
check "general-purpose emits" "$(emits general-purpose && echo yes)"
check "marker is the agent_id" "$([ -f "$SD/tier-seen/id-general-purpose" ] && echo yes)"
check "claude emits" "$(emits claude && echo yes)"
check "workflow-subagent emits and is marked" "$(emits workflow-subagent && [ -f "$SD/tier-seen/id-workflow-subagent" ] && echo yes)"
check "Explore does not" "$(emits Explore || echo yes)"
check "Plan does not" "$(emits Plan || echo yes)"
check "unknown definition does not" "$(emits nosuch || echo yes)"
agent notools; check "no tools field emits" "$(emits notools && echo yes)"
agent readonly "tools: Read, Glob, Grep\n"; check "tools without Agent do not" "$(emits readonly || echo yes)"
agent withtask "tools: Read, Task, Bash\n"; check "tools with Task emit" "$(emits withtask && echo yes)"
agent withagent "tools: Read, Agent(worker)\n"; check "tools with Agent(...) emit" "$(emits withagent && echo yes)"
agent star "tools: *\n"; check "tools: * emits" "$(emits star && echo yes)"
agent taskcreate "tools: Read, TaskCreate, TaskUpdate\n"; check "TaskCreate alone does not" "$(emits taskcreate || echo yes)"
agent mcpstar "tools: Read, mcp__context7__*\n"; check "mcp wildcard alone does not" "$(emits mcpstar || echo yes)"
agent folded "tools:\n  - Read\n  - Bash\n  - Agent\n"; check "list-form tools with Agent emit" "$(emits folded && echo yes)"
agent wrapped "tools: Read, Glob,\n  Grep, Task\n"; check "wrapped tools line with Task emits" "$(emits wrapped && echo yes)"
agent denied "disallowedTools: Agent\n"; check "disallowedTools Agent removes it" "$(emits denied || echo yes)"
agent denied2 "tools: Read, Agent\ndisallowedTools: Task, Agent\n"; check "disallowedTools wins over tools" "$(emits denied2 || echo yes)"
printf -- '---\r\nname: crlf\r\ntools: Read, Task\r\n---\r\n' > "$CFG/agents/crlf.md"; check "CRLF frontmatter read" "$(emits crlf && echo yes)"
check "no agent_id: nothing" "$(run SubagentStart general-purpose "" | wc -c | tr -d ' ' | grep -qx 0 && echo yes)"

# Fail open
mkdir -p "$T/big/hooks"
{ printf '# sha256 x\n# p\n'; i=0; while [ $i -lt 400 ]; do printf 'role\tRole number %d with a long enough label to overflow the budget\tsonnet\tlow\n' "$i"; i=$((i+1)); done; } > "$T/big/hooks/tier-table.tsv"
out=$(CLAUDE_PLUGIN_ROOT=$T/big run SessionStart "" ""); rc=$?
check "overflow: nothing emitted, exit 0" "$([ -z "$out" ] && [ $rc = 0 ] && echo yes)" "rc=$rc out=${out:0:80}"
rm -rf "$SD/tier-seen"
mkdir -p "$T/none"
out=$(CLAUDE_PLUGIN_ROOT=$T/none run SessionStart "" ""); rc=$?
check "table absent: nothing emitted, exit 0, no marker" "$([ -z "$out" ] && [ $rc = 0 ] && [ ! -e "$SD/tier-seen/main" ] && echo yes)"
out=$(printf 'not json' | /bin/bash "$S"); rc=$?
check "garbage input: nothing, exit 0" "$([ -z "$out" ] && [ $rc = 0 ] && echo yes)"

# Clearing
run SessionStart "" "" >/dev/null
for ev in SessionEnd PreCompact; do
    run SessionStart "" "" >/dev/null
    run $ev "" "" >/dev/null
    check "$ev clears the markers" "$([ ! -e "$SD/tier-seen" ] && echo yes)"
done

printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" = 0 ]
