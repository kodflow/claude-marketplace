#!/usr/bin/env bash
# Where does work get recorded for the repository we are standing in?
#
# Emits shell-sourceable KEY=VALUE lines. Callers (/feature, /fix, /search) use
# this instead of each guessing at a forge, so the same repository always lands
# in the same tracker.
#
# Order is deliberate: a note store first when one is grafted onto the session,
# then the repository's own forge, then a local draft file. The note store wins
# because it is the only destination that survives a repository being moved,
# renamed, or mirrored.
#
# This script CANNOT see MCP servers — they live in the agent's tool list, not
# the shell. It reports what it can prove from disk and the network, and marks
# the note store UNKNOWN for the agent to resolve against its own tool list.
set -uo pipefail

emit() { printf '%s=%s\n' "$1" "$2"; }

root=$(git rev-parse --show-toplevel 2>/dev/null) || root=""
emit REPO_ROOT "$root"
[ -z "$root" ] && { emit FORGE none; emit REASON "not in a git work tree"; exit 0; }

remote=$(git -C "$root" remote get-url origin 2>/dev/null || echo "")
# Never echo the remote itself: a token embedded in the URL would land in the
# transcript. Strip any user:password@ before anything is emitted.
safe_remote=$(printf '%s' "$remote" | sed -E 's#://[^/@]+@#://#')
emit REMOTE "$safe_remote"
emit REMOTE_HAS_CREDENTIAL "$(printf '%s' "$remote" | grep -qE '://[^/@]+:[^/@]+@' && echo 1 || echo 0)"

host=$(printf '%s' "$remote" | sed -E 's#^[a-z+]+://##; s#^[^@]+@##; s#[/:].*$##')
# Project path with every subgroup kept. A greedy .*[:/] would eat all but the
# last two segments and turn acme/products/messaging/service into messaging/service,
# which 404s on every acme project — they are all in subgroups.
path=$(printf '%s' "$remote" | sed -E 's#^[a-z+]+://##; s#^[^@]+@##; s#^[^/:]+(:[0-9]+)?[/:]##; s#\.git$##')
emit HOST "$host"
emit PROJECT_PATH "$path"
emit PROJECT_ENC "$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1], safe=""))' "$path" 2>/dev/null || printf '%s' "$path")"

case "$host" in
  github.com)      emit FORGE github ;;
  gitlab.*|*gitlab*) emit FORGE gitlab ;;
  "")              emit FORGE none ;;
  *)               emit FORGE unknown ;;
esac

emit GH_CLI "$(command -v gh >/dev/null 2>&1 && echo 1 || echo 0)"
emit GLAB_CLI "$(command -v glab >/dev/null 2>&1 && echo 1 || echo 0)"
emit GITLAB_API_URL "${GITLAB_API_URL:-}"
emit GITLAB_TOKEN_IN_ENV "$([ -n "${GITLAB_PERSONAL_ACCESS_TOKEN:-}" ] && echo 1 || echo 0)"
emit NODE_EXTRA_CA_CERTS "${NODE_EXTRA_CA_CERTS:-}"

emit DEFAULT_BRANCH "$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
emit CURRENT_BRANCH "$(git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null || echo DETACHED)"
emit DIRTY "$(git -C "$root" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

# A branch already named for an issue means this is a RE-RUN on that subject.
emit BRANCH_ISSUE "$(git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null | sed -nE 's#^(feature|fix|feat|bugfix)/([0-9]+)-.*#\2#p')"

emit LOCAL_DRAFTS "$([ -d "$root/.drafts" ] && echo 1 || echo 0)"
emit LEDGER_DIR "$root/.claude/issues"
emit LEDGER_COUNT "$(ls "$root/.claude/issues" 2>/dev/null | wc -l | tr -d ' ')"

# Resolved by the agent against its own tool list, not from the shell.
emit NOTE_STORE UNKNOWN
