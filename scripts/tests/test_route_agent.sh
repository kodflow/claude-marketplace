#!/bin/bash
# test_route_agent.sh — route-agent.sh against a fixture plugin cache, one case
# per exit code, plus the shipped routing table checked against the agents.
#
# The router copies agents.sh and reads gated-models.txt from _shared, so every
# case runs a copy of _shared against a fake config directory holding an
# installed kodflow-specialists, the way the CLI lays the cache out. The
# machine's own ~/.claude never decides what is asserted. bash 3.2-safe.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SRC=$ROOT/plugins/kodflow-workflow/skills/_shared
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

cp -R "$SRC" "$T/_shared"
R=$T/_shared/scripts/route-agent.sh
export CLAUDE_CONFIG_DIR=$T/cfg CLAUDE_PROJECT_DIR=$T/proj HOME=$T/home
export CLAUDE_ROUTING_TELEMETRY=$T/telemetry.jsonl
unset CLAUDE_ROUTING_TABLE
mkdir -p "$T/proj" "$T/home" "$CLAUDE_CONFIG_DIR/agents"

# The installed plugin, as installed_plugins.json names it
IP=$CLAUDE_CONFIG_DIR/plugins/cache/kodflow/kodflow-specialists/abc123
mkdir -p "$IP/agents" "$CLAUDE_CONFIG_DIR/plugins"
agent() {   # DIR NAME MODEL EFFORT
    mkdir -p "$1"
    { printf -- '---\nname: %s\n' "$2"
      [ -n "$3" ] && printf 'model: %s\n' "$3"
      [ -n "$4" ] && printf 'effort: %s\n' "$4"
      printf -- '---\nbody\n'; } > "$1/$2.md"
}
agent "$IP/agents" developer-executor-correctness opus xhigh
agent "$IP/agents" developer-executor-security opus xhigh
agent "$IP/agents" developer-specialist-go sonnet high
agent "$IP/agents" developer-specialist-rust sonnet high
agent "$IP/agents" developer-specialist-react sonnet high
agent "$IP/agents" developer-specialist-nodejs "claude-sonnet-5-5[1m]" medium
agent "$IP/agents" developer-orchestrator inherit high
agent "$IP/agents" devops-executor-linux haiku low
agent "$IP/agents" devops-specialist-security fable high
agent "$IP/agents" developer-executor-quality gpt-9 low
agent "$IP/agents" developer-executor-design sonnet turbo
agent "$IP/agents" developer-executor-shell "" low
printf '{\n  "version": 2,\n  "plugins": {\n    "kodflow-specialists@kodflow": [\n      {\n        "scope": "user",\n        "installPath": "%s"\n      }\n    ]\n  }\n}\n' "$IP" \
    > "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"

profile() { printf '%s' "$1" > "$T/profile.json"; }
profile '{"languages":[{"name":"go"},{"name":"rust"}],"tools":{"react":false,"psql":false}}'

# run SKILL PHASE → OUT, ERR, RC
run() {
    OUT=$(bash "$R" --skill "$1" --phase "$2" --profile "${3:-$T/profile.json}" 2>"$T/err"); RC=$?
    ERR=$(cat "$T/err")
}
rc()   { [ "$RC" -eq "$1" ] && ok "$2" || bad "$2" "rc=$RC, want $1; stderr: $ERR"; }
field() { local got; got=$(printf '%s' "$OUT" | jq -r "$1" 2>/dev/null); [ "$got" = "$2" ] && ok "$3" || bad "$3" "$1 = [$got], want [$2]"; }
table() { printf '%s\n' "$@" > "$T/table.jsonl"; export CLAUDE_ROUTING_TABLE=$T/table.jsonl; }

echo "exit 0 — dispatch"
run /refine lens-1-correctness; rc 0 "a rule resolves"
field '.[0].subagent_type' kodflow-specialists:developer-executor-correctness "the installed plugin's agent is namespaced"
field '.[0].resolved_model' opus "the model is the frontmatter's"
field '.[0].effort' xhigh "the effort is the frontmatter's"
field '.[0].model_source' agent_frontmatter "the source says so"
run /refine lens-3-edge-cases; field '.[0].effort' xhigh "two lenses on one agent get one effort"
run /refine lens-9-scope; field '.[0].resolved_model' inherit "inherit is a model the validator accepts"

run /review review; rc 0 "a language fan-out"
field 'map(.subagent_type) | sort | join(",")' kodflow-specialists:developer-specialist-go,kodflow-specialists:developer-specialist-rust "one specialist per language"
field '.[0].expanded_from_template' true "marked as expanded"
profile '{"languages":[{"name":"typescript"},{"name":"nodejs"},{"name":"java"}]}'
run /review review; rc 0 "typescript and nodejs are one specialist, java has none"
field 'length' 1 "deduplicated by agent"
field '.[0].resolved_model' 'claude-sonnet-5-5[1m]' "a full model id is accepted"
profile '{"languages":["go"],"tools":{"react":true}}'
run /review review; field 'length' 2 "a rule with a guard joins the fan-out when it holds"

mkdir -p "$T/proj/.claude/agents" "$CLAUDE_CONFIG_DIR/agents"
agent "$CLAUDE_CONFIG_DIR/agents" developer-specialist-rust haiku low
run /review review
field 'map(select(.subagent_type | endswith("rust"))) | length' 0 "go-only profile: rust is not asked"
profile '{"languages":["go","rust"]}'
run /review review
field 'map(select(.subagent_type == "developer-specialist-rust")) | .[0].resolved_model' haiku "the user's agent wins and keeps its bare name"
agent "$T/proj/.claude/agents" developer-specialist-rust opus max
run /review review
field 'map(select(.subagent_type == "developer-specialist-rust")) | .[0].effort' max "the project's agent wins over the user's"
rm -f "$CLAUDE_CONFIG_DIR/agents/developer-specialist-rust.md" "$T/proj/.claude/agents/developer-specialist-rust.md"

table '{"id":"b","skill":"/x","phase":"bulk","agent":"developer-executor-security","escalation":"bulk"}'
run /x bulk; rc 0 "a bulk rule"
field '.[0].resolved_model' haiku "bulk: model-policy §3 haiku"
field '.[0].effort' low "bulk: low"
table '{"id":"a","skill":"/x","phase":"p","agent":"developer-executor-shell"}'
run /x p; rc 31 "an agent with no model is refused"
table '{"id":"a","skill":"*","phase":"*","agent":"developer-executor-security","priority":1}' \
      '{"id":"b","skill":"/x","phase":"p","agent":"devops-executor-linux","priority":5}' \
      '{"id":"c","skill":"/x","phase":"p","agent":"developer-specialist-go","priority":5}'
run /x p; rc 0 "wildcards and priorities"
field 'length' 1 "no fanout: one rule"
field '.[0].subagent_type' kodflow-specialists:devops-executor-linux "highest priority, lowest id"
profile '{"languages":["go"]}'
OUT=$(bash "$R" --skill /x --phase p --profile "$T/profile.json" --dry-run 2>/dev/null); field '.matched_rules | length' 2 "--dry-run shows the matched tier"
unset CLAUDE_ROUTING_TABLE

echo "exit 10 — general-purpose fallback"
run /nope nope; rc 10 "no rule matches"
field '.[0].subagent_type' general-purpose "the fallback agent"
field '.[0].marker' '[general-purpose-ok]' "carries the gate's marker"
field '.[0].resolved_model' null "no model invented"
field '.[0].effort' null "no effort invented"
[ -s "$T/telemetry.jsonl" ] && ok "the fallback is logged" || bad "the fallback is logged" "no telemetry"
export CLAUDE_ROUTING_TABLE=$T/absent.jsonl; run /refine lens-1-correctness; rc 10 "no table at all"
table '{"id":"t","skill":"/x","phase":"p","agent":"developer-executor-security","guard":".nope == 1"}'
run /x p; rc 10 "a guard that is false"
profile '{"languages":["java"]}'
table '{"id":"t","skill":"/x","phase":"p","agent_template":"developer-specialist-{language}","expand_from":".languages[]"}'
run /x p; rc 10 "templates with no installed agent"
unset CLAUDE_ROUTING_TABLE

echo "exit 2, 20-23 — bad input"
run /refine lens-1-correctness "$T/missing.json"; rc 20 "no profile file"
printf 'not json' > "$T/bad.json"; run /refine lens-1-correctness "$T/bad.json"; rc 20 "profile that is not JSON"
bash "$R" --skill /x >/dev/null 2>&1; RC=$?; rc 2 "missing flags"
bash "$R" --bogus >/dev/null 2>&1; RC=$?; rc 2 "unknown flag"
profile '{}'
table '{"id":"t","skill":"/x","phase":"p","agent":"a"}' 'not json'; run /x p; rc 21 "a malformed rule"
table '{"id":"t","skill":"/x","phase":"p","agent":"developer-executor-security","effort":"max"}'; run /x p; rc 21 "a rule may not set effort"
table '{"id":"t","skill":"/x","phase":"p","agent":"developer-executor-security","model":"opus"}'; run /x p; rc 21 "a rule may not set model"
table '{"id":"t","skill":"/x","phase":"p","agent":"developer-executor-security","escalation":"max"}'; run /x p; rc 21 "an escalation outside model-policy §3"
table '{"id":"t","skill":"/x","phase":"p","agent":"developer-executor-security","guard":".a |"}'; run /x p; rc 22 "a guard that does not parse"
table '{"id":"t","skill":"/x","phase":"p","agent_template":"x-{language}"}'; run /x p; rc 23 "a template without expand_from"
table '{"id":"t","skill":"/x","phase":"p","expand_from":".a"}'; run /x p; rc 23 "expand_from without a template"
table '{"id":"t","skill":"/x","phase":"p"}'; run /x p; rc 23 "a rule naming no agent"
table '{"id":"t","skill":"/x","phase":"p","agent":"a","agent_template":"b","expand_from":".a"}'; run /x p; rc 23 "an agent and a template"

echo "exit 30, 31 — the agent"
table '{"id":"t","skill":"/x","phase":"p","agent":"developer-specialist-cobol"}'; run /x p; rc 30 "an agent with no definition"
table '{"id":"t","skill":"/x","phase":"p","agent":"../../etc/passwd"}'; run /x p; rc 30 "a name that is a path"
table '{"id":"t","skill":"/x","phase":"p","agent":"devops-specialist-security"}'; run /x p; rc 31 "a gated model is refused"
case "$ERR" in *gated*) ok "and says it is gated" ;; *) bad "and says it is gated" "$ERR" ;; esac
table '{"id":"t","skill":"/x","phase":"p","agent":"developer-executor-quality"}'; run /x p; rc 31 "an unknown model is refused"
table '{"id":"t","skill":"/x","phase":"p","agent":"developer-executor-design"}'; run /x p; rc 31 "an unknown effort is refused"
profile '{"languages":["go"]}'
table '{"id":"t","skill":"/x","phase":"p","agent_template":"devops-specialist-{aspect}","expand_from":".languages[] | \"security\""}'
run /x p; rc 31 "a gated agent reached through a template is not skipped"
printf 'fable\nopus\n' > "$T/_shared/gated-models.txt"
table '{"id":"t","skill":"/x","phase":"p","agent":"developer-executor-security"}'; run /x p; rc 31 "the gated list is read from _shared"
cp "$SRC/gated-models.txt" "$T/_shared/gated-models.txt"
unset CLAUDE_ROUTING_TABLE

# A definition that only another plugin ships has no name the router can emit
OP=$CLAUDE_CONFIG_DIR/plugins/cache/other/thirdparty/1
agent "$OP/agents" developer-specialist-java sonnet high
cp "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json" "$T/ip.bak"
jq --arg p "$OP" '.plugins["thirdparty@other"] = [{"scope":"user","installPath":$p}]' "$T/ip.bak" > "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
profile '{"languages":["java"]}'
table '{"id":"t","skill":"/x","phase":"p","agent_template":"developer-specialist-{language}","expand_from":".languages[]"}'
run /x p; rc 30 "an agent found only in another plugin is refused, not emitted bare"
cp "$T/ip.bak" "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
unset CLAUDE_ROUTING_TABLE

echo "the shipped table"
TBL=$SRC/routing-table.jsonl
AG=$ROOT/plugins/kodflow-specialists/agents
n=0
while IFS= read -r a; do
    [ -f "$AG/$a.md" ] || { bad "table agent $a exists" "no $AG/$a.md"; continue; }
    n=$((n+1))
done < <(jq -r '.agent // empty' "$TBL" | sort -u)
[ "$n" -gt 0 ] && ok "$n agents named by the table all exist" || bad "agents named by the table" "none"
jq -e 'has("model") or has("effort")' "$TBL" >/dev/null 2>&1 && bad "no shipped rule sets model or effort" "found one" || ok "no shipped rule sets model or effort"
# Every shipped rule is valid to the router and its ids are unique
dups=$(jq -r '.id' "$TBL" | sort | uniq -d)
[ -z "$dups" ] && ok "rule ids are unique" || bad "rule ids are unique" "$dups"
# The static fallback names the same agent as the table, lens by lens
. "$T/_shared/scripts/refine-static-fallback.sh"
drift=""
while IFS=$'\t' read -r phase agent; do
    case "$phase" in lens-*) got=$(refine_static_lens "$phase" fields) ;; *) got=$(refine_static_pipeline_phase "$phase" fields) ;; esac
    [ "${got%% *}" = "$agent" ] || drift="$drift $phase($agent vs ${got%% *})"
done < <(jq -r 'select(.skill == "/refine") | [.phase, .agent] | @tsv' "$TBL")
[ -z "$drift" ] && ok "refine-static-fallback.sh matches the table" || bad "refine-static-fallback.sh matches the table" "$drift"
# With the real agents installed from this checkout, every concrete rule resolves
rm -rf "$IP/agents"; cp -R "$AG" "$IP/agents"
profile '{"languages":["go","rust","python","typescript","c_cpp","zig"],"tools":{"react":true,"psql":true},"k8s":true}'
fails=""
for sp in "/refine lens-1-correctness" "/refine lens-10-goal-detect" "/refine refine-density-pass" "/review review" "/search external" "/infra apply"; do
    set -- $sp; run "$1" "$2"
    [ "$RC" -eq 0 ] || fails="$fails $sp(rc=$RC: $ERR)"
done
[ -z "$fails" ] && ok "the shipped table resolves against the shipped agents" || bad "the shipped table resolves against the shipped agents" "$fails"
for ph in lens-1-correctness lens-2-security lens-3-edge-cases lens-4-rollback lens-5-testability lens-6-dependency lens-7-performance lens-8-observability lens-9-scope lens-10-goal-detect; do
    run /refine "$ph"; [ "$RC" -eq 0 ] || fails="$fails $ph"
done
[ -z "$fails" ] && ok "all ten lenses resolve" || bad "all ten lenses resolve" "$fails"
# Every agent of the specialists.md table resolves through the router from
# the shipped agents, and the systemd split holds: the review-tier systemd
# specialist on opus/high, the Linux router left on its own tier.
fails=""
for a in $(sed -n 's/^|[^|]*| `\([a-z0-9-]*\)` |.*/\1/p' "$SRC/specialists.md" | sort -u); do
    [ -f "$AG/$a.md" ] || continue
    table "{\"id\":\"s\",\"skill\":\"/x\",\"phase\":\"p\",\"agent\":\"$a\"}"
    run /x p
    [ "$RC" -eq 0 ] && [ "$(printf '%s' "$OUT" | jq -r '.[0].subagent_type')" = "kodflow-specialists:$a" ] || fails="$fails $a(rc=$RC)"
done
[ -z "$fails" ] && ok "every specialists.md agent resolves, namespaced" || bad "every specialists.md agent resolves, namespaced" "$fails"
table '{"id":"s","skill":"/x","phase":"p","agent":"domain-specialist-systemd"}'
run /x p
field '.[0].subagent_type' kodflow-specialists:domain-specialist-systemd "systemd semantics resolve to the systemd specialist"
field '.[0].resolved_model + "/" + .[0].effort' opus/high "at the review tier, from its frontmatter"
table '{"id":"s","skill":"/x","phase":"p","agent":"devops-executor-linux"}'
run /x p
field '.[0].resolved_model + "/" + .[0].effort' haiku/low "the Linux router keeps its own tier"
unset CLAUDE_ROUTING_TABLE

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
