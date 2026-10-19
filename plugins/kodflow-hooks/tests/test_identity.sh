#!/bin/bash
# test_identity.sh — the commit-identity check (hooks/scripts/lib/identity.sh,
# BLOCK 2b of on-tool.sh) against real repositories and the JSON Claude Code
# sends: each forge in agreement and in mismatch, the empty address, every
# way a command line changes the identity, and the fail-open paths. The
# rules are example values, never anyone's real address. Needs bash, jq, git.
# HOOK_SHELL=/bin/bash plays the hook under macOS's bash 3.2.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
HOOK_SHELL=${HOOK_SHELL:-bash}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
T=$(cd "$T" && pwd -P)
export HOME=$T/home CLAUDE_CONFIG_DIR=$T/home/.claude CLAUDE_PROJECT_DIR=$T/repo TMPDIR=$T/tmp
export KODFLOW_ROOT=off GIT_CONFIG_NOSYSTEM=1
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL EMAIL KODFLOW_COMMIT_IDENTITY GIT_DIR GIT_WORK_TREE
mkdir -p "$HOME" "$TMPDIR" "$CLAUDE_CONFIG_DIR/kodflow"
RULES=$CLAUDE_CONFIG_DIR/kodflow/commit-identity.conf

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

SID=sess-id
run() {   # $1 command → RC, OUT, ERR
    local json; json=$(jq -n -c --arg c "$1" --arg cwd "$T/repo" --arg sid "$SID" \
        '{session_id:$sid,hook_event_name:"PreToolUse",tool_name:"Bash",cwd:$cwd,tool_use_id:"t1",agent_id:"agt_id",tool_input:{command:$c}}')
    OUT=$(printf '%s' "$json" | "$HOOK_SHELL" "$S/on-tool.sh" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
}
pass_() { run "$2"; [ "$RC" -eq 0 ] && ok "$1" || bad "$1" "rc=$RC err=${ERR:0:300}"; }
block() {
    run "$2"
    if [ "$RC" -eq 2 ] && printf '%s' "$ERR" | grep -q '\[motif:commit-identity\]'; then ok "$1"
    else bad "$1" "rc=$RC err=${ERR:0:300}"; fi
}
# $1 dir, $2 origin url ("" none), $3 name, $4 email
repo() {
    rm -rf "$1"; git init -q -b feat/x "$1"
    [ -n "$2" ] && git -C "$1" remote add origin "$2"
    git -C "$1" config user.name "$3"; git -C "$1" config user.email "$4"
}

cat > "$RULES" <<'EOF'
# host glob                       path glob   identity
gitlab.corp.example               *           Jane Corp <jane@corp.example>
github.com                        *           jdoe <1+jdoe@users.noreply.github.com>
making.example                    *           Jane Doe <jane@making.example>
*.making.example                  *           Jane Doe <jane@making.example>
git-codecommit.*.amazonaws.com    *           jdoe <>
gitlab.com                        *           jdoe <>
codeberg.org                      *           jdoe <>
EOF
GH="jdoe" GHE="1+jdoe@users.noreply.github.com"

echo "== git takes an empty address (kodflow <>)"
repo "$T/e" "" x x
for uco in false true; do
    if git -C "$T/e" -c user.useConfigOnly=$uco -c user.name=jdoe -c user.email= commit -q --allow-empty -m e 2>/dev/null \
        && [ "$(git -C "$T/e" log -1 --format='%an <%ae>|%cn <%ce>')" = "jdoe <>|jdoe <>" ]; then
        ok "user.email= accepted, user.useConfigOnly=$uco"
    else bad "user.email= with user.useConfigOnly=$uco" "git refused an empty address"; fi
done
git -C "$T/e" config user.useConfigOnly true; git -C "$T/e" config --unset user.email
git -C "$T/e" commit -q --allow-empty -m e 2>/dev/null && bad "useConfigOnly with no address at all" "git committed" \
    || ok "useConfigOnly with no address at all: git refuses (the hook leaves it to git)"

echo "== each forge, in agreement and in mismatch"
repo "$T/repo" https://github.com/o/r.git "$GH" "$GHE"
pass_ "github https, expected identity" 'git commit -m "feat: x"'
git -C "$T/repo" config user.email someone@example.org
block "github https, another address" 'git commit -m "feat: x"'
printf '%s' "$ERR" | grep -q "git -C $T/repo config user.email \"$GHE\"" && ok "the refusal gives the command to run" || bad "refusal command" "$ERR"
git -C "$T/repo" config user.email "$GHE"; git -C "$T/repo" config user.name "Jane Doe"
block "github https, another name" 'git commit -m "feat: x"'
git -C "$T/repo" config user.name "$GH"; git -C "$T/repo" config user.email ""
block "github: an empty address is refused where one is expected" 'git commit -m "feat: x"'
repo "$T/repo" git@github.com:o/r.git "$GH" "$GHE"
pass_ "github ssh scp form, expected identity" 'git commit -m "feat: x"'
git -C "$T/repo" config user.email jane@making.example
block "github ssh scp form, the forgejo address" 'git commit -m "feat: x"'
repo "$T/repo" ssh://git@GitLab.Corp.Example:2222/g/r.git "Jane Corp" jane@corp.example
pass_ "corp gitlab ssh:// with port, host in capitals" 'git commit -m "feat: x"'
git -C "$T/repo" config user.email "$GHE"
block "corp gitlab, the github address" 'git commit -m "feat: x"'
repo "$T/repo" https://forgejo.making.example/o/r.git "Jane Doe" jane@making.example
pass_ "forgejo under *.making.example" 'git commit -m "feat: x"'
git -C "$T/repo" config user.email jane@corp.example
block "forgejo, the corp address" 'git commit -m "feat: x"'
repo "$T/repo" https://evilmaking.example/o/r.git "Jane Doe" jane@making.example
block "evilmaking.example is not *.making.example: unknown host" 'git commit -m "feat: x"'

echo "== hosts that get the pseudonym and no address"
for u in https://git-codecommit.eu-west-3.amazonaws.com/v1/repos/r \
         ssh://APKAEXAMPLE@git-codecommit.us-east-2.amazonaws.com/v1/repos/r \
         codecommit::eu-west-1://r https://gitlab.com/o/r.git git@codeberg.org:o/r.git; do
    repo "$T/repo" "$u" jdoe ""
    pass_ "empty address accepted: $u" 'git commit -m "feat: x"'
    git -C "$T/repo" config user.email "$GHE"
    block "an address refused: $u" 'git commit -m "feat: x"'
done
repo "$T/repo" https://codeberg.org/o/r.git jdoe ""
git -C "$T/repo" config user.useConfigOnly true
pass_ "empty address with user.useConfigOnly" 'git commit -m "feat: x"'

echo "== what the command line changes"
repo "$T/repo" https://github.com/o/r.git "$GH" "$GHE"
block "--author with another identity" 'git commit --author="Jane Doe <jane@making.example>" -m "feat: x"'
block "--author=… with another identity" 'git commit --author="jdoe <x@example.org>" -m "feat: x"'
pass_ "--author with the expected identity" "git commit --author=\"$GH <$GHE>\" -m \"feat: x\""
block "-c user.email=… on the line" 'git -c user.email=x@example.org commit -m "feat: x"'
block "-c user.name=… on the line" 'git -c user.name=Other commit -m "feat: x"'
block "GIT_AUTHOR_EMAIL=… prefix" 'GIT_AUTHOR_EMAIL=x@example.org git commit -m "feat: x"'
block "env GIT_COMMITTER_EMAIL=… prefix" 'env GIT_COMMITTER_EMAIL=x@example.org git commit -m "feat: x"'
block "export GIT_AUTHOR_NAME=… earlier on the line" 'export GIT_AUTHOR_NAME=Other; git commit -m "feat: x"'
block "cd && GIT_COMMITTER_NAME=… git commit" "cd $T/repo && GIT_COMMITTER_NAME=Other git commit -m \"feat: x\""
pass_ "a \$ value cannot be known: left alone" 'GIT_AUTHOR_EMAIL=$OTHER git commit -m "feat: x"'
git -C "$T/repo" config user.email x@example.org
pass_ "-c user.email=… sets the expected address over a wrong config" "git -c user.email=$GHE commit -m \"feat: x\""
pass_ "GIT_*_EMAIL prefixes set the expected address" "GIT_AUTHOR_EMAIL=$GHE GIT_COMMITTER_EMAIL=$GHE git commit -m \"feat: x\""
block "--author right, committer still wrong" "git commit --author=\"$GH <$GHE>\" -m \"feat: x\""

echo "== the repository the commit lands in"
repo "$T/repo" https://github.com/o/r.git "$GH" "$GHE"
repo "$T/other" https://gitlab.corp.example/g/r.git "Jane Corp" "$GHE"
block "git -C another repository with a wrong identity" "git -C $T/other commit -m \"feat: x\""
block "cd another repository && git commit" "cd $T/other && git commit -m \"feat: x\""
git -C "$T/other" config user.email jane@corp.example
pass_ "git -C another repository, its own identity" "git -C $T/other commit -m \"feat: x\""
repo "$T/repo" https://example.org/o/r.git "$GH" "$GHE"
block "unknown host refused" 'git commit -m "feat: x"'
printf '%s' "$ERR" | grep -q 'no identity rule' && ok "the refusal names the missing rule" || bad "unknown host wording" "$ERR"
repo "$T/repo" "$T/bare.git" "$GH" "$GHE"
block "a local path origin names no host: refused" 'git commit -m "feat: x"'
repo "$T/repo" "" "$GH" "$GHE"
block "no origin refused" 'git commit -m "feat: x"'
repo "$T/repo" "" "$GH" "$GHE"; git -C "$T/repo" remote add upstream https://github.com/o/r.git
block "only an upstream remote, no origin: refused" 'git commit -m "feat: x"'

echo "== amend keeps the old author"
repo "$T/repo" https://github.com/o/r.git "Old Name" old@example.org
git -C "$T/repo" commit -q --allow-empty -m "chore: seed"
git -C "$T/repo" config user.name "$GH"; git -C "$T/repo" config user.email "$GHE"
block "--amend of a commit by another author" 'git commit --amend -m "feat: x"'
pass_ "--amend --reset-author" 'git commit --amend --reset-author -m "feat: x"'
block "-C HEAD reuses the old author" 'git commit -C HEAD'

echo "== identity from the global configuration and includeIf"
repo "$T/repo" https://github.com/o/r.git x x
git -C "$T/repo" config --unset user.name; git -C "$T/repo" config --unset user.email
printf '[user]\n\tname = Wrong\n\temail = wrong@example.org\n[includeIf "gitdir:%s/"]\n\tpath = %s/inc\n' "$T/repo" "$T" > "$HOME/.gitconfig"
printf '[user]\n\tname = %s\n\temail = %s\n' "$GH" "$GHE" > "$T/inc"
pass_ "includeIf gives the expected identity" 'git commit -m "feat: x"'
git -C "$T/other" config --unset user.name; git -C "$T/other" config --unset user.email
block "outside the includeIf, the global identity is refused" "git -C $T/other commit -m \"feat: x\""
rm -f "$HOME/.gitconfig"

echo "== the check never stops a call it cannot judge"
repo "$T/repo" https://example.org/o/r.git x x@example.org
mv "$RULES" "$RULES.off"
SID=s-absent; run 'git commit -m "feat: x"'
[ "$RC" -eq 0 ] && printf '%s' "$OUT" | jq -e '.systemMessage | test("not checked, rules file absent")' >/dev/null \
    && ok "no rules file: inactive, said once" || bad "no rules file" "rc=$RC out=$OUT"
run 'git commit -m "feat: x"'
[ "$RC" -eq 0 ] && [ -z "$OUT" ] && ok "no rules file: not said twice" || bad "no rules file, second call" "rc=$RC out=$OUT"
printf 'github.com jdoe <x@example.org>\n' > "$RULES"
SID=s-bad; run 'git commit -m "feat: x"'
[ "$RC" -eq 0 ] && printf '%s' "$OUT" | jq -e '.systemMessage | test("malformed \\(line 1\\)")' >/dev/null \
    && ok "malformed rules file: open, said" || bad "malformed rules file" "rc=$RC out=$OUT"
mkdir -p "$T/dir-rules"; KODFLOW_COMMIT_IDENTITY=$T/dir-rules run 'git commit -m "feat: x"'
[ "$RC" -eq 0 ] && ok "unreadable rules file (a directory): open" || bad "unreadable rules file" "rc=$RC"
mv "$RULES.off" "$RULES"
KODFLOW_COMMIT_IDENTITY=off run 'git commit -m "feat: x"'
[ "$RC" -eq 0 ] && ok "KODFLOW_COMMIT_IDENTITY=off" || bad "off switch" "rc=$RC"
mkdir -p "$T/nogit"; ln -s "$(command -v tr)" "$T/nogit/tr"
( . "$S/lib/identity.sh"; PATH=$T/nogit; kf_ident_check "$T/repo" ); r=$?
[ "$r" -eq 0 ] && ok "git not found: open" || bad "git not found" "rc=$r"
pass_ "not a repository: left to git" "git -C $T/nowhere commit -m \"feat: x\""
pass_ "git status is not a commit" 'git status'

echo
echo "identity: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
