#!/bin/bash
# test_hooks.sh — behavioural tests for plugins/kodflow-hooks/hooks/scripts.
#
# Each case feeds a hook the JSON Claude Code would send and asserts on the
# exit code and stdout. Runs in a throwaway git repository; needs bash, jq,
# git.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude
unset CLAUDE_CODE_ENABLE_TODO_TOOLS CLAUDE_CODE_TASK_LIST_ID   # inherited values would change what is asserted
# The delegation gate (the main thread does not produce code in a repository)
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

echo "== PreToolUse · mcp.json is never committed (the index)"
# The corpus plays a fixed repository; what these read is the index. -f: a
# global excludes file may ignore mcp.json.
mj_motif() { printf '%s' "$ERR" | grep -q '\[motif:mcp-json\]'; }
expect_mj() { [ "$RC" -eq 2 ] && mj_motif && ok "$1" || bad "$1" "rc=$RC err=${ERR:0:200}"; }
forge() { run PreToolUse "$1" "$(jq -n -c --argjson i "$2" '{agent_id:"agt_mj",tool_input:$i}')" on-tool.sh; }
mkdir -p "$T/repo/sub"; printf '{}\n' > "$T/repo/.mcp.json"; git -C "$T/repo" add -f .mcp.json
bash_cmd 'git commit -m "feat: servers"';                              expect_mj "commit with a staged .mcp.json blocked"
bash_cmd "git -C $T/repo commit -m \"feat: servers\"";                expect_mj "git -C dir commit reads that index"
forge mcp__GitKraken__git_commit '{"directory":".","message":"feat: x"}'; expect_mj "GitKraken git_commit with a staged .mcp.json blocked"
git -C "$T/repo" commit -qm "chore: tracked for the test"
git -C "$T/repo" rm -q --cached .mcp.json
bash_cmd 'git commit -m "chore: drop .mcp.json"';                      expect_rc "commit of the deletion allowed" 0
git -C "$T/repo" commit -qm "chore: drop .mcp.json"
printf '{}\n' > "$T/repo/sub/MCP.json"; git -C "$T/repo" add -f sub/MCP.json; git -C "$T/repo" commit -qm "chore: tracked"
printf '{"a":1}\n' > "$T/repo/sub/MCP.json"
bash_cmd 'git commit -am "feat: x"';                                   expect_mj "commit -am with a modified tracked mcp.json blocked"
bash_cmd 'git commit --all -m "feat: x"';                              expect_mj "commit --all with a modified tracked mcp.json blocked"
bash_cmd 'git commit -m "feat: x"';                                    expect_rc "plain commit leaves the working tree alone" 0
git -C "$T/repo" checkout -q sub/MCP.json
git -C "$T/repo" mv sub/MCP.json sub/servers.json
bash_cmd 'git commit -m "chore: rename"';                              expect_rc "a rename away from mcp.json allowed" 0
git -C "$T/repo" commit -qm "chore: rename"; git -C "$T/repo" mv sub/servers.json sub/mcp.json
bash_cmd 'git commit -m "chore: rename"';                              expect_mj "a rename onto mcp.json blocked"
git -C "$T/repo" mv sub/mcp.json sub/servers.json
printf '{}\n' > "$T/repo/mymcp.json"; git -C "$T/repo" add mymcp.json
bash_cmd 'git commit -m "feat: x"';                                    expect_rc "mymcp.json staged allowed" 0
git -C "$T/repo" rm -q --cached mymcp.json; rm -f "$T/repo/mymcp.json"
git -C "$T/repo" rm -q --cached sub/servers.json; rm -rf "$T/repo/sub"
git -C "$T/repo" config core.excludesFile /dev/null
forge mcp__GitKraken__git_add '{"directory":"."}';                     expect_mj "GitKraken git_add of every file with an untracked .mcp.json blocked"
rm -f "$T/repo/.mcp.json"
forge mcp__GitKraken__git_add '{"directory":"."}';                     expect_rc "GitKraken git_add of every file without one allowed" 0
forge mcp__github__get_file_contents '{"owner":"o","repo":"r","path":".mcp.json"}'; expect_rc "reading an mcp.json on the forge allowed" 0
# pathspecs git resolves itself: `.`, -A, a directory, a list in a file
printf '{}\n' > "$T/repo/.mcp.json"
bash_cmd 'git add .';                                                  expect_mj "git add . with an untracked .mcp.json blocked"
bash_cmd 'git add -A && git commit -m "feat: x"';                      expect_mj "git add -A then commit on one line blocked"
bash_cmd 'git add -u';                                                 expect_rc "git add -u leaves untracked files alone" 0
printf '.mcp.json\n' > "$T/repo/list.txt"
bash_cmd 'git add --pathspec-from-file=list.txt';                      expect_mj "git add --pathspec-from-file naming it blocked"
rm -f "$T/repo/list.txt"
git -C "$T/repo" config --unset core.excludesFile
printf '.mcp.json\n' > "$T/repo/.git/info/exclude"
bash_cmd 'git add .';                                                  expect_rc "git add . skips an ignored .mcp.json" 0
bash_cmd 'git add -f .';                                               expect_mj "git add -f . takes an ignored .mcp.json in"
: > "$T/repo/.git/info/exclude"; rm -f "$T/repo/.mcp.json"
mkdir -p "$T/repo/sub"; printf '{}\n' > "$T/repo/sub/mcp.json"; git -C "$T/repo" add -f sub/mcp.json; git -C "$T/repo" commit -qm "chore: tracked"
printf '{"a":1}\n' > "$T/repo/sub/mcp.json"
bash_cmd 'git commit -m "feat: x" -- .';                               expect_mj "git commit -- . with a modified tracked mcp.json blocked"
bash_cmd 'git commit -m "feat: x" sub';                                expect_mj "git commit <dir> with a modified tracked mcp.json blocked"
bash_cmd 'git commit -m "feat: x" -- a.txt';                           expect_rc "git commit -- a.txt allowed" 0
git -C "$T/repo" rm -q --cached sub/mcp.json; git -C "$T/repo" commit -qm "chore: drop"; rm -rf "$T/repo/sub"
# -C joins onto the cd directory
mkdir -p "$T/repo/sub/nested"; git -C "$T/repo/sub/nested" init -q -b feat/n
printf '{}\n' > "$T/repo/sub/nested/.mcp.json"; git -C "$T/repo/sub/nested" add -f .mcp.json
bash_cmd 'cd sub && git -C nested commit -m "feat: x"';                expect_mj "cd sub && git -C nested commit reads sub/nested's index"
rm -rf "$T/repo/sub"

echo "== PreToolUse Bash · the input is never rewritten"
bash_cmd 'git push --force origin feat'
[ "$RC" -eq 2 ] && [ -z "$OUT" ] && printf '%s' "$ERR" | grep -q 'Run instead: git push --force-with-lease origin feat' \
    && ok "--force refused with the command to run" || bad "--force refusal" "rc=$RC out=$OUT err=$ERR"
bash_cmd 'git push -f origin feat'
printf '%s' "$ERR" | grep -q 'git push --force-with-lease origin feat' && ok "-f refused with the command to run" || bad "-f refusal" "$ERR"
for c in 'ls -la /tmp' 'git status' 'cat a.txt' 'git push --force-with-lease origin feat'; do
    bash_cmd "$c"; [ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "no updatedInput: $c" || bad "no rewrite: $c" "rc=$RC out=$OUT"
done

echo "== PreToolUse Bash · bash-guard corpus"
# tests/fixtures/bash-guard.jsonl: one case per line. rc and the [motif:x]
# line of the refusal are compared, never the wording. A known_gap case is
# played and reported, not counted.
# HOOK_SHELL=/bin/bash plays it under macOS's bash 3.2.
CORPUS=$ROOT/plugins/kodflow-hooks/tests/fixtures/bash-guard.jsonl
HOOK_SHELL=${HOOK_SHELL:-bash}
c_pass=0; c_fail=0; c_gap=0; c_n=0
while IFS= read -r row; do
    [ -n "$row" ] || continue
    c_n=$((c_n+1))
    # one jq per case: the payload and the expectations, shell-quoted
    eval "$(printf '%s' "$row" | jq -r --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '
        ({session_id:"sess-corpus",hook_event_name:"PreToolUse",tool_name:(.tool // "Bash"),cwd:$cwd,scratchpad_dir:$sp,tool_use_id:"tc",
          tool_input:(if .tool then .input else {command:.cmd} end)}
         + (if .agent then {agent_id:"agt_corpus",agent_type:"general-purpose"} else {} end)) as $p
        | @sh "json=\($p | tojson) exp_rc=\(.rc) exp_m=\(.motif // "") gap=\(.known_gap // "") root=\(.root // false) label=\((.tool // .cmd) | gsub("\n"; "⏎") | .[0:90])"')"
    if [ "$root" = true ]; then
        ERR=$(printf '%s' "$json" | env -u KODFLOW_ROOT "$HOOK_SHELL" "$S/on-tool.sh" 2>&1 >/dev/null); RC=$?
    else
        ERR=$(printf '%s' "$json" | "$HOOK_SHELL" "$S/on-tool.sh" 2>&1 >/dev/null); RC=$?
    fi
    got_m=$(printf '%s' "$ERR" | sed -n 's/^ *\[motif:\(.*\)\]$/\1/p' | head -1)
    if [ "$RC" -eq "$exp_rc" ] && { [ "$exp_rc" -eq 0 ] || [ -z "$exp_m" ] || [ "$got_m" = "$exp_m" ]; }; then
        if [ -n "$gap" ]; then c_gap=$((c_gap+1)); printf '  gap  (now holds) %s\n' "$label"; else c_pass=$((c_pass+1)); fi
    elif [ -n "$gap" ]; then
        c_gap=$((c_gap+1)); printf '  gap  %s — %s\n' "$label" "$gap"
    else
        c_fail=$((c_fail+1)); bad "corpus: $label" "want rc=$exp_rc motif=$exp_m, got rc=$RC motif=$got_m"
    fi
done < "$CORPUS"
echo "  corpus bash-guard: $c_n cases, $c_pass passed, $c_fail failed, $c_gap known gaps"
[ "$c_fail" -eq 0 ] && [ "$c_n" -gt 0 ] && ok "bash-guard corpus" || bad "bash-guard corpus" "$c_fail case(s) failed"

echo "== PreToolUse Bash · the vendored patterns (hooks/patterns)"
# The rules are read from kodflow/post-commit's files, vendored beside the
# scripts. A copy without them, or with a directive it cannot read, refuses a
# commit message rather than read it as clean; a pull request body too.
mkdir -p "$T/np/hooks" && cp -R "$S" "$T/np/hooks/scripts"
np_cmd() { printf '%s' "$(jq -n -c --arg c "$1" --arg cwd "$T/repo" '{session_id:"s",hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_use_id:"t",tool_input:{command:$c}}')" \
    | "${HOOK_SHELL:-bash}" "$T/np/hooks/scripts/on-tool.sh" 2>&1 >/dev/null; }
E=$(np_cmd 'git commit -m "feat: plain"'); RC=$?
[ "$RC" -eq 2 ] && printf '%s' "$E" | grep -q 'hooks/patterns unreadable' && ok "no hooks/patterns: a commit is refused" || bad "no hooks/patterns" "rc=$RC $E"
mkdir -p "$T/np/hooks/patterns"
cp "$S/../patterns/patterns.txt" "$T/np/hooks/patterns/"
{ printf '# @scope: commit,mr\n'; cat "$S/../patterns/patterns-strict.txt"; } > "$T/np/hooks/patterns/patterns-strict.txt"
E=$(np_cmd 'gh pr create --title x --body plain'); RC=$?
[ "$RC" -eq 2 ] && printf '%s' "$E" | grep -q 'hooks/patterns unreadable' && ok "an unknown scope: a pull request is refused" || bad "unknown scope" "rc=$RC $E"
{ cat "$S/../patterns/patterns.txt"; printf 'unclosed[bracket\n'; } > "$T/np/hooks/patterns/patterns.txt"
cp "$S/../patterns/patterns-strict.txt" "$T/np/hooks/patterns/"
E=$(np_cmd 'git commit -m "feat: plain"'); RC=$?
[ "$RC" -eq 2 ] && printf '%s' "$E" | grep -q 'hooks/patterns unreadable' && ok "a pattern grep cannot compile: a commit is refused" || bad "invalid pattern" "rc=$RC $E"
cp "$S/../patterns/patterns.txt" "$T/np/hooks/patterns/"
E=$(np_cmd 'git commit -m "feat: plain"'); RC=$?
[ "$RC" -eq 0 ] && ok "both files back: a plain commit passes" || bad "patterns restored" "rc=$RC $E"

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
: > "$T/tmp/sp/edited"; rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said"
printf '{"id":"1","subject":"Done one","status":"completed"}' > "$TD/1.json"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
nudged && bad "finished list" "$OUT" || ok "a finished list asks for nothing"
printf '{"id":"2","subject":"Ship it","status":"in_progress"}' > "$TD/2.json"
printf '{"id":"3","subject":"Later","status":"pending"}' > "$TD/3.json"
rm -f "$T/tmp/sp/stop-count"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("Open tasks \\(TaskUpdate\\)[^\\n]*: #2 #3 \\(") and (test("#1") | not)' >/dev/null 2>&1 \
    && ok "open tasks are named by id on one line, finished ones are not" || bad "open tasks nudge" "$OUT"
[ "$(printf '%s\n' "$OUT" | grep -c '^{')" -le 1 ] && ok "still exactly one JSON document" || bad "single document" "$OUT"
rm -f "$T/tmp/sp/stop-count"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
nudged && bad "tasks nudge once" "$OUT" || ok "the same open set is not reported twice"
printf '{"id":"2","subject":"Ship it","status":"completed"}' > "$TD/2.json"
rm -f "$T/tmp/sp/stop-count"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test(": #3 \\(")' >/dev/null 2>&1 \
    && ok "a changed open set is reported again" || bad "changed set" "$OUT"
stop_env() { rm -f "$T/tmp/sp/stop-count"
    OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-1",hook_event_name:"Stop",cwd:$cwd,scratchpad_dir:$sp,stop_hook_active:false}' \
        | env "$@" bash "$S/on-stop.sh" 2>/dev/null); }
printf '{"id":"5","subject":"Fresh","status":"pending"}' > "$TD/5.json"
stop_env KODFLOW_STOP_TASKS=off
nudged && bad "tasks off" "$OUT" || ok "KODFLOW_STOP_TASKS=off: no open-tasks reminder"
stop_env
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("#5")' >/dev/null 2>&1 \
    && ok "switched back on, the set it held back is reported" || bad "tasks back on" "$OUT"
rm -f "$TD/5.json"
printf '{"id":"4","subject":"New","status":"pending"}' > "$TD/4.json"
rm -f "$T/tmp/sp/stop-count"
OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-1",hook_event_name:"Stop",cwd:$cwd,scratchpad_dir:$sp,stop_hook_active:false}' \
    | CLAUDE_CODE_ENABLE_TODO_TOOLS=0 bash "$S/on-stop.sh" 2>/dev/null)
nudged && bad "tools off" "$OUT" || ok "nothing is asked when the task tools are off"
rm -rf "$TD" "$T/tmp/sp/stop-said" "$T/tmp/sp/stop-count"

echo "== Stop · open tasks of the tasks MCP, main agent only"
MS=$T/home/.claude/kodflow/sessions/sess-1; mkdir -p "$MS"
printf '%s' '{"tasks":[{"id":"1","agent":"main","subject":"Main open","status":"in_progress"},
  {"id":"2","agent":"a1b2","subject":"Sub open","status":"pending"},
  {"id":"3","agent":"main","subject":"Main done","status":"completed"}]}' > "$MS/tasks.json"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
nudged && bad "mcp tasks nudge" "$OUT" \
    || ok "one main task in progress, alone, is true: nothing is said (a subagent's pending task is not the main agent's)"
rm -f "$T/tmp/sp/stop-count"
OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-1",hook_event_name:"Stop",cwd:$cwd,scratchpad_dir:$sp,stop_hook_active:false}' \
    | CLAUDE_CODE_ENABLE_TODO_TOOLS=0 bash "$S/on-stop.sh" 2>/dev/null)
nudged && bad "mcp nudge once" "$OUT" || ok "MCP tasks follow the same once-per-set rule, tools off or not"
rm -rf "$MS" "$T/tmp/sp/stop-said" "$T/tmp/sp/stop-count"

echo "== Stop · a task list must say what is true now"
mkdir -p "$MS"
stale() { printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("none in progress or waiting")' >/dev/null 2>&1; }
printf '%s' '{"tasks":[{"id":"1","agent":"main","subject":"Done","status":"completed"},{"id":"2","agent":"main","subject":"Next","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && ok "work left, nothing in progress or waiting: flagged" || bad "stale list" "$OUT"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && bad "stale list repeat" "$OUT" || ok "the same false state is not said twice in a row"
stop_env KODFLOW_STOP_TASKS=off
stale && bad "stale off" "$OUT" || ok "KODFLOW_STOP_TASKS=off: the task-list rule is off too"
printf '%s' '{"tasks":[{"id":"1","agent":"main","subject":"Wait","status":"waiting"},{"id":"2","agent":"main","subject":"Next","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && bad "waiting accepted" "$OUT" || ok "a task waiting on the user makes the list truthful"
printf '%s' '{"tasks":[{"id":"1","agent":"main","subject":"Go","status":"waiting","assignee":"human"},{"id":"2","agent":"main","subject":"Next","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && bad "human waiting accepted" "$OUT" || ok "a task assigned to the user (assignee human) is read as any waiting task"
printf '%s' '{"tasks":[{"id":"1","agent":"main","subject":"Doing","status":"in_progress"},{"id":"2","agent":"main","subject":"Next","status":"pending"},{"id":"3","agent":"a1","subject":"Sub","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && bad "in progress accepted" "$OUT" || ok "a task in progress makes the list truthful"
printf '%s' '{"tasks":[{"id":"1","agent":"a1","subject":"Sub only","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && bad "subagent list" "$OUT" || ok "a subagent's list is not the main agent's to correct"
printf '%s' '{"epics":{"main":{"id":2,"title":"New"}},"tasks":[{"id":"1","agent":"main","epic":1,"subject":"Old epic left open","status":"pending"},{"id":"2","agent":"main","epic":2,"subject":"New work","status":"in_progress"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
nudged && bad "epic filter" "$OUT" || ok "another epic's pending task is not the current epic's: nothing said (v1 file)"

echo "== Stop · v2 epics: the active epic only"
V2='{"version":2,"next_id":6,"next_epic":3,"active":{"main":2},
  "epics":[{"id":1,"agent":"main","title":"Other","created":1,"touched":1},{"id":2,"agent":"main","title":"Active","created":1,"touched":2}],
  "tasks":[{"id":"1","agent":"main","epic":1,"subject":"Other epic todo","status":"pending"},
           {"id":"2","agent":"main","epic":2,"subject":"Active doing","status":"in_progress"},
           {"id":"3","agent":"main","epic":0,"subject":"Loose todo","status":"pending"}]}'
printf '%s' "$V2" > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("Requests still open[^\\n]*: #3 \\(") and (test("#1") | not) and (test("#2") | not)' >/dev/null 2>&1 \
    && ok "a pending request with no epic is said; the active epic in progress and another epic are not" || bad "v2 reminder" "$OUT"
stale && bad "v2 truthful" "$OUT" || ok "an open epic with pending work does not flag an active epic in progress"
printf '%s' "$V2" | jq -c '.tasks[1].status = "completed" | .tasks += [{"id":"4","agent":"main","epic":2,"subject":"Active next","status":"pending"}]' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
stale && ok "truthfulness: the active epic with work left and nothing under way is flagged" || bad "v2 stale" "$OUT"
printf '%s' "$V2" | jq -c '.active = {}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("#3") and (test("#2") | not)' >/dev/null 2>&1 \
    && ok "no active epic: the tasks with no epic are the ones checked" || bad "epic 0 fallback" "$OUT"
printf '{"epics":7,"active":"x","tasks":[1,' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
[ "$RC" -eq 0 ] && [ "$(printf '%s' "$OUT" | jq -s 'length' 2>/dev/null)" = 1 ] \
    && ok "a malformed tasks.json: Stop still exits 0 with one document" || bad "stop malformed" "rc=$RC $OUT"
rm -rf "$MS" "$T/tmp/sp/stop-said" "$T/tmp/sp/stop-count"

echo "== Stop · one task in progress per worker"
mkdir -p "$MS"; rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said"
printf '%s' '{"version":2,"epics":[{"id":1,"agent":"main","title":"A"},{"id":2,"agent":"main","title":"B"}],"active":{"main":1},"tasks":[
  {"id":"1","agent":"main","epic":1,"subject":"One","status":"in_progress"},
  {"id":"2","agent":"main","epic":2,"subject":"Two","status":"in_progress"},
  {"id":"3","agent":"a1","epic":0,"subject":"Sub","status":"in_progress"}]}' > "$MS/tasks.json"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("#1 #2 \\(2 in progress for 1 worker") and (test("#3") | not)' >/dev/null 2>&1 \
    && ok "two tasks in progress, no subagent: flagged across epics" || bad "cap flag" "$OUT"
printf '{"agents":{"a1":{"type":"Explore","started":%s,"stopped":null}}}' "$(date +%s)" > "$MS/agents.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | grep -q 'in progress for' && bad "cap with subagent" "$OUT" || ok "a running subagent covers the second task"
rm -rf "$MS" "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said"

echo "== Stop · a task tied to a stopped worker"
mkdir -p "$MS"; rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said" "$T/tmp/sp/stop-said"
NOW=$(date +%s)
printf '{"agents":{"r1":{"type":"review-pr3","started":%s,"stopped":%s},"c2":{"type":"sdk-consensus2","started":%s,"stopped":null}}}' \
    "$((NOW - 600))" "$NOW" "$((NOW - 600))" > "$MS/agents.json"
printf '%s' '{"version":2,"epics":[],"active":{},"tasks":[
  {"id":"36","agent":"main","epic":0,"subject":"Review PR 3","status":"in_progress","worker":"review-pr3","worker_id":"r1"},
  {"id":"42","agent":"main","epic":0,"subject":"Consensus","status":"in_progress","worker":"sdk-consensus2","worker_id":"c2"},
  {"id":"43","agent":"main","epic":0,"subject":"Mine","status":"in_progress"}]}' > "$MS/tasks.json"
run Stop "" '{"stop_hook_active":false}' on-stop.sh
CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
printf '%s' "$CTX" | grep -q 'Tasks to set right.*: #36 (subagent stopped' \
    && ok "a task whose worker stopped is named with its worker" || bad "dead worker" "$OUT"
printf '%s' "$CTX" | grep -q '#42' && bad "live worker flagged" "$CTX" || ok "a task tied to a running worker is not flagged"
printf '%s' "$CTX" | grep -q 'in progress for' && bad "cap with tied tasks" "$CTX" \
    || ok "a tied task holds its worker's slot: one untied task for the main thread passes the headcount"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | grep -q 'subagent stopped' && bad "dead worker repeated" "$OUT" \
    || ok "the stopped-worker reminder is given once per set"
printf '%s' '{"version":2,"epics":[],"active":{},"tasks":[
  {"id":"42","agent":"main","epic":0,"subject":"Consensus","status":"in_progress","worker":"sdk-consensus2","worker_id":"c2"},
  {"id":"43","agent":"main","epic":0,"subject":"Mine","status":"in_progress"},
  {"id":"44","agent":"main","epic":0,"subject":"Other","status":"in_progress"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test(": #43 #44 \\(2 in progress for 1 worker")' >/dev/null 2>&1 \
    && ok "a tied task takes its worker's slot: two untied tasks for the main thread are flagged" || bad "untied cap" "$OUT"
rm -rf "$MS" "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said" "$T/tmp/sp/stop-said"

echo "== Stop · one line per cause, said once, in the user's language"
mkdir -p "$MS"; rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said"
CTXS() { printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null; }
NOW=$(date +%s)
# The case reported on 23/10/2026: three tasks in progress on subagents that
# have stopped were listed three times, under three explanations.
printf '{"agents":{"x1":{"type":"fj-cr","started":%s,"stopped":%s,"epic":5},"x2":{"type":"audit","started":%s,"stopped":%s,"epic":5}}}' \
    "$((NOW - 900))" "$NOW" "$((NOW - 900))" "$NOW" > "$MS/agents.json"
printf '%s' '{"version":2,"epics":[{"id":5,"agent":"main","title":"Raft"}],"active":{"main":5},"tasks":[
  {"id":"99","agent":"main","epic":5,"subject":"Fix CR threads","status":"in_progress","worker":"fj-cr","worker_id":"x1"},
  {"id":"100","agent":"main","epic":5,"subject":"Audit SDK","status":"in_progress","worker":"audit","worker_id":"x2"},
  {"id":"101","agent":"main","epic":5,"subject":"Audit forgejo","status":"in_progress","worker":"audit","worker_id":"x2"}]}' > "$MS/tasks.json"
mkdir -p "$T/home/.claude"; printf '{"language":"Français"}' > "$T/home/.claude/settings.json"
stop_env KODFLOW_ROOT=on; C=$(CTXS)
[ "$(printf '%s\n' "$C" | wc -l | tr -d ' ')" = 1 ] && [ "$(printf '%s' "$C" | grep -o '#100' | wc -l | tr -d ' ')" = 1 ] \
    && ok "the reported case: one line, each task named once" || bad "one line" "$C"
printf '%s' "$C" | grep -qF "Tâches à remettre d'aplomb"$'\e[39m'" : #99 #100 #101 (sous-agent arrêté" \
    && ok "language \"Français\" in the user settings: French, accents kept" || bad "french" "$C"
printf '%s' "$C" | grep -qF $'\e[31m' && ok "a stopped subagent's line is red" || bad "red" "$C"
[ "${#C}" -lt 200 ] && ok "the whole feedback stays under 200 characters (${#C})" || bad "short" "${#C}"
stop_env KODFLOW_ROOT=on; [ -z "$(CTXS)" ] && ok "the same state is not said twice in a row" || bad "repeat" "$OUT"
jq '.tasks[2].status = "completed"' "$MS/tasks.json" > "$MS/t" && mv "$MS/t" "$MS/tasks.json"
stop_env KODFLOW_ROOT=on; CTXS | grep -q ': #99 #100 (' && ok "a changed state is said again" || bad "changed" "$OUT"
rm -f "$T/tmp/sp/stop-said"; stop_env KODFLOW_ROOT=on NO_COLOR=1
CTXS | grep -qF $'\e[' && bad "no_color" "$OUT" || ok "NO_COLOR: no escape sequence at all"
rm -f "$T/tmp/sp/stop-said"; stop_env KODFLOW_ROOT=on KODFLOW_LANG=en
CTXS | grep -q 'Tasks to set right.*subagent stopped' && ok "KODFLOW_LANG=en overrides the setting" || bad "lang override" "$OUT"
mkdir -p "$T/repo/.claude"; printf '{"language":"english"}' > "$T/repo/.claude/settings.local.json"
rm -f "$T/tmp/sp/stop-said"; stop_env KODFLOW_ROOT=on
CTXS | grep -q 'Tasks to set right' && ok "the project's settings.local.json wins over the user's" || bad "lang precedence" "$OUT"
rm -f "$T/repo/.claude/settings.local.json"
# True states are never reported: in progress on a running subagent, waiting
printf '{"agents":{"x1":{"type":"fj-cr","started":%s,"stopped":null,"epic":5}}}' "$NOW" > "$MS/agents.json"
printf '%s' '{"version":2,"epics":[{"id":5,"agent":"main","title":"Raft"}],"active":{"main":5},"tasks":[
  {"id":"1","agent":"main","epic":5,"subject":"Delegated","status":"in_progress","worker":"fj-cr","worker_id":"x1"},
  {"id":"2","agent":"main","epic":5,"subject":"Await go","status":"waiting"},
  {"id":"3","agent":"main","epic":5,"subject":"Next","status":"pending"}]}' > "$MS/tasks.json"
rm -f "$T/tmp/sp/stop-said"; stop_env KODFLOW_ROOT=on
[ -z "$(CTXS)" ] && ok "in progress on a running subagent, waiting, pending behind them: nothing said" || bad "true state" "$OUT"
rm -rf "$MS" "$T/tmp/sp/stop-said" "$T/tmp/sp/stop-count" "$T/home/.claude/settings.json"

echo "== PreToolUse · task tools (served by the mod, never by this script)"
SD=$T/home/.claude/kodflow/sessions/sess-1
beat()  { mkdir -p "$SD"; date +%s > "$SD/mod-beat"; }            # the mod is loaded
stale() { mkdir -p "$SD"; echo $(( $(date +%s) - 60 )) > "$SD/mod-beat"; }   # it was, and is gone
nobeat() { rm -f "$SD/mod-beat"; }                                    # it never loaded
for name in mcp__plugin_kodflow-hooks_tasks__task_create mcp__kodflow-hooks__task_create; do
    run PreToolUse "$name" '{"tool_input":{"subject":"x","_agent":"forged"}}' on-tool.sh
    [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q updatedInput \
        && ok "${name%%__task*}: no input rewrite, the mod tells callers apart itself" || bad "task call $name" "rc=$RC $OUT"
done
jq -e '.hooks.PreToolUse | length == 1 and .[0].matcher == ""' "$ROOT/plugins/kodflow-hooks/hooks/hooks.json" >/dev/null 2>&1 \
    && ok "the PreToolUse matcher sees every tool (triage gate)" || bad "matcher" "PreToolUse matcher is not the catch-all"
jq -e '.modules == ["./mod/register.ts"]' "$ROOT/plugins/kodflow-hooks/hooks/hooks.json" >/dev/null 2>&1 \
    && ok "hooks.json loads the mod" || bad "modules" "no ./mod/register.ts"
[ ! -e "$ROOT/plugins/kodflow-hooks/.mcp.json" ] && [ ! -e "$ROOT/plugins/kodflow-hooks/mcp/tasks.py" ] \
    && ok "the tasks MCP is gone (.mcp.json, mcp/tasks.py)" || bad "tasks MCP" "still shipped"
beat
run PreToolUse TaskCreate '{"tool_input":{"subject":"x","description":"y"}}' on-tool.sh
expect_rc "built-in TaskCreate refused while the mod beats" 2
printf '%s' "$ERR" | grep -q 'task_create' && ok "the refusal points at the kodflow task tools" || bad "refusal text" "$ERR"
run PreToolUse TodoWrite '{"tool_input":{"todos":[]}}' on-tool.sh
expect_rc "built-in TodoWrite refused while the mod beats" 2
stale
run PreToolUse TaskCreate '{"tool_input":{"subject":"x","description":"y"}}' on-tool.sh
expect_rc "built-in TaskCreate allowed once the mod is gone" 0
nobeat
run PreToolUse TodoWrite '{"tool_input":{"todos":[]}}' on-tool.sh
expect_rc "built-in TodoWrite allowed without the mod" 0
rm -rf "$T/home/.claude/kodflow"

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
sys_of() { printf '%s' "$OUT" | jq -r '.systemMessage // empty' 2>/dev/null; }
beat; run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
C=$(ctx_of)
printf '%s' "$C" | grep -q 'TRIAGE this message' && ok "the triage directive is injected with no tasks.json" || bad "triage" "$OUT"
printf '%s' "$C" | grep -q 'Epics:' && bad "no state without tasks.json" "$C" || ok "no epic state without tasks.json"
printf '%s' "$C" | grep -q 'task_create always names its epic' && printf '%s' "$C" | grep -q '0 for none, no default' \
    && ok "the directive says the epic is mandatory, 0 for none" || bad "epic mandatory" "$C"
[ "${#C}" -lt 900 ] && ok "the injected context stays under 900 characters (${#C})" || bad "context size" "${#C}"
[ -z "$(sys_of)" ] && ok "a beating mod: no system message" || bad "beat message" "$OUT"
MS=$T/home/.claude/kodflow/sessions/sess-1; mkdir -p "$MS"; beat
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
printf '%s' '{"version":2,"active":{"main":1},"epics":[{"id":1,"agent":"main","title":"NAS","touched":1}],
  "tasks":[{"id":"1","agent":"main","epic":1,"subject":"Check backups","status":"in_progress"},
           {"id":"2","agent":"main","epic":1,"subject":"Give the go","status":"waiting","assignee":"human"},
           {"id":"3","agent":"main","epic":1,"subject":"Touch ID","status":"completed","assignee":"human"}]}' > "$MS/tasks.json"
run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
C=$(ctx_of)
printf '%s' "$C" | grep -qF 'Epics: active #1 NAS 1/3, in progress #1 Check backups · waiting on the user: #2 Give the go (task_update completed once answered)' \
    && ok "the user's open tasks ride the epic state, answered ones do not" || bad "human state" "$C"
printf '{"tasks":[' > "$MS/tasks.json"
run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
[ "$RC" -eq 0 ] && [ "$(printf '%s' "$OUT" | jq -s 'length' 2>/dev/null)" = 1 ] && ctx_of | grep -q TRIAGE && ! ctx_of | grep -q 'Epics:' \
    && ok "a malformed tasks.json: one document, triage kept, state left out" || bad "user malformed" "rc=$RC $OUT"
printf '%s' '{"version":2,"active":{"main":1},"epics":[{"id":1,"agent":"main","title":"E"}],"tasks":[]}' > "$MS/tasks.json"
stale; rm -f "$MS/triage-pending"; run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
C=$(ctx_of)
! printf '%s' "$C" | grep -q 'TRIAGE\|Epics:\|Keep statuses' && [ ! -f "$MS/triage-pending" ] \
    && ok "mod gone: no gate, no directive, no task state" || bad "stale prompt" "$OUT"
sys_of | grep -q '/reload-plugins' && ok "mod gone: the user is told to /reload-plugins" || bad "stale message" "$OUT"
printf '%s' "$C" | grep -q 'feat/test' && ok "mod gone: the rest of the context stays" || bad "stale context" "$C"
nobeat; rm -f "$T/tmp/sp/mod-absent-said"; run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
! ctx_of | grep -q 'TRIAGE' && [ ! -f "$MS/triage-pending" ] && sys_of | grep -q '2.1.293' \
    && ok "no mod at all: no gate, no directive, the version is named" || bad "absent prompt" "$OUT"
run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
[ -z "$(sys_of)" ] && ok "no mod at all: said once per session" || bad "absent twice" "$OUT"
rm -f "$T/tmp/sp/mod-absent-said"
OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-1",hook_event_name:"UserPromptSubmit",cwd:$cwd,scratchpad_dir:$sp,prompt:"hi"}' \
    | KODFLOW_MOD=off bash "$S/on-user.sh" 2>/dev/null)
[ -z "$(sys_of)" ] && [ ! -f "$T/tmp/sp/mod-absent-said" ] && ok "KODFLOW_MOD=off: nothing said, no marker" || bad "mod off" "$OUT"
rm -rf "$T/home/.claude/kodflow" "$T/tmp/sp/mod-absent-said"

echo "== Triage gate · file the message before acting"
TP=$SD/triage-pending
beat; rm -f "$TP"
run UserPromptSubmit "" '{"prompt":"fais un truc"}' on-user.sh
[ "$(grep -cE '^prompt [0-9]+-[0-9]+-[0-9]+$' "$TP" 2>/dev/null)" = 1 ] && [ "$(wc -l < "$TP" | tr -d ' ')" = 1 ] \
    && ok "a new prompt raises the triage flag, one line for its message" || bad "triage flag" "$(cat "$TP" 2>/dev/null || echo absent)"
[ ! -d "$SD/.triage.lock.d" ] && ok "the append lock is released" || bad "triage lock" "left behind"
beat; run UserPromptSubmit "" '{"prompt":"et aussi"}' on-user.sh
[ "$(grep -c '^prompt ' "$TP" 2>/dev/null)" = 2 ] && [ "$(sort -u "$TP" | wc -l | tr -d ' ')" = 2 ] \
    && ok "a second message before the first is filed adds its own line" || bad "two prompts" "$(cat "$TP")"
beat; bash_cmd 'ls';                                                  expect_rc "two messages unfiled: acting is refused" 2
printf '%s' "$ERR" | grep -q 'file these 2 messages' && printf '%s' "$ERR" | grep -q 'each needs its own gesture' \
    && printf '%s' "$ERR" | grep -q 'task_update(id, description=…)' && ok "the refusal counts the messages and names both gestures" || bad "two messages text" "$ERR"
# The mod dropped the first line (one task_create): one message left
sed -i.bak 1d "$TP" && rm -f "$TP.bak"
beat; bash_cmd 'ls';                                                  expect_rc "acting before triage is refused" 2
printf '%s' "$ERR" | grep -q 'TRIAGE FIRST — file this message' && ok "the refusal says to triage first" || bad "triage message" "$ERR"
printf '%s' "$ERR" | grep -q 'a question → task_create(epic=0)' && printf '%s' "$ERR" | grep -q 'do not lift this gate' \
    && ! printf '%s' "$ERR" | grep -q 'acknowledges' && ok "a question is filed with task_create(epic=0); task_list does not lift" || bad "question text" "$ERR"
printf '%s' "$ERR" | grep -q 'status=' && bad "prompt only: no resume line" "$ERR" || ok "a prompt alone names no resume gesture"
# The task tools pass the gate without lifting it: only the mod lifts it,
# on a call that files the message (calls.ts liftsTriage)
for t in task_list task_epic task_focus task_create; do
    beat; run PreToolUse "mcp__kodflow-hooks__$t" '{"tool_input":{}}' on-tool.sh
    [ "$RC" -eq 0 ] && [ -f "$TP" ] && ok "a PreToolUse $t passes and leaves the gate" || bad "task tool $t" "rc=$RC tp=$(cat "$TP" 2>/dev/null || echo gone)"
done
beat; bash_cmd 'ls';                                                  expect_rc "after task_list, acting is still refused" 2
run PreToolUse Read '{"tool_input":{"file_path":"/etc/hostname"}}' on-tool.sh; expect_rc "reading stays allowed" 0
run PreToolUse ToolSearch '{"tool_input":{"query":"x"}}' on-tool.sh;        expect_rc "loading tools stays allowed" 0
run PreToolUse Bash '{"tool_input":{"command":"ls"},"agent_id":"a1"}' on-tool.sh; expect_rc "a subagent is not gated" 0
beat; run PreToolUse WebSearch '{"tool_input":{"query":"x"}}' on-tool.sh;   expect_rc "a tool this script ignores is gated too" 2
# A session back with open tasks: its own cause and gesture
printf 'resume\n' > "$TP"; beat; bash_cmd 'ls';                       expect_rc "a resume cause alone holds the gate" 2
printf '%s' "$ERR" | grep -q 'settle the task list' && printf '%s' "$ERR" | grep -q 'task_update(id, status=' \
    && ! printf '%s' "$ERR" | grep -q 'file this message' && ok "resume: the refusal names task_update(status)" || bad "resume text" "$ERR"
printf 'prompt\nresume\n' > "$TP"; beat; bash_cmd 'ls'
printf '%s' "$ERR" | grep -q 'file this message' && printf '%s' "$ERR" | grep -q 'status=' \
    && ok "both causes: both gestures named" || bad "both causes" "$ERR"
: > "$TP"; beat; bash_cmd 'ls'
printf '%s' "$ERR" | grep -q 'file this message' && ok "an empty flag (the format before causes) is a prompt" || bad "empty flag" "$ERR"
# The mod removes the file with its last cause (register.ts settleTriage)
rm -f "$TP"
bash_cmd 'ls';                                                        expect_rc "acting after triage is allowed" 0
run PreToolUse WebSearch '{"tool_input":{"query":"x"}}' on-tool.sh
[ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "tools this script ignores leave at once" || bad "fast exit" "rc=$RC out=$OUT"
# The mod unloaded mid-session: nothing can lower the flag any more
: > "$TP"; stale
run PreToolUse WebSearch '{"tool_input":{"query":"x"}}' on-tool.sh
[ "$RC" -eq 0 ] && [ ! -f "$TP" ] && printf '%s' "$OUT" | jq -e '.systemMessage | test("/reload-plugins")' >/dev/null 2>&1 \
    && ok "a stale beat lifts the gate and says /reload-plugins" || bad "stale gate" "rc=$RC out=$OUT"
: > "$TP"; stale; bash_cmd 'git commit --no-verify -m "feat: x"'
expect_rc "a stale beat lifts the gate, the git guard still runs" 2
[ ! -f "$TP" ] && ok "the gate was lifted on the way" || bad "stale gate bash" "flag still there"
rm -rf "$T/home/.claude/kodflow"

echo "== UserPromptSubmit · turns the user did not type"
# Claude Code fires UserPromptSubmit for a background task finishing, for a
# message relayed from another agent and for a subagent's hand-back. The
# prompts below are the shapes those payloads really carry.
sys_turn() { run UserPromptSubmit "" "$(jq -n -c --arg p "$1" '{prompt:$p}')" on-user.sh; }
MS=$SD; mkdir -p "$MS"
printf '%s' '{"version":2,"active":{"main":1},"epics":[{"id":1,"agent":"main","title":"api-gateway","touched":9}],
  "tasks":[{"id":"1","agent":"main","epic":1,"subject":"Fix daemon","status":"in_progress"}]}' > "$MS/tasks.json"
i=0
for P in '<task-notification>
<task-id>a8b9904cf6289ba2a</task-id>
<status>completed</status>
<summary>Agent "Statusline stdin JSON fields" finished</summary>
</task-notification>' \
         '<agent-message from="ae81442cc2ac1525f">
[Subagent hand-back] The text below is the final report of a subagent this session delegated to.
Done, the PR is up.
</agent-message>' \
         '<teammate-message teammate_id="harness-papercuts" color="blue">
{"type":"idle_notification","from":"harness-papercuts"}
</teammate-message>' \
         '[SYSTEM NOTIFICATION - NOT USER INPUT]
This is an automated background-task event, NOT a message from the user.'; do
    i=$((i + 1)); shape=${P%%$'\n'*}; shape=${shape:0:28}
    rm -f "$TP"; printf '2' > "$T/tmp/sp/stop-count"
    beat; sys_turn "$P"; C=$(ctx_of)
    [ ! -f "$TP" ] && ok "$shape raises no triage gate" || bad "system turn $i" "gate raised"
    printf '%s' "$C" | grep -q TRIAGE && bad "system turn $i" "TRIAGE directive emitted: $C" || ok "$shape emits no TRIAGE directive"
    printf '%s' "$C" | grep -qF 'Epics: active #1 api-gateway 0/1, in progress #1 Fix daemon' \
        && ok "$shape still reports where things stand" || bad "system turn $i context" "$C"
    [ "$(cat "$T/tmp/sp/stop-count" 2>/dev/null)" = 2 ] \
        && ok "$shape leaves the stop-loop counter alone" || bad "system turn $i stop-count" "reset"
done
# Anchored at the start: a user writing about one of those markers is a user.
rm -f "$TP"; printf '2' > "$T/tmp/sp/stop-count"
beat; sys_turn 'pourquoi <task-notification> lève la gate ?'
[ -f "$TP" ] && ok "a user quoting a notification marker is still triaged" || bad "quoted marker" "no gate"
ctx_of | grep -q TRIAGE && ok "the quoted marker still gets the directive" || bad "quoted marker" "no directive"
[ ! -f "$T/tmp/sp/stop-count" ] && ok "a prompt the user typed resets the stop-loop counter" || bad "stop-count" "not reset"
# A Stop-hook continuation quotes the user's own pending message inside the
# brackets, so it carries user input nobody has triaged: it keeps the gate.
rm -f "$TP"; beat
sys_turn 'Stop hook feedback:
[la pastille orange est illisible sur haiku, propose deux palettes]: the user has not chosen yet.'
[ -f "$TP" ] && ok "Stop hook feedback carries user text and is still triaged" || bad "stop feedback" "no gate"
rm -rf "$T/home/.claude/kodflow"

echo "== UserPromptSubmit · the directive in the user's language"
printf '{"language":"Français"}' > "$T/home/.claude/settings.json"
beat; run UserPromptSubmit "" '{"prompt":"salut"}' on-user.sh
C=$(ctx_of)
printf '%s' "$C" | grep -q "TRIER ce message" && printf '%s' "$C" | grep -q 'Branche : feat/test' \
    && ok "French setting: the directive and the branch are in French" || bad "fr directive" "$C"
printf '%s' "$C" | grep -qF $'\e[' && bad "fr escape" "$C" || ok "no colour where the screen shows nothing"
[ "${#C}" -lt 900 ] && ok "the French context stays under 900 characters (${#C})" || bad "fr size" "${#C}"
mkdir -p "$SD"; beat; printf '%s' '{"version":2,"active":{"main":2},
  "epics":[{"id":1,"agent":"main","title":"api-gateway","touched":5},{"id":2,"agent":"main","title":"SDK status-line","touched":9}],
  "tasks":[{"id":"1","agent":"main","epic":1,"subject":"Fix daemon","status":"pending"},
           {"id":"3","agent":"main","epic":2,"subject":"Freeze golden renders now","status":"in_progress"},
           {"id":"5","agent":"main","epic":0,"subject":"Loose","status":"pending"}]}' > "$SD/tasks.json"
run UserPromptSubmit "" '{"prompt":"salut"}' on-user.sh; C=$(ctx_of)
printf '%s' "$C" | grep -qF 'Épiques : active #2 SDK status-line 0/1, en cours #3 Freeze golden renders now · autres ouvertes : #1 api-gateway 0/1 · sans épique : 1 tâche(s) ouverte(s)' \
    && ok "the epic state in French" || bad "fr epics" "$C"
[ "${#C}" -lt 1000 ] && ok "with the epic state, French, under 1000 characters (${#C})" || bad "fr size state" "${#C}"
rm -f "$T/home/.claude/settings.json" "$SD/tasks.json" "$SD/triage-pending"

echo "== Stop · a message the turn never filed"
SDS=$SD; mkdir -p "$SDS"; rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/turn-system"
triage_stop() { rm -f "$T/tmp/sp/stop-count"; run Stop "" '{"stop_hook_active":false}' on-stop.sh
    TC=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null); }
beat; run UserPromptSubmit "" '{"prompt":"une question ?"}' on-user.sh
triage_stop
printf '%s' "$TC" | grep -q 'Message with no task' && printf '%s' "$TC" | grep -q 'task_create' \
    && ok "a turn that ends with its message unfiled is reminded" || bad "stop triage" "$OUT"
triage_stop
printf '%s' "$TC" | grep -q 'Message with no task' && bad "stop triage repeat" "$OUT" || ok "the same unfiled message is not reminded twice in a row"
beat; run UserPromptSubmit "" '{"prompt":"et une autre"}' on-user.sh; triage_stop
printf '%s' "$TC" | grep -q '2 messages with no task' && printf '%s' "$TC" | grep -q 'task_update(id, description)' \
    && ok "two messages unfiled: the reminder counts them" || bad "stop two messages" "$OUT"
printf 'resume\n' > "$TP"; triage_stop
printf '%s' "$TC" | grep -q 'Tasks left open at the session start' && ! printf '%s' "$TC" | grep -q 'with no task' \
    && ok "a resume left unsettled names task_update(status) alone" || bad "stop resume" "$OUT"
beat; run UserPromptSubmit "" '{"prompt":"<task-notification>\n<status>completed</status>\n</task-notification>"}' on-user.sh
[ -f "$T/tmp/sp/turn-system" ] && ok "a system turn is marked for the Stop hook" || bad "turn-system" "absent"
printf 'prompt\n' > "$TP"; triage_stop
printf '%s' "$TC" | grep -q 'Message with no task' && bad "stop on a system turn" "$OUT" || ok "no triage reminder at the end of a system turn"
beat; run UserPromptSubmit "" '{"prompt":"merci"}' on-user.sh
[ ! -f "$T/tmp/sp/turn-system" ] && ok "a typed prompt clears the system-turn mark" || bad "turn-system kept" "present"
rm -f "$TP"; triage_stop
printf '%s' "$TC" | grep -q 'with no task\|session start' && bad "stop filed" "$OUT" || ok "a filed message is not reminded"
rm -rf "$T/home/.claude/kodflow" "$T/tmp/sp/stop-count" "$T/tmp/sp/stop-said"

echo "== SessionStart · review the task list left open"
RS=$SD; mkdir -p "$RS"; rm -f "$TP"; beat
printf '%s' '{"version":2,"epics":[{"id":1,"agent":"main","title":"SDK"}],"active":{"main":1},"tasks":[
  {"id":"1","agent":"main","epic":1,"subject":"Stale work","status":"in_progress"},
  {"id":"2","agent":"main","epic":1,"subject":"Done work","status":"completed"},
  {"id":"3","agent":"main","epic":0,"subject":"Loose","status":"pending"},
  {"id":"4","agent":"a1","epic":0,"subject":"Sub","status":"pending"}]}' > "$RS/tasks.json"
run SessionStart "" '{"source":"resume"}' on-session.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("SESSION START") and test("#1 \\[in_progress\\] Stale work") and test("#3 \\[pending\\] Loose") and (test("Done work") | not) and (test("Sub") | not)' >/dev/null 2>&1 \
    && ok "resume lists the main agent's open tasks, finished and subagent ones left out" || bad "session review" "$OUT"
[ -f "$TP" ] && ok "resume holds acting tools until the list is reviewed" || bad "review gate" "flag absent"
beat; run UserPromptSubmit "" '{"prompt":"reprends"}' on-user.sh
[ "$(sed -n 1p "$TP" 2>/dev/null)" = resume ] && sed -n 2p "$TP" | grep -q '^prompt ' && [ "$(wc -l < "$TP" | tr -d ' ')" = 2 ] \
    && ok "a prompt after a resume adds its cause beside it" || bad "resume then prompt" "$(cat "$TP" 2>/dev/null)"
rm -f "$TP"
beat; run SessionStart "" '{"source":"compact"}' on-session.sh
[ "$(printf '%s\n' "$OUT" | grep -c '^{')" -eq 1 ] && printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("SESSION START") and test("POST-COMPACTION")' >/dev/null 2>&1 \
    && ok "compact: review and standing rules in one document" || bad "compact review" "$OUT"
printf '%s' '{"version":2,"epics":[],"active":{},"tasks":[{"id":"1","agent":"main","epic":0,"subject":"x","status":"completed"}]}' > "$RS/tasks.json"
rm -f "$TP"; beat; run SessionStart "" '{"source":"resume"}' on-session.sh
[ ! -f "$TP" ] && ! printf '%s' "$OUT" | grep -q 'SESSION START' && ok "nothing open: no review, no gate" || bad "empty review" "$OUT"
printf '%s' '{"tasks":' > "$RS/tasks.json"
run SessionStart "" '{"source":"resume"}' on-session.sh; expect_rc "a malformed task file fails open" 0
printf '%s' '{"version":2,"epics":[],"active":{},"tasks":[{"id":"1","agent":"main","epic":0,"subject":"Open","status":"pending"}]}' > "$RS/tasks.json"
nobeat; run SessionStart "" '{"source":"resume"}' on-session.sh
[ ! -f "$TP" ] && ! printf '%s' "$OUT" | grep -q 'SESSION START' && ok "no mod: no review sent to tools that do not exist, no gate" || bad "review without mod" "$OUT"
rm -rf "$RS"

echo "== UserPromptSubmit / SessionStart / agents"
run UserPromptSubmit "" '{"prompt":"hi"}' on-user.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("feat/test")' >/dev/null 2>&1 && ok "branch injected with the prompt" || bad "prompt context" "$OUT"
run SessionStart "" '{"source":"compact"}' on-session.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("POST-COMPACTION")' >/dev/null 2>&1 && ok "post-compaction rules injected" || bad "compact context" "$OUT"
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("refused: use --force-with-lease") and (test("rtk rewrites") | not)' >/dev/null 2>&1 \
    && ok "post-compaction text: forced push refused, no rtk rewrite claimed" || bad "compact text" "$OUT"
run SessionStart "" '{"source":"startup"}' on-session.sh
expect_rc "startup exits 0" 0
printf '%s' "$OUT" | jq -e '.systemMessage' >/dev/null 2>&1 && bad "no warning on a clean setup" "$OUT" || ok "a clean setup raises no guard warning"

echo "== SessionStart · what can switch the guards off"
mkdir -p "$CLAUDE_CONFIG_DIR"
printf '{"disableAllHooks":true}' > "$CLAUDE_CONFIG_DIR/settings.local.json"
run SessionStart "" '{"source":"startup"}' on-session.sh
printf '%s' "$OUT" | jq -e '(.systemMessage | test("disableAllHooks")) and (.hookSpecificOutput.additionalContext | test("disableAllHooks"))' >/dev/null 2>&1 \
    && ok "disableAllHooks is reported to the user and to Claude" || bad "disableAllHooks" "$OUT"
rm -f "$CLAUDE_CONFIG_DIR/settings.local.json"
OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-1",hook_event_name:"SessionStart",source:"startup",cwd:$cwd,scratchpad_dir:$sp}' \
    | CLAUDE_CODE_PLUGIN_DIRS=$T/pdirs bash "$S/on-session.sh" 2>/dev/null)
printf '%s' "$OUT" | jq -e '.systemMessage | test("CLAUDE_CODE_PLUGIN_DIRS")' >/dev/null 2>&1 && ok "CLAUDE_CODE_PLUGIN_DIRS is reported" || bad "plugin dirs" "$OUT"
PC=$CLAUDE_CONFIG_DIR/plugins/cache
mkdir -p "$PC/other/modder/1.0/hooks" "$PC/kodflow/kodflow-hooks/9/hooks" "$PC/other/quiet/1.0/hooks" "$CLAUDE_CONFIG_DIR/skills/s/hooks"
printf '{"modules":["./mod/register.ts"]}' > "$PC/other/modder/1.0/hooks/hooks.json"
printf '{"modules":["./mod/register.ts"]}' > "$PC/kodflow/kodflow-hooks/9/hooks/hooks.json"
printf '{"hooks":{}}' > "$PC/other/quiet/1.0/hooks/hooks.json"
printf '{"modules":["./x.ts"]}' > "$CLAUDE_CONFIG_DIR/skills/s/hooks/hooks.json"
run SessionStart "" '{"source":"startup"}' on-session.sh
printf '%s' "$OUT" | jq -e '.systemMessage | test("other/modder") and test("skills/s/hooks") and (test("cache/kodflow") | not) and (test("quiet") | not)' >/dev/null 2>&1 \
    && ok "modules outside kodflow are reported, kodflow's and plain hooks are not" || bad "foreign modules" "$OUT"
printf '{"enabledPlugins":{"quiet@other":true}}' > "$CLAUDE_CONFIG_DIR/settings.json"
run SessionStart "" '{"source":"startup"}' on-session.sh
printf '%s' "$OUT" | jq -e '.systemMessage | test("other/modder") | not' >/dev/null 2>&1 \
    && ok "a plugin that is not enabled is not reported" || bad "enabled filter" "$OUT"
rm -rf "$CLAUDE_CONFIG_DIR/plugins" "$CLAUDE_CONFIG_DIR/skills" "$CLAUDE_CONFIG_DIR/settings.json"

echo "== SessionStart · guards checked against their fingerprints (D8)"
# A copy of the plugin's hooks stands for the installed one.
CP=$T/installed/hooks; mkdir -p "$T/installed"; cp -R "$ROOT/plugins/kodflow-hooks/hooks" "$CP"
start_copy() { OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-1",hook_event_name:"SessionStart",source:"startup",cwd:$cwd,scratchpad_dir:$sp}' \
    | bash "$CP/scripts/on-session.sh" 2>/dev/null); }
start_copy
{ [ -z "$OUT" ] || printf '%s' "$OUT" | jq -e '.systemMessage // "" | test("fingerprint") | not' >/dev/null 2>&1; } \
    && ok "an untouched copy matches its fingerprints" || bad "fingerprint clean" "$OUT"
printf '\n# edited\n' >> "$CP/scripts/on-tool.sh"; start_copy
printf '%s' "$OUT" | jq -e '(.systemMessage | test("scripts/on-tool.sh differs from its published fingerprint")) and (.hookSpecificOutput.additionalContext | test("on-tool.sh differs"))' >/dev/null 2>&1 \
    && ok "an edited on-tool.sh raises a visible warning" || bad "fingerprint edited" "$OUT"
cp "$ROOT/plugins/kodflow-hooks/hooks/scripts/on-tool.sh" "$CP/scripts/on-tool.sh"
MK=$CLAUDE_CONFIG_DIR/plugins/marketplaces/kodflow/plugins/kodflow-hooks/hooks; mkdir -p "$MK"
cp "$CP/fingerprints.sha256" "$MK/"; start_copy
{ [ -z "$OUT" ] || printf '%s' "$OUT" | jq -e '.systemMessage // "" | test("marketplace") | not' >/dev/null 2>&1; } \
    && ok "the same fingerprints as the marketplace: silent" || bad "marketplace same" "$OUT"
printf '0000  scripts/on-tool.sh\n' > "$MK/fingerprints.sha256"; start_copy
printf '%s' "$OUT" | jq -e '.systemMessage | test("differ from the marketplace copy")' >/dev/null 2>&1 \
    && ok "fingerprints that differ from the marketplace are reported" || bad "marketplace differs" "$OUT"
rm -f "$CP/fingerprints.sha256"; start_copy
printf '%s' "$OUT" | jq -e '.systemMessage | test("fingerprints.sha256 is missing")' >/dev/null 2>&1 \
    && ok "a missing fingerprint file is reported" || bad "fingerprint missing" "$OUT"
rm -rf "$CLAUDE_CONFIG_DIR/plugins" "$T/installed"
run SubagentStart "" '{"agent_type":"Explore"}' on-agent.sh
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("Subagent context")' >/dev/null 2>&1 && ok "subagent rules injected" || bad "subagent context" "$OUT"
run SubagentStop "" '{"agent_type":"Explore","stop_hook_active":true}' on-agent.sh
[ -z "$OUT" ] && ok "SubagentStop with stop_hook_active is silent" || bad "subagent stop" "$OUT"
run SessionEnd "" '{"reason":"other"}' on-session.sh;   expect_rc "SessionEnd exits 0" 0
run Notification "" '{"notification_type":"permission_prompt","message":"x"}' on-user.sh
printf '%s' "$OUT" | jq -e '.terminalSequence' >/dev/null 2>&1 && ok "permission prompt rings the bell" || bad "notification bell" "$OUT"
run Notification "" '{"notification_type":"auth_success","message":"x"}' on-user.sh
[ -z "$OUT" ] && ok "other notifications stay silent" || bad "notification silent" "$OUT"

echo "== ktn-linter · at PostToolUse, on the Go file just edited (#75)"
# A fake ktn-linter answers --version, logs every run and prints lint.json
# with the exit code in lint.rc (lint.sleep: that many seconds first); a fake
# curl and a listener on the old daemon port prove no hook dials a daemon
# (kodflow/ktn-linter#771).
FB=$T/fakebin; mkdir -p "$FB"; LL=$T/linter.log; : > "$LL"
cat > "$FB/ktn-linter" <<STUB
#!/bin/sh
[ "\$1" = --version ] && { echo "ktn-linter version 9.9.9"; exit 0; }
echo "ktn-linter \$(pwd) \$*" >> "$LL"
[ -f "$T/lint.sleep" ] && sleep "\$(cat "$T/lint.sleep")"
echo "stderr noise" >&2
cat "$T/lint.json" 2>/dev/null
exit "\$(cat "$T/lint.rc" 2>/dev/null || echo 0)"
STUB
printf '#!/bin/sh\necho "curl $*" >> "%s"\necho "{}"\n' "$LL" > "$FB/curl"
chmod +x "$FB/ktn-linter" "$FB/curl"
LP=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])' 2>/dev/null)
python3 -c 'import socket,sys,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(64); time.sleep(60)' "$LP" &
LPID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do (exec 3<>"/dev/tcp/127.0.0.1/$LP") 2>/dev/null && break; sleep 0.2; done
lrun() { local ev=$1 tool=$2 frag=$3 script=$4
    OUT=$(jq -n -c --arg ev "$ev" --arg tool "$tool" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" --argjson frag "$frag" \
        '{session_id:"sess-1",hook_event_name:$ev,tool_name:$tool,cwd:$cwd,scratchpad_dir:$sp,tool_use_id:"t1"} + $frag' \
        | PATH="${LPATH:-$FB:$PATH}" KTN_LINTER_PORT=$LP "${HOOK_SHELL:-bash}" "$S/$script" 2>/dev/null); RC=$?; }
lctx() { printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }
# A triage gate left raised by an earlier case would refuse the edit first
rm -f "$T/home/.claude/kodflow/sessions/sess-1/triage-pending"
# on-tool.sh skips files under /tmp, where mktemp puts $T on Linux: the
# cases get a project of their own inside the checkout.
PP=$(mktemp -d "$ROOT/.kf-gomod.XXXXXX"); GM=$PP/projects/app
mkdir -p "$GM/cmd/x" "$PP/tools"; printf 'module app\n' > "$GM/go.mod"
printf 'package main\n' > "$GM/cmd/x/main.go"; printf 'package main\n' > "$GM/cmd/x/other.go"; printf 'x\n' > "$PP/tools/gen.go"
: > "$LL"; CLAUDE_PROJECT_DIR=$PP lrun PreToolUse Edit "$(jq -n -c --arg f "$GM/cmd/x/main.go" '{tool_input:{file_path:$f,old_string:"x",new_string:"y"}}')" on-tool.sh
[ ! -s "$LL" ] && [ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "pre-edit: nothing is linted before the edit" || bad "pre-edit module" "rc=$RC out=$OUT log=$(cat "$LL")"
# lint.json: two findings of main.go (lines A, B) and one of other.go
ljson() { jq -n -c --arg m "$GM/cmd/x/main.go" --arg o "$GM/cmd/x/other.go" --argjson a "$1" --argjson b "$2" --arg extra "${3:-}" \
    '{results: ([{ruleId:"KTN-CONST-TYPED",level:"warning",message:"constant X needs explicit type",location:{file:$m,line:$a,column:7}},
                 {ruleId:"KTN-FUNC-UNUSEDARG",level:"info",message:"parameter a unused",location:{file:$m,line:$b,column:8}},
                 {ruleId:"KTN-OTHER",level:"warning",message:"elsewhere",location:{file:$o,line:1,column:1}}]
                + (if $extra == "" then [] else [{ruleId:$extra,level:"error",message:"new one",location:{file:$m,line:9,column:1}}] end))}' > "$T/lint.json"; }
ledit() { : > "$LL"; CLAUDE_PROJECT_DIR=$PP lrun PostToolUse "${2:-Edit}" "$(jq -n -c --arg f "$1" '{tool_input:{file_path:$f,old_string:"x",new_string:"y"}}')" on-tool.sh; }
ljson 3 5; printf '1\n' > "$T/lint.rc"; rm -rf "$T/tmp/sp/lint-file" "$T/tmp/sp/lint-policy-told"
mkdir -p "$PP-out/cmd/x"; printf 'module out\n' > "$PP-out/go.mod"; printf 'package main\n' > "$PP-out/cmd/x/main.go"
ledit "$PP/../${PP##*/}-out/cmd/x/main.go"
[ ! -s "$LL" ] && ok "post-edit: a path whose .. leads out of the project is not linted" || bad "post dotdot" "$(cat "$LL")"
rm -rf "$PP-out"
ledit "$PP/tools/gen.go"
[ ! -s "$LL" ] && ! lctx | grep -q ktn-linter && ok "post-edit: a file outside any Go project is not linted" || bad "post outside" "$(cat "$LL") $OUT"
ledit "$GM/cmd/x/main.go"
grep -qx "ktn-linter $GM run --json --no-color ./cmd/x" "$LL" && ! grep -q '^curl ' "$LL" \
    && ok "post-edit: ktn-linter run on the file's package, from its module, no daemon dialled" || bad "post run" "$(cat "$LL")"
C=$(lctx)
case "$C" in *"ktn-linter 9.9.9: 2 finding(s) in projects/app/cmd/x/main.go after this edit:"*"projects/app/cmd/x/main.go:3:7 KTN-CONST-TYPED (warning) constant X needs explicit type"*"main.go:5:8 KTN-FUNC-UNUSEDARG"*)
    ok "post-edit: the edited file's findings, with file:line, rule and version" ;; *) bad "post findings" "$C" ;; esac
case "$C" in *KTN-OTHER*|*"stderr noise"*) bad "post filter" "$C" ;; *) ok "post-edit: another file's findings and the CLI's stderr are left out" ;; esac
case "$C" in *"Fix each finding now, in this change."*"heavy refactor is still a fix, not a false positive and not a reason to skip it"*"never skip a finding silently"*"certain a finding is a false positive: open a complete issue on kodflow/ktn-linter (the rule ID, a minimal reproduction, file:line, the expected and the actual result, the ktn-linter version), then go on."*)
    ok "post-edit: the instruction (fix now, heavy is not false, an issue only when certain)" ;; *) bad "post policy" "$C" ;; esac
ledit "$GM/cmd/x/main.go"
[ -s "$LL" ] && ! lctx | grep -q ktn-linter && ok "post-edit: the same findings again are not repeated" || bad "post dedupe" "$(cat "$LL") $OUT"
ljson 4 6; ledit "$GM/cmd/x/main.go"
! lctx | grep -q ktn-linter && ok "post-edit: findings only moved by the edit stay quiet" || bad "post moved" "$OUT"
ljson 4 6 KTN-NEW-RULE; ledit "$GM/cmd/x/main.go"
lctx | grep -q 'main.go:9:1 KTN-NEW-RULE (error) new one' && ok "post-edit: a changed set is reported" || bad "post changed" "$OUT"
printf '0\n' > "$T/lint.rc"; printf '{"results":[]}\n' > "$T/lint.json"; ledit "$GM/cmd/x/main.go"
[ -z "$(lctx)" ] && ok "post-edit: a clean file is silent" || bad "post clean" "$OUT"
ljson 4 6 KTN-NEW-RULE; printf '1\n' > "$T/lint.rc"; ledit "$GM/cmd/x/main.go"
lctx | grep -q KTN-NEW-RULE && ok "post-edit: after a clean run the same findings are a regression, reported" || bad "post regression" "$OUT"
ljson 3 5; ledit "$GM/cmd/x/main.go" Write
lctx | grep -q 'main.go:3:7 KTN-CONST-TYPED' && ok "post-edit: a Write is linted like an Edit" || bad "post write" "$OUT"
for rc in 42 3; do
    ljson 1 2 KTN-RC-$rc; printf '%s\n' "$rc" > "$T/lint.rc"; ledit "$GM/cmd/x/main.go"
    [ -s "$LL" ] && [ "$RC" -eq 0 ] && [ -z "$(lctx)" ] && ok "post-edit: exit $rc is silent and fails open" || bad "post rc $rc" "rc=$RC $OUT"
done
printf '1\n' > "$T/lint.rc"; jq -n -c --arg o "$GM/cmd/x/other.go" '{results:[{ruleId:"KTN-OTHER",level:"warning",message:"elsewhere",location:{file:$o,line:1,column:1}}]}' > "$T/lint.json"
ledit "$GM/cmd/x/main.go"
[ -z "$(lctx)" ] && ok "post-edit: findings of other files only: silent" || bad "post others only" "$OUT"
# Bounded: a run past KF_LINT_TIMEOUT is cut, with timeout(1) and without
mkdir -p "$T/nokt"
for t in bash jq cat sort grep head tail cut awk date cksum mkdir touch rm mv wc tr sed flock dirname env sleep kill; do
    p=$(command -v "$t" 2>/dev/null) && ln -sf "$p" "$T/nokt/$t"
done
ln -sf "$FB/ktn-linter" "$T/nokt/ktn-linter"; printf '5\n' > "$T/lint.sleep"; ljson 1 2 KTN-SLOW
for lp in "$FB:$PATH" "$T/nokt"; do
    t0=$(date +%s); LPATH=$lp KF_LINT_TIMEOUT=1 ledit "$GM/cmd/x/main.go"; t1=$(date +%s)
    [ $((t1 - t0)) -lt 4 ] && [ "$RC" -eq 0 ] && [ -z "$(lctx)" ] && ok "post-edit: a slow run is cut and silent ($( [ "$lp" = "$T/nokt" ] && echo 'no timeout(1)' || echo 'timeout(1) if present'))" || bad "post timeout $lp" "$((t1 - t0)) s, $OUT"
done
rm -f "$T/lint.sleep"; rm -rf "$T/nokt"
ljson 3 5 KTN-OFF; : > "$LL"
KODFLOW_LINT=off CLAUDE_PROJECT_DIR=$PP lrun PostToolUse Edit "$(jq -n -c --arg f "$GM/cmd/x/main.go" '{tool_input:{file_path:$f,old_string:"x",new_string:"y"}}')" on-tool.sh
[ ! -s "$LL" ] && [ -z "$(lctx)" ] && ok "post-edit: KODFLOW_LINT=off runs nothing and says nothing" || bad "post off" "$(cat "$LL") $OUT"
# ktn-linter's own PostToolUse hook installed: nothing run here, the
# instruction once per session for the findings that hook reports
printf '{"hooks":{"PostToolUse":[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"\\"/opt/k/ktn-hook\\" claude PostToolUse"}]}]}}' > "$CLAUDE_CONFIG_DIR/settings.json"
ledit "$GM/cmd/x/main.go"; C=$(lctx)
[ ! -s "$LL" ] && case "$C" in *"own PostToolUse hook reports the findings of each Go edit"*"Fix each finding now"*"kodflow/ktn-linter"*) true ;; *) false ;; esac \
    && ok "post-edit: beside ktn-linter's own hook, no second run, the instruction instead" || bad "post owned" "$(cat "$LL") $C"
ledit "$GM/cmd/x/main.go"
[ ! -s "$LL" ] && [ -z "$(lctx)" ] && ok "post-edit: that instruction is given once per session" || bad "post owned once" "$OUT"
mkdir -p "$PP/.claude"; mv "$CLAUDE_CONFIG_DIR/settings.json" "$PP/.claude/settings.local.json"
ledit "$GM/cmd/x/main.go"
[ ! -s "$LL" ] && ok "post-edit: a ktn-hook in the project's settings counts as installed too" || bad "post owned project" "$(cat "$LL")"
printf '{"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/opt/k/ktn-hook"}]}]}}' > "$PP/.claude/settings.local.json"
rm -rf "$T/tmp/sp/lint-file"; ledit "$GM/cmd/x/main.go"
[ -s "$LL" ] && lctx | grep -q 'KTN-CONST-TYPED' && ok "post-edit: a ktn-hook whose matcher does not take the tool lints nothing: the run happens here" || bad "post owned matcher" "$(cat "$LL") $OUT"
rm -f "$PP/.claude/settings.local.json" "$T/tmp/sp/lint-policy-told"
# Stop runs no linter any more
printf '%s\n' "$GM/cmd/x/main.go" > "$T/tmp/sp/edited"; rm -f "$T/tmp/sp/stop-count"; : > "$LL"
CLAUDE_PROJECT_DIR=$PP lrun Stop "" '{"stop_hook_active":false}' on-stop.sh
[ ! -s "$LL" ] && ! lctx | grep -q ktn-linter && ok "stop: no linter run at turn end" || bad "stop lint" "$(cat "$LL") $OUT"
kill "$LPID" 2>/dev/null; wait "$LPID" 2>/dev/null
rm -rf "$PP" "$FB" "$T/lint.json" "$T/lint.rc" "$T/tmp/sp/lint-file" "$T/tmp/sp/lint-policy-told"
: > "$T/tmp/sp/edited"; rm -f "$T/tmp/sp/stop-count" "$T/tmp/sp/claudemd-nudged"

echo "== malformed input never blocks"
for s in on-tool.sh on-session.sh on-user.sh on-agent.sh on-stop.sh; do
    printf 'not json' | bash "$S/$s" >/dev/null 2>&1; r1=$?
    printf '' | bash "$S/$s" >/dev/null 2>&1; r2=$?
    [ "$r1" -eq 0 ] && [ "$r2" -eq 0 ] && ok "$s fails open" || bad "$s fail-open" "rc=$r1/$r2"
done

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
