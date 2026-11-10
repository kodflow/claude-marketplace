# scope.sh — does a kodflow-specialists agent's shell call stay within the
# command families its own definition declares (#155)? Advice only: the call
# always goes on, and the agent reads one line saying which commands fell
# outside. Refusing is an owner's decision this file does not take: the scope
# is prose for some agents, the Plan review mode is invisible here, and a
# guard that guesses wrong would stop a review halfway.
# shellcheck shell=bash
#
#   . "$LIB/scope.sh"
#   kf_scope_families FILE   → KF_SCOPE_FAM (one family a line, its words
#                              space-separated), KF_SCOPE_HAS (1 when the file
#                              has a `## Command scope` with a Bash(...) entry),
#                              KF_SCOPE_REVIEW (1 when it carries the Plan review
#                              inspection line, whose commands are then counted)
#   kf_scope_outside         → KF_SCOPE_OUT, the commands of the parsed line
#                              (on-tool.sh's reader: P_N, _p_argv) that no
#                              family covers, comma-separated
#   kf_scope_check           → SCOPE_CTX, the advice, empty when in scope
#
# What a family is: the words of a `Bash(...)` entry of `## Command scope`,
# `:*` dropped, up to the first word holding a placeholder, a glob, a path or
# a quote (`Bash(git log:*)` → `git log`, `Bash(curl -fsSL https://…/*)` →
# `curl -fsSL`), and the same reading of every backticked command of the Plan
# review inspection line. A command is in scope when its argv starts with a
# family's words; git's global options (-C, -c, --no-pager…) are walked past
# first. Shell plumbing that runs nothing of its own (cd, echo, test…) and a
# command word the reader cannot see ($cmd) are never reported.
#
# Every miss is silence: no jq, no definition found, no `## Command scope`,
# KODFLOW_SCOPE=off (or `off` in <config>/kodflow/scope-mode). Journal:
# <session>/scope.jsonl, one line per call that went outside; the advice
# itself names a command once per agent (<session>/scope-seen/<agent_id>).
#
# macOS /bin/bash 3.2: no associative arrays, mapfile or ${v,,}.

KF_SCOPE_LIB=${BASH_SOURCE[0]%/*}

kf_scope_families() {
    KF_SCOPE_FAM="" KF_SCOPE_HAS=0 KF_SCOPE_REVIEW=0
    [ -r "$1" ] || return 1
    local out
    out=$(awk -v BAD='<>*[]/:=$"(){}|`\\'"'" '
        function bad(w,   i) {
            for (i = 1; i <= length(BAD); i++) if (index(w, substr(BAD, i, 1))) return 1
            return 0
        }
        function fam(s,   n, w, i, o) {
            n = split(s, w, /[ \t]+/); o = ""
            for (i = 1; i <= n; i++) {
                if (w[i] == "") continue
                if (bad(w[i])) break
                o = (o == "" ? w[i] : o " " w[i])
            }
            if (o !~ /^[A-Za-z0-9_][A-Za-z0-9_.+-]*( |$)/) return ""
            return o
        }
        # A prose bullet of the scope names its commands first, as a list of
        # spans (`grep -n`, `grep -c` and `sed -n …`): that leading run only,
        # since what follows may name forms it forbids (never `sed -i`).
        function lead(line,   s, f) {
            while (match(line, /^`[^`]+`/)) {
                s = substr(line, 2, RLENGTH - 2)
                line = substr(line, RLENGTH + 1)
                f = fam(s)
                if (f != "") print "F\t" f
                if (!match(line, /^(,|,? and|,? or) `/)) break
                line = substr(line, RLENGTH)
            }
        }
        # mode 1: Bash(...) entries only; 3: the inspection line, two words
        # at least (a lone word there is prose).
        function spans(line, mode,   s, f) {
            while (match(line, /`[^`]+`/)) {
                s = substr(line, RSTART + 1, RLENGTH - 2)
                line = substr(line, RSTART + RLENGTH)
                if (mode == 1) {
                    if (s !~ /^Bash\(.*\)$/) continue
                    s = substr(s, 6, length(s) - 6)
                    sub(/:?\*$/, "", s)
                    has = 1
                }
                f = fam(s)
                if (f == "") continue
                if (mode == 3 && f !~ / /) continue
                print "F\t" f
            }
        }
        /^```/ { fence = !fence; next }
        fence { next }
        /^## / { sec = $0; sub(/[ \t]+$/, "", sec); next }
        sec == "## Command scope" && /^- `[a-z]/ && !/^- `Bash\(/ { lead(substr($0, 3)); next }
        sec == "## Command scope" { spans($0, 1) }
        sec == "## Plan review mode" && /^- In Plan review mode only, if this agent has Bash:/ { review = 1; spans($0, 3) }
        NR > 5000 { exit }
        END { print "H\t" (has ? 1 : 0); print "R\t" (review ? 1 : 0) }
    ' "$1" 2>/dev/null) || return 1
    local k v
    while IFS=$'\t' read -r k v; do
        case "$k" in
            F) case $'\n'"$KF_SCOPE_FAM" in *$'\n'"$v"$'\n'*) ;; *) KF_SCOPE_FAM="$KF_SCOPE_FAM$v"$'\n' ;; esac ;;
            H) KF_SCOPE_HAS=$v ;;
            R) KF_SCOPE_REVIEW=$v ;;
        esac
    done <<< "$out"
    # The inspection families count only for an agent that has a scope at all
    [ "$KF_SCOPE_HAS" = 1 ]
}

# $1.. the argv → 0 when a family covers it. Reads KF_SCOPE_FAM.
_kf_scope_covered() {
    local name=$1 fam fw i ok
    shift
    local rest=("$@")
    while IFS= read -r fam; do
        [ -n "$fam" ] || continue
        # shellcheck disable=SC2206 # a family's words, split on purpose
        fw=($fam)
        [ "${fw[0]}" = "$name" ] || continue
        ok=1; i=1
        while [ $i -lt ${#fw[@]} ]; do
            [ "${rest[i-1]:-}" = "${fw[i]}" ] || { ok=0; break; }
            i=$((i+1))
        done
        [ $ok = 1 ] && return 0
    done <<< "$KF_SCOPE_FAM"
    return 1
}

# $1 the command's name → 0 when some family starts with it (a subform is wrong).
_kf_scope_known() {
    case $'\n'"$KF_SCOPE_FAM" in *$'\n'"$1"$'\n'*|*$'\n'"$1 "*) return 0 ;; esac
    return 1
}

kf_scope_outside() {
    KF_SCOPE_OUT=""
    local k=0 name x label
    while [ $k -lt "${P_N:-0}" ]; do
        _p_argv $k; k=$((k+1))
        name=$NAME
        case "$name" in
            ''|cd|pushd|popd|true|false|:|test|'['|'[['|']]'|echo|printf|exit|return|set|export|unset|local|lookup|\
            for|case|'esac'|done|fi|in|select|function|'('|')') continue ;;
            *'$'*|*'`'*) continue ;;
        esac
        local args=("${A[@]:1}")
        if [ "$name" = git ]; then
            x=0
            while [ $x -lt ${#args[@]} ]; do
                case "${args[x]}" in
                    -C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env) x=$((x+2)) ;;
                    --no-pager|-P|-p|--paginate|--no-optional-locks|--literal-pathspecs|--glob-pathspecs|\
                    --noglob-pathspecs|--icase-pathspecs|--bare|--no-replace-objects|--no-lazy-fetch|--*=*) x=$((x+1)) ;;
                    *) break ;;
                esac
            done
            args=("${args[@]:x}")
        fi
        _kf_scope_covered "$name" ${args[@]+"${args[@]}"} && continue
        label=$name
        # The verb joins the name only when it is a plain word: an argument
        # (a path, an expression) is never copied into the advice or the journal
        if _kf_scope_known "$name"; then
            case "${args[0]:-}" in ''|-*|*[!a-z0-9-]*) ;; *) label="$name ${args[0]}" ;; esac
        fi
        label=${label:0:40}
        case ",$KF_SCOPE_OUT," in *",$label,"*) ;; *) KF_SCOPE_OUT=${KF_SCOPE_OUT:+$KF_SCOPE_OUT,}$label ;; esac
    done
    return 0
}

_kf_scope_s() {
    local v=${1:0:200}
    printf '%s' "${v//[^A-Za-z0-9_:.@,\/ +-]/_}"
}

# Reads on-tool.sh's ATYPE, AID, TUID, SID and its parsed line.
kf_scope_check() {
    SCOPE_CTX=""
    local cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude} m=""
    case "${KODFLOW_SCOPE:-}" in off|OFF|Off) return 0 ;; esac
    [ -r "$cfg/kodflow/scope-mode" ] && read -r m < "$cfg/kodflow/scope-mode" 2>/dev/null
    case "$m" in off|OFF|Off) return 0 ;; esac
    . "$KF_SCOPE_LIB/agents.sh" 2>/dev/null || return 0
    kf_agent_def "$ATYPE" "$cfg" "${CLAUDE_PROJECT_DIR:-${CWD:-}}" || return 0
    kf_scope_families "$KF_AGENT_DEF" || return 0
    kf_scope_outside
    [ -n "$KF_SCOPE_OUT" ] || return 0
    local sd=$cfg/kodflow/sessions/${SID:-default} seen new="" l rest extra=""
    mkdir -p "$sd/scope-seen" 2>/dev/null || return 0
    printf '{"ts":"%s","agent_type":"%s","agent_id":"%s","tool_use_id":"%s","outside":"%s","review_counted":%s}\n' \
        "$(date -u +%FT%TZ)" "$(_kf_scope_s "$ATYPE")" "$(_kf_scope_s "$AID")" "$(_kf_scope_s "${TUID:-}")" \
        "$(_kf_scope_s "$KF_SCOPE_OUT")" "$([ "$KF_SCOPE_REVIEW" = 1 ] && echo true || echo false)" \
        >> "$sd/scope.jsonl" 2>/dev/null
    # Said once per agent and command: an agent told that `head` is outside
    # its scope is not told again on every call (the journal keeps them all).
    seen=$sd/scope-seen/$(printf '%s' "$AID" | tr -cd 'A-Za-z0-9_-')
    rest=$KF_SCOPE_OUT,
    while [ -n "$rest" ]; do
        l=${rest%%,*}; rest=${rest#*,}
        [ -n "$l" ] || continue
        grep -qxF -- "$l" "$seen" 2>/dev/null && continue
        printf '%s\n' "$l" >> "$seen" 2>/dev/null
        new=${new:+$new, }$l
    done
    [ -n "$new" ] || return 0
    [ "$KF_SCOPE_REVIEW" = 1 ] && extra=" (its Plan review inspection commands counted)"
    SCOPE_CTX="COMMAND SCOPE (kodflow-hooks, advice only): outside the Command scope of ${ATYPE}${extra}, this call runs: ${new}. The call goes on. A step outside the scope is handed back to the caller, or its claim goes under unverified with the command that would settle it. Said once per command; KODFLOW_SCOPE=off turns this advice off."
    return 0
}
