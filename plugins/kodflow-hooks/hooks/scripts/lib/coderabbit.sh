#!/bin/bash
# coderabbit.sh — the CodeRabbit capacity hint of on-tool.sh (PreToolUse/Bash).
#
# Before `gh pr create`, and before a `git push` of a branch that has a PR, tell
# Claude whether CodeRabbit is rate limited on the repository, in how many
# minutes a review frees up, and what to do (group the commits into an open PR,
# open a draft, or wait). Information only: the call is never held, refused or
# rewritten, and every failure is silence.
#
# The reading of CodeRabbit's messages, the cache and the strategy text are
# hooks/coderabbit/probe.py's `capacity` subcommand — the same file kodflow/labs'
# relaunch workflow runs, so there is one reader of those messages. This file
# only calls it: python3 -I, a 4 s deadline inside it, its answer cached 5 min
# per repository, so a call costs no API request most of the time.
#
# KODFLOW_CODERABBIT=off turns it off. KODFLOW_CODERABBIT_PROBE names another
# probe.py (the tests' stub); it is read from the hook's own environment, which
# only the user sets.

# kf_coderabbit_hint <pr_create|push> <cwd> [owner/name]
# → prints the context text on stdout, or nothing; always returns 0.
kf_coderabbit_hint() {
    local action=$1 cwd=$2 repo=${3:-} probe out
    [ "${KODFLOW_CODERABBIT:-}" = off ] && return 0
    probe=${KODFLOW_CODERABBIT_PROBE:-${BASH_SOURCE[0]%/*}/../../coderabbit/probe.py}
    [ -f "$probe" ] || return 0
    command -v python3 >/dev/null 2>&1 || return 0
    command -v jq >/dev/null 2>&1 || return 0
    local -a args=(capacity --action "$action" --cwd "$cwd" --cache-dir "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/coderabbit")
    [[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] && args+=(--repo "$repo")
    out=$(python3 -I "$probe" "${args[@]}" 2>/dev/null </dev/null) || return 0
    printf '%s' "$out" | jq -r '.context // empty' 2>/dev/null
    return 0
}
