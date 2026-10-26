#!/usr/bin/env bash
# status-contract.sh — the status.json contract read by kodflow-hud: after two
# concurrent appenders, the incrementally folded status.json must equal what
# `hunt-ledger rebuild` computes from the whole ledger (compared with jq -S),
# and stay within 16 KiB. Throwaway HOME, no network. Exit 0 on success.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
BIN=$(cd "$HERE/../../../bin" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME=$T/home HUNT_OWNER_PID=$$ HUNT_LOURD=""
unset DBUS_SESSION_BUS_ADDRESS DISPLAY WAYLAND_DISPLAY HUNT_PUSH_TOKEN HUNT_TOKENS
export PATH="$BIN:$PATH"
S=$HOME/.local/state/hunt/contract
mkdir -p "$S"
echo '{"matrix":["c1","c2","c3"],"thresholds":{"cap":4,"resume_at":2}}' >"$S/scope.json"
hunt-ledger init contract >/dev/null

writer() { # ID
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    case $(( i % 6 )) in
      0) hunt-ledger append contract verdict "{\"pass\":1,\"cell\":\"c$(( i % 3 + 1 ))\",\"result\":\"clean\"}" ;;
      1) hunt-ledger append contract slot "{\"finding\":$i,\"repo\":\"r$1\"}" || true ;;
      2) hunt-ledger append contract forge-done "{\"op\":\"issue-create\",\"repo\":\"r$1\",\"issue\":$i}" ;;
      3) hunt-ledger append contract label "{\"repo\":\"r$1\",\"issue\":$(( i - 1 )),\"label\":\"hunt:fixed-local\"}" ;;
      4) hunt-ledger append contract codex "{\"repo\":\"r$1\",\"issue\":$i,\"result\":\"pending\"}" ;;
      5) hunt-ledger append contract decision "{\"repo\":\"r$1\",\"issue\":$i,\"title\":\"choice $1/$i\"}" ;;
    esac >/dev/null
  done
}
hunt-ledger append contract pass-start '{"n":1,"sha":"0123456789abcdef","cells_total":3}' >/dev/null
writer 1 & a=$!
writer 2 & b=$!
wait "$a"
wait "$b"

folded=$(jq -S . "$S/status.json")
rebuilt=$(hunt-ledger rebuild contract | jq -S .)
if [[ $folded != "$rebuilt" ]]; then
  echo "FAIL status.json differs from hunt-ledger rebuild" >&2
  diff <(printf '%s\n' "$folded") <(printf '%s\n' "$rebuilt") >&2 || true
  exit 1
fi
seq=$(hunt-ledger read contract | tail -n 1 | jq .seq)
[[ $(jq .seq "$S/status.json") == "$seq" ]] || { echo "FAIL status.seq != last ledger seq" >&2; exit 1; }
[[ $(wc -c <"$S/status.json") -le 16384 ]] || { echo "FAIL status.json over 16 KiB" >&2; exit 1; }
jq -e '.v == 1 and (.events | length) <= 20' "$S/status.json" >/dev/null || { echo "FAIL v or events bound" >&2; exit 1; }
echo "ok   status.json == hunt-ledger rebuild after two concurrent appenders (seq $seq)"
