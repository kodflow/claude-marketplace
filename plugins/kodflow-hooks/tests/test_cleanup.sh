#!/bin/bash
# test_cleanup.sh — hooks/scripts/cleanup.sh, the removal of a subagent's
# worktree and branches once its task or epic is completed. Real git
# repositories (a bare remote, a clone, linked worktrees beside it) and a `gh`
# double on PATH that answers what each case needs: merged, open, absent, a
# failure, a call that never returns. bash 3.2-safe: macOS CI runs it with
# /bin/bash.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude
unset KODFLOW_CLEANUP KODFLOW_CLEANUP_TIMEOUT GH_TOKEN GITHUB_TOKEN
export GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
mkdir -p "$HOME" "$TMPDIR" "$T/bin" "$T/gh"
SD=$CLAUDE_CONFIG_DIR/kodflow/sessions/sess-clean
mkdir -p "$SD"
cd "$T" || exit 1

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
check() { if eval "$2"; then ok "$1"; else bad "$1" "$2"; fi; }

# The gh double: `gh pr list --head <branch> ...` answers the file named after
# the branch in $T/gh, `fail` makes it exit 1, `hang` makes it sleep.
cat > "$T/bin/gh" <<'EOF'
#!/bin/bash
b=""; while [ $# -gt 0 ]; do [ "$1" = --head ] && b=$2; shift; done
f=$GH_FAKE_DIR/${b//\//_}
[ -f "$f" ] || { echo '[]'; exit 0; }
case "$(head -1 "$f")" in
    fail) echo "gh: HTTP 502" >&2; exit 1 ;;
    hang) sleep 30; echo '[]' ;;
    *) cat "$f" ;;
esac
EOF
chmod +x "$T/bin/gh"
export PATH=$T/bin:$PATH GH_FAKE_DIR=$T/gh

git init -q --bare -b main "$T/remote.git"
git clone -q "$T/remote.git" "$T/repo" 2>/dev/null
git -C "$T/repo" commit -q --allow-empty -m "chore: seed"
git -C "$T/repo" push -q origin main 2>/dev/null
git -C "$T/repo" remote set-head origin main >/dev/null 2>&1

# wt NAME BRANCH → a linked worktree under $T/.worktrees, one commit, pushed
wt() {
    local p=$T/.worktrees/repo-$1
    git -C "$T/repo" worktree add -q -b "$2" "$p" origin/main 2>/dev/null
    git -C "$p" commit -q --allow-empty -m "feat: $1"
    git -C "$p" push -q -u origin "$2" 2>/dev/null
    printf '%s' "$p"
}
# pr BRANCH STATE OID → what gh answers for that branch
pr() { printf '[{"number":7,"state":"%s","headRefOid":"%s","url":"https://example.invalid/pr/7"}]\n' "$2" "$3" > "$T/gh/${1//\//_}"; }
sha() { git -C "$1" rev-parse HEAD; }
local_branch() { git -C "$T/repo" show-ref --verify --quiet "refs/heads/$1"; }
remote_branch() { git -C "$T/remote.git" show-ref --verify --quiet "refs/heads/$1"; }
notices() { cat "$SD/cleanup-notices" 2>/dev/null; }
clean() { bash "$S/cleanup.sh" "$SD" "$@"; }

echo "== merged PR, clean worktree, same head: everything goes"
A=$(wt a feat/a); pr feat/a MERGED "$(sha "$A")"
clean "$A"
check "worktree removed" '[ ! -e "$A" ]'
check "local branch deleted" '! local_branch feat/a'
check "remote branch deleted" '! remote_branch feat/a'
check "git no longer lists it" '! git -C "$T/repo" worktree list | grep -q repo-a'
check "the removal is said" 'notices | grep -q "removed .*repo-a.*feat/a"'
check "main worktree untouched" '[ -d "$T/repo/.git" ] && local_branch main'

echo "== dirty worktree: nothing, a notice once"
B=$(wt b feat/b); pr feat/b MERGED "$(sha "$B")"
printf 'x\n' > "$B/wip.txt"
clean "$B"
check "worktree kept" '[ -d "$B" ] && [ -f "$B/wip.txt" ]'
check "branches kept" 'local_branch feat/b && remote_branch feat/b'
check "notice names the uncommitted changes" 'notices | grep "repo-b" | grep -q "uncommitted"'
clean "$B"
check "the notice is given once per worktree" '[ "$(notices | grep -c repo-b)" = 1 ]'

echo "== local head differs from the merged PR head: unpublished work"
C=$(wt c feat/c); pr feat/c MERGED "$(sha "$C")"
git -C "$C" commit -q --allow-empty -m "feat: not pushed"
clean "$C"
check "worktree kept" '[ -d "$C" ]'
check "branches kept" 'local_branch feat/c && remote_branch feat/c'
check "notice names the unpublished commits" 'notices | grep "repo-c" | grep -q "differs"'

echo "== PR open, or no PR"
D=$(wt d feat/d); pr feat/d OPEN "$(sha "$D")"
E=$(wt e feat/e)
clean "$D" "$E"
check "open PR: worktree kept" '[ -d "$D" ] && local_branch feat/d && remote_branch feat/d'
check "open PR: notice says not merged" 'notices | grep "repo-d" | grep -q "not merged"'
check "no PR: worktree kept" '[ -d "$E" ] && local_branch feat/e && remote_branch feat/e'
check "no PR: notice says no pull request" 'notices | grep "repo-e" | grep -q "no pull request"'

echo "== gh fails, gh hangs: nothing, no wait"
F=$(wt f feat/f); echo fail > "$T/gh/feat_f"
G=$(wt g feat/g); echo hang > "$T/gh/feat_g"
start=$(date +%s)
KODFLOW_CLEANUP_TIMEOUT=2 clean "$F" "$G"
took=$(( $(date +%s) - start ))
check "gh failure: worktree kept" '[ -d "$F" ] && local_branch feat/f && remote_branch feat/f'
check "gh hang: worktree kept" '[ -d "$G" ] && local_branch feat/g && remote_branch feat/g'
check "gh hang: bounded by the timeout (took ${took}s)" '[ "$took" -lt 10 ]'
check "gh failure is said" 'notices | grep "repo-f" | grep -q "gh"'
check "gh hang is said" 'notices | grep "repo-g" | grep -q "gh"'

echo "== never the main worktree, never the default branch"
pr main MERGED "$(sha "$T/repo")"
clean "$T/repo"
check "main worktree kept" '[ -d "$T/repo/.git" ] && local_branch main && remote_branch main'
git -C "$T/repo" checkout -q -b side
H=$T/.worktrees/repo-h
git -C "$T/repo" worktree add -q "$H" main 2>/dev/null
pr main MERGED "$(sha "$H")"
clean "$H"
check "default branch worktree kept" '[ -d "$H" ] && local_branch main && remote_branch main'
check "default branch is said" 'notices | grep "repo-h" | grep -q "default branch"'

echo "== KODFLOW_CLEANUP=off: nothing at all"
I=$(wt i feat/i); pr feat/i MERGED "$(sha "$I")"
: > "$SD/cleanup-notices"
KODFLOW_CLEANUP=off clean "$I"
check "off: worktree kept" '[ -d "$I" ] && local_branch feat/i && remote_branch feat/i'
check "off: no notice" '[ ! -s "$SD/cleanup-notices" ]'

echo "== a path that is no longer a worktree is skipped in silence"
clean "$T/.worktrees/repo-gone" "$A"
check "no notice for a missing path" '[ ! -s "$SD/cleanup-notices" ]'

echo "== remote branch already deleted by the forge"
J=$(wt j feat/j); pr feat/j MERGED "$(sha "$J")"
git -C "$T/remote.git" branch -q -D feat/j
clean "$J"
check "worktree and local branch removed" '[ ! -e "$J" ] && ! local_branch feat/j'
check "said as removed, no failure" 'notices | grep "repo-j" | grep -q "removed" && ! notices | grep "repo-j" | grep -q "not deleted"'

# A git double for the push only: `push ... --delete` fails with what
# FAKE_PUSH names, every other call goes to the real git. CI runners speak
# English and may lack the French catalogue, so the translated message is
# printed here rather than hoped for (#109).
REAL_GIT=$(command -v git)
mkdir -p "$T/fakegit"
cat > "$T/fakegit/git" <<EOF
#!/bin/bash
case " \$* " in
    *" push "*" --delete "*)
        case "\${FAKE_PUSH:-}" in
            fr) echo "error: impossible de supprimer 'x' : la référence distante n'existe pas" >&2
                echo "error: impossible de pousser des références vers '$T/remote.git'" >&2
                exit 1 ;;
            refused) echo "remote: refusé par une règle de protection" >&2; exit 1 ;;
        esac ;;
esac
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$T/fakegit/git"

echo "== remote branch already deleted, git speaking French"
L=$(wt l feat/l); pr feat/l MERGED "$(sha "$L")"
git -C "$T/remote.git" branch -q -D feat/l
PATH=$T/fakegit:$PATH FAKE_PUSH=fr clean "$L"
check "worktree and local branch removed" '[ ! -e "$L" ] && ! local_branch feat/l'
check "said as already deleted, no failure" 'notices | grep "repo-l" | grep -q "had already deleted it" && ! notices | grep "repo-l" | grep -q "not deleted"'

echo "== remote refuses the deletion: the failure is said, whatever the language"
M=$(wt m feat/m); pr feat/m MERGED "$(sha "$M")"
PATH=$T/fakegit:$PATH FAKE_PUSH=refused clean "$M"
check "worktree and local branch removed" '[ ! -e "$M" ] && ! local_branch feat/m'
check "remote branch still there" 'remote_branch feat/m'
check "said as not deleted on the remote" 'notices | grep "repo-m" | grep -q "not deleted"'

# The real git in French, where this machine has the locale: the double
# above covers the CI runners that do not.
if locale -a 2>/dev/null | grep -qiE '^fr_FR\.utf-?8$'; then
    echo "== remote branch already deleted, real git under LC_ALL=fr_FR.UTF-8"
    N=$(wt n feat/n); pr feat/n MERGED "$(sha "$N")"
    git -C "$T/remote.git" branch -q -D feat/n
    LC_ALL=fr_FR.UTF-8 LANGUAGE=fr clean "$N"
    check "said as already deleted, no failure" 'notices | grep "repo-n" | grep -q "had already deleted it" && ! notices | grep "repo-n" | grep -q "not deleted"'
fi

echo "== a refusal first, then a removal: the removal is still said"
K=$(wt k feat/k); pr feat/k OPEN "$(sha "$K")"
: > "$SD/cleanup-notices"
clean "$K"
check "first pass refused as not merged" 'notices | grep "repo-k" | grep -q "not merged"'
clean "$K"
check "the same refusal is not repeated" '[ "$(notices | grep -c "repo-k.*not merged")" = 1 ]'
pr feat/k MERGED "$(sha "$K")"
clean "$K"
check "second attempt removes it" '[ ! -e "$K" ] && ! local_branch feat/k'
check "and the removal is said after the refusal" 'notices | grep "repo-k" | grep -q "removed"'

echo "== UserPromptSubmit hands the notices to the model once"
: > "$SD/cleanup-notices"; printf 'kodflow cleanup: left X in place: test\n' >> "$SD/cleanup-notices"
mkdir -p "$T/proj"
OUT=$(jq -n -c --arg cwd "$T/proj" --arg sp "$T/tmp/sp" '{session_id:"sess-clean",hook_event_name:"UserPromptSubmit",cwd:$cwd,scratchpad_dir:$sp,prompt:"hello"}' \
    | CLAUDE_PROJECT_DIR=$T/proj bash "$S/on-user.sh" 2>/dev/null)
check "notice in additionalContext" 'printf "%s" "$OUT" | jq -r .hookSpecificOutput.additionalContext | grep -q "left X in place"'
check "notices consumed" '[ ! -s "$SD/cleanup-notices" ]'

echo "== notices past the budget wait for the next prompt, none lost"
: > "$SD/cleanup-notices"
n=0; while [ $n -lt 100 ]; do printf 'kodflow cleanup: notice %03d %s\n' "$n" "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" >> "$SD/cleanup-notices"; n=$((n+1)); done
prompt() {
    jq -n -c --arg cwd "$T/proj" --arg sp "$T/tmp/sp" '{session_id:"sess-clean",hook_event_name:"UserPromptSubmit",cwd:$cwd,scratchpad_dir:$sp,prompt:"hello"}' \
        | CLAUDE_PROJECT_DIR=$T/proj bash "$S/on-user.sh" 2>/dev/null | jq -r .hookSpecificOutput.additionalContext
}
got=$T/got; : > "$got"
i=0; while [ $i -lt 5 ]; do prompt >> "$got"; i=$((i+1)); done
check "every notice delivered once over the prompts" '[ "$(grep -o "notice [0-9][0-9][0-9]" "$got" | sort -u | wc -l | tr -d " ")" = 100 ] && [ "$(grep -c "notice [0-9][0-9][0-9]" "$got")" = 100 ]'
check "the held notices are announced" 'grep -q "more cleanup notice(s) held for the next prompt" "$got"'
check "nothing left once delivered" '[ ! -s "$SD/cleanup-notices" ] && [ ! -s "$SD/cleanup-notices.rest" ]'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
