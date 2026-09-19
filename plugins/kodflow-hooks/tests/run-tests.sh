#!/bin/bash
# run-tests.sh — the root discipline: root decides and dispatches, subagents
# mutate. Every case feeds on-tool.sh the JSON the harness would send and
# asserts on the exit code, the one channel the gate answers on.
#
# The distinction under test is a single field: a PreToolUse payload carries
# agent_id only when the call comes from inside a subagent. A payload without
# one is the main thread — root — and root may read but not write.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp
mkdir -p "$T/repo" "$T/home" "$T/tmp" "$T/tmp/sp"
cd "$T" || exit 1
git -C "$T/repo" init -q -b feat/root
git -C "$T/repo" config user.email t@example.invalid; git -C "$T/repo" config user.name t
printf 'x\n' > "$T/repo/a.txt"; git -C "$T/repo" add a.txt; git -C "$T/repo" commit -qm "chore: seed"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

# payload TOOL INPUT-fragment [EXTRA-fragment] → the JSON the harness sends
payload() {
    jq -n -c --arg tool "$1" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" \
        --argjson ti "$2" --argjson extra "${3:-{\}}" \
        '{session_id:"sess-root",hook_event_name:"PreToolUse",tool_name:$tool,cwd:$cwd,scratchpad_dir:$sp,tool_use_id:"t1",tool_input:$ti} + $extra'
}
# run JSON [ENV-assignment...] → sets RC, ERR
run() { local json=$1; shift; ERR=$(printf '%s' "$json" | env "$@" bash "$S/on-tool.sh" 2>&1 >/dev/null); RC=$?; }
expect_rc() { [ "$RC" -eq "$2" ] && ok "$1" || bad "$1" "rc=$RC err=${ERR:0:200}"; }

cmd()  { payload Bash "$(jq -n -c --arg c "$1" '{command:$c}')" "${2:-}"; }
file() { payload "${2:-Write}" "$(jq -n -c --arg f "$1" '{file_path:$f,content:"x"}')" "${3:-}"; }
AGENT='{"agent_id":"agt_01","agent_type":"general-purpose"}'
SRC=$T/repo/src/main.rs

echo "== the main thread may not mutate"
run "$(file "$SRC")";                                       expect_rc "main-thread Write denied" 2
run "$(file "$SRC" Edit)";                                  expect_rc "main-thread Edit denied" 2
run "$(file "$SRC" MultiEdit)";                             expect_rc "main-thread MultiEdit denied" 2
# NotebookEdit carries notebook_path, not file_path: a gate placed after the
# file_path test would never see one.
run "$(payload NotebookEdit '{"notebook_path":"/tmp/n.ipynb"}')"
expect_rc "main-thread NotebookEdit denied" 2

echo "== a subagent may"
run "$(file "$SRC" Write "$AGENT")";                        expect_rc "the same Write carrying agent_id allowed" 0
run "$(cmd 'npm install' "$AGENT")";                        expect_rc "a mutating command from a subagent allowed" 0

echo "== the denial says what to do about it"
run "$(file "$SRC")"
printf '%s' "$ERR" | grep -q 'subagent'         && ok "the reason names the subagent"         || bad "reason: subagent" "$ERR"
printf '%s' "$ERR" | grep -q 'line numbers'     && ok "the reason demands the brief's facts"  || bad "reason: brief" "$ERR"
printf '%s' "$ERR" | grep -q 'scratchpad'       && ok "the reason names the return contract"  || bad "reason: return" "$ERR"
printf '%s' "$ERR" | grep -q 'KODFLOW_ROOT=off' && ok "the reason names the escape hatch"     || bad "reason: hatch" "$ERR"

echo "== reading is not mutating"
for c in 'git status' 'git log --oneline -5' 'git diff HEAD' 'git rev-parse HEAD' \
         'git config --get user.email' 'git branch' 'git remote -v' 'git ls-files' \
         'ls -la' 'cat a.txt' 'sed -n 1,5p a.txt' 'rg -n pattern .' \
         'cat a.txt | grep x | head -3' 'find . -name "*.sh"' 'jq . a.json' 'gh pr view 12'; do
    run "$(cmd "$c")"; expect_rc "allowed: $c" 0
done

echo "== writing is, whatever it looks like"
for c in 'npm install' 'git push origin main' 'rm -rf build' 'mkdir -p x' \
         'sed -i s/a/b/ a.txt' 'git branch -D old' 'gh pr merge 12' \
         'find . -name "*.tmp" -delete' 'python3 setup.py install' 'chmod +x run.sh'; do
    run "$(cmd "$c")"; expect_rc "denied: $c" 2
done

echo "== one mutating segment condemns the line"
run "$(cmd 'echo x > f')";                          expect_rc "redirection denied" 2
run "$(cmd 'ls -la >> log.txt')";                   expect_rc "appending redirection denied" 2
run "$(cmd 'ls | tee out.txt')";                    expect_rc "tee denied" 2
run "$(cmd 'cat a.txt && sed -i s/a/b/ a.txt')";    expect_rc "a mutating segment after && denied" 2
run "$(cmd 'git status; rm -f a.txt')";             expect_rc "a mutating segment after ; denied" 2
run "$(cmd 'cat a.txt | grep x')";                  expect_rc "an all-reading pipeline allowed" 0

echo "== the escape hatches"
run "$(cmd 'ROOT_OK=1 npm install')";               expect_rc "ROOT_OK=1 opts the line out" 0
run "$(cmd 'ROOT_OK=1 echo x > f')";                expect_rc "ROOT_OK=1 covers a redirection too" 0
run "$(cmd 'npm install')" KODFLOW_ROOT=off;        expect_rc "KODFLOW_ROOT=off disables the session" 0
run "$(file "$SRC")" KODFLOW_ROOT=off;              expect_rc "KODFLOW_ROOT=off covers the edit tools" 0
run "$(cmd 'npm install' '{"permission_mode":"plan"}')"
expect_rc "plan mode is untouched" 0
run "$(file "$SRC" Write '{"permission_mode":"plan"}')"
expect_rc "plan mode is untouched for the edit tools" 0

echo "== the gate fails open"
printf 'not json' | bash "$S/on-tool.sh" >/dev/null 2>&1
[ $? -eq 0 ] && ok "a malformed payload exits 0 and allows" || bad "malformed payload" "it did not exit 0"
printf '' | bash "$S/on-tool.sh" >/dev/null 2>&1
[ $? -eq 0 ] && ok "an empty payload exits 0 and allows" || bad "empty payload" "it did not exit 0"
run "$(payload Bash '{}')";                         expect_rc "a Bash call with no command allowed" 0
# Without jq the hook cannot read the payload, so it must not judge it. bash is
# named absolutely: an empty PATH would otherwise fail to find the shell itself.
printf '%s' "$(file "$SRC")" | env PATH=/nonexistent /bin/bash "$S/on-tool.sh" >/dev/null 2>&1
[ $? -eq 0 ] && ok "no jq on PATH fails open" || bad "no jq" "it did not exit 0"

echo "== the edges of the payload"
# A well-formed payload naming no tool is not this hook's business: the dispatch
# falls through to the logging arm. The gate must never infer a tool from the
# shape of tool_input — there is a mutating command sitting in every one of these.
bare() { jq -n -c --arg cwd "$T/repo" --argjson f "$1" '{session_id:"sess-root",hook_event_name:"PreToolUse",cwd:$cwd,tool_input:{command:"rm -rf build"}} + $f'; }
run "$(bare '{}')";                   expect_rc "no tool_name at all exits 0" 0
run "$(bare '{"tool_name":null}')";   expect_rc "a null tool_name exits 0" 0
run "$(bare '{"tool_name":""}')";     expect_rc "an empty tool_name exits 0" 0
run "$(jq -n -c --arg cwd "$T/repo" '{session_id:"sess-root",cwd:$cwd,tool_input:{command:"rm -rf build"}}')"
expect_rc "no hook_event_name either exits 0" 0
# Only PreToolUse can stop anything; the gate must not reach a completed call.
run "$(jq -n -c --arg cwd "$T/repo" '{session_id:"sess-root",hook_event_name:"PostToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:"npm install"}}')"
expect_rc "a mutating PostToolUse is out of scope" 0

# agent_id present but empty is still the main thread. jq's // substitutes only
# on null, so "" survives as "" and must read as root, not as a subagent.
EMPTY='{"agent_id":""}'
run "$(file "$SRC" Write "$EMPTY")";  expect_rc "an empty agent_id is the main thread (Write denied)" 2
run "$(cmd 'npm install' "$EMPTY")";  expect_rc "an empty agent_id is the main thread (Bash denied)" 2
run "$(cmd 'git status' "$EMPTY")";   expect_rc "an empty agent_id still reads freely" 0
run "$(file "$SRC" Write '{"agent_id":null}')"
expect_rc "a null agent_id is the main thread" 2

echo "== the cost of the discipline is countable"
L=$T/repo/.claude/logs/feat_root/session.jsonl
# Every case above logged too, and the writes are detached: let them land, then
# start from an empty file so the counts below are this section's alone.
sleep 0.6; rm -f "$L"
run "$(file "$SRC")"
run "$(cmd 'npm install')"
run "$(jq -n -c --arg cwd "$T/repo" '{session_id:"sess-root",hook_event_name:"PostToolUse",tool_name:"Agent",cwd:$cwd,tool_input:{description:"port the guard",subagent_type:"general-purpose"}}')"
sleep 0.6
[ "$(grep -c '"root_guard":"deny"' "$L" 2>/dev/null)" = 2 ] \
    && ok "each denial is one tagged line in the existing log" || bad "deny count" "$(grep -c root_guard "$L" 2>/dev/null)"
[ "$(grep -c '"root_guard":"dispatch"' "$L" 2>/dev/null)" = 1 ] \
    && ok "each dispatch is one tagged line in the same log" || bad "dispatch count" "$(tail -1 "$L" 2>/dev/null)"
# The tag is the only addition: an event nobody tagged must stay untagged.
run "$(cmd 'git status')"; sleep 0.4
tail -1 "$L" | grep -q root_guard && bad "an allowed call must carry no tag" "$(tail -1 "$L")" \
    || ok "an allowed call carries no tag"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
