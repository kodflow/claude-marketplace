#!/bin/bash
# test_zsh_safe.sh — hooks/zsh/.zshenv as zsh reads it: the user's .zshenv
# first (ZDOTDIR's, else HOME's), ZDOTDIR given back, then an unmatched glob
# stays literal and `=word` is a word.
set -u
cd "$(dirname "$0")/.."
if ! command -v zsh >/dev/null 2>&1; then
    echo "zsh-safe: zsh not found, skipped"
    exit 0
fi
OURS=$PWD/hooks/zsh
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/zdot"
echo 'export FROM=home' > "$T/home/.zshenv"
echo 'export FROM=zdotdir' > "$T/zdot/.zshenv"
fail=0
check() { # name, want, got
    if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: want [$2] got [$3]"; fail=1; fi
}
run() { # KODFLOW_USER_ZDOTDIR value, command
    env -i HOME="$T/home" PATH="$PATH" ZDOTDIR="$OURS" KODFLOW_USER_ZDOTDIR="$1" zsh -c "$2" 2>&1
}

check "unmatched glob is literal" '*.inexistant' "$(cd "$T" && run "" 'echo *.inexistant')"
check "a leading = is a word" '=nope' "$(run "" 'echo =nope')"
check "HOME's .zshenv when ZDOTDIR was unset" 'home' "$(run "" 'echo $FROM')"
check "ZDOTDIR unset again" 'unset' "$(run "" 'echo ${ZDOTDIR-unset}')"
check "the user's ZDOTDIR .zshenv" 'zdotdir' "$(run "$T/zdot" 'echo $FROM')"
check "the user's ZDOTDIR given back" "$T/zdot" "$(run "$T/zdot" 'echo $ZDOTDIR')"
check "a glob that matches still expands" 'a.txt' "$(touch "$T/a.txt"; cd "$T" && run "" 'echo *.txt')"
exit $fail
