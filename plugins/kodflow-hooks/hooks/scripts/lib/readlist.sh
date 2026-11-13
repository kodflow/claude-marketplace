# readlist.sh — whether a tool is on the triage gate's read list
# (lib/read-tools.txt), builtins only: the fast path of on-tool.sh runs it
# before any jq.
# shellcheck shell=bash
#
#   . "$LIB/readlist.sh"
#   kf_read_tool NAME   → 0 when NAME is listed (exactly, or under one of
#                         the list's `*` prefixes), 1 otherwise; a list that
#                         cannot be read lists nothing (the gate fails closed)
kf_read_tool() {
    local name=$1 line
    [ -n "$name" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|'#'*) continue ;; esac
        case "$line" in
            *'*') [ "${name#"${line%'*'}"}" != "$name" ] && return 0 ;;
            *) [ "$line" = "$name" ] && return 0 ;;
        esac
    done 2>/dev/null < "${BASH_SOURCE[0]%/*}/read-tools.txt"
    return 1
}
