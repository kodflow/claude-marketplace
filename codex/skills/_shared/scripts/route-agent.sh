#!/usr/bin/env bash
# route-agent.sh — resolve a skill+phase+profile to a dispatch decision.
#
# WHY: keeps skills decoupled from concrete agent choices. A skill says
# "I need a worker for /review phase=review on this profile" and the router
# returns the Agent-tool arguments to use: a subagent_type the engine can
# resolve, and the model and effort that agent pins.
#
# The rules live in _shared/routing-table.jsonl, shipped beside this script
# (CLAUDE_ROUTING_TABLE points elsewhere). A rule names an agent bare, as
# specialists.md does; the router finds its definition the way the hooks do
# (agents.sh: the project's agents, the user's, then the installed copy of
# kodflow-specialists named by installed_plugins.json) and emits the name the
# engine accepts: bare for a project or user agent, kodflow-specialists:<name>
# for the plugin's. Model and effort are the agent's own frontmatter, never the
# rule's: a rule may not carry either, except `"escalation": "bulk"`, the one
# model-policy §3 case a table can state (a stage sized as Haiku work).
#
# A rule is one JSON object a line:
#   id, skill, phase           skill and phase accept "*"
#   agent                      one agent, bare name
#   agent_template + expand_from   one agent per value expand_from (a jq filter on
#                              the profile) prints; {language} {aspect} {framework}
#                              {cloud} are replaced. A value with no agent installed
#                              is skipped; when none resolves the answer is exit 10
#   guard                      jq filter on the profile, true when absent
#   priority                   highest tier wins, ties broken by id
#   fanout                     any rule of the tier sets it: every rule of the tier
#                              is dispatched, deduplicated by agent
#   escalation                 "bulk" only
#
# Exit codes (contract):
#   0  dispatch success
#   10 no match — fallback general-purpose was used; its JSON carries marker
#      "[general-purpose-ok]", which the caller puts in the prompt so the
#      kodflow-hooks routing gate reads the dispatch as deliberate. Model and
#      effort are null there: the caller sets them per model-policy §2
#   2  usage
#   20 invalid profile JSON
#   21 invalid routing rule (malformed JSONL, or a model or effort in a rule)
#   22 jq guard evaluation error
#   23 agent_template without expand_from (or vice versa)
#   30 the agent's definition cannot be found or read
#   31 the agent's model is missing, invalid or gated (model-policy §6), or its effort
#      is invalid

set -uo pipefail
# WHY: not -e so we can return tailored exit codes per error condition.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTING_TABLE="${CLAUDE_ROUTING_TABLE:-$SCRIPT_DIR/../routing-table.jsonl}"
TELEMETRY_LOG="${CLAUDE_ROUTING_TELEMETRY:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/logs/router-fallbacks.jsonl}"
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PROJECT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# The plugin whose agents the table names; its installed copy is the third
# place an agent is looked for.
AGENT_PLUGIN="kodflow-specialists"
# agents.sh reads the gated list from hooks/; here it sits one level up.
export KF_GATED_FILE="$SCRIPT_DIR/../gated-models.txt"

SKILL=""
PHASE=""
PROFILE_PATH=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill)    SKILL="${2:-}"; shift 2 || shift ;;
    --phase)    PHASE="${2:-}"; shift 2 || shift ;;
    --profile)  PROFILE_PATH="${2:-}"; shift 2 || shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    -h|--help)
      cat <<USAGE
route-agent.sh — resolve a skill+phase+profile to a dispatch decision.

  --skill <name>        e.g. /review, /refine, /search
  --phase <name>        skill phase identifier
  --profile <path>      path to a JSON profile (output of detect-project.sh)
  --dry-run             explain rule resolution, never side-effect

See routing-table.jsonl for available rules.
USAGE
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

[[ -z "$SKILL" || -z "$PHASE" || -z "$PROFILE_PATH" ]] && {
  echo "missing --skill / --phase / --profile" >&2; exit 2;
}

# --- Validate profile JSON ---
if ! PROFILE_JSON="$(cat "$PROFILE_PATH" 2>/dev/null)" \
   || ! echo "$PROFILE_JSON" | jq empty 2>/dev/null; then
  echo "invalid profile JSON at $PROFILE_PATH" >&2
  exit 20
fi

# WHY: defined BEFORE the routing-table guard below. Bash does not hoist
# functions, so the missing-table guard (which calls emit_fallback) must
# see the definition first — otherwise an absent routing table dies with
# exit 127 (command not found) instead of emitting the JSON fallback +
# exit 10.
emit_fallback() {
  local reason="$1" phase="$2"
  mkdir -p "$(dirname "$TELEMETRY_LOG")" 2>/dev/null
  jq -n --arg ts "$(date -u +%FT%TZ)" --arg s "$SKILL" --arg p "$phase" --arg r "$reason" \
        '{ts:$ts, skill:$s, phase:$p, reason:$r}' >> "$TELEMETRY_LOG" 2>/dev/null
  # No model and no effort: general-purpose has no frontmatter to read, and a
  # value written here would be a guess that outlives the policy. The caller
  # sets both on the call (model-policy §2).
  jq -n '{
    subagent_type: "general-purpose",
    resolved_model: null,
    model_source: "caller",
    effort: null,
    count: 1,
    owned_paths_hint: [],
    matched_rule_id: null,
    fallback_used: true,
    expanded_from_template: false,
    marker: "[general-purpose-ok]"
  } | [.]'
}

# --- Parse routing-table line-by-line ---
[[ -r "$ROUTING_TABLE" ]] || {
  # No table = always fallback
  emit_fallback "no-routing-table" "$PHASE"
  exit 10
}

# --- Validate each rule ---
LINE_NO=0
while IFS= read -r rule || [[ -n "$rule" ]]; do
  LINE_NO=$((LINE_NO + 1))
  [[ -z "$rule" ]] && continue
  if ! echo "$rule" | jq -e 'type == "object"' >/dev/null 2>&1; then
    echo "invalid JSON in routing table line $LINE_NO" >&2
    exit 21
  fi
  # A rule holds no model or effort: the agent's frontmatter decides, and a
  # second place to set them is how the two disagree (model-policy §3).
  if echo "$rule" | jq -e 'has("model") or has("effort")' >/dev/null 2>&1; then
    echo "rule $LINE_NO: a rule may not set model or effort (use \"escalation\": \"bulk\")" >&2
    exit 21
  fi
  if echo "$rule" | jq -e 'has("escalation") and .escalation != "bulk"' >/dev/null 2>&1; then
    echo "rule $LINE_NO: unknown escalation (model-policy §3 allows \"bulk\")" >&2
    exit 21
  fi
  # agent_template ↔ expand_from coupling
  has_template=$(echo "$rule" | jq 'has("agent_template")')
  has_expand=$(echo "$rule"   | jq 'has("expand_from")')
  has_agent=$(echo "$rule"    | jq 'has("agent")')
  if [[ "$has_template" = "true" && "$has_expand" != "true" ]] \
     || [[ "$has_expand"  = "true" && "$has_template" != "true" ]] \
     || [[ "$has_agent"   = "true" && "$has_template" = "true" ]] \
     || [[ "$has_agent"   != "true" && "$has_template" != "true" ]]; then
    echo "rule $LINE_NO: must have exactly one of (agent) or (agent_template + expand_from)" >&2
    exit 23
  fi
done < "$ROUTING_TABLE"

# --- Filter + score rules ---
filtered=$(jq -c --arg s "$SKILL" --arg p "$PHASE" \
     'select((.skill == $s or .skill == "*") and (.phase == $p or .phase == "*"))' \
     "$ROUTING_TABLE")

# Apply guards (jq expressions evaluated against profile JSON)
applicable="[]"
while IFS= read -r rule; do
  [[ -z "$rule" ]] && continue
  guard=$(echo "$rule" | jq -r '.guard // "true"')
  if echo "$PROFILE_JSON" | jq -e "$guard" >/dev/null 2>&1; then
    applicable=$(echo "$applicable" | jq --argjson r "$rule" '. + [$r]')
  else
    # WHY: guard returning false is normal; only a parse error is escalated.
    # Captured, not piped to grep -q: under pipefail its early exit makes the
    # pipeline fail on SIGPIPE whether or not jq complained
    guard_err=$(echo "$PROFILE_JSON" | jq "$guard" 2>&1 >/dev/null)
    if [[ "$guard_err" == *error* ]]; then
      echo "jq guard error in rule $(echo "$rule" | jq -r '.id'): $guard" >&2
      exit 22
    fi
  fi
done <<< "$filtered"

count=$(echo "$applicable" | jq 'length')
if [[ "$count" -eq 0 ]]; then
  emit_fallback "no-match" "$PHASE"
  exit 10
fi

# Sort by priority DESC, tie-break by id ASC, keep top tier
top_priority=$(echo "$applicable" | jq 'map(.priority // 0) | max')
top_rules=$(echo "$applicable" | jq --argjson p "$top_priority" \
              '[.[] | select((.priority // 0) == $p)] | sort_by(.id)')

# --- Resolve agent definitions the way the hooks do ---
# shellcheck source=/dev/null
. "$SCRIPT_DIR/agents.sh" 2>/dev/null || {
  echo "agents.sh missing next to route-agent.sh: agent definitions cannot be read" >&2
  exit 30
}

# resolve_agent NAME → R_TYPE R_MODEL R_EFFORT, return 30 or 31.
resolve_agent() {
  local name="$1" def model effort
  R_TYPE=""; R_MODEL=""; R_EFFORT=""
  if ! kf_agent_def "$name" "$CFG" "$PROJECT"; then
    echo "agent $name: no definition in the project, the user's agents or an installed plugin" >&2
    return 30
  fi
  def="$KF_AGENT_DEF"
  case "$def" in
    "$PROJECT"/.claude/agents/*|"$CFG"/agents/*) R_TYPE="$name" ;;
    *)
      # Installed plugin copy: the engine only resolves the namespaced name
      if kf_agent_def "$AGENT_PLUGIN:$name" "$CFG" "$PROJECT" && [[ "$KF_AGENT_DEF" = "$def" ]]; then
        R_TYPE="$AGENT_PLUGIN:$name"
      else
        R_TYPE="$name"
      fi ;;
  esac
  if ! kf_fm_model "$def"; then
    echo "agent $name: no model in the frontmatter of $def" >&2
    return 31
  fi
  model="$KF_FM_MODEL"
  # Every value validate-frontmatter.py accepts
  case "$model" in
    haiku|sonnet|opus|fable|inherit|claude-*) ;;
    *) echo "agent $name: invalid model '$model'" >&2; return 31 ;;
  esac
  if kf_is_gated "$model"; then
    echo "agent $name: model '$model' is gated (model-policy.md §6)" >&2
    return 31
  fi
  effort=""
  kf_fm_effort "$def" && effort="$KF_FM_EFFORT"
  case "$effort" in low|medium|high|xhigh|max|"") ;; *)
    echo "agent $name: invalid effort '$effort'" >&2; return 31 ;;
  esac
  R_MODEL="$model"; R_EFFORT="$effort"
}

entries="[]"
FAIL_RC=0

# add_entry RULE NAME EXPANDED → appends to $entries, once per subagent_type.
# Sets FAIL_RC on 30/31 and returns it.
add_entry() {
  local rule="$1" name="$2" expanded="$3" rid esc
  resolve_agent "$name" || { FAIL_RC=$?; return "$FAIL_RC"; }
  esc=$(echo "$rule" | jq -r '.escalation // ""')
  rid=$(echo "$rule" | jq -r '.id')
  if echo "$entries" | jq -e --arg t "$R_TYPE" 'any(.[]; .subagent_type == $t)' >/dev/null; then
    return 0
  fi
  entries=$(echo "$entries" | jq \
    --arg s "$R_TYPE" --arg m "$R_MODEL" --arg e "$R_EFFORT" --arg rid "$rid" \
    --arg esc "$esc" --argjson expanded "$expanded" '
    ($esc == "bulk") as $bulk
    | . + [{
        subagent_type: $s,
        resolved_model: (if $bulk then "haiku" else $m end),
        model_source: (if $bulk then "policy-3-bulk" else "agent_frontmatter" end),
        effort: (if $bulk then "low" elif $e == "" then null else $e end),
        count: 1,
        owned_paths_hint: [],
        matched_rule_id: $rid,
        fallback_used: false,
        expanded_from_template: $expanded
      }]')
}

fanout=$(echo "$top_rules" | jq 'any(.[]; .fanout == true)')

# expand_rule RULE → one agent per value, a value without an agent skipped
expand_rule() {
  local rule="$1" template expand_jq v agent placeholder
  template=$(echo "$rule" | jq -r '.agent_template')
  expand_jq=$(echo "$rule" | jq -r '.expand_from')
  while IFS= read -r v; do
    [[ -z "$v" || "$v" = "null" ]] && continue
    # The value comes from the profile: it must not reshape the agent path
    case "$v" in *[!A-Za-z0-9_.-]*) continue ;; esac
    agent="$template"
    for placeholder in language aspect framework cloud; do
      agent=${agent//\{$placeholder\}/$v}
    done
    # Presence only: a definition that exists but is gated or invalid is
    # still add_entry's to refuse, not to hide here
    if kf_agent_def "$agent" "$CFG" "$PROJECT"; then
      add_entry "$rule" "$agent" true || return $?
    fi
  done < <(echo "$PROFILE_JSON" | jq -r "$expand_jq" 2>/dev/null)
  return 0
}

if [[ "$fanout" = "true" ]]; then
  rules_to_run=$(echo "$top_rules" | jq -c '.[]')
else
  # Only the lex-first rule of the top priority tier
  rules_to_run=$(echo "$top_rules" | jq -c '.[0]')
fi

while IFS= read -r rule; do
  [[ -z "$rule" ]] && continue
  if echo "$rule" | jq -e 'has("agent_template")' >/dev/null 2>&1; then
    expand_rule "$rule" || exit $?
  else
    add_entry "$rule" "$(echo "$rule" | jq -r '.agent')" false || exit $?
  fi
done <<< "$rules_to_run"

if [[ "$(echo "$entries" | jq 'length')" -eq 0 ]]; then
  # Templates only, and no value had an agent installed
  emit_fallback "no-agent-installed" "$PHASE"
  exit 10
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  jq -n --argjson e "$entries" --argjson r "$top_rules" \
        '{matched_rules: $r, dispatch: $e}'
else
  echo "$entries"
fi
