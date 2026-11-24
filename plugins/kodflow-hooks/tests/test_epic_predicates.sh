#!/bin/bash
# test_epic_predicates.sh — lib/epics.jq's `closed`, `idle` and `live_ids`
# against the shared fixture (tests/fixtures/epic-predicates.json), the same
# cases the mod (tasks.ts) and kodflow-hud read through the generated
# epic-predicates.ts. The fixture is read as a file: 1e999 reaches jq as
# written. `now` and `live` are passed with --argjson, as the hooks pass them.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=$HERE/../hooks/scripts/lib
FX=$HERE/fixtures/epic-predicates.json
pass=0 fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); printf 'FAIL %s\n  want %s\n  got  %s\n' "$1" "$2" "$3"; fi; }

now=$(jq '.now' "$FX"); live=$(jq -c '.live' "$FX")
got() { jq -c -L "$LIB" --argjson now "$now" --argjson live "$live" "include \"epics\"; .data as \$d | $1" "$FX"; }
check "closed: a finite number above 0, nothing else" "$(jq -c '.expect.closed' "$FX")" \
    "$(got '[$d.epics[] | select(closed) | .id]')"
check "idle: 24 h quiet, no live worker in progress, no user waiting" "$(jq -c '.expect.idle' "$FX")" \
    "$(got '[$d.epics[] | select(idle($d.tasks; $now; $live)) | .id]')"
check "active() leaves a closed epic out" "1" "$(got '$d | v2 | active("main")')"
check "active() is 0 on a closed active epic" "0" "$(got '$d | v2 | .active.main = 7 | active("main")')"
check "epic_rows leaves the closed epic out" "false" "$(got '$d | v2 | [epic_rows("main") | .id] | any(. == 7)')"
check "live_ids: not stopped, started within 12 h" '["a"]' \
    "$(jq -c -L "$LIB" -n --argjson now 100000 'include "epics"; live_ids({"a":{"started":99000,"stopped":null},"b":{"started":99000,"stopped":99500},"c":{"started":1,"stopped":null},"d":"x"}; $now)')"
check "review.jq leaves a closed epic's tasks out" "" \
    "$(jq -r -L "$LIB" -f "$LIB/review.jq" <<<'{"epics":[{"id":1,"title":"Shut","closed_at":5}],"tasks":[{"id":"1","epic":1,"status":"pending","subject":"x"}]}')"
printf 'epic predicates (jq): %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
