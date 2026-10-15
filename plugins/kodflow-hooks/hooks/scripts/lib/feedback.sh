# feedback.sh — keep the feedback a subagent left on its own instructions.
# shellcheck shell=bash
#
# Two events carry the subagent's report (tests/fixtures/agent-hooks.jsonl):
# SubagentStop, as last_assistant_message, and, where the subagent reports
# through the SubagentHandback tool (auto mode), its PostToolUse, as
# tool_input.message. Both may carry the same report: one line per agent and
# text is kept. The record (lib/feedback.jq) names the model the parent's
# PostToolUse Agent recorded for that agent id (on-tool.sh, post_agent),
# else the definition's frontmatter, and the payload's own effort.
#
#   . "$LIB/feedback.sh"
#   kf_feedback "$INPUT" SID AGENT_ID AGENT_TYPE PROJECT_DIR

kf_feedback() {
    local input=$1 sid=$2 aid=$3 type=$4 project=$5
    local lib=${BASH_SOURCE[0]%/*} cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude} dir model="" source=unknown line key
    [ "${KODFLOW_FEEDBACK:-}" != off ] && [ -n "$aid" ] || return 0
    case "$input" in *[Aa]gent[\ _]feedback*) ;; *) return 0 ;; esac
    dir=$cfg/kodflow/sessions/$sid
    if [ -s "$dir/agent-models.tsv" ]; then
        model=$(awk -F'\t' -v id="$aid" '$1 == id { m = $2 } END { print m }' "$dir/agent-models.tsv" 2>/dev/null)
        [ -n "$model" ] && source=tool_result
    fi
    # Where the agent is defined: the change to propose is to that file, and
    # only an agent of a kodflow plugin is the marketplace's to fix.
    local def="" owner=local
    if . "$lib/agents.sh" 2>/dev/null && kf_agent_def "$type" "$cfg" "$project"; then
        def=$KF_AGENT_DEF
        case "$def" in "$cfg"/plugins/cache/kodflow/*) owner=kodflow ;; "$cfg"/plugins/*) owner=plugin ;; esac
        if [ -z "$model" ] && kf_fm_model "$def"; then model=$KF_FM_MODEL; source=frontmatter; fi
    fi
    line=$(printf '%s' "$input" | jq -c -L "$lib" --arg model "$model" --arg source "$source" --arg def "$def" --arg owner "$owner" 'include "feedback"; record' 2>/dev/null)
    [ -n "$line" ] || return 0
    key=$aid$'\t'$(printf '%s' "$input" | jq -r -L "$lib" 'include "feedback"; first(feedback) // ""' 2>/dev/null | cksum | cut -d' ' -f1)
    (
        mkdir -p "$dir" 2>/dev/null || exit 0
        . "$lib/lock.sh" 2>/dev/null && kf_lock "$dir/.feedback.lock.d" 2
        grep -qxF "$key" "$dir/agent-feedback.ids" 2>/dev/null && exit 0
        # The record first: a key without its line would drop the report
        printf '%s\n' "$line" >> "$dir/agent-feedback.jsonl" || exit 0
        printf '%s\n' "$key" >> "$dir/agent-feedback.ids"
    ) >/dev/null 2>&1 </dev/null
}
