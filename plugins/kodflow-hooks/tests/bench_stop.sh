#!/bin/bash
# bench_stop.sh — how long the Stop hook takes on a long session's state.
# Not part of run-tests.sh: a timing is no verdict on a shared CI runner.
# It builds a repository of DIRS directories, a CLAUDE.md in one in five, and
# an `edited` tracker of N lines (each file edited twice, as on-tool.sh
# appends one line per edit), then times on-stop.sh on four turns:
#   empty     no edit at all: the floor of the hook
#   first     every directory still to be reminded
#   again     the same tracker, every directory already reminded
#   grown     ten more edits since the last Stop
# and, with tasks.json, agents.json and agent-feedback.jsonl filled, the same
# floor with the task and feedback checks at work (`tasks`).
#   usage: bash bench_stop.sh [N=2000] [RUNS=5] [HOOK_SHELL=/bin/bash]
set -u
N=${1:-2000}; RUNS=${2:-5}; SH=${HOOK_SHELL:-/bin/bash}
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
T=$(mktemp -d)
trap 'sleep 0.3; rm -rf "$T" 2>/dev/null || { sleep 1; rm -rf "$T"; }' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude
unset KODFLOW_ROOT KODFLOW_STOP_TASKS KODFLOW_FEEDBACK CLAUDE_CODE_ENABLE_TODO_TOOLS CLAUDE_CODE_TASK_LIST_ID
SID=sess-bench SP=$T/tmp/sp
mkdir -p "$T/repo" "$CLAUDE_CONFIG_DIR" "$SP"
git -C "$T/repo" init -q

DIRS=$(( N / 20 )); [ "$DIRS" -ge 1 ] || DIRS=1
printf '# root\n' > "$T/repo/CLAUDE.md"
i=0
while [ "$i" -lt "$DIRS" ]; do
    d=$T/repo/pkg$((i % 10))/mod$i/sub
    mkdir -p "$d"
    [ $((i % 5)) -eq 0 ] && printf '# mod\n' > "${d%/sub}/CLAUDE.md"
    i=$((i + 1))
done
# N lines, N/2 distinct files spread over the directories
i=0
while [ "$i" -lt "$N" ]; do
    k=$(( (i / 2) % DIRS ))
    printf '%s/pkg%d/mod%d/sub/f%d.go\n' "$T/repo" $((k % 10)) "$k" $((i / 2))
    i=$((i + 1))
done > "$T/edited.full"

payload=$(jq -n -c --arg sid "$SID" --arg cwd "$T/repo" --arg sp "$SP" \
    '{session_id:$sid,hook_event_name:"Stop",cwd:$cwd,scratchpad_dir:$sp,stop_hook_active:false}')
ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'; }
# once LABEL → the duration of one Stop, in ms; the loop guard is reset first
once() {
    local t0 t1; rm -f "$SP/stop-count"
    t0=$(ms); printf '%s' "$payload" | "$SH" "$S/on-stop.sh" >/dev/null 2>&1; t1=$(ms)
    echo $((t1 - t0))
}
# median of RUNS runs of SETUP followed by one Stop
bench() {
    local label=$1 setup=$2 r=0 all=""
    while [ "$r" -lt "$RUNS" ]; do eval "$setup"; all="$all $(once)"; r=$((r + 1)); done
    printf '  %-6s median %5d ms   runs:%s\n' "$label" \
        "$(printf '%s\n' $all | sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}')" "$all"
}

echo "== on-stop.sh, $N lines in edited, $DIRS directories, $SH"
bench empty 'rm -f "$SP"/edited* "$SP"/claudemd-nudged*'
bench first 'cp "$T/edited.full" "$SP/edited"; rm -f "$SP"/claudemd-nudged* "$SP"/edited.*'
cp "$T/edited.full" "$SP/edited"; once >/dev/null
bench again ':'
bench grown 'head -n 10 "$T/edited.full" >> "$SP/edited"'

SD=$CLAUDE_CONFIG_DIR/kodflow/sessions/$SID; mkdir -p "$SD"
jq -n -c '{version:2,epics:[{id:1,title:"bench",status:"open"}],active:1,
    tasks:[range(0;200) | {id:(.+1|tostring),subject:"t\(.)",status:(if . % 3 == 0 then "completed" else "pending" end),epic:1,agent:"main"}]}' > "$SD/tasks.json"
jq -n -c --arg now "$(date +%s)" '{agents:([range(0;50) | {key:"a\(.)",value:{started:($now|tonumber),epic:1}}] | from_entries)}' > "$SD/agents.json"
i=0; while [ "$i" -lt 200 ]; do printf '{"agent_type":"x","definition":"/d.md","feedback":"f%d"}\n' "$i"; i=$((i + 1)); done > "$SD/agent-feedback.jsonl"
date +%s > "$SD/composer-at"
bench tasks 'rm -f "$SP"/edited* "$SP"/claudemd-nudged* "$SP/feedback-seen" "$SP/stop-said"'
