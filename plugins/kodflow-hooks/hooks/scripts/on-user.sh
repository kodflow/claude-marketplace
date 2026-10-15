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
    # Claude Code fires this event for turns the user never typed: a background
    # task finishing, a message relayed from another agent (a subagent's
    # hand-back arrives inside that same wrapper). Those carry nothing to
    # triage, so raising the gate on them only makes the next tool call fail
    # with TRIAGE FIRST.
    # The first two prefixes are the payload's .prompt verbatim, measured. The
    # last two are shapes seen reaching a session but not yet in a hook payload,
    # matched for one startswith each rather than left to surprise us.
    # Anchored at the start, so a user who quotes one of them is still triaged.
    # A "Stop hook feedback:" turn is deliberately absent: it quotes the user's
    # own pending message, which has not been triaged yet.
    # The prompt is tested inside jq and never enters the shell.
    SYSTURN=$(printf '%s' "$INPUT" | jq -r '(.prompt // "")
        | if   startswith("<task-notification>")
            or startswith("<agent-message ")
            or startswith("<teammate-message ")
            or startswith("[SYSTEM NOTIFICATION - NOT USER INPUT]")
          then "1" else "" end' 2>/dev/null)

    # The task tools are the mod's (hooks/mod/register.ts): everything below
    # that sends the model to them waits for its beat, written just before
    # this hook ran. A stale beat is a mod that was unloaded; no beat at all,
    # a Claude Code without mods or KODFLOW_MOD=off.
    SDIR=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$SID
    BEAT=2; . "$LIB/beat.sh" 2>/dev/null && { kf_beat "$SDIR"; BEAT=$?; }
    msg=""
    case "$BEAT" in
        1) msg=$KF_BEAT_LOST; rm -f -- "$SDIR/triage-pending" 2>/dev/null ;;
        2) if [ "${KODFLOW_MOD:-}" != off ] && [ ! -f "$STATE/mod-absent-said" ]; then
               msg="kodflow-hooks: the task tools did not load. They are a mod and need Claude Code 2.1.293 or later (or run /reload-plugins); tasks are not tracked this session."
               mkdir -p "$STATE" 2>/dev/null && : > "$STATE/mod-absent-said" 2>/dev/null
           fi ;;
    esac

    # Whose turn this is, for on-stop.sh: a system turn brought no message,
    # so an unsettled triage is not reminded at its end.
    mkdir -p "$STATE" 2>/dev/null
    if [ -n "$SYSTURN" ]; then : > "$STATE/turn-system" 2>/dev/null; else rm -f -- "$STATE/turn-system" 2>/dev/null; fi

    if [ -z "$SYSTURN" ]; then
        # A new prompt means the user is back in control: the Stop hook's loop
        # counter starts over. A system turn is not the user back in control —
        # resetting there would let a notification/feedback loop run forever.
        rm -f -- "$STATE/stop-count" 2>/dev/null
        # Every message is triaged into the task list before anything is done
        # about it: on-tool.sh refuses acting tools until the mod settles this
        # message (a task of its own, or context on the task in progress).
        # One line per message, `prompt <id>`, so two messages sent before
        # the first is filed need two gestures. Appended under the lock the
        # mod takes to drop a line (register.ts settleTriage): neither write
        # loses the other's; a lock not obtained in 2 s is written through.
        # Only while the task tools answer: a gate nothing can lift would
        # stop the session.
        [ "$BEAT" = 0 ] && mkdir -p "$SDIR" 2>/dev/null && (
            . "$LIB/lock.sh" 2>/dev/null && kf_lock "$SDIR/.triage.lock.d" 2
            printf 'prompt %s-%s-%s\n' "$(date +%s)" "$$" "$RANDOM" >> "$SDIR/triage-pending"
        ) 2>/dev/null
        # The user's presence, for on-stop.sh's agent-feedback proposal. The
        # mod writes it on composer prompts only; without the mod this is the
        # nearest reading: a prompt that is not a system turn.
        [ "$BEAT" != 0 ] && mkdir -p "$SDIR" 2>/dev/null && date +%s > "$SDIR/composer-at" 2>/dev/null
    fi

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

    # The main agent's epics as the task tools left them, so the triage below
    # has the ids at hand, and the tasks waiting on the user
    # (task_assign_human), so an answer they give is matched to its task.
    # Any read error leaves the line out.
    tasks=$SDIR/tasks.json
    if [ "$BEAT" = 0 ] && [ -s "$tasks" ]; then
        state=$(jq -r -L "$LIB" 'include "epics"; v2 | active("main") as $a
            | [epic_rows("main")] as $rows
            | ($rows | map(select(.id == $a)) | .[0]) as $act
            | ($rows | map(select(.id != $a and .done < .total)) | sort_by(-.touched) | .[:5]) as $others
            | ([.tasks[] | select((.agent // "main") == "main" and (.epic // 0) == 0 and .status != "completed")] | length) as $loose
            | [.tasks[] | select((.agent // "main") == "main" and .assignee == "human" and .status != "completed")] as $human
            | if $act == null and ($others | length) == 0 and $loose == 0 and ($human | length) == 0 then empty else
                [ (if $act then "active #\($act.id) \($act.title) \($act.done)/\($act.total)"
                      + (if $act.current then ", in progress #\($act.current.id) \($act.current.subject)" else "" end)
                   else "none active" end),
                  (if ($others | length) > 0 then "other open: " + ($others | map("#\(.id) \(.title) \(.done)/\(.total)") | join("; ")) else empty end),
                  (if $loose > 0 then "no epic: \($loose) open task(s)" else empty end),
                  (if ($human | length) > 0 then "waiting on the user: " + ($human | map("#\(.id) \(.subject)") | join("; ")) + " (task_update completed once answered)" else empty end)
                ] | "Epics: " + join(" · ") end' "$tasks" 2>/dev/null)
        [ -n "$state" ] && ctx="${ctx:+$ctx$NL}$state"
    fi

    # Every message is sorted before any work, so a remark about the task in
    # progress does not become a new task and a new subject does not become
    # the tail of an unrelated epic; a question gets a task of its own, closed
    # once answered. Given whenever the task tools answer.
    # Kept short: it rides on every prompt.
    # A system turn brought no message to sort: the state above is what it
    # needs, the directive would only send it triaging a notification.
    [ -z "$SYSTURN" ] && [ "$BEAT" = 0 ] && ctx="${ctx:+$ctx$NL}TRIAGE this message before acting (kodflow task tools), one task per message; task_create always names its epic (epic=id, 0 for none, no default):
- new work for an open epic: task_create(epic=id)
- context on the in_progress task: task_update(id, description)
- change to a completed task: task_create \"Rework #N: ...\" in its epic
- new subject: task_epic(title, 20 chars max), then task_create(epic=its id)
- question: task_create(epic=0), completed once answered"
    # Code in a repository is delegated to subagents (the PreToolUse gate of
    # on-tool.sh and the Stop rule enforce it); off with KODFLOW_ROOT=off.
    [ "${KODFLOW_ROOT:-}" != off ] && ctx="${ctx:+$ctx$NL}Code in a repository: dispatch a subagent (own worktree, delivers a PR) or SendMessage the epic's subagent; you review and merge, you do not write it."
    [ "$BEAT" = 0 ] && ctx="${ctx:+$ctx$NL}Keep statuses true: in_progress while worked on, waiting when blocked on the user, completed once verified."
    jq -n -c --arg c "$ctx" --arg m "$msg" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$c}}
        + (if $m == "" then {} else {systemMessage:$m} end)' 2>/dev/null
    _log ;;

Notification)
    # Hooks run without a terminal, so the bell is returned for Claude Code
    # to emit. It rings in any terminal, tmux or container; notify-send does not.
    case "$NTYPE" in idle_prompt|permission_prompt|elicitation_dialog|"") printf '{"terminalSequence":"\\u0007"}' ;; esac
    _log ;;
esac
exit 0
