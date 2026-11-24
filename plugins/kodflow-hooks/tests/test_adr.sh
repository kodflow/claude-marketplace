#!/bin/bash
# test_adr.sh — the ADR header contract: lib/adr_lint.py on fixtures (both
# bullet styles, MADR front matter), and the hook's switch KODFLOW_ADR_LINT
# (a new ADR without Need refused by default and strict, allowed under warn and
# off; an existing one only warned about). bash 3.2-safe.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
FX=$ROOT/plugins/kodflow-hooks/tests/fixtures/adr
T=$(mktemp -d)
trap 'rm -rf "$T" 2>/dev/null' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude KODFLOW_ROOT=off
unset KODFLOW_ADR_LINT KODFLOW_MOD
R=$T/repo; A=$R/docs/adr
mkdir -p "$A" "$T/tmp/sp" "$CLAUDE_CONFIG_DIR"
git -C "$R" init -q
cp "$FX"/* "$A"/

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
expect() { [ "$2" = "$3" ] && ok "$1" || bad "$1" "want '$3', got '$2'"; }

echo "== adr_lint --check"
L=$S/lib/adr_lint.py
for f in 0001-plain-bullets 0002-bold-bullets 0003-front-matter; do
    out=$(python3 -I "$L" --check "$FX/$f.md"); expect "$f parses clean" "$out" ""
done
out=$(python3 -I "$L" --check "$FX/0004-missing-area-need.md"); rc=$?
expect "warn mode exits 0" "$rc" 0
case $out in *"missing Area"*"missing Need"*) ok "lists the missing Area and Need" ;; *) bad "missing lines" "$out" ;; esac
python3 -I "$L" --check "$FX/0004-missing-area-need.md" --strict >/dev/null; expect "--strict exits 1" "$?" 1
python3 -I "$L" --check "$FX" --strict >/dev/null; expect "--strict on the dir exits 1" "$?" 1
printf -- '- Status: Accepted\n- Date: 2026-11-04\n- Area: unknown\n- Need: whim\n' > "$T/0009-bad.md"
out=$(python3 -I "$L" --check "$T/0009-bad.md")
case $out in *"Need 'whim'"*) ok "closed Need set enforced" ;; *) bad "need" "$out" ;; esac
printf -- '- Status: Accepted\n- Date: 2026-11-04\n- Area: net\n- Need: record\n' > "$T/0007-ok.md"
printf 'proc\n' > "$T/areas.txt"
out=$(python3 -I "$L" --check "$T/0007-ok.md")
case $out in *"Area 'net' not in areas.txt"*) ok "Area checked against areas.txt" ;; *) bad "area vocab" "$out" ;; esac
printf -- '- Status: Accepted\n' > "$T/0005-dup.md"; printf -- '- Status: Accepted\n' > "$T/0005-other.md"
case $(python3 -I "$L" --check "$T") in *"number 0005 is used by"*) ok "duplicate number" ;; *) bad "dup" "" ;; esac
printf -- '- Status: Superseded by 0099\n' > "$T/0006-gone.md"
case $(python3 -I "$L" --check "$T/0006-gone.md") in *"superseded by 0099: no such ADR"*) ok "supersede target must exist" ;; *) bad "supersede" "" ;; esac

echo "== hook · switch KODFLOW_ADR_LINT"
NEW=$A/0010-new-decision.md
CONTENT=$(printf -- '# 0010. New\n\n- Status: Proposed\n- Date: 2026-11-24\n- Area: net\n\n## Context\nx\n')
GOOD=$(printf -- '# 0010. New\n\n- **Status**: Proposed\n- **Date**: 2026-11-24\n- **Area**: net\n- **Need**: decision\n\n## Context\nx\n')
pre() {   # $1 tool, $2 json tool_input → RC
    jq -n -c --arg t "$1" --argjson i "$2" '{session_id:"s-adr",cwd:env.CLAUDE_PROJECT_DIR,hook_event_name:"PreToolUse",tool_name:$t,tool_input:$i,tool_use_id:"t1"}' \
        | bash "$S/on-tool.sh" >"$T/out" 2>"$T/err"; RC=$?
}
W=$(jq -n -c --arg f "$NEW" --arg c "$CONTENT" '{file_path:$f,content:$c}')
for m in "" strict; do
    KODFLOW_ADR_LINT=$m pre Write "$W"; expect "new ADR without Need refused (${m:-default})" "$RC" 2
    grep -q "adr-lint" "$T/err" && ok "  names the motif" || bad "motif" "$(cat "$T/err")"
done
for m in warn off; do KODFLOW_ADR_LINT=$m pre Write "$W"; expect "new ADR without Need allowed ($m)" "$RC" 0; done
pre Write "$(jq -n -c --arg f "$NEW" --arg c "$GOOD" '{file_path:$f,content:$c}')"; expect "complete new ADR allowed" "$RC" 0
E=$(jq -n -c --arg f "$A/0004-missing-area-need.md" '{file_path:$f,old_string:"Accepted",new_string:"Proposed"}')
pre Edit "$E"; expect "existing ADR edit allowed by default" "$RC" 0
KODFLOW_ADR_LINT=strict pre Edit "$E"; expect "existing ADR edit refused in strict" "$RC" 2
pre Write "$(jq -n -c --arg f "$T/repo/notes/0010-x.md" --arg c "$CONTENT" '{file_path:$f,content:$c}')"; expect "outside docs/adr untouched" "$RC" 0

echo "== hook · PostToolUse context on an existing ADR"
post() {
    jq -n -c --arg f "$A/0004-missing-area-need.md" '{session_id:"s-adr",cwd:env.CLAUDE_PROJECT_DIR,hook_event_name:"PostToolUse",tool_name:"Edit",tool_input:{file_path:$f},tool_use_id:"t2"}' \
        | bash "$S/on-tool.sh" 2>/dev/null; }
CTX=$(post | jq -r '.hookSpecificOutput.additionalContext // empty')
case $CTX in *"missing Area"*) ok "defects returned as additionalContext" ;; *) bad "post ctx" "$CTX" ;; esac
CTX=$(KODFLOW_ADR_LINT=off post | jq -r '.hookSpecificOutput.additionalContext // empty'); expect "off is silent" "$CTX" ""

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" = 0 ]
