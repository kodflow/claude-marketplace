# msg.sh — the texts kodflow-hooks shows, in the user's language.
# shellcheck shell=bash
#
# One table, hooks/messages.json, every entry in en and fr. The language is
# Claude Code's own `language` setting (free text, passed to Claude as
# written: "french", "Français", "fr"...), read like Claude Code reads it:
# user settings, then the project's settings.json, then settings.local.json,
# the last one that sets it winning. French when it names French, English
# otherwise. KODFLOW_LANG=en|fr overrides it (tests, a one-off).
#
# Colour: {R} {O} {G} open red, orange and green, {X} closes. kf_msg fills
# them only when asked (kf_msg_color 1) and NO_COLOR or KODFLOW_COLOR=off is
# not set: a text the screen does not render would carry the escapes to the
# model as tokens for nothing.
#
#   . "$LIB/msg.sh"
#   kf_lang "$PROJECT_DIR"            → KF_LANG=en|fr
#   kf_msg_color 1                     → colour the next kf_msg calls
#   kf_msg stop.stopped ids="#1 #2"    → the text on stdout, "" when unknown

KF_LANG=${KF_LANG:-}
KF_MSG_COLOR=0
KF_MSG_FILE=${BASH_SOURCE[0]%/*}/../../messages.json

kf_lang() {
    local project=${1:-} v="" f val
    case "${KODFLOW_LANG:-}" in en|fr) KF_LANG=$KODFLOW_LANG; return 0 ;; esac
    for f in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" \
             "${project:+$project/.claude/settings.json}" \
             "${project:+$project/.claude/settings.local.json}"; do
        [ -n "$f" ] && [ -f "$f" ] || continue
        grep -q '"language"' "$f" 2>/dev/null || continue
        val=$(jq -r '.language // "" | strings' "$f" 2>/dev/null)
        [ -n "$val" ] && v=$val
    done
    v=$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')
    case "$v" in fr|fr[-_]*|french*|fran[cç]ais*|fran*) KF_LANG=fr ;; *) KF_LANG=en ;; esac
}

kf_msg_color() {
    KF_MSG_COLOR=0
    [ "${1:-0}" = 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${KODFLOW_COLOR:-}" != off ] && KF_MSG_COLOR=1
    return 0
}

kf_msg() {
    local key=$1; shift
    [ -n "$KF_LANG" ] || kf_lang
    jq -r --arg k "$key" --arg l "$KF_LANG" --arg c "$KF_MSG_COLOR" '
        (if $c == "1" then {R:"\u001b[31m", O:"\u001b[38;5;208m", G:"\u001b[32m", X:"\u001b[39m"}
         else {R:"", O:"", G:"", X:""} end)
        + ([$ARGS.positional[] | capture("^(?<k>[^=]*)=(?<v>.*)$"; "s") | {(.k): .v}] | add // {}) as $v
        | (.[$k] // {}) as $e | ($e[$l] // $e.en // "")
        | reduce ($v | to_entries[]) as $p (.; split("{" + $p.key + "}") | join($p.value))' \
        "$KF_MSG_FILE" --args "$@" 2>/dev/null
}
