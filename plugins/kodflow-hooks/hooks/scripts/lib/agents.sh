# agents.sh — what an agent dispatch would run on, read by the shell alone.
# shellcheck shell=bash
#
# The mod (hooks/mod/fable.ts) judges every spawn when it is loaded. These
# are the shell's copy of the same reads, for the two places that cannot
# wait for it: on-tool.sh's fallback gate when the mod does not beat, and
# on-agent.sh naming the model of a subagent that left feedback. No jq, bash
# 3.2, bounded reads; every miss is an empty answer, never an error.
#
#   . "$LIB/agents.sh"
#   kf_gated_load                 → KF_GATED, one token a line
#   kf_is_gated MODEL             → 0 when MODEL names a gated model
#   kf_agent_def TYPE CFG PROJECT → KF_AGENT_DEF, the definition's path
#   kf_skill_def NAME CFG PROJECT → KF_SKILL_DEF, a skill's SKILL.md
#   kf_fm_model FILE              → KF_FM_MODEL, its frontmatter model

KF_AGENTS_LIB=${BASH_SOURCE[0]%/*}

# hooks/gated-models.txt: one token a line, # and blank lines skipped. CI
# holds it byte-identical to skills/_shared/gated-models.txt.
kf_gated_load() {
    local f=$KF_AGENTS_LIB/../../gated-models.txt line
    # Unreadable, the list falls back to the policy's model: an unreadable
    # file must not make every model ungated
    KF_GATED=""
    [ -r "$f" ] || { KF_GATED=fable$'\n'; return 0; }
    while IFS= read -r line || [ -n "$line" ]; do
        line=${line%%#*}
        line=$(printf '%s' "$line" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
        [ -n "$line" ] || continue
        KF_GATED="$KF_GATED$line"$'\n'
    done < "$f"
}

kf_is_gated() {
    local m t
    [ -n "$1" ] || return 1
    [ -n "${KF_GATED+x}" ] || kf_gated_load
    m=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
    while IFS= read -r t; do
        [ -n "$t" ] || continue
        case "$m" in *"$t"*) return 0 ;; esac
    done <<< "$KF_GATED"
    return 1
}

# installed_plugins.json → the install paths of one plugin (any marketplace),
# or of every plugin when PLUGIN is empty, one a line. jq when there is one;
# without it, an awk read of the layout the CLI writes, one key a line.
_kf_install_paths() {
    local json=$1/plugins/installed_plugins.json plugin=$2
    [ -r "$json" ] || return 0
    if command -v jq >/dev/null 2>&1; then
        jq -r --arg p "$plugin" '.plugins // {} | to_entries[] | select($p == "" or (.key | split("@")[0]) == $p)
            | .value[]? | .installPath? // empty | strings' "$json" 2>/dev/null | awk '!seen[$0]++'
        return 0
    fi
    if [ -z "$plugin" ]; then
        awk '/"installPath"/ { v = $0; sub(/.*"installPath"[[:space:]]*:[[:space:]]*"/, "", v); sub(/".*/, "", v)
                               if (v != "" && !(v in seen)) { seen[v] = 1; print v } }
             NR > 5000 { exit }' "$json" 2>/dev/null
        return 0
    fi
    awk -v p="\"$plugin@" '
        index($0, p) == 1 || index($0, " " p) { inside = 1 }
        inside && /"installPath"/ {
            v = $0; sub(/.*"installPath"[[:space:]]*:[[:space:]]*"/, "", v); sub(/".*/, "", v)
            if (v != "" && !(v in seen)) { seen[v] = 1; print v }
        }
        inside && /^[[:space:]]*\][,]?[[:space:]]*$/ { inside = 0 }
        NR > 5000 { exit }' "$json" 2>/dev/null
}

# The definition of TYPE, in the engine's order: a namespaced plugin:name only
# in that plugin's installed copy; a bare name in the project, then the user's
# agents, then any installed plugin.
kf_agent_def() {
    local type=$1 cfg=$2 project=$3 plugin name p
    KF_AGENT_DEF=""
    case "$type" in
        *:*) plugin=${type%%:*}; name=${type#*:} ;;
        *) plugin=""; name=$type ;;
    esac
    case "$name" in ''|*[!A-Za-z0-9_.-]*|.*) return 1 ;; esac
    if [ -z "$plugin" ]; then
        for p in "${project:+$project/.claude/agents/$name.md}" "$cfg/agents/$name.md"; do
            [ -n "$p" ] && [ -f "$p" ] && { KF_AGENT_DEF=$p; return 0; }
        done
        while IFS= read -r p; do
            [ -n "$p" ] && [ -f "$p/agents/$name.md" ] && { KF_AGENT_DEF=$p/agents/$name.md; return 0; }
        done < <(_kf_install_paths "$cfg" "")
        return 1
    fi
    while IFS= read -r p; do
        [ -n "$p" ] && [ -f "$p/agents/$name.md" ] && { KF_AGENT_DEF=$p/agents/$name.md; return 0; }
    done < <(_kf_install_paths "$cfg" "$plugin")
    return 1
}

# A skill's SKILL.md: plugin:skill in that plugin's installed copy; a bare
# name in the project's skills, the user's, then any installed plugin.
kf_skill_def() {
    local skill=$1 cfg=$2 project=$3 plugin name p
    KF_SKILL_DEF=""
    case "$skill" in
        *:*) plugin=${skill%%:*}; name=${skill#*:} ;;
        *) plugin=""; name=$skill ;;
    esac
    case "$name" in ''|*[!A-Za-z0-9_.-]*|.*) return 1 ;; esac
    if [ -z "$plugin" ]; then
        for p in "${project:+$project/.claude/skills/$name/SKILL.md}" "$cfg/skills/$name/SKILL.md"; do
            [ -n "$p" ] && [ -f "$p" ] && { KF_SKILL_DEF=$p; return 0; }
        done
        while IFS= read -r p; do
            [ -n "$p" ] && [ -f "$p/skills/$name/SKILL.md" ] && { KF_SKILL_DEF=$p/skills/$name/SKILL.md; return 0; }
        done < <(_kf_install_paths "$cfg" "")
        return 1
    fi
    while IFS= read -r p; do
        [ -n "$p" ] && [ -f "$p/skills/$name/SKILL.md" ] && { KF_SKILL_DEF=$p/skills/$name/SKILL.md; return 0; }
    done < <(_kf_install_paths "$cfg" "$plugin")
    return 1
}

# The first frontmatter block only, at most 60 lines, CRLF, quotes and a
# trailing comment stripped. A file with no frontmatter has no model.
kf_fm_model() {
    KF_FM_MODEL=""
    [ -r "$1" ] || return 1
    KF_FM_MODEL=$(awk '
        { sub(/[[:space:]]+$/, "") }
        NR == 1 { sub(/^\357\273\277/, ""); if ($0 != "---") exit; next }
        NR > 61 || $0 == "---" { exit }
        /^model:/ {
            v = $0; sub(/^model:[[:space:]]*/, "", v); sub(/[[:space:]]+#.*$/, "", v)
            sub(/[[:space:]]+$/, "", v)
            if (v ~ /^".*"$/ || v ~ /^'\''.*'\''$/) v = substr(v, 2, length(v) - 2)
            print v; exit
        }' "$1" 2>/dev/null)
    [ -n "$KF_FM_MODEL" ]
}
