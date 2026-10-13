#!/bin/bash
# test_lock.sh — hooks/scripts/lib/lock.sh, the mkdir lock that stands in for
# flock(1), absent on macOS: exclusion, timeout, release on exit, a stale lock
# broken, and on-agent.sh keeping every concurrent start in agents.json.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME=$T/home CLAUDE_CONFIG_DIR=$T/home/.claude CLAUDE_PROJECT_DIR=$T/repo
mkdir -p "$T/repo" "$T/home/.claude"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
. "$S/lib/lock.sh"
L=$T/x.lock.d

echo "== lib/lock.sh"
( kf_lock "$L" 1 && [ -d "$L" ] ) && ok "the lock is taken" || bad "take" "no lock dir"
[ -d "$L" ] && bad "release" "the lock survived its subshell" || ok "released when the subshell exits"
mkdir "$L"
start=$(date +%s)
( kf_lock "$L" 1 ) && bad "exclusion" "a held lock was taken twice" || ok "a held lock is refused"
[ $(( $(date +%s) - start )) -le 3 ] && ok "the wait ends after its timeout" || bad "timeout" "waited too long"
touch -t 200001010000 "$L"
( kf_lock "$L" 1 && [ -d "$L" ] ) && ok "a stale lock is broken and retaken" || bad "stale" "not broken"
left=$(find "$T" -maxdepth 1 -name '*stale*')
[ -n "$left" ] && bad "stale cleanup" "$left" || ok "the broken lock leaves nothing behind"
mkdir "$L"
( KF_LOCK_STALE=3600 kf_lock "$L" 1 ) && bad "fresh" "a fresh lock was broken" || ok "a fresh lock is not broken"
rmdir "$L"

echo "== on-agent.sh · concurrent starts"
i=0
while [ "$i" -lt 12 ]; do
    jq -n -c --arg id "a$i" '{session_id:"sess-lock",hook_event_name:"SubagentStart",agent_id:$id,agent_type:"Explore",cwd:"/nonexistent"}' \
        | bash "$S/on-agent.sh" >/dev/null 2>&1 &
    i=$((i + 1))
done
wait
AG=$CLAUDE_CONFIG_DIR/kodflow/sessions/sess-lock/agents.json
n=$(jq '.agents | length' "$AG" 2>/dev/null)
[ "$n" = 12 ] && ok "twelve concurrent starts: twelve agents recorded" || bad "concurrent starts" "recorded ${n:-none}"
[ -d "${AG%/*}/.agents.lock.d" ] && bad "lock left" "the lock dir remains" || ok "no lock left behind"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
