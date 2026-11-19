#!/usr/bin/env bash
# Resolve the model tiers a plan may assign, from what this machine actually has.
#
# The orchestrator must sit on the highest model the account can reach, and the
# workers on a tier chosen for code quality rather than for cleverness. Neither
# may be hardcoded: a hardcoded top model is wrong the day a better one ships,
# which on current release cadence is weeks, not years.
#
# Emits shell-sourceable KEY=VALUE lines. Reads only local state; makes no
# network call, so it is safe to run at the start of every plan.
set -uo pipefail
emit() { printf '%s=%s\n' "$1" "$2"; }

CJ="${HOME}/.claude.json"

# Gated tokens, one a line (gated-models.txt beside this directory), |-joined.
# An unreadable list must not make every model ungated: it falls back to the
# one model the policy gates today, as the hooks do.
GATED=""
GF="${BASH_SOURCE[0]%/*}/../gated-models.txt"
if [ ! -r "$GF" ]; then
  GATED=fable
else
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%%#*}
    line=$(printf '%s' "$line" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
    [ -n "$line" ] || continue
    GATED="${GATED:+$GATED|}$line"
  done < "$GF"
fi
emit CLAUDE_GATED "$GATED"

# ---- Anthropic side ---------------------------------------------------------
# The CLI caches the models this account may select, with the top one carrying
# a "Most capable" description. That cache is what /model reads, so it updates
# itself when the account gains access to something newer.
if [ -r "$CJ" ] && command -v jq >/dev/null 2>&1; then
  emit CLAUDE_TOP "$(jq -r '.additionalModelOptionsCache // [] | map(select(.description|test("Most capable";"i"))) | .[0].value // (.[0].value // "")' "$CJ" 2>/dev/null)"
  emit CLAUDE_TOP_LABEL "$(jq -r '.additionalModelOptionsCache // [] | .[0].description // ""' "$CJ" 2>/dev/null)"
  # The orchestrator's model: the most capable one that is not gated
  # (gated-models.txt, model-policy.md §6). The cache lists only the models
  # beyond the CLI's built-in ones, so when every entry is gated the alias
  # `opus` stands in: the CLI resolves it to its current Opus, nothing here
  # names a version.
  emit CLAUDE_TOP_UNGATED "$(jq -r --arg g "$GATED" '
      ($g | split("|") | map(select(. != ""))) as $gs
      | def gated: (.value // "" | ascii_downcase) as $v | any($gs[]; . as $t | $v | contains($t));
      (.additionalModelOptionsCache // [] | map(select(gated | not))) as $ok
      | ($ok | map(select(.description // "" | test("Most capable"; "i"))) | .[0].value)
        // ($ok | .[0].value) // "opus"' "$CJ" 2>/dev/null)"
  emit CLAUDE_PLAN "$(jq -r '.oauthAccount.organizationRateLimitTier // .oauthAccount.userRateLimitTier // "unknown"' "$CJ" 2>/dev/null)"
  emit CLAUDE_OVERAGE_MODELS "$(jq -r '.cachedGrowthBookFeatures.tengu_usage_overage_included_models // [] | join("|")' "$CJ" 2>/dev/null)"
  # Models this account has actually billed against — evidence of real access.
  emit CLAUDE_SEEN "$(jq -r '[.projects // {} | to_entries[] | .value.lastModelUsage // {} | keys[]] | unique | join("|")' "$CJ" 2>/dev/null)"
else
  # Access unknown: no guess. An empty value is the policy's cue to say so and
  # fall back to the session model.
  emit CLAUDE_TOP ""; emit CLAUDE_TOP_UNGATED ""; emit CLAUDE_PLAN unknown
fi

# Billing shape decides what "cost" even means. On a subscription the binding
# constraint is the rate limit, not a dollar figure — a swarm is limited by how
# fast it burns quota, and the per-token price is an equivalence, not a bill.
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  emit CLAUDE_BILLING api-key
elif [ -r "${HOME}/.claude/.credentials.json" ]; then
  emit CLAUDE_BILLING subscription
else
  emit CLAUDE_BILLING unknown
fi

# ---- OpenAI / Codex side ----------------------------------------------------
emit CODEX_CLI "$(command -v codex >/dev/null 2>&1 && echo 1 || echo 0)"
if [ -r "${HOME}/.codex/auth.json" ] && command -v jq >/dev/null 2>&1; then
  emit CODEX_AUTH "$(jq -r '.auth_mode // "unknown"' "${HOME}/.codex/auth.json" 2>/dev/null)"
  emit CODEX_BILLING "$(jq -r 'if .auth_mode == "chatgpt" then "subscription" else "api-key" end' "${HOME}/.codex/auth.json" 2>/dev/null)"
else
  emit CODEX_AUTH absent; emit CODEX_BILLING unknown
fi
# The Codex docs skill ships a curated model map that its own header calls
# drift-prone. Report where it is and how old, never treat it as current.
MM="${HOME}/.codex/skills/.system/openai-docs/references/latest-model.md"
if [ -r "$MM" ]; then
  emit CODEX_MODEL_MAP "$MM"
  emit CODEX_MODEL_MAP_AGE_DAYS "$(( ( $(date +%s) - $(stat -c %Y "$MM" 2>/dev/null || echo 0) ) / 86400 ))"
else
  emit CODEX_MODEL_MAP ""
fi

emit RESOLVED_AT "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
