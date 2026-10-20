#!/usr/bin/env bash
# sync-ktn-fixtures.sh [--pin | --check] — kodflow-ktn's golden view models
# are kodflow/ktn-linter's pkg/view/testdata/golden at the commit their
# SOURCE file pins (kodflow/ktn-linter#788: ktn-linter keeps the fixtures,
# this repository consumes them at a pinned version).
#
#   --pin    offline, what CI runs: SOURCE pins a 40-character sha, and
#            hooks/mod/contract.ts (KTN_LINTER_SHA) names the same one, so the
#            constants and the fixtures cannot move apart.
#   --check  a maintainer's check, through `gh` (ktn-linter is private, a
#            public CI cannot read it): every file is the pinned commit's,
#            byte for byte, and none is missing on either side.
#   (none)   rewrites the copies from the pinned commit; to move the pin,
#            edit sha= in SOURCE and KTN_LINTER_SHA first.
#
# Network only under --check and the rewrite, never at run time: the mod
# reads only the committed copy.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="${KTN_FIXTURES_DIR:-$root/plugins/kodflow-ktn/tests/fixtures/view}"
contract="${KTN_CONTRACT:-$root/plugins/kodflow-ktn/hooks/mod/contract.ts}"
mode="${1:-sync}"

field() { sed -n "s/^$1=//p" "$dir/SOURCE"; }
repo="$(field repo)"
path="$(field path)"
sha="$(field sha)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::SOURCE pins no 40-character sha"; exit 1; }
grep -q "KTN_LINTER_SHA = \"$sha\"" "$contract" \
  || { echo "::error::contract.ts KTN_LINTER_SHA is not SOURCE's sha $sha"; exit 1; }
if [ "$mode" = "--pin" ]; then
  echo "kodflow-ktn fixtures pinned at $repo@${sha:0:12}, contract.ts agrees"
  exit 0
fi

upstream="$(gh api "repos/$repo/contents/$path?ref=$sha" --jq '.[] | select(.type == "file") | .name' | sort)"
local_names="$(cd "$dir" && ls -1 | grep -v '^SOURCE$' | sort)"
fail=0
if [ "$upstream" != "$local_names" ]; then
  echo "::error::the fixture set differs from $repo@$sha:$path"
  diff <(printf '%s\n' "$upstream") <(printf '%s\n' "$local_names") || true
  fail=1
fi
tmp="$(mktemp -d "${TMPDIR:-/tmp}/ktn-fixtures.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
while IFS= read -r name; do
  [ -n "$name" ] || continue
  gh api -H "Accept: application/vnd.github.raw" "repos/$repo/contents/$path/$name?ref=$sha" > "$tmp/$name"
  if [ "$mode" = "--check" ]; then
    cmp -s "$tmp/$name" "$dir/$name" || { echo "::error::$name differs from $repo@$sha"; fail=1; }
  else
    cp "$tmp/$name" "$dir/$name"
  fi
done <<< "$upstream"
[ "$fail" -eq 0 ] && echo "kodflow-ktn fixtures: $repo@${sha:0:12}, byte for byte"
exit "$fail"
