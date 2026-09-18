#!/bin/bash
# on-session.sh — SessionStart.
#
# Sequence: GATE → (no block: nothing here may stop a session) → TRANSFORM
# (speak only when the sync failed) → done. The work itself is one idempotent
# script that usually compares a checksum and exits.
set +e

INPUT=$(cat 2>/dev/null)
ROOT=${CLAUDE_PLUGIN_ROOT:-${BASH_SOURCE[0]%/hooks/scripts/*}}
SETUP=$ROOT/bin/kodflow-shell-setup
[ -x "$SETUP" ] || exit 0

# SessionStart is the only event wired here, but the payload says so anyway.
if command -v jq >/dev/null 2>&1 && [ -n "$INPUT" ]; then
    EV=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // ""' 2>/dev/null)
    [ -n "$EV" ] && [ "$EV" != SessionStart ] && exit 0
fi

ERR=$("$SETUP" --quiet 2>&1 >/dev/null)

# The status line binary is installed the same way and on the same event, so a
# marketplace update reaches every terminal at the next launch. It is a separate
# script because it fetches a release asset rather than mirroring plugin files,
# and because a network failure there must not touch the shell integration.
STATUSLINE=$ROOT/bin/kodflow-statusline-setup
if [ -x "$STATUSLINE" ]; then
    SL_ERR=$("$STATUSLINE" --quiet 2>&1 >/dev/null)
    [ -n "$SL_ERR" ] && ERR=$(printf '%s\n%s' "$ERR" "$SL_ERR")
fi

if [ -n "$ERR" ] && command -v jq >/dev/null 2>&1; then
    jq -n -c --arg c "kodflow-shell: synchronisation incomplète — $ERR" \
       '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}' 2>/dev/null
fi
exit 0
