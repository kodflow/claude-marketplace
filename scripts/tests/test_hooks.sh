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
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("#2 Ship it \\(in_progress\\)") and test("#3 Later \\(pending\\)") and (test("Done one") | not)' >/dev/null 2>&1 \
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
