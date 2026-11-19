#!/usr/bin/env bash
# refine-static-fallback.sh — Skills Architecture v1.5 (PR3, fix #17)
#
# WHY: /refine's critical lenses must keep running even if route-agent.sh
# is broken (exit 20-31). This file pins agent + criticality per lens so a
# router crash can't dark-fail the whole skill. It pins no effort: the agent's
# own frontmatter carries it (model-policy.md §3), and a second value here is
# how the two disagreed. The agent is named as the engine resolves it, in the
# kodflow-specialists namespace; the router, when it works, answers with the
# name of whichever copy it found.
#
# WHY a case statement and not an associative array: bats sources this
# file in a subshell that occasionally inherits STATIC_LENS_MAP as a
# regular indexed array from a prior context. Bash then treats
# `${STATIC_LENS_MAP[$lens]}` as arithmetic expansion on the string
# "lens-1-correctness" — the dashes look like subtraction and recursive
# variable evaluation triggers `expression recursion level exceeded`.
# A case statement is type-safe, faster, and immune to that bug.

STATIC_AGENT_PLUGIN=kodflow-specialists

# Print a JSON dispatch entry for a given lens phase.
# resolved_model and effort are null: the agent's frontmatter holds both and the
# call passes neither.
# Usage: refine_static_lens <lens-phase> [json|fields]
refine_static_lens() {
  local lens="$1"
  local format="${2:-json}"
  local agent="" critical=""
  case "$lens" in
    lens-1-correctness)    agent="developer-executor-correctness"; critical="critical" ;;
    lens-2-security)       agent="developer-executor-security" ;;
    lens-3-edge-cases)     agent="developer-executor-correctness" ;;
    lens-4-rollback)       agent="devops-executor-linux" ;;
    lens-5-testability)    agent="developer-executor-quality"; critical="critical" ;;
    lens-6-dependency)     agent="devops-specialist-security" ;;
    lens-7-performance)    agent="developer-executor-design" ;;
    lens-8-observability)  agent="developer-executor-shell" ;;
    lens-9-scope)          agent="developer-orchestrator"; critical="critical" ;;
    lens-10-goal-detect)   agent="developer-specialist-review"; critical="critical" ;;
    *) return 1 ;;
  esac
  case "$format" in
    json)
      printf '{"subagent_type":"%s:%s","resolved_model":null,"model_source":"static-fallback","effort":null,"count":1,"matched_rule_id":"static:%s","fallback_used":true,"critical":%s,"expanded_from_template":false}\n' \
        "$STATIC_AGENT_PLUGIN" "$agent" "$lens" "$([[ "$critical" == "critical" ]] && echo true || echo false)"
      ;;
    fields)
      echo "$agent ${critical:--}"
      ;;
    *)
      printf 'refine_static_lens: unsupported format %q (expected: json|fields)\n' "$format" >&2
      return 2
      ;;
  esac
}

# Print a JSON dispatch entry for a post-lens refine-* pipeline phase.
# Usage: refine_static_pipeline_phase <phase> [json|fields]
#
# WHY: dispatch.md introduces 10 mono-concern refine-* agents in v1.6.
# When route-agent.sh exits 20-31 these phases must still resolve, just
# like the lens phases — otherwise the pipeline silently degrades to
# general-purpose and the contract advertised in dispatch.md is fiction.
# The agent mappings here are the SAME values that the routing-table
# entries use, so router-success and static-fallback are bit-identical.
refine_static_pipeline_phase() {
  local phase="$1"
  local format="${2:-json}"
  local agent=""
  # skills-cleanup C4: collapsed 10 mono-concern phases → 3 real passes.
  # Mappings are bit-identical to the routing-table refine-pipeline-* rows.
  case "$phase" in
    refine-correctness-pass)  agent="developer-executor-correctness"  ;;
    refine-scope-pass)        agent="developer-orchestrator" ;;
    refine-density-pass)      agent="developer-executor-quality" ;;
    *) return 1 ;;
  esac
  case "$format" in
    json)
      printf '{"subagent_type":"%s:%s","resolved_model":null,"model_source":"static-fallback","effort":null,"count":1,"matched_rule_id":"static:%s","fallback_used":true,"expanded_from_template":false}\n' \
        "$STATIC_AGENT_PLUGIN" "$agent" "$phase"
      ;;
    fields)
      echo "$agent"
      ;;
    *)
      printf 'refine_static_pipeline_phase: unsupported format %q (expected: json|fields)\n' "$format" >&2
      return 2
      ;;
  esac
}

# When sourced, expose the functions. When executed directly, dispatch.
# Direct dispatch tries the lens map first, then the pipeline map, so a
# caller can hand any /refine phase to this script without knowing which
# bucket it belongs to.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  refine_static_lens "$@" 2>/dev/null && exit 0
  refine_static_pipeline_phase "$@"
fi
