#!/bin/bash
# cleanup.sh — remove a subagent's worktree and branches once its work is in.
#
#   cleanup.sh SESSION_DIR WORKTREE...
#
# Run by the mod (hooks/mod/register.ts) in the background when the main
# agent completes a task linked to a worker, or closes an epic; the mod has
# already picked the worktrees that subagent wrote into (mod/cleanup.ts).
# For each one it removes the worktree, its branch and the branch on the
# remote, the three gestures done by hand until now, and only when all hold:
#   - it is a linked worktree, never the repository's main one;
#   - its branch is not the default branch (nor main or master);
#   - `git status --porcelain` is empty;
#   - its PR is MERGED and the PR's headRefOid is the branch's local head. A
#     squash merge leaves no ancestry to test, so the heads are compared: a
#     local commit past the merged head is work nobody published.
# Otherwise nothing is touched, and one line says what is missing, once per
# worktree and motif, in SESSION_DIR/cleanup-notices; on-user.sh hands the lines to the
# model with the next prompt. A removal is said there too, so nobody goes
# looking for the directory.
#
# A path that is no longer a worktree (removed by hand) is skipped in
# silence. gh and the push reach the network: each is bounded by
# KODFLOW_CLEANUP_TIMEOUT seconds (default 15), and a call that fails or
# times out counts as "not known to be merged". KODFLOW_CLEANUP=off: nothing.
set +e

[ "${KODFLOW_CLEANUP:-}" = off ] && exit 0
DIR=${1:-}; shift
[ -n "$DIR" ] && [ "$#" -gt 0 ] || exit 0
command -v git >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0
LIB=${BASH_SOURCE[0]%/*}/lib
LIMIT=${KODFLOW_CLEANUP_TIMEOUT:-15}
case "$LIMIT" in ''|*[!0-9]*) LIMIT=15 ;; esac
mkdir -p "$DIR" 2>/dev/null || exit 0
NOTICES=$DIR/cleanup-notices
NOTIFIED=$DIR/cleanup-notified
export GH_PROMPT_DISABLED=1 GIT_TERMINAL_PROMPT=0

# bounded OUTFILE CMD... → CMD's exit code, or 124 when killed at LIMIT.
# The watcher sleeps in the background and kills CMD; it is killed in turn
# when CMD ends first, its sleep with it.
bounded() {
    local out=$1 pid w rc; shift
    "$@" > "$out" 2>"$out.err" </dev/null &
    pid=$!
    ( sleep "$LIMIT" & s=$!; trap 'kill $s 2>/dev/null; exit 0' TERM; wait $s; kill -TERM "$pid" 2>/dev/null; touch "$out.killed" ) >/dev/null 2>&1 &
    w=$!
    wait "$pid"; rc=$?
    kill -TERM "$w" 2>/dev/null; wait "$w" 2>/dev/null
    if [ -e "$out.killed" ]; then rm -f "$out.killed"; return 124; fi
    return "$rc"
}

# say PATH MOTIF TEXT → one line. The same motif for the same worktree is
# said once: a refusal repeated at every completion would be noise. Another
# motif is news (the PR got merged, the tree got dirty), and a removal is
# always said.
say() {
    if [ "$2" != removed ]; then
        grep -qxF -- "$1	$2" "$NOTIFIED" 2>/dev/null && return 0
        printf '%s\t%s\n' "$1" "$2" >> "$NOTIFIED"
    fi
    printf 'kodflow cleanup: %s\n' "$3" >> "$NOTICES"
}

one() {   # $1 = the worktree as the mod noted it
    local p=$1 wt top main br def sha tmp prs verdict num remote rb
    [ -d "$p" ] || return 0
    wt=$(cd "$p" 2>/dev/null && pwd -P) || return 0
    top=$(git -C "$wt" rev-parse --show-toplevel 2>/dev/null) || return 0
    top=$(cd "$top" && pwd -P)
    [ "$top" = "$wt" ] || return 0
    main=$(git -C "$wt" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
    [ -n "$main" ] && main=$(cd "$main" 2>/dev/null && pwd -P)
    if [ -z "$main" ] || [ "$main" = "$wt" ]; then
        say "$p" main-worktree "left $p in place: it is the repository's main worktree, never removed."
        return 0
    fi
    br=$(git -C "$wt" symbolic-ref --short -q HEAD 2>/dev/null)
    if [ -z "$br" ]; then
        say "$p" detached "left $p in place: its HEAD is detached, no branch to match to a PR."
        return 0
    fi
    remote=$(git -C "$wt" config "branch.$br.remote" 2>/dev/null); remote=${remote:-origin}
    def=$(git -C "$wt" symbolic-ref --short -q "refs/remotes/$remote/HEAD" 2>/dev/null); def=${def#"$remote"/}
    case "$br" in main|master|"$def")
        say "$p" default-branch "left $p in place: $br is the default branch."
        return 0 ;;
    esac
    if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
        say "$p" dirty "left $p in place (branch $br): it has uncommitted changes."
        return 0
    fi
    sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
    if ! command -v gh >/dev/null 2>&1; then
        say "$p" no-gh "left $p in place (branch $br): gh is not installed, the PR state is unknown."
        return 0
    fi
    tmp=$DIR/.cleanup.$$.gh
    ( cd "$wt" && bounded "$tmp" gh pr list --head "$br" --state all --json number,state,headRefOid,url --limit 20 )
    case $? in
        0) prs=$(cat "$tmp" 2>/dev/null) ;;
        124) rm -f "$tmp" "$tmp.err"
             say "$p" gh-timeout "left $p in place (branch $br): gh did not answer within ${LIMIT}s, the PR state is unknown."
             return 0 ;;
        *) rm -f "$tmp" "$tmp.err"
           say "$p" gh-failed "left $p in place (branch $br): gh pr list failed, the PR state is unknown."
           return 0 ;;
    esac
    rm -f "$tmp" "$tmp.err"
    verdict=$(printf '%s' "$prs" | jq -r --arg sha "$sha" '
        if type != "array" then "bad"
        elif any(.[]; .state == "MERGED" and .headRefOid == $sha) then
            "merged " + ([.[] | select(.state == "MERGED" and .headRefOid == $sha)][0].number | tostring)
        elif any(.[]; .state == "MERGED") then
            "differs " + ([.[] | select(.state == "MERGED")][0] | "\(.number) \(.headRefOid)")
        elif any(.[]; .state == "OPEN") then "open " + ([.[] | select(.state == "OPEN")][0].number | tostring)
        elif length > 0 then "closed " + (.[0].number | tostring)
        else "none" end' 2>/dev/null)
    case "$verdict" in
        merged\ *) num=${verdict#merged } ;;
        differs\ *)
            set -- ${verdict#differs }
            say "$p" differs "left $p in place (branch $br): its head ${sha:0:12} differs from the head ${2:0:12} merged by PR #$1, unpublished work."
            return 0 ;;
        open\ *) say "$p" open "left $p in place (branch $br): PR #${verdict#open } is not merged."; return 0 ;;
        closed\ *) say "$p" closed "left $p in place (branch $br): PR #${verdict#closed } was closed, not merged."; return 0 ;;
        none) say "$p" no-pr "left $p in place (branch $br): no pull request for this branch."; return 0 ;;
        *) say "$p" unreadable "left $p in place (branch $br): gh answered something unreadable."; return 0 ;;
    esac

    # Everything holds. Removed from the main worktree, never from inside.
    if ! git -C "$main" worktree remove "$wt" >/dev/null 2>"$DIR/.cleanup.$$.err"; then
        say "$p" remove-failed "left $p in place (branch $br, PR #$num merged): git worktree remove failed: $(head -c 200 "$DIR/.cleanup.$$.err" | tr '\n' ' ')"
        rm -f "$DIR/.cleanup.$$.err"
        return 0
    fi
    # The name on the remote, read before branch -D drops the config
    rb=$(git -C "$main" config "branch.$br.merge" 2>/dev/null); rb=${rb#refs/heads/}; rb=${rb:-$br}
    git -C "$main" branch -D "$br" >/dev/null 2>&1
    tmp=$DIR/.cleanup.$$.push
    bounded "$tmp" git -C "$main" push "$remote" --delete "$rb"
    case $? in
        0) say "$p" removed "removed $p, branch $br locally and on $remote (PR #$num merged)." ;;
        *) if grep -q "remote ref does not exist" "$tmp.err" 2>/dev/null; then
               say "$p" removed "removed $p and branch $br locally (PR #$num merged); $remote had already deleted it."
           else
               say "$p" removed "removed $p and branch $br locally (PR #$num merged); the branch on $remote was not deleted: git push $remote --delete $rb failed or timed out."
           fi ;;
    esac
    rm -f "$tmp" "$tmp.err" "$DIR/.cleanup.$$.err"
    return 0
}

# One run at a time per session: two completions in a row must not race on
# the same worktree. A run takes seconds (the network), hence the stale age.
(
    KF_LOCK_STALE=300
    . "$LIB/lock.sh" 2>/dev/null && kf_lock "$DIR/.cleanup.lock.d" 120 || exit 0
    for p in "$@"; do one "$p"; done
) </dev/null
exit 0
