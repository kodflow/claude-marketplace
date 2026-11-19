#!/bin/bash
# test_install.sh — install.sh installs every plugin of the manifest except
# the ones a project enables for itself (scripts/install-exclude.txt).
#
# A fake `claude` on PATH records each call, so the real install path runs
# (not only --check), under a throwaway HOME, from a copy of the files the
# installer reads (a worktree's .git file names a home path, which the
# installer's own scan refuses). The list is read from the manifest and the
# exclusion file, never repeated here: a plugin added to the manifest is
# covered, and one added to the exclusion file is held.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

mkdir -p "$T/bin" "$T/home" "$T/repo/scripts" "$T/repo/.claude-plugin" "$T/repo/mcp"
cp "$ROOT/scripts/install.sh" "$ROOT/scripts/sanitize.py" "$ROOT/scripts/install-exclude.txt" "$T/repo/scripts/"
cp "$ROOT/.claude-plugin/marketplace.json" "$T/repo/.claude-plugin/"
cp "$ROOT/mcp/mcp.example.json" "$T/repo/mcp/"
cat > "$T/bin/claude" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$CLAUDE_CALLS"
case "$*" in
  "plugin marketplace list --json") [ -z "${CLAUDE_MP_JSON:-}" ] || printf '%s\n' "$CLAUDE_MP_JSON" ;;
  "plugin list --json") [ -z "${CLAUDE_PL_JSON:-}" ] || printf '%s\n' "$CLAUDE_PL_JSON" ;;
  "plugin marketplace add "*) [ "${CLAUDE_ADD_FAIL:-}" != "${*:4}" ] || exit 1 ;;
esac
exit 0
EOF
chmod 755 "$T/bin/claude"
export CLAUDE_CALLS=$T/calls HOME=$T/home PATH="$T/bin:$PATH"

excluded=$(
    sed -e 's/#.*//' -e 's/[[:space:]]//g' "$ROOT/scripts/install-exclude.txt" | grep .
    # Opt-in entries (installByDefault: false) are never installed by default either.
    python3 -c 'import json,sys; [print(p["name"]) for p in json.load(open(sys.argv[1]))["plugins"] if p.get("installByDefault") is False]' \
        "$ROOT/.claude-plugin/marketplace.json"
)
all=$(python3 -c 'import json,sys; [print(p["name"]) for p in json.load(open(sys.argv[1]))["plugins"]]' \
    "$ROOT/.claude-plugin/marketplace.json")
[ -n "$excluded" ] && ok "the exclusion file names at least one plugin" || bad "exclusion file" "empty"

out=$(bash "$T/repo/scripts/install.sh" --claude 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "install.sh --claude exits 0" || bad "install rc" "$rc: $out"
check=$(bash "$T/repo/scripts/install.sh" --claude --check 2>&1)

while IFS= read -r p; do
    [ -n "$p" ] || continue
    if printf '%s\n' "$excluded" | grep -qxF "$p"; then
        grep -q "install $p@kodflow" "$T/calls" && bad "$p is not installed" "$(cat "$T/calls")" || ok "$p is not installed"
        printf '%s' "$out$check" | grep -q "$p" && bad "$p is not even named" "$out$check" || ok "$p is not named in the output"
    else
        grep -q "install $p@kodflow" "$T/calls" && ok "$p is installed" || bad "$p is installed" "$(cat "$T/calls")"
        printf '%s' "$check" | grep -q "would: claude plugin install $p@kodflow" && ok "--check names $p" || bad "--check names $p" "$check"
    fi
done <<EOF
$all
EOF

mkdir -p "$T/repo/.agents/plugins" "$T/repo/codex/skills/demo" "$T/repo/codex/agents"
cp "$ROOT/.agents/plugins/marketplace.json" "$T/repo/.agents/plugins/"
printf 'demo skill\n' > "$T/repo/codex/skills/demo/SKILL.md"
printf 'name = "demo"\n' > "$T/repo/codex/agents/demo.toml"
cat > "$T/bin/codex" <<'EOF'
#!/bin/bash
if [[ ${*: -1} == --help ]]; then
  [[ ${DEMO_NATIVE:-1} == 1 ]]
  exit $?
fi
printf '%s\n' "$*" >> "$CODEX_CALLS"
if [[ "$1 $2 $3" == "plugin marketplace list" ]]; then
  [[ -z ${CODEX_ROOT:-} ]] || printf 'MARKETPLACE  ROOT\nkodflow      %s\n' "$CODEX_ROOT"
  exit 0
fi
if [[ ${DEMO_OTHER_SOURCE:-0} == 1 && "$1 $2 $3" == "plugin marketplace add" ]]; then
  echo "marketplace 'kodflow' is already added from a different source" >&2
  exit 1
fi
EOF
chmod 755 "$T/bin/codex"
export CODEX_CALLS="$T/codex-calls" CODEX_HOME="$T/custom-codex"
rm -f "$CODEX_CALLS"
out=$(bash "$T/repo/scripts/install.sh" --codex --checkout --check 2>&1); rc=$?
[ "$rc" -eq 0 ] && [ ! -e "$CODEX_HOME" ] && ! grep -Eq '^plugin (add|remove)|marketplace (add|remove)' "$CODEX_CALLS" 2>/dev/null &&
  grep -q 'would: codex plugin marketplace add' <<<"$out" &&
  ok "native check reads capability without installing" ||
  bad "native check reads capability without installing" "$out"
mkdir -p "$CODEX_HOME/agents"
printf '%s\n' '# generated-from: plugins/*/agents/old.md' > "$CODEX_HOME/agents/old.toml"
printf '%s\n' 'name = "manual"' > "$CODEX_HOME/agents/manual.toml"
out=$(bash "$T/repo/scripts/install.sh" --codex --checkout 2>&1); rc=$?
[ "$rc" -eq 0 ] && grep -qxF "plugin marketplace add $T/repo" "$CODEX_CALLS" &&
  grep -qxF 'plugin add kodflow-workflow@kodflow' "$CODEX_CALLS" &&
  [ -f "$CODEX_HOME/agents/demo.toml" ] && [ ! -e "$CODEX_HOME/skills/demo" ] &&
  ok "native marketplace plus explicit role install" || bad "native install" "$out"
[ ! -e "$CODEX_HOME/agents/old.toml" ] && [ -f "$CODEX_HOME/agents/manual.toml" ] &&
  ok "native install retires obsolete generated roles only" || bad "native role retirement" "$out"
rm -f "$CODEX_CALLS"
out=$(bash "$T/repo/scripts/install.sh" --codex --legacy 2>&1); rc=$?
[ "$rc" -eq 0 ] && ! grep -Eq 'marketplace add|^plugin add' "$CODEX_CALLS" && [ -f "$CODEX_HOME/skills/demo/SKILL.md" ] &&
  ok "explicit legacy path installs flat skills" || bad "legacy install" "$out"
rm -f "$CODEX_CALLS"
out=$(DEMO_NATIVE=0 CODEX_HOME="$T/old-codex" bash "$T/repo/scripts/install.sh" --codex 2>&1); rc=$?
[ "$rc" -eq 0 ] && [ ! -e "$CODEX_CALLS" ] && [ -f "$T/old-codex/skills/demo/SKILL.md" ] &&
  ok "older client selects flat path" || bad "older client fallback" "$out"
out=$(DEMO_OTHER_SOURCE=1 CODEX_CALLS="$T/conflict-calls" CODEX_HOME="$T/conflict-home" \
  bash "$T/repo/scripts/install.sh" --codex --checkout 2>&1); rc=$?
[ "$rc" -eq 1 ] && grep -Fq 'codex plugin marketplace remove kodflow' <<<"$out" &&
  [ "$(grep -c '^plugin marketplace add' "$T/conflict-calls")" -eq 1 ] && ! grep -q '^plugin add' "$T/conflict-calls" && [ ! -e "$T/conflict-home/agents" ] &&
  ok "source conflicts leave the existing registration alone" || bad "different checkout" "$out"

# ---- helpers for the cases below
# A PATH with the tools the installer needs and neither claude, codex nor jq,
# so a case adds back exactly what it wants (and never reaches the real CLIs).
mkdir -p "$T/tools"
for t in bash env sed awk grep head tail cat mktemp rm cp mv mkdir find wc tr basename dirname \
         git python3 uname sort date ls cut readlink chmod printf; do
  src=$(command -v "$t" 2>/dev/null) && [ -x "$src" ] && ln -sf "$src" "$T/tools/$t"
done
mkdir -p "$T/only-claude" "$T/only-codex" "$T/jq"
ln -sf "$T/bin/claude" "$T/only-claude/claude"; ln -sf "$T/bin/codex" "$T/only-codex/codex"
ln -sf "$(command -v jq)" "$T/jq/jq"
fresh_home() { rm -rf "$T/h"; mkdir -p "$T/h"; printf '%s' "$T/h"; }
no_state() { rm -f "$CLAUDE_CALLS" "$CODEX_CALLS"; }

# ---- check mode never claims a change
no_state
out=$(HOME=$(fresh_home) CODEX_HOME="$T/h/codex" PATH="$T/only-claude:$T/only-codex:$T/tools" \
  bash "$T/repo/scripts/install.sh" --check --checkout 2>&1); rc=$?
if [ "$rc" -eq 0 ] && ! grep -Eiq 'installed|registered|seeded' <<<"$out" &&
   grep -q 'would:' <<<"$out"; then
  ok "--check prints only would:/state lines (no installed/registered/seeded)"
else bad "--check wording" "rc=$rc $out"; fi
# a state read from the CLI is shown, still without the forbidden words
no_state
out=$(HOME=$(fresh_home) CLAUDE_PL_JSON='[{"id":"kodflow-workflow@kodflow"}]' \
  CLAUDE_MP_JSON='[{"name":"kodflow","source":"directory","path":"/elsewhere"}]' \
  PATH="$T/only-claude:$T/tools:$T/jq" bash "$T/repo/scripts/install.sh" --claude --check --checkout 2>&1); rc=$?
if [ "$rc" -eq 0 ] && grep -q 'state: kodflow-workflow present' <<<"$out" &&
   grep -q 'would: claude plugin marketplace remove --scope user kodflow' <<<"$out" &&
   ! grep -Eiq 'installed|registered|seeded' <<<"$out" && ! grep -Eq 'marketplace (remove|add)' "$CLAUDE_CALLS"; then
  ok "--check reads the Claude state and mutates nothing"
else bad "--check Claude state" "rc=$rc $out $(cat "$CLAUDE_CALLS")"; fi

# ---- --claude --codex means both
no_state
out=$(HOME=$(fresh_home) CODEX_HOME="$T/h/codex" PATH="$T/only-claude:$T/only-codex:$T/tools" \
  bash "$T/repo/scripts/install.sh" --claude --codex --checkout 2>&1); rc=$?
[ "$rc" -eq 0 ] && grep -q 'plugin install' "$CLAUDE_CALLS" && grep -q '^plugin add' "$CODEX_CALLS" &&
  ok "--claude --codex installs on both sides" || bad "--claude --codex" "rc=$rc $out"

# ---- a CLI named explicitly must exist
no_state
out=$(HOME=$(fresh_home) PATH="$T/only-claude:$T/tools" bash "$T/repo/scripts/install.sh" --codex --checkout 2>&1); rc=$?
[ "$rc" -ne 0 ] && grep -q 'codex' <<<"$out" && ok "--codex without the codex CLI exits non-zero" || bad "--codex absent" "rc=$rc $out"
out=$(HOME=$(fresh_home) PATH="$T/only-codex:$T/tools" bash "$T/repo/scripts/install.sh" --claude 2>&1); rc=$?
[ "$rc" -ne 0 ] && ok "--claude without the claude CLI exits non-zero" || bad "--claude absent" "rc=$rc $out"
out=$(HOME=$(fresh_home) PATH="$T/only-claude:$T/tools" bash "$T/repo/scripts/install.sh" --checkout 2>&1); rc=$?
[ "$rc" -eq 0 ] && grep -q 'codex CLI not found' <<<"$out" && ok "no side named: an absent CLI is skipped" || bad "implicit skip" "rc=$rc $out"

# ---- the secret scan cannot be skipped by losing python3
mkdir -p "$T/nopy"; for t in "$T"/tools/*; do [ "$(basename "$t")" = python3 ] || ln -sf "$(readlink "$t")" "$T/nopy/$(basename "$t")"; done
out=$(HOME=$(fresh_home) PATH="$T/only-claude:$T/nopy" bash "$T/repo/scripts/install.sh" --claude 2>&1); rc=$?
[ "$rc" -ne 0 ] && grep -q python3 <<<"$out" && ok "no python3: install refuses (scan skipped is an error)" || bad "no python3" "rc=$rc $out"
out=$(HOME=$(fresh_home) PATH="$T/only-claude:$T/nopy" bash "$T/repo/scripts/install.sh" --claude --check 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "no python3: --check only reports it" || bad "no python3 check" "rc=$rc $out"

# ---- installByDefault:false is never installed, with jq and without
mkdir -p "$T/nd/scripts" "$T/nd/.claude-plugin" "$T/nd/mcp"
cp "$ROOT/scripts/install.sh" "$ROOT/scripts/sanitize.py" "$T/nd/scripts/"
: > "$T/nd/scripts/install-exclude.txt"; cp "$ROOT/mcp/mcp.example.json" "$T/nd/mcp/"
cat > "$T/nd/.claude-plugin/marketplace.json" <<'EOF'
{
  "name": "kodflow",
  "plugins": [
    {"author": {"name": "kodflow"}, "installByDefault": false, "name": "kodflow-off-first", "source": "./a"},
    {
      "author": {
        "name": "kodflow"
      },
      "name": "kodflow-off-last",
      "source": "./b",
      "installByDefault": false
    },
    {"author": {"name": "kodflow"}, "name": "kodflow-on", "source": "./c"},
    {"author": {"name": "kodflow"}, "installByDefault": true, "name": "kodflow-explicit-on", "source": "./d"}
  ]
}
EOF
for variant in jq nojq; do
  no_state
  if [ "$variant" = jq ]; then P="$T/only-claude:$T/tools:$T/jq"; else P="$T/only-claude:$T/tools"; fi
  out=$(HOME=$(fresh_home) PATH="$P" bash "$T/nd/scripts/install.sh" --claude --checkout 2>&1); rc=$?
  got=$(grep '^plugin install' "$CLAUDE_CALLS" | sort | tr '\n' ' ')
  want='plugin install kodflow-explicit-on@kodflow plugin install kodflow-on@kodflow '
  [ "$rc" -eq 0 ] && [ "$got" = "$want" ] && ok "installByDefault:false excluded ($variant)" ||
    bad "installByDefault ($variant)" "rc=$rc got=[$got] $out"
done

# ---- native after flat: the marked flat skills go, a user's own stays
no_state
CH="$T/native-after-flat"; mkdir -p "$CH/skills/old" "$CH/skills/mine"
printf '%s\n' '<!-- generated-from: plugins/*/skills/old/SKILL.md -->' > "$CH/skills/old/SKILL.md"
printf 'my own skill\n' > "$CH/skills/mine/SKILL.md"
out=$(HOME=$(fresh_home) CODEX_HOME="$CH" PATH="$T/only-codex:$T/tools" bash "$T/repo/scripts/install.sh" --codex --checkout --check 2>&1)
[ -d "$CH/skills/old" ] && grep -q 'would: retire flat skill old' <<<"$out" && ok "--check announces the flat skill retirement, removes nothing" || bad "check flat" "$out"
out=$(HOME=$(fresh_home) CODEX_HOME="$CH" PATH="$T/only-codex:$T/tools" bash "$T/repo/scripts/install.sh" --codex --checkout 2>&1); rc=$?
[ "$rc" -eq 0 ] && [ ! -e "$CH/skills/old" ] && [ -f "$CH/skills/mine/SKILL.md" ] &&
  ok "native install retires marked flat skills and keeps the user's" || bad "native after flat" "rc=$rc $out"

# ---- legacy after native: native plugins are removed before the flat copy
no_state
CH="$T/legacy-after-native"
out=$(HOME=$(fresh_home) CODEX_HOME="$CH" PATH="$T/only-codex:$T/tools:$T/jq" bash "$T/repo/scripts/install.sh" --codex --legacy 2>&1); rc=$?
names=$(jq -r '.plugins[].name' "$T/repo/.agents/plugins/marketplace.json")
miss=0; for p in $names; do grep -qxF "plugin remove $p@kodflow" "$CODEX_CALLS" || miss=1; done
[ "$rc" -eq 0 ] && [ "$miss" -eq 0 ] && [ -f "$CH/skills/demo/SKILL.md" ] && ! grep -q 'marketplace add' "$CODEX_CALLS" &&
  ok "--legacy removes every native plugin, then copies flat" || bad "legacy after native" "rc=$rc miss=$miss $out $(cat "$CODEX_CALLS")"

# ---- Git-pinned Codex registration (clean checkout), verified afterwards
mkdir -p "$T/g/scripts" "$T/g/.agents/plugins" "$T/g/codex/agents" "$T/g/mcp"
cp "$ROOT/scripts/install.sh" "$ROOT/scripts/sanitize.py" "$ROOT/scripts/install-exclude.txt" "$T/g/scripts/"
cp "$ROOT/.agents/plugins/marketplace.json" "$T/g/.agents/plugins/"; cp "$ROOT/mcp/mcp.example.json" "$T/g/mcp/"
mkdir -p "$T/g/.claude-plugin"; cp "$ROOT/.claude-plugin/marketplace.json" "$T/g/.claude-plugin/"
git -C "$T/g" init -q && git -C "$T/g" add -A &&
  git -C "$T/g" -c user.name=t -c user.email=t@example.invalid commit -q -m init
SHA=$(git -C "$T/g" rev-parse HEAD)
no_state
out=$(HOME=$(fresh_home) CODEX_HOME="$T/h/codex" CODEX_ROOT="$T/g" PATH="$T/only-codex:$T/tools" bash "$T/g/scripts/install.sh" --codex 2>&1); rc=$?
[ "$rc" -eq 0 ] && grep -qxF "plugin marketplace add kodflow/claude-marketplace --ref $SHA" "$CODEX_CALLS" &&
  ok "Codex is registered from the Git source pinned to HEAD" || bad "pinned add" "rc=$rc $out $(cat "$CODEX_CALLS")"
no_state
out=$(HOME=$(fresh_home) CODEX_HOME="$T/h/codex" CODEX_ROOT="$T/repo" PATH="$T/only-codex:$T/tools" bash "$T/g/scripts/install.sh" --codex 2>&1); rc=$?
[ "$rc" -ne 0 ] && grep -q 'pinned revision' <<<"$out" && ! grep -q '^plugin add' "$CODEX_CALLS" &&
  ok "a registration not at the pinned revision is an error" || bad "pin mismatch" "rc=$rc $out"
no_state
out=$(HOME=$(fresh_home) CODEX_HOME="$T/h/codex" PATH="$T/only-codex:$T/tools" bash "$T/g/scripts/install.sh" --codex 2>&1); rc=$?
[ "$rc" -ne 0 ] && grep -q 'pinned revision' <<<"$out" && ok "no readable root after the add is an error" || bad "no root" "rc=$rc $out"
echo dirty > "$T/g/untracked"
no_state
out=$(HOME=$(fresh_home) CODEX_HOME="$T/h/codex" CODEX_ROOT="$T/g" PATH="$T/only-codex:$T/tools" bash "$T/g/scripts/install.sh" --codex 2>&1); rc=$?
[ "$rc" -ne 0 ] && grep -q 'clean Git checkout' <<<"$out" && ! grep -q 'marketplace add' "$CODEX_CALLS" 2>/dev/null &&
  ok "a dirty checkout is never pinned" || bad "dirty checkout" "rc=$rc $out"
rm -f "$T/g/untracked"

# ---- moving a pinned Codex registration from one revision to another
# A stateful fake: the registration is a root directory (a Git clone), `add`
# refuses a different ref like the real CLI, `remove` forgets it, and a plugin
# installed records the version derived from the root's HEAD.
mkroot() { # dir origin rev
  rm -rf "$1"; git clone -q "$T/g" "$1" && git -C "$1" remote set-url origin "$2" && git -C "$1" checkout -q "$3"
}
git -C "$T/g" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m second
SHA2=$(git -C "$T/g" rev-parse HEAD)
cat > "$T/bin/codex-state" <<'EOF'
#!/bin/bash
# state dir: $CS/root (registered clone), $CS/ver (installed version)
[[ ${*: -1} == --help ]] && exit 0
printf '%s\n' "$*" >> "$CODEX_CALLS"
root=$(cat "$CS/root" 2>/dev/null)
case "$1 $2 $3" in
  "plugin marketplace list") [ -z "$root" ] || printf 'MARKETPLACE  ROOT\nkodflow      %s\n' "$root"; exit 0 ;;
  "plugin marketplace remove") rm -f "$CS/root"; echo "Removed marketplace"; exit 0 ;;
  "plugin marketplace add")
    ref=$6
    if [ -n "$root" ] && [ "$(git -C "$root" rev-parse HEAD)" != "$ref" ]; then
      echo "Error: marketplace 'kodflow' is already added from a different source; remove it before adding this source" >&2; exit 1
    fi
    if [ "${DEMO_ADD_FAIL_REF:-}" = "$ref" ]; then echo "fatal: unable to fetch $ref" >&2; exit 1; fi
    if [ -z "$root" ]; then
      rm -rf "$CS/clone-$ref"
      git clone -q "$T_G" "$CS/clone-$ref" && git -C "$CS/clone-$ref" checkout -q "$ref" &&
        git -C "$CS/clone-$ref" remote set-url origin https://github.com/kodflow/claude-marketplace.git &&
        echo "$CS/clone-$ref" > "$CS/root"
    fi
    echo "Added marketplace"; exit 0 ;;
  "plugin add "*)
    v="0.0.0-r$(git -C "$(cat "$CS/root")" rev-parse --short HEAD)"
    echo "$v" > "$CS/ver"; echo "Installed plugin root: /cache/kodflow/${3%@*}/$v"; exit 0 ;;
  "plugin list "*)
    v=${DEMO_STALE_VER:-$(cat "$CS/ver")}
    printf '{"installed":[{"pluginId":"kodflow-workflow@kodflow","version":"%s"},{"pluginId":"kodflow-review@kodflow","version":"%s"},{"pluginId":"kodflow-devops@kodflow","version":"%s"}]}\n' "$v" "$v" "$v"
    exit 0 ;;
esac
exit 0
EOF
chmod 755 "$T/bin/codex-state"
mkdir -p "$T/state-bin"; ln -sf "$T/bin/codex-state" "$T/state-bin/codex"
# name origin rev [VAR=val...]: registers a clone at <rev>, runs the installer from $T/g (HEAD = $SHA2)
state_run() {
  local n=$1 o=$2 r=$3; shift 3
  CS="$T/cs-$n"; rm -rf "$CS"; mkdir -p "$CS"; mkroot "$CS/old" "$o" "$r"; echo "$CS/old" > "$CS/root"
  echo "0.0.0-r$(git -C "$CS/old" rev-parse --short HEAD)" > "$CS/ver"
  no_state
  out=$(env CS="$CS" T_G="$T/g" "$@" HOME="$(fresh_home)" CODEX_HOME="$T/h/codex" PATH="$T/state-bin:$T/tools" bash "$T/g/scripts/install.sh" --codex 2>&1); rc=$?
}
OURS=https://github.com/kodflow/claude-marketplace.git
state_run up "$OURS" "$SHA" X=1
rm_line=$(grep -n '^plugin marketplace remove kodflow$' "$CODEX_CALLS" | cut -d: -f1)
add_line=$(grep -n "^plugin marketplace add kodflow/claude-marketplace --ref $SHA2\$" "$CODEX_CALLS" | tail -1 | cut -d: -f1)
if [ "$rc" -eq 0 ] && [ -n "$rm_line" ] && [ -n "$add_line" ] && [ "$rm_line" -lt "$add_line" ] &&
   [ "$(grep -c '^plugin add ' "$CODEX_CALLS")" -eq 3 ] && grep -q "kodflow-workflow@kodflow at 0.0.0-r$(git -C "$T/g" rev-parse --short HEAD)" <<<"$out"; then
  ok "an older pinned registration of this repository is replaced and the plugins reinstalled"
else bad "sha A to sha B" "rc=$rc $out $(cat "$CODEX_CALLS")"; fi
state_run stale "$OURS" "$SHA" DEMO_STALE_VER=0.0.0-rold
[ "$rc" -ne 0 ] && grep -q 'does not match' <<<"$out" && ok "a reinstalled version that is not the installed one is an error" || bad "version check" "rc=$rc $out"
state_run foreign https://example.invalid/other.git "$SHA" X=1
[ "$rc" -ne 0 ] && grep -q 'already added from a different source' <<<"$out" && grep -Fq 'codex plugin marketplace remove kodflow' <<<"$out" &&
  ! grep -q '^plugin marketplace remove kodflow$' "$CODEX_CALLS" && ! grep -q '^plugin add' "$CODEX_CALLS" &&
  ok "a foreign source keeps the error and is left alone" || bad "foreign source" "rc=$rc $out $(cat "$CODEX_CALLS")"
state_run fail "$OURS" "$SHA" DEMO_ADD_FAIL_REF="$SHA2"
[ "$rc" -ne 0 ] && [ "$(cat "$CS/root")" = "$CS/clone-$SHA" ] && grep -q 'previous registration' <<<"$out" && ! grep -q '^plugin add' "$CODEX_CALLS" &&
  ok "a failed add restores the previous registration and exits non-zero" || bad "restore" "rc=$rc root=$(cat "$CS/root" 2>/dev/null) $out $(cat "$CODEX_CALLS")"
CS="$T/cs-chk"; rm -rf "$CS"; mkdir -p "$CS"; mkroot "$CS/old" "$OURS" "$SHA"; echo "$CS/old" > "$CS/root"; no_state
out=$(env CS="$CS" T_G="$T/g" HOME="$(fresh_home)" CODEX_HOME="$T/h/codex" PATH="$T/state-bin:$T/tools" bash "$T/g/scripts/install.sh" --codex --check 2>&1); rc=$?
[ "$rc" -eq 0 ] && grep -q 'would: codex plugin marketplace remove kodflow' <<<"$out" && ! grep -Eq 'marketplace (add|remove)|^plugin add' "$CODEX_CALLS" &&
  ok "--check announces the replacement and changes nothing" || bad "check replacement" "rc=$rc $out $(cat "$CODEX_CALLS")"

# ---- --checkout in Claude switches a different registered source, and restores it on failure
no_state
JSON='[{"name":"kodflow","source":"github","repo":"kodflow/claude-marketplace"}]'
out=$(HOME=$(fresh_home) CLAUDE_MP_JSON="$JSON" PATH="$T/only-claude:$T/tools:$T/jq" bash "$T/repo/scripts/install.sh" --claude --checkout 2>&1); rc=$?
rm_line=$(grep -n '^plugin marketplace remove --scope user kodflow$' "$CLAUDE_CALLS" | cut -d: -f1)
add_line=$(grep -n "^plugin marketplace add $T/repo\$" "$CLAUDE_CALLS" | cut -d: -f1)
[ "$rc" -eq 0 ] && [ -n "$rm_line" ] && [ -n "$add_line" ] && [ "$rm_line" -lt "$add_line" ] &&
  ok "--checkout replaces a different Claude source (remove, then add)" || bad "checkout switch" "rc=$rc $out $(cat "$CLAUDE_CALLS")"
no_state
out=$(HOME=$(fresh_home) CLAUDE_MP_JSON="$JSON" CLAUDE_ADD_FAIL="$T/repo" PATH="$T/only-claude:$T/tools:$T/jq" bash "$T/repo/scripts/install.sh" --claude --checkout 2>&1); rc=$?
[ "$rc" -ne 0 ] && [ "$(grep -v ' list ' "$CLAUDE_CALLS" | tail -1)" = "plugin marketplace add kodflow/claude-marketplace" ] &&
  ! grep -q '^plugin install' "$CLAUDE_CALLS" &&
  ok "a failed --checkout add restores the previous source and exits non-zero" || bad "checkout restore" "rc=$rc $out $(cat "$CLAUDE_CALLS")"
no_state
SAME="[{\"name\":\"kodflow\",\"source\":\"directory\",\"path\":\"$T/repo\"}]"
out=$(HOME=$(fresh_home) CLAUDE_MP_JSON="$SAME" PATH="$T/only-claude:$T/tools:$T/jq" bash "$T/repo/scripts/install.sh" --claude --checkout 2>&1); rc=$?
[ "$rc" -eq 0 ] && ! grep -q 'marketplace remove' "$CLAUDE_CALLS" && ok "--checkout leaves an identical source alone" || bad "same source" "rc=$rc $out"

# ---- help lists every option
h=$(bash "$ROOT/scripts/install.sh" -h 2>&1)
miss=""; for o in --claude --codex --legacy --checkout --check; do grep -q -- "$o" <<<"$h" || miss="$miss $o"; done
[ -z "$miss" ] && ok "-h documents every option" || bad "help" "missing:$miss"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
