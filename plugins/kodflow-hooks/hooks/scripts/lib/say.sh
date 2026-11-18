# say.sh — one line per cause, said once per state. Sourced by on-stop.sh and
# on-user.sh, which define `_add` (where a said line goes) and STATE.
#
# _say CAUSE STATE KEY [name=value...]: returns 0 when it said it. The file
# ${KF_SAY_FILE:-$STATE/stop-said} holds, per cause, the fingerprint of the
# state last reported: the same state is not reported twice in a row, a
# changed one is, and a cause that clears (STATE empty) drops its record, so
# the same state coming back later is reported again. KEY is a message of
# hooks/messages.json (lib/msg.sh), its arguments passed on.
_say() {
    local cause=$1 st=$2 f=${KF_SAY_FILE:-$STATE/stop-said} sig; shift 2
    if [ -z "$st" ]; then
        [ -f "$f" ] && { grep -v "^$cause	" "$f" > "$f.$$" 2>/dev/null; mv -f "$f.$$" "$f" 2>/dev/null; }
        return 1
    fi
    sig=$(printf '%s' "$st" | cksum | cut -d' ' -f1)
    grep -qxF "$cause	$sig" "$f" 2>/dev/null && return 1
    { grep -v "^$cause	" "$f" 2>/dev/null; printf '%s\t%s\n' "$cause" "$sig"; } > "$f.$$" 2>/dev/null && mv -f "$f.$$" "$f" 2>/dev/null
    _add "$(kf_msg "$@")"
    return 0
}
