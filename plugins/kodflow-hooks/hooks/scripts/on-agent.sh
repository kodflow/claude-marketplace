#!/bin/bash
# on-agent.sh — SubagentStart, SubagentStop, TaskCreated, TaskCompleted,
# TeammateIdle. Subagents do not inherit the parent's context, so the start
# event carries the rules that matter; everything else is observation.
set +e

INPUT=$(cat 2>/dev/null); [ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
eval "$(printf '%s' "$INPUT" | jq -r '@sh "EV=\(.hook_event_name // "") SID=\(.session_id // "") CWD=\(.cwd // "") AGENT=\(.agent_type // "") AID=\(.agent_id // "") ACTIVE=\(.stop_hook_active // false) MATE=\(.teammate_name // "")"' 2>/dev/null)" || exit 0

SID=${SID//[^A-Za-z0-9_-]/}; SID=${SID:-default}
PROJECT_DIR=${CLAUDE_PROJECT_DIR:-${CWD:-$PWD}}
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

# The running subagents of the session, for the status line and the task
# view: <config>/kodflow/sessions/<session>/agents.json, next to the task list
# the tasks MCP keeps. Start and stop can race, so every write holds the lock.
_agents() {   # $1 = start|stop
    [ -n "$AID" ] || return 0
    local dir=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$SID
    (
        mkdir -p "$dir" 2>/dev/null || exit 0
        exec 9>>"$dir/.lock"; flock -w 2 9 2>/dev/null
        local f=$dir/agents.json cur='{"agents":{}}'
        [ -s "$f" ] && cur=$(cat "$f" 2>/dev/null)
        printf '%s' "$cur" | jq -c --arg id "$AID" --arg type "$AGENT" --arg ev "$1" --argjson now "$(date +%s)" '
            .agents //= {} |
            if $ev == "start" then .agents[$id] = {type:$type, started:$now, stopped:null}
            else .agents[$id].stopped = $now end' > "$f.tmp" 2>/dev/null && mv -f "$f.tmp" "$f"
    ) >/dev/null 2>&1 </dev/null
}

case "$EV" in
SubagentStart)
    _agents start
    _branch
    jq -n -c --arg c "## Subagent context (kodflow-hooks)
Branch: $BRANCH · agent: ${AGENT:-unknown}
1. MCP first: mcp__github__* / mcp__gitlab__* before gh or glab; mcp__context7__* for library docs.
2. rtk rewrites Bash for compressed output; byte-exact reads are never rewritten.
3. Commits: conventional, no AI attribution, never on main, never --no-verify or --force.
4. Return what you were asked for and say what you verified versus what you assumed." \
        '{hookSpecificOutput:{hookEventName:"SubagentStart",additionalContext:$c}}' 2>/dev/null
    _log ;;

SubagentStop)
    [ "$ACTIVE" = true ] && exit 0      # already continuing because of a stop hook
    _agents stop
    _log ;;

TeammateIdle|TaskCreated|TaskCompleted)
    _log ;;
esac
exit 0
