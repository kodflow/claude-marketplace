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
#   kf_route_fresh OUT            0 when OUT exists and is newer than the index
#   kf_route_match OUT DESC       one `agent<TAB>keyword,…` line per agent named

KF_ROUTE_INDEX=${BASH_SOURCE[0]%/*}/../../routing-index.tsv

kf_route_install() {
    local cfg=$1 out=$2 plugins tmp
    [ -r "$KF_ROUTE_INDEX" ] || return 1
    plugins=$(jq -r '.plugins // {} | keys[] | split("@")[0]' "$cfg/plugins/installed_plugins.json" 2>/dev/null)
    mkdir -p "${out%/*}" 2>/dev/null || return 1
    tmp=$out.$$.tmp
    # Multi-line values go through the environment: BSD awk refuses a
    # newline in a -v assignment.
    KF_PLUGINS=$plugins awk -F'\t' '
        BEGIN { n = split(ENVIRON["KF_PLUGINS"], p, "\n"); for (i = 1; i <= n; i++) if (p[i] != "") ok[p[i]] = 1 }
        /^#/ { print; next }
        NF == 3 { i = index($3, ":"); if (i == 0 || (substr($3, 1, i - 1) in ok)) print }' \
        "$KF_ROUTE_INDEX" > "$tmp" 2>/dev/null && mv -f "$tmp" "$out" 2>/dev/null && return 0
    rm -f -- "$tmp" 2>/dev/null
    return 1
}

kf_route_fresh() {
    [ -s "$1" ] && ! [ "$KF_ROUTE_INDEX" -nt "$1" ]
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
