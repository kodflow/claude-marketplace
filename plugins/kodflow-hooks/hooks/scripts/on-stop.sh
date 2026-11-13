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
eval "$(printf '%s' "$INPUT" | jq -r '@sh "SID=\(.session_id // "") CWD=\(.cwd // "") SCRATCH=\(.scratchpad_dir // "") ACTIVE=\(.stop_hook_active // false) AGENT_ID=\(.agent_id // "") PMODE=\(.permission_mode // "")"' 2>/dev/null)" || exit 0

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

# --- CONTINUE: open tasks relaunch the turn, twice per task at most ----------
# "Treat a text-only end of turn as a report rather than as proof the task is
# done" and "stop after two or three automatic continuations on the same task"
# (Anthropic, Prompting Claude Opus 5.5). When the main agent ends its turn
# with tasks of the kodflow list still to do, the stop is blocked with the
# guide's reminder naming them. To do means: the main agent's, in an epic,
# pending with every blocker done, or in progress and not on a running
# subagent (whose notification will wake the turn). A waiting task is the
# user's to unblock and never relaunches anything. Each task relaunches the
# turn twice at most in the session ($STATE/stop-continue, `id<TAB>count`),
# so the loop ends even when stop_hook_active stays true; a counter that
# cannot be written blocks nothing. Never for a subagent, never in plan mode,
# off with KODFLOW_STOP_CONTINUE=off or KODFLOW_STOP_TASKS=off. Every error
# lets the stop through.
CONT_MAX=2
cont_reason=""
_continue() {
    [ -z "$AGENT_ID" ] || return 0
    [ "$PMODE" != plan ] || return 0
    [ "${KODFLOW_STOP_CONTINUE:-}" != off ] && [ "${KODFLOW_STOP_TASKS:-}" != off ] || return 0
    local cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude} store ag='{}' open f=$STATE/stop-continue counts="" due="" items="" id subj n
    store=$cfg/kodflow/sessions/$SID/tasks.json
    [ -s "$store" ] || return 0
    [ -s "${store%/*}/agents.json" ] && ag=$(jq -c '.agents // {} | if type == "object" then . else {} end' "${store%/*}/agents.json" 2>/dev/null)
    [[ $ag == \{* ]] || ag='{}'
    open=$(jq -r -L "$LIB" --argjson ag "$ag" --argjson cut "$(( $(date +%s) - 43200 ))" '
        include "epics"; v2
        | def alive: type == "object" and .stopped == null and (.started // 0) >= $cut;
          def settled($s): $s == null or $s == "completed" or $s == "deleted";   # deleted: gone from the list
        [.epics[] | select((.agent // "main") == "main" and (closed | not)) | .id] as $eps
        | closed_ids as $shut
        # A blocker in a closed epic is settled like a completed one
        | (reduce (.tasks[] | select((.agent // "main") == "main")) as $t ({};
              .[$t.id | tostring] = (if any($shut[]; . == ($t.epic // 0)) then "completed" else $t.status end))) as $st
        | .tasks[] | select((.agent // "main") == "main")
        | (.epic // 0) as $e | select($e != 0 and any($eps[]; . == $e))
        | select((.status == "pending"
                  and ((.blockedBy // []) | if type == "array" then all(.[]; settled($st[tostring])) else true end))
                 or (.status == "in_progress" and (($ag[.worker_id // ""] // null) | alive | not)))
        | [(.id | tostring), ((.subject // "") | tostring | gsub("[\u0000-\u001f]"; " "))] | join("\u001f")' "$store" 2>/dev/null) || return 0
    [ -n "$open" ] || return 0
    [ -f "$f" ] && counts=$(cat "$f" 2>/dev/null)
    while IFS=$'\x1f' read -r id subj; do
        [ -n "$id" ] || continue
        n=$(printf '%s\n' "$counts" | awk -F '\t' -v k="$id" '$1 == k { print $2; exit }')
        case "$n" in ''|*[!0-9]*) n=0 ;; esac
        [ "$n" -lt "$CONT_MAX" ] || continue
        due="$due$id$NL"; items="${items:+$items; }#$id $subj"
    done <<<"$open"
    [ -n "$due" ] || return 0
    # Count first: a relaunch the counter does not record could repeat for ever.
    printf '%s\n%s' "$counts" "$due" | awk -F '\t' 'NF { k = $1; c[k] = ($2 == "" ? c[k] + 1 : $2) } END { for (k in c) printf "%s\t%d\n", k, c[k] }' > "$f.$$" 2>/dev/null \
        && mv -f "$f.$$" "$f" 2>/dev/null || { rm -f "$f.$$" 2>/dev/null; return 0; }
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        grep -qx "$id"$'\t''[0-9]*' "$f" 2>/dev/null || return 0
    done <<<"$due"
    kf_msg_color 0
    cont_reason=$(kf_msg stop.continue items="$items")
    [ -n "$cont_reason" ] || cont_reason="Your task list still has open items: $items. Continue with them. If one is blocked, say what is blocking it."
    kf_msg_color 1
    return 0
}

# --- GATE: loop guards -------------------------------------------------------
# stop_hook_active is Claude Code's own signal that this turn exists because a
# stop hook asked for it. Anything emitted now would ask again, except the
# open-tasks relaunch, which its per-task counter bounds.
NL=$'\n'
kf_msg() { :; }; kf_lang() { :; }; kf_msg_color() { :; }
. "$LIB/msg.sh" 2>/dev/null
kf_lang "$PROJECT_DIR"
mkdir -p "$STATE" 2>/dev/null
_continue
_block() { jq -n -c --arg r "$cont_reason" '{decision:"block",reason:$r}' 2>/dev/null; }
[ "$ACTIVE" = true ] && { [ -n "$cont_reason" ] && _block; _log; exit 0; }
# Belt and braces: three feedbacks without a new user prompt is a loop,
# whatever the input says. UserPromptSubmit resets the counter.
count=0; [ -f "$STATE/stop-count" ] && read -r count < "$STATE/stop-count"
count=$((count + 1)); printf '%d' "$count" > "$STATE/stop-count" 2>/dev/null
[ "$count" -ge 3 ] && { jq -n -c --arg r "$cont_reason" '{terminalSequence:"\u0007"} + (if $r == "" then {} else {decision:"block",reason:$r} end)' 2>/dev/null || printf '{"terminalSequence":"\\u0007"}'; _log; exit 0; }

ctx=""

# Every text below comes from hooks/messages.json in the user's language
# (lib/msg.sh). This document's additionalContext is what the screen shows as
# "Stop hook feedback" and what Claude reads: Claude Code renders its ANSI
# colours (measured in a pty, 2.1.309), so the label of each line is
# coloured; the colour costs the model a few tokens, and only on a turn the
# hook speaks.
kf_msg_color 1
_add() { [ -n "$1" ] && ctx="${ctx:+$ctx$NL}$1"; }

# _say CAUSE STATE KEY [name=value...] (lib/say.sh): one line per cause,
# said once per state, in $STATE/stop-said.
_say() { return 1; }
. "$LIB/say.sh" 2>/dev/null

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

# A message the turn never filed, and work it tried to write regardless.
# triage-pending still there at the end of the turn means no task call
# settled it; a question answered by reading needs no task, so the reminder
# comes only once the turn tried a tool off the read list (the mod writes
# triage-wrote before the call runs, refused or not). A session resumed and
# never reconciled is said either way. Not blocking, once per state of the
# file (a new message is a new state). Not on a system turn (on-user.sh's turn-system):
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
        if [ ! -f "${tp%/*}/triage-wrote" ]; then _say triage ""
        elif [ "${n:-0}" -gt 1 ] 2>/dev/null; then _say triage "$st" stop.triage.many n="$n"
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
        | closed_ids as $shut
        | [.tasks[] | select((.agent // "main") == "main") | (.epic // 0) as $e | select(any($shut[]; . == $e) | not)] as $main
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
          ["overcount", ($over | ids), $nb, $w], ["idle", ($idle | ids)], ["loose", ($loose | ids)]
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
    _say "$c" "$ids" "stop.$c" ids="$ids" n="$n" w="$w"
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
# The relaunch rides in the same document: decision and reason beside the
# feedback, which Claude Code reads together.
jq -n -c --arg c "$ctx" --arg r "$cont_reason" '{terminalSequence:"\u0007"}
    + (if $c == "" then {} else {hookSpecificOutput:{hookEventName:"Stop",additionalContext:$c}} end)
    + (if $r == "" then {} else {decision:"block",reason:$r} end)' 2>/dev/null
_log
exit 0
