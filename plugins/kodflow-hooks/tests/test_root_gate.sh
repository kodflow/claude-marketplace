#!/bin/bash
# test_root_gate.sh — the delegation gate: code in a git repository is
# produced by subagents; the main thread triages, dispatches, reviews, merges. Every case feeds on-tool.sh (or
# on-stop.sh) the JSON the harness would send and asserts on the exit code,
# the one channel the gate answers on.
#
# The distinction under test is a single field: a PreToolUse payload carries
# agent_id only when the call comes from inside a subagent. A payload without
# one is the main thread, which keeps every permission (it is also the
# workstation's sysadmin) except producing code in a git repository.
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

OUTSIDE=$T/etc/app.conf; mkdir -p "$T/etc"
# a worktree's .git is a file, not a directory: the walk must see it too
WT=$T/wt; mkdir -p "$WT/pkg"; printf 'gitdir: %s\n' "$T/repo/.git/worktrees/wt" > "$WT/.git"

echo "== writes inside a git work tree are refused"
run "$(file "$SRC")";                                       expect_rc "Write in a repo denied (new subdirectory)" 2
run "$(file "$T/repo/a.txt" Edit)";                         expect_rc "Edit in a repo denied" 2
run "$(file "$T/repo/a.txt" MultiEdit)";                    expect_rc "MultiEdit in a repo denied" 2
run "$(payload NotebookEdit "$(jq -n -c --arg f "$T/repo/n.ipynb" '{notebook_path:$f}')")"
expect_rc "NotebookEdit in a repo denied (notebook_path)" 2
run "$(file "$WT/pkg/x.go")";                               expect_rc "a worktree (gitdir file) is a repo too" 2
run "$(file "src/rel.go")";                                 expect_rc "a relative path is resolved against cwd" 2
run "$(file "$T/etc/../repo/sneak.go")";                    expect_rc "a .. path that lands in a repo denied" 2

echo "== writes outside repositories are allowed: the main thread is the sysadmin"
run "$(file "$OUTSIDE")";                                   expect_rc "Write outside a repo allowed" 0
run "$(file "$HOME/.local/bin/tool" Edit)";                 expect_rc "Edit in ~/.local/bin allowed" 0
run "$(file "$T/repo/../etc/x.conf")";                      expect_rc "a .. path that leaves the repo allowed" 0
for f in "$CFG/projects/-home-x/memory/MEMORY.md" "$CFG/settings.json" "$CFG/settings.local.json" "$CFG/CLAUDE.md" "$HOME/CLAUDE.md"; do
    run "$(file "$f" Edit)"; expect_rc "allowed: ${f#"$T"/}" 0
done
# memory and configuration stay writable even when the config dir is a repo
git -C "$CFG" init -q
run "$(file "$CFG/projects/-home-x/memory/note.md")";       expect_rc "memory inside a repo still allowed" 0
run "$(file "$CFG/settings.json" Edit)";                    expect_rc "settings inside a repo still allowed" 0
run "$(file "$CFG/agents/x.md")";                           expect_rc "other files of that repo denied" 2
rm -rf "$CFG/.git"

echo "== a subagent is never gated"
run "$(file "$SRC" Write "$AGENT")";                        expect_rc "a Write in a repo from a subagent allowed" 0
run "$(cmd 'git push origin feat/x' "$AGENT")";             expect_rc "git push from a subagent allowed" 0
run "$(cmd 'gh pr create --fill' "$AGENT")";                expect_rc "gh pr create from a subagent allowed" 0
run "$(payload mcp__github__push_files '{}' "$AGENT")";     expect_rc "a forge write from a subagent allowed" 0

echo "== the denial says what to do"
run "$(file "$SRC")"
for w in 'repository' 'subagent' 'SendMessage' 'worktree' 'PR' 'ROOT_OK=1'; do
    printf '%s' "$ERR" | grep -q "$w" && ok "the reason names: $w" || bad "reason: $w" "$ERR"
done
[ "$(printf '%s\n' "$ERR" | wc -l)" -le 8 ] && ok "the reason is short" || bad "reason length" "$ERR"

echo "== Bash: everything but repository production is allowed"
for c in 'sg ai -c "sudo apt update && sudo apt upgrade -y"' 'sudo systemctl restart nginx' 'apt install -y jq' \
         'nmcli dev wifi list' 'install -m755 bin/x ~/.local/bin/x' 'rm -rf /tmp/x' 'cp a b' 'mv a b' 'mkdir -p x' \
         'echo x > /etc/app.conf' 'ls >> log.txt' 'curl -o f https://x' 'some-unknown-tool --flag' 'npm install' \
         'python3 -c "print(1)"' 'sed -i s/a/b/ /etc/hosts' 'git status' 'git log --oneline -5' 'git fetch -q origin' \
         'git diff HEAD' 'git pull --ff-only' 'git checkout main' 'git stash' 'git reset HEAD~1' 'git merge-base a b' \
         'git worktree list' 'git worktree remove ../w' 'gh pr view 3' 'gh pr checks 3 --watch' 'gh pr list' \
         'gh api repos/o/r/pulls/1' 'go test ./...' 'make test' 'echo "git log"' 'grep -rn "pr create" .' \
         'claude plugin update kodflow-hooks@kodflow'; do
    run "$(cmd "$c")"; expect_rc "allowed: $c" 0
done

echo "== merging is allowed, after the user's OK"
run "$(cmd 'gh pr merge 12 --squash --delete-branch')";          expect_rc "gh pr merge allowed" 0
run "$(cmd 'glab mr merge 4')";                                  expect_rc "glab mr merge allowed" 0
run "$(payload mcp__github__merge_pull_request '{}')";            expect_rc "GitHub MCP merge allowed" 0
run "$(payload mcp__gitlab__merge_merge_request '{}')";           expect_rc "GitLab MCP merge allowed" 0

echo "== Bash: the git and forge operations that produce into a repository are refused"
G=git
for c in "$G commit -m 'feat: x'" "$G push origin main" "$G rebase main" "$G cherry-pick abc" "$G merge main" \
         "$G am < p.patch" "$G apply p.diff" "$G revert HEAD" "$G reset --hard origin/main" "$G reset -q --hard" \
         "$G worktree add ../w -b x" 'gh pr create --fill' 'gh -R o/r pr create -t x' 'glab mr create'; do
    run "$(cmd "$c")"; expect_rc "denied: $c" 2
done

echo "== wrapped forms are found anywhere on the line"
for c in "cd /x && $G commit -m 'feat: x'" "$G -C /x push" "$G -c user.name=x commit -m y" "env GIT_X=1 $G push" \
         "bash -c \"$G commit -m x\"" "sudo $G push" "$G status; $G merge main" "ls | xargs $G apply" \
         "$G --no-pager rebase -i main" "$G status"$'\n'"$G push" 'true && gh pr create --fill'; do
    run "$(cmd "$c")"; expect_rc "denied: $c" 2
done
run "$(cmd "$G commit -m x")"
printf '%s' "$ERR" | grep -q "$G commit" && ok "the reason names the operation" || bad "reason: op" "$ERR"

echo "== forge MCP tools"
run "$(payload mcp__github__pull_request_read '{}')";             expect_rc "GitHub MCP read allowed" 0
run "$(payload mcp__github__add_issue_comment '{}')";             expect_rc "GitHub MCP comment allowed" 0
run "$(payload mcp__github__pull_request_review_write '{}')";     expect_rc "GitHub MCP review allowed" 0
run "$(payload mcp__github__issue_write '{}')";                   expect_rc "GitHub MCP issue allowed" 0
run "$(payload mcp__github__create_or_update_file '{}')";        expect_rc "GitHub MCP file write denied" 2
run "$(payload mcp__github__push_files '{}')";                   expect_rc "GitHub MCP push denied" 2
run "$(payload mcp__github__create_branch '{}')";                expect_rc "GitHub MCP branch denied" 2
run "$(payload mcp__github__create_pull_request '{}')";          expect_rc "GitHub MCP PR creation denied" 2
run "$(payload mcp__gitlab__create_merge_request '{}')";         expect_rc "GitLab MCP MR creation denied" 2
run "$(payload mcp__GitKraken__git_commit '{}')";                expect_rc "GitKraken commit denied" 2
run "$(payload mcp__github__some_future_write '{}')";            expect_rc "an unclassified forge tool is denied" 2

echo "== the escapes"
run "$(cmd "ROOT_OK=1 $G commit -m 'fix: x'")";     expect_rc "ROOT_OK=1 opts the line out" 0
run "$(cmd "NO_RTK= ROOT_OK=1 $G push")";           expect_rc "ROOT_OK=1 after another prefix" 0
run "$(cmd "$G push ROOT_OK=1")";                   expect_rc "ROOT_OK=1 elsewhere on the line is not a hatch" 2
run "$(cmd "$G push")" KODFLOW_ROOT=off;            expect_rc "KODFLOW_ROOT=off disables the session (Bash)" 0
run "$(file "$SRC")" KODFLOW_ROOT=off;              expect_rc "KODFLOW_ROOT=off covers the edit tools" 0
run "$(payload mcp__github__push_files '{}')" KODFLOW_ROOT=off; expect_rc "KODFLOW_ROOT=off covers the forge tools" 0
run "$(cmd "$G commit -m x" '{"permission_mode":"plan"}')"
expect_rc "plan mode is untouched" 0
run "$(file "$SRC" Write '{"permission_mode":"plan"}')"
expect_rc "plan mode is untouched for the edit tools" 0

echo "== the rest of the hook still applies behind the gate"
run "$(cmd "$G commit --no-verify -m 'feat: x'" "$AGENT")"; expect_rc "a subagent still meets the git guard" 2
run "$(file "$T/repo/node_modules/x.js" Edit "$AGENT")";     expect_rc "a subagent still meets the protected paths" 2
run "$(file "$OUTSIDE.lock")";                               expect_rc "the main thread still meets the protected paths" 2
run "$(payload WebSearch '{"query":"x"}')";                    expect_rc "a tool the gate does not know leaves at once" 0
run "$(payload Agent '{"prompt":"x"}')";                       expect_rc "dispatching is allowed" 0

echo "== the gate fails open"
printf 'not json' | bash "$S/on-tool.sh" >/dev/null 2>&1
[ $? -eq 0 ] && ok "a malformed payload exits 0" || bad "malformed payload" "it did not exit 0"
printf '' | bash "$S/on-tool.sh" >/dev/null 2>&1
[ $? -eq 0 ] && ok "an empty payload exits 0" || bad "empty payload" "it did not exit 0"
run "$(payload Bash '{}')";                         expect_rc "a Bash call with no command allowed" 0
run "$(payload Write '{}')";                        expect_rc "a Write with no path allowed" 0
printf '%s' "$(file "$SRC")" | env PATH=/nonexistent /bin/bash "$S/on-tool.sh" >/dev/null 2>&1
[ $? -eq 0 ] && ok "no jq on PATH fails open" || bad "no jq" "it did not exit 0"
run "$(jq -n -c --arg cwd "$T/repo" --arg c "$G push" '{session_id:"sess-root",hook_event_name:"PostToolUse",tool_name:"Bash",cwd:$cwd,tool_input:{command:$c}}')"
expect_rc "a PostToolUse is out of scope" 0
run "$(file "$SRC" Write '{"agent_id":""}')";       expect_rc "an empty agent_id is the main thread" 2
run "$(file "$SRC" Write '{"agent_id":null}')";     expect_rc "a null agent_id is the main thread" 2

echo "== the cost of the discipline is countable"
L=$T/repo/.claude/logs/feat_root/session.jsonl
sleep 0.6; rm -f "$L"
run "$(file "$SRC")"
run "$(cmd "$G push")"
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

echo "== UserPromptSubmit · the directive says code is delegated"
user() { OUT=$(jq -n -c --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:"sess-root",hook_event_name:"UserPromptSubmit",cwd:$cwd,scratchpad_dir:$sp,prompt:"hi"}' \
    | env "$@" bash "$S/on-user.sh" 2>/dev/null); C=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null); }
printf '%s' '{"version":2,"active":{"main":2},
  "epics":[{"id":1,"agent":"main","title":"api-gateway","touched":5},{"id":2,"agent":"main","title":"SDK status-line","touched":9}],
  "tasks":[{"id":"1","agent":"main","epic":1,"subject":"Fix daemon","status":"pending"},
           {"id":"3","agent":"main","epic":2,"subject":"Freeze golden renders now","status":"in_progress"},
           {"id":"5","agent":"main","epic":0,"subject":"Loose","status":"pending"}]}' > "$MS/tasks.json"
user
printf '%s' "$C" | grep -q 'dispatch a subagent' && printf '%s' "$C" | grep -q 'do not write it' \
    && ok "the directive sends the work to a subagent" || bad "directive" "$C"
printf '%s' "$C" | grep -q 'Epics: active #2' && [ "${#C}" -lt 900 ] \
    && ok "with the epic state it stays under 900 characters (${#C})" || bad "directive size" "${#C}: $C"
user KODFLOW_ROOT=off
printf '%s' "$C" | grep -q 'do not write it' && bad "directive off" "$C" || ok "KODFLOW_ROOT=off drops the reviewer line"
printf '%s' "$C" | grep -q 'TRIAGE' && ok "the triage directive stays when the gate is off" || bad "triage off" "$C"
OUT=$(jq -n -c --arg cwd "$T/repo" '{session_id:"sess-root",hook_event_name:"SubagentStart",cwd:$cwd,agent_id:"a9",agent_type:"general-purpose"}' | bash "$S/on-agent.sh" 2>/dev/null)
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("own git worktree") and test("PR")' >/dev/null 2>&1 \
    && ok "a subagent is told to work in its own worktree and deliver a PR" || bad "subagent context" "$OUT"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
