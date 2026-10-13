# beat.sh — whether the mod (hooks/mod/register.ts) is loaded in this session.
# shellcheck shell=bash
#
# The task tools are function hooks, not an MCP server: they exist only while
# Claude Code has the mod loaded (2.1.293 or later, KODFLOW_MOD not off, no
# failed reload). The mod writes the time in seconds to
# <config>/kodflow/sessions/<session>/mod-beat before every prompt, session
# start and tool call it sees — before the shell hook of that same event runs,
# which Claude Code calls inside the mod's hook. So a beat younger than
# KF_BEAT_FRESH seconds (default 5) means the task tools answer right now; an
# older one means the mod was there and is gone; none means it never loaded.
#
#   . "$LIB/beat.sh"
#   kf_beat "$SESSION_DIR"   → 0 fresh, 1 stale, 2 absent

kf_beat() {
    local f=$1/mod-beat t now
    [ -f "$f" ] || return 2
    read -r t < "$f" 2>/dev/null
    case "$t" in ''|*[!0-9]*) return 1 ;; esac
    now=$(date +%s)
    [ $(( now - t )) -lt "${KF_BEAT_FRESH:-5}" ] && [ $(( t - now )) -lt 60 ] && return 0
    return 1
}

# The line shown to the user when the mod was loaded and is not any more.
KF_BEAT_LOST="kodflow-hooks: the mods are unloaded (the task tools are gone): run /reload-plugins. The triage gate is lifted meanwhile."
