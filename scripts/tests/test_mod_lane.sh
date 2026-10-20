#!/usr/bin/env bash
# The mod lanes' scripts, against a fake engine and a fake gh
# (kodflow/ktn-linter#788): no Claude Code, no network, no GitHub.
#
#   scripts/mod-lane.sh          neutral on "turned off", red without the
#                                precondition, red on a broken engine and on a
#                                failing mod
#   scripts/mod-latest-issue.sh  one issue for two runs on the same gap
#   scripts/mod-surface.py gap   only the surface, the findings and the verdict
#   scripts/ci-gates-check.py    each refusal planted once
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/mod-lane-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
ko() { fail=$((fail + 1)); echo "FAIL $1"; }

# --- a fake engine: FAKE_ENGINE says how `claude plugin test` answers ----------
cat > "$work/claude" <<'EOF'
#!/usr/bin/env bash
# off: hooks modules turned off; broken: any other failure; modfail: the probe
# passes and the mod's suite fails; ok: everything passes.
target="${3:-}"
case "$FAKE_ENGINE" in
  off) echo "claude plugin test: hooks modules are turned off (disableAllHooks)"; exit 1 ;;
  broken) echo "claude plugin test: internal error"; exit 1 ;;
  modfail) case "$target" in */mod-lane/probe) echo "1 pass"; exit 0 ;; *) echo "1 fail"; exit 1 ;; esac ;;
  ok) echo "1 pass"; exit 0 ;;
esac
exit 2
EOF
chmod +x "$work/claude"
lane() { CLAUDE_BIN="$work/claude" FAKE_ENGINE="$1" bash "$root/scripts/mod-lane.sh" "$root/plugins/kodflow-ktn"; }

out="$(lane off)"; rc=$?
[ "$rc" -eq 0 ] && grep -q '^::warning::hooks modules are turned off' <<<"$out" && [ "$(tail -n1 <<<"$out")" = neutral ] \
  && ok "turned off: the lane ends neutral, with an annotation" || ko "turned off: rc=$rc out=$out"

out="$(MOD_LANE_PRECONDITION=off lane off)"; rc=$?
[ "$rc" -ne 0 ] && ok "turned off WITHOUT the precondition: the lane is red (the fixture the precondition answers)" || ko "no precondition: rc=$rc"

out="$(lane broken)"; rc=$?
[ "$rc" -ne 0 ] && grep -q '::error::the engine failed on the probe mod' <<<"$out" && ok "an engine broken another way stays red" || ko "broken: rc=$rc"

out="$(lane modfail)"; rc=$?
[ "$rc" -ne 0 ] && [ "$(tail -n1 <<<"$out")" = fail ] && ok "a failing mod suite is red" || ko "modfail: rc=$rc"

out="$(lane ok)"; rc=$?
[ "$rc" -eq 0 ] && [ "$(tail -n1 <<<"$out")" = pass ] && ok "a passing mod suite passes" || ko "ok: rc=$rc"

# --- a fake gh: issues kept as files under $work/gh ----------------------------
mkdir -p "$work/gh"
cat > "$work/fakegh" <<'EOF'
#!/usr/bin/env bash
# The subset of gh mod-latest-issue.sh calls; each call appended to calls.log.
d="$FAKE_GH_DIR"
echo "$*" >> "$d/calls.log"
arg() { local want="$1"; shift; while [ $# -gt 0 ]; do [ "$1" = "$want" ] && { echo "$2"; return; }; shift; done; }
case "$1 $2" in
  "label create") exit 0 ;;
  "issue list") for f in "$d"/open-*; do [ -e "$f" ] && basename "$f" | sed 's/^open-//'; done; exit 0 ;;
  "issue create") n=$(( $(ls "$d" | grep -c '^body-') + 1 )); cp "$(arg --body-file "$@")" "$d/body-$n"; touch "$d/open-$n"; echo "https://example.invalid/issues/$n" ;;
  "issue view") cat "$d/body-$3" ;;
  "issue edit") cp "$(arg --body-file "$@")" "$d/body-$3" ;;
  "issue comment") echo "$3" >> "$d/comments" ;;
  "issue close") rm -f "$d/open-$3" ;;
  *) echo "fakegh: unexpected $*" >&2; exit 3 ;;
esac
EOF
chmod +x "$work/fakegh"
issue() { GH_BIN="$work/fakegh" FAKE_GH_DIR="$work/gh" bash "$root/scripts/mod-latest-issue.sh" "$@"; }
opened() { ls "$work/gh" | grep -c '^open-'; }
created() { grep -c '^issue create' "$work/gh/calls.log" 2>/dev/null || true; }

printf 'call no longer read: $.ui.toast\n' > "$work/gap1"
issue "$work/gap1" 2.1.400 >/dev/null && issue "$work/gap1" 2.1.401 >/dev/null
[ "$(opened)" -eq 1 ] && [ "$(created)" -eq 1 ] && ! grep -q '^issue edit' "$work/gh/calls.log" \
  && ok "two latest runs on the same gap: one issue opened, nothing rewritten" || ko "dedup: opened=$(opened) created=$(created)"

printf 'claude plugin test failed\n' > "$work/gap2"
issue "$work/gap2" 2.1.402 >/dev/null
[ "$(opened)" -eq 1 ] && [ "$(created)" -eq 1 ] && grep -q 'claude plugin test failed' "$work/gh/body-1" && [ -s "$work/gh/comments" ] \
  && ok "another gap rewrites the same issue and says so" || ko "changed gap"

: > "$work/gap0"
issue "$work/gap0" 2.1.403 >/dev/null
[ "$(opened)" -eq 0 ] && ok "no gap closes the rolling issue" || ko "no gap: opened=$(opened)"

# --- the gap compares the surface, the findings and the verdict, nothing else --
cat > "$work/report.json" <<'EOF'
{"manifest": {"errors": [], "warnings": [{"path": "version", "message": "No version"}], "notes": []},
 "contents": [{"errors": [{"message": "unknown event ui.frobnicate"}], "warnings": [],
   "notes": ["./mod/register.ts hooks: session.start, ui.render{component=Pane, requestId=x}, ui.scroll",
             "./mod/register.ts calls: $.clock.now, $.ui.open (via openPane)"]}]}
EOF
printf '{"events": ["session.start", "ui.render", "turn.complete"], "calls": ["$.clock.now", "$.ui.open", "$.ui.toast"]}\n' > "$work/base.json"
gap="$(python3 "$root/scripts/mod-surface.py" gap "$work/report.json" "$work/base.json" pass)"
want='call no longer read: $.ui.toast
event no longer read: turn.complete
event read but not committed: ui.scroll
validator error: unknown event ui.frobnicate'
[ "$gap" = "$want" ] && ok "the gap: findings and surface differences, the version warning left out" || ko "gap: $gap"
gap="$(python3 "$root/scripts/mod-surface.py" gap "$work/report.json" "$work/base.json" neutral | grep -c 'plugin test' || true)"
[ "$gap" -eq 0 ] && ok "a neutral engine lane is no gap" || ko "neutral counted"

# --- ci-gates-check: the repository passes, each planted refusal fails ---------
gates() { python3 "$root/scripts/ci-gates-check.py" --root "$1" --gates "mod-check" --advisory "mod-latest.yml"; }
if gates "$root" >/dev/null; then ok "ci-gates-check passes on the repository"; else ko "ci-gates-check on the repository"; gates "$root"; fi
plant() {
  local name="$1" file="$2" from="$3" to="$4" want="$5"
  rm -rf "$work/repo"; mkdir -p "$work/repo/.github"
  cp -R "$root/.github/workflows" "$work/repo/.github/"; cp "$root/Makefile" "$work/repo/"
  python3 - "$work/repo/$file" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1:4]
text = open(path).read()
assert old in text, old
open(path, "w").write(text.replace(old, new, 1))
PY
  local out
  if out="$(gates "$work/repo")"; then ko "ci-gates-check let through: $name"
  elif grep -qF "$want" <<<"$out"; then ok "ci-gates-check refuses $name"
  else ko "ci-gates-check refused $name for another reason: $out"; fi
}
plant "setup-node pinned by a tag" .github/workflows/ci.yml "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1" "actions/setup-node@v7" "pin it by a 40-character sha"
plant "an advisory workflow on pull_request" .github/workflows/mod-latest.yml "  workflow_dispatch:" "  workflow_dispatch:
  pull_request:" "advisory workflow mod-latest.yml runs on pull_request"
plant "a gate ci.yml does not run" .github/workflows/ci.yml "run: make mod-check" "run: make mod-pure" "gate mod-check is not run"
plant "a make target the Makefile lacks" .github/workflows/ci.yml "run: make mod-check" "run: make mod-check && make nowhere" "runs \`make nowhere\`"
plant "a second goal the Makefile lacks" .github/workflows/ci.yml "run: make mod-check" "run: make -C . V=1 mod-check nowhere2" "runs \`make nowhere2\`"
plant "a gate run by a step allowed to fail" .github/workflows/ci.yml "        run: make mod-check" "        continue-on-error: true
        run: make mod-check" "gate mod-check is not run"
plant "a job that needs the advisory lane" .github/workflows/kodflow-ktn-release.yml "needs: gate" "needs: [gate, mod-ktn-latest]" "needs mod-ktn-latest of the advisory"

for bad in --chek --Check; do
  if KTN_FIXTURES_DIR="$work/none" bash "$root/scripts/sync-ktn-fixtures.sh" "$bad" >/dev/null 2>&1; then ko "sync-ktn-fixtures.sh ran with $bad"
  else [ $? -eq 2 ] && ok "sync-ktn-fixtures.sh refuses the mode $bad before any work" || ko "sync-ktn-fixtures.sh $bad: wrong status"; fi
done

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
