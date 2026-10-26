#!/usr/bin/env bash
# shellcheck disable=SC2016,SC2012  # bash -c bodies are single-quoted on purpose
# run.sh — unit tests of the /hunt scripts (plugins/kodflow-workflow/bin/hunt-*).
# Plain bash, a throwaway HOME under mktemp, no network: the forge is the
# `local` fake, the remote a bare repository, no lourd, no systemctl.
#
#   bash plugins/kodflow-workflow/skills/hunt/tests/run.sh
#
# Exit 0 when every check passes.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
BIN=$(cd "$HERE/../../../bin" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME=$T/home
mkdir -p "$HOME"
unset DBUS_SESSION_BUS_ADDRESS DISPLAY WAYLAND_DISPLAY HUNT_TOKENS HUNT_SLUG HUNT_REPO \
      CLAUDE_SESSION_ID HUNT_PUSH_TOKEN XDG_CONFIG_HOME
export HUNT_LOURD="" HUNT_NO_SYSTEMCTL=1 HUNT_WORKTREES=$T/wt HUNT_OWNER_PID=$$
export GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid \
       GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
export PATH="$BIN:$PATH"
S=$HOME/.local/state/hunt

pass=0 fail=0
ok()  { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n       %s\n' "$1" "${2:-}"; }
check() { local name=$1; shift; if "$@" >/dev/null; then ok "$name"; else bad "$name" "$*"; fi; }

DEFAULT_SCOPE='{"matrix":["c1","c2"],"thresholds":{"cap":3,"resume_at":2}}'
new_hunt() { # SLUG [SCOPE_JSON]
  mkdir -p "$S/$1"
  printf '%s\n' "${2:-$DEFAULT_SCOPE}" >"$S/$1/scope.json"
  hunt-ledger init "$1" >/dev/null
}
lines() { hunt-ledger read "$1" | wc -l | tr -d ' '; }

echo "== hunt-ledger"
new_hunt conc
for w in 1 2 3 4 5 6 7 8; do
  ( for i in 1 2 3 4 5 6 7 8 9 10; do
      hunt-ledger append conc agent "{\"id\":\"w$w\",\"role\":\"r$i\"}" >/dev/null || echo FAIL >>"$T/conc.err"
    done ) &
done
wait
if [[ -e $T/conc.err ]]; then bad "8 writers append without error" "$(wc -l <"$T/conc.err") failures"; else ok "8 writers append without error"; fi
check "80 lines, each a JSON object" test "$(jq -cR 'fromjson? | objects' "$S/conc/ledger.jsonl" | wc -l)" -eq 80
check "every line ends with a newline" test "$(tail -c 1 "$S/conc/ledger.jsonl" | od -An -c | tr -d ' ')" = '\n'
check "seq is gapless 1..80" test "$(jq -s '[.[].seq] == [range(1; 81)]' "$S/conc/ledger.jsonl")" = true
check "status.seq follows the ledger" test "$(jq .seq "$S/conc/status.json")" -eq 80

big=$(head -c 5000 /dev/zero | tr '\0' x)
hunt-ledger append conc finding "{\"summary\":\"$big\"}" >/dev/null 2>&1
check "a line over 4096 bytes is refused (exit 1)" test $? -eq 1
check "the refused line was not written" test "$(lines conc)" -eq 80
edge=$(head -c 4000 /dev/zero | tr '\0' y)
check "a line under 4096 bytes is accepted" hunt-ledger append conc finding "{\"summary\":\"$edge\"}"

new_hunt torn
for k in start agent state; do hunt-ledger append torn "$k" '{"to":"hunting"}' >/dev/null; done
printf '{"seq":4,"ts":1,"ki' >>"$S/torn/ledger.jsonl"
check "read skips an unterminated tail" test "$(lines torn)" -eq 3
check "read --since returns what follows" test "$(hunt-ledger read torn --since 2 | jq -r .kind)" = state
hunt-ledger append torn pause '{"reason":"user"}' >/dev/null
check "the next append heals the tail and takes seq 4" \
  test "$(hunt-ledger read torn | jq -s '[.[].seq] == [1,2,3,4] and .[3].kind == "pause"')" = true
check "the healed ledger has no broken line" test "$(jq -cR 'fromjson? | objects' "$S/torn/ledger.jsonl" | wc -l)" -eq 4
check "a pause sets the state and its reason" test "$(jq -r '"\(.state)/\(.pause.reason)"' "$S/torn/status.json")" = paused/user
check "notify_failed is set without a display bus" test "$(jq .notify_failed "$S/torn/status.json")" = true

hunt-ledger append torn converged '{}' >/dev/null 2>&1
check "converged is refused without the hunt-push token" test $? -eq 1
HUNT_PUSH_TOKEN=forged hunt-ledger append torn push '{}' >/dev/null 2>&1
check "push is refused with a forged token" test $? -eq 1
printf 'secret\n' >"$S/torn/.push-token"
HUNT_PUSH_TOKEN=forged hunt-ledger append torn converged '{}' >/dev/null 2>&1
check "converged is refused when the token does not match" test $? -eq 1
check "converged is accepted with hunt-push's token" env HUNT_PUSH_TOKEN=secret hunt-ledger append torn converged '{}'
rm -f "$S/torn/.push-token"

echo "== slots and counter"
new_hunt cap '{"matrix":["c1"],"thresholds":{"cap":2,"resume_at":1}}'
for i in 1 2 3 4 5 6; do ( hunt-ledger append cap slot "{\"finding\":$i,\"repo\":\"r\"}" >/dev/null 2>&1 && echo "$i" >>"$T/slots.ok" ) & done
wait
check "6 concurrent slots with cap 2: exactly 2 granted" test "$(wc -l <"$T/slots.ok")" -eq 2
hunt-ledger append cap slot '{"finding":7,"repo":"r"}' >/dev/null 2>&1
check "a slot past the cap exits 1" test $? -eq 1
hunt-ledger append cap forge-done '{"op":"issue-create","repo":"r","issue":11,"nonce":"a"}' >/dev/null
hunt-ledger append cap forge-done '{"op":"issue-create","repo":"r","issue":12,"nonce":"b"}' >/dev/null
check "issues created on reserved slots keep the counter at 2" test "$(jq .counter.open "$S/cap/status.json")" -eq 2
hunt-ledger append cap label '{"repo":"r","issue":11,"label":"hunt:fixed-local"}' >/dev/null
hunt-ledger append cap label '{"repo":"r","issue":11,"label":"fixed-local"}' >/dev/null
check "a fixed-local label frees one place, once" test "$(jq .counter.open "$S/cap/status.json")" -eq 1
check "a slot is granted again below the cap" hunt-ledger append cap slot '{"finding":8,"repo":"r"}'
hunt-ledger append cap decision '{"repo":"r","issue":12,"title":"keep or drop","question":"?"}' >/dev/null
check "a decision leaves the counter and is listed" \
  test "$(jq -c '[.counter.open, (.decisions | map(.issue))]' "$S/cap/status.json")" = '[1,[12]]'
check "status.json equals a rebuild" test "$(jq -S . "$S/cap/status.json")" = "$(hunt-ledger rebuild cap | jq -S .)"

echo "== active.json"
for s in a1 a2 a3 a4 a5 a6; do mkdir -p "$S/$s"; echo '{"matrix":[]}' >"$S/$s/scope.json"; done
for s in a1 a2 a3 a4 a5 a6; do hunt-ledger init "$s" >/dev/null & done
wait
check "6 concurrent inits keep 6 entries" \
  test "$(jq '[.hunts[].slug | select(startswith("a"))] | length' "$S/active.json")" -eq 6
check "an entry carries owner.proc and created" \
  test "$(jq '[.hunts[] | select(.slug == "a1") | (.owner.proc.pid > 0 and .created > 0)] == [true]' "$S/active.json")" = true
mkdir -p "$S/a7"; echo '{"matrix":[]}' >"$S/a7/scope.json"
sleep 30 & live=$!
HUNT_OWNER_PID=$live hunt-ledger init a7 >/dev/null
hunt-ledger init a7 >/dev/null 2>&1
check "init refuses a slug held by another live owner" test $? -eq 1
kill "$live"; wait "$live" 2>/dev/null
check "init takes over once that owner is gone" hunt-ledger init a7
hunt-ledger owner a1 --set-state frozen
check "owner --set-state reaches status and active.json" \
  test "$(jq -r .state "$S/a1/status.json")/$(jq -r '.hunts[] | select(.slug == "a1") | .state' "$S/active.json")" = frozen/frozen
hunt-ledger owner a1 --set-state bogus >/dev/null 2>&1
check "owner --set-state refuses an unknown state (exit 2)" test $? -eq 2
hunt-ledger owner a2 --set-state "done"; hunt-ledger owner a2 --release
check "release of a done hunt removes its entry" test "$(jq '[.hunts[] | select(.slug == "a2")] | length' "$S/active.json")" -eq 0

echo "== hunt-queue"
export HUNT_TOKENS=2
cat >"$T/job.sh" <<'JOB'
#!/usr/bin/env bash
# job.sh NAME SECONDS: records start/end and the concurrency it saw.
exec 9>>"$JOBDIR/count.lock"
flock 9; n=$(( $(cat "$JOBDIR/count" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$JOBDIR/count"
echo "$n" >>"$JOBDIR/seen"; echo "start $1 $(date +%s%N)" >>"$JOBDIR/log"; flock -u 9
sleep "$2"
flock 9; n=$(( $(cat "$JOBDIR/count") - 1 )); echo "$n" >"$JOBDIR/count"
echo "end $1 $(date +%s%N)" >>"$JOBDIR/log"; flock -u 9
JOB
chmod +x "$T/job.sh"
export JOBDIR=$T/jobs
mkdir -p "$JOBDIR"
for i in 1 2 3 4 5; do hunt-queue --label "n$i" --wait 60 -- "$T/job.sh" "n$i" 0.6 & done
wait
check "5 normal jobs, 2 tokens: never more than 2 at once" test "$(sort -n "$JOBDIR/seen" | tail -n 1)" -le 2
check "5 normal jobs all ran" test "$(grep -c '^end' "$JOBDIR/log")" -eq 5
check "queue records are removed on exit" test -z "$(ls "$HOME/.cache/hunt/queue")"

rm -f "$JOBDIR"/*
hunt-queue --exclusive --label x1 --wait 30 -- "$T/job.sh" x1 3 &
xpid=$!
sleep 1
hunt-queue --label blocked --wait 1 -- "$T/job.sh" blocked 0 2>/dev/null
check "a normal job cannot start while an exclusive one holds every token (75)" test $? -eq 75
wait "$xpid"
check "the exclusive job ran" grep -q '^end x1' "$JOBDIR/log"

rm -f "$JOBDIR"/*
hunt-queue --label m1 --wait 30 -- "$T/job.sh" m1 2 &
hunt-queue --label m2 --wait 30 -- "$T/job.sh" m2 2 &
sleep 0.7
hunt-queue --exclusive --label early --wait 1 -- "$T/job.sh" early 0 2>/dev/null
check "an exclusive job waits for all tokens (times out while 2 run)" test $? -eq 75
hunt-queue --exclusive --label x2 --wait 30 -- "$T/job.sh" x2 0
wait
last_end=$(awk '/^end m/ { print $3 }' "$JOBDIR/log" | sort -n | tail -n 1)
x_start=$(awk '/^start x2/ { print $3 }' "$JOBDIR/log")
check "the exclusive job started after both normal jobs ended" test "$x_start" -gt "$last_end"

new_hunt q
rm -f "$JOBDIR"/*
hunt-queue --exclusive --label hold --wait 30 -- "$T/job.sh" hold 3 &
hpid=$!
sleep 1
HUNT_SLUG=q hunt-queue --label late --wait 1 -- true 2>/dev/null
rc=$?
check "queue timeout exits 75" test "$rc" -eq 75
check "the timed-out record stays with state timeout" \
  test "$(jq -rs '[.[] | select(.label == "late") | .state] | first' "$HOME"/.cache/hunt/queue/*.json)" = timeout
check "a queue-timeout event reaches the ledger" test "$(hunt-ledger read q | jq -r 'select(.kind == "queue-timeout") | .label')" = late
wait "$hpid"
HUNT_SLUG=q hunt-queue --label after -- true
check "a dead job's record is purged at the next start" test -z "$(ls "$HOME/.cache/hunt/queue")"
check "a finished job leaves a job event" test "$(hunt-ledger read q | jq -r 'select(.kind == "job") | .label')" = after
HUNT_SLUG=q hunt-queue -- sh -c 'test -d "$HUNT_JOB_TMP" && echo "$HUNT_JOB_TMP"' >"$T/jobtmp"
check "each job gets its own temporary directory, removed after" \
  bash -c '[[ -s $0 && ! -e $(cat "$0") ]]' "$T/jobtmp"
hunt-queue --deadline 1 -- sleep 5
check "--deadline kills a job that overruns (124)" test $? -eq 124
unset HUNT_TOKENS

echo "== hunt-git"
R=$T/repo
git init -q -b main "$R"
printf 'a\nb\nc\n' >"$R/f"
git -C "$R" add f && git -C "$R" commit -q -m base
git init -q --bare "$T/origin.git"
git -C "$R" remote add origin "$T/origin.git"
git -C "$R" push -q origin main
mkdir -p "$S/g"
jq -n --arg p "$R" '{topic:"demo", matrix:[{id:"c1", repo:"r"}], thresholds:{cap:3},
  repos:{r:{path:$p, forge:"local", owned:true, base:"main", mr_target:"main"}}}' >"$S/g/scope.json"
hunt-ledger init g >/dev/null
check "integ-init creates the integration worktree on hunt/g" hunt-git g r integ-init main
base_tip=$(hunt-git g r tip)
check "worktree-add fix-1 cuts the flat branch hunt-fix/g/1" hunt-git g r worktree-add fix-1 hunt/g
check "the fix branch exists" git -C "$R" show-ref --verify --quiet refs/heads/hunt-fix/g/1
printf 'a\nB1\nc\n' >"$T/wt/repo-hunt-g-fix-1/f"
check "commit in a hunt worktree" hunt-git g r commit fix-1 "fix: b (#1)"
hunt-git g r worktree-add fix-2 "$base_tip" >/dev/null
printf 'a\nB2\nc\n' >"$T/wt/repo-hunt-g-fix-2/f"
hunt-git g r commit fix-2 "fix: b differently (#2)" >/dev/null
check "integrate fast-forwards the tip" hunt-git g r integrate hunt-fix/g/1
tip1=$(hunt-git g r tip)
check "the tip moved" test "$tip1" != "$base_tip"
hunt-git g r integrate hunt-fix/g/2 >/dev/null 2>&1
check "a conflicting integration fails (exit 1)" test $? -eq 1
check "after it, the tip is unchanged (all or nothing)" test "$(hunt-git g r tip)" = "$tip1"
check "the integration worktree is clean, on hunt/g, nothing in progress" bash -c '
  w=$0; [[ -z $(git -C "$w" status --porcelain) ]] && [[ $(git -C "$w" symbolic-ref --short HEAD) == hunt/g ]] \
  && [[ ! -d $(git -C "$w" rev-parse --absolute-git-dir)/rebase-merge ]]' "$T/wt/repo-hunt-g"
hunt-git g r worktree-add sha-1 "$tip1" >/dev/null
check "sha-<k> worktrees are detached" test "$(git -C "$T/wt/repo-hunt-g-sha-1" symbolic-ref -q HEAD || echo detached)" = detached
check "worktree-remove" bash -c 'hunt-git g r worktree-remove sha-1 && [[ ! -e $0 ]]' "$T/wt/repo-hunt-g-sha-1"
check "witness-branch names a witness commit hunt-w/g/<N>" \
  bash -c '[[ $(hunt-git g r witness-branch 7 "$0") == hunt-w/g/7 ]] && hunt-git g r witness-branch 7 "$0"' "$tip1"
hunt-git g r witness-branch 7 "$base_tip" >/dev/null 2>&1
check "witness-branch never moves an existing branch (exit 1)" test $? -eq 1
check "branch-delete removes a hunt-w branch" \
  bash -c 'hunt-git g r branch-delete hunt-w/g/7 && ! git -C "$0" show-ref --quiet refs/heads/hunt-w/g/7' "$R"
hunt-git g r branch-delete main >/dev/null 2>&1
check "branch-delete refuses a branch outside the hunt" test $? -eq 1
check "bundle writes a verified tip.bundle" bash -c 'hunt-git g r bundle >/dev/null && git bundle list-heads "$0" | grep -q hunt/g' "$S/g/tip.bundle"
check "reset-tip back to an ancestor" bash -c 'hunt-git g r reset-tip "$0" >/dev/null && [[ $(hunt-git g r tip) == "$0" ]]' "$base_tip"
hunt-git g r reset-tip "$(git -C "$T/wt/repo-hunt-g-fix-2" rev-parse HEAD)" >/dev/null 2>&1
check "reset-tip refuses a SHA that is not an ancestor" test $? -eq 1

echo "== hunt-forge (local)"
n1=$(hunt-forge g r issue-create --title "bug one" --body "observed / expected" --nonce n-1 --label hunt:g)
n1b=$(hunt-forge g r issue-create --title "bug one" --body "observed / expected" --nonce n-1 --label hunt:g)
check "issue-create is idempotent on its nonce" test "$n1" = 1 -a "$n1b" = 1
check "issue-find-nonce finds it" test "$(hunt-forge g r issue-find-nonce n-1)" = 1
hunt-forge g r issue-find-nonce n-none >/dev/null
check "issue-find-nonce exits 1 when absent" test $? -eq 1
check "the body carries hunt-nonce" bash -c 'hunt-forge g r issue-list | jq -e ".[0].body | contains(\"hunt-nonce: n-1\")" >/dev/null'
hunt-forge g r issue-label 1 --add hunt:fixed-local
check "issue-label adds" test "$(hunt-forge g r issue-list --label hunt:fixed-local | jq length)" -eq 1
hunt-forge g r issue-create --title x >/dev/null 2>&1
check "issue-create without --nonce is a usage error" test $? -eq 2

echo "== hunt-push"
hunt-push g >/dev/null 2>&1
check "hunt-push refuses without a pass (exit 1)" test $? -eq 1
check "no converged event after a refusal" test -z "$(hunt-ledger read g | jq -r 'select(.kind == "converged")')"
hunt-git g r integrate hunt-fix/g/1 >/dev/null
printf 'a\nB1\nc\nd\n' >"$T/wt/repo-hunt-g-fix-1/f"
hunt-git g r commit fix-1 "fixup! fix: b (#1)" >/dev/null
hunt-git g r integrate hunt-fix/g/1 >/dev/null
frozen=$(hunt-git g r tip)
hunt-ledger append g forge-done '{"op":"issue-create","repo":"r","issue":1,"nonce":"n-1"}' >/dev/null
hunt-ledger append g pass-start "{\"n\":1,\"sha\":{\"r\":\"$frozen\"},\"cells_total\":1}" >/dev/null
hunt-push g >/dev/null 2>&1
check "hunt-push refuses while a cell has no verdict and the counter is not 0" test $? -eq 1
hunt-ledger append g verdict '{"pass":1,"cell":"c1","repo":"r","result":"clean","witness":"h"}' >/dev/null
hunt-ledger append g codex '{"repo":"r","issue":1,"result":"pending"}' >/dev/null
hunt-ledger append g label '{"repo":"r","issue":1,"label":"fixed-local"}' >/dev/null
hunt-push g >/dev/null 2>&1
check "hunt-push refuses while a Codex review is pending" test $? -eq 1
hunt-ledger append g codex '{"repo":"r","issue":1,"result":"done"}' >/dev/null
check "hunt-push pushes once converged" hunt-push g
pushed=$(git -C "$T/origin.git" rev-parse refs/heads/hunt/g 2>/dev/null)
check "the remote has hunt/g" test -n "$pushed"
check "the pushed tree is the frozen tree" git -C "$R" diff --quiet "$frozen" "$pushed"
check "the fixup! commit was squashed" test "$(git -C "$R" log --format=%s main.."$pushed" | grep -c fixup)" -eq 0
check "converged, push and mr-opened are in the ledger" \
  test "$(hunt-ledger read g | jq -rs '[.[] | select(.kind | IN("converged","push","mr-opened")) | .kind] | join(",")')" = converged,push,mr-opened
check "the MR closes the fixed issue" grep -q 'Closes #1' <(jq -r .body "$S/g/forge-local/r/mrs/1.json")
check "the issue moved to hunt:fixed" test "$(hunt-forge g r issue-list | jq -r '.[0].labels | index("hunt:fixed") != null')" = true
check "state is awaiting-merge" test "$(jq -r .state "$S/g/status.json")" = awaiting-merge
check "a second hunt-push is idempotent" hunt-push g
check "still one MR" test "$(ls "$S/g/forge-local/r/mrs" | wc -l)" -eq 1
check "hunt-push leaves no push token behind" test ! -e "$S/g/.push-token"
hunt-push g --repin >/dev/null 2>&1
check "--repin with no dependency has nothing to do" test $? -eq 0

echo "== hunt-status"
check "the table renders" bash -c 'hunt-status g | grep -q "Compteur"'
check "--json is status.json" test "$(hunt-status g --json | jq -S .)" = "$(jq -S . "$S/g/status.json")"
mkdir -p "$S/v99"; echo '{"matrix":[]}' >"$S/v99/scope.json"
cp "$HERE/fixtures/status-v99.json" "$S/v99/status.json"
hunt-status v99 >/dev/null 2>&1
check "an unknown format version is refused" test $? -eq 1
cp "$HERE/fixtures/status-torn.json" "$S/v99/status.json"
hunt-status v99 >/dev/null 2>&1
check "a torn status.json is refused" test $? -eq 1
cp "$HERE/fixtures/status-v1.json" "$S/v99/status.json"
check "the v1 fixture renders" bash -c 'hunt-status v99 | grep -q "Décisions"'
shape='def shape: [paths | select(all(.[]; type == "string")) | join(".")]
         | map(select(test("^(pause|busy|codex\\.by_issue)\\.") | not)) | sort; shape'
check "the v1 fixture has the shape hunt-ledger writes" \
  test "$(jq -c "$shape" "$HERE/fixtures/status-v1.json")" = "$(jq -c "$shape" "$S/g/status.json")"
check "the v1 fixture is at most 16 KiB" test "$(wc -c <"$HERE/fixtures/status-v1.json")" -le 16384
check "--install-watchdog writes a service and a timer" \
  bash -c 'hunt-status --install-watchdog >/dev/null && [[ -f $HOME/.config/systemd/user/hunt-watchdog.timer ]] \
           && grep -q -- "--watchdog" "$HOME/.config/systemd/user/hunt-watchdog.service"'
check "--remove-watchdog removes them" \
  bash -c 'hunt-status --remove-watchdog && [[ ! -e $HOME/.config/systemd/user/hunt-watchdog.timer ]]'
mkdir -p "$S/wd"; echo "$DEFAULT_SCOPE" >"$S/wd/scope.json"
sleep 30 & gone=$!
HUNT_OWNER_PID=$gone hunt-ledger init wd >/dev/null
hunt-ledger owner wd --set-state hunting
kill "$gone"; wait "$gone" 2>/dev/null
before=$(jq -r '.hunts[] | select(.slug == "wd") | .beat' "$S/active.json")
hunt-status --watchdog
check "the watchdog flags a dead owner with a stall event" \
  test "$(hunt-ledger read wd | jq -r 'select(.kind == "stall") | .reason')" = owner-dead
check "the watchdog stamps watch but never beat" \
  test "$(jq -r '.hunts[] | select(.slug == "wd") | "\(.beat) \(.watch > 0)"' "$S/active.json")" = "$before true"
hunt-status --watchdog
check "a second watchdog run does not repeat the stall" test "$(hunt-ledger read wd | jq -c 'select(.kind == "stall")' | wc -l)" -eq 1

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
