#!/bin/bash
# on-session.sh — SessionStart, SessionEnd, PreCompact and ConfigChange.
#
# Sequence per event: GATE → BLOCK (none here: nothing at session level may
# stop the session) → TRANSFORM (context Claude reads) → OBSERVE (log).
# SessionEnd hooks share a 1.5 s budget that plugin timeouts cannot raise, so
# that branch does one append and leaves.
set +e

INPUT=$(cat 2>/dev/null); [ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
eval "$(printf '%s' "$INPUT" | jq -r '@sh "EV=\(.hook_event_name // "") SID=\(.session_id // "") CWD=\(.cwd // "") SCRATCH=\(.scratchpad_dir // "") SOURCE=\(.source // "") FILE=\(.file_path // "")"' 2>/dev/null)" || exit 0

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
_context() { jq -n -c --arg c "$1" --arg e "$EV" '{hookSpecificOutput:{hookEventName:$e,additionalContext:$c}}' 2>/dev/null; }

case "$EV" in
SessionStart)
    ctx=""
    # A resumed, cleared or compacted session inherits a task list that no
    # longer says what is true: nothing is in progress at startup, whatever
    # the file claims. The list is shown and must be reconciled before any
    # other action — the triage gate of on-tool.sh holds acting tools until a
    # task tool is called.
    tasks_file=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$SID/tasks.json
    if [ -s "$tasks_file" ]; then
        open=$(jq -r -L "$LIB" -f "$LIB/review.jq" "$tasks_file" 2>/dev/null)
        if [ -n "$open" ]; then
            mkdir -p "$STATE" 2>/dev/null && : > "$STATE/triage-pending" 2>/dev/null
            ctx="## SESSION START — review the task list before anything else
These tasks were left open by earlier work. Nothing is in progress right now: an in_progress status is a leftover of the previous run. With the kodflow task tools, reconcile each one with reality first — completed if its work is done (check before deciding), deleted if it no longer applies, waiting if it is blocked on the user, in_progress only for the one you resume now (task_focus its epic). Then tell the user what you resumed and what you changed.
$open"
        fi
    fi
    if [ "$SOURCE" = compact ]; then
        # Compaction keeps the summary and drops the instructions. These are
        # the rules that were lost, in the order they are usually needed.
        ctx="${ctx:+$ctx

}"'## POST-COMPACTION — standing rules (kodflow-hooks)
1. MCP first: mcp__github__* / mcp__gitlab__* before gh or glab; mcp__context7__* for library docs.
2. rtk rewrites Bash commands for compressed output. Byte-exact reads (cat, head, tail, sed, diff, patch, checksums) are never rewritten; prefix NO_RTK= to opt out of a line.
3. Commits: conventional messages, no AI attribution, no .claude/ path in a message. Enforced by this plugin on PreToolUse and by the repo commit-msg hook.
4. Never commit on main/master — /git creates the branch and the PR. Never --no-verify. Never --force: --force-with-lease.
5. Workflow: /project → /warmup → /search → /plan → /refine → /challenge → /goal. /feature and /fix open the tracker item and the branch; /review before merge.
6. Before finishing: update the CLAUDE.md of every directory this session changed — warmup --update convention, only what changed, at most 1000 lines. The Stop hook reminds you once per directory.
7. Recover state from .claude/plans/*.md (latest = current task), .claude/goals/*.md (directives), .claude/contexts/*.md (research).
8. Never delete anything under .claude/ or .devcontainer/ without explicit approval.
Context was compacted: verify the task state before continuing.'
    else
        # TRANSFORM: speak only when something is wrong. rtk present and
        # answering is the normal case and needs no words.
        if ! command -v rtk >/dev/null 2>&1; then
            ctx="${ctx:+$ctx

}rtk is not on PATH: Bash output is not compressed this session. Install it (https://github.com/rtk-ai/rtk) or expect larger tool results."
        elif ! rtk rewrite "ls" >/dev/null 2>&1; then
            ctx="${ctx:+$ctx

}rtk $(rtk --version 2>/dev/null | head -1) does not support 'rtk rewrite' (needs >= 0.23): Bash output is not compressed this session."
        fi
    fi
    # One document per hook: every part above joins a single context.
    [ -n "$ctx" ] && _context "$ctx"
    _log ;;

SessionEnd)
    _branch
    local_log=$PROJECT_DIR/.claude/logs/$BRANCH_SAFE/session.jsonl
    total=0; [ -f "$local_log" ] && total=$(grep -c "\"session_id\":\"$SID\"" "$local_log" 2>/dev/null)
    INPUT=$(printf '%s' "$INPUT" | jq -c --argjson t "${total:-0}" '. + {total_events:$t}' 2>/dev/null)
    # Session state lives in the scratchpad when Claude Code provides one; the
    # /tmp fallback is ours to remove.
    [ -z "$SCRATCH" ] && rm -rf -- "${TMPDIR:-/tmp}/claude-hooks-$SID" 2>/dev/null
    _log; wait ;;

PreCompact)
    _log ;;

ConfigChange)
    # A settings change that enables bypassPermissions is worth a separate,
    # grep-able line. Not blocked: the user's own settings are theirs to set.
    if [ -n "$FILE" ] && [ -f "$FILE" ] && grep -q bypassPermissions "$FILE" 2>/dev/null; then
        _branch
        mkdir -p "$PROJECT_DIR/.claude/logs" 2>/dev/null && \
            jq -n -c --arg ts "$(date -u +%FT%TZ)" --arg s "$SOURCE" --arg f "$FILE" --arg sid "$SID" \
               '{timestamp:$ts,event:"PermissionEscalation",source:$s,file_path:$f,session_id:$sid}' \
               >> "$PROJECT_DIR/.claude/logs/security-events.jsonl" 2>/dev/null
    fi
    _log ;;
esac
exit 0
