#!/usr/bin/env bash
# shellcheck disable=SC2016  # jq programs and sh -c bodies are single-quoted on purpose
# e2e-dryrun.sh — one complete /hunt cycle played by the scripts alone, with
# no agent: every role is a few shell lines that call the hunt-* scripts the
# way roles.md tells the agent to.
#
#   bash plugins/kodflow-workflow/skills/hunt/tests/e2e-dryrun.sh
#
# Self-contained and language-agnostic: a throwaway HOME, HUNT_NO_SYSTEMCTL=1,
# no network, the `local` forge, a two-function shell project with one seeded
# defect, a bare repository as the remote, and witness commands declared in the
# scope. The cycle:
#   init → pass 1 on a frozen SHA → the seeded defect's witness fails (verdict
#   finding) → a verifier replays it → slot + issue-create (nonce) → a fixer
#   fixes it in its fix worktree through hunt-git → all-or-nothing integration
#   → the witness passes at N_fix → label fixed-local → bundle → freeze →
#   final pass, every cell clean → hunt-push to the bare remote, MR with
#   Closes #N on the local forge, label fixed → status.json == rebuild →
#   after-merge close → teardown.
# Exit 0 when the whole cycle holds; idempotent (nothing outside mktemp).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
BIN=$(cd "$HERE/../../../bin" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME=$T/home
mkdir -p "$HOME"
unset DBUS_SESSION_BUS_ADDRESS DISPLAY WAYLAND_DISPLAY HUNT_SLUG HUNT_REPO \
      CLAUDE_SESSION_ID HUNT_PUSH_TOKEN XDG_CONFIG_HOME GIT_DIR GIT_WORK_TREE
export HUNT_LOURD="" HUNT_NO_SYSTEMCTL=1 HUNT_WORKTREES=$T/wt HUNT_OWNER_PID=$$ HUNT_TOKENS=2
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
       GIT_AUTHOR_NAME=hunt GIT_AUTHOR_EMAIL=hunt@example.invalid \
       GIT_COMMITTER_NAME=hunt GIT_COMMITTER_EMAIL=hunt@example.invalid
export PATH="$BIN:$PATH"

SLUG=calc-arith
REPO=app
S=$HOME/.local/state/hunt/$SLUG
R=$T/src/app

n_ok=0
ok()   { n_ok=$((n_ok + 1)); printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1" >&2; exit 1; }
expect() { local name=$1; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else fail "$name — $*"; fi; }
ledger() { hunt-ledger append "$SLUG" "$1" "${2:-{\}}" >/dev/null; }
status() { jq -r "$1" "$S/status.json"; }

# --- the project: two functions, one seeded defect ---------------------------
mkdir -p "$R/tests"
git init -q -b main "$R"
cat >"$R/calc.sh" <<'SH'
#!/bin/sh
# calc.sh OP A B
case $1 in
  add) echo $(( $2 - $3 )) ;;
  mul) echo $(( $2 * $3 )) ;;
esac
SH
cat >"$R/tests/mul.sh" <<'SH'
#!/bin/sh
[ "$(sh calc.sh mul 3 4)" = 12 ]
SH
git -C "$R" add -A && git -C "$R" commit -q -m "feat: calc"
git init -q --bare "$T/remote/app.git"
git -C "$R" remote add origin "$T/remote/app.git"
git -C "$R" push -q origin main
git -C "$R" fetch -q origin

# --- phase 1: scope.json, approved once ----------------------------------------
mkdir -p "$S"
jq -n --arg p "$R" --arg slug "$SLUG" '{
  slug: $slug, topic: "Every arithmetic operation of calc returns the right value",
  queue: { tmp_env: ["TMPDIR"] },
  repos: { app: { path: $p, forge: "local", owned: true, base: "main", mr_target: "main",
                  remote: "origin", globs: { in: ["calc.sh", "tests/**"], out: [] },
                  lock: "~/.cache/hunt/locks/app.lock", lang: "shell",
                  env: { LC_ALL: "C" }, witness_tags: [""], exclusive: [], depends_on: [] } },
  imported_issues: [],
  matrix: [
    { id: "add-sum", repo: "app", title: "add returns the sum",
      witness: { cmd: "sh tests/add.sh", n: 3 }, expect: "green" },
    { id: "mul-product", repo: "app", title: "mul returns the product",
      witness: { cmd: "sh tests/mul.sh", n: 3 }, expect: "green" } ],
  thresholds: { cap: 10, resume_at: 7, max_passes: 4, max_hours: 1, stall_ms: 7500000,
                disk_min_gib: 0, witness_timeout_s: 30, integration_budget_s: 600, codex_defer_s: 60 },
  budget: { hunters: 1, fixers: 1, tokens: 2 }, stopped_by_preflight: [] }' >"$S/scope.json"

# Plays one cell's witness N times, each run its own hunt-queue job in the
# worktree. Prints "k n" (k failures over n runs that gave a verdict).
play() { # WORKTREE CELL [N]
  local wt=$1 cell=$2 cmd n k=0 got=0 i rc
  cmd=$(jq -r --arg c "$cell" '.matrix[] | select(.id == $c) | .witness.cmd' "$S/scope.json")
  n=${3:-$(jq -r --arg c "$cell" '.matrix[] | select(.id == $c) | .witness.n' "$S/scope.json")}
  for (( i = 1; i <= n; i++ )); do
    rc=0
    HUNT_SLUG=$SLUG HUNT_REPO=$REPO hunt-queue --label "witness $cell $i/$n" --wait 60 --deadline 30 \
      -- sh -c 'cd "$1" && exec sh -c "$2"' _ "$wt" "$cmd" >/dev/null 2>&1 || rc=$?
    case $rc in
      0) got=$((got + 1)) ;;
      75|124|137) ;;                       # no verdict: never a pass, never a fail
      *) got=$((got + 1)); k=$((k + 1)) ;;
    esac
  done
  printf '%s %s\n' "$k" "$got"
}

echo "== start"
hunt-ledger init "$SLUG" >/dev/null
ledger start "$(jq -cn --arg h "$(sha256sum "$S/scope.json" | cut -d' ' -f1)" \
  '{topic:"calc arithmetic", scope_sha256:$h, budget:{hunters:1, fixers:1, tokens:2}}')"
mkdir -p "$R/.claude"
echo '{"permissions":{"deny":["Bash(git push:*)"]}}' >"$R/.claude/settings.local.json"
hunt-status --install-watchdog >/dev/null
hunt-ledger owner "$SLUG" --set-state hunting
expect "the hunt is registered in active.json, hunting" \
  test "$(jq -r --arg s "$SLUG" '.hunts[] | select(.slug == $s) | .state' "$HOME/.local/state/hunt/active.json")" = hunting
expect "a queued job gets the scope's env and its own TMPDIR (queue.tmp_env)" \
  env HUNT_SLUG="$SLUG" HUNT_REPO="$REPO" hunt-queue --label env -- \
  sh -c '[ "$LC_ALL" = C ] && [ -d "$HUNT_JOB_TMP" ] && [ "$TMPDIR" = "$HUNT_JOB_TMP" ]'
INTEG=$(hunt-git "$SLUG" "$REPO" integ-init main)
expect "the integration worktree is on hunt/$SLUG" \
  test "$(git -C "$INTEG" symbolic-ref --short HEAD)" = "hunt/$SLUG"

echo "== pass 1 (hunter)"
ledger agent '{"id":"hunter-1","role":"hunter","model":"none"}'
frozen=$(hunt-git "$SLUG" "$REPO" tip)
ledger pass-start "$(jq -cn --arg s "$frozen" '{n:1, sha:{app:$s}, cells_total:2}')"
SHA1=$(hunt-git "$SLUG" "$REPO" worktree-add sha-1 "$frozen")
read -r k n < <(play "$SHA1" mul-product)
expect "mul-product is clean on the frozen SHA (0/$n)" test "$k" -eq 0
ledger verdict "$(jq -cn --argjson k "$k" --argjson n "$n" '{pass:1, cell:"mul-product", repo:"app", result:"clean", k:$k, n:$n}')"
cat >"$SHA1/tests/add.sh" <<'SH'
#!/bin/sh
[ "$(sh calc.sh add 2 3)" = 5 ]
SH
wsha=$(hunt-git "$SLUG" "$REPO" commit sha-1 "test: witness for add-sum")
read -r k n < <(play "$SHA1" add-sum)
expect "the seeded defect's witness is red ($k/$n)" test "$k" -gt 0
mkdir -p "$S/witness"
wrec=$(jq -cn --arg c "sh tests/add.sh" --arg sha "$wsha" '{repo:"app", cell:"add-sum", cmd:$c, env:{LC_ALL:"C"}, commit:$sha, n:3}')
wh=$(printf '%s' "$wrec" | sha256sum | cut -d' ' -f1)
printf '%s\n' "$wrec" >"$S/witness/$wh.json"
ledger verdict "$(jq -cn --arg w "$wh" --argjson k "$k" --argjson n "$n" '{pass:1, cell:"add-sum", repo:"app", result:"finding", witness:$w, k:$k, n:$n}')"
ledger finding "$(jq -cn --arg w "$wh" --arg c "$wsha" '{cell:"add-sum", repo:"app", witness:$w, commit:$c, summary:"add 2 3 is not 5"}')"
finding_seq=$(hunt-ledger read "$SLUG" | jq -s '[.[] | select(.kind == "finding")] | last | .seq')
ledger pass-end '{"n":1,"cells_done":2,"findings":1}'
hunt-git "$SLUG" "$REPO" worktree-remove sha-1
expect "pass 1 has a verdict for both cells" test "$(status .pass.cells_done)" -eq 2

echo "== verifier"
ledger agent '{"id":"verifier-1","role":"verifier","model":"none"}'
VER=$(hunt-git "$SLUG" "$REPO" worktree-add "ver-$finding_seq" "$wsha")
read -r k n < <(play "$VER" add-sum)
expect "the verifier replays the recorded witness red ($k/$n)" test "$k" -gt 0
ledger confirmed "$(jq -cn --argjson f "$finding_seq" --argjson k "$k" --argjson n "$n" \
  '{finding:$f, k:$k, n:$n, p_hat:($k / $n), queue_concurrency:1}')"
p_hat=$(jq -n --argjson k "$k" --argjson n "$n" '$k / $n')
dups=$(hunt-forge "$SLUG" "$REPO" issue-list --state all | jq '[.[] | select(.title | test("add-sum"))] | length')
expect "no duplicate on the forge" test "$dups" -eq 0
expect "a slot is reserved under the ledger lock" hunt-ledger append "$SLUG" slot "{\"finding\":$finding_seq,\"repo\":\"app\"}"
nonce="$SLUG-$finding_seq"
ledger forge-intent "$(jq -cn --arg n "$nonce" '{op:"issue-create", repo:"app", nonce:$n}')"
body=$(printf 'Observed: `sh calc.sh add 2 3` is not 5.\nExpected: 5.\nWitness: `%s` (record %s), red %s/%s on %s.\n' \
  "sh tests/add.sh" "$wh" "$k" "$n" "$frozen")
issue=$(hunt-forge "$SLUG" "$REPO" issue-create --title "add-sum: add returns a difference" \
  --body "$body" --nonce "$nonce" --label "hunt:$SLUG")
expect "a retried issue-create with the same nonce returns the same issue" \
  test "$(hunt-forge "$SLUG" "$REPO" issue-create --title x --body x --nonce "$nonce")" = "$issue"
ledger forge-done "$(jq -cn --arg n "$nonce" --argjson i "$issue" '{op:"issue-create", repo:"app", nonce:$n, issue:$i}')"
hunt-git "$SLUG" "$REPO" witness-branch "$issue" "$wsha" >/dev/null
hunt-git "$SLUG" "$REPO" worktree-remove "ver-$finding_seq"
ledger agent-end '{"id":"verifier-1","role":"verifier","outcome":"confirmed"}'
expect "the counter holds the new issue (1 open, no reservation left)" \
  test "$(status '"\(.counter.open)/\(.counter.reserved)"')" = 1/0

echo "== fixer"
ledger agent '{"id":"fixer-1","role":"fixer","model":"none"}'
FIX=$(hunt-git "$SLUG" "$REPO" worktree-add "fix-$issue" "hunt/$SLUG")
ledger claim "$(jq -cn --argjson i "$issue" --arg w "$FIX" --arg b "hunt-fix/$SLUG/$issue" \
  '{repo:"app", issue:$i, fixer:"fixer-1", worktree:$w, branch:$b}')"
hunt-git "$SLUG" "$REPO" cherry-pick "fix-$issue" "hunt-w/$SLUG/$issue" >/dev/null
read -r k n < <(play "$FIX" add-sum 1)
expect "the witness is red in the fix worktree before the fix" test "$k" -eq 1
sed -i 's/\$2 - \$3/$2 + $3/' "$FIX/calc.sh"
read -r k n < <(play "$FIX" add-sum 3)
expect "the witness is green after the fix ($k/$n)" test "$k" -eq 0
fix_commit=$(hunt-git "$SLUG" "$REPO" commit "fix-$issue" "fix(calc): add returns the sum (#$issue)")
ledger fix-ready "$(jq -cn --argjson i "$issue" --arg b "hunt-fix/$SLUG/$issue" --arg c "$fix_commit" \
  '{repo:"app", issue:$i, branch:$b, commit:$c}')"

echo "== integrator"
before=$(hunt-git "$SLUG" "$REPO" tip)
ledger tip-before "$(jq -cn --arg s "$before" --argjson i "$issue" '{repo:"app", sha:$s, issues:[$i]}')"
after=$(hunt-git "$SLUG" "$REPO" integrate "hunt-fix/$SLUG/$issue")
expect "integrate fast-forwarded hunt/$SLUG" test "$(hunt-git "$SLUG" "$REPO" tip)" = "$after"
mapfile -t files < <(git -C "$R" diff --name-only "$before" "$after")
outside=()
for f in "${files[@]}"; do
  in=false
  while IFS= read -r g; do
    # shellcheck disable=SC2053  # $g is a glob on purpose
    [[ $f == $g ]] && in=true
  done < <(jq -r '.repos.app.globs.in[]' "$S/scope.json")
  while IFS= read -r g; do
    # shellcheck disable=SC2053
    [[ $f == $g ]] && in=false
  done < <(jq -r '.repos.app.globs.out[]' "$S/scope.json")
  [[ $in == true ]] || outside+=("$f")
done
expect "root's glob check: every changed file is In (${files[*]})" test "${#outside[@]}" -eq 0
n_fix=$(jq -n --argjson p "$p_hat" '[20, ((3 / $p) | ceil)] | max')
t0=$(date +%s%3N)
read -r k n < <(play "$INTEG" add-sum "$n_fix")
expect "the issue's witness is green at N_fix ($k/$n)" test "$k" -eq 0 -a "$n" -eq "$n_fix"
ledger witness-run "$(jq -cn --arg w "$wh" --argjson n "$n" --argjson k "$k" --argjson d "$(( $(date +%s%3N) - t0 ))" \
  '{witness:$w, n:$n, k:$k, duration_ms:$d}')"
read -r k n < <(play "$INTEG" mul-product 1)
expect "the other cell's witness stays green (reduced N)" test "$k" -eq 0
ledger tip-after "$(jq -cn --arg s "$after" --argjson i "$issue" --args '{repo:"app", sha:$s, issues:[$i], files:$ARGS.positional}' "${files[@]}")"
hunt-forge "$SLUG" "$REPO" issue-label "$issue" --add hunt:fixed-local
ledger label "$(jq -cn --argjson i "$issue" '{repo:"app", issue:$i, label:"fixed-local"}')"
hunt-forge "$SLUG" "$REPO" issue-comment "$issue" --body "Fixed locally in ${after:0:12}: witness ${k}/${n_fix} after, red before."
bundle=$(hunt-git "$SLUG" "$REPO" bundle)
ledger bundle "$(jq -cn --arg s "$after" '{repo:"app", sha:$s}')"
expect "tip.bundle holds hunt/$SLUG at the new tip" \
  bash -c '[[ $(git bundle list-heads "$0" | cut -d" " -f1) == "$1" ]]' "$bundle" "$after"
# Codex is outside a dry run: the review is recorded as skipped, never pending.
ledger codex "$(jq -cn --argjson i "$issue" '{repo:"app", issue:$i, result:"skipped", verdict:"dry run"}')"
ledger release "$(jq -cn --argjson i "$issue" '{repo:"app", issue:$i, fixer:"fixer-1"}')"
hunt-git "$SLUG" "$REPO" worktree-remove "fix-$issue"
expect "the counter is back at 0, the tip is in status.json" \
  test "$(status '"\(.counter.open) \(.tip.sha)"')" = "0 $after"

echo "== freeze and final pass"
expect "freeze conditions: counter 0, no Codex pending" \
  test "$(status '"\(.counter.open) \(.codex.pending)"')" = "0 0"
hunt-ledger owner "$SLUG" --set-state frozen
git -C "$INTEG" fetch -q origin
expect "the base did not move: no rebase before the final pass" \
  git -C "$R" merge-base --is-ancestor "$(git -C "$R" rev-parse origin/main)" "$after"
hunt-ledger owner "$SLUG" --set-state final-pass
frozen=$(hunt-git "$SLUG" "$REPO" tip)
ledger pass-start "$(jq -cn --arg s "$frozen" '{n:2, sha:{app:$s}, cells_total:2}')"
SHA2=$(hunt-git "$SLUG" "$REPO" worktree-add sha-2 "$frozen")
for cell in add-sum mul-product; do
  read -r k n < <(play "$SHA2" "$cell")
  expect "final pass: $cell is clean ($k/$n)" test "$k" -eq 0
  ledger verdict "$(jq -cn --arg c "$cell" --argjson k "$k" --argjson n "$n" '{pass:2, cell:$c, repo:"app", result:"clean", k:$k, n:$n}')"
done
ledger pass-end '{"n":2,"cells_done":2,"findings":0}'
hunt-git "$SLUG" "$REPO" worktree-remove sha-2
expect "the final pass covers every cell" test "$(status '"\(.pass.n) \(.pass.cells_done)/\(.pass.cells_total)"')" = "2 2/2"

echo "== hunt-push"
expect "hunt-push converges and pushes" hunt-push "$SLUG"
pushed=$(git -C "$T/remote/app.git" rev-parse "refs/heads/hunt/$SLUG")
expect "the bare remote has hunt/$SLUG with the frozen tree" git -C "$R" diff --quiet "$frozen" "$pushed"
expect "main was not touched on the remote" \
  test "$(git -C "$T/remote/app.git" rev-parse refs/heads/main)" = "$(git -C "$R" rev-parse origin/main)"
mr=$S/forge-local/app/mrs/1.json
expect "one MR from hunt/$SLUG to main" test "$(jq -r '"\(.source)>\(.target) \(.state)"' "$mr")" = "hunt/$SLUG>main open"
expect "the MR description closes the issue" grep -qx "Closes #$issue" <(jq -r .body "$mr")
expect "the issue moved from hunt:fixed-local to hunt:fixed" \
  test "$(hunt-forge "$SLUG" "$REPO" issue-list | jq -c --argjson i "$issue" '.[] | select(.number == $i) | .labels - ["hunt:'"$SLUG"'"]')" = '["hunt:fixed"]'
expect "ledger order: converged, push, mr-opened, label fixed" \
  test "$(hunt-ledger read "$SLUG" | jq -rs '[.[] | select(.kind | IN("converged","push","mr-opened")) .kind] + [.[] | select(.kind == "label") | .label] | join(",")')" \
       = "converged,push,mr-opened,fixed-local,fixed"
expect "state is awaiting-merge" test "$(status .state)" = awaiting-merge
expect "a second hunt-push is idempotent" hunt-push "$SLUG"
expect "status.json equals hunt-ledger rebuild" \
  test "$(jq -S . "$S/status.json")" = "$(hunt-ledger rebuild "$SLUG" | jq -S .)"
expect "hunt-status --json is status.json" test "$(hunt-status "$SLUG" --json | jq -S .)" = "$(jq -S . "$S/status.json")"

echo "== after merge and teardown"
# The user merges on the forge: here, main moves on the bare remote and the
# local forge marks the MR merged.
git -C "$T/remote/app.git" update-ref refs/heads/main "$pushed"
tmp=$(mktemp "$S/forge-local/app/mrs/.XXXXXX")
jq -c --arg s "$pushed" '.state = "merged" | .merge_sha = $s' "$mr" >"$tmp" && mv -f "$tmp" "$mr"
st=$(hunt-forge "$SLUG" "$REPO" mr-status 1)
expect "mr-status reports the merge" test "$(jq -r .state <<<"$st")" = merged
msha=$(jq -r .merge_sha <<<"$st")
ledger merged "$(jq -cn --arg s "$msha" '{repo:"app", mr:1, merge_sha:$s}')"
hunt-forge "$SLUG" "$REPO" issue-close "$issue" --body "FIXED SINCE $msha"
ledger closed "$(jq -cn --argjson i "$issue" --arg s "$msha" '{repo:"app", issue:$i, since_sha:$s}')"
expect "the issue is closed" test "$(hunt-forge "$SLUG" "$REPO" issue-list --state closed | jq length)" -eq 1
expect "--repin has nothing to re-pin without dependencies" hunt-push "$SLUG" --repin
hunt-ledger owner "$SLUG" --set-state "done"
hunt-status --remove-watchdog
hunt-git "$SLUG" "$REPO" worktree-remove integ
for b in "hunt-fix/$SLUG/$issue" "hunt-w/$SLUG/$issue" "hunt/$SLUG"; do hunt-git "$SLUG" "$REPO" branch-delete "$b"; done
rm -f "$R/.claude/settings.local.json"; rmdir "$R/.claude"
ledger teardown '{"removed":["worktrees","branches","watchdog","deny rule"]}'
hunt-ledger owner "$SLUG" --release
expect "no hunt branch or worktree is left" \
  test "$(git -C "$R" for-each-ref --format=x 'refs/heads/hunt*' | wc -l) $(git -C "$R" worktree list | wc -l)" = "0 1"
expect "the done hunt left active.json" \
  test "$(jq --arg s "$SLUG" '[.hunts[] | select(.slug == $s)] | length' "$HOME/.local/state/hunt/active.json")" -eq 0
expect "the ledger stays, status.json still equals a rebuild" \
  test "$(jq -S . "$S/status.json")" = "$(hunt-ledger rebuild "$SLUG" | jq -S .)"

echo
printf '%d checks passed: one defect found, confirmed, fixed, integrated and pushed without a prompt\n' "$n_ok"
