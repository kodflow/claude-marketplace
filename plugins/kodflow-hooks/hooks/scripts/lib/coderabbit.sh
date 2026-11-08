#!/bin/bash
# coderabbit.sh — the CodeRabbit capacity hint of on-tool.sh (PreToolUse/Bash).
#
# Before `gh pr merge`, one context line: the head, covered, eligible (probe.py
# `covered`), so the merge is not mistaken for a reviewed one.
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

# kf_coderabbit_policy_dir → the policy directory (settings.yaml,
# override-<owner>.yaml) on stdout, or nothing: KODFLOW_CODERABBIT_POLICY_DIR,
# else ~/Projects/kodflow/making.codes/coderabbit when it exists. Without one,
# `covered` answers eligible=unknown.
kf_coderabbit_policy_dir() {
    local d=${KODFLOW_CODERABBIT_POLICY_DIR:-$HOME/Projects/kodflow/making.codes/coderabbit}
    [ -d "$d" ] && printf '%s' "$d"
    return 0
}

# kf_coderabbit_hint <pr_create|push|merge> <cwd> [owner/name] [pr-or-branch]
# → prints the context text on stdout, or nothing; always returns 0.
# merge: one line "CodeRabbit on PR #N: head <sha> covered=<x> eligible=<y>",
# from probe.py's `covered`. Information only: no command is ever posted here.
kf_coderabbit_hint() {
    local action=$1 cwd=$2 repo=${3:-} target=${4:-} probe out policy
    [ "${KODFLOW_CODERABBIT:-}" = off ] && return 0
    probe=${KODFLOW_CODERABBIT_PROBE:-${BASH_SOURCE[0]%/*}/../../coderabbit/probe.py}
    [ -f "$probe" ] || return 0
    command -v python3 >/dev/null 2>&1 || return 0
    command -v jq >/dev/null 2>&1 || return 0
    local -a args
    if [ "$action" = merge ]; then
        args=(covered --cwd "$cwd" --deadline 4 --cache-dir "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/coderabbit")
        if [[ $target =~ ^https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([0-9]+) ]]; then
            repo=${BASH_REMATCH[1]}; target=${BASH_REMATCH[2]}
        fi
        if [[ $target =~ ^[0-9]+$ ]]; then args+=(--pr "$target")
        elif [[ $target =~ ^[A-Za-z0-9._/-]+$ ]]; then args+=(--branch "$target"); fi
        policy=$(kf_coderabbit_policy_dir)
        [ -n "$policy" ] && args+=(--policy-dir "$policy")
    else
        args=(capacity --action "$action" --cwd "$cwd" --cache-dir "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/coderabbit")
    fi
    [[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] && args+=(--repo "$repo")
    out=$(python3 -I "$probe" "${args[@]}" 2>/dev/null </dev/null) || return 0
    if [ "$action" = merge ]; then
        printf '%s' "$out" | jq -r 'select((.head // "") != "") | "CodeRabbit on PR #\(.pr): head \(.head) covered=\(.covered) eligible=\(.eligible)" + (if .eligible == false then " (\(.reason))" else "" end)' 2>/dev/null
    else
        printf '%s' "$out" | jq -r '.context // empty' 2>/dev/null
    fi
    return 0
}
