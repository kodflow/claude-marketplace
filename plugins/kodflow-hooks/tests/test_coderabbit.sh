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

echo "== gh pr merge: one context line, never a command"
run_main() {   # the main thread's Bash call (no agent_id): the one that may merge
    local json; json=$(jq -n -c --arg c "$1" --arg cwd "$T/repo" \
        '{session_id:"s1",hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_use_id:"t2",tool_input:{command:$c}}')
    : > "$STUB_LOG"
    OUT=$(printf '%s' "$json" | bash "$S/on-tool.sh" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
}
export STUB_OUT='{"schema_version":1,"repo":"o/r","pr":42,"head":"abc1234def","covered":false,"eligible":true,"reason":"eligible"}' STUB_RC=0
mkdir -p "$T/policy"
KODFLOW_CODERABBIT_POLICY_DIR=$T/policy run_main 'gh pr merge 42 --squash --match-head-commit abc1234def'
[ $RC -eq 0 ] && [ "$(ctx)" = "CodeRabbit on PR #42: head abc1234def covered=false eligible=true" ] \
    && ok "merge: head, covered, eligible in one line" || bad "merge line" "rc=$RC out=$OUT err=$ERR"
printf '%s' "$OUT" | jq -e '.hookSpecificOutput | has("permissionDecision") | not' >/dev/null && ok "merge: information only" || bad "merge decision" "$OUT"
grep -q -- '^covered .*--pr 42' "$STUB_LOG" && grep -q -- "--policy-dir $T/policy" "$STUB_LOG" && grep -q -- '--deadline 4' "$STUB_LOG" \
    && ok "merge: covered --pr N --policy-dir, 4 s deadline" || bad "merge args" "$(cat "$STUB_LOG")"
KODFLOW_CODERABBIT_POLICY_DIR=$T/no-such-dir HOME=$T/home run_main 'gh pr merge 42'
! grep -q -- '--policy-dir' "$STUB_LOG" && ok "merge: no policy directory, no --policy-dir (eligible unknown)" || bad "no policy" "$(cat "$STUB_LOG")"
run_main 'gh pr merge https://github.com/kodflow/labs/pull/7 --squash'
grep -q -- '--pr 7' "$STUB_LOG" && grep -q -- '--repo kodflow/labs' "$STUB_LOG" && ok "merge: a PR URL gives repo and number" || bad "merge url" "$(cat "$STUB_LOG")"
run_main 'gh pr merge feat/x --rebase'
grep -q -- '--branch feat/x' "$STUB_LOG" && ok "merge: a branch operand" || bad "merge branch" "$(cat "$STUB_LOG")"
run_main 'gh pr merge --squash -t "feat: 9"'
! grep -q -- '--pr\|--branch' "$STUB_LOG" && grep -q -- "--cwd $T/repo" "$STUB_LOG" && ok "merge: no operand, the checked-out branch" || bad "merge none" "$(cat "$STUB_LOG")"
run_main 'gh pr merge 42 -R kitsunium/sdk'
grep -q -- '--repo kitsunium/sdk' "$STUB_LOG" && ok "merge: -R after the operand" || bad "merge -R" "$(cat "$STUB_LOG")"
export STUB_OUT='{"schema_version":1,"pr":42,"head":"abc1234def","covered":"unknown","eligible":false,"reason":"draft"}'
run_main 'gh pr merge 42'
[ "$(ctx)" = "CodeRabbit on PR #42: head abc1234def covered=unknown eligible=false (draft)" ] && ok "merge: the reason of an ineligible PR" || bad "merge reason" "$OUT"
export STUB_OUT='{"schema_version":1,"pr":null,"head":null,"covered":"unknown","eligible":"unknown","error":"x"}'
run_main 'gh pr merge 42'
[ $RC -eq 0 ] && [ -z "$(ctx)" ] && ok "merge: no head known, silence" || bad "merge silence" "rc=$RC out=$OUT"
STUB_RC=1 run_main 'gh pr merge 42'
[ $RC -eq 0 ] && [ -z "$(ctx)" ] && ok "merge: probe fails, silence, rc 0" || bad "merge fail open" "rc=$RC out=$OUT"
run 'gh pr merge 42'
[ $RC -eq 2 ] && ok "a subagent's merge is still refused" || bad "subagent merge" "rc=$RC out=$OUT"

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
