#!/bin/bash
# ============================================================================
# test_locate_code_home.sh - where /project decides the user keeps their code
# ============================================================================
# The locator ranks candidate directories by the repositories they hold. Each
# case builds a throwaway $HOME with a known layout and asserts the CODE_HOME
# the script prints. The platform is faked through a stub `uname` on PATH, so
# the macOS rules are exercised on a Linux runner too; `gh` is stubbed so no
# case touches the network.
# ============================================================================

set -u

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/plugins/kodflow-workflow/skills/project/scripts/locate-code-home.sh"
pass=0; fail=0

check() { # name expected actual
    if [ "$2" = "$3" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3"
    fi
}

homes="$(mktemp -d)"
trap 'rm -rf "$homes"' EXIT

# A fresh $HOME, resolved so assertions compare against what `pwd -P` prints.
newhome() { local d; d="$(mktemp -d "$homes/home.XXXXXX")"; (cd "$d" && pwd -P); }

# repo DIR - make DIR look like a git work tree without running git.
repo() { mkdir -p "$1/.git"; }

# locate HOME PLATFORM [VAR=VALUE ...] - run the locator, print its output.
locate() {
    local home="$1" platform="$2"; shift 2
    local bin="$home/.stub-bin"
    mkdir -p "$bin"
    printf '#!/bin/sh\necho %s\n' "$platform" > "$bin/uname"
    printf '#!/bin/sh\nexit 1\n' > "$bin/gh"
    # What xdg-user-dir prints when no Documents folder is configured: $HOME.
    printf '#!/bin/sh\necho "$HOME"\n' > "$bin/xdg-user-dir"
    chmod +x "$bin/uname" "$bin/gh" "$bin/xdg-user-dir"
    (cd "$home/.stub-bin" && env -u CLAUDE_CODE_HOME -u USERPROFILE -u OneDrive \
        HOME="$home" XDG_CONFIG_HOME="$home/.config" PATH="$bin:$PATH" "$@" "${TEST_BASH:-bash}" "$SRC")
}

key() { printf '%s\n' "$2" | sed -n "s/^$1=//p"; }

# --- (a) <owner>/<repo> under ~/Projects beats a busier ~/Documents ----------
for platform in Linux Darwin; do
    h="$(newhome)"
    repo "$h/Projects/kodflow/ktn-linter"; repo "$h/Projects/kodflow/claude-marketplace"
    for i in 1 2 3 4 5 6 7 8; do mkdir -p "$h/Documents/folder$i"; done
    out="$(locate "$h" "$platform")"
    check "(a/$platform) owner/repo layout wins over a busier Documents" "$h/Projects" "$(key CODE_HOME "$out")"
    check "(a/$platform) repositories two levels down are counted" "$h/Projects|repos=2|dirs=1" "$(key CANDIDATE_1 "$out")"
done

# --- (b) one directory under two names is one candidate ---------------------
h="$(newhome)"
repo "$h/Projects/acme/app"
ln -s "$h/Projects" "$h/code"
out="$(locate "$h" Linux)"
check "(b) a symlinked alias collapses onto the real directory" "1" "$(key CANDIDATE_COUNT "$out")"
check "(b) the real path is printed, not the alias" "$h/Projects" "$(key CANDIDATE_1 "$out" | cut -d'|' -f1)"

h="$(newhome)"
mkdir -p "$h/Projects"
if [ -d "$h/projects" ]; then
    repo "$h/Projects/acme/app"
    out="$(locate "$h" Darwin)"
    check "(b) a case variant on a case-insensitive FS is one candidate" "1" "$(key CANDIDATE_COUNT "$out")"
    check "(b) the on-disk spelling is kept" "$h/Projects" "$(key CODE_HOME "$out")"
    if printf '%s\n' "$out" | grep -q "^CANDIDATE_[0-9]*=$h/projects|"; then
        check "(b) no lowercase variant is invented" "absent" "present"
    fi
else
    echo "skip (b) case variant: $h is on a case-sensitive file system"
fi

# --- (c) no candidate at all ($HOME, which xdg-user-dir may print, is none): fall back to ~/Projects -----------------------
for platform in Linux Darwin; do
    h="$(newhome)"
    out="$(locate "$h" "$platform")"
    check "(c/$platform) no candidate reports zero" "0" "$(key CANDIDATE_COUNT "$out")"
    check "(c/$platform) the fallback is ~/Projects" "$h/Projects" "$(key CODE_HOME "$out")"
    check "(c/$platform) the fallback is flagged as missing" "0" "$(key CODE_HOME_EXISTS "$out")"
done

# --- (d) CLAUDE_CODE_HOME wins over every scored candidate ------------------
for platform in Linux Darwin; do
    h="$(newhome)"
    repo "$h/Projects/a/one"; repo "$h/Projects/a/two"
    mkdir -p "$h/elsewhere"
    out="$(locate "$h" "$platform" CLAUDE_CODE_HOME="$h/elsewhere")"
    check "(d/$platform) CLAUDE_CODE_HOME wins" "$h/elsewhere" "$(key CODE_HOME "$out")"
done
# Even on a TCC folder: an explicit decision is not second-guessed.
h="$(newhome)"
repo "$h/Projects/a/one"; mkdir -p "$h/Documents"
out="$(locate "$h" Darwin CLAUDE_CODE_HOME="$h/Documents")"
check "(d) CLAUDE_CODE_HOME on ~/Documents is honoured on Darwin" "$h/Documents" "$(key CODE_HOME "$out")"

# --- (e) macOS never picks a TCC-protected folder ---------------------------
h="$(newhome)"
repo "$h/Projects/a/one"
for i in 1 2 3 4 5; do repo "$h/Documents/r$i"; done
repo "$h/Desktop/r"; repo "$h/Downloads/r"
out="$(locate "$h" Darwin)"
check "(e) Darwin: Projects wins although Documents holds more repos" "$h/Projects" "$(key CODE_HOME "$out")"
check "(e) Darwin: Documents is reported as excluded" "$h/Documents|reason=macos-tcc" "$(key EXCLUDED_1 "$out")"
check "(e) Darwin: Documents is never ranked" "" "$(printf '%s\n' "$out" | grep "^CANDIDATE_[0-9]*=$h/Documents|")"

h="$(newhome)"
for i in 1 2 3; do repo "$h/Documents/r$i"; done
out="$(locate "$h" Darwin)"
check "(e) Darwin: Documents alone still yields no candidate" "0" "$(key CANDIDATE_COUNT "$out")"
check "(e) Darwin: and the fallback is ~/Projects" "$h/Projects" "$(key CODE_HOME "$out")"

# Linux keeps ~/Documents: no TCC there, evidence decides, Projects wins ties.
h="$(newhome)"
repo "$h/Projects/a/one"
for i in 1 2 3; do repo "$h/Documents/r$i"; done
out="$(locate "$h" Linux)"
check "(e) Linux: a busier Documents still wins on evidence" "$h/Documents" "$(key CODE_HOME "$out")"
h="$(newhome)"
repo "$h/Projects/one"; repo "$h/Documents/one"
out="$(locate "$h" Linux)"
check "(e) Linux: Projects wins a tie against Documents" "$h/Projects" "$(key CODE_HOME "$out")"

# --- review cases ----------------------------------------------------------
# A code root symlinked INTO a TCC folder is as locked as the folder itself.
h="$(newhome)"
repo "$h/Documents/Code/a/one"; ln -s "$h/Documents/Code" "$h/Projects"
repo "$h/src/b/two"
out="$(locate "$h" Darwin)"
check "(e) Darwin: ~/Projects -> ~/Documents/Code is excluded" "$h/Documents/Code|reason=macos-tcc" "$(key EXCLUDED_1 "$out")"
check "(e) Darwin: the next safe candidate wins instead" "$h/src" "$(key CODE_HOME "$out")"

# With nothing safe left, the fallback must not hand back that same alias.
h="$(newhome)"
mkdir -p "$h/Documents"; ln -s "$h/Documents" "$h/Projects"
out="$(locate "$h" Darwin)"
check "(c) Darwin: a fallback resolving into TCC is withheld" "" "$(key CODE_HOME "$out")"
check "(c) Darwin: and flagged as missing" "0" "$(key CODE_HOME_EXISTS "$out")"

# Repositories rank first: a thousand plain folders never outweigh one repo.
h="$(newhome)"
repo "$h/Projects/a/one"
mkdir -p "$h/src"; (cd "$h/src" && mkdir $(seq 1 1100))
out="$(locate "$h" Linux)"
check "ranking: one repository beats 1100 empty folders" "$h/Projects" "$(key CODE_HOME "$out")"

# A relative override that looks like a cd option is still a path.
h="$(newhome)"
mkdir -p "$h/.stub-bin/-P"; repo "$h/Projects/a/one"
out="$(locate "$h" Linux CLAUDE_CODE_HOME=-P)"
check "(d) CLAUDE_CODE_HOME=-P is a directory, not an option" "$h/.stub-bin/-P" "$(key CODE_HOME "$out")"

# CLAUDE_CODE_HOME=$HOME is honoured although $HOME is never guessed.
h="$(newhome)"
out="$(locate "$h" Linux CLAUDE_CODE_HOME="$h")"
check "(d) CLAUDE_CODE_HOME=\$HOME is honoured" "$h" "$(key CODE_HOME "$out")"

printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
