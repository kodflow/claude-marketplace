#!/bin/bash
# on-tool.sh — the one hook behind PreToolUse, PostToolUse, PostToolUseFailure
# and PermissionDenied.
#
# Hooks registered on the same event run in parallel (hooks reference: "All
# matching hooks run in parallel"), so a chain of small scripts has no order —
# the guard may inspect a command the rewriter has already changed. One script
# per event is the only way to get a sequence, and the sequence is fixed:
#
#   1. GATE       the cheapest test that lets most calls leave at once
#   2. BLOCK      what must stop the call: exit 2 with the reason on stderr
#   3. TRANSFORM  what Claude reads (context, a reformatted file), as ONE JSON document
#   4. OBSERVE    logging and advice, off the critical path
#
# Every path that is not a deliberate block exits 0. A PreToolUse hook that
# fails by accident blocks every shell call of the session.
set +e

INPUT=$(cat 2>/dev/null); [ -n "$INPUT" ] || exit 0

# DELEGATION GATE · forge MCP tools. Pure bash, so the fast path below can use
# it without jq. The main thread reads the forge, merges, and talks on the
# tracker and in reviews; it does not push content, branches or pull requests
# — that is a subagent's delivery. Allow-list: a tool nobody classified is
# refused, because a new write tool must not slip through by being new.
_forge_ok() {
    local t=$1
    case "$t" in
        mcp__github__*)
            t=${t#mcp__github__}
            case "$t" in
                get_*|list_*|search_*|*_read|merge_pull_request|issue_write|sub_issue_write|add_issue_comment|\
                pull_request_review_write|add_comment_to_pending_review|add_reply_to_pull_request_comment) return 0 ;;
            esac ;;
        mcp__gitlab__*)
            t=${t#mcp__gitlab__}
            case "$t" in
                get_*|list_*|search_*|verify_*|download_*|my_issues|mr_discussions|merge_merge_request|\
                approve_merge_request|unapprove_merge_request|create_issue|update_issue|create_issue_link|\
                create_note|create_issue_note|update_issue_note|create_merge_request_note|update_merge_request_note|\
                create_merge_request_thread|create_merge_request_discussion_note|update_merge_request_discussion_note|\
                resolve_merge_request_thread|*draft_note|bulk_publish_draft_notes) return 0 ;;
            esac ;;
        mcp__GitKraken__*)
            t=${t#mcp__GitKraken__}
            case "$t" in
                git_log_or_diff|git_blame|git_status|git_graph|git_fetch|gitkraken_workspace_list|gitlens_launchpad|\
                issues_get_detail|issues_assigned_to_me|pull_request_assigned_to_me|pull_request_get_detail|\
                pull_request_get_comments|repository_get_file_content) return 0 ;;
            esac ;;
        *) return 0 ;;
    esac
    return 1
}

# GATED MODELS · the shell's fallback (model-policy.md §6). The mod judges
# every spawn while it beats (hooks/mod/fable.ts) and holds the session's
# grant; without it nothing here can ask or remember a yes, so a dispatch
# that names a gated model — the call's `model`, else its definition's
# frontmatter, else CLAUDE_CODE_SUBAGENT_MODEL — is refused. The parent's
# model is not in a PreToolUse payload: an `inherit` under a gated main
# model passes here (a README hole). Pure bash and awk: it runs before the
# jq check, so a machine without jq still has it.
# The fields the fallback reads. With jq, decoded from the JSON (any layout,
# any escape); without it, bash regexes over the raw text, any whitespace
# around the colon — a value holding an escaped quote or a \u escape is then
# read up to it, a limit the README states.
_fable_fields() {
    [ -n "${FF_DONE:-}" ] && return 0
    FF_DONE=1 FF_SID="" FF_MODEL="" FF_TYPE="" FF_SKILL="" FF_CWD=""
    if command -v jq >/dev/null 2>&1 && eval "$(printf '%s' "$INPUT" | jq -r '(.tool_input // {}) as $i | @sh "FF_SID=\(.session_id // "" | tostring) FF_MODEL=\($i.model // "" | tostring) FF_TYPE=\($i.subagent_type // "" | tostring) FF_SKILL=\($i.skill // "" | tostring) FF_CWD=\(.cwd // "" | tostring)"' 2>/dev/null)"; then
        return 0
    fi
    local w='[[:space:]]*'
    [[ $INPUT =~ \"session_id\"$w:$w\"([^\"]*)\" ]] && FF_SID=${BASH_REMATCH[1]}
    [[ $INPUT =~ \"model\"$w:$w\"([^\"]*)\" ]] && FF_MODEL=${BASH_REMATCH[1]}
    [[ $INPUT =~ \"subagent_type\"$w:$w\"([^\"]*)\" ]] && FF_TYPE=${BASH_REMATCH[1]}
    [[ $INPUT =~ \"skill\"$w:$w\"([^\"]*)\" ]] && FF_SKILL=${BASH_REMATCH[1]}
    [[ $INPUT =~ \"cwd\"$w:$w\"([^\"]*)\" ]] && FF_CWD=${BASH_REMATCH[1]}
    return 0
}
_fable_sd() {
    _fable_fields
    FABLE_SD=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$(printf '%s' "${FF_SID:-default}" | tr -cd 'A-Za-z0-9_-')
}
_fable_refuse() {   # $1 the model, $2 where it came from, $3 the way out
    local fa=main
    [[ $INPUT =~ \"agent_type\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]] && fa=${BASH_REMATCH[1]}
    . "${BASH_SOURCE[0]%/*}/lib/blocks.sh" 2>/dev/null \
        && kf_block "$FABLE_SD" hook "${TOOL:-${fp_tool:-}}" "GATED MODEL REFUSED — $1 ($2)" fable "$fa"
    printf '═══════════════════════════════════════════════\n  ❌ %s\n═══════════════════════════════════════════════\n' "GATED MODEL REFUSED — $1 ($2)" >&2
    printf '  %s\n' "A gated model (kodflow-hooks/hooks/gated-models.txt) runs only after the user's yes, once per session." "$3" \
        "The user can also set KODFLOW_FABLE=allow." "[motif:fable]" >&2
    exit 2
}
_fable_fast() {
    [ -n "${FABLE_DONE:-}" ] && return 0; FABLE_DONE=1
    case "${KODFLOW_FABLE:-}" in allow|off) return 0 ;; esac
    local L=${BASH_SOURCE[0]%/*}/lib sd m="" t="" why=""
    _fable_sd; sd=$FABLE_SD
    if . "$L/beat.sh" 2>/dev/null && kf_beat "$sd"; then return 0; fi
    . "$L/agents.sh" 2>/dev/null || return 0
    # The engine's precedence: CLAUDE_CODE_SUBAGENT_MODEL under _FORCE first,
    # then the call, the frontmatter (inherit: the parent's, unknown here),
    # then CLAUDE_CODE_SUBAGENT_MODEL.
    local env=${CLAUDE_CODE_SUBAGENT_MODEL:-} heir=0
    case "${CLAUDE_CODE_SUBAGENT_MODEL_FORCE:-}" in ''|0|false|no|off) ;; *) [ -n "$env" ] && m=$env && why="CLAUDE_CODE_SUBAGENT_MODEL (forced)" ;; esac
    [ -z "$m" ] && [ -n "$FF_MODEL" ] && m=$FF_MODEL && why="the call's model"
    t=$FF_TYPE
    if [ -z "$m" ] && [ -n "$t" ]; then
        if kf_agent_def "$t" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "${CLAUDE_PROJECT_DIR:-$FF_CWD}" && kf_fm_model "$KF_AGENT_DEF"; then
            case "$KF_FM_MODEL" in inherit|INHERIT) heir=1 ;; *) m=$KF_FM_MODEL; why="the frontmatter of $t" ;; esac
        fi
    fi
    [ -z "$m" ] && [ $heir = 0 ] && [ -n "$env" ] && m=$env && why=CLAUDE_CODE_SUBAGENT_MODEL
    kf_is_gated "$m" || return 0
    _fable_refuse "$m" "$why" "The kodflow mod that asks for that yes is not loaded in this session: dispatch without that model, or load the mod (Claude Code 2.1.293+, /reload-plugins)."
}

# A skill whose frontmatter names a model switches the main conversation to
# it. The mod judges the Skill call (fable.ts, judgeSkill) and holds the
# grant; without it the shell refuses a gated one outright. No file grants
# anything here: whatever can run a tool could write it.
_fable_skill() {
    [ -n "${FABLE_DONE:-}" ] && return 0; FABLE_DONE=1
    case "${KODFLOW_FABLE:-}" in allow|off) return 0 ;; esac
    local L=${BASH_SOURCE[0]%/*}/lib sk
    _fable_sd
    if . "$L/beat.sh" 2>/dev/null && kf_beat "$FABLE_SD"; then return 0; fi
    sk=${FF_SKILL#/}
    [ -n "$sk" ] || return 0
    . "$L/agents.sh" 2>/dev/null || return 0
    kf_skill_def "$sk" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "${CLAUDE_PROJECT_DIR:-$FF_CWD}" && kf_fm_model "$KF_SKILL_DEF" || return 0
    kf_is_gated "$KF_FM_MODEL" || return 0
    _fable_refuse "$KF_FM_MODEL" "the frontmatter of the skill $sk" "The kodflow mod that asks for that yes is not loaded in this session: load it (Claude Code 2.1.293+, /reload-plugins), or run without the skill."
}

# FAST PATH, no jq. The PreToolUse matcher is the catch-all so the triage gate
# sees every call, and one jq start costs ~30 ms on a slow CPU: the tools this
# script does not handle are decided with bash regexes alone. They leave at
# once unless the triage gate applies, in which case the full path below
# refuses them. A forge write from the main thread (delegation gate, above) is
# the one other case that goes on to the full path.
if [[ $INPUT =~ \"hook_event_name\"[[:space:]]*:[[:space:]]*\"PreToolUse\" ]] && [[ $INPUT =~ \"tool_name\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    fp_tool=${BASH_REMATCH[1]}
    case "$fp_tool" in
        Bash|Write|Edit|MultiEdit|NotebookEdit|TaskCreate|TodoWrite|mcp__*tasks__task_*|mcp__kodflow-hooks__task_*) ;;
        Read|Glob|Grep|LS|ToolSearch|AskUserQuestion) exit 0 ;;
        Skill)
            _fable_skill
            [[ $INPUT =~ \"agent_id\":\ ?\"[^\"]+\" ]] && exit 0
            fp_sid=""
            [[ $INPUT =~ \"session_id\":\ ?\"([^\"]*)\" ]] && fp_sid=${BASH_REMATCH[1]//[^A-Za-z0-9_-]/}
            [ -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/${fp_sid:-default}/triage-pending" ] || exit 0 ;;
        Agent|Task)
            # The gated-model fallback, every caller, no jq; then only the
            # main thread goes on, to the routing gate (pre_agent).
            _fable_fast
            if [[ $INPUT =~ \"agent_id\":\ ?\"[^\"]+\" ]]; then exit 0; fi ;;
        *)
            # A forge tool that carries a message, a title, a body, a branch or
            # a merge goes on to the full path for every caller, subagents
            # included: attribution, merges and default-branch writes are
            # checked there.
            fp_full=0
            case "$fp_tool" in mcp__github__*|mcp__gitlab__*|mcp__GitKraken__*)
                fp_re='"(message|commit_message|commit_title|squash_commit_message|merge_commit_message|title|body|description|merge_when_pipeline_succeeds|auto_merge|branch)":'
                if [[ $INPUT =~ $fp_re ]]; then fp_full=1; else case "$fp_tool" in *merge_pull_request|*merge_merge_request|*GitKraken__git_add) fp_full=1 ;; esac; fi
                # A file named mcp.json is refused for every caller (pre_forge)
                case "$INPUT" in *[Mm][Cc][Pp].[Jj][Ss][Oo][Nn]*) fp_full=1 ;; esac ;;
            esac
            if [ $fp_full = 0 ]; then
                [[ $INPUT =~ \"agent_id\":\ ?\"[^\"]+\" ]] && exit 0
                fp_gate=0
                if [ "${KODFLOW_ROOT:-}" != off ] && ! [[ $INPUT =~ \"permission_mode\":\ ?\"plan\" ]] && ! _forge_ok "$fp_tool"; then
                    fp_gate=1
                fi
                fp_sid=""
                [[ $INPUT =~ \"session_id\":\ ?\"([^\"]*)\" ]] && fp_sid=${BASH_REMATCH[1]//[^A-Za-z0-9_-]/}
                [ $fp_gate -eq 1 ] || [ -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/${fp_sid:-default}/triage-pending" ] || exit 0
            fi ;;
    esac
fi

command -v jq >/dev/null 2>&1 || exit 0

# One jq call reads every field a branch below may need. @sh single-quotes
# each value, so a crafted path or command cannot escape into this shell.
eval "$(printf '%s' "$INPUT" | jq -r '@sh "EV=\(.hook_event_name // "") TOOL=\(.tool_name // "") SID=\(.session_id // "") CWD=\(.cwd // "") SCRATCH=\(.scratchpad_dir // "") CMD=\(.tool_input.command // "") FILE=\(.tool_input.file_path // "") ERR=\(.error // "") AID=\(.agent_id // "") ATYPE=\(.agent_type // "") PMODE=\(.permission_mode // "") NB=\(.tool_input.notebook_path // "") REASON=\(.reason // "") TUID=\(.tool_use_id // "")"' 2>/dev/null)" || exit 0

SID=${SID//[^A-Za-z0-9_-]/}; SID=${SID:-default}
PROJECT_DIR=${CLAUDE_PROJECT_DIR:-${CWD:-$PWD}}
STATE=${SCRATCH:-${TMPDIR:-/tmp}/claude-hooks-$SID}   # session-scoped state; on-stop.sh reads it
LIB=${BASH_SOURCE[0]%/*}/lib

# DELEGATION GATE. A PreToolUse payload carries agent_id only when the call
# comes from inside a subagent; the main thread sends none (measured on 855
# real events: every PreToolUse carrying agent_id came from a subagent, no
# main-thread one did). That asymmetry is the whole mechanism. Plan mode
# mutates nothing, and KODFLOW_ROOT=off turns the gate off for the session.
ROOT_MAIN=0
[ "$EV" = PreToolUse ] && [ -z "$AID" ] && [ "$PMODE" != plan ] && [ "${KODFLOW_ROOT:-}" != off ] && ROOT_MAIN=1

# Branch without forking: read .git/HEAD (following a worktree's gitdir file).
_branch() {
    local g=$PROJECT_DIR/.git head
    if [ -f "$g" ]; then read -r head < "$g"; g=${head#gitdir: }; [[ $g = /* ]] || g=$PROJECT_DIR/$g; fi
    if [ -f "$g/HEAD" ]; then
        read -r head < "$g/HEAD"
        case "$head" in "ref: refs/heads/"*) BRANCH=${head#ref: refs/heads/} ;; *) BRANCH=detached ;; esac
    else
        BRANCH=$(git -C "$PROJECT_DIR" symbolic-ref --short HEAD 2>/dev/null) || BRANCH=detached
    fi
    BRANCH_SAFE=${BRANCH//\//_}; BRANCH_SAFE=${BRANCH_SAFE// /_}
}

# OBSERVE. A detached subshell with no inherited pipes, so the hook's own exit
# is not held back by the write. lib/event.jq is the whole sanitization policy.
_log() {
    _branch
    local dir=$PROJECT_DIR/.claude/logs/$BRANCH_SAFE
    (
        mkdir -p "$dir" 2>/dev/null || exit 0
        # mkdir is the lock: flock is absent on macOS. A stale lock costs half
        # a second, then the line is written anyway.
        local n=0; until mkdir "$dir/.lock.d" 2>/dev/null; do n=$((n+1)); [ $n -ge 10 ] && break; sleep 0.05; done
        printf '%s' "$INPUT" | KODFLOW_ROOT_GUARD=${ROOT_GUARD:-} jq -c --arg b "$BRANCH" -f "$LIB/event.jq" >> "$dir/session.jsonl" 2>/dev/null
        [ $n -lt 10 ] && rmdir "$dir/.lock.d" 2>/dev/null
    ) >/dev/null 2>&1 </dev/null &
}

# The refusal's line in blocks.jsonl (lib/blocks.sh): its title, and the
# motif its last line carries, or the one its gate is known by.
_block_log() {   # same arguments as _block
    local t=$1 m="" a
    for a in "$@"; do case "$a" in "[motif:"*"]") m=${a#"[motif:"}; m=${m%"]"} ;; esac; done
    if [ -z "$m" ]; then
        case "${ROOT_GUARD:-}:$t" in
            deny:*) m=delegation ;; *:TRIAGE*) m=triage ;; *"KODFLOW TASK TOOLS"*) m=builtin-tasks ;;
            *"protected path"*) m=protected-path ;; *) m=guard ;;
        esac
    fi
    . "$LIB/blocks.sh" 2>/dev/null \
        && kf_block "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$SID" hook "$TOOL" "$t" "$m" "${ATYPE:-${AID:-main}}" "" "" "$TUID"
    return 0
}

_block() {   # $1 = title, rest = lines. Stderr on exit 2 is what Claude reads.
    _block_log "$@"
    printf '═══════════════════════════════════════════════\n  ❌ %s\n═══════════════════════════════════════════════\n' "$1" >&2
    shift; printf '  %s\n' "$@" >&2
    _log
    exit 2
}

# ============================================================================
# Shell reader · what a Bash line will actually run
# ============================================================================
# A regex over the raw line cannot tell `git "commit"`, `\git commit` or
# `=git commit` from a commit, and it reads a heredoc that merely quotes a
# commit as one. This reader does the shell's own first pass: it cuts the
# line into simple commands, removes quotes and backslashes, joins
# `\`+newline, sets heredoc bodies aside as data, and queues for another pass
# every text the shell would itself run — $( ), backticks, <( ), bash -c,
# sh -c, eval, su/sg -c, and a body or a pipe fed to a shell. It never expands
# a variable or an alias: `c=git; $c commit` stays unread (known gap).
#
# Per command k: P_W[k] its words, US-separated; P_IN[k] what it reads on
# stdin (heredoc, here-string); P_RD[k] its redirection targets; P_PIPE[k]=1
# when a pipe feeds it. Bash 3.2: no associative arrays, no ;& in case.
US=$'\037'

_p_queue() { [ ${#PQ[@]} -lt 64 ] && [ "$2" -le 6 ] && { PQ+=("$1"); PQD+=("$2"); }; return 0; }

# $1 text, $2 index just past "(" → PCAP the content, PJ the index past ")".
_p_paren() {
    local LC_ALL=C
    local t=$1 k=$2 m=${#1} dep=1 ch r
    while [ $k -lt $m ]; do
        r=${t:k:256}; r=${r%%[\\\'\"\(\)]*}
        [ -n "$r" ] && { k=$((k+${#r})); continue; }
        ch=${t:k:1}
        case "$ch" in
            \\) k=$((k+2)); continue ;;
            \') r=${t:k+1}; r=${r%%\'*}; k=$((k+${#r}+2)); continue ;;
            \") k=$((k+1))
                while [ $k -lt $m ]; do
                    ch=${t:k:1}
                    case "$ch" in \\) k=$((k+2)); continue ;; \") break ;; esac
                    k=$((k+1))
                done ;;
            \() dep=$((dep+1)) ;;
            \)) dep=$((dep-1)); [ $dep -eq 0 ] && break ;;
        esac
        k=$((k+1))
    done
    PCAP=${t:$2:k-$2}; PJ=$((k+1))
}

# $1 source text, $2 its depth. Appends commands to P_*; queues nested text.
_p_scan() {
    local LC_ALL=C
    local s=$1 d=$2 n=${#1} i=0 c r w="" wa=0 rn=0 cw="" cr="" pipe=0 q idx strip dl body line
    local -a hq=()
    _pw() {   # end of a word: an argument, a redirection target, or stdin data
        if [ $wa = 1 ]; then
            case $rn in
                1) cr=$cr$w$US ;;
                2) P_IN[P_N]=${P_IN[P_N]:-}$w$'\n' ;;
                *) cw=$cw$w$US ;;
            esac
            rn=0
        fi
        w=""; wa=0
    }
    _pc() {   # end of a command; $1=1 when the next one reads a pipe
        _pw
        if [ -n "$cw$cr" ] || [ -n "${P_IN[P_N]:-}" ]; then
            P_W[P_N]=$cw; P_RD[P_N]=$cr; P_PIPE[P_N]=$pipe; P_IN[P_N]=${P_IN[P_N]:-}
            P_N=$((P_N+1))
        fi
        cw=""; cr=""; pipe=${1:-0}
    }
    _pdollar() {   # at $( : arithmetic is text, a substitution is queued
        if [ "${s:i+2:1}" = '(' ]; then
            _p_paren "$s" $((i+2)); w=$w'$('$PCAP')'
        else
            _p_paren "$s" $((i+2)); _p_queue "$PCAP" $((d+1)); w=$w'$('$PCAP')'
        fi
        wa=1; i=$PJ
    }
    _ptick() {   # at a backtick: the text up to the next one is queued
        local k=$((i+1)) ch
        while [ $k -lt $n ]; do
            ch=${s:k:1}
            case "$ch" in \\) k=$((k+2)); continue ;; \`) break ;; esac
            k=$((k+1))
        done
        _p_queue "${s:i+1:k-i-1}" $((d+1)); w=$w${s:i:k-i+1}; wa=1; i=$((k+1))
    }
    while [ $i -lt $n ]; do
        r=${s:i:256}; r=${r%%[!A-Za-z0-9_./:@%+,=-]*}
        if [ -n "$r" ]; then w=$w$r; wa=1; i=$((i+${#r})); continue; fi
        c=${s:i:1}
        case "$c" in
            ' '|$'\t') _pw ;;
            $'\n')
                _pc
                if [ ${#hq[@]} -gt 0 ]; then   # the bodies follow, in order
                    i=$((i+1))
                    for q in "${hq[@]}"; do
                        idx=${q%%"$US"*}; q=${q#*"$US"}; strip=${q%%"$US"*}; dl=${q#*"$US"}; body=""
                        while [ $i -lt $n ]; do
                            line=${s:i}; line=${line%%$'\n'*}; i=$((i+${#line}+1))
                            if [ "$strip" = 1 ]; then while [ "${line:0:1}" = $'\t' ]; do line=${line:1}; done; fi
                            [ "$line" = "$dl" ] && break
                            body=$body$line$'\n'
                        done
                        P_IN[idx]=${P_IN[idx]:-}$body
                    done
                    hq=(); continue
                fi ;;
            ';'|'('|')') _pc ;;
            '&')
                if [ "${s:i+1:1}" = '>' ]; then   # &> and &>> redirect, they do not separate
                    _pw; i=$((i+2)); [ "${s:i:1}" = '>' ] && i=$((i+1)); rn=1; continue
                fi
                [ "${s:i+1:1}" = '&' ] && i=$((i+1)); _pc ;;
            '|')
                case "${s:i+1:1}" in '|') i=$((i+1)); _pc ;; '&') i=$((i+1)); _pc 1 ;; *) _pc 1 ;; esac ;;
            '<'|'>')
                # an all-digit word right before is a file descriptor
                if [ $wa = 1 ]; then case "$w" in *[!0-9]*) _pw ;; *) w=""; wa=0 ;; esac; fi
                if [ "$c" = '<' ] && [ "${s:i+1:2}" = '<<' ]; then
                    i=$((i+3)); rn=2; continue   # here-string: the next word is stdin
                elif [ "$c" = '<' ] && [ "${s:i+1:1}" = '<' ]; then
                    i=$((i+2)); strip=0; [ "${s:i:1}" = - ] && { strip=1; i=$((i+1)); }
                    while [ "${s:i:1}" = ' ' ] || [ "${s:i:1}" = $'\t' ]; do i=$((i+1)); done
                    dl=""
                    while [ $i -lt $n ]; do
                        c=${s:i:1}
                        case "$c" in
                            ' '|$'\t'|$'\n'|';'|'&'|'|'|'<'|'>'|'('|')') break ;;
                            \'|\") r=${s:i+1}; r=${r%%"$c"*}; dl=$dl$r; i=$((i+${#r}+2)); continue ;;
                            \\) dl=$dl${s:i+1:1}; i=$((i+2)); continue ;;
                        esac
                        dl=$dl$c; i=$((i+1))
                    done
                    hq+=("$P_N$US$strip$US$dl"); continue
                elif [ "${s:i+1:1}" = '(' ]; then   # <( ) and >( ) run their text
                    _p_paren "$s" $((i+2)); _p_queue "$PCAP" $((d+1)); i=$PJ; continue
                fi
                i=$((i+1))
                case "${s:i:1}" in
                    '>'|'|') i=$((i+1)) ;;
                    '&') i=$((i+1)); while [[ ${s:i:1} == [0-9-] ]]; do i=$((i+1)); done; continue ;;
                esac
                [ "$c" = '<' ] && [ "${s:i:1}" = '>' ] && i=$((i+1))
                rn=1; continue ;;
            '#')
                if [ $wa = 0 ]; then r=${s:i}; r=${r%%$'\n'*}; i=$((i+${#r})); continue; fi
                w=$w$c ;;
            \\)
                [ "${s:i+1:1}" = $'\n' ] && { i=$((i+2)); continue; }
                w=$w${s:i+1:1}; wa=1; i=$((i+2)); continue ;;
            \')
                r=${s:i+1}; r=${r%%\'*}; w=$w$r; wa=1; i=$((i+${#r}+2)); continue ;;
            \")
                i=$((i+1)); wa=1
                while [ $i -lt $n ]; do
                    r=${s:i:256}; r=${r%%[\"\\\$\`]*}
                    [ -n "$r" ] && { w=$w$r; i=$((i+${#r})); continue; }
                    c=${s:i:1}
                    case "$c" in
                        \") break ;;
                        \\) case "${s:i+1:1}" in
                                $'\n') i=$((i+2)); continue ;;
                                \"|\\|\$|\`) w=$w${s:i+1:1}; i=$((i+2)); continue ;;
                            esac ;;
                        \$) [ "${s:i+1:1}" = '(' ] && { _pdollar; continue; } ;;
                        \`) _ptick; continue ;;
                    esac
                    w=$w$c; i=$((i+1))
                done ;;
            \$)
                case "${s:i+1:1}" in
                    '(') _pdollar; continue ;;
                    \')   # $'…': the escapes are decoded, \x67it is git
                        i=$((i+2)); r=""
                        while [ $i -lt $n ]; do
                            c=${s:i:1}
                            case "$c" in \') break ;; \\) r=$r${s:i:2}; i=$((i+2)); continue ;; esac
                            r=$r$c; i=$((i+1))
                        done
                        printf -v r '%b' "$r" 2>/dev/null; w=$w$r; wa=1 ;;
                    *) w=$w$c; wa=1 ;;
                esac ;;
            \`) _ptick; continue ;;
            *) w=$w$c; wa=1 ;;
        esac
        i=$((i+1))
    done
    _pc
}

_p_words() { W=(); local r=$1; while [ -n "$r" ]; do W+=("${r%%"$US"*}"); r=${r#*"$US"}; done; }

# $1 command index → A (argv from the executable on) and NAME (its basename).
# Reserved words, VAR=value prefixes and wrappers are walked past; `=git`
# (zsh) and `\git` (already unquoted) name git.
_p_argv() {
    _p_words "${P_W[$1]}"
    local x=0 nw=${#W[@]} t name
    while [ $x -lt $nw ]; do
        t=${W[x]}
        case "$t" in
            '!'|'{'|'}'|if|then|else|elif|do|while|until) x=$((x+1)); continue ;;
            [A-Za-z_]*=*) [[ ${t%%=*} == *[!A-Za-z0-9_]* ]] || { x=$((x+1)); continue; } ;;
        esac
        name=${t#=}; name=${name##*/}
        case "$name" in
            env)
                x=$((x+1))
                while [ $x -lt $nw ]; do
                    case "${W[x]}" in -u|-C|-S|--unset|--chdir) x=$((x+2)) ;; -*|[A-Za-z_]*=*) x=$((x+1)) ;; *) break ;; esac
                done ;;
            command|builtin|nohup|chronic|exec|time|caffeinate)
                x=$((x+1))
                while [ $x -lt $nw ]; do
                    case "$name/${W[x]}" in
                        command/-v|command/-V) NAME=lookup; A=(); return ;;
                        exec/-a) x=$((x+2)) ;;
                        */-*) x=$((x+1)) ;;
                        *) break ;;
                    esac
                done ;;
            nice|timeout|ionice|stdbuf|doas|sudo|xargs)
                x=$((x+1))
                while [ $x -lt $nw ]; do
                    case "$name/${W[x]}" in
                        */--) x=$((x+1)); break ;;
                        sudo/-[ugChpUrtDR]|doas/-[uC]|nice/-n|xargs/-[InPLsdEa]|timeout/-[sk]|ionice/-[cnp]) x=$((x+2)) ;;
                        */-*) x=$((x+1)) ;;
                        *) break ;;
                    esac
                done
                [ "$name" = timeout ] && x=$((x+1)) ;;
            rtk) x=$((x+1)); [ "${W[x]:-}" = proxy ] && x=$((x+1)) ;;
            *) break ;;
        esac
    done
    A=("${W[@]:x}"); NAME=${A[0]:-}; NAME=${NAME#=}; NAME=${NAME##*/}
}

# $1 command index: queue what it hands to a shell.
_p_expand() {
    _p_argv "$1"
    local y=1 na=${#A[@]} prev
    case "$NAME" in
        bash|sh|zsh|dash|ksh|ash|mksh)
            while [ $y -lt $na ]; do
                case "${A[y]}" in
                    -o|+o) y=$((y+2)); continue ;;
                    --*) ;;
                    -*c*) _p_queue "${A[y+1]:-}" $((PDEPTH+1)); return ;;
                    -*|+*) ;;
                    *) return ;;   # a script file: not ours to read
                esac
                y=$((y+1))
            done
            # no -c and no file: the shell runs its stdin
            [ -n "${P_IN[$1]:-}" ] && _p_queue "${P_IN[$1]}" $((PDEPTH+1))
            if [ "${P_PIPE[$1]:-0}" = 1 ] && [ "$1" -gt 0 ]; then
                prev=$(( $1 - 1 ))
                [ -n "${P_IN[prev]:-}" ] && _p_queue "${P_IN[prev]}" $((PDEPTH+1))
                _p_argv $prev
                case "$NAME" in echo|printf) _p_queue "${A[*]:1}" $((PDEPTH+1)) ;; esac
            fi ;;
        eval) [ $na -gt 1 ] && _p_queue "${A[*]:1}" $((PDEPTH+1)) ;;
        su|sg)
            while [ $y -lt $na ]; do
                [ "${A[y]}" = -c ] && { _p_queue "${A[y+1]:-}" $((PDEPTH+1)); return; }
                y=$((y+1))
            done ;;
    esac
}

# $1 the command line → every simple command it runs, nested ones included.
_p_parse() {
    P_W=(); P_IN=(); P_RD=(); P_PIPE=(); P_N=0; PQ=("$1"); PQD=(0)
    local qi=0 k
    while [ $qi -lt ${#PQ[@]} ]; do
        k=$P_N; PDEPTH=${PQD[qi]}
        _p_scan "${PQ[qi]}" "$PDEPTH"
        while [ $k -lt $P_N ]; do _p_expand $k; k=$((k+1)); done
        qi=$((qi+1))
    done
}

# $1 a file argument, $2 the command index. `-` is the command's stdin; a
# file not on disk yet may be written earlier on the same line by a heredoc
# (`cat > m.txt <<EOF … ; git commit -F m.txt`).
_p_file() {
    local f=$1 k
    if [ "$f" = - ]; then
        printf '%s' "${P_IN[$2]:-}"
        if [ "${P_PIPE[$2]:-0}" = 1 ] && [ "$2" -gt 0 ]; then
            k=$(( $2 - 1 )); printf '%s' "${P_IN[k]:-}"; _p_argv $k
            case "$NAME" in echo|printf) printf '%s\n' "${A[*]:1}" ;; esac
        fi
        return 0
    fi
    [ -n "$f" ] || return 0
    if [ -r "$f" ] && [ -f "$f" ]; then head -c 200000 -- "$f" 2>/dev/null; return 0; fi
    k=0
    while [ $k -lt $P_N ]; do
        case "$US${P_RD[k]:-}" in *"$US$f$US"*)
            printf '%s' "${P_IN[k]:-}"; _p_argv $k
            case "$NAME" in echo|printf) printf '%s\n' "${A[*]:1}" ;; esac ;;
        esac
        k=$((k+1))
    done
}

# ============================================================================
# Guards · decided on what the line runs
# ============================================================================
# §5 of the user's rules, read from kodflow/post-commit's patterns.txt and
# patterns-strict.txt, vendored at a pinned commit in ../patterns (SOURCE
# names it; scripts/sync-post-commit-patterns.sh moves it, CI checks the copy).
# A commit message meets every pattern, strict included. A pull or merge
# request title or body meets the `# @scope: commit,pr` ones only: it may
# well be about the tooling, so naming Claude Code or a .claude/ path there is
# ordinary prose. Issues, comments and reviews are not checked.
#
# Each pattern carries a motif: `attribution` for the commit,pr scope and the
# vendor keywords, `leak` for a commit-only pattern naming a workflow artefact
# (a .claude path, the Plan: footer). Leaks are tried before the keywords, so
# `\bclaude\b` does not report `.claude/plans/x.md` as an attribution.
PATTERNS_DIR=${BASH_SOURCE[0]%/*}/../patterns
ATTR_PATTERNS=(); COMMIT_PATTERNS=(); PATTERNS_LOADED=""

# Once per call, builtins only: patterns.sh's format (one ERE a line, `#` and
# blank lines skipped, `# @scope: <list>` for what follows, `commit` before
# the first) without its bash-4 reader. Any defect empties both lists, which
# _scan refuses rather than report a clean text.
_load_patterns() {
    [ -n "$PATTERNS_LOADED" ] && return 0
    PATTERNS_LOADED=1
    local f line rest cur s leak="" kw=""
    for f in "$PATTERNS_DIR/patterns.txt" "$PATTERNS_DIR/patterns-strict.txt"; do
        [ -r "$f" ] || { ATTR_PATTERNS=(); COMMIT_PATTERNS=(); return 0; }
        cur=commit
        while IFS= read -r line || [ -n "$line" ]; do
            case "$line" in
                '#'*)
                    rest=${line#\#}; rest=${rest#"${rest%%[![:space:]]*}"}
                    case "$rest" in '@scope:'*) ;; *) continue ;; esac
                    cur=${rest#@scope:}; cur=${cur//[[:space:]]/}
                    case "$cur" in ''|,*|*,|*,,*) ATTR_PATTERNS=(); COMMIT_PATTERNS=(); return 0 ;; esac
                    s=,$cur,
                    while [ -n "${s#,}" ]; do
                        s=${s#,}
                        case "${s%%,*}" in commit|pr) ;; *) ATTR_PATTERNS=(); COMMIT_PATTERNS=(); return 0 ;; esac
                        s=,${s#*,}
                    done
                    continue ;;
                '') continue ;;
            esac
            case ",$cur," in
                *,pr,*) ATTR_PATTERNS+=("$line") ;;
                *,commit,*)
                    case "$line" in
                        *'\.claude'*|*'plan:'*) leak=$leak$'\n'$line ;;
                        *) kw=$kw$'\n'$line ;;
                    esac ;;
            esac
        done < "$f"
    done
    while IFS= read -r line; do [ -n "$line" ] && COMMIT_PATTERNS+=("leak|$line"); done <<< "$leak"
    while IFS= read -r line; do [ -n "$line" ] && COMMIT_PATTERNS+=("attribution|$line"); done <<< "$kw"
}

# The vendor keywords (claude, anthropic) aim at a mention of the assistant,
# not at a name that happens to contain the word. A name is technical when the
# word is glued to an alphanumeric by - _ . or / (super-claude, claude-code.d.ts,
# CLAUDE.md, @anthropic-ai/sdk) or sits inside backticks. Such an occurrence is
# replaced by `x` before the keyword patterns run; `.claude/` leaks and the
# attribution patterns never see this text. $1 lowercased text.
_plain_names() {
    printf '%s' "$1" | sed -E \
        -e 's/`[^`]*(claude|anthropic)[^`]*`/ /g' \
        -e 's/([a-z0-9][-._\/])(claude|anthropic)/\1x/g' \
        -e 's/(claude|anthropic)([-_\/][a-z0-9]|\.[a-z0-9])/x\2/g'
}

# $1 kind (commit|pr), $2 text → F_ATTR "<motif> <pattern>" on the first hit.
_scan() {
    [ -n "$F_ATTR" ] && return 0
    local p hay hay2 r bad="(hooks/patterns unreadable or malformed: nothing to check $1 text against)"
    hay=$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')
    case "$hay" in *[![:space:]]*) ;; *) return 0 ;; esac
    _load_patterns
    if [ ${#ATTR_PATTERNS[@]} -eq 0 ] || [ ${#COMMIT_PATTERNS[@]} -eq 0 ]; then
        F_ATTR="attribution $bad"; F_ATTR_KIND=$1; return 0
    fi
    # grep exits 2 on a pattern it cannot compile: refused, never a non-match
    for p in "${ATTR_PATTERNS[@]}"; do
        printf '%s' "$hay" | grep -qiE -- "$p" 2>/dev/null; r=$?
        [ $r -eq 1 ] && continue
        [ $r -eq 0 ] && F_ATTR="attribution $p" || F_ATTR="attribution $bad"
        F_ATTR_KIND=$1; return 0
    done
    [ "$1" = commit ] || return 0
    local plain
    plain=$(_plain_names "$hay")
    for p in "${COMMIT_PATTERNS[@]}"; do
        # A leak is read on the text as written; a vendor keyword on the text
        # with technical names set aside, so `super-claude` is not a mention.
        if [ "${p%%|*}" = attribution ]; then hay2=$plain; else hay2=$hay; fi
        printf '%s' "$hay2" | grep -qiE -- "${p#*|}" 2>/dev/null; r=$?
        [ $r -eq 1 ] && continue
        [ $r -eq 0 ] && F_ATTR="${p%%|*} ${p#*|}" || F_ATTR="attribution $bad"
        F_ATTR_KIND=$1; return 0
    done
}

_is_noverify() { case "$1" in --no-veri|--no-verif|--no-verify) return 0 ;; esac; return 1; }

# The default branch names for a repository directory.
_defaults() {
    local h
    DEFAULTS=" main master "
    h=$(git -C "$1" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null) && DEFAULTS="$DEFAULTS${h#origin/} "
}

# $1 a path → 0 when its basename is mcp.json or .mcp.json, any case. Such a
# file may carry tokens: it is never added nor committed, only deleted.
_is_mcpjson() {
    case "${1##*/}" in [Mm][Cc][Pp].[Jj][Ss][Oo][Nn]|.[Mm][Cc][Pp].[Jj][Ss][Oo][Nn]) return 0 ;; esac
    return 1
}

# $1 the repository, $2 add, add-f, update or commit, then the pathspecs →
# prints the first mcp.json they would take in, a deletion left out. git
# status resolves them as git add and git commit do ("XY path", the old path
# after a rename; Y is the working tree). add-f lists ignored files too.
_mcpjson_specs() {
    local dir=$1 mode=$2 e f x w
    shift 2
    local -a opt=(--untracked-files=all)
    case "$mode" in add-f) opt+=(--ignored) ;; update|commit) opt=(--untracked-files=no) ;; esac
    while IFS= read -r -d '' e; do
        x=${e:0:1}; w=${e:1:1}; f=${e:3}
        case "$x" in R|C) IFS= read -r -d '' _ ;; esac
        _is_mcpjson "$f" || continue
        case "$w" in
            D) continue ;;
            " ") [ "$mode" = commit ] || continue     # staged already: only a commit takes it
                 case "$x" in D|" ") continue ;; esac ;;
        esac
        printf '%s' "$f"; return 0
    done < <(git -C "$dir" status --porcelain -z "${opt[@]}" -- "$@" 2>/dev/null)
    return 1
}

# $1 the --pathspec-from-file argument, $2 the command index, $3 the
# repository → one pathspec a line, appended to SPECS.
_specs_from() {
    local f=$1 l
    case "$f" in -|/*) ;; *) f=$3/$f ;; esac
    while IFS= read -r l; do [ -n "$l" ] && SPECS+=("$l"); done <<< "$(_p_file "$f" "$2")"
}

# $1 command index, A/NAME set. git: its globals, then the subcommand.
_guard_git() {
    local y=1 na=${#A[@]} gdir=$GDIR v lc sub msg="" farg="" hay
    local -a icfg=()
    local iauthor="" ireuse="" iamend=0 ireset=0 iunsure=0
    while [ $y -lt $na ]; do
        v=${A[y]}
        case "$v" in
            -C) v=${A[y+1]:-}; case "$v" in /*) gdir=$v ;; *) gdir=${gdir:+$gdir/}$v ;; esac; y=$((y+2)); continue ;;
            -c|--config-env)
                lc=$(printf '%s' "${A[y+1]:-}" | tr '[:upper:]' '[:lower:]')
                case "$lc" in core.hookspath=*) F_HOOKS=1 ;; esac
                icfg+=("$v" "${A[y+1]:-}")
                y=$((y+2)); continue ;;
            --config-env=*) lc=$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]'); case "$lc" in *=core.hookspath=*) F_HOOKS=1 ;; esac
                icfg+=("$v") ;;
            --git-dir|--work-tree) icfg+=("$v" "${A[y+1]:-}"); y=$((y+2)); continue ;;
            --git-dir=*|--work-tree=*) icfg+=("$v") ;;
            --namespace|--super-prefix) y=$((y+2)); continue ;;
            -*) ;;
            *) break ;;
        esac
        y=$((y+1))
    done
    case "$gdir" in /*) ;; "") gdir=$PROJECT_DIR ;; *) gdir=$PROJECT_DIR/$gdir ;; esac
    sub=${A[y]:-}; y=$((y+1))
    case "$sub" in
        commit|push|rebase|cherry-pick|merge|am|apply|revert)
            F_ROOT="git $sub from the main thread produces into a repository." ;;
        worktree) [ "${A[y]:-}" = add ] && F_ROOT="git worktree from the main thread produces into a repository." ;;
        reset) case " ${A[*]:y} " in *" --hard "*) F_ROOT="git reset from the main thread produces into a repository." ;; esac ;;
    esac
    case "$sub" in
        commit|push|merge|am|rebase|cherry-pick|revert|pull) [ "$F_HOOKS" = 1 ] && F_NV="git -c core.hooksPath on git $sub" ;;
    esac
    case "$sub" in
        add|stage)
            # Every word but an option's names a pathspec, -f or not; then
            # git status says what `.`, a directory, a glob or -A would take
            # in. A file the same line creates first is not seen yet.
            local mode=add all=0 f
            SPECS=()
            while [ $y -lt $na ]; do
                v=${A[y]}
                case "$v" in
                    --pathspec-from-file) _specs_from "${A[y+1]:-}" "$1" "$gdir"; y=$((y+2)); continue ;;
                    --pathspec-from-file=*) _specs_from "${v#*=}" "$1" "$gdir" ;;
                    --) ;;
                    --all|--no-ignore-removal) all=1 ;;
                    --update) all=1; [ $mode = add ] && mode=update ;;
                    --force) mode=add-f ;;
                    --*) ;;
                    -*) case "$v" in *f*) mode=add-f ;; esac
                        case "$v" in *A*) all=1 ;; esac
                        case "$v" in *u*) all=1; [ $mode = add ] && mode=update ;; esac ;;
                    *) _is_mcpjson "$v" && F_MCPJSON="git $sub $v"; SPECS+=("$v") ;;
                esac
                y=$((y+1))
            done
            if [ -z "$F_MCPJSON" ] && { [ ${#SPECS[@]} -gt 0 ] || [ $all = 1 ]; }; then
                f=$(_mcpjson_specs "$gdir" $mode ${SPECS[@]+"${SPECS[@]}"}) && F_MCPJSON="git $sub would add $f"
            fi ;;
        commit)
            F_COMMIT=1; F_CGDIR=$gdir
            SPECS=()
            while [ $y -lt $na ]; do
                v=${A[y]}
                case "$v" in
                    --) y=$((y+1))
                        while [ $y -lt $na ]; do _is_mcpjson "${A[y]}" && F_MCPJSON="git commit ${A[y]}"; SPECS+=("${A[y]}"); y=$((y+1)); done
                        break ;;
                    --pathspec-from-file) _specs_from "${A[y+1]:-}" "$1" "$gdir"; y=$((y+2)); continue ;;
                    --pathspec-from-file=*) _specs_from "${v#*=}" "$1" "$gdir" ;;
                    -m|--message|--trailer) msg=$msg$'\n'${A[y+1]:-}; y=$((y+2)); continue ;;
                    --message=*|--trailer=*) msg=$msg$'\n'${v#*=} ;;
                    -F|--file) farg=${A[y+1]:-}; y=$((y+2)); continue ;;
                    --file=*) farg=${v#*=} ;;
                    --author) iauthor=${A[y+1]:-}; y=$((y+2)); continue ;;
                    --author=*) iauthor=${v#*=} ;;
                    -C|-c|--reuse-message|--reedit-message) ireuse=${A[y+1]:-}; y=$((y+2)); continue ;;
                    --reuse-message=*|--reedit-message=*) ireuse=${v#*=} ;;
                    --reset-author) ireset=1 ;;
                    -t|--date|--cleanup|--template|--fixup|--squash) y=$((y+2)); continue ;;
                    --amend) F_AMEND=1; iamend=1 ;;
                    --all) F_CALL=1 ;;
                    --*) _is_noverify "$v" && F_NV="--no-verify on git commit" ;;
                    -*)   # a short cluster: n is --no-verify, m F C c t take the rest or the next word
                        local cl=${v#-} ch rest
                        while [ -n "$cl" ]; do
                            ch=${cl:0:1}; rest=${cl:1}
                            case "$ch" in
                                n) F_NV="-n (--no-verify) on git commit" ;;
                                a) F_CALL=1 ;;
                                u|S) break ;;   # -uno, -S<key>: an attached optional argument
                                m|F|C|c|t)
                                    if [ -z "$rest" ]; then rest=${A[y+1]:-}; y=$((y+1)); fi
                                    case "$ch" in m) msg=$msg$'\n'$rest ;; F) farg=$rest ;; C|c) ireuse=$rest ;; esac
                                    break ;;
                            esac
                            cl=$rest
                        done ;;
                    *) _is_mcpjson "$v" && F_MCPJSON="git commit $v"; SPECS+=("$v") ;;   # a pathspec
                esac
                y=$((y+1))
            done
            # A pathspec (`.`, a directory) takes the working tree's copy in
            if [ -z "$F_MCPJSON" ] && [ ${#SPECS[@]} -gt 0 ]; then
                v=$(_mcpjson_specs "$gdir" commit "${SPECS[@]}") && F_MCPJSON="git commit ${SPECS[*]} takes in $v"
            fi
            hay=$msg
            [ -n "$farg" ] && hay=$hay$'\n'$(_p_file "$farg" "$1")
            [ "${F_AMEND:-0}" = 1 ] && [ -z "$msg$farg" ] && hay=$hay$'\n'$(git -C "$gdir" log -1 --pretty=%B 2>/dev/null)
            _scan commit "$hay"
            # The identity this very commit goes out with (lib/identity.sh).
            # A value the reader cannot know (a $ or a backtick) is not judged.
            [ -n "$F_IDENT_T" ] && return 0
            case "${icfg[*]} $iauthor $ireuse ${ID_LINE_ENV[*]} ${ID_CMD_ENV[*]}" in *[\$\`]*) iunsure=1 ;; esac
            . "$LIB/identity.sh" 2>/dev/null || return 0
            KF_ID_CFG=(${icfg[@]+"${icfg[@]}"}); KF_ID_ENV=(${ID_LINE_ENV[@]+"${ID_LINE_ENV[@]}"} ${ID_CMD_ENV[@]+"${ID_CMD_ENV[@]}"})
            KF_ID_AUTHOR=$iauthor; KF_ID_REUSE=$ireuse; KF_ID_AMEND=$iamend; KF_ID_RESET=$ireset; KF_ID_UNSURE=$iunsure
            kf_ident_check "$gdir"
            case $? in
                2) F_IDENT_T=$KF_ID_TITLE; F_IDENT_M=("${KF_ID_MSG[@]}") ;;
                3) F_IDENT_OFF=absent ;;
                4) F_IDENT_OFF="malformed ($KF_IR_ERR)" ;;
            esac ;;
        merge)
            while [ $y -lt $na ]; do
                v=${A[y]}
                case "$v" in
                    -m) _scan commit "${A[y+1]:-}"; y=$((y+2)); continue ;;
                    -F|--file) _scan commit "$(_p_file "${A[y+1]:-}" "$1")"; y=$((y+2)); continue ;;
                    --*) _is_noverify "$v" && F_NV="--no-verify on git merge" ;;
                esac
                y=$((y+1))
            done ;;
        rebase|cherry-pick)
            for v in "${A[@]:y}"; do _is_noverify "$v" && F_NV="--no-verify on git $sub"; done
            _scan commit "$(git -C "$gdir" log -5 --pretty=%B 2>/dev/null)" ;;
        am|revert|pull)
            for v in "${A[@]:y}"; do _is_noverify "$v" && F_NV="--no-verify on git $sub"; done ;;
        push) _guard_push "$1" ;;
    esac
}

# git push: --no-verify, a forced push, and (subagent) the default branch.
_guard_push() {
    local v pos=0 refs="" force=0 all=0 r dst cur
    while [ $y -lt $na ]; do
        v=${A[y]}
        case "$v" in
            --force-with-lease*|--force-if-includes|--no-force-*) ;;
            --force) force=1 ;;
            --mirror|--all|--branches) all=1 ;;
            --repo|--receive-pack|--exec|--push-option|-o) y=$((y+1)) ;;
            --*) _is_noverify "$v" && F_NV="--no-verify on git push" ;;
            -*) case "$v" in *f*) force=1 ;; esac ;;
            *) pos=$((pos+1)); [ $pos -ge 2 ] && refs="$refs$v$US"
               case "$v" in +*) [ $pos -ge 2 ] && force=1 ;; esac ;;
        esac
        y=$((y+1))
    done
    [ $force = 1 ] && F_FORCE=1
    [ -n "$AID" ] || return 0
    _defaults "$gdir"
    if [ $all = 1 ]; then F_DEFPUSH="git push --all/--mirror includes the default branch"; return 0; fi
    if [ -z "$refs" ]; then
        cur=$(git -C "$gdir" symbolic-ref --short HEAD 2>/dev/null)
        case "$DEFAULTS" in *" $cur "*) [ -n "$cur" ] && F_DEFPUSH="git push from $cur, the default branch" ;; esac
        return 0
    fi
    while [ -n "$refs" ]; do
        r=${refs%%"$US"*}; refs=${refs#*"$US"}; r=${r#+}
        dst=${r#*:}
        if [ "$dst" = HEAD ] || [ "$r" = HEAD ]; then dst=$(git -C "$gdir" symbolic-ref --short HEAD 2>/dev/null); fi
        dst=${dst#refs/heads/}
        case "$DEFAULTS" in *" $dst "*) [ -n "$dst" ] && F_DEFPUSH="git push to $dst, the default branch" ;; esac
    done
}

_merge_re='(^|/)pulls/[^/[:space:]]+/merge/?$|merge_requests/[^/[:space:]]+/merge/?$'
_merge_words='mergePullRequest|enablePullRequestAutoMerge|merge_when_pipeline_succeeds'

# gh: pr create/edit text, pr merge, and the REST/GraphQL equivalents.
_guard_gh() {
    local y=1 na=${#A[@]} sub act v f hay="" ep=""
    while [ $y -lt $na ]; do case "${A[y]}" in -R|--repo|--hostname) y=$((y+2)) ;; -*) y=$((y+1)) ;; *) break ;; esac; done
    sub=${A[y]:-}; act=${A[y+1]:-}
    case "$sub/$act" in
        pr/create|pr/edit)
            [ "$act" = create ] && F_ROOT="gh pr create from the main thread: opening the PR is the subagent's delivery."
            y=$((y+2))
            while [ $y -lt $na ]; do
                v=${A[y]}
                case "$v" in
                    -t|--title|-b|--body) hay=$hay$'\n'${A[y+1]:-}; y=$((y+2)); continue ;;
                    --title=*|--body=*) hay=$hay$'\n'${v#*=} ;;
                    -F|--body-file) hay=$hay$'\n'$(_p_file "${A[y+1]:-}" "$1"); y=$((y+2)); continue ;;
                    --body-file=*) hay=$hay$'\n'$(_p_file "${v#*=}" "$1") ;;
                    -R|--repo|-B|--base|-H|--head|-a|--assignee|-l|--label|-m|--milestone|-p|--project|-r|--reviewer|-T|--template|--add-*|--remove-*) y=$((y+2)); continue ;;
                esac
                y=$((y+1))
            done
            _scan pr "$hay" ;;
        pr/merge) F_MERGE="gh pr merge" ;;
        api/*)
            y=$((y+1))
            while [ $y -lt $na ]; do
                v=${A[y]}
                case "$v" in
                    -f|--raw-field|-F|--field)
                        f=${A[y+1]:-}
                        case "$f" in *=@*) hay=$hay$'\n'$(_p_file "${f#*=@}" "$1") ;; *) hay=$hay$'\n'${f#*=} ;; esac
                        y=$((y+2)); continue ;;
                    --input) hay=$hay$'\n'$(_p_file "${A[y+1]:-}" "$1"); y=$((y+2)); continue ;;
                    -X|--method|-H|--header|-q|--jq|-t|--template|-p|--preview|--hostname|--cache) y=$((y+2)); continue ;;
                    -*) ;;
                    *) [ -z "$ep" ] && ep=$v ;;
                esac
                y=$((y+1))
            done
            if [[ $ep =~ $_merge_re ]]; then F_MERGE="gh api $ep"
            elif [ "$ep" = graphql ]; then
                [[ $hay =~ $_merge_words ]] && F_MERGE="gh api graphql ${BASH_REMATCH[0]}"
                [[ $hay =~ (create|update)PullRequest ]] && _scan pr "$hay"
            elif [[ $ep =~ (^|/)pulls(/[^/]+)?/?$ ]]; then _scan pr "$hay"
            fi ;;
    esac
}

# glab: mr create/update text, mr merge, and the API.
_guard_glab() {
    local y=1 na=${#A[@]} sub act v hay=""
    while [ $y -lt $na ]; do case "${A[y]}" in -R|--repo) y=$((y+2)) ;; -*) y=$((y+1)) ;; *) break ;; esac; done
    sub=${A[y]:-}; act=${A[y+1]:-}
    [[ ${A[*]} =~ $_merge_words ]] && F_MERGE="glab ${BASH_REMATCH[0]}"
    case "$sub/$act" in
        mr/create|mr/update)
            [ "$act" = create ] && F_ROOT="glab mr create from the main thread: opening the PR is the subagent's delivery."
            y=$((y+2))
            while [ $y -lt $na ]; do
                v=${A[y]}
                case "$v" in
                    -t|--title|-d|--description) hay=$hay$'\n'${A[y+1]:-}; y=$((y+2)); continue ;;
                    --title=*|--description=*) hay=$hay$'\n'${v#*=} ;;
                esac
                y=$((y+1))
            done
            _scan pr "$hay" ;;
        mr/merge) F_MERGE="glab mr merge" ;;
        api/*)
            y=$((y+1))
            while [ $y -lt $na ]; do
                case "${A[y]}" in
                    -X|--method|-H|--header|-f|--raw-field|-F|--field|--hostname|--input) y=$((y+2)); continue ;;
                    -*) ;;
                    *) [[ ${A[y]} =~ $_merge_re ]] && F_MERGE="glab api ${A[y]}"; break ;;
                esac
                y=$((y+1))
            done ;;
    esac
}

# curl and friends: only a merge, by its endpoint or its GraphQL mutation.
_guard_http() {
    local v
    for v in "${A[@]:1}"; do
        if [[ $v =~ $_merge_re ]] || [[ $v =~ $_merge_words ]]; then F_MERGE="$NAME ${BASH_REMATCH[0]}"; return 0; fi
        [[ $v =~ /pulls/[^/[:space:]]+/merge([/?[:space:]]|$) ]] && { F_MERGE="$NAME …/merge"; return 0; }
    done
}

# L0.6 · a skills directory never receives plugin machinery. A hooks.json or
# a .claude-plugin/ there would load code (hooks, modules) beside these
# guards without going through a marketplace. $1 a path → 0 when refused.
_mod_path() {
    local f=$1 cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
    case "$f" in "~/"*) f=$HOME/${f#"~/"} ;; esac
    f=/${f#/}
    case "$f" in */.claude/skills/*|"${cfg%/}"/skills/*) ;; *) return 1 ;; esac
    case "$f" in */.claude-plugin/*|*/.claude-plugin|*/hooks/hooks.json) return 0 ;; esac
    return 1
}

# claude plugin install|i and claude plugin marketplace add: only from the
# kodflow marketplace. A plugin named without @marketplace is refused, its
# source cannot be told.
_guard_claude() {
    local y na=${#A[@]} v spec=""
    case "${A[1]:-}" in plugin|plugins) ;; *) return 0 ;; esac
    case "${A[2]:-}" in
        install|i) y=3 ;;
        marketplace) [ "${A[3]:-}" = add ] || return 0; y=4 ;;
        *) return 0 ;;
    esac
    while [ $y -lt $na ]; do
        v=${A[y]}
        case "$v" in -s|--scope) y=$((y+2)); continue ;; -*) ;; *) spec=$v; break ;; esac
        y=$((y+1))
    done
    [ -n "$spec" ] || return 0
    case "${A[2]}/$spec" in
        install/*@kodflow|i/*@kodflow) ;;
        marketplace/*kodflow/claude-marketplace|marketplace/*kodflow/claude-marketplace.git|marketplace/*kodflow/claude-marketplace/) ;;
        *) F_PLUG="claude plugin ${A[2]}${A[3]:+ ${A[3]}} $spec" ;;
    esac
}

_motif_block() {   # $1 motif, $2 title, rest = lines. The motif line is what tests compare.
    local m=$1; shift
    local t=$1; shift
    _block "$t" "$@" "[motif:$m]"
}

_mcpjson_block() {   # $1 what adds or commits the file
    _motif_block mcp-json "BLOCKED — an mcp.json file is never committed ($1)" \
        "mcp.json and .mcp.json may carry tokens: neither is added nor committed, at any path." \
        "Deleting one stays allowed: git rm --cached <path>, then commit the deletion." \
        "A plugin declares its MCP servers in plugin.json (mcpServers), not in a .mcp.json."
}

# ============================================================================
# Delegation gate · code in a git repository is produced by a subagent
# ============================================================================
# The user's rule: the main thread triages, dispatches, reviews and merges
# after the user's OK; code production in a git repository is delegated to a
# subagent working in its own worktree and delivering through a PR. The main
# thread keeps every other permission — it is also the workstation's sysadmin
# (sudo, apt, systemctl, files outside repositories, configuration). So the
# gate refuses exactly two things: a write inside a git work tree, and the git
# or forge operations that produce into a repository.
_root_deny() {
    ROOT_GUARD=deny
    _block "BLOCKED — code production in a repository is delegated" \
        "$1" \
        "Dispatch the epic's subagent (task_focus the epic first), or SendMessage it if it is running;" \
        "it works in its own worktree (<repo parent>/.worktrees/<repo>-<epic-slug>, or ~/Projects/.worktrees/<repo>-<epic-slug> when that parent is or sits under ~/Documents, ~/Desktop or ~/Downloads) and delivers through a PR." \
        "A genuine exception: prefix the Bash line with ROOT_OK=1 (KODFLOW_ROOT=off turns the gate off)." \
        "[motif:root]"
}

# GATE · Write/Edit. Refused only inside a git work tree: the file's
# directory and its parents are walked up looking for .git (a directory, or
# the gitdir file of a worktree or submodule) — plain tests, no exec. The path
# is normalised lexically first so /repo/x/../../tmp/f is judged as /tmp/f.
# The main thread's memory and the Claude configuration stay writable even
# when they live inside a repository.
_root_gate_edit() {
    [ "$ROOT_MAIN" = 1 ] || return 0
    local f=${FILE:-$NB} cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude} part d
    [ -n "$f" ] || return 0
    [[ $f = /* ]] || f=${CWD:-$PWD}/$f
    local -a out=()
    local IFS=/
    set -f
    for part in $f; do
        case "$part" in ""|.) ;; ..) [ ${#out[@]} -gt 0 ] && unset 'out[${#out[@]}-1]' ;; *) out+=("$part") ;; esac
    done
    set +f
    f="/${out[*]}"
    unset IFS
    cfg=${cfg%/}
    case "$f" in
        "$cfg"/projects/*/memory/*|"$cfg"/settings.json|"$cfg"/settings.local.json|"$cfg"/CLAUDE.md|"$HOME"/CLAUDE.md) return 0 ;;
    esac
    d=${f%/*}
    while :; do
        [ -e "${d:-}/.git" ] && _root_deny "$f is inside the git work tree ${d:-/}."
        [ -z "$d" ] && break
        d=${d%/*}
    done
}

# ============================================================================
# PreToolUse · Bash
# ============================================================================
# The input is never rewritten (D3): a forced push is refused with the
# command to run instead, and rtk is the caller's choice, not this hook's.
pre_bash() {
    [ -n "$CMD" ] || exit 0
    F_ROOT=""; F_NV=""; F_HOOKS=0; F_ATTR=""; F_ATTR_KIND=""; F_COMMIT=0; F_FORCE=0; F_MERGE=""; F_DEFPUSH=""; F_AMEND=0
    F_MODW=""; F_PLUG=""; GDIR=""; F_MCPJSON=""; F_CALL=0; F_CGDIR=""
    F_IDENT_T=""; F_IDENT_M=(); F_IDENT_OFF=""; ID_LINE_ENV=(); ID_CMD_ENV=()

    # GATE: no verb this hook knows, even once unquoted, leaves at once. A
    # $'…' string may spell one in escapes, so it is always read. tr, not
    # ${CMD//…/}: a global substitution is quadratic in bash 3.2 (1.5 s on a
    # 2.5 kB commit message).
    local t=$CMD
    case "$t" in *[\"\'\\]*) t=$(printf '%s' "$CMD" | tr -d "\"'\\\\") ;; esac
    case "$t" in *git*|*gh*|*glab*|*curl*|*wget*|*http*|*skills*|*claude*) ;; *) case "$CMD" in *"\$'"*) ;; *) _log; exit 0 ;; esac ;; esac

    _p_parse "$CMD"
    local k=0 rd r
    while [ $k -lt $P_N ]; do
        rd=${P_RD[k]:-}
        while [ -n "$rd" ]; do
            r=${rd%%"$US"*}; rd=${rd#*"$US"}
            _mod_path "$r" && F_MODW=$r
        done
        _p_argv $k; F_HOOKS=0
        _ident_env $k
        case "$NAME" in
            claude) _guard_claude ;;
            git) _guard_git $k ;;
            gh) _guard_gh $k ;;
            glab) _guard_glab $k ;;
            curl|wget|http|https|xh) _guard_http ;;
            cd) r=${A[1]:-}; case "$r" in /*|"") GDIR=$r ;; *) GDIR=${GDIR:+$GDIR/}$r ;; esac ;;
        esac
        k=$((k+1))
    done

    # --- BLOCK 0: the delegation gate (main thread only) ---------------------
    if [ -n "$F_ROOT" ] && [ "$ROOT_MAIN" = 1 ] \
        && ! [[ $CMD =~ ^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*ROOT_OK=1([[:space:]]|$) ]]; then
        _root_deny "$F_ROOT"
    fi

    # --- BLOCK 1: --no-verify, -n on a commit, core.hooksPath ---------------
    # They skip the repo's own commit-msg hook, the second layer of the
    # attribution guard.
    [ -n "$F_NV" ] && _motif_block no-verify "COMMAND BLOCKED — skipping git hooks is forbidden ($F_NV)" \
        "Local git hooks are the second layer of the attribution and secret guards." \
        "If a hook is wrong, fix the hook; do not skip it."

    # --- BLOCK 2: AI attribution and workflow leaks -------------------------
    if [ -n "$F_ATTR" ]; then
        local motif=${F_ATTR%% *}
        _motif_block "$motif" "$( [ "$F_ATTR_KIND" = pr ] && echo "PULL REQUEST" || echo "COMMIT" ) BLOCKED — AI reference detected" \
            "Forbidden pattern: ${F_ATTR#* }" \
            "Remove AI attribution (co-authored-by, generated by, 🤖) and, in a commit, workflow leaks (.claude/ paths, Plan: footers)." \
            "The repo's commit-msg hook and the post-commit gate block the same thing."
    fi

    # --- BLOCK 2b: the commit's identity is the one its forge expects -------
    # The user's rules (lib/identity.sh); no rules file, the check is off.
    [ -n "$F_IDENT_T" ] && _motif_block commit-identity "$F_IDENT_T" "${F_IDENT_M[@]}"

    # --- BLOCK 3: mcp.json added or changed, secrets in the staged blobs ----
    # One read of the index serves both. It is the index, not the working
    # tree, but for git commit -a, which stages the tracked changes first.
    # A deletion is allowed: it is how a repository is cleaned. Hook and test
    # sources are skipped by the secret scan: they carry detection patterns
    # that match themselves. The alternation is assembled so this file does
    # not itself read as a credential to a line scanner.
    local hits=""
    if [ "$F_COMMIT" = 1 ]; then
        local f st content kw tok oth pat cg=${F_CGDIR:-$PROJECT_DIR}
        kw="pass""word|api[_-]?key|secret""_key"
        tok="gh""p_[a-zA-Z0-9]{36}|gh""o_[a-zA-Z0-9]{36}|github""_pat_[a-zA-Z0-9_]+"
        oth="aws[_-]?access[_-]?key|BEGIN RSA PRIV""ATE KEY|BEGIN OPENSSH PRIV""ATE KEY|sk""-[a-zA-Z0-9]{48}|AK""IA[0-9A-Z]{16}"
        pat="(${kw})"'\s*=\s*["\047][^"\047]+'"|${tok}|${oth}"
        # status, then the path; a rename or a copy names the old path first
        while IFS= read -r -d '' st && IFS= read -r -d '' f; do
            case "$st" in R*|C*) IFS= read -r -d '' f || break ;; esac
            case "$st" in D*) continue ;; esac
            [ -z "$F_MCPJSON" ] && _is_mcpjson "$f" && F_MCPJSON="$f is staged"
            case "$f" in */hooks/scripts/*|*/.claude/scripts/*|*/.claude/agents/*|*/.githooks/*|*/tests/*|*/fixtures/*|*.bats|*.tpl) continue ;; esac
            content=$(git -C "$cg" show ":$f" 2>/dev/null) || continue
            printf '%s' "$content" | grep -qI . || continue      # binary
            printf '%s' "$content" | grep -iEq "$pat" && hits="$hits"$'\n'"  - $f"
        done < <(git -C "$cg" diff --cached --name-status -z 2>/dev/null)
        if [ "$F_CALL" = 1 ] && [ -z "$F_MCPJSON" ]; then
            while IFS= read -r -d '' st && IFS= read -r -d '' f; do
                case "$st" in D*) continue ;; esac
                _is_mcpjson "$f" && { F_MCPJSON="$f is modified and git commit -a stages it"; break; }
            done < <(git -C "$cg" diff --name-status -z 2>/dev/null)
        fi
    fi
    [ -n "$F_MCPJSON" ] && _mcpjson_block "$F_MCPJSON"
    [ -n "$hits" ] && _motif_block secrets "COMMIT BLOCKED — secrets detected in staged files" "Remove them before committing:$hits"

    # --- BLOCK 3b: plugin machinery under skills, plugins from elsewhere ----
    # cp, tee, sed -i and git clone into a skills directory are not read
    # (known gaps in the corpus): only a shell redirection is.
    [ -n "$F_MODW" ] && _motif_block mod-write "COMMAND BLOCKED — plugin machinery written under a skills directory ($F_MODW)" \
        "A hooks.json or .claude-plugin/ there loads code beside these guards without a marketplace." \
        "Ship it as a plugin of the kodflow marketplace instead."
    [ -n "$F_PLUG" ] && _motif_block plugin-source "COMMAND BLOCKED — plugin from outside the kodflow marketplace ($F_PLUG)" \
        "Only kodflow plugins (name@kodflow) and the kodflow/claude-marketplace marketplace are installed here." \
        "Ask the user to install it themselves if it is wanted."

    # --- BLOCK 4: a forced push is refused, with the command to run ---------
    if [ "$F_FORCE" = 1 ]; then
        local fixed
        fixed=$(printf '%s' "$CMD" | sed -E 's/(^|[[:space:]])(--force|-f)([[:space:]]|$)/\1--force-with-lease\3/g; s/([[:space:]])\+([^[:space:]]+)/\1\2/g')
        [[ $fixed == *--force-with-lease* ]] || fixed="$fixed --force-with-lease"
        _motif_block force "COMMAND BLOCKED — forced push" \
            "--force, -f and a +refspec overwrite the remote without checking what is there." \
            "Run instead: $fixed"
    fi

    # --- BLOCK 5: a subagent never merges nor pushes to the default branch --
    if [ -n "$AID" ]; then
        [ -n "$F_MERGE" ] && _motif_block merge "COMMAND BLOCKED — a subagent does not merge ($F_MERGE)" \
            "Merging is the main thread's decision." \
            "Report the PR and its CI state; stop there."
        [ -n "$F_DEFPUSH" ] && _motif_block push-default "COMMAND BLOCKED — a subagent does not push to the default branch ($F_DEFPUSH)" \
            "Push your feature branch and open a PR."
    elif [ -n "$F_MERGE" ]; then
        # The main thread's merge is journaled, never asked about.
        ROOT_GUARD=merge
    fi
    _ident_notice
    _log
    exit 0
}

# The commit-identity check off (no rules file) or void (a malformed one):
# said once a session per state, to the user, and the commit goes on.
_ident_notice() {
    [ -n "$F_IDENT_OFF" ] || return 0
    local mark=$SDIR/commit-identity-notice prev="" file
    [ -f "$mark" ] && read -r prev < "$mark" 2>/dev/null
    [ "$prev" = "$F_IDENT_OFF" ] && return 0
    mkdir -p "$SDIR" 2>/dev/null && printf '%s\n' "$F_IDENT_OFF" > "$mark" 2>/dev/null
    file=$(kf_ident_file 2>/dev/null)
    jq -n -c --arg m "kodflow-hooks: commit identity not checked, rules file $F_IDENT_OFF: $file (see the kodflow-hooks README, commit identity)" \
        '{systemMessage:$m}' 2>/dev/null
}

# $1 command index: the variables a command line hands git. `export X=v` and
# `unset X` hold for the rest of the line (ID_LINE_ENV), a bare `X=v` too
# when X is already exported; `X=v git …` and `env [-i] [-u X] X=v git …`
# for that command only (ID_CMD_ENV). Only what can change an identity:
# GIT_*, EMAIL, HOME, XDG_CONFIG_HOME.
_ident_env() {
    local w x=0 nw inenv=0 re='^(GIT_[A-Z_]+|EMAIL|HOME|XDG_CONFIG_HOME)='
    ID_CMD_ENV=()
    _p_words "${P_W[$1]}"; nw=${#W[@]}
    case "$NAME" in
        export|unset)
            for w in "${W[@]:1}"; do
                if [ "$NAME" = unset ]; then [[ $w=x =~ $re ]] && ID_LINE_ENV+=("-$w")
                else [[ $w =~ $re ]] && ID_LINE_ENV+=("$w"); fi
            done
            return 0 ;;
        '')
            for w in "${W[@]}"; do
                [[ $w =~ $re ]] && [ -n "$(printenv "${w%%=*}" 2>/dev/null)" ] && ID_LINE_ENV+=("$w")
            done
            return 0 ;;
    esac
    while [ $x -lt $nw ]; do
        w=${W[x]}
        if [[ $w =~ $re ]]; then ID_CMD_ENV+=("$w")
        elif [[ $w =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then :
        elif [ $inenv = 0 ]; then
            case "$w" in '!'|'{'|'}'|if|then|else|elif|do|while|until) x=$((x+1)); continue ;; esac
            [ "${w##*/}" = env ] && inenv=1 || break
        else
            case "$w" in
                -i|--ignore-environment|-) ID_CMD_ENV+=('!') ;;
                -u|--unset) x=$((x+1)); ID_CMD_ENV+=("-${W[x]:-}") ;;
                --unset=*) ID_CMD_ENV+=("-${w#*=}") ;;
                -C|-S|--chdir) x=$((x+1)) ;;
                -*) ;;
                *) break ;;
            esac
        fi
        x=$((x+1))
    done
}

# ============================================================================
# PreToolUse · task list (the built-in tools)
# ============================================================================
# The kodflow task tools are the mod's (hooks/mod/register.ts): a call it
# answers never reaches this script, and the mod tells each caller apart by
# itself. The built-in task tools draw their own panel in the chat, a second
# copy of the list the status line already shows: refused while the mod's
# tools answer (lib/beat.sh), let through when they do not, since a session
# without the mod has no other list.
pre_builtin_tasks() {
    [ "$BEAT" = 0 ] || { _log; exit 0; }
    _block "USE THE KODFLOW TASK TOOLS" \
        "$TOOL draws a second task list in the chat. Use the kodflow task tools instead:" \
        "task_create (subject: 30 characters at most), task_update (id, status), task_list," \
        "task_epic / task_focus (one epic per subject). Statuses: pending, in_progress, waiting, completed, deleted."
}

# ============================================================================
# PreToolUse · Write / Edit / MultiEdit / NotebookEdit
# ============================================================================
pre_edit() {
    _root_gate_edit
    _mod_path "${FILE:-$NB}" && _motif_block mod-write "EDIT BLOCKED — plugin machinery under a skills directory" \
        "${FILE:-$NB}: a hooks.json or .claude-plugin/ there loads code beside these guards without a marketplace." \
        "Ship it as a plugin of the kodflow marketplace instead."
    [ -n "$FILE" ] || exit 0

    # --- BLOCK: protected paths ----------------------------------------------
    # Globs, matched against the path's tail so `*.lock` means the basename and
    # `node_modules/` means a directory anywhere in the path. A project lists
    # its own in .claude/protected-paths, one glob per line.
    case "$FILE" in *.md|*/README*|*/CHANGELOG*|*/.claude/contexts/*|*/.claude/plans/*|*/.claude/goals/*) ;; *)
        local p pats=()
        if [ -f "$PROJECT_DIR/.claude/protected-paths" ]; then
            while IFS= read -r p; do [ -n "$p" ] && [ "${p:0:1}" != "#" ] && pats+=("$p"); done < "$PROJECT_DIR/.claude/protected-paths"
        else
            pats=('node_modules/' '.git/' 'vendor/' 'dist/' 'build/' '.env*' '*.lock' 'package-lock.json' 'yarn.lock' 'pnpm-lock.yaml' 'go.sum')
        fi
        for p in "${pats[@]}"; do
            case "$p" in
                */) p=${p%/}; if [[ $FILE == */$p/* ]]; then _block "EDIT BLOCKED — protected path" "$FILE matches $p/"; fi ;;
                *)  if [[ $FILE == */$p || $FILE == $p ]]; then _block "EDIT BLOCKED — protected path" "$FILE matches $p"; fi ;;
            esac
        done ;;
    esac

    # No linter call before the edit: the file is linted once it is written
    # (post_edit, lib/lint.sh), and not at all when ktn-linter's own hooks
    # (`ktn-linter hook install`, kodflow/ktn-linter#771) already do it.
    _log
    exit 0
}

# ============================================================================
# PostToolUse · Write / Edit / MultiEdit / NotebookEdit
# ============================================================================
post_edit() {
    [ -n "$FILE" ] && [ -f "$FILE" ] || { _log; exit 0; }
    KF_DOCS_CTX=""; _docs_post
    case "$FILE" in *.md|*/.claude/*|"$HOME"/.claude/*) _log; exit 0 ;; esac
    local ctx=$KF_DOCS_CTX

    # --- TRANSFORM: format, and say so when the bytes changed ----------------
    # A formatter that rewrites the file makes Claude's next old_string miss.
    # Telling it to re-read costs one line; a failed Edit costs a round trip.
    if [ -f "$LIB/format.sh" ]; then
        local before after
        # shellcheck source=lib/format.sh
        . "$LIB/format.sh"
        before=$(cksum < "$FILE" 2>/dev/null)
        hook_format "$FILE"
        after=$(cksum < "$FILE" 2>/dev/null)
        [ "$before" != "$after" ] && ctx="Reformatted by ${FMT_TOOL:-the project formatter}: $FILE changed on disk. Read it again before the next Edit."
    fi

    # --- OBSERVE: remember the edit for the Stop hook --------------------------
    # A plain append: the path is data, never part of a command.
    mkdir -p "$STATE" 2>/dev/null && printf '%s\n' "$FILE" >> "$STATE/edited" 2>/dev/null

    # --- TRANSFORM: ktn-linter on the Go file just edited (lib/lint.sh) ------
    # After the formatter, while the model still holds the file; nothing when
    # ktn-linter's own PostToolUse hook already lints it. KODFLOW_LINT=off.
    if [ "${KODFLOW_LINT:-}" != off ] && [ -f "$LIB/lint.sh" ] && [ "$TOOL" != NotebookEdit ]; then
        # shellcheck source=lib/lint.sh
        . "$LIB/lint.sh" && kf_lint "$FILE" "$PROJECT_DIR" "$STATE" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "$TOOL"
        [ -n "$KF_LINT" ] && ctx="${ctx:+$ctx
}$KF_LINT"
    fi

    # --- OBSERVE: risky constructs, once per session each ------------------------
    # PostToolUse additionalContext is the channel Claude actually reads;
    # stderr on exit 0 never reaches it.
    local new entry pattern
    new=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // ""' 2>/dev/null | head -c 200000)
    if [ -n "$new" ]; then
        for entry in \
            'eval(|code injection: eval() runs arbitrary strings — parse, do not evaluate' \
            'new Function|code injection: new Function() compiles strings' \
            'child_process.exec|command injection: exec() goes through a shell — use execFile with an argument array' \
            'dangerouslySetInnerHTML|XSS: raw HTML — sanitize (DOMPurify) or render text' \
            '.innerHTML =|XSS: innerHTML executes markup — use textContent' \
            'pickle.load|deserialization: pickle executes arbitrary code — use JSON' \
            'shell=True|command injection: shell=True — pass an argument list' \
            'os.system(|command injection: os.system — use subprocess with a list'; do
            pattern=${entry%%|*}
            [[ $new == *"$pattern"* ]] || continue
            grep -qxF -- "$pattern" "$STATE/warned" 2>/dev/null && continue
            printf '%s\n' "$pattern" >> "$STATE/warned" 2>/dev/null
            ctx="${ctx:+$ctx
}SECURITY: ${entry#*|} ('$pattern' in $FILE — shown once per session)"
        done
    fi

    [ -n "$ctx" ] && jq -n -c --arg c "$ctx" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}' 2>/dev/null
    _log
    exit 0
}

# ============================================================================
# PostToolUse · Read, and the documents a file concerns (lib/docs.sh)
# ============================================================================
# docs.json is rebuilt after a write under docs/ and at most every 30 s
# otherwise; a file read or written that matches a document's touches names
# that document once per session, or says it is missing. KODFLOW_DOCS=off.
_docs_post() {
    KF_DOCS_CTX=""
    [ "${KODFLOW_DOCS:-}" = off ] && return 0
    # shellcheck source=lib/docs.sh
    . "$LIB/docs.sh" 2>/dev/null || return 0
    local f=${FILE:-$NB}
    if kf_docs_top "$PROJECT_DIR"; then
        case "$TOOL" in Read|Bash) kf_docs_refresh "$KF_DOCS_TOP" "$SDIR" ;; *) kf_docs_refresh "$KF_DOCS_TOP" "$SDIR" "$f" ;; esac
    fi
    [ -n "$f" ] && [ "$TOOL" != Bash ] && kf_docs_touch "$f" "$SDIR"
    return 0
}

post_read() {
    _docs_post
    [ -n "$KF_DOCS_CTX" ] && jq -n -c --arg c "$KF_DOCS_CTX" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$c}}' 2>/dev/null
    _log
    exit 0
}

# ============================================================================
# PreToolUse · forge MCP tools
# ============================================================================
# The same rules as the shell, by field name: a commit message (message,
# commit_message, commit_title, squash_commit_message, merge_commit_message)
# meets every §5 pattern; the title, body or description of a pull or merge
# request meets the attribution ones; issues, comments and reviews are not
# read. A subagent does not merge and does not write to main or master.
pre_forge() {
    [ "$ROOT_MAIN" = 1 ] && ! _forge_ok "$TOOL" && _root_deny \
        "$TOOL writes into a repository (files, branches, pull requests); reads, reviews, comments, issues and merges stay allowed."
    local FC="" FP="" FM=0 FB=""
    eval "$(printf '%s' "$INPUT" | jq -r '.tool_name as $t | .tool_input as $i
        | def s($k): ($i[$k] // empty | strings);
          (($t | test("pull_request|merge_request")) and ($t | test("review|comment|note|discussion|thread|reply") | not)) as $pr
        | @sh "FC=\([s("message"), s("commit_message"), s("commit_title"), s("squash_commit_message"), s("merge_commit_message")] | join("\n")) FP=\(if $pr then [s("title"), s("body"), s("description")] | join("\n") else "" end) FM=\(if ($t | test("merge_pull_request$|merge_merge_request$")) or ($i.merge_when_pipeline_succeeds == true) or ($i.auto_merge == true) then 1 else 0 end) FB=\(($i.branch // "") | tostring)"' 2>/dev/null)" || { _log; exit 0; }
    F_ATTR=""; F_ATTR_KIND=""
    _scan commit "$FC"; _scan pr "$FP"
    [ -n "$F_ATTR" ] && _motif_block "${F_ATTR%% *}" "$TOOL BLOCKED — AI reference detected" \
        "Forbidden pattern: ${F_ATTR#* }" \
        "Remove AI attribution (co-authored-by, generated by, 🤖) and, in a commit message, workflow leaks (.claude/ paths, Plan: footers)."
    # mcp.json, for every caller: a path a write tool writes (a deletion, a
    # read, are allowed), else, for a GitKraken add or commit naming no file, what the
    # repository would take in.
    local MJ="" MDIR="" MALL=0 st f
    eval "$(printf '%s' "$INPUT" | jq -r '.tool_name as $t | .tool_input as $i
        | ($t | test("GitKraken__git_(add|commit)$")) as $gk
        | ($t | test("push_files$|create_or_update_file$|create_commit$|GitKraken__git_(add|commit)$")) as $w
        | [ (if $w then ($i.path, $i.file_path) else empty end),
            (if $w then ($i.files // [] | .[]? | if type == "string" then . else (.path // .file_path) end) else empty end),
            (if $w then ($i.actions // [] | .[]? | select(.action != "delete") | .file_path) else empty end) ]
        | map(strings | select(test("(^|/)[.]?mcp[.]json$"; "i"))) as $hit
        | @sh "MJ=\($hit[0] // "") MDIR=\(if $gk and (($i.files // []) | length) == 0 then ($i.directory // ".") else "" end) MALL=\(if $t | test("git_add$") then 1 else 0 end)"' 2>/dev/null)"
    if [ -z "$MJ" ] && [ -n "$MDIR" ]; then
        case "$MDIR" in /*) ;; *) MDIR=$PROJECT_DIR/$MDIR ;; esac
        if [ "$MALL" = 1 ]; then
            # "XY path", the old path after a rename; Y is the working tree
            while IFS= read -r -d '' st; do
                f=${st:3}
                case "$st" in R*|C*) IFS= read -r -d '' _ ;; esac
                case "${st:1:1}" in " "|D) continue ;; esac
                _is_mcpjson "$f" && { MJ="$f, added with every file"; break; }
            done < <(git -C "$MDIR" status --porcelain -z --untracked-files=all 2>/dev/null)
        else
            while IFS= read -r -d '' st && IFS= read -r -d '' f; do
                case "$st" in R*|C*) IFS= read -r -d '' f || break ;; esac
                case "$st" in D*) continue ;; esac
                _is_mcpjson "$f" && { MJ="$f is staged"; break; }
            done < <(git -C "$MDIR" diff --cached --name-status -z 2>/dev/null)
        fi
    fi
    [ -n "$MJ" ] && _mcpjson_block "$TOOL: $MJ"
    if [ -n "$AID" ]; then
        [ "$FM" = 1 ] && _motif_block merge "$TOOL BLOCKED — a subagent does not merge" \
            "Merging is the main thread's decision." "Report the PR and its CI state; stop there."
        case "$FB" in main|master|refs/heads/main|refs/heads/master)
            case "$TOOL" in *push_files|*create_or_update_file|*delete_file|*git_push|*git_commit)
                _motif_block push-default "$TOOL BLOCKED — a subagent does not write to the default branch ($FB)" \
                    "Write to your feature branch and open a PR." ;;
            esac ;;
        esac
    elif [ "$FM" = 1 ]; then
        ROOT_GUARD=merge
    fi
    _log
    exit 0
}

# ============================================================================
# PostToolUse · Agent / Task
# ============================================================================
# The other half of the delegation measurement, and what the subagent was
# started on: the result carries its agentId and resolvedModel, the input
# the per-call effort (tests/fixtures/agent-hooks.jsonl). on-agent.sh joins
# them by agent id when the subagent leaves feedback. A foreground agent's
# result arrives after its SubagentStop: that feedback names the model from
# the agent's frontmatter instead.
post_agent() {
    ROOT_GUARD=dispatch
    if [ "${KODFLOW_FEEDBACK:-}" != off ]; then
        local row
        row=$(printf '%s' "$INPUT" | jq -r '[(.tool_response.agentId // empty), (.tool_response.resolvedModel // ""), (.tool_input.effort // ""), (.tool_input.subagent_type // "general-purpose")] | select(length == 4) | map(tostring | gsub("[\t\n]"; " ")) | join("\t")' 2>/dev/null)
        [ -n "$row" ] && mkdir -p "$SDIR" 2>/dev/null && printf '%s\n' "$row" >> "$SDIR/agent-models.tsv" 2>/dev/null
    fi
    _log
    exit 0
}

# ============================================================================
# PostToolUseFailure · any tool
# ============================================================================
# A refusal of auto mode (lib/blocks.sh, kind classifier): its reason, and
# the permission rule that would have let the call through.
_denied() {   # $1 the reason
    local why=$1 rule
    case "$why" in "["*"]") why=${why#"["}; why=${why%"]"} ;; esac
    why=$(printf '%s' "$why" | head -n 1 | cut -c1-200)
    . "$LIB/blocks.sh" 2>/dev/null || return 0
    rule=$(printf '%s' "$INPUT" | kf_block_rule)
    kf_block "$SDIR" classifier "$TOOL" "${why:-denied by auto mode}" "" "${ATYPE:-${AID:-main}}" "$rule" "" "$TUID"
}

# PermissionDenied: auto mode refused the call. Only fires in auto mode; a
# denial the user types at a permission dialog reaches no hook.
permission_denied() {
    _denied "$REASON"
    _log
    exit 0
}

post_failure() {
    local advice=""
    # Auto mode's refusal, should it arrive as a failure (the PermissionDenied
    # event is the documented carrier; the same tool_use_id is one line)
    case "$ERR" in *"denied by the Auto mode classifier"*|*"Auto mode could not evaluate"*) _denied "$ERR" ;; esac
    case "$ERR" in
        *"command not found"*|*"not found"*)      advice="Command not found: check the spelling, install the tool, or use another approach." ;;
        *"ermission denied"*)                      advice="Permission denied: check ownership and mode before retrying." ;;
        *"No such file or directory"*)             advice="Path not found: verify it with Glob or ls before retrying." ;;
        *"AssertionError"*|*"FAILED"*)             advice="A test failed: read the assertion, fix the code, then re-run." ;;
        *"SyntaxError"*|*"syntax error"*)          advice="Syntax error: look for the unclosed bracket or bad indentation named in the message." ;;
        *"timeout"*|*"Timeout"*|*"ETIMEDOUT"*)     advice="Timed out: split the command, or run it in the background." ;;
        *"ENOENT"*|*"MODULE_NOT_FOUND"*)           advice="Module not found: check the manifest and run the install step." ;;
    esac
    [ -n "$advice" ] && jq -n -c --arg c "Tool '$TOOL' failed: ${ERR:0:200}. $advice" \
        '{hookSpecificOutput:{hookEventName:"PostToolUseFailure",additionalContext:$c}}' 2>/dev/null
    _log
    exit 0
}

# ============================================================================
# PreToolUse · Agent / Task: the isolation gate (main thread)
# ============================================================================
# isolation: "worktree" is Claude Code's own: it puts the subagent in a fresh
# worktree of the SESSION's repository (<project>/.claude/worktrees/agent-…)
# and from then on refuses every shell command it cannot prove keeps git
# inside that worktree — an interpreter fed a heredoc, a variable where a
# command or an option stands, screen. That guard lives in the CLI, not here,
# and no hook lifts it. A subagent sent that way to work in ANOTHER repository
# (in a worktree of that one, as the start-up rule 5 says) hits it on its
# first non-trivial command. So the dispatch is refused before it starts: an
# absolute path (or ~/…) in the prompt or the description that lies in a git
# repository other than the session's names the mistake. Without isolation
# the subagent makes its own worktree beside that repository and delivers
# through a PR; the CLI's isolation keeps guarding work on the session's own
# repository, which passes as before, as do paths in no repository.
# `[isolation-ok]` is the exception for a path only quoted for reading;
# KODFLOW_ISOLATION=off turns the gate off.

# $1 a path → the canonical git common dir of the repository holding its
# nearest existing directory, on stdout; 1 when it is in none.
_git_common() {
    local d=$1 c
    while [ -n "$d" ] && [ ! -d "$d" ]; do d=${d%/*}; done
    [ -n "$d" ] || d=/
    c=$(unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE; git -C "$d" rev-parse --git-common-dir 2>/dev/null) || return 1
    [ -n "$c" ] || return 1
    case "$c" in /*) ;; *) c=$d/$c ;; esac
    (cd "$c" 2>/dev/null && pwd -P)
}

_isolation_gate() {
    [ "${KODFLOW_ISOLATION:-}" = off ] && return 0
    local iso text p own c seen="" others="" n=0
    eval "$(printf '%s' "$INPUT" | jq -r '@sh "iso=\(.tool_input.isolation // "") text=\((.tool_input.description // "") + "\n" + (.tool_input.prompt // ""))"' 2>/dev/null)" || return 0
    [ "$iso" = worktree ] || return 0
    case "$text" in *'[isolation-ok]'*) ROOT_GUARD=isolation-override; return 0 ;; esac
    case "$text" in */*) ;; *) return 0 ;; esac
    own=$(_git_common "$PROJECT_DIR") || return 0
    while IFS= read -r p; do
        case "$p" in '~/'*) p=$HOME/${p#'~/'} ;; '~') p=$HOME ;; esac
        while :; do case "$p" in */|*.|*:|*'!'|*'?'|*…) p=${p%?} ;; *) break ;; esac; done
        [ -n "$p" ] || continue
        case "$seen" in *$'\n'"$p"$'\n'*) continue ;; esac
        seen="$seen"$'\n'"$p"$'\n'
        n=$((n+1)); [ $n -gt 16 ] && break
        c=$(_git_common "$p") || continue
        [ "$c" = "$own" ] && continue
        c=${c%/.git}
        case "$others" in *"[$c]"*) ;; *) others="$others[$c]" ;; esac
    done <<EOF
$(printf '%s' "$text" | tr -s ' \t\r"'"'"'`()<>,;=|&*[]{}' '\n' | grep -E '^(/|~/|~$)')
EOF
    [ -n "$others" ] || return 0
    others=${others#[}; others=${others%]}
    local mine=${own%/.git}
    ROOT_GUARD=isolation-deny
    _motif_block isolation "DISPATCH WITHOUT ISOLATION — the work is in another repository (${others//][/, })" \
        "isolation: \"worktree\" puts the subagent in a worktree of $mine, this session's repository." \
        "Claude Code then refuses its shell commands that it cannot prove keep git inside that worktree" \
        "(an interpreter fed a heredoc, a variable where a command or an option stands, screen): work elsewhere breaks on them." \
        "Dispatch it without isolation: it makes its own worktree beside that repository (<repo parent>/.worktrees/<repo>-<epic-slug>) and delivers through a PR." \
        "A path only quoted for reading: [isolation-ok] in the description or the prompt. KODFLOW_ISOLATION=off turns this gate off."
}

# ============================================================================
# PreToolUse · Agent / Task: the routing gate (main thread)
# ============================================================================
# A main-thread dispatch to general-purpose — subagent_type left out or named —
# whose description names the technology of an installed specialist runs
# without that specialist's pinned model, effort and checks. It is refused
# with the agent to use. The match is on the description alone, against
# this session's routing-installed.tsv (lib/route.sh, written at
# SessionStart, rebuilt here when missing or older than the shipped index).
# `[general-purpose-ok]` in the description or the prompt is the deliberate
# exception. The model writes that marker too: this gate steers, it does
# not enforce. KODFLOW_ROUTE=off turns it off. No index, no jq: it passes.
pre_agent() {
    # A payload the fast path did not recognise (another JSON layout) still
    # meets the gated-model fallback, decoded by jq here
    [ "$EV" = PreToolUse ] && _fable_fast
    [ "$EV" = PreToolUse ] && [ -z "$AID" ] || { _log; exit 0; }
    _isolation_gate
    [ "${KODFLOW_ROUTE:-}" = off ] && { _log; exit 0; }
    local st desc idx hits line agent kw
    eval "$(printf '%s' "$INPUT" | jq -r '@sh "st=\(.tool_input.subagent_type // "") desc=\(.tool_input.description // "")"' 2>/dev/null)" || { _log; exit 0; }
    case "$st" in ""|general-purpose) ;; *) _log; exit 0 ;; esac
    case "$INPUT" in *'[general-purpose-ok]'*) ROOT_GUARD=route-override; _log; exit 0 ;; esac
    . "$LIB/route.sh" 2>/dev/null || { _log; exit 0; }
    idx=$SDIR/routing-installed.tsv
    kf_route_fresh "$idx" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" || kf_route_install "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "$idx"
    if ! [ -s "$idx" ]; then ROOT_GUARD=route-noindex; _log; exit 0; fi
    hits=$(kf_route_match "$idx" "$desc")
    [ -n "$hits" ] || { _log; exit 0; }
    local -a use=()
    while IFS=$'\t' read -r agent kw; do
        [ -n "$agent" ] && use+=("subagent_type: $agent  (the description names: ${kw//,/, })")
    done <<< "$hits"
    ROOT_GUARD=route-deny
    desc=$(printf '%s' "$desc" | tr -d '[:cntrl:]' | cut -c1-80)
    _motif_block route "DISPATCH TO THE SPECIALIST — \"$desc\" names an installed specialist's technology" \
        "${use[@]}" \
        "general-purpose would run it without that agent's pinned model, effort and checks." \
        "Several lines: dispatch each specialist its part. A deliberate general-purpose dispatch carries [general-purpose-ok] in its description or prompt." \
        "KODFLOW_ROUTE=off turns this gate off."
}

# ============================================================================
# PreToolUse · triage gate
# ============================================================================
# The user wants every message filed in the task list BEFORE anything is done
# about it, a question included. triage-pending holds one cause per line:
# `prompt` (on-user.sh, each message) and `resume` (on-session.sh, a session
# back with open tasks); an empty file is a prompt. Only the mod lifts it,
# cause by cause, on a task call that succeeded and answers that cause
# (calls.ts liftsTriage): task_create, task_assign_human or
# task_update(description) for a prompt, task_update(status) for a resume.
# task_list, task_epic and task_focus pass here without lifting anything.
# Until then the main agent may only read and load tools — enough to
# understand the request, not to act on it. Subagents are not gated: they
# work for a task the main agent already filed. The gate holds only while
# the mod beats: with the mod gone nothing could lift it, so a stale beat
# lifts it and says why, once.
SDIR=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions/$SID
BEAT=2; . "$LIB/beat.sh" 2>/dev/null && { kf_beat "$SDIR"; BEAT=$?; }
if [ "$EV" = PreToolUse ] && [ -z "$AID" ] && [ -f "$SDIR/triage-pending" ]; then
    case "$TOOL" in
        mcp__*tasks__task_*|mcp__kodflow-hooks__task_*|Read|Glob|Grep|LS|ToolSearch|AskUserQuestion)
            ;;
        *)
            if [ "$BEAT" != 0 ]; then
                rm -f -- "$SDIR/triage-pending" 2>/dev/null
                # A tool with checks of its own below goes on to them, and
                # the next prompt says why (on-user.sh); any other leaves
                # here, the one place it can carry the message.
                case "$TOOL" in
                    Bash|Write|Edit|MultiEdit|NotebookEdit|TaskCreate|TodoWrite|mcp__github__*|mcp__gitlab__*|mcp__GitKraken__*) ;;
                    *) jq -n -c --arg m "${KF_BEAT_LOST:-kodflow-hooks: the mods are unloaded: run /reload-plugins}" '{systemMessage:$m}' 2>/dev/null
                       exit 0 ;;
                esac
            else
                # The gesture each cause still pending waits for: one per
                # message line (`prompt <id>`; an empty file is one message)
                tg=() title="TRIAGE FIRST — settle the task list left open"
                n=$(grep -cvxE '(resume)?' "$SDIR/triage-pending" 2>/dev/null); [ -s "$SDIR/triage-pending" ] || n=1
                if [ "${n:-0}" -gt 1 ] 2>/dev/null; then
                    title="TRIAGE FIRST — file these $n messages in the task list"
                    tg+=("$n messages of the user have no task yet, and each needs its own gesture: context on a task → task_update(id, description=…), anything else → a new task (task_create). One task per message, a question included. The task calls alone, before acting:")
                elif [ "${n:-0}" -eq 1 ] 2>/dev/null; then
                    title="TRIAGE FIRST — file this message in the task list"
                    tg+=("This message has no task yet: one task per message of the user, a question included. The task call alone, before acting:")
                fi
                if [ "${n:-0}" -ge 1 ] 2>/dev/null; then
                    tg+=(
                         "new work for an open epic → task_create(epic=id) · new subject → task_epic(title), then task_create(epic=its id)"
                         "a question → task_create(epic=0), left pending, set completed once answered"
                         "context on the task in progress → task_update(id, description=…) · rework of a completed task → task_create \"Rework #N: …\""
                         "task_create always names its epic (epic=0 for none): there is no default.")
                fi
                grep -qx resume "$SDIR/triage-pending" 2>/dev/null \
                    && tg+=("The session came back with open tasks: task_update(id, status=…) settles them — in_progress for the one you resume, completed, deleted or waiting for the others.")
                _block "$title" "${tg[@]}" \
                    "task_list, task_epic and task_focus do not lift this gate." \
                    "Reading (Read, Grep, Glob) and ToolSearch stay allowed meanwhile."
            fi ;;
    esac
fi

# Tools this script has nothing to do with leave at once, unlogged: the
# matcher is wide only so the triage gate above sees every call.
case "$EV/$TOOL" in
    PreToolUse/Bash|PreToolUse/Write|PreToolUse/Edit|PreToolUse/MultiEdit|PreToolUse/NotebookEdit|PreToolUse/TaskCreate|PreToolUse/TodoWrite|PreToolUse/Agent|PreToolUse/Task) ;;
    # A task tool reaches this script only from an old install of the tasks
    # MCP; the mod's own are answered before the shell. Logged, nothing else.
    PreToolUse/mcp__*tasks__task_*|PreToolUse/mcp__kodflow-hooks__task_*) _log; exit 0 ;;
    PreToolUse/mcp__github__*|PreToolUse/mcp__gitlab__*|PreToolUse/mcp__GitKraken__*)
        pre_forge ;;
    PreToolUse/Skill) _fable_skill; exit 0 ;;
    PreToolUse/*) exit 0 ;;
esac

# ============================================================================
# dispatch
# ============================================================================
case "$EV/$TOOL" in
    PreToolUse/Bash)                                        pre_bash ;;
    PreToolUse/TaskCreate|PreToolUse/TodoWrite)             pre_builtin_tasks ;;
    PreToolUse/Agent|PreToolUse/Task)                       pre_agent ;;
    PreToolUse/Write|PreToolUse/Edit|PreToolUse/MultiEdit|PreToolUse/NotebookEdit)     pre_edit ;;
    PostToolUse/Write|PostToolUse/Edit|PostToolUse/MultiEdit|PostToolUse/NotebookEdit) post_edit ;;
    PostToolUseFailure/*)                                   post_failure ;;
    PermissionDenied/*)                                     permission_denied ;;
    PostToolUse/Read)                                       post_read ;;
    PostToolUse/Bash)                                       _docs_post; _log; exit 0 ;;
    # OBSERVE: the other half of the measurement — how often the main thread
    # delegated, counted against how often it was stopped.
    PostToolUse/Task|PostToolUse/Agent)                     post_agent ;;
    # A subagent's report through the hand-back tool (auto mode): its
    # feedback section is kept as at SubagentStop (lib/feedback.sh).
    PostToolUse/SubagentHandback)
        AGENT_TYPE=$(printf '%s' "$INPUT" | jq -r '.agent_type // ""' 2>/dev/null)
        . "$LIB/feedback.sh" 2>/dev/null && kf_feedback "$INPUT" "$SID" "$AID" "$AGENT_TYPE" "$PROJECT_DIR"
        _log; exit 0 ;;
    *)                                                      _log; exit 0 ;;
esac
