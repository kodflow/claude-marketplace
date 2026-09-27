#!/usr/bin/env bash
# Locate the workspace for /project.
#
# Emits shell-sourceable KEY=VALUE lines. Two questions are answered:
#   1. Are we already inside a git work tree?  -> IN_REPO / REPO_ROOT / REPO_REMOTE
#   2. Where does this user keep their code?   -> CODE_HOME (+ ranked candidates)
#
# "Where the user keeps their code" is decided by EVIDENCE, not by convention:
# the candidate holding the most git repositories wins, counted one and two
# levels down so both <home>/<repo> and <home>/<owner>/<repo> are recognised. A
# localized Documents folder (Documents, Documentos, Dokumente, ...) is resolved
# through xdg-user-dir so this works on a non-English desktop, and the Windows
# layouts are probed too so the same skill behaves identically everywhere.
#
# On macOS, ~/Documents, ~/Desktop and ~/Downloads are never candidates: TCC
# protects them, and the kernel can deny git, the shell and claude any read
# there. They are reported as EXCLUDED_<n>, not ranked.
set -uo pipefail

emit() { printf '%s=%s\n' "$1" "$2"; }

# ---------------------------------------------------------------- current repo
if root=$(git rev-parse --show-toplevel 2>/dev/null); then
  emit IN_REPO 1
  emit REPO_ROOT "$root"
  emit REPO_CWD_IS_ROOT "$([ "$(pwd -P)" = "$(cd "$root" && pwd -P)" ] && echo 1 || echo 0)"
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

# The dedicated code root comes first so it wins every tie against Documents.
add "$HOME/Projects"

# Linux/BSD: honour the localized XDG name before guessing in English.
if command -v xdg-user-dir >/dev/null 2>&1; then
  add "$(xdg-user-dir DOCUMENTS 2>/dev/null)"
fi
[ -r "${XDG_CONFIG_HOME:-$HOME/.config}/user-dirs.dirs" ] &&
  add "$(. "${XDG_CONFIG_HOME:-$HOME/.config}/user-dirs.dirs" 2>/dev/null; eval echo "${XDG_DOCUMENTS_DIR:-}")"

# English Linux (excluded below on macOS).
add "$HOME/Documents"
# Windows (Git Bash / MSYS / WSL interop): USERPROFILE, and OneDrive redirection.
if [ -n "${USERPROFILE:-}" ]; then
  win=$(printf '%s' "$USERPROFILE" | tr '\\' '/')
  add "$win/Documents"
  add "$win/source/repos"          # Visual Studio default
fi
[ -n "${OneDrive:-}" ] && add "$(printf '%s' "$OneDrive" | tr '\\' '/')/Documents"

# Conventional developer roots, all platforms.
for d in projects Code code Developer dev src workspace repos git work; do
  add "$HOME/$d"
done

# Real path of a directory: symlinks resolved and, on a case-insensitive file
# system, the spelling stored on disk (getcwd returns it, not the one typed).
real() { (cd -- "$1" 2>/dev/null && pwd -P); }
# Device and inode, so two names for one directory collapse even where getcwd
# keeps the typed case.
ident() { stat -c '%d:%i' "$1" 2>/dev/null || stat -f '%d:%i' "$1" 2>/dev/null; }

# macOS TCC-protected folders, as real paths: a candidate that resolves to one
# of them or anywhere below it (a ~/Projects symlinked into ~/Documents) is out.
tcc=()
if [ "$(uname -s 2>/dev/null)" = Darwin ]; then
  for d in Documents Desktop Downloads; do
    t=$(real "$HOME/$d") && [ -n "$t" ] && tcc+=("$t")
  done
fi
protected() {
  local t
  for t in ${tcc[@]+"${tcc[@]}"}; do
    case "$1/" in "$t"/*) return 0 ;; esac
  done
  return 1
}

# ------------------------------------------------------------------- rank them
# Rank = git repositories one level down (<c>/*/.git) plus two levels down
# (<c>/*/*/.git). Ties break on immediate child count, then on the order above
# (earliest candidate wins). No deeper walk: this must stay instant.
best=""; best_repos=-1; best_kids=-1; rank=0; excluded=0
seen=""
override=""
[ -n "${CLAUDE_CODE_HOME:-}" ] && override=$(real "$CLAUDE_CODE_HOME")
# $HOME itself is never a code home: xdg-user-dir answers $HOME for a folder
# the user disabled, and ranking it would crown the whole home directory.
home_real=$(real "$HOME")
for c in ${candidates[@]+"${candidates[@]}"}; do
  r=$(real "$c"); [ -n "$r" ] || continue
  id=$(ident "$r"); [ -n "$id" ] || id=$r
  case ":$seen:" in *":$id:"*) continue ;; esac
  seen="$seen:$id"
  # The override is a decision: neither filter below second-guesses it.
  if [ "$r" != "$override" ]; then
    [ "$r" = "$home_real" ] && continue
    if protected "$r"; then
      excluded=$((excluded + 1))
      emit "EXCLUDED_$excluded" "$r|reason=macos-tcc"
      continue
    fi
  fi
  repos=0; kids=0
  for sub in "$r"/*/; do
    [ -d "$sub" ] || continue
    kids=$((kids + 1))
    # A repository counts once; its own subdirectories are not an owner level.
    if [ -e "$sub/.git" ]; then repos=$((repos + 1)); continue; fi
    for sub2 in "$sub"*/; do
      [ -e "$sub2/.git" ] && repos=$((repos + 1))
    done
  done
  rank=$((rank + 1))
  emit "CANDIDATE_$rank" "$r|repos=$repos|dirs=$kids"
  if [ "$repos" -gt "$best_repos" ] ||
     { [ "$repos" -eq "$best_repos" ] && [ "$kids" -gt "$best_kids" ]; }; then
    best_repos=$repos; best_kids=$kids; best="$r"
  fi
done

emit CANDIDATE_COUNT "$rank"
# An explicit CLAUDE_CODE_HOME is a decision, not a candidate: it wins even
# when another directory holds more repositories, and even on a TCC folder.
if [ -n "$override" ]; then best=$override; fi
# No candidate: propose ~/Projects, unless it resolves into a TCC folder, in
# which case nothing safe is left to propose and CODE_HOME is empty.
if [ -z "$best" ]; then
  best="$HOME/Projects"
  fb=$(real "$best")
  if [ -n "$fb" ] && protected "$fb"; then best=""; fi
fi
emit CODE_HOME "$best"
emit CODE_HOME_EXISTS "$([ -n "$best" ] && [ -d "$best" ] && echo 1 || echo 0)"

# --------------------------------------------------------------- host identity
emit PLATFORM "$(uname -s 2>/dev/null || echo unknown)"
emit GH_PRESENT "$(command -v gh >/dev/null 2>&1 && echo 1 || echo 0)"
if command -v gh >/dev/null 2>&1; then
  emit GH_USER "$(gh api user --jq .login 2>/dev/null || echo '')"
fi
emit GIT_DEFAULT_BRANCH "$(git config --get init.defaultBranch 2>/dev/null || echo '')"
