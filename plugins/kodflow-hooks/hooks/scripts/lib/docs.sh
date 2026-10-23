# docs.sh — the project's documents: which exist, which are missing, which
# the project chose to ignore.
# shellcheck shell=bash
#
# The catalogue (hooks/docs-catalog.json) names fifteen documents and their
# default paths. A project moves or drops one in docs/manifest.json at its git
# root ({"version":1,"documents":{"<id>":{"path":…}|{"ignored":"reason"}}});
# no manifest means every default path, nothing ignored. A path ending in /
# is a directory, present when it holds at least one .md file.
#
#   . "$LIB/docs.sh"
#   kf_docs_top DIR             → KF_DOCS_TOP, the git root above DIR (no fork)
#   kf_docs_write ROOT SDIR     → SDIR/docs.json, replaced whole
#   kf_docs_index SDIR          → the short index SessionStart injects
#   kf_docs_touch FILE SDIR     → KF_DOCS_CTX, one line per document the file
#                                 concerns, once per document and session
#
# Everything here fails open: a missing jq, an unreadable manifest or an
# unwritable directory leaves no file and no line, never an error.

KF_DOCS_CATALOG=${BASH_SOURCE[0]%/*}/../../docs-catalog.json

# $1 a directory → KF_DOCS_TOP the nearest ancestor holding .git (a directory,
# or a worktree's file); 1 when there is none.
kf_docs_top() {
    local d=$1
    KF_DOCS_TOP=""
    while [ -n "$d" ]; do
        [ -e "$d/.git" ] && { KF_DOCS_TOP=$d; return 0; }
        [ "$d" = / ] && return 1
        d=${d%/*}; [ -n "$d" ] || d=/
    done
    return 1
}

# $1 root → one line per catalogue entry: id, effective path, ignored (0/1),
# separated by \x1f (a tab would collapse an empty field). A manifest that
# does not parse is read as absent.
_kf_docs_paths() {
    local m='{}'
    [ -f "$1/docs/manifest.json" ] && m=$(jq -c '.documents // {} | if type == "object" then . else {} end' "$1/docs/manifest.json" 2>/dev/null)
    [[ $m == \{* ]] || m='{}'
    jq -r --argjson m "$m" '
        .documents[] | ($m[.id] // {}) as $e
        | [ .id,
            (if ($e.path | type) == "string" and ($e.path | length) > 0 then $e.path else .default end),
            (if ($e.ignored | type) == "string" or $e.ignored == true then "1" else "0" end) ]
        | join("\u001f")' "$KF_DOCS_CATALOG" 2>/dev/null
}

# $1 root, $2 path → 0 when the document is there
_kf_docs_present() {
    local p=$2
    case "$p" in /*) ;; *) p=$1/$p ;; esac
    case "$p" in
        */) [ -d "$p" ] && [ -n "$(find "$p" -maxdepth 4 -type f -name '*.md' -print 2>/dev/null | head -n 1)" ] ;;
        *)  [ -f "$p" ] ;;
    esac
}

# $1 root → the ids of the documents present, space separated
_kf_docs_ok() {
    local id path ign ok=""
    while IFS=$'\x1f' read -r id path ign; do
        [ -n "$id" ] || continue
        [ "$ign" = 0 ] && _kf_docs_present "$1" "$path" && ok="$ok $id"
    done <<EOF
$(_kf_docs_paths "$1")
EOF
    printf '%s' "${ok# }"
}

# $1 root, $2 session directory. The state file other plugins read (the HUD
# panel): written to a temporary file in the same directory, then renamed.
kf_docs_write() {
    local root=$1 sd=$2 m='{}' tmp
    [ -n "$root" ] && [ -n "$sd" ] && [ -f "$KF_DOCS_CATALOG" ] || return 0
    command -v jq >/dev/null 2>&1 || return 0
    mkdir -p "$sd" 2>/dev/null || return 0
    [ -f "$root/docs/manifest.json" ] && m=$(jq -c '.documents // {} | if type == "object" then . else {} end' "$root/docs/manifest.json" 2>/dev/null)
    [[ $m == \{* ]] || m='{}'
    tmp=$sd/.docs.$$.$RANDOM.tmp
    jq --argjson m "$m" --arg root "$root" --arg ok " $(_kf_docs_ok "$root") " \
       --arg now "$(date -u +%FT%TZ)" '
        {version: 1, root: $root, manifest: "docs/manifest.json", updated: $now,
         docs: [ .documents[] | .id as $id | ($m[$id] // {}) as $e
                 | (if ($e.path | type) == "string" and ($e.path | length) > 0 then $e.path else .default end) as $p
                 | {id, name, path: $p}
                 + (if ($e.ignored | type) == "string" or $e.ignored == true
                    then {state: "ignored", reason: (if ($e.ignored | type) == "string" then $e.ignored else "" end)}
                    elif ($ok | contains(" " + $id + " ")) then {state: "ok"}
                    else {state: "missing"} end)
                 + {source, why} ]}' "$KF_DOCS_CATALOG" > "$tmp" 2>/dev/null \
        && mv -f "$tmp" "$sd/docs.json" 2>/dev/null
    rm -f "$tmp" 2>/dev/null
    return 0
}

# $1 session directory → the index: one document per line, then the missing
# ones named. Never the documents' text.
kf_docs_index() {
    [ -s "$1/docs.json" ] || return 0
    jq -r '
        "## Project documents (kodflow-hooks, docs/manifest.json)",
        (.docs[] | "- \(.id) \(.name): \(.path), \(.state)"),
        ([.docs[] | select(.state == "missing") | .id] as $miss
         | if ($miss | length) > 0
           then "Missing: \($miss | join(", ")). /kodflow-workflow:docs <id> creates one; docs/manifest.json moves or ignores one."
           else empty end)' "$1/docs.json" 2>/dev/null
}

# $1 the file read or written, $2 session directory → KF_DOCS_CTX. The file is
# matched against the touches of each document, relative to its own git root
# (a subagent works in a worktree of another repository); the documents' own
# files and docs/ itself call nothing.
kf_docs_touch() {
    local f=$1 sd=$2 rel id name def pats p ign path line="" noted=$2/docs-noted key
    KF_DOCS_CTX=""
    [ -n "$f" ] && [ -n "$sd" ] && [ -f "$KF_DOCS_CATALOG" ] || return 0
    command -v jq >/dev/null 2>&1 || return 0
    kf_docs_top "${f%/*}" || return 0
    rel=${f#"$KF_DOCS_TOP"/}
    case "$rel" in docs/*|*.md|.git/*|.claude/*) return 0 ;; esac
    local hits=""
    while IFS=$'\x1f' read -r id name def pats; do
        [ -n "$id" ] && [ -n "$pats" ] || continue
        while IFS= read -r p; do
            # shellcheck disable=SC2053 # the pattern is a glob on purpose
            [ -n "$p" ] && [[ $rel == $p ]] && { hits="$hits$id"$'\x1f'"$name"$'\n'; break; }
        done <<EOF
$(printf '%s' "$pats" | tr '\036' '\n')
EOF
    done <<EOF
$(jq -r '.documents[] | [.id, .name, .default, (.touches | join("\u001e"))] | join("\u001f")' "$KF_DOCS_CATALOG" 2>/dev/null)
EOF
    [ -n "$hits" ] || return 0
    local paths
    paths=$(_kf_docs_paths "$KF_DOCS_TOP")
    while IFS=$'\x1f' read -r id name; do
        [ -n "$id" ] || continue
        key=$KF_DOCS_TOP$'\t'$id
        grep -qxF -- "$key" "$noted" 2>/dev/null && continue
        IFS=$'\x1f' read -r _ path ign <<EOF
$(printf '%s\n' "$paths" | grep "^$id"$'\x1f')
EOF
        [ "$ign" = 1 ] && continue
        mkdir -p "$sd" 2>/dev/null && printf '%s\n' "$key" >> "$noted" 2>/dev/null
        if _kf_docs_present "$KF_DOCS_TOP" "$path"; then
            line="${line:+$line
}document concerné : $name ($path)"
        else
            line="${line:+$line
}document concerné absent : $name ($path), /kodflow-workflow:docs $id le crée"
        fi
    done <<EOF
$hits
EOF
    KF_DOCS_CTX=$line
    return 0
}

# $1 root, $2 session directory, $3 a path just written (may be empty) →
# docs.json rebuilt when the path is under docs/ or is the manifest, and at
# most every 30 seconds otherwise.
kf_docs_refresh() {
    local root=$1 sd=$2 f=${3:-} m now
    [ -n "$root" ] && [ -n "$sd" ] || return 0
    case "$f" in "$root"/docs/*) kf_docs_write "$root" "$sd"; return 0 ;; esac
    if [ -f "$sd/docs.json" ]; then
        m=$(stat -c %Y "$sd/docs.json" 2>/dev/null) || m=$(stat -f %m "$sd/docs.json" 2>/dev/null)
        now=$(date +%s)
        case "$m" in ''|*[!0-9]*) ;; *) [ $((now - m)) -lt 30 ] && return 0 ;; esac
    fi
    kf_docs_write "$root" "$sd"
}
