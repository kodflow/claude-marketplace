#!/bin/bash
# test_detect_models.sh — detect-models.sh picks the orchestrator's model
# without guessing and without letting a gated one through.
#
# Every case runs a copy of the detector against a fake HOME, so the machine's
# own ~/.claude.json never decides what is asserted.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SRC=$ROOT/plugins/kodflow-workflow/skills/_shared
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
# key VALUE-expected LABEL → reads $OUT
key() { local got; got=$(printf '%s\n' "$OUT" | sed -n "s/^$1=//p"); [ "$got" = "$2" ] && ok "$3" || bad "$3" "$1=[$got], want [$2]"; }

cp -R "$SRC" "$T/_shared"
D=$T/_shared/scripts/detect-models.sh
H=$T/home; mkdir -p "$H"
run() { OUT=$(HOME=$H bash "$D" 2>/dev/null); }

run
key CLAUDE_TOP_UNGATED "" "no cache: no model guessed"
key CLAUDE_GATED fable "the shipped list is read"

printf '{"additionalModelOptionsCache":[{"value":"claude-fable-5-1","description":"Most capable"}]}' > "$H/.claude.json"
run
key CLAUDE_TOP claude-fable-5-1 "CLAUDE_TOP is the cache's most capable"
key CLAUDE_TOP_UNGATED opus "a cache with only gated models: the opus alias"

printf '{"additionalModelOptionsCache":[{"value":"claude-fable-5-1","description":"Most capable"},{"value":"claude-opus-6-0","description":"Opus 6"}]}' > "$H/.claude.json"
run
key CLAUDE_TOP_UNGATED claude-opus-6-0 "the first ungated entry when the top one is gated"

printf 'fable   # a note\n' > "$T/_shared/gated-models.txt"; run
key CLAUDE_GATED fable "a trailing comment keeps its token"
rm -f "$T/_shared/gated-models.txt"; run
key CLAUDE_GATED fable "an unreadable list falls back to the policy's model"
key CLAUDE_TOP_UNGATED claude-opus-6-0 "so Fable is never reported ungated"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
