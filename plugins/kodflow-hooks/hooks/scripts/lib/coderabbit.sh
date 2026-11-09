#!/bin/bash
# coderabbit.sh — the CodeRabbit capacity hint of on-tool.sh (PreToolUse/Bash).
#
# Before a merge (`gh pr merge`, mcp__github__merge_pull_request): probe.py
# `merge-gate` holds it while CodeRabbit reviews an uncovered head, else one
# context line (head, covered, eligible). Fail open: no answer is an allow.
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

# kf_coderabbit_merge_gate <cwd> [owner/name] [pr-number|url|branch] [match-sha]
# → probe.py `merge-gate`'s JSON on stdout ({decision, message, context, ...}),
# or nothing on any failure (the caller then allows: fail open). The probe
# posts the marked review request or the audit comment itself; this only runs
# it. KODFLOW_CR_MERGE_WAIT_MINUTES sets the hold (default 30).
kf_coderabbit_merge_gate() {
    local cwd=$1 repo=${2:-} target=${3:-} match=${4:-} probe policy wait=${KODFLOW_CR_MERGE_WAIT_MINUTES:-30}
    [ "${KODFLOW_CODERABBIT:-}" = off ] && return 0
    probe=${KODFLOW_CODERABBIT_PROBE:-${BASH_SOURCE[0]%/*}/../../coderabbit/probe.py}
    [ -f "$probe" ] || return 0
    command -v python3 >/dev/null 2>&1 || return 0
    [[ $wait =~ ^[0-9]+$ ]] || wait=30
    local -a args=(merge-gate --cwd "$cwd" --deadline 4 --wait-minutes "$wait" --cache-dir "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/coderabbit")
    if [[ $target =~ ^https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([0-9]+) ]]; then
        repo=${BASH_REMATCH[1]}; target=${BASH_REMATCH[2]}
    fi
    # A target or a repository this cannot read would make the probe judge
    # another PR (the checked-out branch, the origin remote): fail open instead.
    if [[ $target =~ ^[0-9]+$ ]]; then args+=(--pr "$target")
    elif [[ $target =~ ^[A-Za-z0-9._/-]+$ ]]; then args+=(--branch "$target")
    elif [ -n "$target" ]; then return 0; fi
    if [[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then args+=(--repo "$repo")
    elif [ -n "$repo" ]; then return 0; fi
    [[ $match =~ ^[0-9a-fA-F]{7,40}$ ]] && args+=(--match-head "$match")
    policy=$(kf_coderabbit_policy_dir)
    [ -n "$policy" ] && args+=(--policy-dir "$policy")
    python3 -I "$probe" "${args[@]}" 2>/dev/null </dev/null || true
    return 0
}

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
