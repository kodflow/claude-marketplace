#!/bin/bash
# test_docs.sh — the project's documents (hooks/scripts/lib/docs.sh): the
# catalogue, docs/manifest.json read, docs.json written beside tasks.json,
# the index SessionStart injects, and the line a file read or written adds
# when it concerns a document. bash 3.2-safe: macOS CI runs it with /bin/bash.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
H=$ROOT/plugins/kodflow-hooks/hooks
S=$H/scripts
T=$(mktemp -d)
# The hooks log from a detached subshell: let the last line land before cleaning up
trap 'sleep 0.3; rm -rf "$T" 2>/dev/null || { sleep 1; rm -rf "$T"; }' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude KODFLOW_ROOT=off
unset KODFLOW_DOCS KODFLOW_MOD
SID=sess-docs
SD=$CLAUDE_CONFIG_DIR/kodflow/sessions/$SID
R=$T/repo
mkdir -p "$R" "$CLAUDE_CONFIG_DIR" "$T/tmp/sp" "$T/plain"
git -C "$R" init -q
cd "$T" || exit 1

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

# session EVENT-JSON-fragment SCRIPT → OUT, RC
hook() {
    local json
    json=$(jq -n -c --arg sid "$SID" --arg cwd "${CWD:-$R}" --arg sp "$T/tmp/sp" --argjson f "$1" \
        '{session_id:$sid, cwd:$cwd, scratchpad_dir:$sp} + $f')
    OUT=$(printf '%s' "$json" | CLAUDE_PROJECT_DIR=${CWD:-$R} bash "$S/$2" 2>/dev/null); RC=$?
}
start() { hook '{"hook_event_name":"SessionStart","source":"startup"}' on-session.sh; }
touched() {   # $1 tool, $2 file
    hook "$(jq -n -c --arg t "$1" --arg f "$2" '{hook_event_name:"PostToolUse", tool_name:$t, tool_input:{file_path:$f}, tool_use_id:"t1"}')" on-tool.sh
    CTX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
}
state() { jq -r --arg id "$1" '.docs[] | select(.id == $id) | .state' "$SD/docs.json" 2>/dev/null; }

echo "== the catalogue"
C=$H/docs-catalog.json
[ "$(jq '.documents | length' "$C")" = 15 ] && ok "fifteen documents" || bad "count" "$(jq '.documents | length' "$C")"
[ "$(jq -r '[.documents[].id] | join(",")' "$C")" = "prd,trd,flow,design,data,impl,adr,voice,glossary,quality,testing,threat,rgpd,ops,readme" ] \
    && ok "in the contract's order" || bad "order" "$(jq -r '[.documents[].id] | join(",")' "$C")"
jq -e '[.documents[] | select(all(.id, .name, .default, .why; type == "string") and (.source == "video" or .source == "extra") and (.touches | type) == "array")] | length == 15' "$C" >/dev/null \
    && ok "every entry has id, name, default, source, why, touches" || bad "fields" ""
[ "$(jq -r '[.documents[] | select(.source == "video") | .id] | join(",")' "$C")" = "prd,trd,flow,design,data,impl" ] \
    && ok "the six of the video, the rest extra" || bad "sources" ""

echo "== SessionStart · no manifest: every default path"
start
[ "$RC" = 0 ] && ok "exits 0" || bad "rc" "$RC"
[ -s "$SD/docs.json" ] && ok "docs.json written beside tasks.json ($SD)" || bad "docs.json" "absent"
jq -e --arg r "$R" '.version == 1 and .root == $r and .manifest == "docs/manifest.json" and (.updated | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$")) and (.docs | length) == 15' "$SD/docs.json" >/dev/null \
    && ok "version, root, manifest, updated, fifteen docs" || bad "shape" "$(jq -c 'del(.docs)' "$SD/docs.json" 2>&1)"
[ "$(jq -r '[.docs[].state] | unique | join(",")' "$SD/docs.json")" = missing ] && ok "an empty repository: all missing" || bad "states" ""
jq -e '.docs[0] | keys == ["id","name","path","source","state","why"]' "$SD/docs.json" >/dev/null && ok "an entry carries id, name, path, state, source, why" || bad "entry" "$(jq -c '.docs[0]' "$SD/docs.json")"
IDX=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.additionalContext // empty')
[ "$(printf '%s\n' "$IDX" | grep -c '^- ')" = 15 ] && ok "the index: one line per document" || bad "index lines" "$IDX"
printf '%s' "$IDX" | grep -q '^- flow Parcours: docs/product/flow.md, missing$' && ok "a line: id, name, path, state" || bad "line" "$IDX"
printf '%s' "$IDX" | grep -q '^Missing: prd, trd, flow' && ok "the missing ones are named" || bad "missing" "$IDX"
[ "${#IDX}" -lt 1600 ] && ok "the index stays short (${#IDX} characters)" || bad "index size" "${#IDX}"

echo "== the manifest: path moves, ignored greys, unknown ids and bad JSON"
mkdir -p "$R/docs/adr" "$R/docs/ops" "$R/notes"
printf '# v\n' > "$R/docs/vision.md"; printf '# r\n' > "$R/README.md"; printf '# a\n' > "$R/docs/adr/0001-x.md"
printf 'not md\n' > "$R/docs/ops/run.txt"
printf '{"version":1,"documents":{"prd":{"path":"docs/vision.md"},"design":{"ignored":"aucune interface hors du site"},"glossary":{"ignored":""},"nope":{"path":"x"}},"extra":{"keep":true}}\n' > "$R/docs/manifest.json"
start
[ "$(state prd)" = ok ] && [ "$(jq -r '.docs[] | select(.id == "prd") | .path' "$SD/docs.json")" = docs/vision.md ] && ok "path replaces the default, present: ok" || bad "path" "$(state prd)"
[ "$(state design)" = ignored ] && [ "$(jq -r '.docs[] | select(.id == "design") | .reason' "$SD/docs.json")" = "aucune interface hors du site" ] \
    && ok "ignored carries its reason" || bad "ignored" "$(jq -c '.docs[] | select(.id == "design")' "$SD/docs.json")"
[ "$(state glossary)" = ignored ] && ok "an empty reason still ignores" || bad "empty reason" "$(state glossary)"
[ "$(state adr)" = ok ] && ok "a directory holding a .md is present" || bad "adr" "$(state adr)"
[ "$(state ops)" = missing ] && ok "a directory with no .md is missing" || bad "ops" "$(state ops)"
[ "$(state readme)" = ok ] && ok "README.md at the root" || bad "readme" "$(state readme)"
jq -e '[.docs[].id] | index("nope") == null' "$SD/docs.json" >/dev/null && ok "an unknown id is not a document" || bad "unknown" ""
grep -q '"extra"' "$R/docs/manifest.json" && ok "the manifest is read, never rewritten" || bad "manifest rewritten" ""
printf '{"version":1,"documents":' > "$R/docs/manifest.json"
start
[ "$RC" = 0 ] && [ "$(state design)" = missing ] && [ "$(state prd)" = missing ] && ok "a manifest that does not parse reads as absent" || bad "bad json" "rc=$RC design=$(state design)"
rm -f "$R/docs/manifest.json"

echo "== recomputed after a write under docs/, at most every 30 s otherwise"
mkdir -p "$R/docs/product"; printf '# f\n' > "$R/docs/product/flow.md"
touched Write "$R/docs/product/flow.md"
[ "$(state flow)" = ok ] && ok "a write under docs/ rebuilds docs.json" || bad "rebuild" "$(state flow)"
printf '# d\n' > "$R/docs/tech-data.md"; mkdir -p "$R/docs/tech"; printf '# d\n' > "$R/docs/tech/data.md"
touched Read "$R/README.md"
[ "$(state data)" = missing ] && ok "a read inside 30 s does not" || bad "throttle" "$(state data)"
touch -t 200001010000 "$SD/docs.json"
touched Read "$R/README.md"
[ "$(state data)" = ok ] && ok "an older docs.json is rebuilt on the next tool" || bad "stale rebuild" "$(state data)"

echo "== a file that concerns a document"
mkdir -p "$R/internal/auth" "$R/migrations" "$R/web/templates"
: > "$R/internal/auth/token.go"; : > "$R/migrations/001.sql"; : > "$R/web/templates/home.html"; : > "$R/go.mod"
touched Read "$R/internal/auth/token.go"
[ "$CTX" = "document concerné absent : Modèle de menaces (docs/security/threat-model.md), /kodflow-workflow:docs threat le crée" ] \
    && ok "a missing document is said, with what creates it" || bad "missing line" "$CTX"
touched Edit "$R/internal/auth/token.go"
[ -z "$CTX" ] && ok "once per document and session" || bad "twice" "$CTX"
touched Read "$R/web/templates/home.html"
printf '%s' "$CTX" | grep -q '^document concerné : Parcours (docs/product/flow.md)$' && ok "a present one: document concerné : <nom> (<chemin>)" || bad "present line" "$CTX"
printf '%s' "$CTX" | grep -q 'Brief de design' && printf '%s' "$CTX" | grep -q "Ton et règles" && ok "one file, every document it concerns" || bad "several" "$CTX"
printf '{"version":1,"documents":{"data":{"ignored":"pas de base"}}}\n' > "$R/docs/manifest.json"
touched Write "$R/migrations/001.sql"
printf '%s' "$CTX" | grep -q 'Schéma' && bad "ignored said" "$CTX" || ok "an ignored document says nothing"
printf '%s' "$CTX" | grep -q 'Registre RGPD' && ok "the other document the migration concerns is said" || bad "rgpd" "$CTX"
touched Write "$R/docs/product/flow.md"
[ -z "$CTX" ] && ok "a document's own file calls nothing" || bad "self" "$CTX"
WT=$T/wt; mkdir -p "$WT/deploy/ansible"; printf 'gitdir: /nowhere\n' > "$WT/.git"; : > "$WT/deploy/ansible/site.yml"
touched Read "$WT/deploy/ansible/site.yml"
printf '%s' "$CTX" | grep -q 'PRA et runbooks (docs/ops/)' && ok "a worktree elsewhere is matched against its own root" || bad "worktree" "$CTX"
KODFLOW_DOCS=off touched Read "$R/go.mod"
[ -z "$CTX" ] && ok "KODFLOW_DOCS=off: nothing" || bad "off" "$CTX"

echo "== outside a git repository"
CWD=$T/plain start
[ "$RC" = 0 ] && [ ! -e "$SD/docs.json" ] && ok "no docs.json, exit 0" || bad "outside git" "rc=$RC $(ls "$SD")"
printf '%s' "$OUT" | grep -q 'Project documents' && bad "index outside git" "$OUT" || ok "no index"
chmod 000 "$SD" 2>/dev/null; start; chmod 755 "$SD" 2>/dev/null
[ "$RC" = 0 ] && ok "an unwritable session directory fails open" || bad "unwritable" "$RC"

echo
echo "test_docs: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
