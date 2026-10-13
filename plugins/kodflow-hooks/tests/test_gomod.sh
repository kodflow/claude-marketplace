#!/bin/bash
# test_gomod.sh — hooks/scripts/lib/gomod.sh against tests/fixtures/gomod.json,
# the fixtures hooks/mod/lint.ts is held to as well (run-node.ts): the same
# answer for every case, on a real file system. Needs jq.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
FX=$ROOT/plugins/kodflow-hooks/tests/fixtures/gomod.json
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
T=$(cd "$T" && pwd -P)

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
. "$S/lib/gomod.sh"

echo "== lib/gomod.sh · tests/fixtures/gomod.json"
while IFS= read -r f; do
    mkdir -p "$T/${f%/*}" && : > "$T/$f"
done < <(jq -r '.tree[]' "$FX")

while IFS=$'\t' read -r name root file dir module; do
    # kf_gomod starts from a file's directory: a directory is given as dir/.
    path=$T/$file; [ "$dir" = true ] && path=$path/.
    if kf_gomod "$path" "$T/$root"; then got=${KF_GOMOD#$T/}; else got=null; fi
    [ "$got" = "$module" ] && ok "$name" || bad "$name" "want $module, got $got"
done < <(jq -r '.cases[] | [.name, .root, .file, (.dir // false), (.module // "null")] | @tsv' "$FX")

echo "== lib/gomod.sh · a list of files"
list="$T/repo/README.md
$T/repo/projects/making.codes/cmd/app/main.go
$T/repo/projects/making.codes/tools/gen/gen.go
$T/repo/projects/making.codes/go.mod
$T/repo/scripts/x.sh"
kf_gomods "$T/repo" <<<"$list"
want="$T/repo/projects/making.codes
$T/repo/projects/making.codes/tools/gen"
[ "$KF_GOMODS" = "$want" ] && ok "each module once, in the order first met" || bad "kf_gomods" "$KF_GOMODS"
kf_gomods "$T/repo" <<<"$T/repo/README.md" && bad "no module" "rc 0 for a list with no module" || ok "rc 1 when no file of the list is in a module"
[ -z "$KF_GOMODS" ] && ok "and KF_GOMODS is empty" || bad "empty" "$KF_GOMODS"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
