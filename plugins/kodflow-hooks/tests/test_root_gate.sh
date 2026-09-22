#!/bin/bash
# test_root_gate.sh — the reviewer gate: the main thread triages, dispatches,
# reviews and merges; subagents produce. Every case feeds on-tool.sh (or
# on-stop.sh) the JSON the harness would send and asserts on the exit code,
# the one channel the gate answers on.
#
# The distinction under test is a single field: a PreToolUse payload carries
# agent_id only when the call comes from inside a subagent. A payload without
# one is the main thread, which may read and verify but not produce.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude
unset KODFLOW_ROOT CLAUDE_CODE_ENABLE_TODO_TOOLS CLAUDE_CODE_TASK_LIST_ID   # inherited values would change what is asserted
mkdir -p "$T/repo" "$T/home/.claude" "$T/tmp/sp"
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
expect_rc() { [ "$RC" -eq "$2" ] && ok "$1" || bad "$1" "rc=$RC err=${ERR:0:300}"; }

cmd()  { payload Bash "$(jq -n -c --arg c "$1" '{command:$c}')" "${2:-}"; }
file() { payload "${2:-Write}" "$(jq -n -c --arg f "$1" '{file_path:$f,content:"x"}')" "${3:-}"; }
AGENT='{"agent_id":"agt_01","agent_type":"general-purpose"}'
SRC=$T/repo/src/main.rs
CFG=$T/home/.claude

echo "== the main thread may not produce"
run "$(file "$SRC")";                                       expect_rc "main-thread Write denied" 2
run "$(file "$SRC" Edit)";                                  expect_rc "main-thread Edit denied" 2
run "$(file "$SRC" MultiEdit)";                             expect_rc "main-thread MultiEdit denied" 2
# NotebookEdit carries notebook_path, not file_path: a gate placed after the
# file_path test would never see one.
run "$(payload NotebookEdit '{"notebook_path":"/tmp/n.ipynb"}')"
expect_rc "main-thread NotebookEdit denied" 2

echo "== a subagent is never gated"
run "$(file "$SRC" Write "$AGENT")";                        expect_rc "the same Write carrying agent_id allowed" 0
run "$(cmd 'npm install' "$AGENT")";                        expect_rc "a producing command from a subagent allowed" 0
run "$(cmd 'echo x > f && rm -rf build' "$AGENT")";         expect_rc "a redirection from a subagent allowed" 0
run "$(payload mcp__github__push_files '{}' "$AGENT")";     expect_rc "a forge write from a subagent allowed" 0

echo "== the denial carries the briefing contract"
run "$(file "$SRC")"
for w in 'subagent' 'worktree' 'PR' 'line numbers' 'task_focus' 'SendMessage' 'KODFLOW_ROOT=off'; do
    printf '%s' "$ERR" | grep -q "$w" && ok "the reason names: $w" || bad "reason: $w" "$ERR"
done
run "$(cmd 'npm install')"
printf '%s' "$ERR" | grep -q 'ROOT_OK=1' && ok "a Bash denial names the per-line hatch" || bad "reason: ROOT_OK" "$ERR"
printf '%s' "$ERR" | grep -q 'Refused segment: npm install' && ok "a Bash denial names the segment" || bad "reason: segment" "$ERR"

echo "== memory and Claude configuration stay writable"
for f in "$CFG/projects/-home-x/memory/MEMORY.md" "$CFG/projects/-home-x/memory/note.md" \
         "$CFG/settings.json" "$CFG/settings.local.json" "$CFG/CLAUDE.md" "$HOME/CLAUDE.md"; do
    run "$(file "$f" Edit)"; expect_rc "allowed: ${f#"$T"/}" 0
done
for f in "$CFG/projects/-home-x/memory/../../../settings.sh" "$CFG/agents/x.md" "$CFG/projects/-home-x/transcript.jsonl" \
         "$T/repo/CLAUDE.md" "$CFG/settings.json.bak" "$HOME/.bashrc"; do
    run "$(file "$f")"; expect_rc "denied: ${f#"$T"/}" 2
done

echo "== reading is allowed"
for c in 'git status' 'git log --oneline -5' 'git diff HEAD' 'git show HEAD:a.txt' 'git fetch -q origin' \
         'git -C /x fetch origin && git -C /x log --oneline -3' 'git branch' 'git branch -a' 'git worktree list' \
         'git remote -v' 'git config --get user.email' 'git rev-parse HEAD' 'git stash list' \
         'gh pr view 12' 'gh pr checks 12 --watch' 'gh pr list --state open' 'gh pr diff 12' \
         'gh run view 123 --log-failed' 'gh run list -L 5' 'gh run watch 123' 'gh api repos/o/r/pulls/1' \
         'gh api -X GET repos/o/r/issues' 'gh -R o/r pr view 3' \
         'ls -la' 'cat a.txt' 'head -5 a.txt' 'tail -n 3 a.txt' 'grep -rn foo .' 'rg -n "a|b" .' \
         'find . -name "*.sh"' 'wc -l a.txt' 'jq . a.json' 'stat a.txt' 'date +%s' 'ps aux' 'pgrep -f claude' \
         'sed -n 1,5p a.txt' 'cat a.txt | grep x | head -3' 'ls 2>/dev/null' 'git status 2>&1 | head' \
         'cd /x && git status' 'command -v jq' 'echo "a > b; c"' "jq '.a > 1' f.json" \
         'for f in *.sh; do bash -n "$f"; done' 'ls ${HOME}' 'git log $(git merge-base HEAD main)..HEAD' \
         'rtk git status' 'timeout 5 git status' 'find . -name x | xargs grep -n y'; do
    run "$(cmd "$c")"; expect_rc "allowed: $c" 0
done

echo "== tests and checks are allowed: a reviewer verifies"
for c in 'go test ./...' 'go vet ./...' 'make test' 'make lint' 'make -C sub check' 'make test-unit lint' \
         'bash scripts/tests/test_hooks.sh' 'bash plugins/kodflow-hooks/tests/run-tests.sh' 'bash -n on-tool.sh' \
         'shellcheck -S error x.sh' 'python3 -m unittest -v test_x' 'python3 -m pytest -q' \
         'python3 scripts/tests/test_sanitize.py' 'timeout 120 go test -race ./...' 'npm test' 'cargo test'; do
    run "$(cmd "$c")"; expect_rc "allowed: $c" 0
done

echo "== merging is allowed, after the user's OK"
run "$(cmd 'gh pr merge 12 --squash --delete-branch')";          expect_rc "gh pr merge allowed" 0
run "$(payload mcp__github__merge_pull_request '{}')";            expect_rc "GitHub MCP merge allowed" 0
run "$(payload mcp__gitlab__merge_merge_request '{}')";           expect_rc "GitLab MCP merge allowed" 0
run "$(payload mcp__github__pull_request_read '{}')";             expect_rc "GitHub MCP read allowed" 0
run "$(payload mcp__github__add_issue_comment '{}')";             expect_rc "GitHub MCP comment allowed (informing)" 0
for c in 'gh pr review 1 --approve' 'gh pr comment 1 -b x' 'gh issue create -t x -b y' 'gh issue comment 3 -b x'; do
    run "$(cmd "$c")"; expect_rc "allowed (review, tracker): $c" 0
done

echo "== Claude configuration commands are allowed"
run "$(cmd 'claude plugin update kodflow-hooks@kodflow')";       expect_rc "claude plugin allowed" 0
run "$(cmd 'claude mcp list')";                                  expect_rc "claude mcp allowed" 0

echo "== producing is denied, whatever it looks like"
for c in 'npm install' 'git push origin main' 'git commit -m "feat: x"' 'git checkout -b x' 'git branch -D old' \
         'git worktree add ../w -b x' 'git stash' 'git merge main' 'git remote add o u' 'git config user.name x' \
         'rm -rf build' 'mkdir -p x' 'touch f' 'cp a b' 'mv a b' 'chmod +x run.sh' 'sed -i s/a/b/ a.txt' \
         'find . -name "*.tmp" -delete' 'find . -exec rm {} ;' 'python3 setup.py install' 'python3 -c "import os"' \
         'pip install x' 'apt install x' 'sg ai -c "sudo apt update"' 'curl -o f https://x' \
         'gh pr create --fill' 'gh pr edit 1 --title x' 'gh pr close 1' 'gh pr checkout 1' 'gh release create v1' \
         'gh api -X POST repos/o/r/issues' 'gh api repos/o/r/issues -f title=x' 'gh repo clone o/r' \
         'make' 'make build' 'make install test' 'go build ./...' 'go mod tidy' 'bash deploy.sh' 'sh -c "rm x"' \
         'sort -o out.txt a.txt' 'xargs rm' 'eval "$X"' 'tee out.txt' 'claude --dangerously-skip-permissions'; do
    run "$(cmd "$c")"; expect_rc "denied: $c" 2
done
run "$(payload mcp__github__create_or_update_file '{}')";        expect_rc "GitHub MCP file write denied" 2
run "$(payload mcp__github__push_files '{}')";                   expect_rc "GitHub MCP push denied" 2
run "$(payload mcp__github__create_pull_request '{}')";          expect_rc "GitHub MCP PR creation denied (the subagent delivers)" 2
run "$(payload mcp__gitlab__create_branch '{}')";                expect_rc "GitLab MCP branch denied" 2
run "$(payload mcp__GitKraken__git_commit '{}')";                expect_rc "GitKraken commit denied" 2
run "$(payload mcp__github__some_future_write '{}')";            expect_rc "an unclassified forge tool is denied" 2

echo "== redirections and compound lines"
run "$(cmd 'echo x > f')";                          expect_rc "redirection denied" 2
run "$(cmd 'ls -la >> log.txt')";                   expect_rc "appending redirection denied" 2
run "$(cmd 'git status 2>err.txt')";                expect_rc "stderr to a file denied" 2
run "$(cmd 'ls &> out')";                           expect_rc "&> to a file denied" 2
run "$(cmd 'ls | tee out.txt')";                    expect_rc "tee denied" 2
run "$(cmd 'cat a.txt && sed -i s/a/b/ a.txt')";    expect_rc "a producing segment after && denied" 2
run "$(cmd 'git status; rm -f a.txt')";             expect_rc "a producing segment after ; denied" 2
run "$(cmd 'git status || rm -f a.txt')";           expect_rc "a producing segment after || denied" 2
run "$(cmd 'ls & rm -f a.txt')";                    expect_rc "a producing segment after & denied" 2
run "$(cmd $'git status\nrm -f a.txt')";            expect_rc "a producing second line denied" 2
run "$(cmd 'echo $(rm -f a.txt)')";                 expect_rc "a producing command substitution denied" 2
run "$(cmd 'echo `rm -f a.txt`')";                  expect_rc "a producing backtick substitution denied" 2
run "$(cmd 'echo "$(rm -f a.txt)"')";               expect_rc "a substitution inside double quotes denied" 2
run "$(cmd '(cd x && rm y)')";                      expect_rc "a producing subshell denied" 2
run "$(cmd 'diff <(ls) <(rm x)')";                  expect_rc "a producing process substitution denied" 2
run "$(cmd "echo 'a\"' > f \"b\"")";               expect_rc "mixed quotes cannot hide a redirection" 2
run "$(cmd "echo 'unbalanced")";                    expect_rc "unbalanced quotes are unclassifiable: denied" 2
run "$(cmd 'if true; then rm x; fi')";              expect_rc "a producing branch of an if denied" 2
run "$(cmd 'cat a.txt | grep x')";                  expect_rc "an all-reading pipeline allowed" 0

echo "== the escape hatches"
run "$(cmd 'ROOT_OK=1 npm install')";               expect_rc "ROOT_OK=1 opts the line out" 0
run "$(cmd 'ROOT_OK=1 echo x > f')";                expect_rc "ROOT_OK=1 covers a redirection too" 0
run "$(cmd 'NO_RTK= ROOT_OK=1 npm install')";       expect_rc "ROOT_OK=1 after another prefix" 0
run "$(cmd 'npm install ROOT_OK=1')";               expect_rc "ROOT_OK=1 elsewhere on the line is not a hatch" 2
run "$(cmd 'npm install')" KODFLOW_ROOT=off;        expect_rc "KODFLOW_ROOT=off disables the session" 0
run "$(file "$SRC")" KODFLOW_ROOT=off;              expect_rc "KODFLOW_ROOT=off covers the edit tools" 0
run "$(payload mcp__github__push_files '{}')" KODFLOW_ROOT=off; expect_rc "KODFLOW_ROOT=off covers the forge tools" 0
run "$(cmd 'npm install' '{"permission_mode":"plan"}')"
expect_rc "plan mode is untouched" 0
run "$(file "$SRC" Write '{"permission_mode":"plan"}')"
expect_rc "plan mode is untouched for the edit tools" 0

echo "== the rest of the hook still applies behind the gate"
run "$(cmd 'git commit --no-verify -m "feat: x"' "$AGENT")"; expect_rc "a subagent still meets the git guard" 2
run "$(file "$T/repo/node_modules/x.js" Edit "$AGENT")";     expect_rc "a subagent still meets the protected paths" 2
run "$(payload WebSearch '{"query":"x"}')";                    expect_rc "a tool the gate does not know leaves at once" 0
run "$(payload Agent '{"prompt":"x"}')";                       expect_rc "dispatching is allowed" 0
run "$(payload SendMessage '{"to":"x","message":"y"}')";       expect_rc "messaging a subagent is allowed" 0

echo "== the gate fails open"
printf 'not json' | bash "$S/on-tool.sh" >/dev/null 2>&1
[ $? -eq 0 ] && ok "a malformed payload exits 0" || bad "malformed payload" "it did not exit 0"
printf '' | bash "$S/on-tool.sh" >/dev/null 2>&1
[ $? -eq 0 ] && ok "an empty payload exits 0" || bad "empty payload" "it did not exit 0"
run "$(payload Bash '{}')";                         expect_rc "a Bash call with no command allowed" 0
# Without jq the hook cannot read the payload, so it must not judge it. bash is
# named absolutely: an empty PATH would otherwise fail to find the shell itself.
printf '%s' "$(file "$SRC")" | env PATH=/nonexistent /bin/bash "$S/on-tool.sh" >/dev/null 2>&1
[ $? -eq 0 ] && ok "no jq on PATH fails open" || bad "no jq" "it did not exit 0"
run "$(jq -n -c --arg cwd "$T/repo" '{session_id:"sess-root",hook_event_name:"PostToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:"npm install"}}')"
expect_rc "a producing PostToolUse is out of scope" 0
# agent_id present but empty is still the main thread.
run "$(file "$SRC" Write '{"agent_id":""}')";       expect_rc "an empty agent_id is the main thread" 2
run "$(file "$SRC" Write '{"agent_id":null}')";     expect_rc "a null agent_id is the main thread" 2

echo "== the cost of the discipline is countable"
L=$T/repo/.claude/logs/feat_root/session.jsonl
sleep 0.6; rm -f "$L"
run "$(file "$SRC")"
run "$(cmd 'npm install')"
run "$(jq -n -c --arg cwd "$T/repo" '{session_id:"sess-root",hook_event_name:"PostToolUse",tool_name:"Agent",cwd:$cwd,tool_input:{description:"port the guard",subagent_type:"general-purpose"}}')"
sleep 0.6
[ "$(grep -c '"root_guard":"deny"' "$L" 2>/dev/null)" = 2 ] \
    && ok "each denial is one tagged line in the log" || bad "deny count" "$(cat "$L" 2>/dev/null)"
[ "$(grep -c '"root_guard":"dispatch"' "$L" 2>/dev/null)" = 1 ] \
    && ok "each dispatch is one tagged line in the log" || bad "dispatch count" "$(tail -1 "$L" 2>/dev/null)"

echo "== Stop · an epic in progress needs a subagent"
MS=$CFG/kodflow/sessions/sess-root; mkdir -p "$MS"
stop() { OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-root",hook_event_name:"Stop",cwd:$cwd,scratchpad_dir:$sp,stop_hook_active:false}' \
    | env "$@" bash "$S/on-stop.sh" 2>/dev/null); rm -f "$T/tmp/sp/stop-count"; }
producing() { printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("dispatch a subagent")' >/dev/null 2>&1; }
printf '%s' '{"version":2,"active":{"main":3},"epics":[{"id":3,"agent":"main","title":"Rules"},{"id":4,"agent":"main","title":"Other"}],"tasks":[
  {"id":"1","agent":"main","epic":3,"subject":"Port the gate","status":"in_progress"},
  {"id":"2","agent":"main","epic":4,"subject":"Later","status":"pending"},
  {"id":"3","agent":"a1","epic":0,"subject":"Sub","status":"in_progress"}]}' > "$MS/tasks.json"
rm -f "$MS/agents.json"; stop
producing && printf '%s' "$OUT" | grep -q 'epic #3' && printf '%s' "$OUT" | grep -q '#1' \
    && ok "a main task in progress with no subagent on its epic is flagged" || bad "stop: no subagent" "$OUT"
stop; producing && ok "flagged again on the next turn" || bad "stop: repeat" "$OUT"
printf '{"agents":{"a1":{"type":"general-purpose","started":%s,"stopped":null,"epic":3}}}' "$(date +%s)" > "$MS/agents.json"
stop; producing && bad "stop: covered" "$OUT" || ok "a running subagent on the epic covers it"
printf '{"agents":{"a1":{"type":"general-purpose","started":%s,"stopped":null,"epic":4}}}' "$(date +%s)" > "$MS/agents.json"
stop; producing && ok "a subagent on another epic does not cover it" || bad "stop: other epic" "$OUT"
printf '{"agents":{"a1":{"type":"general-purpose","started":%s,"stopped":%s,"epic":3}}}' "$(date +%s)" "$(date +%s)" > "$MS/agents.json"
stop; producing && ok "a stopped subagent does not cover it" || bad "stop: stopped" "$OUT"
printf '{"agents":{"a1":{"type":"general-purpose","started":%s,"stopped":null,"epic":3}}}' "$(( $(date +%s) - 50000 ))" > "$MS/agents.json"
stop; producing && ok "a subagent started over 12 h ago does not cover it" || bad "stop: stale" "$OUT"
rm -f "$MS/agents.json"
stop KODFLOW_ROOT=off; producing && bad "stop: off" "$OUT" || ok "KODFLOW_ROOT=off skips the rule"
printf '%s' '{"version":2,"active":{"main":3},"epics":[{"id":3,"agent":"main","title":"Rules"}],"tasks":[
  {"id":"1","agent":"main","epic":3,"subject":"Await the OK","status":"waiting"}]}' > "$MS/tasks.json"
stop; producing && bad "stop: waiting" "$OUT" || ok "a task waiting on the user is not production"
printf 'garbage' > "$MS/tasks.json"; printf 'garbage' > "$MS/agents.json"
stop; [ "$(printf '%s' "$OUT" | jq -s 'length' 2>/dev/null)" = 1 ] && ! producing \
    && ok "malformed files: one document, no flag" || bad "stop: malformed" "$OUT"

echo "== UserPromptSubmit · the directive says main reviews"
user() { OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-root",hook_event_name:"UserPromptSubmit",cwd:$cwd,scratchpad_dir:$sp,prompt:"hi"}' \
    | env "$@" bash "$S/on-user.sh" 2>/dev/null); C=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null); }
printf '%s' '{"version":2,"active":{"main":2},
  "epics":[{"id":1,"agent":"main","title":"api-gateway","touched":5},{"id":2,"agent":"main","title":"SDK status-line","touched":9}],
  "tasks":[{"id":"1","agent":"main","epic":1,"subject":"Fix daemon","status":"pending"},
           {"id":"3","agent":"main","epic":2,"subject":"Freeze golden renders now","status":"in_progress"},
           {"id":"5","agent":"main","epic":0,"subject":"Loose","status":"pending"}]}' > "$MS/tasks.json"
user
printf '%s' "$C" | grep -q 'dispatch a subagent' && printf '%s' "$C" | grep -q 'do not produce' \
    && ok "the directive sends the work to a subagent" || bad "directive" "$C"
printf '%s' "$C" | grep -q 'Epics: active #2' && [ "${#C}" -lt 900 ] \
    && ok "with the epic state it stays under 900 characters (${#C})" || bad "directive size" "${#C}: $C"
user KODFLOW_ROOT=off
printf '%s' "$C" | grep -q 'do not produce' && bad "directive off" "$C" || ok "KODFLOW_ROOT=off drops the reviewer line"
printf '%s' "$C" | grep -q 'TRIAGE' && ok "the triage directive stays when the gate is off" || bad "triage off" "$C"
OUT=$(jq -n -c --arg cwd "$T/repo" '{session_id:"sess-root",hook_event_name:"SubagentStart",cwd:$cwd,agent_id:"a9",agent_type:"general-purpose"}' | bash "$S/on-agent.sh" 2>/dev/null)
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("own git worktree") and test("PR")' >/dev/null 2>&1 \
    && ok "a subagent is told to work in its own worktree and deliver a PR" || bad "subagent context" "$OUT"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
