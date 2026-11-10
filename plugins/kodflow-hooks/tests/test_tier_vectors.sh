#!/bin/bash
# test_tier_vectors.sh — the shell judge against the shared vectors
# (tests/fixtures/tier-vectors.jsonl), the same file the mod's tier.test.ts
# reads through the generated tier-vectors.ts: frontmatter pins and mode
# resolution must agree between the two implementations. Also the quoting of
# the "turn it off" command. bash 3.2-safe.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LIB=$HERE/../hooks/scripts/lib
FX=$HERE/fixtures/tier-vectors.jsonl
command -v jq >/dev/null 2>&1 || { echo "jq not found, tier vectors skipped"; exit 0; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
# shellcheck source=/dev/null
. "$LIB/agents.sh"
# shellcheck source=/dev/null
. "$LIB/tier.sh"

pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

n=0
while IFS= read -r line; do
    [ -n "$line" ] || continue
    n=$((n+1))
    kind=$(printf '%s' "$line" | jq -r .kind)
    name=$(printf '%s' "$line" | jq -r .name)
    case "$kind" in
    frontmatter)
        key=$(printf '%s' "$line" | jq -r .key)
        want=$(printf '%s' "$line" | jq -r .pinned)
        printf '%s' "$line" | jq -j .text > "$T/def.md"
        got=false
        if kf_fm_field "$T/def.md" "$key" && _kf_tier_pinned "$KF_FM_FIELD" "$key"; then got=true; fi
        if [ "$got" = "$want" ]; then ok; else bad "frontmatter: $name" "got $got want $want"; fi ;;
    mode)
        rm -rf "$T/s" "$T/c"; mkdir -p "$T/s" "$T/c/kodflow"
        unset KODFLOW_TIER
        if [ "$(printf '%s' "$line" | jq -r '.env == null')" = false ]; then
            KODFLOW_TIER=$(printf '%s' "$line" | jq -r .env); export KODFLOW_TIER
        fi
        if [ "$(printf '%s' "$line" | jq -r '.session == null')" = false ]; then
            printf '%s' "$line" | jq -j .session > "$T/s/tier-mode"; fi
        if [ "$(printf '%s' "$line" | jq -r '.global == null')" = false ]; then
            printf '%s' "$line" | jq -j .global > "$T/c/kodflow/tier-mode"; fi
        if [ "$(printf '%s' "$line" | jq -r .skew)" = true ]; then : > "$T/s/tier-skew"; fi
        _kf_tier_mode "$T/s" "$T/c" "$T/s/tier-skew"
        src=$KT_MSRC
        case "$src" in
            "$T/s/tier-mode") src=session ;;
            "$T/c/kodflow/tier-mode") src=global ;;
        esac
        wm=$(printf '%s' "$line" | jq -r .mode); ws=$(printf '%s' "$line" | jq -r .source)
        if [ "$KT_MODE" = "$wm" ] && [ "$src" = "$ws" ]; then ok
        else bad "mode: $name" "got $KT_MODE/$src want $wm/$ws"; fi
        unset KODFLOW_TIER ;;
    esac
done < "$FX"

# The off command, as tier.ts's offCommand: quoted, an embedded ' as '\''.
got=$(_kf_tier_offcmd "/tmp/a b/it's/tier-mode")
want="printf off > '/tmp/a b/it'\\''s/tier-mode'"
if [ "$got" = "$want" ]; then ok; else bad "offcmd quoting" "got $got want $want"; fi
# ...and it runs: the file lands where the path says.
mkdir -p "$T/a b/it's"
( cd "$T" && eval "$(_kf_tier_offcmd "$T/a b/it's/tier-mode")" )
if [ "$(cat "$T/a b/it's/tier-mode" 2>/dev/null)" = off ]; then ok; else bad "offcmd runs" "no file written"; fi

printf 'tier vectors (shell): %s lines, %s passed, %s failed\n' "$n" "$pass" "$fail"
[ "$fail" -eq 0 ]
