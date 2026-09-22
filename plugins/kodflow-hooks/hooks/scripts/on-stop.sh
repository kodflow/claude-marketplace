#!/bin/bash
# on-stop.sh — Stop: the end of a turn.
#
# Sequence: GATE (loop guards) → BLOCK (a linter verdict that must be acted
# on) → TRANSFORM (feedback Claude reads before it may finish) → OBSERVE.
# The hook emits at most ONE JSON document: Claude Code keeps one response per
# hook, so two documents would lose whichever came first.
set +e

INPUT=$(cat 2>/dev/null); [ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
eval "$(printf '%s' "$INPUT" | jq -r '@sh "SID=\(.session_id // "") CWD=\(.cwd // "") SCRATCH=\(.scratchpad_dir // "") ACTIVE=\(.stop_hook_active // false)"' 2>/dev/null)" || exit 0

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

# --- GATE: loop guards -------------------------------------------------------
# stop_hook_active is Claude Code's own signal that this turn exists because a
# stop hook asked for it. Anything emitted now would ask again.
[ "$ACTIVE" = true ] && { _log; exit 0; }
# Belt and braces: three feedbacks without a new user prompt is a loop,
# whatever the input says. UserPromptSubmit resets the counter.
mkdir -p "$STATE" 2>/dev/null
count=0; [ -f "$STATE/stop-count" ] && read -r count < "$STATE/stop-count"
count=$((count + 1)); printf '%d' "$count" > "$STATE/stop-count" 2>/dev/null
[ "$count" -ge 3 ] && { printf '{"terminalSequence":"\\u0007"}'; _log; exit 0; }

ctx=""

# --- BLOCK: project-linter over HTTP, when a server is listening ------------
# Its verdict is passed through verbatim when it is a decision; a plain
# report joins the feedback below. Phases 1..8: tests included, the agent has
# finished writing; health excluded, too noisy for a turn boundary.
port=${KTN_LINTER_PORT:-7717}
if command -v curl >/dev/null 2>&1 && (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    body=$(printf '%s' "$INPUT" | jq -c --arg p "${KTN_STOP_PHASES:-structural,signatures,logic,performance,modern,style,comment,tests}" '. + {phases: ($p | split(","))}' 2>/dev/null)
    resp=$(curl -sf --max-time 28 -H 'Content-Type: application/json' -d "${body:-$INPUT}" "http://127.0.0.1:$port/hooks/stop" 2>/dev/null)
    if [ -n "$resp" ] && [ "$resp" != "{}" ] && [ "$resp" != null ]; then
        if printf '%s' "$resp" | jq -e '.decision == "block"' >/dev/null 2>&1; then
            printf '%s' "$resp"; _log; exit 0
        fi
        text=$(printf '%s' "$resp" | jq -r '.hookSpecificOutput.additionalContext // .reason // empty' 2>/dev/null)
        [ -z "$text" ] && text=$(printf '%s' "$resp" | head -c 1000)
        [ -n "$text" ] && ctx="project-linter: $text"
    fi
fi

# --- TRANSFORM: this session's edits, from the tracker on-tool.sh fills ------
edited=""
[ -f "$STATE/edited" ] && edited=$(sort -u "$STATE/edited" 2>/dev/null)

if [ -n "$edited" ] && command -v project-linter >/dev/null 2>&1; then
    # Go packages touched this session, and only those: a git diff would pull
    # in every other session's work on the branch.
    pkgs=$(printf '%s\n' "$edited" | grep '\.go$' | sed "s|^$PROJECT_DIR/||" | xargs -r -n1 dirname | sort -u | sed 's|^|./|')
    if [ -n "$pkgs" ]; then
        # shellcheck disable=SC2086
        out=$(cd "$PROJECT_DIR" && timeout 20 project-linter lint $pkgs 2>&1 | tail -50)
        [ ${#out} -gt 2000 ] && out="${out:0:2000}…(truncated)"
        [ -n "$out" ] && ctx="${ctx:+$ctx
}project-linter (session scope):
$out"
    fi
fi

# The CLAUDE.md of every directory this session changed must describe what
# changed (warmup --update convention). Once per directory per session: the
# feedback continues the turn, and a second reminder for the same directory
# would be a loop, not a rule.
if [ -n "$edited" ]; then
    touch "$STATE/claudemd-nudged" 2>/dev/null
    due=""; d=""
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        case "$f" in "$PROJECT_DIR"/*) ;; *) continue ;; esac
        case "$f" in */CLAUDE.md|*/.claude/*|*/.git/*) continue ;; esac
        d=${f%/*}
        while [ "${#d}" -ge "${#PROJECT_DIR}" ]; do
            [ -f "$d/CLAUDE.md" ] && break
            [ "$d" = "$PROJECT_DIR" ] && break
            d=${d%/*}
        done
        [ -f "$d/CLAUDE.md" ] || continue
        printf '%s\n' "$edited" | grep -qxF "$d/CLAUDE.md" && continue      # updated this session
        grep -qxF "$d" "$STATE/claudemd-nudged" 2>/dev/null && continue    # already asked
        printf '%s\n' "$d" >> "$STATE/claudemd-nudged"
        due="$due"$'\n'"  - ${d#$PROJECT_DIR/}/CLAUDE.md"
    done <<<"$edited"
    [ -n "$due" ] && ctx="${ctx:+$ctx
}Before finishing, update the CLAUDE.md of each directory you changed this session (warmup --update convention: what changed and why, no history, at most 1000 lines; leave it as is only if nothing a future session needs has changed, and say so):$due"
fi

# Open tasks of the main agent. A task left pending or in progress after the
# work is done stays on the status line for good, so the turn is asked to
# settle it. Two sources: the tasks MCP of this plugin
# (<config>/kodflow/sessions/<session>/tasks.json, the main agent's entries),
# and the built-in tools' one-file-per-task list under <config>/tasks/<list>/
# (list = CLAUDE_CODE_TASK_LIST_ID or session-<first 8 chars of the session
# id>), read unless those tools are switched off. Once per state of the open
# set: a task that genuinely waits on the user is not re-asked every turn.
cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
open=""
mcp_tasks=$cfg/kodflow/sessions/$SID/tasks.json
# Only the main agent's active epic (its tasks with no epic when none is
# active): the other open epics are not this turn's subject. lib/epics.jq
# reads v1 and v2 files alike and turns a malformed one into an empty list.
mcp_epic='include "epics"; v2 | active_tasks("main")'
[ -s "$mcp_tasks" ] && open=$(jq -r -L "$LIB" "$mcp_epic"' | select(.status == "pending" or .status == "in_progress") | "\(.id)\t\(.status)\t\(.subject)\ttask_update"' \
    "$mcp_tasks" 2>/dev/null)
case "${CLAUDE_CODE_ENABLE_TODO_TOOLS:-}" in 0|false|no|off) ;; *)
    list=${CLAUDE_CODE_TASK_LIST_ID:-session-${SID:0:8}}
    tasks_dir=$cfg/tasks/${list//[^A-Za-z0-9_-]/-}
    compgen -G "$tasks_dir/*.json" >/dev/null 2>&1 && open="${open:+$open
}$(jq -r 'select(.status == "pending" or .status == "in_progress") | "\(.id)\t\(.status)\t\(.subject)\tTaskUpdate"' \
        "$tasks_dir"/*.json 2>/dev/null)"
;; esac
open=$(printf '%s\n' "$open" | grep -v '^$' | sort -n)
if [ -n "$open" ]; then
    sig=$(printf '%s' "$open" | cksum | cut -d' ' -f1)
    if ! grep -qxF "$sig" "$STATE/tasks-nudged" 2>/dev/null; then
        printf '%s\n' "$sig" >> "$STATE/tasks-nudged"
        due=$(printf '%s\n' "$open" | awk -F'\t' '{printf "\n  - #%s %s (%s, via %s)", $1, $3, $2, $4}')
        ctx="${ctx:+$ctx
}Tasks still open in your task list. Mark each one completed if its work is done, deleted if it no longer applies, waiting if it is blocked on the user:$due"
    fi
fi

# The list must say what is true now. Tasks left to do with none in progress
# and none waiting is a state that is always false: either one is under way,
# or they wait on the user. Unlike the reminder above, this one is repeated
# every turn until the list is corrected — it asks for one status change, not
# for a decision the user owes — and the loop guard above still caps a turn.
if [ -s "$mcp_tasks" ]; then
    counts=$(jq -r -L "$LIB" 'include "epics"; v2 | [active_tasks("main") | .status] | "\(map(select(. == "pending")) | length) \(map(select(. == "in_progress")) | length) \(map(select(. == "waiting")) | length)"' \
        "$mcp_tasks" 2>/dev/null)
    read -r n_pending n_active n_waiting <<<"${counts:-0 0 0}"
    if [ "${n_pending:-0}" -gt 0 ] && [ "${n_active:-0}" -eq 0 ] && [ "${n_waiting:-0}" -eq 0 ]; then
        ctx="${ctx:+$ctx
}Your task list shows $n_pending task(s) to do and none in progress or waiting, which cannot be true. Set the one you are working on to in_progress, or set the ones blocked on the user (a decision, an approval, an answer) to waiting."
    fi

    # One task in progress per worker, across every epic: the main agent is
    # one worker, each running subagent another. More amber cells than
    # workers means some task is shown as moving while nobody is on it —
    # typically a subagent finished and its task was never closed.
    busy=$(jq -r '[.tasks[]? | select((.agent // "main") == "main" and .status == "in_progress") | "#\(.id) \(.subject)"] | "\(length)\t\(join(", "))"' \
        "$mcp_tasks" 2>/dev/null)
    n_busy=${busy%%$'\t'*}; busy_list=${busy#*$'\t'}
    agents_file=${mcp_tasks%/*}/agents.json
    running=0
    [ -s "$agents_file" ] && running=$(jq -r --argjson cut "$(( $(date +%s) - 43200 ))" \
        '[.agents // {} | .[] | select(type == "object" and .stopped == null and (.started // 0) >= $cut)] | length' \
        "$agents_file" 2>/dev/null)
    workers=$(( 1 + ${running:-0} ))
    if [ "${n_busy:-0}" -gt "$workers" ] 2>/dev/null; then
        ctx="${ctx:+$ctx
}$n_busy tasks are in progress for $workers worker(s) (you and ${running:-0} running subagent(s)): $busy_list. One task per worker: set every task nobody is working on right now to completed, pending or waiting."
    fi

    # The main thread delegates; it does not do the epic itself. Every epic under way is
    # carried by a subagent in its own worktree, so a main-agent task in
    # progress on an epic no running subagent is attributed to (agents.json
    # `epic`, recorded at SubagentStart from the active epic) means main is
    # doing the work itself. Every turn until corrected, like the rules above.
    # KODFLOW_ROOT=off turns it off with the PreToolUse gate.
    if [ "${KODFLOW_ROOT:-}" != off ]; then
        covered="[]"
        [ -s "$agents_file" ] && covered=$(jq -c --argjson cut "$(( $(date +%s) - 43200 ))" \
            '[.agents // {} | .[] | select(type == "object" and .stopped == null and (.started // 0) >= $cut) | (.epic // 0)] | unique' \
            "$agents_file" 2>/dev/null)
        [[ $covered == \[*\] ]] || covered="[]"
        producing=$(jq -r --argjson cov "$covered" '.tasks[]? | objects
            | select((.agent // "main") == "main" and .status == "in_progress")
            | (.epic // 0) as $e | select(any($cov[]; . == $e) | not)
            | "  - #\(.id) \(.subject): " + (if $e == 0 then "dispatch a subagent in a worktree for it" else "dispatch a subagent in a worktree for epic #\($e)" end)
              + ", or set #\(.id) back to pending/waiting"' "$mcp_tasks" 2>/dev/null)
        [ -n "$producing" ] && ctx="${ctx:+$ctx
}The main thread delegates the work of an epic to a subagent, and these tasks are in progress with no running subagent on their epic (task_focus the epic before dispatching, so the subagent is attributed to it; SendMessage its subagent if one is already on it):
$producing"
    fi
fi

# Hooks have no terminal: the bell travels in the JSON, alongside the
# feedback, so the document stays single.
jq -n -c --arg c "$ctx" '{terminalSequence:"\u0007"} + (if $c == "" then {} else {hookSpecificOutput:{hookEventName:"Stop",additionalContext:$c}} end)' 2>/dev/null
_log
exit 0
