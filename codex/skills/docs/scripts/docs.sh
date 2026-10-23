#!/bin/bash
# ============================================================================
# docs.sh - The project's documents: which exist, which are missing, and the
#           manifest that moves or ignores them, for /docs
# Usage: docs.sh state   [<session-id>]   kodflow-hooks' docs.json, else computed
#        docs.sh compute                  computed from the catalogue, always
#        docs.sh init                     create docs/manifest.json if missing
#        docs.sh ignore   <id> [<reason>] mark a document ignored
#        docs.sh unignore <id>            drop the mark
#        docs.sh path     <id> <path>     the document lives elsewhere
# Exit 0 = answered · 2 = usage · 3 = jq missing · 4 = not in a git work tree
#      5 = unknown document id
# ============================================================================
# The catalogue (catalogue.json, beside this script) is a copy of the one
# kodflow-hooks owns: a plugin is installed alone and cannot read a sibling's
# file, so /docs must be able to compute the state without the hooks.
#
# State, one entry per catalogue document, in catalogue order:
#   path   the manifest's `path`, else the catalogue's `default`
#   state  ignored  the manifest carries `ignored` (a string, even empty)
#          ok       a file that exists and is not empty, or a directory
#                   (path ending in /) holding a .md anywhere below it
#          missing  anything else
#
# The manifest (docs/manifest.json at the git root) is rewritten with its
# unknown keys kept, `documents` in catalogue order (ids the catalogue does
# not know after them, in their own order), two-space indent, final newline.
#
# Read-only on everything but docs/manifest.json. Bash 3.2 safe.
# ============================================================================

set -u

command -v jq >/dev/null 2>&1 || { echo '{"error":"jq not found"}'; exit 3; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
catalogue="$here/../catalogue.json"
cmd="${1:-}"

root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo '{"error":"not in a git work tree"}'; exit 4; }
manifest="$root/docs/manifest.json"

manifest_json() { # the manifest, or the empty one when absent or malformed
    if [ -f "$manifest" ] && jq -e 'type == "object"' "$manifest" >/dev/null 2>&1; then
        cat "$manifest"
    else
        echo '{"version":1,"documents":{}}'
    fi
}

present() { # path relative to root -> 0 when the document is there
    case "$1" in
        */) [ -d "$root/$1" ] && [ -n "$(find "$root/$1" -type f -name '*.md' 2>/dev/null | head -1)" ] ;;
        *)  [ -s "$root/$1" ] ;;
    esac
}

known_id() {
    jq -e --arg id "$1" 'any(.documents[]; .id == $id)' "$catalogue" >/dev/null
}

compute() {
    m="$(manifest_json)"
    # One line per document: id <TAB> resolved path <TAB> ignored-or-empty flag
    lines="$(jq -r --argjson m "$m" '
        .documents[] as $d
        | ($m.documents[$d.id] // {}) as $e
        | [$d.id, ($e.path // $d.default),
           (if ($e.ignored | type) == "string" then "1" else "0" end)] | @tsv' "$catalogue")"
    states=""
    while IFS="$(printf '\t')" read -r id path ign; do
        [ -n "$id" ] || continue
        if [ "$ign" = 1 ]; then s=ignored
        elif present "$path"; then s=ok
        else s=missing
        fi
        states="$states$id=$s;"
    done <<EOF
$lines
EOF
    rel="${manifest#"$root"/}"
    jq --argjson m "$m" --arg root "$root" --arg rel "$rel" --arg states "$states" \
       --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
        ($states | split(";") | map(select(. != "") | split("=") | {(.[0]): .[1]}) | add) as $s
        | {version: 1, root: $root, manifest: $rel, updated: $now,
           docs: [.documents[] as $d
                  | ($m.documents[$d.id] // {}) as $e
                  | {id: $d.id, name: $d.name, path: ($e.path // $d.default), state: $s[$d.id]}
                    + (if $s[$d.id] == "ignored" then {reason: $e.ignored} else {} end)
                    + {source: $d.source, why: $d.why}]}' "$catalogue"
}

write_manifest() { # jq filter [jq args...]: applied to the manifest, then normalised
    filter="$1"; shift
    m="$(manifest_json)"
    new="$(printf '%s\n' "$m" | jq "$@" --slurpfile cat "$catalogue" "$filter"'
        | .version = (.version // 1)
        | .documents = (.documents // {})
        | ([$cat[0].documents[].id]) as $order
        | .documents = ((.documents | to_entries) as $all
            | ([$order[] as $id | $all[] | select(.key == $id)]
               + [$all[] | select(.key as $k | $order | index($k) | not)])
            | from_entries)')" || exit 1
    mkdir -p "$root/docs"
    printf '%s\n' "$new" > "$manifest"
}

case "$cmd" in
    state)
        sid="${2:-}"
        case "$sid" in ''|*'$'*|*'{'*|*/*) sid="" ;; esac
        f="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$sid/docs.json"
        if [ -n "$sid" ] && [ -f "$f" ] && jq -e --arg r "$root" '.root == $r' "$f" >/dev/null 2>&1; then
            cat "$f"
        else
            compute
        fi
        ;;
    compute)
        compute
        ;;
    init)
        [ -f "$manifest" ] && { echo "exists ${manifest#"$root"/}"; exit 0; }
        write_manifest '.'
        echo "created ${manifest#"$root"/}"
        ;;
    ignore)
        [ -n "${2:-}" ] || { echo "usage: docs.sh ignore <id> [<reason>]" >&2; exit 2; }
        known_id "$2" || { echo "unknown document: $2" >&2; exit 5; }
        write_manifest '.documents[$id] = ((.documents[$id] // {}) + {ignored: $val})' --arg id "$2" --arg val "${3:-}"
        echo "ignored $2"
        ;;
    unignore)
        [ -n "${2:-}" ] || { echo "usage: docs.sh unignore <id>" >&2; exit 2; }
        known_id "$2" || { echo "unknown document: $2" >&2; exit 5; }
        write_manifest '.documents[$id] |= ((. // {}) | del(.ignored))
            | if .documents[$id] == {} then del(.documents[$id]) else . end' --arg id "$2"
        echo "unignored $2"
        ;;
    path)
        [ -n "${2:-}" ] && [ -n "${3:-}" ] || { echo "usage: docs.sh path <id> <path>" >&2; exit 2; }
        known_id "$2" || { echo "unknown document: $2" >&2; exit 5; }
        write_manifest '.documents[$id] = ((.documents[$id] // {}) + {path: $val})' --arg id "$2" --arg val "$3"
        echo "path $2 $3"
        ;;
    *)
        sed -n '4,9p' "$0" | sed 's/^# \{0,1\}//' >&2
        exit 2
        ;;
esac
