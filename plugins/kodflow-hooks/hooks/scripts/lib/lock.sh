# lock.sh — a lock for hook scripts that works where flock(1) does not.
# shellcheck shell=bash
#
# macOS ships no flock(1), so `exec 9>>.lock; flock -w 2 9` fails in silence
# there and serialises nothing. A lock directory stands in for it, but mkdir
# alone does not hold it: uutils' mkdir (Ubuntu 26.04's) checks the path is
# free, then creates it, and exits 0 when the creation fails on a directory
# that now exists, so two racing callers both succeed. The process that then
# creates the `owner` symlink inside holds the lock: symlink(2) fails on an
# existing path in every ln, uutils' included. mod/store.ts takes the same
# directories the same way.
#
#   . "$LIB/lock.sh"
#   ( kf_lock "$dir/.agents.lock.d" 2; ...critical section... )
#
# Call it inside a subshell: the EXIT trap it sets releases the lock when the
# subshell ends, whatever path it takes. Hooks fail open: a caller that cannot
# get the lock in time never blocks the session, it decides whether to skip
# its write or make it unlocked.
#
# A lock older than KF_LOCK_STALE seconds (default 10; a critical section
# here takes milliseconds) was left by a killed process. It is broken by an
# atomic rename to a unique name, so of two waiters that both see it stale,
# one rename succeeds and the other finds nothing to move. The residual race
# (a waiter renaming a lock another waiter took after breaking the stale
# one) needs both to read the old mtime within the same instant; it is
# accepted.

_kf_mtime() {   # GNU stat first: BSD stat rejects -c without printing a value
    local m
    m=$(stat -c %Y "$1" 2>/dev/null) || m=$(stat -f %m "$1" 2>/dev/null)
    case "$m" in ''|*[!0-9]*) return 1 ;; esac
    printf '%s' "$m"
}

kf_unlock() {
    [ -n "${KF_LOCK_DIR:-}" ] && { rm -f "$KF_LOCK_DIR/owner"; rmdir "$KF_LOCK_DIR"; } 2>/dev/null
    KF_LOCK_DIR=
}

# kf_lock DIR [WAIT_SECONDS] → 0 holding the lock, 1 gave up
kf_lock() {
    local d=$1 tries=$(( ${2:-2} * 10 )) stale=${KF_LOCK_STALE:-10} m grave
    while ! { mkdir "$d" && ln -s "$$.$RANDOM" "$d/owner"; } 2>/dev/null; do
        [ -d "${d%/*}" ] || return 1
        if m=$(_kf_mtime "$d") && [ $(( $(date +%s) - m )) -ge "$stale" ]; then
            grave=$d.stale.$$.$RANDOM
            mv "$d" "$grave" 2>/dev/null && { rm -f "$grave/owner"; rmdir "$grave" 2>/dev/null; continue; }
        fi
        # Counted on every pass, so a lock that can be neither taken nor
        # broken still ends the wait
        tries=$((tries - 1)); [ "$tries" -le 0 ] && return 1
        sleep 0.1
    done
    KF_LOCK_DIR=$d
    trap kf_unlock EXIT
    return 0
}
