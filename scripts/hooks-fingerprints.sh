#!/bin/bash
# hooks-fingerprints.sh — the published fingerprints of kodflow-hooks' guards.
#
# plugins/kodflow-hooks/hooks/fingerprints.sha256 holds the sha256 of every
# script whose change would weaken a guard. It ships with the plugin, so a
# session can tell an installed copy that was edited from the one that was
# published (on-session.sh, SessionStart). It is generated, never written by
# hand; CI runs --check so it cannot drift from the scripts.
#
#   bash scripts/hooks-fingerprints.sh          regenerate
#   bash scripts/hooks-fingerprints.sh --check  exit 1 when out of date
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
H=$ROOT/plugins/kodflow-hooks/hooks
OUT=$H/fingerprints.sha256
FILES="scripts/on-tool.sh scripts/lib/agents.sh gated-models.txt ../merge-exemptions.txt patterns/patterns.txt patterns/patterns-strict.txt"

sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

want=$(for f in $FILES; do printf '%s  %s\n' "$(sha "$H/$f")" "$f"; done)
if [ "${1:-}" = --check ]; then
    if [ "$want" = "$(cat "$OUT" 2>/dev/null)" ]; then echo "fingerprints up to date"; exit 0; fi
    echo "fingerprints.sha256 is stale: run bash scripts/hooks-fingerprints.sh" >&2
    diff <(printf '%s\n' "$want") "$OUT" >&2 || true
    exit 1
fi
printf '%s\n' "$want" > "$OUT"
echo "wrote $OUT"
