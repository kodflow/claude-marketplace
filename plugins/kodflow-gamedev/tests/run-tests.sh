#!/bin/bash
# run-tests.sh — kodflow-gamedev's own suite. No claude CLI, no network, no
# project: every input is synthetic (tests/fixtures, or built in a tempdir).
# Runs under bash 3.2 (macOS /bin/bash) and bash 5; CI's guard job finds it.
#
#   1. layout: 13 agents, 4 skills, the martial six experimental, executable
#      scripts, every `_shared/…` reference of a skill or agent resolving.
#   2. the Python scripts (test_scripts.py), on Python 3.9 when present.
#   3. the fixtures are what gen_tracks.py writes; the sound set passes; each
#      of the three reference defects is caught by its own constraints only.
#   4. rules-digest.sh: ok / truncated / unavailable, the area filter, read
#      only, ten at once give ten identical answers, fails open.
#   5. sample-threejs.mjs on a synthetic adapter, when node is there.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
PLUG=$(cd "$HERE/.." && pwd)
SH=$PLUG/skills/_shared
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "${2:-}"; }
PY=python3
command -v python3.9 >/dev/null 2>&1 && PY=python3.9

echo "== layout"
n=$(ls "$PLUG"/agents/*.md | wc -l | tr -d ' ')
[ "$n" -eq 13 ] && ok "13 agents" || bad "13 agents" "$n"
n=$(ls "$PLUG"/skills/*/SKILL.md | wc -l | tr -d ' ')
[ "$n" -eq 4 ] && ok "4 skills" || bad "4 skills" "$n"
for a in europe antiquity south-asia east-asia southeast-asia unarmed; do
    f=$PLUG/agents/martial-specialist-$a.md
    sed -n '2,/^---$/p' "$f" | grep -qx 'experimental: true' && ok "martial-specialist-$a is experimental" \
        || bad "martial-specialist-$a is experimental" "$f"
done
for f in $(ls "$PLUG"/agents/*.md | grep -v martial-specialist-); do
    sed -n '2,/^---$/p' "$f" | grep -q '^experimental:' && bad "$(basename "$f") is not experimental" || ok "$(basename "$f" .md) is not experimental"
done
for f in "$PLUG"/hooks/scripts/rules-digest.sh "$SH"/scripts/*.py "$SH"/scripts/sample-threejs.mjs "$HERE"/run-tests.sh; do
    [ -x "$f" ] && ok "executable: ${f#"$PLUG"/}" || bad "executable: ${f#"$PLUG"/}"
done
# Every reference to a shared file, in any skill or agent, resolves (any
# extension): an agent told to read a file the plugin does not ship reads nothing.
refs=$(cat "$PLUG"/skills/*/SKILL.md "$PLUG"/agents/*.md "$SH"/*.md \
    | grep -oE '_shared/[A-Za-z0-9_./-]*[A-Za-z0-9_]\.(md|json|py|mjs|gd|txt)' | sort -u)
nref=0
while IFS= read -r r; do
    [ -n "$r" ] || continue
    nref=$((nref+1))
    [ -e "$PLUG/skills/$r" ] || bad "reference resolves: $r"
done <<EOF
$refs
EOF
[ "$nref" -gt 5 ] && ok "$nref _shared references, every one resolves" || bad "few _shared references" "$nref"
python3 -c 'import json,sys; [json.load(open(p)) for p in sys.argv[1:]]' "$SH"/*.json "$SH"/templates/*.json "$PLUG"/hooks/hooks.json \
    "$PLUG"/.claude-plugin/plugin.json && ok "every JSON file parses" || bad "JSON parses"
grep -q '"matcher": "^kodflow-gamedev:"' "$PLUG/hooks/hooks.json" && ok "the hook fires for this plugin's agents only" || bad "hook matcher"

echo "== Python scripts ($($PY --version 2>&1))"
for f in "$SH"/scripts/*.py "$HERE"/test_scripts.py "$HERE"/fixtures/gen_tracks.py; do
    $PY -I -c 'import ast,sys; ast.parse(open(sys.argv[1]).read(), feature_version=(3, 9))' "$f" 2>/dev/null \
        && ok "parses as Python 3.9: ${f##*/}" || bad "parses as Python 3.9: ${f##*/}"
done
out=$($PY -I "$HERE/test_scripts.py" 2>&1) && ok "test_scripts.py" || bad "test_scripts.py" "$(printf '%s' "$out" | tail -30)"

echo "== fixtures and the three reference defects"
$PY -I "$HERE/fixtures/gen_tracks.py" "$T/gen" >/dev/null
same=1
for f in "$T"/gen/*.pose.json; do cmp -s "$f" "$HERE/fixtures/${f##*/}" || { same=0; bad "fixture matches gen_tracks.py: ${f##*/}"; }; done
[ "$same" = 1 ] && ok "committed fixtures are what gen_tracks.py writes"
CK="$PY -I $SH/scripts/check-constraints.py --constraints $HERE/fixtures/synthetic.constraints.json"
F=$HERE/fixtures
judge() {   # $1 label, $2 expected rc, $3 expected hard failures (space-separated, sorted), tracks...
    local label=$1 rc_want=$2 want=$3; shift 3
    local args="" t out rc got
    for t in "$@"; do args="$args --track $F/$t.pose.json"; done
    out=$($CK $args --json 2>&1); rc=$?
    got=$(printf '%s' "$out" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(" ".join(sorted(r["hard_failed"])), r["evaluated"], r["total"])' 2>/dev/null)
    if [ "$rc" -eq "$rc_want" ] && [ "$got" = "$want 9 9" ]; then
        ok "$label"
    else
        bad "$label" "rc=$rc got='$got' want='$want 9 9'"
    fi
}
judge "the sound set passes, 9/9 evaluated" 0 "" run_ok cut_ok grip_ok
judge "defect 1 (run: hand and blade beat) caught, nothing else" 1 "run-hand-steady run-tip-steady" run_flail cut_ok grip_ok
judge "defect 2 (cut reads as a stab) caught, nothing else" 1 "cut-edge-leads cut-shoulder-lever" run_ok cut_stab grip_ok
judge "defect 3 (right hand reads as a left one) caught, nothing else" 1 "grip-fingers-wrap grip-handedness grip-index-toward-blade" run_ok cut_ok grip_mirror
out=$($CK --track "$F/run_ok.pose.json" 2>&1); rc=$?
[ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'only 2/9 evaluated' && ok "clips not sampled are unevaluated, and that fails" \
    || bad "unevaluated fails" "rc=$rc $out"

echo "== rules-digest.sh"
HOOK=$PLUG/hooks/scripts/rules-digest.sh
FR="$PY -I $SH/scripts/feedback-rules.py"
PROJ=$T/proj; mkdir -p "$PROJ/docs/adr/feedback"
git -C "$PROJ" init -q 2>/dev/null
ctx() {   # $1 agent type → the additionalContext the hook prints
    printf '{"hook_event_name":"SubagentStart","agent_type":"%s","cwd":"%s"}' "$1" "$PROJ" \
        | CLAUDE_PROJECT_DIR=$PROJ bash "$HOOK" \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["hookSpecificOutput"]["additionalContext"])'
}
adr() {   # $1 name, $2 rule, $3 scope JSON list, $4 constraint JSON
    printf '# x\n\n```json\n{"schema":"feedback-adr/v1","verdict":"bad","rule":"%s","scope":%s,"supersedes":[],"reach":"project","subject":{"spec":"s","constraints_sha256":null,"clip":"c","commit":"x","credits":[]},"constraint":%s}\n```\n\n## Observed\n\n> mots du propriétaire\n' \
        "$2" "$3" "$4" > "$PROJ/docs/adr/feedback/$1"
}
c=$(ctx kodflow-gamedev:anatomy-specialist-biomechanics)
printf '%s' "$c" | head -1 | grep -qE '^RULES digest: ok [0-9a-f]{64}$' && ok "no ADR yet: ok, with the empty set's hash" || bad "no ADR" "$c"
adr 20261030-100000-run-aaaa.md "Garder la main d'épée immobile pendant la course." '["move:run","area:locomotion"]' \
    '{"kind":"frame_pose","measured":0.3,"threshold":{"stat":"peak_to_peak","max":0.08},"status":"confirmed"}'
adr 20261030-110000-cut-bbbb.md "Never let a cut travel along the blade." '["move:cut","area:craft"]' '"unmeasured"'
adr 20261030-120000-any-cccc.md "Name every technique in its own language." '["move:any"]' '"unmeasured"'
c=$(ctx kodflow-gamedev:anatomy-specialist-biomechanics)
printf '%s' "$c" | head -1 | grep -q '^RULES digest unavailable: read docs/adr/feedback/ yourself$' \
    && printf '%s' "$c" | grep -q '20261030-120000-any-cccc.md' && ok ".RULES.md absent: unavailable, and the raw list" || bad "absent" "$c"
$FR build --root "$PROJ" >/dev/null
want=$($FR hash --root "$PROJ")
c=$(ctx kodflow-gamedev:anatomy-specialist-biomechanics)
printf '%s' "$c" | head -1 | grep -qx "RULES digest: ok $want" && ok "current: ok and the same hash as feedback-rules.py" || bad "current" "$c / $want"
printf '%s' "$c" | grep -q "immobile" && printf '%s' "$c" | grep -q "own language" && ! printf '%s' "$c" | grep -q "along the blade" \
    && ok "anatomy gets its area and the untagged rule, not craft's" || bad "area filter" "$c"
printf '%s' "$c" | grep -q "pending: 3 feedback ADR" && ok "the ADRs not committed are counted" || bad "pending" "$c"
c=$(ctx kodflow-gamedev:gamedev-animation-director)
printf '%s' "$c" | grep -q "along the blade" && printf '%s' "$c" | grep -q "immobile" && ok "the director gets every rule" || bad "director" "$c"
hard=$(printf '%s' "$c" | grep -n "immobile" | cut -d: -f1); adv=$(printf '%s' "$c" | grep -n "own language" | cut -d: -f1)
[ "${hard:-99}" -lt "${adv:-0}" ] && ok "hard rules come before advisory ones" || bad "order" "$c"
before=$(cd "$PROJ" && find . -path ./.git -prune -o -type f -print | sort | xargs shasum -a 256 2>/dev/null | shasum -a 256)
for i in 1 2 3 4 5 6 7 8 9 10; do ctx kodflow-gamedev:martial-specialist-europe > "$T/par.$i" & done; wait
after=$(cd "$PROJ" && find . -path ./.git -prune -o -type f -print | sort | xargs shasum -a 256 2>/dev/null | shasum -a 256)
[ "$before" = "$after" ] && ok "the hook writes nothing" || bad "read-only"
u=$(cat "$T"/par.* | sort -u | shasum -a 256); one=$(sort -u "$T/par.1" | shasum -a 256)
[ "$u" = "$one" ] && [ -s "$T/par.1" ] && ok "ten hooks at once print the same lines" || bad "parallel" "$(head -3 "$T"/par.*)"
adr 20261030-130000-new-dddd.md "A newer rule." '[]' '"unmeasured"'
c=$(ctx kodflow-gamedev:anatomy-specialist-biomechanics)
printf '%s' "$c" | head -1 | grep -q '^RULES digest unavailable' && printf '%s' "$c" | grep -q '\.RULES\.md is stale' \
    && ok "an ADR added after build: stale, unavailable" || bad "stale" "$c"
long=$(printf 'Règle numéro %s, assez longue pour remplir le budget de deux mille caractères du digest. ' 1 2 3 4)
for i in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20; do
    adr "20261031-1000$i-long-$(printf '%04x' "$((10#$i))").md" "$long$i" '["area:anatomy"]' '"unmeasured"'
done
$FR build --root "$PROJ" >/dev/null
c=$(ctx kodflow-gamedev:anatomy-specialist-biomechanics)
first=$(printf '%s' "$c" | head -1)
printf '%s' "$first" | grep -qE "^RULES digest: truncated [0-9]+/2[0-9], read $PROJ/docs/adr/feedback/.RULES.md$" \
    && ok "over budget: truncated n/total, with the absolute path" || bad "truncated" "$first"
nchar=$(printf '%s' "$c" | python3 -c 'import sys; print(len(sys.stdin.read()))')
[ "$nchar" -le 2000 ] && ok "the digest stays within 2000 characters ($nchar)" || bad "budget" "$nchar"
printf '%s' "$c" | python3 -c 'import sys; sys.stdin.buffer.read().decode("utf-8")' && ok "no character cut in half" || bad "utf-8"
out=$(cd "$T" && printf 'garbage' | CLAUDE_PROJECT_DIR=$T/nowhere bash "$HOOK"); rc=$?
[ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'RULES digest unavailable' && ok "garbage in, fails open with unavailable" || bad "fail open" "rc=$rc $out"

echo "== sample-threejs.mjs"
if command -v node >/dev/null 2>&1; then
    cat > "$T/adapter.mjs" <<'EOF'
export const clips = () => ["swing"];
export const meta = () => ({ duration: 0.5, markers: { impact: 0.6 } });
export const rest = () => ({ nodes: { Arm: { p: [0, 1, 0], q: [0, 0, 0, 1] } } });
export function sampleWorld(clip, t) {
  const a = (Math.PI / 2) * (t / 0.5), s = Math.sin(a / 2), c = Math.cos(a / 2);
  return { nodes: { Arm: { p: [0, 1, 0], q: [0, 0, s, c] } }, points: { Tip: [Math.cos(a), 1 + Math.sin(a), 0] } };
}
EOF
    printf '{"bones":{"arm":"Arm"},"props":{},"landmarks":{"hand":{"node":"Arm","offset":[1,0,0]},"tip":{"point":"Tip"},"gone":{"node":"Nope","offset":[0,0,0]}}}' > "$T/rig.json"
    out=$(node "$SH/scripts/sample-threejs.mjs" --adapter "$T/adapter.mjs" --rig-map "$T/rig.json" --clip swing --fps 10 --out "$T/swing.json" 2>&1)
    r=$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1])); f=d["frames"]
print(d["schema_version"], len(f), d["markers"]["impact"], "gone" in f[0]["landmarks"], "rest" in d,
      [round(float(x),3) for x in f[-1]["landmarks"]["hand"]], [round(float(x),3) for x in f[-1]["landmarks"]["tip"]])' "$T/swing.json" 2>&1)
    [ "$r" = "pose-track/v1 6 0.6 False True [0.0, 2.0, 0.0] [0.0, 2.0, 0.0]" ] \
        && ok "an adapter's nodes and points become logical bones and landmarks (offset rotated)" || bad "sampler" "$out / $r"
    out=$(node "$SH/scripts/sample-threejs.mjs" --adapter "$T/adapter.mjs" --rig-map "$T/rig.json" --clip nope --out "$T/x.json" 2>&1); rc=$?
    [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'no clip nope' && ok "an unknown clip is refused by name" || bad "unknown clip" "$out"
else
    echo "  skip node not found: sample-threejs.mjs not exercised"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
