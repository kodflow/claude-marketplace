#!/bin/bash
# test_hooks.sh — behavioural tests for plugins/kodflow-hooks/hooks/scripts.
#
# Each case feeds a hook the JSON Claude Code would send and asserts on the
# exit code and stdout. Runs in a throwaway git repository; needs bash, jq,
# git. rtk is optional: the rewrite assertions adapt to its absence.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude
unset CLAUDE_CODE_ENABLE_TODO_TOOLS CLAUDE_CODE_TASK_LIST_ID   # inherited values would change what is asserted
# The reviewer gate (main thread reads, reviews and merges; subagents produce)
# would stop most main-thread payloads below before the guard they test. It
# is off here and covered on its own in plugins/kodflow-hooks/tests/test_root_gate.sh.
export KODFLOW_ROOT=off
mkdir -p "$T/repo" "$T/home" "$T/tmp" "$T/tmp/sp"
cd "$T" || exit 1
git -C "$T/repo" init -q -b feat/test
git -C "$T/repo" config user.email t@example.invalid; git -C "$T/repo" config user.name t
printf 'x\n' > "$T/repo/a.txt"; git -C "$T/repo" add a.txt; git -C "$T/repo" commit -qm "chore: seed"

pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

# run EVENT TOOL JSON-fragment → sets RC, OUT, ERR
run() {
    local ev=$1 tool=$2 frag=$3 script=$4
    local json; json=$(jq -n -c --arg ev "$ev" --arg tool "$tool" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" \
        --argjson frag "$frag" '{session_id:"sess-1",hook_event_name:$ev,tool_name:$tool,cwd:$cwd,scratchpad_dir:$sp,tool_use_id:"t1"} + $frag')
    OUT=$(printf '%s' "$json" | bash "$S/$script" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
}
bash_cmd() { run PreToolUse Bash "$(jq -n -c --arg c "$1" '{tool_input:{command:$c}}')" on-tool.sh; }
expect_rc() { [ "$RC" -eq "$2" ] && ok "$1" || bad "$1" "rc=$RC out=$OUT err=${ERR:0:160}"; }
# rtk, when present, prefixes git commands: compare past that prefix.
updated() { printf '%s' "$OUT" | jq -r '.hookSpecificOutput.updatedInput.command // empty' 2>/dev/null | sed 's/^rtk //'; }

echo "== PreToolUse Bash · git guard"
AI="Co-Authored""-By: Cla""ude <x@y>"       # assembled: this file must not carry the shape itself
bash_cmd 'git commit --no-verify -m "feat: x"';                       expect_rc "--no-verify blocked" 2
bash_cmd 'git commit -anm "feat: x"';                                  expect_rc "-n inside a flag cluster blocked" 2
bash_cmd 'git commit -m "docs: explain the -n flag"';                  expect_rc "-n inside a quoted message allowed" 0
bash_cmd 'git commit -m "feat: x" && sed -n 1p a.txt';                 expect_rc "sed -n on another segment is not a commit flag" 0
bash_cmd "git commit -m \"feat: x\" -m \"$AI\"";                       expect_rc "AI attribution blocked" 2
bash_cmd "cd $T/repo && git commit -m \"feat: 🤖\"";                   expect_rc "wrapped: cd && git commit blocked" 2
bash_cmd "git -C $T/repo commit -m \"feat: x\" -m \"$AI\"";            expect_rc "wrapped: git -C dir commit blocked" 2
bash_cmd "bash -c 'git commit -m \"feat: see .claude/plans/x.md\"'";   expect_rc "wrapped: bash -c with a .claude/ leak blocked" 2
bash_cmd 'env GIT_AUTHOR_NAME=x git commit -m "feat: ok"';             expect_rc "env-prefixed clean commit allowed" 0
bash_cmd 'git log --oneline -5';                                       expect_rc "git log passes the gate" 0

echo "== PreToolUse Bash · staged secrets"
printf 'key = "AK""IA%s"\n' "ABCDEFGHIJKLMNOP" > "$T/repo/cfg.ini"
# the shape is assembled on disk too: what is staged is the joined string
printf 'aws_key = "%s%s"\n' "AK""IA" "ABCDEFGHIJKLMNOP" > "$T/repo/cfg.ini"
git -C "$T/repo" add cfg.ini
bash_cmd 'git commit -m "feat: config"';                               expect_rc "staged credential shape blocked" 2
git -C "$T/repo" rm -q --cached cfg.ini; rm -f "$T/repo/cfg.ini"
mkdir -p "$T/repo/x/hooks/scripts"; printf 'aws_key = "%s%s"\n' "AK""IA" "ABCDEFGHIJKLMNOP" > "$T/repo/x/hooks/scripts/g.sh"
git -C "$T/repo" add x; bash_cmd 'git commit -m "feat: hook"';        expect_rc "hook sources are exempt from the secret scan" 0
git -C "$T/repo" rm -rq --cached x; rm -rf "$T/repo/x"

echo "== PreToolUse Bash · force push"
bash_cmd 'git push --force origin main'
[ "$(updated)" = 'git push --force-with-lease origin main' ] && ok "--force rewritten to --force-with-lease" || bad "--force rewrite" "$OUT"
bash_cmd 'git push -f origin main'
[ "$(updated)" = 'git push --force-with-lease origin main' ] && ok "-f rewritten" || bad "-f rewrite" "$OUT"
bash_cmd 'git push --force-if-includes origin main'
[ -z "$(updated)" ] || [ "$(updated)" = "$(updated | sed 's/--force-with-lease//')" ] && ok "--force-if-includes left alone" || bad "--force-if-includes" "$OUT"
bash_cmd 'git status && git push --force origin main';                 expect_rc "forced push in a compound line refused" 2
bash_cmd 'git push --force-with-lease origin main'
[ -z "$(updated)" ] || [[ "$(updated)" == *--force-with-lease* ]] && ok "--force-with-lease untouched" || bad "with-lease" "$OUT"

echo "== PreToolUse Bash · rtk"
if command -v rtk >/dev/null 2>&1; then
    bash_cmd 'ls -la /tmp'
    printf '%s' "$OUT" | jq -e '.hookSpecificOutput.updatedInput.command | startswith("rtk ")' >/dev/null 2>&1 && ok "ls rewritten through rtk" || bad "rtk rewrite" "$OUT"
    printf '%s' "$OUT" | jq -e '.hookSpecificOutput.permissionDecision' >/dev/null 2>&1 && bad "no permission decision on a rewrite" "$OUT" || ok "rewrite carries no permissionDecision (normal permission flow applies)"
    bash_cmd 'echo ok; cat a.txt && true';  [ -z "$(updated)" ] && ok "cat after ; and before && protects the line" || bad "fidelity guard" "$OUT"
    bash_cmd 'OUT=x head -40 a.txt';        [ -z "$(updated)" ] && ok "VAR= prefix does not hide head" || bad "fidelity guard VAR=" "$OUT"
    bash_cmd 'NO_RTK= ls -la';              [ -z "$(updated)" ] && ok "NO_RTK= opts out" || bad "NO_RTK" "$OUT"
else
    echo "  skip rtk not installed"
fi

echo "== PreToolUse Edit · protected paths"
edit() { run PreToolUse Edit "$(jq -n -c --arg f "$1" '{tool_input:{file_path:$f,old_string:"a",new_string:"b"}}')" on-tool.sh; }
edit "$T/repo/node_modules/x/index.js";    expect_rc "node_modules/ denied" 2
edit "$T/repo/Cargo.lock";                 expect_rc "*.lock glob matches the basename" 2
edit "$T/repo/.env.local";                 expect_rc ".env* denied" 2
edit "$T/repo/src/main.rs";                expect_rc "ordinary source allowed" 0
edit "$T/repo/build/README.md";            expect_rc "markdown always allowed" 0
printf 'secrets/\n' > "$T/repo/.claude/protected-paths" 2>/dev/null || { mkdir -p "$T/repo/.claude"; printf 'secrets/\n' > "$T/repo/.claude/protected-paths"; }
edit "$T/repo/secrets/k.txt";              expect_rc "project list: secrets/ denied" 2
edit "$T/repo/node_modules/x.js";          expect_rc "project list replaces the defaults" 0
rm -f "$T/repo/.claude/protected-paths"

echo "== PostToolUse Edit · tracker, injection, security context"
F="$T/repo/x'; touch pwned; echo '.py"; printf 'print(1)\n' > "$F"
run PostToolUse Edit "$(jq -n -c --arg f "$F" '{tool_input:{file_path:$f,old_string:"a",new_string:"b"},tool_response:{filePath:$f}}')" on-tool.sh
[ ! -e "$T/pwned" ] && ok "a crafted file name executes nothing" || bad "injection" "pwned file created"
grep -qxF "$F" "$T/tmp/sp/edited" && ok "tracker holds the literal path" || bad "tracker" "$(cat "$T/tmp/sp/edited" 2>/dev/null)"
G="$T/repo/app.js"; printf 'x\n' > "$G"
run PostToolUse Edit "$(jq -n -c --arg f "$G" '{tool_input:{file_path:$f,old_string:"a",new_string:"el.innerHTML = s"},tool_response:{filePath:$f}}')" on-tool.sh
printf '%s' "$OUT" | grep -q 'SECURITY' && ok "innerHTML raises a context warning" || bad "security context" "$OUT"
run PostToolUse Edit "$(jq -n -c --arg f "$G" '{tool_input:{file_path:$f,old_string:"a",new_string:"el.innerHTML = t"},tool_response:{filePath:$f}}')" on-tool.sh
printf '%s' "$OUT" | grep -q 'SECURITY' && bad "warning once per session" "$OUT" || ok "the same warning is not repeated"

echo "== log · one sanitization policy"
# credential shapes are assembled at runtime so this file carries none
TOK="tok""en=SECRETVALUE99"
BEAR="Bea""rer abc123def456ghi"
run PostToolUse Bash "$(jq -n -c --arg t "$TOK" --arg b "$BEAR" '{tool_input:{command:("curl -H \"Authorization: " + $b + "\" x")},tool_response:{stdout:($t + " ok"),stderr:"",return_code:0}}')" on-tool.sh
sleep 0.4
L=$T/repo/.claude/logs/feat_test/session.jsonl
grep -q 'SECRETVALUE99' "$L" && bad "response redaction" "$(tail -1 "$L")" || ok "token= in stdout is redacted"
grep -q 'abc123def456ghi' "$L" && bad "command redaction" "$(tail -1 "$L")" || ok "Bearer in the command is redacted"
run PostToolUse Read "$(jq -n -c --arg f "$T/repo/a.txt" '{tool_input:{file_path:$f},tool_response:{type:"text",file:{content:"THE-FILE-BODY"}}}')" on-tool.sh
sleep 0.4
grep -q 'THE-FILE-BODY' "$L" && bad "Read content must not be persisted" "$(tail -1 "$L")" || ok "Read responses keep metadata only"
PW="pass""word=hunter2"
run PostToolUseFailure Bash "$(jq -n -c --arg e "$PW No such file or directory" '{tool_input:{command:"x"},error:$e}')" on-tool.sh
printf '%s' "$OUT" | grep -q 'Path not found' && ok "failure advice emitted" || bad "failure advice" "$OUT"
sleep 0.4; grep -q 'hunter2' "$L" && bad "error redaction" "$(tail -1 "$L")" || ok "error text is redacted before logging"

echo "== Stop · CLAUDE.md reminder, single document, loop guards"
mkdir -p "$T/repo/pkg/auth"; printf '# pkg\n' > "$T/repo/pkg/CLAUDE.md"; printf 'x\n' > "$T/repo/pkg/auth/a.go"
printf '%s\n' "$T/repo/pkg/auth/a.go" > "$T/tmp/sp/edited"; rm -f "$T/tmp/sp/claudemd-nudged" "$T/tmp/sp/stop-count"
run Stop "" '{"stop_hook_active":false,"last_assistant_message":"done"}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("pkg/CLAUDE.md")' >/dev/null 2>&1 && ok "edited dir without a CLAUDE.md update is reported" || bad "claude.md nudge" "$OUT"
[ "$(printf '%s\n' "$OUT" | grep -c '^{')" -le 1 ] && ok "exactly one JSON document" || bad "single document" "$OUT"
nudged() { printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext' >/dev/null 2>&1; }
run Stop "" '{"stop_hook_active":false,"last_assistant_message":"done"}' on-stop.sh
nudged && bad "nudge once" "$OUT" || ok "the same directory is not reported twice"
printf '%s' "$OUT" | jq -e '.terminalSequence == "\u0007"' >/dev/null 2>&1 && ok "bell travels as terminalSequence" || bad "bell" "$OUT"
printf '%s\n' "$T/repo/pkg/auth/a.go" "$T/repo/pkg/CLAUDE.md" > "$T/tmp/sp/edited"; rm -f "$T/tmp/sp/claudemd-nudged"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
nudged && bad "updated claude.md" "$OUT" || ok "a CLAUDE.md edited this session needs no reminder"
rm -f "$T/tmp/sp/claudemd-nudged"
run Stop "" '{"stop_hook_active":true}' on-stop.sh
[ -z "$OUT" ] && [ "$RC" -eq 0 ] && ok "stop_hook_active short-circuits" || bad "stop_hook_active" "$OUT"

echo "== Stop · open tasks reminder"
TD=$T/home/.claude/tasks/session-sess-1; mkdir -p "$TD"
: > "$T/tmp/sp/edited"; rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/tasks-nudged"
printf '{"id":"1","subject":"Done one","status":"completed"}' > "$TD/1.json"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
nudged && bad "finished list" "$OUT" || ok "a finished list asks for nothing"
printf '{"id":"2","subject":"Ship it","status":"in_progress"}' > "$TD/2.json"
printf '{"id":"3","subject":"Later","status":"pending"}' > "$TD/3.json"
rm -f "$T/tmp/sp/stop-count"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("#2 Ship it \\(in_progress, via TaskUpdate\\)") and test("#3 Later \\(pending") and (test("Done one") | not)' >/dev/null 2>&1 \
    && ok "open tasks are named, finished ones are not" || bad "open tasks nudge" "$OUT"
[ "$(printf '%s\n' "$OUT" | grep -c '^{')" -le 1 ] && ok "still exactly one JSON document" || bad "single document" "$OUT"
rm -f "$T/tmp/sp/stop-count"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
nudged && bad "tasks nudge once" "$OUT" || ok "the same open set is not reported twice"
printf '{"id":"2","subject":"Ship it","status":"completed"}' > "$TD/2.json"
rm -f "$T/tmp/sp/stop-count"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("#3 Later")' >/dev/null 2>&1 \
    && ok "a changed open set is reported again" || bad "changed set" "$OUT"
printf '{"id":"4","subject":"New","status":"pending"}' > "$TD/4.json"
rm -f "$T/tmp/sp/stop-count"
OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-1",hook_event_name:"Stop",cwd:$cwd,scratchpad_dir:$sp,stop_hook_active:false}' \
    | CLAUDE_CODE_ENABLE_TODO_TOOLS=0 bash "$S/on-stop.sh" 2>/dev/null)
nudged && bad "tools off" "$OUT" || ok "nothing is asked when the task tools are off"
rm -rf "$TD" "$T/tmp/sp/tasks-nudged" "$T/tmp/sp/stop-count"

echo "== Stop · open tasks of the tasks MCP, main agent only"
MS=$T/home/.claude/kodflow/sessions/sess-1; mkdir -p "$MS"
printf '%s' '{"tasks":[{"id":"1","agent":"main","subject":"Main open","status":"in_progress"},
  {"id":"2","agent":"a1b2","subject":"Sub open","status":"pending"},
  {"id":"3","agent":"main","subject":"Main done","status":"completed"}]}' > "$MS/tasks.json"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("#1 Main open \\(in_progress, via task_update\\)") and (test("Sub open") | not) and (test("Main done") | not)' >/dev/null 2>&1 \
    && ok "the main agent's open MCP tasks are named, a subagent's are not" || bad "mcp tasks nudge" "$OUT"
rm -f "$T/tmp/sp/stop-count"
OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-1",hook_event_name:"Stop",cwd:$cwd,scratchpad_dir:$sp,stop_hook_active:false}' \
    | CLAUDE_CODE_ENABLE_TODO_TOOLS=0 bash "$S/on-stop.sh" 2>/dev/null)
nudged && bad "mcp nudge once" "$OUT" || ok "MCP tasks follow the same once-per-set rule, tools off or not"
rm -rf "$MS" "$T/tmp/sp/tasks-nudged" "$T/tmp/sp/stop-count"

echo "== Stop · a task list must say what is true now"
mkdir -p "$MS"
stale() { printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("none in progress or waiting")' >/dev/null 2>&1; }
printf '%s' '{"tasks":[{"id":"1","agent":"main","subject":"Done","status":"completed"},{"id":"2","agent":"main","subject":"Next","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && ok "work left, nothing in progress or waiting: flagged" || bad "stale list" "$OUT"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && ok "flagged again on the next turn until corrected" || bad "stale list repeat" "$OUT"
printf '%s' '{"tasks":[{"id":"1","agent":"main","subject":"Wait","status":"waiting"},{"id":"2","agent":"main","subject":"Next","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && bad "waiting accepted" "$OUT" || ok "a task waiting on the user makes the list truthful"
printf '%s' '{"tasks":[{"id":"1","agent":"main","subject":"Doing","status":"in_progress"},{"id":"2","agent":"main","subject":"Next","status":"pending"},{"id":"3","agent":"a1","subject":"Sub","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && bad "in progress accepted" "$OUT" || ok "a task in progress makes the list truthful"
printf '%s' '{"tasks":[{"id":"1","agent":"a1","subject":"Sub only","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && bad "subagent list" "$OUT" || ok "a subagent's list is not the main agent's to correct"
printf '%s' '{"epics":{"main":{"id":2,"title":"New"}},"tasks":[{"id":"1","agent":"main","epic":1,"subject":"Old epic left open","status":"pending"},{"id":"2","agent":"main","epic":2,"subject":"New work","status":"in_progress"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/tasks-nudged"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | (test("Old epic") | not) and test("New work")' >/dev/null 2>&1 \
    && ok "only the current epic is reminded (v1 file)" || bad "epic filter" "$OUT"

echo "== Stop · v2 epics: the active epic only"
V2='{"version":2,"next_id":6,"next_epic":3,"active":{"main":2},
  "epics":[{"id":1,"agent":"main","title":"Other","created":1,"touched":1},{"id":2,"agent":"main","title":"Active","created":1,"touched":2}],
  "tasks":[{"id":"1","agent":"main","epic":1,"subject":"Other epic todo","status":"pending"},
           {"id":"2","agent":"main","epic":2,"subject":"Active doing","status":"in_progress"},
           {"id":"3","agent":"main","epic":0,"subject":"Loose todo","status":"pending"}]}'
printf '%s' "$V2" > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/tasks-nudged"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("Active doing") and (test("Other epic todo") | not) and (test("Loose todo") | not)' >/dev/null 2>&1 \
    && ok "reminder: the active epic's tasks, not another open epic's nor epic 0's" || bad "v2 reminder" "$OUT"
stale && bad "v2 truthful" "$OUT" || ok "an open epic with pending work does not flag an active epic in progress"
printf '%s' "$V2" | jq -c '.tasks[1].status = "completed" | .tasks += [{"id":"4","agent":"main","epic":2,"subject":"Active next","status":"pending"}]' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && ok "truthfulness: the active epic with work left and nothing under way is flagged" || bad "v2 stale" "$OUT"
printf '%s' "$V2" | jq -c '.active = {}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/tasks-nudged"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("Loose todo") and (test("Active doing") | not)' >/dev/null 2>&1 \
    && ok "no active epic: the tasks with no epic are the ones checked" || bad "epic 0 fallback" "$OUT"
printf '{"epics":7,"active":"x","tasks":[1,' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
[ "$RC" -eq 0 ] && [ "$(printf '%s' "$OUT" | jq -s 'length' 2>/dev/null)" = 1 ] \
    && ok "a malformed tasks.json: Stop still exits 0 with one document" || bad "stop malformed" "rc=$RC $OUT"
rm -rf "$MS" "$T/tmp/sp/tasks-nudged" "$T/tmp/sp/stop-count"

echo "== Stop · one task in progress per worker"
mkdir -p "$MS"; rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/tasks-nudged"
printf '%s' '{"version":2,"epics":[{"id":1,"agent":"main","title":"A"},{"id":2,"agent":"main","title":"B"}],"active":{"main":1},"tasks":[
  {"id":"1","agent":"main","epic":1,"subject":"One","status":"in_progress"},
  {"id":"2","agent":"main","epic":2,"subject":"Two","status":"in_progress"},
  {"id":"3","agent":"a1","epic":0,"subject":"Sub","status":"in_progress"}]}' > "$MS/tasks.json"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("2 tasks are in progress for 1 worker") and test("#2 Two") and (test("Sub") | not)' >/dev/null 2>&1 \
    && ok "two tasks in progress, no subagent: flagged across epics" || bad "cap flag" "$OUT"
printf '{"agents":{"a1":{"type":"Explore","started":%s,"stopped":null}}}' "$(date +%s)" > "$MS/agents.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | grep -q 'tasks are in progress for' && bad "cap with subagent" "$OUT" || ok "a running subagent covers the second task"
rm -rf "$MS" "$T/tmp/sp/stop-count" "$T/tmp/sp/tasks-nudged"

echo "== PreToolUse · task tools"
run PreToolUse mcp__plugin_kodflow-hooks_tasks__task_create '{"tool_input":{"subject":"x","_agent":"forged"}}' on-tool.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.updatedInput | .subject == "x" and ._session == "sess-1" and ._agent == "main"' >/dev/null 2>&1 \
    && ok "main agent call: session and agent written in, forged value overridden" || bad "task injection" "$OUT"
run PreToolUse mcp__plugin_kodflow-hooks_tasks__task_update '{"tool_input":{"id":"1"},"agent_id":"a1b2"}' on-tool.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.updatedInput._agent == "a1b2"' >/dev/null 2>&1 \
    && ok "subagent call is attributed to its agent_id" || bad "subagent attribution" "$OUT"
run PreToolUse mcp__plugin_kodflow-hooks_tasks__task_epic '{"tool_input":{"title":"SDK"}}' on-tool.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.updatedInput | ._session == "sess-1" and ._agent == "main"' >/dev/null 2>&1 \
    && ok "task_epic gets the session and agent too" || bad "epic injection" "$OUT"
run PreToolUse mcp__plugin_kodflow-hooks_tasks__task_focus '{"tool_input":{"epic":"2"},"agent_id":"a9"}' on-tool.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.updatedInput | .epic == "2" and ._session == "sess-1" and ._agent == "a9"' >/dev/null 2>&1 \
    && ok "task_focus gets the session and agent too" || bad "focus injection" "$OUT"
jq -e '.hooks.PreToolUse | length == 1 and .[0].matcher == ""' "$ROOT/plugins/kodflow-hooks/hooks/hooks.json" >/dev/null 2>&1 \
    && ok "the PreToolUse matcher sees every tool (triage gate, task tools included)" || bad "matcher" "PreToolUse matcher is not the catch-all"
run PreToolUse TaskCreate '{"tool_input":{"subject":"x","description":"y"}}' on-tool.sh
expect_rc "built-in TaskCreate refused" 2
printf '%s' "$ERR" | grep -q 'task_create' && ok "the refusal points at the MCP tools" || bad "refusal text" "$ERR"
run PreToolUse TodoWrite '{"tool_input":{"todos":[]}}' on-tool.sh
expect_rc "built-in TodoWrite refused" 2

echo "== SubagentStart / SubagentStop · running agents registry"
AG=$T/home/.claude/kodflow/sessions/sess-1/agents.json
run SubagentStart "" '{"agent_id":"a1","agent_type":"Explore"}' on-agent.sh
run SubagentStart "" '{"agent_id":"a2","agent_type":"Plan"}' on-agent.sh
jq -e '[.agents[] | select(.stopped == null)] | length == 2' "$AG" >/dev/null 2>&1 && ok "two started subagents are running" || bad "agents start" "$(cat "$AG" 2>/dev/null)"
run SubagentStop "" '{"agent_id":"a1","agent_type":"Explore","stop_hook_active":false}' on-agent.sh
jq -e '(.agents.a1.stopped != null) and (.agents.a2.stopped == null) and .agents.a2.type == "Plan"' "$AG" >/dev/null 2>&1 \
    && ok "a stopped subagent is marked, the other keeps running" || bad "agents stop" "$(cat "$AG" 2>/dev/null)"
run SubagentStop "" '{"agent_id":"ghost","agent_type":"","stop_hook_active":false}' on-agent.sh
jq -e '.agents | has("ghost") | not' "$AG" >/dev/null 2>&1 \
    && ok "a stop with no matching start adds no phantom entry" || bad "phantom stop" "$(cat "$AG" 2>/dev/null)"
run SubagentStop "" '{"agent_id":"a2","stop_hook_active":true}' on-agent.sh
jq -e '.agents.a2.stopped == null' "$AG" >/dev/null 2>&1 && ok "a subagent continued by a stop hook is still running" || bad "active stop" "$(cat "$AG")"
jq -e '.agents.a1.epic == 0' "$AG" >/dev/null 2>&1 && ok "no tasks.json: the subagent is recorded on epic 0" || bad "agent epic 0" "$(cat "$AG")"
printf '%s' '{"version":2,"active":{"main":4},"epics":[{"id":4,"agent":"main","title":"E"}],"tasks":[]}' > "${AG%/*}/tasks.json"
run SubagentStart "" '{"agent_id":"a3","agent_type":"Explore"}' on-agent.sh
jq -e '.agents.a3.epic == 4' "$AG" >/dev/null 2>&1 && ok "SubagentStart records the main agent's active epic" || bad "agent epic" "$(cat "$AG")"
printf 'garbage' > "${AG%/*}/tasks.json"
run SubagentStart "" '{"agent_id":"a4","agent_type":"Explore"}' on-agent.sh
jq -e '.agents.a4.epic == 0' "$AG" >/dev/null 2>&1 && [ "$RC" -eq 0 ] \
    && ok "a malformed tasks.json records epic 0 and fails open" || bad "agent epic malformed" "$(cat "$AG")"
rm -rf "$T/home/.claude/kodflow"

echo "== UserPromptSubmit · triage and epic state"
ctx_of() { printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null; }
run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
C=$(ctx_of)
printf '%s' "$C" | grep -q 'TRIAGE this message' && ok "the triage directive is injected with no tasks.json" || bad "triage" "$OUT"
printf '%s' "$C" | grep -q 'Epics:' && bad "no state without tasks.json" "$C" || ok "no epic state without tasks.json"
printf '%s' "$C" | grep -q 'task_create always names its epic' && printf '%s' "$C" | grep -q '0 for none, no default' \
    && ok "the directive says the epic is mandatory, 0 for none" || bad "epic mandatory" "$C"
[ "${#C}" -lt 900 ] && ok "the injected context stays under 900 characters (${#C})" || bad "context size" "${#C}"
MS=$T/home/.claude/kodflow/sessions/sess-1; mkdir -p "$MS"
printf '%s' '{"version":2,"active":{"main":2},
  "epics":[{"id":1,"agent":"main","title":"api-gateway","touched":5},{"id":2,"agent":"main","title":"SDK status-line","touched":9},
           {"id":3,"agent":"main","title":"Finished","touched":9},{"id":7,"agent":"a1","title":"Sub epic","touched":9}],
  "tasks":[{"id":"1","agent":"main","epic":1,"subject":"Fix daemon","status":"pending"},
           {"id":"2","agent":"main","epic":2,"subject":"Port renderer","status":"completed"},
           {"id":"3","agent":"main","epic":2,"subject":"Freeze renders","status":"in_progress"},
           {"id":"4","agent":"main","epic":3,"subject":"Old","status":"completed"},
           {"id":"5","agent":"main","epic":0,"subject":"Loose","status":"pending"}]}' > "$MS/tasks.json"
run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
C=$(ctx_of)
printf '%s' "$C" | grep -qF 'Epics: active #2 SDK status-line 1/2, in progress #3 Freeze renders · other open: #1 api-gateway 0/1 · no epic: 1 open task(s)' \
    && ok "epic state: active epic with its task in progress, other open epics, loose tasks" || bad "epic state" "$C"
printf '%s' "$C" | grep -q 'Finished\|Sub epic' && bad "closed/other agent epics hidden" "$C" || ok "completed epics and subagent epics are left out"
printf '%s' "$C" | grep -q 'TRIAGE' && ok "triage still injected alongside the state" || bad "triage with state" "$C"
[ "${#C}" -lt 900 ] && ok "context with the epic state stays under 900 characters (${#C})" || bad "context size" "${#C}"
printf '%s' '{"version":1,"epics":{"main":{"id":1,"title":"Legacy"}},"tasks":[{"id":"1","agent":"main","epic":1,"subject":"T","status":"pending"}]}' > "$MS/tasks.json"
run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
ctx_of | grep -qF 'Epics: active #1 Legacy 0/1' && ok "a v1 tasks.json is read as v2" || bad "v1 state" "$OUT"
printf '{"tasks":[' > "$MS/tasks.json"
run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
[ "$RC" -eq 0 ] && [ "$(printf '%s' "$OUT" | jq -s 'length' 2>/dev/null)" = 1 ] && ctx_of | grep -q TRIAGE && ! ctx_of | grep -q 'Epics:' \
    && ok "a malformed tasks.json: one document, triage kept, state left out" || bad "user malformed" "rc=$RC $OUT"
rm -rf "$T/home/.claude/kodflow"

echo "== Triage gate · file the message before acting"
rm -f "$T/tmp/sp/triage-pending"
run UserPromptSubmit "" '{"prompt":"fais un truc"}' on-user.sh
[ -f "$T/tmp/sp/triage-pending" ] && ok "a new prompt raises the triage flag" || bad "triage flag" "absent"
bash_cmd 'ls';                                                        expect_rc "acting before triage is refused" 2
printf '%s' "$ERR" | grep -q 'TRIAGE FIRST' && ok "the refusal says to triage first" || bad "triage message" "$ERR"
run PreToolUse Read '{"tool_input":{"file_path":"/etc/hostname"}}' on-tool.sh; expect_rc "reading stays allowed" 0
run PreToolUse ToolSearch '{"tool_input":{"query":"x"}}' on-tool.sh;        expect_rc "loading tools stays allowed" 0
run PreToolUse Bash '{"tool_input":{"command":"ls"},"agent_id":"a1"}' on-tool.sh; expect_rc "a subagent is not gated" 0
run PreToolUse mcp__plugin_kodflow-hooks_tasks__task_list '{"tool_input":{}}' on-tool.sh
[ ! -f "$T/tmp/sp/triage-pending" ] && ok "a task tool call lowers the flag" || bad "flag lowered" "still there"
bash_cmd 'ls';                                                        expect_rc "acting after triage is allowed" 0
run PreToolUse WebSearch '{"tool_input":{"query":"x"}}' on-tool.sh
[ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "tools this script ignores leave at once" || bad "fast exit" "rc=$RC out=$OUT"
rm -f "$T/tmp/sp/triage-pending"

echo "== SessionStart · review the task list left open"
RS=$T/home/.claude/kodflow/sessions/sess-1; mkdir -p "$RS"; rm -f "$T/tmp/sp/triage-pending"
printf '%s' '{"version":2,"epics":[{"id":1,"agent":"main","title":"SDK"}],"active":{"main":1},"tasks":[
  {"id":"1","agent":"main","epic":1,"subject":"Stale work","status":"in_progress"},
  {"id":"2","agent":"main","epic":1,"subject":"Done work","status":"completed"},
  {"id":"3","agent":"main","epic":0,"subject":"Loose","status":"pending"},
  {"id":"4","agent":"a1","epic":0,"subject":"Sub","status":"pending"}]}' > "$RS/tasks.json"
run SessionStart "" '{"source":"resume"}' on-session.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("SESSION START") and test("#1 \\[in_progress\\] Stale work") and test("#3 \\[pending\\] Loose") and (test("Done work") | not) and (test("Sub") | not)' >/dev/null 2>&1 \
    && ok "resume lists the main agent's open tasks, finished and subagent ones left out" || bad "session review" "$OUT"
[ -f "$T/tmp/sp/triage-pending" ] && ok "resume holds acting tools until the list is reviewed" || bad "review gate" "flag absent"
rm -f "$T/tmp/sp/triage-pending"
run SessionStart "" '{"source":"compact"}' on-session.sh
[ "$(printf '%s\n' "$OUT" | grep -c '^{')" -eq 1 ] && printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("SESSION START") and test("POST-COMPACTION")' >/dev/null 2>&1 \
    && ok "compact: review and standing rules in one document" || bad "compact review" "$OUT"
printf '%s' '{"version":2,"epics":[],"active":{},"tasks":[{"id":"1","agent":"main","epic":0,"subject":"x","status":"completed"}]}' > "$RS/tasks.json"
rm -f "$T/tmp/sp/triage-pending"; run SessionStart "" '{"source":"resume"}' on-session.sh
[ ! -f "$T/tmp/sp/triage-pending" ] && ! printf '%s' "$OUT" | grep -q 'SESSION START' && ok "nothing open: no review, no gate" || bad "empty review" "$OUT"
printf '%s' '{"tasks":' > "$RS/tasks.json"
run SessionStart "" '{"source":"resume"}' on-session.sh; expect_rc "a malformed task file fails open" 0
rm -rf "$RS" "$T/tmp/sp/triage-pending"

echo "== UserPromptSubmit / SessionStart / agents"
run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("feat/test")' >/dev/null 2>&1 && ok "branch injected with the prompt" || bad "prompt context" "$OUT"
run SessionStart "" '{"source":"compact"}' on-session.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("POST-COMPACTION")' >/dev/null 2>&1 && ok "post-compaction rules injected" || bad "compact context" "$OUT"
run SessionStart "" '{"source":"startup"}' on-session.sh
expect_rc "startup exits 0" 0
run SubagentStart "" '{"agent_type":"Explore"}' on-agent.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("Subagent context")' >/dev/null 2>&1 && ok "subagent rules injected" || bad "subagent context" "$OUT"
run SubagentStop "" '{"agent_type":"Explore","stop_hook_active":true}' on-agent.sh
[ -z "$OUT" ] && ok "SubagentStop with stop_hook_active is silent" || bad "subagent stop" "$OUT"
run SessionEnd "" '{"reason":"other"}' on-session.sh;   expect_rc "SessionEnd exits 0" 0
run Notification "" '{"notification_type":"permission_prompt","message":"x"}' on-user.sh
printf '%s' "$OUT" | jq -e '.terminalSequence' >/dev/null 2>&1 && ok "permission prompt rings the bell" || bad "notification bell" "$OUT"
run Notification "" '{"notification_type":"auth_success","message":"x"}' on-user.sh
[ -z "$OUT" ] && ok "other notifications stay silent" || bad "notification silent" "$OUT"

echo "== malformed input never blocks"
for s in on-tool.sh on-session.sh on-user.sh on-agent.sh on-stop.sh; do
    printf 'not json' | bash "$S/$s" >/dev/null 2>&1; r1=$?
    printf '' | bash "$S/$s" >/dev/null 2>&1; r2=$?
    [ "$r1" -eq 0 ] && [ "$r2" -eq 0 ] && ok "$s fails open" || bad "$s fail-open" "rc=$r1/$r2"
done

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
