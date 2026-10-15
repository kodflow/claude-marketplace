# route.sh — which installed specialist a dispatch description names.
# shellcheck shell=bash
#
# hooks/routing-index.tsv is generated from skills/_shared/specialists.md
# (scripts/build-routing-index.py): `keyword<TAB>word|ext<TAB>agent`, agent
# being `plugin:name` or a built-in with no colon. A session reads its own
# copy, filtered to the plugins installed_plugins.json lists, so the gate
# never names an agent this machine cannot dispatch.
#
#   . "$LIB/route.sh"
#   kf_route_install CFG OUT      write OUT from the shipped index (jq)
#   kf_route_fresh OUT [CFG]      0 when OUT was built from this index and installed_plugins.json
#   kf_route_match OUT DESC       one `agent<TAB>keyword,…` line per agent named

KF_ROUTE_INDEX=${BASH_SOURCE[0]%/*}/../../routing-index.tsv

# What a session index was built from: the checksums of the shipped index
# and of installed_plugins.json. Compared by content, never by mtime: test
# -nt has whole-second resolution on macOS's bash 3.2, and a plugin
# installed in the second the index was built would go unseen.
_kf_route_sig() {
    local a b
    a=$(cksum < "$KF_ROUTE_INDEX" 2>/dev/null | cut -d' ' -f1)
    b=$(cksum < "$1/plugins/installed_plugins.json" 2>/dev/null | cut -d' ' -f1)
    printf '#source %s %s' "${a:-none}" "${b:-none}"
}

kf_route_install() {
    local cfg=$1 out=$2 plugins tmp sig
    [ -r "$KF_ROUTE_INDEX" ] || return 1
    plugins=$(jq -r '.plugins // {} | keys[] | split("@")[0]' "$cfg/plugins/installed_plugins.json" 2>/dev/null)
    mkdir -p "${out%/*}" 2>/dev/null || return 1
    tmp=$out.$$.tmp
    sig=$(_kf_route_sig "$cfg")
    # Multi-line values go through the environment: BSD awk refuses a
    # newline in a -v assignment.
    KF_PLUGINS=$plugins awk -F'\t' -v sig="$sig" '
        BEGIN { n = split(ENVIRON["KF_PLUGINS"], p, "\n"); for (i = 1; i <= n; i++) if (p[i] != "") ok[p[i]] = 1 }
        NR == 1 { print sig }
        /^#/ { print; next }
        NF == 3 { i = index($3, ":"); if (i == 0 || (substr($3, 1, i - 1) in ok)) print }' \
        "$KF_ROUTE_INDEX" > "$tmp" 2>/dev/null && mv -f "$tmp" "$out" 2>/dev/null && return 0
    rm -f -- "$tmp" 2>/dev/null
    return 1
}

# Fresh: its first line names the index and installed_plugins.json it was
# built from, as they are now.
kf_route_fresh() {
    local line=""
    [ -s "$1" ] || return 1
    IFS= read -r line < "$1"
    [ "$line" = "$(_kf_route_sig "${2:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}}")" ]
}

# Words: the description lower-cased, cut on anything but letters, digits
# and . + _ -, trailing dots dropped. A `word` keyword matches a word
# exactly; an `ext` keyword the end of one (main.go ends in .go).
kf_route_match() {
    [ -r "$1" ] || return 1
    KF_DESC=$2 awk -F'\t' '
        BEGIN {
            d = tolower(ENVIRON["KF_DESC"]); gsub(/[^a-z0-9.+_-]+/, " ", d)
            n = split(d, w, " ")
            for (i = 1; i <= n; i++) { t = w[i]; sub(/[.]+$/, "", t); if (t != "") tok[t] = 1 }
        }
        /^#/ || NF != 3 { next }
        $2 == "word" && ($1 in tok) { add($3, $1); next }
        $2 == "ext" {
            L = length($1)
            for (t in tok) if (length(t) >= L && substr(t, length(t) - L + 1) == $1) { add($3, $1); break }
        }
        function add(a, k) { if (a in hit) hit[a] = hit[a] "," k; else { order[++m] = a; hit[a] = k } }
        END { for (i = 1; i <= m; i++) print order[i] "\t" hit[order[i]] }' "$1" 2>/dev/null
}
