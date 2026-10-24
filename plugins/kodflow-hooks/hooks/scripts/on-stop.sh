#!/bin/bash
# on-stop.sh — Stop: the end of a turn.
#
# Sequence: GATE (loop guards) → TRANSFORM (feedback Claude reads before it
# may finish) → OBSERVE.
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

ctx="" NL=$'\n'

# Every text below comes from hooks/messages.json in the user's language
# (lib/msg.sh). This document's additionalContext is what the screen shows as
# "Stop hook feedback" and what Claude reads: Claude Code renders its ANSI
# colours (measured in a pty, 2.1.309), so the label of each line is
# coloured; the colour costs the model a few tokens, and only on a turn the
# hook speaks.
kf_msg() { :; }; kf_lang() { :; }; kf_msg_color() { :; }
. "$LIB/msg.sh" 2>/dev/null
kf_lang "$PROJECT_DIR"; kf_msg_color 1
_add() { [ -n "$1" ] && ctx="${ctx:+$ctx$NL}$1"; }

# _say CAUSE STATE KEY [name=value...]: one line per cause, said once per
# state; returns 0 when it said it. stop-said holds, per cause, the fingerprint of the state last
# reported: the same state is not reported twice in a row, a changed one
# is, and a cause that clears (STATE empty) drops its record, so the same
# state coming back later is reported again.
_say() {
    local cause=$1 st=$2 f=$STATE/stop-said sig; shift 2
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

# This session's edits, from the tracker on-tool.sh fills. ktn-linter runs
# at PostToolUse on the file just edited (lib/lint.sh), not here: a report at
# turn end came after the work and changed nothing (#75).
edited=""
[ -f "$STATE/edited" ] && edited=$(sort -u "$STATE/edited" 2>/dev/null)

# The CLAUDE.md of every directory this session changed must describe what
# changed (warmup --update convention). Once per directory per session: the
# feedback continues the turn, and a second reminder for the same directory
# would be a loop, not a rule.
# A fixed number of forks whatever the size of the tracker: one awk keeps the
# distinct directories edited in the project, the walk up to the nearest
# CLAUDE.md runs on builtins once per directory, and one awk drops what was
# updated this session or already asked. A test per line, two greps each, cost
# seconds on a long session's tracker.
if [ -n "$edited" ]; then
    touch "$STATE/claudemd-nudged" 2>/dev/null
    dirs=$(printf '%s\n' "$edited" | P="$PROJECT_DIR/" awk '
        index($0, ENVIRON["P"]) != 1 { next }
        /\/CLAUDE\.md$/ || /\/\.claude\// || /\/\.git\// { next }
        { d = $0; sub(/\/[^\/]*$/, "", d); if (!(d in seen)) { seen[d] = 1; print d } }')
    found=""
    while IFS= read -r d; do
        [ -n "$d" ] || continue
        while [ "${#d}" -ge "${#PROJECT_DIR}" ]; do
            [ -f "$d/CLAUDE.md" ] && break
            [ "$d" = "$PROJECT_DIR" ] && break
            d=${d%/*}
        done
        [ -f "$d/CLAUDE.md" ] && found="$found$d$NL"
    done <<<"$dirs"
    new=""
    [ -n "$found" ] && new=$(printf '%s' "$found" | awk '
        FILENAME == ARGV[1] { upd[$0] = 1; next }                 # updated this session
        FILENAME == ARGV[2] { asked[$0] = 1; next }               # already asked
        !(($0 "/CLAUDE.md") in upd) && !($0 in asked) && !($0 in seen) { seen[$0] = 1; print }
    ' "$STATE/edited" "$STATE/claudemd-nudged" - 2>/dev/null)
    due=""
    if [ -n "$new" ]; then
        printf '%s\n' "$new" >> "$STATE/claudemd-nudged"
        while IFS= read -r d; do due="${due:+$due, }${d#$PROJECT_DIR/}/CLAUDE.md"; done <<<"$new"
    fi
    [ -n "$due" ] && _add "$(kf_msg stop.claudemd dirs="$due")"
fi

# A message the turn never filed. triage-pending still there at the end of
# the turn means no task call settled it (on-tool.sh; the mod lifts it cause
# by cause): typically a question answered with no task, or a session resumed
# and never reconciled. Not blocking, once per state of the file (a new
# message is a new state). Not on a system turn (on-user.sh's turn-system):
# it brought no message to file. The beat is not asked to be fresh: the mod
# beats on prompts and tool calls only, so a turn spent answering leaves it
# minutes old; a beat that never came means the gate was never raised, and
# with the mod gone the next prompt lifts the gate (on-user.sh).
tp=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$SID/triage-pending
if [ -f "$tp" ] && [ -f "${tp%/*}/mod-beat" ]; then
    if [ ! -f "$STATE/turn-system" ]; then
        # One line per message not filed yet (`prompt <id>`); an empty file is one
        n=$(grep -cvxE '(resume)?' "$tp" 2>/dev/null); [ -s "$tp" ] || n=1
        st=$(grep -vx resume "$tp" 2>/dev/null); [ -n "$st" ] || st="one"
        if [ "${n:-0}" -gt 1 ] 2>/dev/null; then _say triage "$st" stop.triage.many n="$n"
        elif [ "${n:-0}" -eq 1 ] 2>/dev/null; then _say triage "$st" stop.triage.one
        else _say triage ""; fi
        if grep -qx resume "$tp" 2>/dev/null; then _say resume resume stop.resume; else _say resume ""; fi
    fi
else
    _say triage ""; _say resume ""
fi

# The main agent's task list must say what is true now. Only a state that is
# false is reported, one line per cause, each task in one line at most (the
# first cause that claims it), and each cause once per state (_say):
#   stopped     in progress, tied to a subagent that has stopped
#   unattended  in progress, tied to nobody, on an epic no running subagent
#               covers (the main thread delegates; KODFLOW_ROOT=off drops it)
#   overcount   more untied tasks in progress than workers (the main agent
#               and each running subagent not already holding a task)
#   idle        the active epic has work to do and nothing in progress or waiting
#   loose       requests with no epic left pending (one per message, closed
#               once answered)
#   builtin     open tasks of Claude Code's own task list (TaskUpdate)
# A task in progress on a running subagent, and a waiting task, are true and
# never reported. KODFLOW_STOP_TASKS=off turns every cause but `unattended`
# off (that one follows KODFLOW_ROOT, like the PreToolUse gate).
tasks_on=1; [ "${KODFLOW_STOP_TASKS:-}" = off ] && tasks_on=0
root_on=1; [ "${KODFLOW_ROOT:-}" = off ] && root_on=0
cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
mcp_tasks=$cfg/kodflow/sessions/$SID/tasks.json
agents_file=${mcp_tasks%/*}/agents.json
causes=""
if [ -s "$mcp_tasks" ]; then
    agents='{}'
    [ -s "$agents_file" ] && agents=$(jq -c '.agents // {} | if type == "object" then . else {} end' "$agents_file" 2>/dev/null)
    [[ $agents == \{* ]] || agents='{}'
    # A subagent started over 12 h ago without a stop is not counted as running.
    causes=$(jq -r -L "$LIB" --argjson ag "$agents" --argjson cut "$(( $(date +%s) - 43200 ))" --arg root "$root_on" '
        include "epics"; v2
        | def alive: type == "object" and .stopped == null and (.started // 0) >= $cut;
          def runs($t): $ag[$t.worker_id // ""] | alive;
          def ids: map("#\(.id)") | join(" ");
          def minus($xs): [.[] | . as $t | select(any($xs[]; .id == $t.id) | not)];
        [$ag[] | select(alive)] as $alive
        | ([$alive[] | .epic // 0] | unique) as $cov
        | [.tasks[] | select((.agent // "main") == "main")] as $main
        | [$main[] | select(.status == "in_progress")] as $ip
        | [$ip[] | select((.worker // "") != "" and (runs(.) | not))] as $stopped
        | [$ip[] | select((.worker // "") != "" and runs(.))] as $live
        | [$ip[] | select((.worker // "") == "")] as $free
        | (if $root == "1" then [$free[] | (.epic // 0) as $e | select(any($cov[]; . == $e) | not)] else [] end) as $unatt
        | ($free | length) as $nb | (1 + ($alive | length) - ($live | length)) as $w
        | (if $nb > $w then ($free | minus($unatt)) else [] end) as $over
        | [active_tasks("main")] as $act
        | (if any($act[]; .status == "pending") and (any($act[]; .status == "in_progress" or .status == "waiting") | not)
           then [$act[] | select(.status == "pending")] else [] end) as $idle
        | ([$main[] | select((.epic // 0) == 0 and .status == "pending")] | minus($idle)) as $loose
        | ["stopped", ($stopped | ids)], ["unattended", ($unatt | ids)],
          ["overcount", ($over | ids), $nb, $w], ["idle", ($idle | ids)], ["loose", ($loose | ids)],
          ($stopped[] | ["orphan", .id, (.subject // ""), .worker])
        | map(tostring | gsub("[\u0000-\u001f]"; " ")) | join("\u001f")' "$mcp_tasks" 2>/dev/null)
fi
builtin=""
case "${CLAUDE_CODE_ENABLE_TODO_TOOLS:-}" in 0|false|no|off) ;; *)
    list=${CLAUDE_CODE_TASK_LIST_ID:-session-${SID:0:8}}
    tasks_dir=$cfg/tasks/${list//[^A-Za-z0-9_-]/-}
    compgen -G "$tasks_dir/*.json" >/dev/null 2>&1 && builtin=$(jq -r 'select(.status == "pending" or .status == "in_progress") | .id' \
        "$tasks_dir"/*.json 2>/dev/null | sort -n | sed 's/^/#/' | paste -sd' ' -)
;; esac
for c in stopped unattended overcount idle loose; do
    # fields split by \x1f: a tab would collapse an empty field
    line=$(printf '%s\n' "$causes" | grep "^$c"$'\x1f' | head -n 1)
    IFS=$'\x1f' read -r _ ids n w <<<"$line"
    if [ "$c" = unattended ]; then [ "$root_on" = 1 ] || continue
    else [ "$tasks_on" = 1 ] || continue; fi
    _say "$c" "$ids" "stop.$c" ids="$ids" n="$n" w="$w" || continue
    # Said: one line per orphaned task in the journal of refusals (kind agent)
    if [ "$c" = stopped ] && . "$LIB/blocks.sh" 2>/dev/null; then
        printf '%s\n' "$causes" | grep "^orphan"$'\x1f' | while IFS=$'\x1f' read -r _ id subj worker; do
            kf_block "${mcp_tasks%/*}" agent "" "$worker arrêté, tâche #$id en cours ($subj)" "" "$worker"
        done
    fi
done
[ "$tasks_on" = 1 ] && _say builtin "$builtin" stop.builtin ids="$builtin"

# Agent feedback (on-agent.sh, SubagentStop): what subagents said was
# wrong in their own instructions this session. Proposed, never acted on:
# the turn shows the user each proposed change to the agent's definition and
# asks before any issue is opened. Once per set of new entries, and only to
# someone who typed at the prompt in the last 10 minutes (composer-at, the
# mod's): a night run keeps them for the next turn the user is there.
# An entry whose agent has no definition file (a built-in, an agent defined
# in the session) is passed over: there is no definition to show a diff of.
fb=$cfg/kodflow/sessions/$SID/agent-feedback.jsonl
if [ "${KODFLOW_FEEDBACK:-}" != off ] && [ -s "$fb" ]; then
    seen=0; [ -f "$STATE/feedback-seen" ] && read -r seen < "$STATE/feedback-seen"
    case "$seen" in ''|*[!0-9]*) seen=0 ;; esac
    total=$(wc -l < "$fb" 2>/dev/null | tr -d ' ')
    at=0; [ -f "${fb%/*}/composer-at" ] && read -r at < "${fb%/*}/composer-at"
    case "$at" in ''|*[!0-9]*) at=0 ;; esac
    if [ "${total:-0}" -gt "$seen" ] && [ $(( $(date +%s) - at )) -le 600 ]; then
        items=$(tail -n +"$((seen + 1))" "$fb" | jq -r 'select(type == "object" and (.definition | type) == "string" and .definition != "") | "  - \(.agent_type // "agent") (\(.model // "?")/\(.effort // "?"), \(.source // "?"); \(.definition) [\(.owner // "local")]): \(.feedback // "" | gsub("\n"; " ") | .[:300])"' 2>/dev/null)
        printf '%s' "$total" > "$STATE/feedback-seen" 2>/dev/null
        [ -n "$items" ] && _add "$(kf_msg stop.feedback.head file="$fb")$NL$items$NL$(kf_msg stop.feedback.tail)"
    fi
fi

# Hooks have no terminal: the bell travels in the JSON, alongside the
# feedback, so the document stays single.
jq -n -c --arg c "$ctx" '{terminalSequence:"\u0007"} + (if $c == "" then {} else {hookSpecificOutput:{hookEventName:"Stop",additionalContext:$c}} end)' 2>/dev/null
_log
exit 0
