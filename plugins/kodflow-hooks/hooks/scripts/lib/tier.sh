# tier.sh — the tier judge for Agent calls: does a delegation say its model
# and its effort, or leave them to inheritance?
# shellcheck shell=bash
#
#   . "$LIB/tier.sh"
#   kf_tier_check        reads $INPUT (a PreToolUse payload); returns 0 to go
#                        on, prints the advice (warn) as one JSON document, or
#                        exits 2 with the refusal (enforce, a caller shown the
#                        table, breaker not tripped). Every other path returns 0.
#
# Definitions (plans/agent-tier-routing.md):
#   pinned          non-empty once comments and quotes are gone, not null or ~;
#                   for a model, not `inherit` either
#   model pinned    the call, or the definition's frontmatter, or
#                   CLAUDE_CODE_SUBAGENT_MODEL; with _FORCE the call is ignored
#                   and the engine decides (the environment's model, else the
#                   parent's; Explore its own)
#   effort pinned   the call, or the frontmatter, or CLAUDE_CODE_EFFORT_LEVEL
#                   other than auto/unset
#   mode            `off` anywhere wins; else KODFLOW_TIER > <session>/tier-mode
#                   > <config>/kodflow/tier-mode > warn; <session>/tier-skew
#                   forces warn
# Only .tool_input.* is read for the call's own fields: the payload's top-level
# `effort` is the SESSION's effort and says nothing about this call.
#
# Journal: <session>/tier.jsonl, one line per verdict, appended with a single
# printf. Breaker: <session>/tier-count, one `key<TAB>tool_use_id` line per
# refusal, the 4th distinct refusal of a (subagent_type, caller) passes.
#
# macOS /bin/bash 3.2: no associative arrays, mapfile or ${v,,}.

KF_TIER_LIB=${BASH_SOURCE[0]%/*}
KF_TIER_BREAKER_N=${KF_TIER_BREAKER_N:-3}

# Characters a journal value may hold: it is written by printf, not by jq.
_kf_tier_s() {
    local v=${1:0:120}
    printf '%s' "${v//[^A-Za-z0-9_:.@\/-]/_}"
}

_kf_tier_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# 0 when the value pins the field. $2 = model | effort.
_kf_tier_pinned() {
    local v=$1
    v=${v#"${v%%[![:space:]]*}"}
    v=${v%"${v##*[![:space:]]}"}
    case "$v" in ''|null|NULL|Null|'~') return 1 ;; esac
    if [ "$2" = model ]; then
        case "$v" in inherit|INHERIT|Inherit) return 1 ;; esac
    fi
    return 0
}

# The mode and where it came from: KT_MODE, KT_MSRC. `off` in any source wins.
_kf_tier_mode() {   # $1 = session dir, $2 = config dir, $3 = tier-skew marker (optional)
    local env f v src
    KT_MODE=warn KT_MSRC=default
    env=$(_kf_tier_lower "${KODFLOW_TIER:-}")
    v=""; [ -r "$1/tier-mode" ] && read -r v < "$1/tier-mode" 2>/dev/null
    local sess; sess=$(_kf_tier_lower "$v")
    v=""; [ -r "$2/kodflow/tier-mode" ] && read -r v < "$2/kodflow/tier-mode" 2>/dev/null
    local glob; glob=$(_kf_tier_lower "$v")
    if [ "$env" = off ] || [ "$sess" = off ] || [ "$glob" = off ]; then
        KT_MODE=off
        if [ "$env" = off ]; then KT_MSRC=KODFLOW_TIER
        elif [ "$sess" = off ]; then KT_MSRC="$1/tier-mode"
        else KT_MSRC="$2/kodflow/tier-mode"; fi
        return 0
    fi
    for f in "KODFLOW_TIER:$env" "$1/tier-mode:$sess" "$2/kodflow/tier-mode:$glob"; do
        v=${f##*:}; src=${f%:*}
        case "$v" in warn|enforce) KT_MODE=$v KT_MSRC=$src; break ;; esac
    done
    # Skew: the tables differ, so the advice may not be this table's: no refusal.
    if [ "$KT_MODE" = enforce ] && [ -n "${3:-}" ] && [ -f "$3" ]; then
        KT_MODE=warn KT_MSRC=tier-skew
    fi
    return 0
}

# The command that turns the check off, quoted like tier.ts's offCommand:
# printf off > '<path>', an embedded ' written '\''.
_kf_tier_offcmd() {
    local p=$1 q="'" esc
    esc=${p//$q/$q\\$q$q}
    printf "printf off > '%s'" "$esc"
}

# One line of the journal. Reads the caller's locals.
_kf_tier_log() {   # $1 action, $2 reason
    [ -n "$kt_sdir" ] || return 0
    mkdir -p "$kt_sdir" 2>/dev/null || return 0
    printf '{"ts":"%s","mode":"%s","mode_source":"%s","would_refuse":%s,"action":"%s","reason":"%s","subagent_type":"%s","caller":"%s","has_model":%s,"has_effort":%s,"pinned_model":"%s","pinned_effort":"%s","tool_use_id":"%s"}\n' \
        "$(date -u +%FT%TZ)" "$(_kf_tier_s "$KT_MODE")" "$(_kf_tier_s "$KT_MSRC")" "${kt_would:-false}" "$1" "$2" \
        "$(_kf_tier_s "$kt_st")" "$(_kf_tier_s "$kt_caller")" "${kt_hasm:-false}" "${kt_hase:-false}" \
        "$(_kf_tier_s "${kt_pm:-}")" "$(_kf_tier_s "${kt_pe:-}")" "$(_kf_tier_s "$kt_tuid")" \
        >> "$kt_sdir/tier.jsonl" 2>/dev/null
    return 0
}

# The rows of the table that fit the role of this call, as `role: model, effort`.
_kf_tier_rows() {   # $1 = table, $2 = subagent_type
    local want="" kind role model effort n=0 out=""
    case "${2#*:}" in
    *executor-correctness|*executor-security) want="Correctness and security executors" ;;
    *specialist-review|*executor-design) want="Review / verify worker" ;;
    *executor-quality|*executor-shell|*commentator-worker|Explore) want="Mechanical worker" ;;
    *orchestrator) want="Orchestrator" ;;
    esac
    while IFS=$'\t' read -r kind role model effort || [ -n "$kind" ]; do
        [ "$kind" = role ] || continue
        if [ -n "$want" ] && [ "$role" != "$want" ]; then continue; fi
        [ -z "$want" ] && [ "$role" = Orchestrator ] && continue
        n=$((n+1))
        if [ "$model" = - ]; then out="$out  - $role: main session, not delegated, effort $effort"$'\n'
        else out="$out  - $role: model $model, effort $effort"$'\n'; fi
    done < "$1"
    printf '%s' "$out"
}

kf_tier_check() {
    local cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
    local kt_sid="" kt_sdir="" kt_st="" kt_caller=main kt_tuid="" kt_would=false kt_hasm=false kt_hase=false
    local kt_pm="" kt_pe=""
    local t_parsed="" t_sid="" t_st="" t_model="" t_effort="" t_tuid="" t_aid="" t_pmode="" t_cwd="" t_tool="" t_ex=""
    KT_MODE=warn KT_MSRC=default
    local hasjq=0
    command -v jq >/dev/null 2>&1 && hasjq=1
    if [ $hasjq = 1 ]; then
        # parsed=1 is emitted by the filter itself: a payload jq cannot read
        # leaves it unset. Only .tool_input.* is read for the call's fields.
        eval "$(printf '%s' "$INPUT" | jq -r '(.tool_input // {}) as $i
            | @sh "t_parsed=1 t_sid=\(.session_id // "" | tostring) t_tool=\(.tool_name // "" | tostring) t_pmode=\(.permission_mode // "" | tostring) t_aid=\(.agent_id // "" | tostring) t_cwd=\(.cwd // "" | tostring) t_tuid=\(.tool_use_id // "" | tostring) t_st=\($i.subagent_type // "" | tostring) t_model=\($i.model // "" | tostring) t_effort=\($i.effort // "" | tostring) t_ex=\(((($i.description // "" | tostring) + "\n" + ($i.prompt // "" | tostring)) | contains("[tier-exempt:")))"' 2>/dev/null)" 2>/dev/null
    fi
    if [ "$t_parsed" != 1 ] || [ $hasjq = 0 ]; then
        # Whatever jq could not give: the fields a bash regex can still read
        local w='[[:space:]]*'
        [[ $INPUT =~ \"session_id\"$w:$w\"([^\"]*)\" ]] && t_sid=${BASH_REMATCH[1]}
        [[ $INPUT =~ \"agent_id\"$w:$w\"([^\"]+)\" ]] && t_aid=${BASH_REMATCH[1]}
        [[ $INPUT =~ \"subagent_type\"$w:$w\"([^\"]*)\" ]] && t_st=${BASH_REMATCH[1]}
        [[ $INPUT =~ \"tool_use_id\"$w:$w\"([^\"]*)\" ]] && t_tuid=${BASH_REMATCH[1]}
        [ $hasjq = 0 ] && t_tool=Agent
    fi
    t_sid=${t_sid//[^A-Za-z0-9_-]/}; t_sid=${t_sid:-default}
    t_aid=${t_aid//[^A-Za-z0-9_-]/}
    kt_sid=$t_sid; kt_sdir=$cfg/kodflow/sessions/$kt_sid
    kt_st=$t_st; kt_tuid=$t_tuid
    [ -n "$t_aid" ] && kt_caller=$t_aid
    local sub=0; [ -n "$t_aid" ] && sub=1
    local motif=tier; [ $sub = 1 ] && motif=tier-sub

    _kf_tier_mode "$kt_sdir" "$cfg" "$kt_sdir/tier-skew"
    [ "$KT_MODE" = off ] && return 0

    if [ $hasjq = 0 ]; then _kf_tier_log pass tier-nojq; return 0; fi
    if [ "$t_parsed" != 1 ]; then _kf_tier_log pass tier-unparsed; return 0; fi
    case "$t_tool" in Agent|Task) ;; *) return 0 ;; esac

    local table=${CLAUDE_PLUGIN_ROOT:-$KF_TIER_LIB/../../..}/hooks/tier-table.tsv
    [ -r "$table" ] || { _kf_tier_log pass tier-unparsed; return 0; }

    # The table: exempt agents, the fork row, the mode rows.
    local kind role _m _e exempt="" fork=0 modes=""
    while IFS=$'\t' read -r kind role _m _e || [ -n "$kind" ]; do
        case "$kind" in
        exempt) exempt="$exempt $role " ;;
        fork) fork=1 ;;
        mode) modes="$modes $role " ;;
        esac
    done < "$table"

    kt_hasm=false; kt_hase=false
    _kf_tier_pinned "$t_model" model && kt_hasm=true
    _kf_tier_pinned "$t_effort" effort && kt_hase=true

    # Skew: the table of the hooks and the one the skills carry differ, so the
    # instruction the model read may not be this table: advice only.

    case "$t_ex" in
    true) _kf_tier_log pass tier; return 0 ;;   # [tier-exempt: …] in the description or the prompt
    esac
    case "$modes" in *" $t_pmode "*) [ -n "$t_pmode" ] && { _kf_tier_log pass tier; return 0; } ;; esac
    if [ "$t_st" = fork ] && [ $fork = 1 ]; then _kf_tier_log pass tier-fork; return 0; fi
    local base=${t_st#*:}
    case "$exempt" in *" $t_st "*|*" $base "*) [ -n "$t_st" ] && { _kf_tier_log pass $motif; return 0; } ;; esac

    # The definition. A built-in has no file: nothing pinned. Any other type
    # with no readable definition is not judged.
    local fm_model="" fm_effort="" project=${CLAUDE_PROJECT_DIR:-$t_cwd}
    . "$KF_TIER_LIB/agents.sh" 2>/dev/null || { _kf_tier_log pass tier-unparsed; return 0; }
    if kf_agent_def "${t_st:-general-purpose}" "$cfg" "$project"; then
        kf_fm_field "$KF_AGENT_DEF" model && fm_model=$KF_FM_FIELD
        kf_fm_field "$KF_AGENT_DEF" effort && fm_effort=$KF_FM_FIELD
    else
        case "${t_st:-general-purpose}" in
        general-purpose|claude|Explore|Plan|workflow-subagent|statusline-setup|claude-code-guide|web-fetch) ;;
        *) _kf_tier_log pass tier-nodef; return 0 ;;
        esac
    fi

    # Model
    local force=0 envm=${CLAUDE_CODE_SUBAGENT_MODEL:-} missing=""
    case "$(_kf_tier_lower "${CLAUDE_CODE_SUBAGENT_MODEL_FORCE:-}")" in ''|0|false|no|off) ;; *) force=1 ;; esac
    if [ $force = 1 ]; then
        # the call's model is ignored by the engine
        if [ -n "$envm" ]; then kt_pm="env-forced:$envm"
        elif [ "$t_st" = Explore ]; then kt_pm="own:Explore"
        else kt_pm="parent"; fi
    elif [ $kt_hasm = true ]; then kt_pm="call:$t_model"
    elif _kf_tier_pinned "$fm_model" model; then kt_pm="frontmatter:$fm_model"
    elif [ -n "$envm" ]; then kt_pm="env:$envm"
    else missing=model; fi
    # Effort
    local enve; enve=$(_kf_tier_lower "${CLAUDE_CODE_EFFORT_LEVEL:-}")
    if [ $kt_hase = true ]; then kt_pe="call:$t_effort"
    elif _kf_tier_pinned "$fm_effort" effort; then kt_pe="frontmatter:$fm_effort"
    else
        case "$enve" in ''|auto|unset) missing="${missing:+$missing and }effort" ;; *) kt_pe="env:$enve" ;; esac
    fi

    if [ -z "$missing" ]; then _kf_tier_log pass $motif; return 0; fi
    kt_would=true

    local marker=$kt_sdir/tier-seen/$kt_caller reason=$motif
    [ "$KT_MSRC" = tier-skew ] && reason=tier-skew

    local enforce=0
    if [ "$KT_MODE" = enforce ]; then
        if [ ! -e "$marker" ]; then _kf_tier_log pass tier-inert; return 0; fi
        # The breaker: the 4th distinct refusal of one (type, caller) passes.
        local key; key="$(_kf_tier_s "${t_st:-general-purpose}")|$(_kf_tier_s "$kt_caller")"
        local id=${kt_tuid:-"$$-$RANDOM"} f=$kt_sdir/tier-count n
        mkdir -p "$kt_sdir" 2>/dev/null
        printf '%s\t%s\n' "$key" "$id" >> "$f" 2>/dev/null
        n=$(awk -F'\t' -v k="$key" '$1 == k && !seen[$2]++ { n++ } END { print n + 0 }' "$f" 2>/dev/null)
        case "$n" in ''|*[!0-9]*) n=0 ;; esac
        if [ "$n" -gt "$KF_TIER_BREAKER_N" ]; then _kf_tier_log pass tier-breaker; return 0; fi
        enforce=1
    fi

    local rows msg what src off_cmd
    off_cmd=$(_kf_tier_offcmd "$kt_sdir/tier-mode")
    rows=$(_kf_tier_rows "$table" "$t_st")
    what=${t_st:-general-purpose}
    src="from $KT_MSRC"; [ "$KT_MSRC" = default ] && src=default
    msg="TIER — this dispatch to $what names no $missing: it would run on what is inherited, not on what the policy sets for the task.
Nothing pins the missing field either: not the call, not the agent definition's frontmatter, not CLAUDE_CODE_SUBAGENT_MODEL or CLAUDE_CODE_EFFORT_LEVEL.
Pass the $missing on the call, from the tier table (kodflow-hooks/hooks/tier-table.tsv):
${rows}
Take the row that matches the task's role.
Mode: $KT_MODE ($src).
To turn this check off for the session: $off_cmd
[motif:tier]"

    if [ $enforce = 1 ]; then
        _kf_tier_log refuse $reason
        . "$KF_TIER_LIB/blocks.sh" 2>/dev/null \
            && kf_block "$kt_sdir" hook "${t_tool:-Agent}" "TIER — $what names no $missing" tier "$kt_caller" "" "" "$kt_tuid"
        printf '═══════════════════════════════════════════════\n  ❌ TIER REFUSED — %s\n═══════════════════════════════════════════════\n' "$what names no $missing" >&2
        printf '  %s\n' "$msg" >&2
        exit 2
    fi
    _kf_tier_log warn $reason
    jq -n -c --arg c "$msg" '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:$c}}' 2>/dev/null
    return 0
}
