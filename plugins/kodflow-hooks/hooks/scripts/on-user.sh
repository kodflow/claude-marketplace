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
    # Every message is triaged into the task list before anything is done
    # about it: on-tool.sh refuses acting tools until a task tool clears this.
    mkdir -p "$STATE" 2>/dev/null && : > "$STATE/triage-pending" 2>/dev/null

    # TRANSFORM: where we are. Branch, and the newest plan and goal so a
    # resumed or compacted session picks the task back up.
    _branch
    NL=$'\n' ctx=""
    [ "$BRANCH" != detached ] && ctx="Current branch: $BRANCH"
    if [ -d "$PROJECT_DIR/.claude/plans" ]; then
        newest=$(ls -t "$PROJECT_DIR/.claude/plans"/*.md 2>/dev/null | head -1)
        [ -n "$newest" ] && ctx="${ctx:+$ctx$NL}Latest plan: .claude/plans/${newest##*/} (read it when resuming)"
    fi
    if [ -d "$PROJECT_DIR/.claude/goals" ]; then
        newest=$(ls -t "$PROJECT_DIR/.claude/goals"/*.md 2>/dev/null | head -1)
        [ -n "$newest" ] && ctx="${ctx:+$ctx$NL}Latest goal: .claude/goals/${newest##*/}"
    fi

    # The main agent's epics as the tasks MCP left them, so the triage below
    # has the ids at hand. Any read error leaves the line out.
    tasks=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$SID/tasks.json
    if [ -s "$tasks" ]; then
        state=$(jq -r -L "$LIB" 'include "epics"; v2 | active("main") as $a
            | [epic_rows("main")] as $rows
            | ($rows | map(select(.id == $a)) | .[0]) as $act
            | ($rows | map(select(.id != $a and .done < .total)) | sort_by(-.touched) | .[:5]) as $others
            | ([.tasks[] | select((.agent // "main") == "main" and (.epic // 0) == 0 and .status != "completed")] | length) as $loose
            | if $act == null and ($others | length) == 0 and $loose == 0 then empty else
                [ (if $act then "active #\($act.id) \($act.title) \($act.done)/\($act.total)"
                      + (if $act.current then ", in progress #\($act.current.id) \($act.current.subject)" else "" end)
                   else "none active" end),
                  (if ($others | length) > 0 then "other open: " + ($others | map("#\(.id) \(.title) \(.done)/\(.total)") | join("; ")) else empty end),
                  (if $loose > 0 then "no epic: \($loose) open task(s)" else empty end)
                ] | "Epics: " + join(" · ") end' "$tasks" 2>/dev/null)
        [ -n "$state" ] && ctx="${ctx:+$ctx$NL}$state"
    fi

    # Every message is sorted before any work, so a remark about the task in
    # progress does not become a new task and a new subject does not become
    # the tail of an unrelated epic. The tasks MCP ships in this plugin, so
    # the directive is always there. Kept short: it rides on every prompt.
    ctx="${ctx:+$ctx$NL}TRIAGE this message before acting (kodflow task tools); task_create always names its epic (epic=id, 0 for none, no default):
- new work for an open epic: task_create(epic=id)
- context on the in_progress task: apply it, no new task
- change to a completed task: task_create \"Rework #N: ...\" in its epic
- new subject: task_epic(title, 20 chars max), then task_create(epic=its id)
- question or discussion: no task"
    # Code in a repository is delegated to subagents (the PreToolUse gate of
    # on-tool.sh and the Stop rule enforce it); off with KODFLOW_ROOT=off.
    [ "${KODFLOW_ROOT:-}" != off ] && ctx="$ctx
Code in a repository: dispatch a subagent (own worktree, delivers a PR) or SendMessage the epic's subagent; you review and merge, you do not write it."
    ctx="$ctx
Keep statuses true: in_progress while worked on, waiting when blocked on the user, completed once verified."
    jq -n -c --arg c "$ctx" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$c}}' 2>/dev/null
    _log ;;

Notification)
    # Hooks run without a terminal, so the bell is returned for Claude Code
    # to emit. It rings in any terminal, tmux or container; notify-send does not.
    case "$NTYPE" in idle_prompt|permission_prompt|elicitation_dialog|"") printf '{"terminalSequence":"\\u0007"}' ;; esac
    _log ;;
esac
exit 0
