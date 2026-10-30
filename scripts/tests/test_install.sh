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
EOF
chmod 755 "$T/bin/claude"
export CLAUDE_CALLS=$T/calls HOME=$T/home PATH="$T/bin:$PATH"

excluded=$(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$ROOT/scripts/install-exclude.txt" | grep .)
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

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
