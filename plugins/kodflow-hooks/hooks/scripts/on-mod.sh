#!/bin/bash
# on-mod.sh — the log line of a call the mod answered itself (the task tools).
#
# A tool a function hook answers never reaches PreToolUse or PostToolUse, so
# the shell would not see it. mod/register.ts hands each such call here, shaped
# like a PostToolUse (or PostToolUseFailure for a refusal), and it is written
# through lib/event.jq like every other line of .claude/logs/<branch>/.
set +e

INPUT=$(cat 2>/dev/null); [ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
eval "$(printf '%s' "$INPUT" | jq -r '@sh "CWD=\(.cwd // "")"' 2>/dev/null)" || exit 0

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

_branch
dir=$PROJECT_DIR/.claude/logs/$BRANCH_SAFE
mkdir -p "$dir" 2>/dev/null || exit 0
printf '%s' "$INPUT" | jq -c --arg b "$BRANCH" -f "$LIB/event.jq" >> "$dir/session.jsonl" 2>/dev/null
exit 0
