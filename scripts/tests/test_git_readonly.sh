#!/bin/bash
# test_git_readonly.sh — the git commands Plan review mode prescribes never
# make git run a program of the repository's choosing.
#
# A reviewed repository can configure an external diff (diff.external), a
# textconv driver, a pager (core.pager) and filter drivers (smudge, process).
# Each points here at a witness script that records being called. Every
# prescribed form (_shared/specialists.md, "Holds in every mode" and the tree
# archive) must leave the witness silent; the same commands without the
# prescribed options must call it, or the fixture proves nothing. bash
# 3.2-safe: macOS CI runs it with /bin/bash.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SPEC=$ROOT/plugins/kodflow-workflow/skills/_shared/specialists.md
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME=$T/home GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=$T/home/.gitconfig
mkdir -p "$HOME"; : > "$GIT_CONFIG_GLOBAL"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

W=$T/witness HITS=$T/hits
# It never reads its standard input (a pager or a filter would wait on the
# terminal): it records the call, prints a textconv's file, and exits.
printf '#!/bin/sh\necho "$0 $*" >> "%s"\n[ $# -eq 1 ] && [ -f "$1" ] && cat "$1"\nexit 0\n' "$HITS" > "$W"; chmod +x "$W"
R=$T/repo
git init -q "$R"; cd "$R" || exit 1
git config user.email t@example.invalid; git config user.name t
printf '*.txt diff=wit filter=wit\n' > .gitattributes
printf 'a\n' > f.txt; git add . ; git commit -qm one
printf 'b\n' >> f.txt; git commit -qam two
git config diff.external "$W"
git config diff.wit.textconv "$W"
git config core.pager "$W"
git config filter.wit.smudge "$W"
git config filter.wit.clean "$W"
git config filter.wit.process "$W"

# Through a pseudo-terminal, so a configured pager would run: util-linux and
# BSD script(1) differ in their arguments.
tty_run() {
    if script --version 2>/dev/null | grep -q util-linux; then
        script -qec "$1" /dev/null >/dev/null 2>&1 </dev/null
    else
        script -q /dev/null sh -c "$1" >/dev/null 2>&1 </dev/null
    fi
}
silent() {   # NAME COMMAND → the witness is never called
    rm -f "$HITS"; tty_run "$2"
    [ ! -s "$HITS" ] && ok "$1" || bad "$1" "$(head -3 "$HITS")"
}
calls() {    # NAME COMMAND → the witness is called (the fixture bites)
    rm -f "$HITS"; tty_run "$2"
    [ -s "$HITS" ] && ok "$1" || bad "$1" "witness not called"
}

echo "== the fixture bites without the prescribed options"
calls "git diff runs the external diff or the pager" "git diff HEAD~1 HEAD"
calls "git log -p runs them too" "git log -p -1"
calls "git -c diff.external= diff still runs the textconv driver" "git --no-pager -c diff.external= diff HEAD~1 HEAD"
calls "on a terminal, git log without --no-pager runs the pager" "git log --no-ext-diff --no-textconv -1"
calls "git archive runs the smudge filter" "git archive --format=tar -o $T/raw.tar HEAD"

echo "== the prescribed forms never call it"
silent "git --no-pager diff --no-ext-diff --no-textconv" "git --no-pager diff --no-ext-diff --no-textconv HEAD~1 HEAD"
silent "git --no-pager log -p --no-ext-diff --no-textconv" "git --no-pager log -p --no-ext-diff --no-textconv -1"
silent "git --no-pager show --no-ext-diff --no-textconv <commit>" "git --no-pager show --no-ext-diff --no-textconv HEAD"
silent "git --no-pager show <rev>:<path>" "git --no-pager show HEAD:f.txt"
silent "git --no-pager grep at a revision" "git --no-pager grep -n a HEAD"
silent "git ls-tree" "git --no-pager ls-tree -r HEAD"
silent "git cat-file -p" "git --no-pager cat-file -p HEAD:f.txt"
NEUTRAL=$(git config --name-only --get-regexp '^filter\.' | sed -n 's/^filter\.\(.*\)\.[^.]*$/\1/p' | sort -u \
    | while IFS= read -r n; do printf ' -c filter.%s.smudge= -c filter.%s.process= -c filter.%s.required=false' "$n" "$n" "$n"; done)
silent "git archive with every filter driver neutralised" "git$NEUTRAL archive --format=tar -o $T/tree.tar HEAD"
mkdir -p "$T/tree"
if python3 -m tarfile --filter data -e "$T/tree.tar" "$T/tree" 2>/dev/null; then
    [ "$(cat "$T/tree/f.txt")" = "$(printf 'a\nb')" ] && ok "the archived tree extracts with --filter data" || bad "tree content" "$(cat "$T/tree/f.txt")"
else
    bad "python3 -m tarfile --filter data" "needs Python 3.12 or later: $(python3 --version 2>&1)"
fi

echo "== the canonical text prescribes exactly these forms"
grep -qF '`git --no-pager <command> --no-ext-diff --no-textconv`' "$SPEC" && ok "diff commands: --no-pager, --no-ext-diff, --no-textconv" || bad "prescribed diff form" "$SPEC"
grep -qF '`-c filter.N.smudge= -c filter.N.process= -c filter.N.required=false`' "$SPEC" && ok "archive: filter drivers neutralised" || bad "archive neutralisation" "$SPEC"
grep -qF "\`git config --name-only --get-regexp '^filter\\.'\`" "$SPEC" && ok "archive: drivers listed by git config" || bad "driver listing" "$SPEC"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
