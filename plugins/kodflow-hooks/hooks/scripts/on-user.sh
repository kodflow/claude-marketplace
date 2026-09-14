#!/bin/bash
# on-user.sh — UserPromptSubmit and Notification: the human-facing edge.
# Sequence: GATE → TRANSFORM (context Claude reads with the prompt) → OBSERVE.
set +e

INPUT=$(cat 2>/dev/null); [ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
eval "$(printf '%s' "$INPUT" | jq -r '@sh "EV=\(.hook_event_name // "") SID=\(.session_id // "") CWD=\(.cwd // "") SCRATCH=\(.scratchpad_dir // "") NTYPE=\(.notification_type // "")"' 2>/dev/null)" || exit 0

SID=${SID//[^A-Za-z0-9_-]/}; SID=${SID:-default}
PROJECT_DIR=${CLAUDE_PROJECT_DIR:-${CWD:-$PWD}}
STATE=${SCRATCH:-${TMPDIR:-/tmp}/claude-hooks-$SID}
LIB=${BASH_SOURCE[0]%/*}/lib

_branch() {
    local g=$PROJECT_DIR/.git head
    if [ -f "$g" ]; then read -r head < "$g"; g=${head#gitdir: }; [[ $g = /* ]] || g=$PROJECT_DIR/$g; fi
    if [ -f "$g/HEAD" ]; then
        read -r head < "$g/HEAD"
        case "$head" in "ref: refs/heads/"*) BRANCH=${head#ref: refs/heads/} ;; *) BRANCH=detached ;; esac
    else
        BRANCH=$(git -C "$PROJECT_DIR" symbolic-ref --short HEAD 2>/dev/null) || BRANCH=detached
    fi
    BRANCH_SAFE=${BRANCH//\//_}; BRANCH_SAFE=${BRANCH_SAFE// /_}
}
_log() {
    _branch
    local dir=$PROJECT_DIR/.claude/logs/$BRANCH_SAFE
    (
        mkdir -p "$dir" 2>/dev/null || exit 0
        exec 9>>"$dir/.lock"; flock -w 2 9 2>/dev/null
        printf '%s' "$INPUT" | jq -c --arg b "$BRANCH" -f "$LIB/event.jq" >> "$dir/session.jsonl" 2>/dev/null
    ) >/dev/null 2>&1 </dev/null &
}

case "$EV" in
UserPromptSubmit)
    # A new prompt means the user is back in control: the Stop hook's loop
    # counter starts over.
    rm -f -- "$STATE/stop-count" 2>/dev/null

    # TRANSFORM: where we are. Branch, and the newest plan and goal so a
    # resumed or compacted session picks the task back up.
    _branch
    ctx="Current branch: $BRANCH"
    if [ -d "$PROJECT_DIR/.claude/plans" ]; then
        newest=$(ls -t "$PROJECT_DIR/.claude/plans"/*.md 2>/dev/null | head -1)
        [ -n "$newest" ] && ctx="$ctx"$'\n'"Latest plan: .claude/plans/${newest##*/} (read it when resuming)"
    fi
    if [ -d "$PROJECT_DIR/.claude/goals" ]; then
        newest=$(ls -t "$PROJECT_DIR/.claude/goals"/*.md 2>/dev/null | head -1)
        [ -n "$newest" ] && ctx="$ctx"$'\n'"Latest goal: .claude/goals/${newest##*/}"
    fi
    [ "$BRANCH" != detached ] && jq -n -c --arg c "$ctx" \
        '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$c}}' 2>/dev/null
    _log ;;

Notification)
    # Hooks run without a terminal, so the bell is returned for Claude Code
    # to emit. It rings in any terminal, tmux or container; notify-send does not.
    case "$NTYPE" in idle_prompt|permission_prompt|elicitation_dialog|"") printf '{"terminalSequence":"\\u0007"}' ;; esac
    _log ;;
esac
exit 0
