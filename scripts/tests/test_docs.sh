#!/bin/bash
# ============================================================================
# test_docs.sh - docs.sh against fixture repositories
# ============================================================================
# /docs decides what to write from the state this script computes, and the
# documents panel reads the manifest it rewrites. A wrong state is a document
# written twice or never; a wrong rewrite loses a key someone else put in the
# manifest. Each case plants a repository and checks one of those.
# ============================================================================

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/plugins/kodflow-workflow/skills/docs/scripts/docs.sh"
CAT="$ROOT/plugins/kodflow-workflow/skills/docs/catalogue.json"
# The interpreter under test: the macOS job sets /bin/bash (3.2).
RUN="${DOCS_BASH:-bash}"
pass=0; fail=0

check() { # name expected actual
    if [ "$2" = "$3" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3"
    fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
git init -q "$repo"
docs() { (cd "$repo" && "$RUN" "$SRC" "$@"); }
state_of() { docs compute | jq -r --arg id "$1" '.docs[] | select(.id == $id) | .state'; }

# The catalogue is the contract's: fifteen ids, in its order.
check "catalogue ids" \
    "prd trd flow design data impl adr voice glossary quality testing threat rgpd ops readme" \
    "$(jq -r '[.documents[].id] | join(" ")' "$CAT")"

# An empty repository: everything missing, in catalogue order, no manifest written.
check "empty: all missing" "15" "$(docs compute | jq '[.docs[] | select(.state == "missing")] | length')"
check "empty: order" "prd" "$(docs compute | jq -r '.docs[0].id')"
check "empty: no manifest" "no" "$([ -e "$repo/docs/manifest.json" ] && echo yes || echo no)"

# A file counts when it is not empty; a directory when a .md sits anywhere below.
: > "$repo/README.md"
check "empty file is missing" "missing" "$(state_of readme)"
echo "# x" > "$repo/README.md"
check "file present" "ok" "$(state_of readme)"
mkdir -p "$repo/docs/adr" && echo x > "$repo/docs/adr/notes.txt"
check "dir without .md is missing" "missing" "$(state_of adr)"
mkdir -p "$repo/docs/ops/deep" && echo x > "$repo/docs/ops/deep/pra.md"
check "dir with nested .md" "ok" "$(state_of ops)"

# init creates the empty manifest, once.
check "init creates" "created docs/manifest.json" "$(docs init)"
check "init exact" '{"version":1,"documents":{}}' "$(jq -c . "$repo/docs/manifest.json")"
check "init again" "exists docs/manifest.json" "$(docs init)"

# A manifest with keys this skill does not know: kept, documents reordered.
cat > "$repo/docs/manifest.json" <<'JSON'
{"version":1,"owner":"team","documents":{"later":{"x":1},"design":{"path":"docs/ui.md","note":"keep"}}}
JSON
docs ignore prd "pas de produit" >/dev/null
docs path data docs/schema.md >/dev/null
docs ignore flow >/dev/null
check "unknown keys kept" "team keep 1" \
    "$(jq -r '"\(.owner) \(.documents.design.note) \(.documents.later.x)"' "$repo/docs/manifest.json")"
check "catalogue order, unknown last" "prd flow design data later" \
    "$(jq -r '.documents | keys_unsorted | join(" ")' "$repo/docs/manifest.json")"
check "two-space indent" '  "version": 1,' "$(sed -n 2p "$repo/docs/manifest.json")"
check "final newline" "" "$(tail -c1 "$repo/docs/manifest.json" | tr -d '\n')"

# State follows the manifest: ignored with its reason (even empty), moved paths.
check "ignored" "ignored" "$(state_of prd)"
check "reason" "pas de produit" "$(docs compute | jq -r '.docs[] | select(.id == "prd") | .reason')"
check "empty reason is still ignored" "ignored" "$(state_of flow)"
check "moved path" "docs/schema.md" "$(docs compute | jq -r '.docs[] | select(.id == "data") | .path')"
echo "# s" > "$repo/docs/schema.md"
check "moved path present" "ok" "$(state_of data)"

# unignore drops only the mark, and an entry left empty.
docs unignore flow >/dev/null
check "unignore drops empty entry" "null" "$(jq -c '.documents.flow' "$repo/docs/manifest.json")"
docs ignore design "pas d'interface" >/dev/null
docs unignore design >/dev/null
check "unignore keeps the rest" '{"path":"docs/ui.md","note":"keep"}' "$(jq -c '.documents.design' "$repo/docs/manifest.json")"

# Refusals: unknown id, usage, outside git.
docs ignore nope >/dev/null 2>&1
check "unknown id" "5" "$?"
docs path prd >/dev/null 2>&1
check "usage" "2" "$?"
(cd "$tmp" && "$RUN" "$SRC" compute >/dev/null 2>&1)
check "outside git" "4" "$?"

# state prefers kodflow-hooks' docs.json for this repository, else computes.
cfg="$tmp/cfg"; mkdir -p "$cfg/kodflow/sessions/s1"
real="$(cd "$repo" && git rev-parse --show-toplevel)"
jq -n --arg r "$real" '{version:1, root:$r, docs:[{id:"prd", state:"ok"}]}' > "$cfg/kodflow/sessions/s1/docs.json"
check "state reads docs.json" "ok" \
    "$(cd "$repo" && CLAUDE_CONFIG_DIR="$cfg" "$RUN" "$SRC" state s1 | jq -r '.docs[0].state')"
jq -n '{version:1, root:"/elsewhere", docs:[]}' > "$cfg/kodflow/sessions/s1/docs.json"
check "state ignores another root" "15" \
    "$(cd "$repo" && CLAUDE_CONFIG_DIR="$cfg" "$RUN" "$SRC" state s1 | jq '.docs | length')"
check "literal session id" "15" \
    "$(cd "$repo" && CLAUDE_CONFIG_DIR="$cfg" "$RUN" "$SRC" state '${CLAUDE_SESSION_ID}' | jq '.docs | length')"

printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
