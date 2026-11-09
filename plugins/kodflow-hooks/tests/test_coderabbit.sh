#!/bin/bash
# test_coderabbit.sh — the CodeRabbit capacity hint of on-tool.sh
# (lib/coderabbit.sh), against a stub probe: when it speaks, what it says, and
# that it is silent and never blocks on any failure. The reader of CodeRabbit's
# messages is tested on its own (tests/coderabbit/test_probe.py).
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude KODFLOW_ROOT=off
unset KODFLOW_CODERABBIT KODFLOW_CODERABBIT_PROBE
mkdir -p "$T/repo" "$T/home" "$T/tmp/sp"
git -C "$T/repo" init -q -b feat/test
git -C "$T/repo" config user.email t@example.invalid; git -C "$T/repo" config user.name t
printf 'x\n' > "$T/repo/a.txt"; git -C "$T/repo" add a.txt; git -C "$T/repo" commit -qm "chore: seed"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

# The stub records its arguments and prints $STUB_OUT, exiting $STUB_RC.
STUB=$T/stub.py
cat > "$STUB" <<'PY'
import os, sys
open(os.environ["STUB_LOG"], "a").write(" ".join(sys.argv[1:]) + "\n")
sys.stdout.write(os.environ.get("STUB_OUT", ""))
sys.exit(int(os.environ.get("STUB_RC", "0")))
PY
export KODFLOW_CODERABBIT_PROBE=$STUB STUB_LOG=$T/stub.log

run() {   # run "<command>" → RC, OUT, ERR ; the payload of a subagent's Bash call
    local json; json=$(jq -n -c --arg c "$1" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" \
        '{session_id:"s1",hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,scratchpad_dir:$sp,tool_use_id:"t1",agent_id:"agt1",agent_type:"general-purpose",tool_input:{command:$c}}')
    : > "$STUB_LOG"
    OUT=$(printf '%s' "$json" | bash "$S/on-tool.sh" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
}
ctx() { printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null; }
calls() { grep -c . "$STUB_LOG"; }

echo "== speaks before gh pr create and git push"
export STUB_OUT='{"state":"limited","context":"HINT line 1\nline 2"}' STUB_RC=0
run 'gh pr create --title "feat: x" --body "y"'
[ $RC -eq 0 ] && [ "$(ctx)" = $'HINT line 1\nline 2' ] && ok "gh pr create: additionalContext, rc 0" || bad "gh pr create" "rc=$RC out=$OUT err=$ERR"
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.hookEventName == "PreToolUse" and (.hookSpecificOutput | has("permissionDecision") | not)' >/dev/null \
    && ok "information only: no permissionDecision" || bad "no decision" "$OUT"
grep -q -- '--action pr_create' "$STUB_LOG" && ok "the probe is asked for pr_create" || bad "action" "$(cat "$STUB_LOG")"
grep -q -- "--cwd $T/repo" "$STUB_LOG" && ok "and for the command's directory" || bad "cwd" "$(cat "$STUB_LOG")"
grep -q -- "--cache-dir $T/home/.claude/kodflow/coderabbit" "$STUB_LOG" && ok "cache under the config dir" || bad "cache dir" "$(cat "$STUB_LOG")"

run 'git push -u origin feat/x'
[ $RC -eq 0 ] && [ "$(ctx)" = $'HINT line 1\nline 2' ] && grep -q -- '--action push' "$STUB_LOG" && ok "git push: asked for push" || bad "git push" "rc=$RC out=$OUT log=$(cat "$STUB_LOG")"

run 'cd /nonexistent-dir && gh pr create --title t'
[ $RC -eq 0 ] && [ -z "$(ctx)" ] && ok "a directory that does not exist: silence" || bad "bad cwd" "rc=$RC out=$OUT"

run 'gh pr create -R kodflow/labs --title t'
grep -q -- '--repo kodflow/labs' "$STUB_LOG" && ok "-R OWNER/NAME is forwarded" || bad "-R" "$(cat "$STUB_LOG")"
run 'gh pr create --repo=kitsunium/sdk --title t'
grep -q -- '--repo kitsunium/sdk' "$STUB_LOG" && ok "--repo=OWNER/NAME is forwarded" || bad "--repo=" "$(cat "$STUB_LOG")"
run "gh pr create -R \"x;touch $T/pwned\" --title t"
! grep -q -- '--repo' "$STUB_LOG" && [ ! -e "$T/repo/pwned" ] && [ ! -e "$T/pwned" ] && ok "a malformed repository is not forwarded" || bad "malformed" "$(cat "$STUB_LOG")"

run 'gh --repo=kodflow/labs pr create --title t'
grep -q -- '--repo kodflow/labs' "$STUB_LOG" && ok "--repo=OWNER/NAME before the subcommand is forwarded" || bad "global --repo=" "$(cat "$STUB_LOG")"
run 'gh -Rkodflow/labs pr create --title t'
grep -q -- '--repo kodflow/labs' "$STUB_LOG" && ok "-ROWNER/NAME before the subcommand is forwarded" || bad "global -R" "$(cat "$STUB_LOG")"
run 'gh -R kitsunium/sdk pr create --title t'
grep -q -- '--repo kitsunium/sdk' "$STUB_LOG" && ok "-R OWNER/NAME before the subcommand is forwarded" || bad "global -R sep" "$(cat "$STUB_LOG")"

echo "== silent where it has nothing to say"
for c in 'git status' 'gh pr view 3' 'gh pr list' 'ls'; do
    run "$c"
    [ $RC -eq 0 ] && [ -z "$OUT" ] && [ "$(calls)" = 0 ] && ok "no probe, no output: $c" || bad "$c" "rc=$RC out=$OUT calls=$(calls)"
done
export STUB_OUT='{"state":"available","context":""}'
run 'gh pr create --title t'
[ $RC -eq 0 ] && [ -z "$OUT" ] && ok "empty context: no output at all" || bad "empty context" "rc=$RC out=$OUT"

echo "== fails open"
for case in 'rc1|STUB_RC=1 STUB_OUT={"context":"X"}' 'garbage|STUB_RC=0 STUB_OUT=not-json' 'empty|STUB_RC=0 STUB_OUT='; do
    name=${case%%|*}; env_=${case#*|}
    # shellcheck disable=SC2086
    out=$(env $env_ STUB_LOG="$STUB_LOG" bash -c '
        json=$(jq -n -c --arg cwd "$CLAUDE_PROJECT_DIR" "{session_id:\"s1\",hook_event_name:\"PreToolUse\",tool_name:\"Bash\",cwd:\$cwd,tool_use_id:\"t\",agent_id:\"a\",tool_input:{command:\"gh pr create --title t\"}}")
        printf "%s" "$json" | bash "'"$S"'/on-tool.sh"; echo "rc=$?"')
    case "$name" in
        rc1) [ "$out" = "rc=0" ] && ok "probe exits 1: silence, rc 0" || bad "$name" "$out" ;;
        *)   [ "$out" = "rc=0" ] && ok "probe prints $name: silence, rc 0" || bad "$name" "$out" ;;
    esac
done
KODFLOW_CODERABBIT_PROBE=$T/missing.py run 'gh pr create --title t'
[ $RC -eq 0 ] && [ -z "$OUT" ] && ok "probe file missing: silence" || bad "missing probe" "rc=$RC out=$OUT"
export STUB_OUT='{"context":"HINT"}' STUB_RC=0
KODFLOW_CODERABBIT=off run 'gh pr create --title t'
[ $RC -eq 0 ] && [ -z "$OUT" ] && [ "$(calls)" = 0 ] && ok "KODFLOW_CODERABBIT=off: not called" || bad "off" "rc=$RC out=$OUT calls=$(calls)"

echo "== a guard still wins, and the hint rides with the identity notice"
export STUB_OUT='{"context":"HINT"}'
run 'git commit -m "feat: x" && git push origin feat/x'
printf '%s' "$OUT" | jq -e '(.systemMessage | startswith("kodflow-hooks: commit identity")) and .hookSpecificOutput.additionalContext == "HINT"' >/dev/null \
    && [ "$(printf '%s' "$OUT" | wc -l)" -le 1 ] && ok "one JSON document carries both" || bad "merged document" "$OUT"
run 'git push --force origin feat/x'
[ $RC -eq 2 ] && [ -z "$(ctx)" ] && ok "a forced push is refused, no hint" || bad "force" "rc=$RC out=$OUT"

echo "== a jq that fails on the merge costs neither the call nor the notice"
mkdir -p "$T/bin"; REALJQ=$(command -v jq)
cat > "$T/bin/jq" <<JQ
#!/bin/bash
case "\$*" in *additionalContext*) exit 5 ;; esac
exec "$REALJQ" "\$@"
JQ
chmod +x "$T/bin/jq"
export STUB_OUT='{"context":"HINT"}'
rm -f "$T/home/.claude/kodflow/sessions/s1/commit-identity-notice"
PATH="$T/bin:$PATH" run 'git commit -m "feat: x" && git push origin feat/x'
printf '%s' "$OUT" | jq -e '.systemMessage | startswith("kodflow-hooks: commit identity")' >/dev/null && [ $RC -eq 0 ] \
    && ok "the notice survives, rc 0" || bad "merge fallback" "rc=$RC out=$OUT"
PATH="$T/bin:$PATH" run 'gh pr create --title t'
[ $RC -eq 0 ] && [ -z "$OUT" ] && ok "no notice, merge failed: silence, rc 0" || bad "merge fallback silence" "rc=$RC out=$OUT"

echo "== gh pr merge and mcp__github__merge_pull_request: the merge gate"
run_main() {   # the main thread's Bash call (no agent_id): the one that may merge
    local json; json=$(jq -n -c --arg c "$1" --arg cwd "$T/repo" \
        '{session_id:"s1",hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_use_id:"t2",tool_input:{command:$c}}')
    : > "$STUB_LOG"
    OUT=$(printf '%s' "$json" | bash "$S/on-tool.sh" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
}
run_mcp() {    # $1 tool_input JSON, $2 agent_id or empty
    local json; json=$(jq -n -c --argjson i "$1" --arg cwd "$T/repo" --arg aid "${2:-}" \
        '{session_id:"s1",hook_event_name:"PreToolUse",tool_name:"mcp__github__merge_pull_request",cwd:$cwd,tool_use_id:"t3",tool_input:$i} + (if $aid != "" then {agent_id:$aid,agent_type:"general-purpose"} else {} end)')
    : > "$STUB_LOG"
    OUT=$(printf '%s' "$json" | bash "$S/on-tool.sh" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
}
decision() { printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null; }
reason() { printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null; }
DENY='{"decision":"deny","action":"requested","head":"abc1234def","message":"CodeRabbit relancé sur abc1234def à 12:00 UTC ; réessaie la fusion dès qu'"'"'il a relu ou après 12:30 UTC (30 min).","context":""}'
ALLOW='{"decision":"allow","action":"none","head":"abc1234def","message":"","context":"CodeRabbit on PR #42: head abc1234def covered=true eligible=true"}'
mkdir -p "$T/policy"
export STUB_OUT=$DENY STUB_RC=0
KODFLOW_CODERABBIT_POLICY_DIR=$T/policy run_main 'gh pr merge 42 --squash'
[ $RC -eq 0 ] && [ "$(decision)" = deny ] && [ "$(reason)" = "$(printf '%s' "$DENY" | jq -r .message)" ] \
    && ok "deny: permissionDecision deny with the probe's reason" || bad "deny" "rc=$RC out=$OUT err=$ERR"
grep -q -- '^merge-gate .*--pr 42' "$STUB_LOG" && grep -q -- "--policy-dir $T/policy" "$STUB_LOG" && grep -q -- '--deadline 4' "$STUB_LOG" \
    && grep -q -- '--wait-minutes 30' "$STUB_LOG" && grep -q -- '--cache-dir' "$STUB_LOG" \
    && ok "merge-gate --pr N --policy-dir --cache-dir, 4 s, 30 min" || bad "gate args" "$(cat "$STUB_LOG")"
KODFLOW_CR_MERGE_WAIT_MINUTES=7 run_main 'gh pr merge 42'
grep -q -- '--wait-minutes 7' "$STUB_LOG" && ok "KODFLOW_CR_MERGE_WAIT_MINUTES is passed" || bad "wait env" "$(cat "$STUB_LOG")"
KODFLOW_CR_MERGE_WAIT_MINUTES='5;x' run_main 'gh pr merge 42'
grep -q -- '--wait-minutes 30' "$STUB_LOG" && ok "a malformed wait falls back to 30" || bad "wait bad" "$(cat "$STUB_LOG")"
KODFLOW_CODERABBIT_POLICY_DIR=$T/no-such-dir HOME=$T/home run_main 'gh pr merge 42'
! grep -q -- '--policy-dir' "$STUB_LOG" && ok "no policy directory, no --policy-dir (eligible unknown)" || bad "no policy" "$(cat "$STUB_LOG")"
run_main 'gh pr merge 42 --match-head-commit abc1234def'
grep -q -- '--match-head abc1234def' "$STUB_LOG" && ok "--match-head-commit SHA is forwarded" || bad "match" "$(cat "$STUB_LOG")"
run_main 'gh pr merge 42 --match-head-commit=abc1234def --squash'
grep -q -- '--match-head abc1234def' "$STUB_LOG" && ok "--match-head-commit=SHA is forwarded" || bad "match=" "$(cat "$STUB_LOG")"
run_main 'gh pr merge https://github.com/kodflow/labs/pull/7 --squash'
grep -q -- '--pr 7' "$STUB_LOG" && grep -q -- '--repo kodflow/labs' "$STUB_LOG" && ok "a PR URL gives repo and number" || bad "merge url" "$(cat "$STUB_LOG")"
run_main 'gh pr merge feat/x --rebase'
grep -q -- '--branch feat/x' "$STUB_LOG" && ok "a branch operand" || bad "merge branch" "$(cat "$STUB_LOG")"
run_main 'gh pr merge --squash -t "feat: 9"'
! grep -q -- '--pr\|--branch' "$STUB_LOG" && grep -q -- "--cwd $T/repo" "$STUB_LOG" && ok "no operand: the checked-out branch" || bad "merge none" "$(cat "$STUB_LOG")"
for form in '42 -R kitsunium/sdk' '42 -Rkitsunium/sdk' '42 --repo kitsunium/sdk' '42 --repo=kitsunium/sdk' '-R kitsunium/sdk 42'; do
    run_main "gh pr merge $form --squash"
    grep -q -- '--repo kitsunium/sdk' "$STUB_LOG" && grep -q -- '--pr 42' "$STUB_LOG" && ok "-R form: gh pr merge $form" || bad "-R form $form" "$(cat "$STUB_LOG")"
done
run_main 'gh -R kitsunium/sdk pr merge 42'
grep -q -- '--repo kitsunium/sdk' "$STUB_LOG" && ok "-R before the subcommand" || bad "global -R" "$(cat "$STUB_LOG")"
for t in 'https://gitlab.com/a/b/-/merge_requests/3' 'feat+x' 'user@feat' 'https://github.com/a/b/issues/3'; do
    run_main "gh pr merge '$t' --squash"
    [ $RC -eq 0 ] && [ -z "$(decision)" ] && [ "$(calls)" = 0 ] && ok "an unreadable target ($t): no probe, allowed" || bad "target $t" "rc=$RC out=$OUT calls=$(calls)"
done
run_main 'gh pr merge 42 -R "x;y"'
[ $RC -eq 0 ] && [ -z "$(decision)" ] && [ "$(calls)" = 0 ] && ok "an unreadable repository: no probe, allowed" || bad "bad repo" "rc=$RC out=$OUT calls=$(calls)"
for line in 'gh pr merge 42 --squash; git push origin feat/x' 'gh pr merge 42 && gh pr create --title t'; do
    run_main "$line"
    [ "$(decision)" = deny ] && grep -q -- '^merge-gate .*--pr 42' "$STUB_LOG" && ok "a later verb does not unhold the merge: $line" || bad "later verb $line" "out=$OUT log=$(cat "$STUB_LOG")"
done
run_main 'gh pr merge 1 --squash && gh pr merge 2 --squash'
[ "$(decision)" = deny ] && reason | grep -q 'une fusion par commande' && [ "$(calls)" = 0 ] \
    && ok "two merges on one line: refused, one per command" || bad "two merges" "out=$OUT calls=$(calls)"
KODFLOW_CODERABBIT=off run_main 'gh pr merge 1 && gh pr merge 2'
[ -z "$(decision)" ] && ok "two merges with KODFLOW_CODERABBIT=off: not held" || bad "two merges off" "$OUT"

export STUB_OUT=$ALLOW
run_main 'gh pr merge 42'
[ $RC -eq 0 ] && [ -z "$(decision)" ] && [ "$(ctx)" = "CodeRabbit on PR #42: head abc1234def covered=true eligible=true" ] \
    && ok "allow: the context line, no decision" || bad "allow" "rc=$RC out=$OUT"
for bad_out in '' 'not-json' '{"decision":"allow","context":""}'; do
    STUB_OUT=$bad_out run_main 'gh pr merge 42'
    [ $RC -eq 0 ] && [ -z "$(decision)" ] && [ -z "$(ctx)" ] && ok "fail open on '${bad_out:-empty}'" || bad "fail open $bad_out" "rc=$RC out=$OUT"
done
STUB_OUT=$DENY STUB_RC=1 run_main 'gh pr merge 42'
[ "$(decision)" = deny ] && ok "a non-zero exit with a deny document still holds (the probe always exits 0)" || bad "rc1" "$OUT"
STUB_OUT=$DENY KODFLOW_CODERABBIT=off run_main 'gh pr merge 42'
[ $RC -eq 0 ] && [ -z "$OUT" ] && [ "$(calls)" = 0 ] && ok "KODFLOW_CODERABBIT=off: no gate" || bad "off" "rc=$RC out=$OUT calls=$(calls)"
STUB_OUT=$DENY run 'gh pr merge 42'
[ $RC -eq 2 ] && [ "$(calls)" = 0 ] && ok "a subagent's merge is still refused, the gate not run" || bad "subagent merge" "rc=$RC calls=$(calls)"

export STUB_OUT=$DENY
run_mcp '{"owner":"kitsunium","repo":"sdk","pullNumber":42,"expectedHeadSha":"abc1234def","merge_method":"squash"}'
[ $RC -eq 0 ] && [ "$(decision)" = deny ] && grep -q -- '--repo kitsunium/sdk' "$STUB_LOG" && grep -q -- '--pr 42' "$STUB_LOG" \
    && grep -q -- '--match-head abc1234def' "$STUB_LOG" && ok "MCP merge: the same gate, expectedHeadSha forwarded" || bad "mcp deny" "rc=$RC out=$OUT log=$(cat "$STUB_LOG") err=$ERR"
export STUB_OUT=$ALLOW
run_mcp '{"owner":"kitsunium","repo":"sdk","pullNumber":42}'
[ $RC -eq 0 ] && [ -z "$(decision)" ] && [ -n "$(ctx)" ] && ok "MCP merge allowed: the context line" || bad "mcp allow" "rc=$RC out=$OUT"
run_mcp '{"owner":"kitsunium","repo":"sdk","pullNumber":"42; x"}'
[ $RC -eq 0 ] && [ "$(calls)" = 0 ] && ok "MCP merge with a malformed number: no gate, allowed" || bad "mcp bad" "rc=$RC calls=$(calls)"
STUB_OUT=$DENY run_mcp '{"owner":"kitsunium","repo":"sdk","pullNumber":42}' agt9
[ $RC -eq 2 ] && [ "$(calls)" = 0 ] && ok "MCP merge from a subagent: still refused" || bad "mcp subagent" "rc=$RC calls=$(calls)"

echo "== the real probe, no network: a repository that is not on github.com"
unset KODFLOW_CODERABBIT_PROBE
git -C "$T/repo" remote add origin https://gitlab.example.invalid/a/b.git
run 'gh pr create --title t'
[ $RC -eq 0 ] && [ -z "$OUT" ] && ok "unknown remote: silence, rc 0" || bad "real probe" "rc=$RC out=$OUT err=$ERR"
python3 -I "$ROOT/plugins/kodflow-hooks/hooks/coderabbit/probe.py" capacity --action push --cwd "$T/repo" \
    | jq -e '.state == "unknown" and .api_calls == 0 and .context == ""' >/dev/null \
    && ok "the probe answers unknown, zero API calls" || bad "capacity json" "$(python3 -I "$ROOT/plugins/kodflow-hooks/hooks/coderabbit/probe.py" capacity --action push --cwd "$T/repo")"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
