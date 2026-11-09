#!/bin/bash
# on-tier.sh — SessionStart, SubagentStart, SessionEnd, PreCompact.
#
# Puts the tier table (model and effort per role, hooks/tier-table.tsv) in the
# context of the orchestrator and of every sub-agent that can itself delegate.
# It has its own hooks.json entries, apart from on-session.sh and on-agent.sh,
# so the table has an additionalContext budget of its own (10 000 characters).
#
# Fails open: any error, a missing table, an overflow of the budget emits
# nothing and exits 0. A per-caller marker (`main`, or the agent_id) is written
# under <config>/kodflow/sessions/<session>/tier-seen/ only after a valid
# emission; the judge refuses only a caller that was shown the table. The
# markers go at SessionEnd and PreCompact (a compaction drops the table from
# the context; the SessionStart that follows writes it again).
#
# SessionStart also compares the header of the table with the one shipped in
# each installed kodflow plugin's skills/_shared: a mismatch writes
# <session>/tier-skew, no installed plugin at all writes tier-skew-none.
#
# macOS /bin/bash 3.2: no associative arrays, mapfile or ${v,,}.
set +e

INPUT=$(cat 2>/dev/null); [ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
eval "$(printf '%s' "$INPUT" | jq -r '@sh "EV=\(.hook_event_name // "") SID=\(.session_id // "") CWD=\(.cwd // "") AGENT=\(.agent_type // "") AID=\(.agent_id // "")"' 2>/dev/null)" || exit 0

SID=${SID//[^A-Za-z0-9_-]/}; SID=${SID:-default}
AID=${AID//[^A-Za-z0-9_-]/}
PROJECT_DIR=${CLAUDE_PROJECT_DIR:-${CWD:-$PWD}}
CONFIG=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
SDIR=$CONFIG/kodflow/sessions/$SID
HERE=${BASH_SOURCE[0]%/*}
TABLE=${CLAUDE_PLUGIN_ROOT:-$HERE/../..}/hooks/tier-table.tsv
LIMIT=10000

# The table as the model reads it: preamble, then one line per row.
_render() {
    local line kind role model effort
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
        "# sha256 "*) ;;
        "# "*) printf '%s\n' "${line#\# }" ;;
        "#"*|"") ;;
        *)
            IFS=$'\t' read -r kind role model effort <<EOT
$line
EOT
            case "$kind" in
            mode) printf -- '- %s: %s, effort %s\n' "$role" "$model" "$effort" ;;
            role) printf -- '- %s: model %s, effort %s\n' "$role" "$model" "$effort" ;;
            exempt) [ "$model" = - ] && printf -- '- %s: exempt, no default claimed\n' "$role" \
                        || printf -- '- %s: exempt, %s as its own definition states\n' "$role" "$model" ;;
            fork) printf -- '- fork: only to continue the orchestrator, counted apart; never a worker\n' ;;
            esac ;;
        esac
    done < "$TABLE"
}

# Print the text of one frontmatter field, folded or list continuation lines
# included. $1 = file, $2 = field name.
_fm_block() {
    awk -v key="$2" '
        NR == 1 { gsub(/\r|^\xef\xbb\xbf/, ""); if ($0 != "---") exit; next }
        { sub(/\r$/, "") }
        $0 == "---" { exit }
        $0 ~ "^" key ":" { on = 1; sub("^" key ":", ""); print; next }
        on && /^[A-Za-z_][A-Za-z0-9_-]*:/ { on = 0 }
        on { print }
    ' "$1" 2>/dev/null
}

# True when the text names the whole word Agent or Task, or * (a bare star:
# mcp__x__* is one token because the underscore is part of a word).
_names_delegation() {
    printf '%s\n' "$1" | tr -c 'A-Za-z0-9_*' '\n' | grep -Eqx 'Agent|Task|\*'
}

_definition() {   # prints the path of the agent definition, if found
    local name=$1 plugin dir p
    case "$name" in
    *:*)
        plugin=${name%%:*}; name=${name#*:}
        case "$name" in *[!A-Za-z0-9_.-]*|"") return 1 ;; esac
        _install_paths "$plugin" | while IFS= read -r dir; do
            [ -f "$dir/agents/$name.md" ] && { printf '%s\n' "$dir/agents/$name.md"; break; }
        done ;;
    *[!A-Za-z0-9_.-]*|"") return 1 ;;
    *)
        for p in "$PROJECT_DIR/.claude/agents/$name.md" "$CONFIG/agents/$name.md"; do
            [ -f "$p" ] && { printf '%s\n' "$p"; return 0; }
        done
        _install_paths "" | while IFS= read -r dir; do
            [ -f "$dir/agents/$name.md" ] && { printf '%s\n' "$dir/agents/$name.md"; break; }
        done ;;
    esac
}

# installPath of every installed plugin named $1 (all plugins when empty).
_install_paths() {
    local f=$CONFIG/plugins/installed_plugins.json
    [ -f "$f" ] || return 0
    jq -r --arg p "$1" '.plugins // {} | to_entries[]
        | select($p == "" or (.key | split("@")[0]) == $p)
        | .value[]? | .installPath // empty' "$f" 2>/dev/null
}

# Can this agent type itself call Agent/Task?
_can_delegate() {
    local def tools dis
    case "$AGENT" in
    general-purpose|claude) return 0 ;;
    Explore|Plan|"") return 1 ;;
    esac
    def=$(_definition "$AGENT" | head -n 1)
    [ -n "$def" ] || return 1          # unknown definition: say nothing
    dis=$(_fm_block "$def" disallowedTools)
    _names_delegation "$dis" && return 1
    grep -Eq '^tools:' "$def" 2>/dev/null || return 0   # no `tools`: all of them
    tools=$(_fm_block "$def" tools)
    [ -z "$(printf '%s' "$tools" | tr -d ' \t\n[]')" ] && return 0   # `tools:` empty: all of them
    _names_delegation "$tools"
}

_emit() {   # $1 = event name, $2 = caller marker
    [ -f "$TABLE" ] || return 0
    local body ctx n
    body=$(_render) || return 0
    [ -n "$body" ] || return 0
    ctx="## Tier table (kodflow-hooks)
$body"
    n=$(jq -n --arg c "$ctx" '$c | length' 2>/dev/null)
    [[ $n =~ ^[0-9]+$ ]] && [ "$n" -le "$LIMIT" ] || return 0
    jq -n -c --arg e "$1" --arg c "$ctx" \
        '{hookSpecificOutput:{hookEventName:$e,additionalContext:$c}}' 2>/dev/null || return 0
    mkdir -p "$SDIR/tier-seen" 2>/dev/null && : > "$SDIR/tier-seen/$2" 2>/dev/null
    return 0
}

_skew() {
    local mine other plugin dir seen=0 bad="" f
    rm -f "$SDIR/tier-skew" "$SDIR/tier-skew-none" 2>/dev/null
    [ -f "$TABLE" ] || return 0
    read -r mine < "$TABLE"
    mkdir -p "$SDIR" 2>/dev/null || return 0
    for plugin in kodflow-workflow kodflow-devops kodflow-review; do
        dir=$(_install_paths "$plugin" | head -n 1)
        [ -n "$dir" ] || continue
        seen=1
        f=$dir/skills/_shared/tier-table.tsv
        other=""
        [ -f "$f" ] && read -r other < "$f"
        [ "$other" = "$mine" ] || bad="$bad $plugin"
    done
    if [ -n "$bad" ]; then
        printf 'hooks %s differs in:%s\n' "$mine" "$bad" > "$SDIR/tier-skew"
    elif [ "$seen" = 0 ]; then
        : > "$SDIR/tier-skew-none"
    fi
}

case "$EV" in
SessionStart)
    _skew
    _emit SessionStart main ;;
SubagentStart)
    [ -n "$AID" ] || exit 0
    _can_delegate && _emit SubagentStart "$AID" ;;
SessionEnd|PreCompact)
    rm -rf -- "$SDIR/tier-seen" 2>/dev/null ;;
esac
exit 0
