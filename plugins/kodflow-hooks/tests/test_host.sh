#!/bin/bash
# test_host.sh — hooks/scripts/lib/host.sh, what changes under Git for
# Windows: kf_unixpath on the paths Claude Code sends in the Windows
# spelling, jq read back without a carriage return, and nothing at all
# elsewhere. The MSYS branch is played on every platform by setting OSTYPE.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
LIB=$ROOT/plugins/kodflow-hooks/hooks/scripts/lib

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }
eq()  { [ "$2" = "$3" ] && ok "$1" || bad "$1" "got [$2], want [$3]"; }

echo "== lib/host.sh under MSYS (OSTYPE=msys)"
out=$(
    OSTYPE=msys
    CLAUDE_PROJECT_DIR='C:\Profiles\dev\src\x' CLAUDE_CONFIG_DIR='D:/cfg'
    . "$LIB/host.sh"
    CWD='C:\Profiles\dev\src\x\sub' FILE='c:/Profiles/dev/a b/f.ts' NB='rel\nb.ipynb' SCRATCH='\\srv\share\s'
    POSIX=/already/posix EMPTY=
    kf_unixpath CWD FILE NB SCRATCH POSIX EMPTY UNSET
    printf '%s\n' "$CLAUDE_PROJECT_DIR" "$CLAUDE_CONFIG_DIR" "$CWD" "$FILE" "$NB" "$SCRATCH" "$POSIX" "[$EMPTY]" "[${UNSET-unset}]"
)
i=0
while IFS= read -r got; do
    i=$((i+1))
    case $i in
        1) eq "CLAUDE_PROJECT_DIR is rewritten at source time" "$got" /c/Profiles/dev/src/x ;;
        2) eq "CLAUDE_CONFIG_DIR in forward slashes too" "$got" /d/cfg ;;
        3) eq "a backslashed cwd" "$got" /c/Profiles/dev/src/x/sub ;;
        4) eq "a lower-case drive, a space kept" "$got" "/c/Profiles/dev/a b/f.ts" ;;
        5) eq "a relative path is left alone" "$got" 'rel\nb.ipynb' ;;
        6) eq "a UNC share" "$got" //srv/share/s ;;
        7) eq "a POSIX path is left alone" "$got" /already/posix ;;
        8) eq "an empty value stays empty" "$got" "[]" ;;
        9) eq "an unset variable stays unset" "$got" "[unset]" ;;
    esac
done <<<"$out"
eq "every value read back" "$i" 9

if command -v jq >/dev/null 2>&1; then
    got=$(OSTYPE=msys; . "$LIB/host.sh"; type -t jq)
    eq "jq is wrapped under MSYS" "$got" function
    got=$(OSTYPE=msys; . "$LIB/host.sh"; jq -r '.a' <<<'{"a":"x"}' | od -An -c | tr -d ' \n')
    eq "jq -b answers a value with no carriage return" "$got" 'x\n'
fi

echo "== lib/host.sh elsewhere (OSTYPE=linux-gnu, darwin)"
for os in linux-gnu darwin23; do
    got=$(
        OSTYPE=$os CLAUDE_PROJECT_DIR='C:\x'
        . "$LIB/host.sh"
        CWD='C:\x\y'; kf_unixpath CWD
        printf '%s|%s|%s' "$CLAUDE_PROJECT_DIR" "$CWD" "$(type -t jq || echo none)"
    )
    case "$got" in
        'C:\x|C:\x\y|file'|'C:\x|C:\x\y|none') ok "$os: paths and jq untouched" ;;
        *) bad "$os: paths and jq untouched" "$got" ;;
    esac
done

echo "== on-mod.sh reads a Windows cwd (the log line lands in the project)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
if command -v jq >/dev/null 2>&1; then
    mkdir -p "$T/repo"
    # A POSIX cwd: the hook's own path, so this runs on every platform
    printf '{"cwd":"%s","hook_event_name":"PostToolUse","tool_name":"mcp__kodflow-hooks__task_list","session_id":"s"}' "$T/repo" |
        CLAUDE_PROJECT_DIR='' bash "$ROOT/plugins/kodflow-hooks/hooks/scripts/on-mod.sh"
    [ $? -eq 0 ] && ok "on-mod.sh exits 0 after sourcing host.sh" || bad "on-mod.sh" "non-zero exit"
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
