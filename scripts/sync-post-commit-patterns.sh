#!/bin/bash
# sync-post-commit-patterns.sh — the copy of kodflow/post-commit's patterns.
#
# on-tool.sh and the mod read §5 from plugins/kodflow-hooks/hooks/patterns:
# patterns.txt and patterns-strict.txt, byte for byte as kodflow/post-commit
# holds them at the commit SOURCE names. An installed plugin reads that copy
# and never the network. Moving the pin is a reviewed change, like any guard.
#
#   bash scripts/sync-post-commit-patterns.sh <sha>    copy the files at <sha>,
#                                                      rewrite SOURCE, regenerate
#                                                      the guard fingerprints
#   bash scripts/sync-post-commit-patterns.sh --check  exit 1 when the copy
#                                                      differs from SOURCE's commit
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=$ROOT/plugins/kodflow-hooks/hooks/patterns
FILES="patterns.txt patterns-strict.txt"

die() { echo "sync-post-commit-patterns: $*" >&2; exit 1; }

repo=$(sed -n 's/^repo=//p' "$DIR/SOURCE")
[ -n "$repo" ] || die "no repo= line in $DIR/SOURCE"

if [ "${1:-}" = --check ]; then
    sha=$(sed -n 's/^sha=//p' "$DIR/SOURCE")
else
    sha=${1:-}
fi
# A commit, never a branch: a branch would move under every installed copy
case "$sha" in
    *[!0-9a-f]*|"") die "usage: $0 <40-hex commit of $repo> | --check" ;;
esac
[ ${#sha} -eq 40 ] || die "usage: $0 <40-hex commit of $repo> | --check"

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
for f in $FILES; do
    curl -fsSL --retry 3 "https://raw.githubusercontent.com/$repo/$sha/scripts/$f" -o "$T/$f" \
        || die "cannot fetch scripts/$f at $repo@$sha"
    [ -s "$T/$f" ] || die "scripts/$f at $repo@$sha is empty"
done

if [ "${1:-}" = --check ]; then
    rc=0
    for f in $FILES; do
        cmp -s "$T/$f" "$DIR/$f" || { echo "$f differs from $repo@$sha" >&2; diff "$T/$f" "$DIR/$f" >&2 || true; rc=1; }
    done
    [ $rc -eq 0 ] && echo "hooks/patterns match $repo@$sha"
    exit $rc
fi

# Every pattern must compile before it replaces a working copy
for f in $FILES; do
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|'#'*) continue ;; esac
        set +e; grep -qE -- "$line" </dev/null; r=$?; set -e
        [ $r -le 1 ] || die "scripts/$f at $sha: invalid pattern: $line"
    done < "$T/$f"
done

for f in $FILES; do cp "$T/$f" "$DIR/$f"; done
sed -i.bak "s/^sha=.*/sha=$sha/" "$DIR/SOURCE" && rm -f "$DIR/SOURCE.bak"
bash "$ROOT/scripts/hooks-fingerprints.sh"
echo "hooks/patterns now at $repo@$sha: run the hook suites (scripts/tests/test_hooks.sh, plugins/kodflow-hooks/tests/run-tests.sh)"
