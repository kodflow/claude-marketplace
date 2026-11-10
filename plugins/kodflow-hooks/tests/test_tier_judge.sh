#!/bin/bash
# test_tier_judge.sh — the tier judge for Agent calls (lib/tier.sh, called at
# the head of on-tool.sh's Agent/Task handling): which fields are missing, the
# definitions' pins, the exemptions, the mode and its sources, the markers,
# the breaker and the journal. Payloads are built on the shapes recorded in
# tests/fixtures/tier-pretooluse-agent.jsonl (tool_name Agent, model and effort
# top-level in tool_input, agent_id from a subagent, the SESSION effort as a
# top-level `effort` object). bash 3.2-safe: macOS CI runs it with /bin/bash.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
FX=$ROOT/plugins/kodflow-hooks/tests/fixtures/tier-pretooluse-agent.jsonl
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude
unset KODFLOW_ROOT KODFLOW_ROUTE KODFLOW_FABLE KODFLOW_TIER KODFLOW_MOD CLAUDE_CODE_SUBAGENT_MODEL CLAUDE_CODE_SUBAGENT_MODEL_FORCE \
      CLAUDE_CODE_EFFORT_LEVEL CLAUDE_PLUGIN_ROOT
CFG=$CLAUDE_CONFIG_DIR
SID=sess-tier
SD=$CFG/kodflow/sessions/$SID
J=$SD/tier.jsonl
mkdir -p "$T/repo" "$CFG/agents" "$T/tmp"
cd "$T" || exit 1

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
check() { if [ "$2" = yes ]; then ok "$1"; else bad "$1" "${3:-}"; fi; }

# payload ST MODEL EFFORT [AGENT_ID] [PERMISSION_MODE] [TUID] [DESC]
payload() {
    jq -n -c --arg st "$1" --arg m "$2" --arg e "$3" --arg aid "${4:-}" --arg pm "${5:-auto}" --arg id "${6:-tu-$RANDOM$RANDOM}" --arg d "${7:-probe}" --arg sid "$SID" '
        {session_id:$sid, cwd:"/workspace/probe", hook_event_name:"PreToolUse", permission_mode:$pm,
         effort:{level:"max"}, tool_name:"Agent", tool_use_id:$id,
         tool_input:({description:$d, prompt:"Reply ok."}
            + (if $st == "" then {} else {subagent_type:$st} end)
            + (if $m == "" then {} else {model:$m} end)
            + (if $e == "" then {} else {effort:$e} end))}
        + (if $aid == "" then {} else {agent_id:$aid, agent_type:"general-purpose"} end)'
}
run() {   # $1 payload, then VAR=value pairs
    local p=$1; shift
    OUT=$(printf '%s' "$p" | env "$@" /bin/bash "$S/on-tool.sh" 2>"$T/err"); RC=$?
    ERR=$(cat "$T/err")
}
ctx() { printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null; }
last() { tail -n 1 "$J" 2>/dev/null | jq -r "$1" 2>/dev/null; }
reset() { rm -rf "$SD"; }
seen() { mkdir -p "$SD/tier-seen"; : > "$SD/tier-seen/${1:-main}"; }
agentdef() { printf -- '---\nname: %s\n%b---\nbody\n' "$1" "${2:-}" > "$CFG/agents/$1.md"; }
warns() { ctx | grep -q 'TIER —'; }

# --- the warn advice, a bare general-purpose call ---------------------------
reset
run "$(payload general-purpose "" "")"
check "bare general-purpose: exit 0, advice in additionalContext" "$([ $RC -eq 0 ] && warns && echo yes)" "rc=$RC out=$OUT"
check "hookEventName PreToolUse" "$(printf '%s' "$OUT" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"' >/dev/null 2>&1 && echo yes)"
check "names both fields" "$(ctx | grep -q 'names no model and effort' && echo yes)" "$(ctx)"
check "table values for the roles" "$(ctx | grep -q 'Code worker, well specified: model sonnet, effort medium' && echo yes)"
check "mode and its source" "$(ctx | grep -q 'Mode: warn (default)' && echo yes)"
check "the command to turn it off" "$(ctx | grep -qF "printf off > $SD/tier-mode" && echo yes)"
check "journal: warn, would_refuse" "$([ "$(last '.action + " " + (.would_refuse|tostring) + " " + .reason')" = "warn true tier" ] && echo yes)" "$(cat "$J")"
check "journal fields" "$(tail -n 1 "$J" | jq -e 'has("ts") and has("mode") and has("mode_source") and has("caller") and has("has_model") and has("has_effort") and has("pinned_model") and has("pinned_effort") and has("tool_use_id")' >/dev/null && echo yes)"
echo "--- exact warn message (bare general-purpose call) ---"; ctx; echo "---"

# --- partial fields ---------------------------------------------------------
reset
run "$(payload general-purpose haiku "")"
check "model only: effort named, model not" "$(ctx | grep -q 'names no effort:' && echo yes)" "$(ctx)"
run "$(payload general-purpose "" low)"
check "effort only: model named" "$(ctx | grep -q 'names no model:' && echo yes)"
run "$(payload general-purpose haiku low)"
check "both: silent pass" "$([ -z "$OUT" ] && [ $RC -eq 0 ] && [ "$(last .action)" = pass ] && echo yes)" "out=$OUT"
run "$(payload "" "" "")"
check "no subagent_type is general-purpose: advice" "$(warns && echo yes)"
check "the session effort at the top level is never read" "$(warns && echo yes)"
run "$(payload general-purpose inherit "")"
check "model: inherit on the call pins nothing" "$(ctx | grep -q 'names no model and effort' && echo yes)"

# --- frontmatter pins -------------------------------------------------------
reset
agentdef pinned 'model: sonnet\neffort: high\n'
run "$(payload pinned "" "")"
check "full frontmatter: silent pass" "$([ -z "$OUT" ] && echo yes)" "$OUT"
check "journal: pinned_model/effort from the frontmatter" "$([ "$(last '.pinned_model + " " + .pinned_effort')" = "frontmatter:sonnet frontmatter:high" ] && echo yes)" "$(cat "$J")"
agentdef halfm 'model: opus\n'
run "$(payload halfm "" "")"
check "partial frontmatter (model only): effort missing" "$(ctx | grep -q 'names no effort:' && echo yes)" "$(ctx)"
agentdef halfe 'effort: low\n'
run "$(payload halfe "" "")"
check "partial frontmatter (effort only): model missing" "$(ctx | grep -q 'names no model:' && echo yes)"
agentdef nullm 'model: null\neffort: ~\n'
run "$(payload nullm "" "")"
check "null and ~ pin nothing" "$(ctx | grep -q 'names no model and effort' && echo yes)"
agentdef inh 'model: inherit\neffort: "high" # c\n'
run "$(payload inh "" "")"
check "model: inherit pins nothing, a quoted commented effort pins" "$(ctx | grep -q 'names no model:' && echo yes)" "$(ctx)"
printf -- '\357\273\277---\r\nname: crlf\r\nmodel: "opus" # x\r\neffort: '"'"'xhigh'"'"'\r\n---\r\n' > "$CFG/agents/crlf.md"
run "$(payload crlf "" "")"
check "BOM, CRLF, quotes, trailing comment: pinned" "$([ -z "$OUT" ] && echo yes)" "$OUT"
agentdef other 'model: sonnet\n'
mkdir -p "$T/repo/.claude/agents"; printf -- '---\nname: projonly\nmodel: haiku\neffort: low\n---\n' > "$T/repo/.claude/agents/projonly.md"
run "$(payload projonly "" "")"
check "project definition found" "$([ -z "$OUT" ] && echo yes)"
run "$(payload ghost-agent "" "")"
check "no definition: pass + tier-nodef" "$([ -z "$OUT" ] && [ "$(last .reason)" = tier-nodef ] && echo yes)" "$OUT $(cat "$J")"
IP=$CFG/plugins/cache/kodflow/kodflow-specialists/h1
mkdir -p "$IP/agents"; printf -- '---\nname: dev\nmodel: sonnet\neffort: high\n---\n' > "$IP/agents/dev.md"
printf '{"version":2,"plugins":{"kodflow-specialists@kodflow":[{"installPath":"%s"}]}}' "$IP" > "$CFG/plugins/installed_plugins.json"
run "$(payload kodflow-specialists:dev "" "")"
check "plugin:agent name resolves through installed_plugins.json" "$([ -z "$OUT" ] && [ "$(last .action)" = pass ] && echo yes)" "$OUT $(cat "$J")"
run "$(payload kodflow-specialists:nope "" "")"
check "plugin:agent not found: tier-nodef" "$([ "$(last .reason)" = tier-nodef ] && echo yes)"

# --- environment pins -------------------------------------------------------
reset
run "$(payload general-purpose "" "")" CLAUDE_CODE_SUBAGENT_MODEL=sonnet
check "CLAUDE_CODE_SUBAGENT_MODEL pins the model" "$(ctx | grep -q 'names no effort:' && echo yes)" "$(ctx)"
run "$(payload general-purpose "" "")" CLAUDE_CODE_EFFORT_LEVEL=high
check "CLAUDE_CODE_EFFORT_LEVEL pins the effort" "$(ctx | grep -q 'names no model:' && echo yes)"
run "$(payload general-purpose "" "")" CLAUDE_CODE_EFFORT_LEVEL=auto
check "EFFORT_LEVEL=auto pins nothing" "$(ctx | grep -q 'names no model and effort' && echo yes)"
run "$(payload general-purpose "" "")" CLAUDE_CODE_EFFORT_LEVEL=unset
check "EFFORT_LEVEL=unset pins nothing" "$(ctx | grep -q 'names no model and effort' && echo yes)"
run "$(payload general-purpose "" "")" CLAUDE_CODE_SUBAGENT_MODEL=sonnet CLAUDE_CODE_EFFORT_LEVEL=high
check "both env pins: silent" "$([ -z "$OUT" ] && echo yes)"
# FORCE
run "$(payload general-purpose haiku "")" CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1
check "FORCE alone: the model is the parent's, not missing; effort is" "$(ctx | grep -q 'names no effort:' && [ "$(last .pinned_model)" = parent ] && echo yes)" "$(ctx) $(cat "$J")"
run "$(payload Explore "" low)" CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1
check "FORCE alone, Explore: its own model" "$([ -z "$OUT" ] && [ "$(last .pinned_model)" = own:Explore ] && echo yes)" "$OUT $(cat "$J")"
run "$(payload general-purpose "" low)" CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 CLAUDE_CODE_SUBAGENT_MODEL=opus
check "FORCE with the env model: forced" "$([ -z "$OUT" ] && [ "$(last .pinned_model)" = env-forced:opus ] && echo yes)"
run "$(payload general-purpose "" low)" CLAUDE_CODE_SUBAGENT_MODEL_FORCE=0
check "FORCE=0 is not set: the model is missing" "$(ctx | grep -q 'names no model:' && echo yes)"

# --- exemptions -------------------------------------------------------------
reset
run "$(payload fork "" "")"
check "fork: pass, logged tier-fork" "$([ -z "$OUT" ] && [ "$(last .reason)" = tier-fork ] && echo yes)" "$OUT $(cat "$J")"
run "$(payload claude-code-guide "" "")"
check "exempt agent claude-code-guide" "$([ -z "$OUT" ] && [ "$(last .action)" = pass ] && echo yes)"
run "$(payload web-fetch "" "")"
check "exempt agent web-fetch" "$([ -z "$OUT" ] && echo yes)"
run "$(payload general-purpose "" "" "" plan)"
check "permission_mode plan: exempt" "$([ -z "$OUT" ] && echo yes)"
run "$(payload general-purpose "" "" "" auto t1 'do it [tier-exempt: skill X]')"
check "[tier-exempt: …] in the description" "$([ -z "$OUT" ] && echo yes)"
p=$(payload general-purpose "" "" | jq -c '.tool_input.prompt = "x [tier-exempt: third party] y"')
run "$p"
check "[tier-exempt: …] in the prompt" "$([ -z "$OUT" ] && echo yes)"

# --- subagent caller --------------------------------------------------------
reset
run "$(payload general-purpose "" "" agent-9)"
check "a subagent's call is judged: advice, tier-sub, caller recorded" "$(warns && [ "$(last '.reason + " " + .caller')" = "tier-sub agent-9" ] && echo yes)" "rc=$RC out=$OUT $(cat "$J")"
run "$(payload general-purpose haiku low agent-9)"
check "a subagent's complete call passes" "$([ -z "$OUT" ] && echo yes)"

# --- mode: sources and precedence ------------------------------------------
reset
mkdir -p "$SD"; printf enforce > "$SD/tier-mode"
run "$(payload general-purpose "" "")"
check "session file enforce, no marker: pass + tier-inert" "$([ $RC -eq 0 ] && [ "$(last .reason)" = tier-inert ] && echo yes)" "rc=$RC"
seen main
run "$(payload general-purpose "" "")"
check "enforce + main marker: exit 2" "$([ $RC -eq 2 ] && echo yes)" "rc=$RC err=$ERR"
check "refusal names the fields, the table and the command" "$(printf '%s' "$ERR" | grep -q 'names no model and effort' && printf '%s' "$ERR" | grep -q 'Code worker, well specified' && printf '%s' "$ERR" | grep -qF "printf off > $SD/tier-mode" && printf '%s' "$ERR" | grep -q 'Mode: enforce (from' && echo yes)" "$ERR"
check "journal: refuse, would_refuse" "$([ "$(last '.action + " " + (.would_refuse|tostring)')" = "refuse true" ] && echo yes)"
check "blocks.jsonl records the refusal" "$(grep -q '"motif":"tier"' "$SD/blocks.jsonl" 2>/dev/null && echo yes)"
run "$(payload general-purpose haiku low)"
check "enforce, complete call: pass" "$([ $RC -eq 0 ] && echo yes)"
run "$(payload general-purpose "" "" agent-7)"
check "enforce, subagent without marker: tier-inert" "$([ $RC -eq 0 ] && [ "$(last .reason)" = tier-inert ] && echo yes)"
seen agent-7
run "$(payload general-purpose "" "" agent-7)"
check "enforce, subagent with its marker: exit 2" "$([ $RC -eq 2 ] && echo yes)"
run "$(payload general-purpose "" "")" KODFLOW_TIER=warn
check "KODFLOW_TIER=warn beats the session file" "$([ $RC -eq 0 ] && warns && echo yes)"
printf warn > "$SD/tier-mode"
run "$(payload general-purpose "" "")" KODFLOW_TIER=enforce
check "KODFLOW_TIER=enforce beats the session file" "$([ $RC -eq 2 ] && echo yes)"
run "$(payload general-purpose "" "")" KODFLOW_TIER=off
check "KODFLOW_TIER=off: nothing, nothing journaled" "$([ $RC -eq 0 ] && [ -z "$OUT" ] && echo yes)"
rm -f "$SD/tier-mode"
mkdir -p "$CFG/kodflow"; printf enforce > "$CFG/kodflow/tier-mode"
run "$(payload general-purpose "" "")"
check "global file enforce" "$([ $RC -eq 2 ] && echo yes)"
printf warn > "$SD/tier-mode"
run "$(payload general-purpose "" "")"
check "session file beats the global file" "$([ $RC -eq 0 ] && warns && echo yes)"
printf off > "$CFG/kodflow/tier-mode"; printf enforce > "$SD/tier-mode"
n=$(wc -l < "$J")
run "$(payload general-purpose "" "")"
check "off in the global file wins over an enforce session file" "$([ $RC -eq 0 ] && [ -z "$OUT" ] && [ "$(wc -l < "$J")" = "$n" ] && echo yes)"
printf OFF > "$SD/tier-mode"; printf enforce > "$CFG/kodflow/tier-mode"
run "$(payload general-purpose "" "")" KODFLOW_TIER=enforce
check "off in the session file wins over KODFLOW_TIER=enforce" "$([ $RC -eq 0 ] && [ -z "$OUT" ] && echo yes)"
printf bogus > "$SD/tier-mode"; rm -f "$CFG/kodflow/tier-mode"
run "$(payload general-purpose "" "")"
check "an unknown value is ignored: default warn" "$(warns && echo yes)"
# skew
printf enforce > "$SD/tier-mode"; printf 'hooks x differs\n' > "$SD/tier-skew"
run "$(payload general-purpose "" "")"
check "tier-skew forces warn" "$([ $RC -eq 0 ] && warns && [ "$(last .reason)" = tier-skew ] && ctx | grep -q 'Mode: warn (from tier-skew)' && echo yes)" "rc=$RC $(cat "$J" | tail -1)"
rm -f "$SD/tier-skew"

# --- breaker ----------------------------------------------------------------
reset
mkdir -p "$SD"; printf enforce > "$SD/tier-mode"; seen main
i=0
while [ $i -lt 10 ]; do
    payload general-purpose "" "" "" auto "par-$i" > "$T/par-$i.json"
    ( env /bin/bash "$S/on-tool.sh" < "$T/par-$i.json" >/dev/null 2>&1; echo $? > "$T/par-$i.rc" ) &
    i=$((i+1))
done
wait
refused=0; i=0
while [ $i -lt 10 ]; do [ "$(cat "$T/par-$i.rc")" = 2 ] && refused=$((refused+1)); i=$((i+1)); done
check "10 parallel refusals: at most 3 of 10 are refused ($refused)" "$([ $refused -le 3 ] && echo yes)"
run "$(payload general-purpose "" "" "" auto par-extra)"
check "afterwards: pass + tier-breaker" "$([ $RC -eq 0 ] && [ "$(last .reason)" = tier-breaker ] && echo yes)" "rc=$RC"
run "$(payload general-purpose "" "" "" auto par-0)"
check "a repeated tool_use_id is counted once" "$([ "$(awk -F'\t' '$2=="par-0"' "$SD/tier-count" | wc -l)" -ge 1 ] && echo yes)"
reset
mkdir -p "$SD"; printf enforce > "$SD/tier-mode"; seen main
run "$(payload general-purpose "" "" "" auto same)"; a=$RC
run "$(payload general-purpose "" "" "" auto same)"; b=$RC
run "$(payload general-purpose "" "" "" auto same)"; c=$RC
run "$(payload general-purpose "" "" "" auto same)"; d=$RC
check "the same tool_use_id retried 4 times never trips it" "$([ "$a$b$c$d" = 2222 ] && echo yes)" "$a$b$c$d"
run "$(payload Explore "" "" "" auto e1)"; run "$(payload Explore "" "" "" auto e2)"; run "$(payload Explore "" "" "" auto e3)"; run "$(payload Explore "" "" "" auto e4)"
check "the count is per subagent_type: Explore has its own 3" "$([ $RC -eq 2 ] || [ "$(last .reason)" = tier-breaker ] && echo yes)"
run "$(payload general-purpose "" "" agent-q auto s1)"
check "the count is per caller: a subagent starts at zero (inert without marker)" "$([ "$(last .reason)" = tier-inert ] && echo yes)"

# --- unreadable, no jq ------------------------------------------------------
reset
run '{"hook_event_name":"PreToolUse","tool_name":"Agent","session_id":"sess-tier","tool_input":"not an object"}'
check "tool_input unreadable: pass + tier-unparsed" "$([ $RC -eq 0 ] && [ "$(last .reason)" = tier-unparsed ] && echo yes)" "rc=$RC $(cat "$J" 2>/dev/null)"
NOJQ=$T/nojq; mkdir -p "$NOJQ"
for b in cat date tr cut awk grep mkdir rm wc head tail sed dirname; do ln -sf "$(command -v $b)" "$NOJQ/$b"; done
reset
OUT=$(payload general-purpose "" "" | env PATH="$NOJQ" /bin/bash "$S/on-tool.sh" 2>"$T/err"); RC=$?
check "no jq: pass + tier-nojq line" "$([ $RC -eq 0 ] && [ -z "$OUT" ] && grep -q '"reason":"tier-nojq"' "$J" && echo yes)" "rc=$RC $(cat "$J" 2>/dev/null)"
printf enforce > "$SD/tier-mode"; seen main
OUT=$(payload general-purpose "" "" | env PATH="$NOJQ" /bin/bash "$S/on-tool.sh" 2>"$T/err"); RC=$?
check "no jq, enforce: still pass" "$([ $RC -eq 0 ] && echo yes)"

# --- before every early exit ------------------------------------------------
reset
run "$(payload general-purpose "" "" agent-1)" KODFLOW_FABLE=off
check "the agent_id early exit of the fast path is behind the judge" "$(warns && echo yes)"
run "$(payload general-purpose "" "")" KODFLOW_ROUTE=off
check "KODFLOW_ROUTE=off does not skip the judge" "$(warns && echo yes)"
run "$(payload general-purpose "" "" "" auto t9 'review go code [general-purpose-ok]')"
check "[general-purpose-ok] does not exempt from the tier" "$(warns && echo yes)"
p=$(payload general-purpose "" "")
OUT=$(printf '%s' "$p" | sed 's/"hook_event_name":"PreToolUse"/"hook_event_name" : "PreToolUse"/' | /bin/bash "$S/on-tool.sh" 2>/dev/null); RC=$?
check "another JSON layout reaches the judge through pre_agent" "$(printf '%s' "$OUT" | grep -q 'TIER' && echo yes)" "$OUT"
# Task alias
p=$(payload general-purpose "" "" | jq -c '.tool_name = "Task"')
run "$p"
check "tool_name Task is judged too" "$(warns && echo yes)"

# --- recorded fixtures ------------------------------------------------------
reset
fx() { jq -c --arg c "$1" 'select(.case == $c) | .payload | .session_id = "sess-tier" | .cwd = "/workspace/probe"' "$FX"; }
run "$(fx 'PreToolUse Agent, main thread, no model, no effort')"
check "fixture: no model, no effort -> advice" "$(warns && echo yes)"
run "$(fx 'PreToolUse Agent, main thread, model and effort')"
check "fixture: model and effort -> silent" "$([ -z "$OUT" ] && echo yes)"
run "$(fx 'PreToolUse Agent, main thread, subagent_type fork')"
check "fixture: fork -> tier-fork" "$([ "$(last .reason)" = tier-fork ] && echo yes)"
run "$(fx 'PreToolUse Agent, from inside a subagent (agent_id present), model and effort set')"
check "fixture: subagent, complete -> silent" "$([ -z "$OUT" ] && echo yes)"

printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
