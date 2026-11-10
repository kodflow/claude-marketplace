#!/bin/bash
# test_scope.sh — the Command scope advice of on-tool.sh (#155, lib/scope.sh):
# a kodflow-specialists subagent's shell call is compared with the families
# its own definition declares, the Plan review inspection commands counted.
# Outside, the call still exits 0 and carries one additionalContext line;
# inside, nothing is printed. Never a refusal, never a rewritten command, and
# every miss (no definition, no scope, no jq, a broken file, the switch off)
# is silence. The payload is tests/fixtures/specialist-bash.jsonl, the shape
# PreToolUse Bash carries from inside a plugin subagent. The definitions are
# the shipped ones of kodflow-specialists, installed as the CLI lays them out.
# bash 3.2-safe: macOS CI runs it with /bin/bash.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts/on-tool.sh
FX=$ROOT/plugins/kodflow-hooks/tests/fixtures/specialist-bash.jsonl
SH=${HOOK_SHELL:-bash}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude
unset KODFLOW_SCOPE KODFLOW_ROOT KODFLOW_MOD KODFLOW_FABLE
CFG=$CLAUDE_CONFIG_DIR
SID=sess-scope
SD=$CFG/kodflow/sessions/$SID
mkdir -p "$T/repo" "$CFG/plugins" "$T/tmp/sp"
cd "$T" || exit 1

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
check() { if [ "$2" = yes ]; then ok "$1"; else bad "$1" "${3:-}"; fi; }
# Not a case inside $( ): bash 3.2 misreads its `)`.
has() { case "$1" in *"$2"*) return 0 ;; esac; return 1; }

printf '{"version":2,"plugins":{"kodflow-specialists@kodflow":[{"scope":"user","installPath":"%s"}]}}\n' \
    "$ROOT/plugins/kodflow-specialists" > "$CFG/plugins/installed_plugins.json"

# call COMMAND [AGENT_TYPE] [AGENT_ID] → OUT the hook's stdout, RC its exit code
# Each call is a new subagent unless AGENT_ID is given: the advice is said
# once per agent and command.
N=0
call() {
    N=$((N+1))
    jq -c --arg c "$1" --arg t "${2:-kodflow-specialists:developer-specialist-go}" --arg a "${3-agent$N}" \
            --arg sid "$SID" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" \
            '.payload | .tool_input.command = $c | .agent_type = $t | .agent_id = $a
             | .session_id = $sid | .cwd = $cwd | .scratchpad_dir = $sp
             | if $a == "" then del(.agent_id) else . end' "$FX" | "$SH" "$S" >"$T/out" 2>"$T/err"
    RC=$?
    OUT=$(cat "$T/out")
}
advice() { printf '%s' "$1" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null; }
silent() {   # $1 label, $2 command, $3.. call args
    local l=$1 c=$2; shift 2
    call "$c" "$@"
    check "$l" "$([ "$RC" = 0 ] && [ -z "$(advice "$OUT")" ] && echo yes)" "rc=$RC out=$OUT"
}
outside() {  # $1 label, $2 command, $3 what the advice must name, $4.. call args
    local l=$1 c=$2 want=$3 a; shift 3
    call "$c" "$@"
    a=$(advice "$OUT")
    check "$l" "$([ "$RC" = 0 ] && has "$a" "COMMAND SCOPE" && has "$a" "$want" && echo yes)" "rc=$RC advice=$a"
}

echo "-- in scope: nothing said"
silent "go vet ./... (Bash(go:*))" "go vet ./..."
silent "git log with global options walked past" "git -C $T/repo --no-pager log --oneline -3"
silent "rtk prefix walked past" "rtk git diff HEAD~1"
silent "env prefix and VAR= walked past" "GOFLAGS=-mod=readonly env GOPROXY=off go test ./..."
silent "grep, piped into ls" "grep -rn foo . | ls"
silent "cd then go, plumbing ignored" "cd $T/repo && echo start && go build ./..."
silent "Plan review inspection: git cat-file" "git cat-file -p HEAD:go.mod"
silent "Plan review inspection: gh pr view" "gh pr view 12 --json title"
silent "Plan review inspection: neutralised git archive" "git -c filter.lfs.smudge= -c filter.lfs.process= -c filter.lfs.required=false archive --format=tar -o $T/tmp/sp/tree.tar HEAD"
silent "Plan review inspection: python3 -m tarfile extract" "python3 -m tarfile --filter data -e $T/tmp/sp/tree.tar $T/tmp/sp/tree"
silent "a command word the reader cannot see is not reported" 'c=go; $c vet'

echo "-- outside: advice, call goes on"
outside "sed is outside the Go specialist's scope" "sed -n 1,5p go.mod" "sed"
outside "a pipe's second command is read" "go list ./... | head -3" "head"
outside "git commit: a subform outside, named with its verb" "git commit -m x" "git commit"
outside "gh pr create is not gh pr view" "gh pr create --fill" "gh pr"
outside "nested bash -c is read" "bash -c 'curl -s https://example.org'" "curl"
outside "several are named once each" "awk 1 go.mod; awk 2 go.mod; sed -n 1p x" "runs: awk, sed."
call "make test && runcap go test"; out=$OUT
a=$(advice "$out")
check "every outside command is named" "$(has "$a" "make, runcap" && echo yes)" "$a"
check "the advice names the agent and that the call goes on" "$(has "$a" "kodflow-specialists:developer-specialist-go" && has "$a" "The call goes on" && echo yes)" "$a"
check "the inspection commands are said to be counted" "$(has "$a" "Plan review inspection commands counted" && echo yes)" "$a"
check "one JSON document on stdout" "$([ "$(printf '%s\n' "$out" | grep -c .)" = 1 ] && printf '%s' "$out" | jq -e . >/dev/null 2>&1 && echo yes)" "$out"
check "nothing on stderr" "$([ ! -s "$T/err" ] && echo yes)" "$(cat "$T/err")"
check "journal line written with the commands" "$(tail -n 1 "$SD/scope.jsonl" 2>/dev/null | jq -e '.outside | test("make")' >/dev/null 2>&1 && echo yes)"
check "the journal does not keep the command line" "$(grep -c 'runcap go test' "$SD/scope.jsonl" 2>/dev/null | grep -qx 0 && echo yes)"

echo "-- said once per agent and command"
call "head -1 go.mod" kodflow-specialists:developer-specialist-go same1
check "first time: said" "$(has "$(advice "$OUT")" "runs: head." && echo yes)" "$OUT"
call "head -2 go.mod" kodflow-specialists:developer-specialist-go same1
check "second time, same agent: silent" "$([ "$RC" = 0 ] && [ -z "$(advice "$OUT")" ] && echo yes)" "$OUT"
call "head -2 go.mod | tail -1" kodflow-specialists:developer-specialist-go same1
check "a new command of the same agent: only it is said" "$(has "$(advice "$OUT")" "runs: tail." && echo yes)" "$OUT"
call "head -1 go.mod" kodflow-specialists:developer-specialist-go other1
check "another agent is told again" "$(has "$(advice "$OUT")" "runs: head." && echo yes)" "$OUT"
check "the journal keeps every call" "$([ "$(grep -c '"agent_id":"same1"' "$SD/scope.jsonl")" = 3 ] && echo yes)"
call "sed -n 's/x/github-secret/p' f" kodflow-specialists:developer-executor-correctness
check "an argument is never copied into the advice" "$(has "$(advice "$OUT")" "runs: sed." && ! grep -q github-secret "$SD/scope.jsonl" && echo yes)" "$OUT"

echo "-- an existing guard still wins and the advice rides with a notice"
call "git push --force origin feat"
check "a forced push is still refused (exit 2)" "$([ "$RC" = 2 ] && echo yes)" "rc=$RC"
call "git log -1 && wc -l go.mod"
check "a git line that passes the guards carries the advice" "$([ "$RC" = 0 ] && has "$(advice "$OUT")" "runs: wc." && echo yes)" "rc=$RC out=$OUT"

echo "-- scopes read from the definitions"
outside "executor-correctness: grep is not in its scope" "grep -rn x ." "grep" kodflow-specialists:developer-executor-correctness
silent "executor-correctness: go vet is" "go vet ./..." kodflow-specialists:developer-executor-correctness
silent "systemd: a prose bullet's leading forms count (grep -n)" "grep -n Type= $T/tmp/sp/x.txt" kodflow-specialists:domain-specialist-systemd
outside "systemd: a form the bullet forbids after its list does not (sed -i)" "sed -i s/a/b/ $T/tmp/sp/x.txt" "sed" kodflow-specialists:domain-specialist-systemd

echo "-- silence on every miss"
silent "main thread (no agent_id)" "sed -n 1p x" kodflow-specialists:developer-specialist-go ""
silent "a non-specialist subagent" "sed -n 1p x" general-purpose
silent "a bare name is not trusted to be the plugin's" "sed -n 1p x" developer-specialist-go
silent "an agent with no Command scope section" "sed -n 1p x" kodflow-specialists:data-specialist-postgres
silent "an unknown specialist" "sed -n 1p x" kodflow-specialists:nosuch
silent "a name that is not a file name" "sed -n 1p x" "kodflow-specialists:../x"
KODFLOW_SCOPE=off silent "KODFLOW_SCOPE=off" "sed -n 1p x"
mkdir -p "$CFG/kodflow"; echo off > "$CFG/kodflow/scope-mode"
silent "scope-mode file off" "sed -n 1p x"
rm -f "$CFG/kodflow/scope-mode"
printf '{not json' > "$CFG/plugins/installed_plugins.json"
silent "unreadable installed_plugins.json" "sed -n 1p x"
printf '{"version":2,"plugins":{"kodflow-specialists@kodflow":[{"installPath":"%s"}]}}\n' "$T/broken" > "$CFG/plugins/installed_plugins.json"
mkdir -p "$T/broken/agents"; printf '\000\001garbage' > "$T/broken/agents/developer-specialist-go.md"
silent "a definition that is not markdown" "sed -n 1p x"
chmod 000 "$T/broken/agents/developer-specialist-go.md"
silent "an unreadable definition" "sed -n 1p x"
chmod 644 "$T/broken/agents/developer-specialist-go.md"
PATH_SAVE=$PATH
mkdir -p "$T/nojq"; for b in bash sh cat tr date mkdir awk sed grep head printf; do p=$(command -v $b) && ln -sf "$p" "$T/nojq/$b"; done
out=$(jq -c '.payload | .tool_input.command = "sed -n 1p x"' "$FX" | PATH=$T/nojq "$SH" "$S" 2>/dev/null); RC=$?
PATH=$PATH_SAVE
check "no jq: exit 0, nothing printed" "$([ "$RC" = 0 ] && [ -z "$out" ] && echo yes)" "rc=$RC out=$out"

echo "-- the command is never rewritten"
check "no updatedInput anywhere in the hook" "$(grep -c 'updatedInput' "$ROOT/plugins/kodflow-hooks/hooks/scripts/lib/scope.sh" | grep -qx 0 && echo yes)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" = 0 ]
