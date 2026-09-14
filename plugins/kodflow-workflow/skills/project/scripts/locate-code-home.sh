#!/usr/bin/env bash
# Locate the workspace for /project.
#
# Emits shell-sourceable KEY=VALUE lines. Two questions are answered:
#   1. Are we already inside a git work tree?  -> IN_REPO / REPO_ROOT / REPO_REMOTE
#   2. Where does this user keep their code?   -> CODE_HOME (+ ranked candidates)
#
# "Where the user keeps their code" is decided by EVIDENCE, not by convention:
# the candidate holding the most immediate git repositories wins. A localized
# Documents folder (Documents, Documentos, Dokumente, ...) is resolved through
# xdg-user-dir so this works on a non-English desktop, and the Windows/macOS
# layouts are probed too so the same skill behaves identically on all three.
set -uo pipefail

emit() { printf '%s=%s\n' "$1" "$2"; }

# ---------------------------------------------------------------- current repo
if root=$(git rev-parse --show-toplevel 2>/dev/null); then
  emit IN_REPO 1
  emit REPO_ROOT "$root"
  emit REPO_REMOTE "$(git -C "$root" remote get-url origin 2>/dev/null || echo '')"
  emit REPO_BRANCH "$(git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null || echo 'DETACHED')"
  emit REPO_DEFAULT_BRANCH "$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
  emit REPO_DIRTY "$(git -C "$root" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
else
  emit IN_REPO 0
fi

# ------------------------------------------------------------- candidate roots
candidates=()
add() { [ -n "${1:-}" ] && [ -d "$1" ] && candidates+=("$1"); }

# Explicit override always wins if it exists.
add "${CLAUDE_CODE_HOME:-}"

# Linux/BSD: honour the localized XDG name before guessing in English.
if command -v xdg-user-dir >/dev/null 2>&1; then
  add "$(xdg-user-dir DOCUMENTS 2>/dev/null)"
fi
[ -r "${XDG_CONFIG_HOME:-$HOME/.config}/user-dirs.dirs" ] &&
  add "$(. "${XDG_CONFIG_HOME:-$HOME/.config}/user-dirs.dirs" 2>/dev/null; eval echo "${XDG_DOCUMENTS_DIR:-}")"

# macOS and English Linux.
add "$HOME/Documents"
# Windows (Git Bash / MSYS / WSL interop): USERPROFILE, and OneDrive redirection.
if [ -n "${USERPROFILE:-}" ]; then
  win=$(printf '%s' "$USERPROFILE" | tr '\\' '/')
  add "$win/Documents"
  add "$win/source/repos"          # Visual Studio default
fi
[ -n "${OneDrive:-}" ] && add "$(printf '%s' "$OneDrive" | tr '\\' '/')/Documents"

# Conventional developer roots, all platforms.
for d in Projects projects Code code Developer dev src workspace repos git work; do
  add "$HOME/$d"
done

# ------------------------------------------------------------------- rank them
# Score = number of immediate children that are git repositories. Ties break on
# total child count, then on the order above (earliest candidate wins).
best=""; best_score=-1; rank=0
seen=""
for c in "${candidates[@]}"; do
  case ":$seen:" in *":$c:"*) continue ;; esac
  seen="$seen:$c"
  repos=0; kids=0
  for sub in "$c"/*/; do
    [ -d "$sub" ] || continue
    kids=$((kids + 1))
    [ -e "$sub/.git" ] && repos=$((repos + 1))
  done
  rank=$((rank + 1))
  emit "CANDIDATE_$rank" "$c|repos=$repos|dirs=$kids"
  score=$((repos * 1000 + kids))
  if [ "$score" -gt "$best_score" ]; then best_score=$score; best="$c"; fi
done

emit CANDIDATE_COUNT "$rank"
emit CODE_HOME "${best:-$HOME/Documents}"
emit CODE_HOME_EXISTS "$([ -d "${best:-}" ] && echo 1 || echo 0)"

# --------------------------------------------------------------- host identity
emit PLATFORM "$(uname -s 2>/dev/null || echo unknown)"
emit GH_PRESENT "$(command -v gh >/dev/null 2>&1 && echo 1 || echo 0)"
if command -v gh >/dev/null 2>&1; then
  emit GH_USER "$(gh api user --jq .login 2>/dev/null || echo '')"
fi
emit GIT_DEFAULT_BRANCH "$(git config --get init.defaultBranch 2>/dev/null || echo '')"
