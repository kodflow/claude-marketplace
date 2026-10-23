#!/bin/bash
# test_blocks.sh — the session's journal of refusals (hooks/scripts/lib/blocks.sh):
# a guard of on-tool.sh, a refusal of the mod handed to on-mod.sh, auto
# mode's PermissionDenied with the rule that would have allowed the call, a
# subagent stopped with a task in progress (on-stop.sh), one line per
# tool_use_id, and the last 500 lines kept. bash 3.2-safe.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
T=$(mktemp -d)
# The hooks log from a detached subshell: let the last line land before cleaning up
trap 'sleep 0.3; rm -rf "$T" 2>/dev/null || { sleep 1; rm -rf "$T"; }' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude KODFLOW_ROOT=off
unset KODFLOW_DOCS KODFLOW_MOD KODFLOW_FABLE
SID=sess-blocks
SD=$CLAUDE_CONFIG_DIR/kodflow/sessions/$SID
B=$SD/blocks.jsonl
mkdir -p "$T/repo" "$CLAUDE_CONFIG_DIR" "$T/tmp/sp"
git -C "$T/repo" init -q
cd "$T" || exit 1

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

# hook SCRIPT JSON-fragment → RC
hook() {
    local json
    json=$(jq -n -c --arg sid "$SID" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" --argjson f "$2" \
        '{session_id:$sid, cwd:$cwd, scratchpad_dir:$sp} + $f')
    OUT=$(printf '%s' "$json" | bash "$S/$1" 2>/dev/null); RC=$?
}
last() { tail -n 1 "$B" 2>/dev/null; }
lines() { if [ -f "$B" ]; then wc -l < "$B" | tr -d ' '; else echo 0; fi; }

echo "== a guard of on-tool.sh"
hook on-tool.sh '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu-1","tool_input":{"command":"git commit --no-verify -m \"feat: x\""}}'
[ "$RC" = 2 ] && ok "the guard still refuses (exit 2)" || bad "rc" "$RC"
last | jq -e '.kind == "hook" and .tool == "Bash" and .motif == "no-verify" and (.summary | test("skipping git hooks")) and .agent == "main" and (.ts | test("Z$")) and (has("rule") | not)' >/dev/null 2>&1 \
    && ok "one line: kind hook, tool, the title as summary, its motif, agent main" || bad "hook line" "$(last)"
hook on-tool.sh '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu-2","agent_id":"a9","agent_type":"tasks-flow-rules","tool_input":{"command":"git push --force origin feat/x"}}'
last | jq -e '.motif == "force" and .agent == "tasks-flow-rules"' >/dev/null 2>&1 && ok "a subagent's refusal names its agent type" || bad "agent" "$(last)"
mkdir -p "$SD"; date +%s > "$SD/mod-beat"; : > "$SD/triage-pending"
hook on-tool.sh '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_use_id":"tu-3","tool_input":{"file_path":"/nowhere/x.txt","content":"x"}}'
last | jq -e '.motif == "triage" and (.summary | startswith("TRIAGE FIRST")) and .tool == "Write"' >/dev/null 2>&1 \
    && ok "a gate with no motif line is known by its gate (triage)" || bad "triage" "$(last)"
rm -f "$SD/triage-pending" "$SD/mod-beat"
n=$(lines)
hook on-tool.sh '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu-4","tool_input":{"command":"git status"}}'
[ "$RC" = 0 ] && [ "$(lines)" = "$n" ] && ok "a call that passes writes nothing" || bad "pass" "rc=$RC $(lines)"

echo "== a refusal of the mod (on-mod.sh)"
hook on-mod.sh '{"hook_event_name":"ModPolicy","tool_name":"Bash","tool_use_id":"tu-5","reason":"guards:deny","block":{"motif":"attribution","title":"COMMIT BLOCKED — AI reference detected"}}'
last | jq -e '.kind == "hook" and .motif == "attribution" and .summary == "COMMIT BLOCKED — AI reference detected" and .agent == "main"' >/dev/null 2>&1 \
    && ok "the mod's motif and title land in the same journal" || bad "mod line" "$(last)"
n=$(lines)
hook on-mod.sh '{"hook_event_name":"ModPolicy","tool_name":"Bash","tool_use_id":"tu-6","reason":"veil:masked"}'
[ "$(lines)" = "$n" ] && ok "a decision that refuses nothing writes nothing" || bad "mod pass" "$(lines)"

echo "== auto mode: PermissionDenied"
hook on-tool.sh '{"hook_event_name":"PermissionDenied","permission_mode":"auto","tool_name":"Bash","tool_use_id":"tu-7","tool_input":{"command":"git push origin main"},"reason":"[Instruction Poisoning]"}'
[ "$RC" = 0 ] && ok "exits 0, prints nothing to retry" || bad "rc" "$RC"
last | jq -e '.kind == "classifier" and .summary == "Instruction Poisoning" and .rule == "Bash(git push:*)" and .tool == "Bash"' >/dev/null 2>&1 \
    && ok "kind classifier, the verdict as summary, the rule that would allow it" || bad "classifier" "$(last)"
rule() { jq -n -c --arg t "$1" --argjson i "$2" '{tool_name:$t, tool_input:$i}' | ( . "$S/lib/blocks.sh"; kf_block_rule ); }
[ "$(rule Bash '{"command":"FOO=1 rm -rf /tmp/build"}')" = 'Bash(rm:*)' ] && ok "env assignments skipped, an option is not a subcommand" || bad "rm rule" "$(rule Bash '{"command":"FOO=1 rm -rf /tmp/build"}')"
[ "$(rule Edit '{"file_path":"/etc/hosts"}')" = 'Edit(//etc/hosts)' ] && ok "a file tool: its absolute path in // form" || bad "edit rule" ""
[ "$(rule WebFetch '{"url":"https://docs.example.org/a?b"}')" = 'WebFetch(domain:docs.example.org)' ] && ok "WebFetch: its domain" || bad "webfetch rule" ""
[ "$(rule mcp__srv__write '{}')" = 'mcp__srv__write' ] && ok "any other tool: its name" || bad "mcp rule" ""
hook on-tool.sh '{"hook_event_name":"PermissionDenied","tool_name":"Bash","tool_use_id":"tu-8","tool_input":{"command":"curl x"},"reason":"Auto mode could not evaluate this action and is blocking it for safety"}'
last | jq -e '.summary | startswith("Auto mode could not evaluate")' >/dev/null 2>&1 && ok "a no-verdict denial keeps its text" || bad "no verdict" "$(last)"
n=$(lines)
hook on-tool.sh '{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"tu-8","tool_input":{"command":"curl x"},"error":"Permission for this action was denied by the Auto mode classifier."}'
[ "$(lines)" = "$n" ] && ok "the same tool_use_id seen again as a failure: still one line" || bad "dedupe" "$(lines) vs $n"
hook on-tool.sh '{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"tu-9","tool_input":{"command":"npm publish"},"error":"Permission for this action was denied by the Auto mode classifier."}'
last | jq -e '.kind == "classifier" and .rule == "Bash(npm publish:*)"' >/dev/null 2>&1 && ok "a failure carrying the classifier's text is a refusal" || bad "failure" "$(last)"
n=$(lines)
hook on-tool.sh '{"hook_event_name":"PostToolUseFailure","tool_name":"Bash","tool_use_id":"tu-10","tool_input":{"command":"false"},"error":"Exit code 1"}'
[ "$(lines)" = "$n" ] && ok "an ordinary failure is not a refusal" || bad "plain failure" "$(last)"

echo "== a subagent stopped with a task in progress (on-stop.sh)"
NOW=$(date +%s); date +%s > "$SD/mod-beat"
printf '{"agents":{"r1":{"type":"review-pr3","started":%s,"stopped":%s}}}' "$((NOW - 600))" "$NOW" > "$SD/agents.json"
printf '%s' '{"version":2,"epics":[],"active":{},"tasks":[{"id":"36","agent":"main","epic":0,"subject":"Review PR 3","status":"in_progress","worker":"review-pr3","worker_id":"r1"}]}' > "$SD/tasks.json"
hook on-stop.sh '{"hook_event_name":"Stop","stop_hook_active":false}'
last | jq -e '.kind == "agent" and .summary == "review-pr3 arrêté, tâche #36 en cours (Review PR 3)" and .agent == "review-pr3"' >/dev/null 2>&1 \
    && ok "kind agent, once per set of orphaned tasks" || bad "agent line" "$(last)"
n=$(lines); rm -f "$T/tmp/sp/stop-count"
hook on-stop.sh '{"hook_event_name":"Stop","stop_hook_active":false}'
[ "$(lines)" = "$n" ] && ok "the same set is not journaled twice" || bad "agent twice" "$(lines)"

echo "== rotation and failing open"
( . "$S/lib/blocks.sh"; i=0; while [ $i -lt 520 ]; do printf '{"n":%d}\n' $i; i=$((i+1)); done > "$B"
  kf_block "$SD" ci "" "marketplace#81 directive size" "" "" "" "https://example.invalid/81" )
[ "$(lines)" = 500 ] && ok "the last 500 lines are kept" || bad "rotation" "$(lines)"
last | jq -e '.kind == "ci" and .ref == "https://example.invalid/81" and (has("tool") | not)' >/dev/null 2>&1 \
    && ok "the newest line is the one kept, empty fields left out" || bad "newest" "$(last)"
sed -n 1p "$B" | grep -q '"n":21}' && ok "the oldest go first" || bad "oldest" "$(sed -n 1p "$B")"
chmod 000 "$SD"
hook on-tool.sh '{"hook_event_name":"PermissionDenied","tool_name":"Bash","tool_use_id":"tu-11","tool_input":{"command":"x"},"reason":"[X]"}'
chmod 755 "$SD"
[ "$RC" = 0 ] && ok "an unwritable journal fails open" || bad "unwritable" "$RC"
hook on-tool.sh '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_use_id":"tu-12","tool_input":{"command":"git commit -n -m x"}}'
[ "$RC" = 2 ] && ok "and never changes a guard's verdict" || bad "verdict" "$RC"

echo
echo "test_blocks: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
