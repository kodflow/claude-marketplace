# lint.sh — ktn-linter on the Go file just edited, for the model to act on.
# shellcheck shell=bash
#
# Run by on-tool.sh at PostToolUse of Write, Edit and MultiEdit, after the
# formatter, so the lines named are the lines on disk. A report at Stop came
# after the work and changed nothing (#75); here the model still holds the
# file.
#
# One run per edit, never two: when ktn-linter's own PostToolUse hook is
# installed (`ktn-linter hook install` writes a ktn-hook command in the
# user's settings; one written by hand in the project's settings counts too),
# it already lints the edit through its daemon and hands the
# model its verdict. This side then runs nothing and gives the instruction
# below once per session, for the findings that hook reports.
#
# Otherwise `ktn-linter run --json` on the file's package (a single file
# loses the rest of its package: `undefined: Y`), from the module's
# directory, bounded by KF_LINT_TIMEOUT seconds (default 10), and only the
# findings of the edited file are kept. Every failure is silent: no binary,
# no Go project (lib/gomod.sh), a timeout, a package that did not load, exit
# 42 (a daemon serves the module and reports through its own hooks). A set of
# findings already reported for the file is not repeated; the signature
# leaves line numbers out, so an edit that only moves them stays quiet, and a
# clean run clears it.
#
#   . "$LIB/lint.sh"
#   kf_lint FILE ROOT STATE CONFIG_DIR TOOL   → KF_LINT, the text for the model

KF_LINT_POLICY='Fix each finding now, in this change. A fix that needs a heavy refactor is still a fix, not a false positive and not a reason to skip it: do it, or, if it is truly outside the task, tell the user so; never skip a finding silently. Only when you are certain a finding is a false positive: open a complete issue on kodflow/ktn-linter (the rule ID, a minimal reproduction, file:line, the expected and the actual result, the ktn-linter version), then go on.'

# Whether ktn-linter's own PostToolUse hook runs for this tool ($3), for
# this user ($1, the configuration directory) or in the project ($2): a
# ktn-hook under a matcher that does not take the tool lints nothing here.
# A matcher is empty, `*` or a regular expression on the whole tool name.
_kf_lint_owned() {
    local s
    for s in "$1/settings.json" "$2/.claude/settings.json" "$2/.claude/settings.local.json"; do
        [ -s "$s" ] || continue
        jq -e --arg t "$3" '[.hooks.PostToolUse[]? | objects
            | select((.matcher // "") as $m | $m == "" or $m == "*" or ($t | test("^(" + $m + ")$")))
            | .hooks[]?.command? | strings] | any(test("ktn-hook"))' "$s" >/dev/null 2>&1 && return 0
    done
    return 1
}

# Run "$@" with stdout in $out, bounded; macOS ships no timeout(1)
_kf_lint_run() {
    local out=$1 s=$2 pid w rc; shift 2
    if command -v timeout >/dev/null 2>&1; then
        timeout "$s" "$@" > "$out" 2>/dev/null; return
    fi
    "$@" > "$out" 2>/dev/null & pid=$!
    ( sleep "$s"; kill -TERM "$pid" ) >/dev/null 2>&1 & w=$!
    wait "$pid"; rc=$?
    kill "$w" 2>/dev/null; wait "$w" 2>/dev/null
    return $rc
}

kf_lint() {
    local raw=$1 root=$2 state=$3 cfg=$4 tool=${5:-Edit} f mod d pkg tmp rc rows sig last prev ver n rel
    KF_LINT=""
    case "$raw" in /*.go) ;; *) return 0 ;; esac
    [ -f "$raw" ] || return 0
    command -v ktn-linter >/dev/null 2>&1 || return 0
    # Real paths, so /root/../other/x.go or a symlink out of the root is
    # judged where it lands, not by its spelling
    root=$(cd "$root" 2>/dev/null && pwd -P) || return 0
    f=$(cd "${raw%/*}" 2>/dev/null && pwd -P)/${raw##*/} || return 0
    . "${BASH_SOURCE[0]%/*}/gomod.sh" 2>/dev/null || return 0
    kf_gomod "$f" "$root" || return 0
    mod=$KF_GOMOD
    if _kf_lint_owned "$cfg" "$root" "$tool"; then
        [ -f "$state/lint-policy-told" ] && return 0
        mkdir -p "$state" 2>/dev/null && : > "$state/lint-policy-told"
        KF_LINT="ktn-linter's own PostToolUse hook reports the findings of each Go edit. For every finding it reports: $KF_LINT_POLICY"
        return 0
    fi
    d=${f%/*}; pkg=.${d#"$mod"}
    mkdir -p "$state/lint-file" 2>/dev/null || return 0
    tmp=$state/lint-file/.out.$$
    ( cd "$mod" && _kf_lint_run "$tmp" "${KF_LINT_TIMEOUT:-10}" ktn-linter run --json --no-color "$pkg" ); rc=$?
    last=$state/lint-file/$(printf '%s' "$f" | cksum | cut -d' ' -f1)
    case "$rc" in
        0) rm -f -- "$tmp" "$last"; return 0 ;;
        1) ;;
        *) rm -f -- "$tmp"; return 0 ;;
    esac
    rows=$(jq -r --arg f "$f" --arg c "$raw" '.results[]? | objects
        | select(.location.file == $f or .location.file == $c)
        | [(.location.line // 0), (.location.column // 0), (.ruleId // "?"), (.level // "?"), ((.message // "") | gsub("[\n\t]"; " "))]
        | map(tostring) | join("\t")' "$tmp" 2>/dev/null | sort -t "$(printf '\t')" -k1,1n -k2,2n)
    rm -f -- "$tmp"
    if [ -z "$rows" ]; then rm -f -- "$last"; return 0; fi
    sig=$(printf '%s\n' "$rows" | cut -f3- | sort | cksum | cut -d' ' -f1)
    prev=""; [ -f "$last" ] && read -r prev < "$last"
    [ "$prev" = "$sig" ] && return 0
    printf '%s\n' "$sig" > "$last.$$" 2>/dev/null && mv -f "$last.$$" "$last" 2>/dev/null
    n=$(printf '%s\n' "$rows" | wc -l | tr -d ' ')
    rel=${f#"$root"/}
    ver=$(ktn-linter --version 2>/dev/null | head -n 1); ver=${ver##* }
    rows=$(printf '%s\n' "$rows" | head -n 40 | awk -F'\t' -v r="$rel" '{printf "  %s:%s:%s %s (%s) %s\n", r, $1, $2, $3, $4, $5}')
    [ "$n" -gt 40 ] && rows="$rows
  … and $((n - 40)) more"
    [ ${#rows} -gt 4000 ] && rows="${rows:0:4000}…(truncated)"
    KF_LINT="ktn-linter ${ver:-?}: $n finding(s) in $rel after this edit:
$rows
$KF_LINT_POLICY"
}
