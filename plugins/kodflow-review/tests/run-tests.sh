#!/bin/bash
# run-tests.sh — kodflow-review's own suite. No claude CLI, no network: every
# input is synthetic, built in a tempdir. Runs under bash 3.2 and bash 5; CI's
# guard job finds it ("Plugins test themselves").
#
#   1. /improve's layout: the skill, its executable collector, and the rules it
#      points to instead of restating (single source).
#   2. collect.py on a fake config dir and a fake marketplace tree: every
#      attribution path, dedupe across sessions, the filters, malformed lines,
#      the ledger and its refusals.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
PLUG=$(cd "$HERE/.." && pwd)
SKILL=$PLUG/skills/improve
COLLECT=$SKILL/scripts/collect.py
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "${2:-}"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "want [$3] got [$2]"; fi; }
PY=python3
command -v python3.9 >/dev/null 2>&1 && PY=python3.9

echo "== /improve layout"
[ -f "$SKILL/SKILL.md" ] && ok "SKILL.md present" || bad "SKILL.md present"
[ -x "$COLLECT" ] && ok "collect.py executable" || bad "collect.py executable"
sed -n '2,/^---$/p' "$SKILL/SKILL.md" | grep -qx 'name: improve' && ok "name: improve" || bad "name: improve"
# Single source: the delivery and copy rules are pointed to, never restated.
grep -q 'Who delivers a change' "$SKILL/SKILL.md" && ok "points to « Who delivers a change »" || bad "points to « Who delivers a change »"
grep -q 'Plan review mode' "$SKILL/SKILL.md" && ok "points to « Plan review mode »" || bad "points to « Plan review mode »"
grep -q 'has `Edit` and `Write`' "$SKILL/SKILL.md" && bad "does not restate the delivery rule" || ok "does not restate the delivery rule"
grep -q 'AskUserQuestion' "$SKILL/SKILL.md" && ok "asks before opening" || bad "asks before opening"

echo "== collect.py"
CFG=$T/cfg; TREE=$T/tree; S=$CFG/kodflow/sessions
mkdir -p "$S/s1" "$S/s2" "$S/s3" "$TREE/plugins/kodflow-specialists/agents" \
         "$TREE/plugins/kodflow-workflow/skills/plan" "$TREE/plugins/kodflow-workflow/skills/fix" \
         "$TREE/plugins/kodflow-hooks/hooks"
: > "$TREE/plugins/kodflow-specialists/agents/developer-specialist-go.md"
: > "$TREE/plugins/kodflow-workflow/skills/plan/SKILL.md"
: > "$TREE/plugins/kodflow-workflow/skills/fix/SKILL.md"
now=$(date +%s); old=$((now - 40 * 86400))
GO="$CFG/plugins/cache/kodflow/kodflow-specialists/abc123/agents/developer-specialist-go.md"
rec() { # sid ts agent_type definition owner feedback
    printf '{"ts":%s,"sid":"%s","agent_type":"%s","agent_id":"a1","model":"claude-sonnet-5-5","effort":"high","source":"tool_result","definition":%s,"owner":"%s","feedback":"%s"}\n' \
        "$2" "$1" "$3" "$4" "$5" "$6"
}
{
    rec s1 "$now" kodflow-specialists:developer-specialist-go "\"$GO\"" kodflow "Scope omits git show."
    rec s1 "$now" kodflow-gamedev:rig-specialist-ik null local "The IK chain order is unstated."
    rec s1 "$now" general-purpose null local "kodflow-workflow:plan does not say where the plan goes."
    rec s1 "$now" general-purpose null local "The /fix skill should name the tracker."
    rec s1 "$now" general-purpose null local "The SubagentStart rules of kodflow-hooks repeat twice."
    rec s1 "$now" general-purpose null local "The brief named the wrong branch."
    rec s1 "$now" my-agent "\"$T/proj/.claude/agents/my-agent.md\"" local "My own agent lacks a tool."
    echo 'not json'
    echo '{"ts":1,"feedback":""}'
} > "$S/s1/agent-feedback.jsonl"
{
    rec s2 "$now" kodflow-specialists:developer-specialist-go "\"$GO\"" kodflow "scope omits  git show"
    rec s2 "$old" kodflow-specialists:developer-specialist-go "\"$GO\"" kodflow "An old need."
} > "$S/s2/agent-feedback.jsonl"

out=$($PY "$COLLECT" --config "$CFG" --tree "$TREE" 2>"$T/err")
check "exit 0" "$?" 0
check "malformed lines counted on stderr" "$(grep -c '2 malformed' "$T/err")" 1
q() { printf '%s\n' "$out" | $PY -c "import json,sys
rows=[json.loads(l) for l in sys.stdin if l.strip()]
$1"; }
check "cache definition -> agent file" \
    "$(q 'print([r["count"] for r in rows if r["target"]=="plugins/kodflow-specialists/agents/developer-specialist-go.md"][0])')" 3
check "exact duplicate merged across sessions" \
    "$(q 'r=[r for r in rows if r["target"].endswith("developer-specialist-go.md")][0]; print(r["sessions"], len(r["needs"]), r["needs"][0]["count"])')" "2 2 2"
check "namespaced type without definition -> agent file" \
    "$(q 'print(sum(r["target"]=="plugins/kodflow-gamedev/agents/rig-specialist-ik.md" and r["kind"]=="agent" for r in rows))')" 1
check "plugin:skill in the text -> skill" \
    "$(q 'print(sum(r["target"]=="plugins/kodflow-workflow/skills/plan/SKILL.md" and r["kind"]=="skill" for r in rows))')" 1
check "/skill in the text -> skill" \
    "$(q 'print(sum(r["target"]=="plugins/kodflow-workflow/skills/fix/SKILL.md" for r in rows))')" 1
check "kodflow-hooks in the text -> hook" \
    "$(q 'print(sum(r["target"]=="plugins/kodflow-hooks/" and r["kind"]=="hook" for r in rows))')" 1
check "nothing named -> brief" "$(q 'print([r["count"] for r in rows if r["kind"]=="brief"][0])')" 1
check "definition outside kodflow -> external" "$(q 'print(sum(r["kind"]=="external" for r in rows))')" 1
check "agents first, external last" "$(q 'print(rows[0]["kind"], rows[-1]["kind"])')" "agent external"

out=$($PY "$COLLECT" --config "$CFG" 2>/dev/null)
check "without --tree a built-in's feedback is brief" "$(q 'print([r["count"] for r in rows if r["kind"]=="brief"][0])')" 4

out=$($PY "$COLLECT" --config "$CFG" --tree "$TREE" --session s2 2>/dev/null)
check "--session" "$(q 'print(len(rows), rows[0]["count"])')" "1 2"
out=$($PY "$COLLECT" --config "$CFG" --tree "$TREE" --since 7 --session s2 2>/dev/null)
check "--since" "$(q 'print(rows[0]["count"])')" 1
out=$($PY "$COLLECT" --config "$CFG" --tree "$TREE" --agent kodflow-gamedev:rig-specialist-ik 2>/dev/null)
check "--agent" "$(q 'print(len(rows))')" 1
out=$($PY "$COLLECT" --config "$CFG" --tree "$TREE" --target plugins/kodflow-workflow/ 2>/dev/null)
check "--target" "$(q 'print(len(rows))')" 2

L=$T/ledger/handled.tsv
out=$($PY "$COLLECT" --config "$CFG" --tree "$TREE" --session s2 --since 7 2>/dev/null)
key=$(q 'print(rows[0]["needs"][0]["key"])')
$PY "$COLLECT" --handled "$L" --mark "$key=delivered" && ok "--mark writes the ledger" || bad "--mark writes the ledger"
check "ledger line" "$(cut -f1,2 "$L")" "$key	delivered"
out=$($PY "$COLLECT" --config "$CFG" --tree "$TREE" --session s2 --handled "$L" 2>/dev/null)
check "a recorded need is not reported again" "$(q 'print(rows[0]["count"], rows[0]["needs"][0]["text"])')" "1 An old need."
$PY "$COLLECT" --handled "$L" --mark "$key=maybe" 2>/dev/null && bad "unknown verdict refused" || ok "unknown verdict refused"
$PY "$COLLECT" --handled "$L" --mark "zz=open" 2>/dev/null && bad "malformed key refused" || ok "malformed key refused"
$PY "$COLLECT" --mark "$key=open" 2>/dev/null && bad "--mark without --handled refused" || ok "--mark without --handled refused"
$PY "$COLLECT" --config "$CFG" --tree "$T/nowhere" >/dev/null 2>&1 && bad "a tree without plugins/ refused" || ok "a tree without plugins/ refused"
out=$($PY "$COLLECT" --config "$T/empty" 2>&1); rc=$?
check "no feedback: exit 0, no output" "$rc:$out" "0:"

echo
echo "kodflow-review: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
