#!/bin/bash
# test_agents.sh — what the hooks do around a subagent dispatch: the routing
# gate (a general-purpose dispatch naming a specialist's technology), the
# gated-model fallback when the mod does not beat, the session start that
# prepares both, and the agent feedback kept at SubagentStop and proposed at
# Stop. Payloads come from tests/fixtures/agent-hooks.jsonl, the shapes
# recorded from the CLI, with only the session, the directories and the
# fields under test changed. bash 3.2-safe: macOS CI runs it with /bin/bash.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
S=$ROOT/plugins/kodflow-hooks/hooks/scripts
FX=$ROOT/plugins/kodflow-hooks/tests/fixtures/agent-hooks.jsonl
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export CLAUDE_PROJECT_DIR=$T/repo HOME=$T/home TMPDIR=$T/tmp CLAUDE_CONFIG_DIR=$T/home/.claude
unset KODFLOW_ROOT KODFLOW_ROUTE KODFLOW_FABLE KODFLOW_FEEDBACK KODFLOW_MOD CLAUDE_CODE_SUBAGENT_MODEL ANTHROPIC_MODEL \
      CLAUDE_CODE_ENABLE_TODO_TOOLS CLAUDE_CODE_TASK_LIST_ID   # inherited values would change what is asserted
CFG=$CLAUDE_CONFIG_DIR
SID=sess-agents
SD=$CFG/kodflow/sessions/$SID
mkdir -p "$T/repo" "$CFG" "$T/tmp/sp"
cd "$T" || exit 1

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n       %s\n' "$1" "$2"; }

# An installed kodflow-specialists, as the CLI lays it out: the cache copy and
# installed_plugins.json naming it.
IP=$CFG/plugins/cache/kodflow/kodflow-specialists/abc123
mkdir -p "$IP/agents"
printf -- '---\nname: developer-specialist-go\nmodel: sonnet\neffort: high\n---\nGo.\n' > "$IP/agents/developer-specialist-go.md"
printf -- '---\r\nname: deep\r\nmodel: "fable" # pinned\r\n---\r\nbody\r\n' > "$IP/agents/deep.md"
printf -- '---\nname: plain\nmodel: inherit\n---\n' > "$IP/agents/plain.md"
printf -- '---\nname: bare\n---\n' > "$IP/agents/bare.md"
printf -- '\357\273\277--- \nname: bom\nmodel: fable  \n---\n' > "$IP/agents/bom.md"
printf 'no frontmatter\nmodel: fable\n' > "$IP/agents/broken.md"
installed() {   # $1 the plugin at $IP, then other plugin names installed elsewhere
    local first=$1 o; shift
    {
        printf '{\n  "version": 2,\n  "plugins": {\n'
        for o in "$@"; do
            printf '    "%s@other": [\n      {\n        "scope": "user",\n        "installPath": "%s"\n      }\n    ],\n' "$o" "$CFG/plugins/cache/other/$o/1"
        done
        printf '    "%s@kodflow": [\n      {\n        "scope": "user",\n        "installPath": "%s"\n      }\n    ]\n  }\n}\n' "$first" "$IP"
    } > "$CFG/plugins/installed_plugins.json"
}
installed kodflow-specialists

# fixture CASE [jq-update] → that recorded payload, in this test's session
fixture() {
    jq -c --arg c "$1" --arg sid "$SID" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" \
        'select(.case == $c) | .payload | .session_id = $sid | .cwd = $cwd | .scratchpad_dir = $sp' "$FX" \
        | jq -c "${2:-.}"
}
# agent DESCRIPTION [SUBAGENT_TYPE] [PROMPT] [MODEL] → a main-thread PreToolUse Agent
agent() {
    fixture "PreToolUse Agent, main thread, no per-call model" \
        | jq -c --arg d "$1" --arg t "${2:-}" --arg p "${3:-Reply ok.}" --arg m "${4:-}" \
            '.tool_input = ({description: $d, prompt: $p} + (if $t == "" then {} else {subagent_type: $t} end) + (if $m == "" then {} else {model: $m} end))'
}
# run SCRIPT JSON [ENV-assignment...] → RC, OUT, ERR
run() { local s=$1 json=$2; shift 2; OUT=$(printf '%s' "$json" | env "$@" bash "$S/$s" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err"); }
expect_rc() { [ "$RC" -eq "$2" ] && ok "$1" || bad "$1" "rc=$RC out=${OUT:0:200} err=${ERR:0:300}"; }
motif() { printf '%s' "$ERR" | grep -q "\[motif:$1\]"; }

echo "== SessionStart prepares the routing index"
run on-session.sh "$(fixture "SessionStart startup, headless (no model key)")"
expect_rc "SessionStart exits 0" 0
[ -s "$SD/routing-installed.tsv" ] && grep -q $'golang\tword\tkodflow-specialists:developer-specialist-go' "$SD/routing-installed.tsv" \
    && ok "routing-installed.tsv names the installed specialists" || bad "index written" "$(head -3 "$SD/routing-installed.tsv" 2>&1)"
grep -q $'explore\tword\tExplore' "$SD/routing-installed.tsv" && ok "built-ins are kept" || bad "built-ins" ""
installed some-other-plugin
run on-session.sh "$(fixture "SessionStart startup, headless (no model key)")"
grep -q 'kodflow-specialists:' "$SD/routing-installed.tsv" \
    && bad "not installed, not routed" "$(grep -c kodflow-specialists "$SD/routing-installed.tsv")" \
    || ok "a plugin that is not installed is filtered out"
run on-tool.sh "$(agent "Fix the golang race")"
expect_rc "so its keywords route nowhere" 0
installed kodflow-specialists alpha beta
run on-session.sh "$(fixture "SessionStart startup, headless (no model key)")"
grep -q 'kodflow-specialists:developer-specialist-go' "$SD/routing-installed.tsv" \
    && ok "several plugins installed: the index is still written (no newline in awk -v)" || bad "multi plugins" "$(cat "$SD/routing-installed.tsv" 2>&1 | head -2)"
ls "$SD"/routing-installed.tsv.*.tmp >/dev/null 2>&1 && bad "tmp left" "" || ok "no temporary file left"

echo "== the routing gate · main thread, general-purpose"
run on-tool.sh "$(agent "Fix the golang race")"
[ "$RC" -eq 2 ] && motif route && printf '%s' "$ERR" | grep -q 'kodflow-specialists:developer-specialist-go' \
    && ok "no subagent_type, a Go keyword: refused, the specialist named" || bad "route deny" "rc=$RC $ERR"
run on-tool.sh "$(agent "Edit parser.go and main.go" general-purpose)"
[ "$RC" -eq 2 ] && motif route && ok "general-purpose named, a .go extension: refused" || bad "route ext" "rc=$RC $ERR"
run on-tool.sh "$(agent "$(printf 'Fix the\ngolang race')")"
[ "$RC" -eq 2 ] && motif route && ok "a newline in the description does not slip past" || bad "route newline" "rc=$RC $ERR"
run on-tool.sh "$(agent "Review the Helm chart and Dockerfile")"
[ "$RC" -eq 2 ] && printf '%s' "$ERR" | grep -q 'devops-specialist-kubernetes' && printf '%s' "$ERR" | grep -q 'devops-specialist-docker' \
    && ok "two technologies: both specialists named" || bad "route two" "$ERR"
run on-tool.sh "$(agent "Fix the golang race" "" "[general-purpose-ok] do it here")"
expect_rc "[general-purpose-ok] in the prompt passes" 0
run on-tool.sh "$(agent "[general-purpose-ok] golang race")"
expect_rc "[general-purpose-ok] in the description passes" 0
run on-tool.sh "$(agent "Fix the golang race" kodflow-specialists:developer-specialist-go)"
expect_rc "the specialist itself passes" 0
run on-tool.sh "$(agent "Explore golang" Explore)"
expect_rc "a built-in named passes" 0
run on-tool.sh "$(agent "Fix the golang race")" KODFLOW_ROUTE=off
expect_rc "KODFLOW_ROUTE=off passes" 0
run on-tool.sh "$(fixture "PreToolUse Agent, from inside a subagent (agent_id set)" '.tool_input.description = "golang race" | .tool_input.subagent_type = "general-purpose"')"
expect_rc "a subagent's dispatch is not routed" 0
rm -f "$SD/routing-installed.tsv"
run on-tool.sh "$(agent "Fix the golang race")"
[ "$RC" -eq 2 ] && [ -s "$SD/routing-installed.tsv" ] && ok "a missing index is rebuilt at the first dispatch" || bad "reindex" "rc=$RC"
installed some-other-plugin; run on-tool.sh "$(agent "Fix the golang race")"
expect_rc "a plugin removed mid-session: the index follows installed_plugins.json" 0
installed kodflow-specialists; touch "$CFG/plugins/installed_plugins.json"
run on-tool.sh "$(agent "Fix the golang race")"
[ "$RC" -eq 2 ] && ok "and an install brings its specialists back" || bad "reinstall" "rc=$RC"
# The same change with no newer mtime (one clock second, as macOS's test -nt sees it)
installed some-other-plugin; touch -r "$SD/routing-installed.tsv" "$CFG/plugins/installed_plugins.json"
run on-tool.sh "$(agent "Fix the golang race")"
expect_rc "a change in the same second is seen: freshness is by content" 0
installed kodflow-specialists
touch -t 200001010000 "$SD/routing-installed.tsv"; printf 'stale\n' > "$SD/routing-installed.tsv"; touch -t 200001010000 "$SD/routing-installed.tsv"
run on-tool.sh "$(agent "Fix the golang race")"
[ "$RC" -eq 2 ] && grep -q golang "$SD/routing-installed.tsv" && ok "an index older than the shipped one is rebuilt" || bad "stale index" "rc=$RC"

echo "== the routing gate · real descriptions"
# What sessions dispatch as general-purpose (recorded, or written by these
# skills): none names a specialist's technology, all pass.
for d in "nested probe" "frontmatter probe" "Pin model/effort, rewrite agent descriptions" "Write five new specialist agents" \
         "architect lens review" "operator lens review" "OAuth2 spec lookup" "REST API lookup" "gather the call path" \
         "Summarise the plan" "Draft the PR body" "project-linter binary health + upgrade"; do
    run on-tool.sh "$(agent "$d")"
    expect_rc "passes: $d" 0
done
for d in "Port the Terraform module" "Fix the Valkey failover" "Review protobuf schema" "Lint the ansible playbook" \
         "Debug the PFCP session" "Fix .gitlab-ci.yml rules" "Harden the bash script"; do
    run on-tool.sh "$(agent "$d")"
    [ "$RC" -eq 2 ] && motif route && ok "routed: $d" || bad "routed: $d" "rc=$RC"
done

echo "== the routing gate · every deliberate general-purpose dispatch is marked"
for f in kodflow-workflow/skills/challenge/debate.md kodflow-review/skills/debug/SKILL.md \
         kodflow-workflow/skills/search/parallel.md kodflow-workflow/skills/plan/explore.md \
         kodflow-workflow/skills/refine/dispatch.md kodflow-review/skills/review/triage.md \
         kodflow-devops/skills/infra/agents.md kodflow-devops/skills/ktn/dispatch.md \
         kodflow-workflow/skills/_shared/scripts/route-agent.sh; do
    grep -qF '[general-purpose-ok]' "$ROOT/plugins/$f" && ok "marker written in $f" || bad "marker in $f" ""
done
# The challenge lens brief as the skill writes it, about a Go plan: it passes
brief=$(awk '/^\[general-purpose-ok\]$/{p=1} p{print} /^Here is a plan/{exit}' "$ROOT/plugins/kodflow-workflow/skills/challenge/debate.md")
run on-tool.sh "$(agent "sceptic lens on the golang plan" "" "$brief")"
expect_rc "the challenge lens brief passes on a Go plan" 0
run on-tool.sh "$(agent "OAuth2 node lookup" "" "[general-purpose-ok] OAuth2 on rfc-editor.org")"
expect_rc "the search template passes with a keyword in its description" 0

echo "== the routing gate · logged"
L=$T/repo/.claude/logs/detached/session.jsonl; rm -f "$L"
run on-tool.sh "$(agent "Fix the golang race")"
run on-tool.sh "$(agent "Fix the golang race" "" "[general-purpose-ok]")"
sleep 0.6
grep -q '"root_guard":"route-deny"' "$L" 2>/dev/null && ok "a refusal is logged route-deny" || bad "log deny" "$(cat "$L" 2>&1 | head -2)"
grep -q '"root_guard":"route-override"' "$L" 2>/dev/null && ok "an override is logged route-override" || bad "log override" ""
grep -q '"marked":true' "$L" 2>/dev/null && ok "the log says the dispatch was marked" || bad "log marked" ""

echo "== gated models · the shell fallback (no mod beat)"
rm -f "$SD/mod-beat"
run on-tool.sh "$(agent "probe" "" "x" fable)"
[ "$RC" -eq 2 ] && motif fable && ok "a per-call fable is refused" || bad "fable call" "rc=$RC $ERR"
run on-tool.sh "$(fixture "PreToolUse Agent, from inside a subagent (agent_id set)" '.tool_input.model = "fable"')"
[ "$RC" -eq 2 ] && motif fable && ok "from a subagent too" || bad "fable subagent" "rc=$RC"
run on-tool.sh "$(agent "probe" kodflow-specialists:deep)"
[ "$RC" -eq 2 ] && motif fable && printf '%s' "$ERR" | grep -q 'frontmatter' && ok "a fable frontmatter (CRLF, quoted, commented) is refused" || bad "fable fm" "rc=$RC $ERR"
run on-tool.sh "$(agent "probe" kodflow-specialists:developer-specialist-go)"
expect_rc "a sonnet frontmatter passes" 0
run on-tool.sh "$(agent "probe" kodflow-specialists:broken)"
expect_rc "malformed frontmatter on a non-gated dispatch passes" 0
run on-tool.sh "$(agent "probe" Explore)"
expect_rc "Explore, no file, passes" 0
run on-tool.sh "$(agent "probe" kodflow-specialists:developer-specialist-go)" CLAUDE_CODE_SUBAGENT_MODEL=claude-fable-5-1
expect_rc "the frontmatter wins over CLAUDE_CODE_SUBAGENT_MODEL" 0
run on-tool.sh "$(agent "probe" kodflow-specialists:bare)" CLAUDE_CODE_SUBAGENT_MODEL=claude-fable-5-1
[ "$RC" -eq 2 ] && motif fable && ok "no model of its own falls to CLAUDE_CODE_SUBAGENT_MODEL, gated: refused" || bad "fable env" "rc=$RC"
run on-tool.sh "$(agent "probe" kodflow-specialists:plain)" CLAUDE_CODE_SUBAGENT_MODEL=claude-fable-5-1
expect_rc "model: inherit is the parent's, unknown here: passes (a README hole)" 0
run on-tool.sh "$(agent "probe" "" "x" haiku)" CLAUDE_CODE_SUBAGENT_MODEL=claude-fable-5-1 CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1
[ "$RC" -eq 2 ] && motif fable && ok "CLAUDE_CODE_SUBAGENT_MODEL_FORCE wins over the call" || bad "fable force" "rc=$RC"
run on-tool.sh "$(agent "probe" kodflow-specialists:bom)"
[ "$RC" -eq 2 ] && motif fable && ok "a BOM and trailing spaces do not hide a gated frontmatter" || bad "fable bom" "rc=$RC"
# A comment after a token in gated-models.txt
GC=$T/gcopy; mkdir -p "$GC/scripts/lib"; cp "$S/lib/agents.sh" "$GC/scripts/lib/"; printf 'fable   # the note\n' > "$GC/gated-models.txt"
( . "$GC/scripts/lib/agents.sh"; kf_is_gated claude-fable-5-1 ) && ok "a trailing comment in gated-models.txt keeps its token" || bad "gated comment" ""
run on-tool.sh "$(agent "probe" "" "x" fable)" KODFLOW_FABLE=allow
expect_rc "KODFLOW_FABLE=allow passes" 0
run on-tool.sh "$(agent "probe" "" "x" fable)" KODFLOW_FABLE=off
expect_rc "KODFLOW_FABLE=off passes" 0
mkdir -p "$SD"; date +%s > "$SD/fable-granted"
run on-tool.sh "$(agent "probe" "" "x" fable)"
[ "$RC" -eq 2 ] && ok "a grant file someone wrote grants nothing" || bad "self-grant" "rc=$RC"
rm -f "$SD/fable-granted"
# A skill pinned to a gated model would switch the main conversation to it
mkdir -p "$IP/skills/deep-skill" "$IP/skills/calm"
printf -- '---\nname: deep-skill\nmodel: claude-fable-5-1\neffort: high\n---\nx\n' > "$IP/skills/deep-skill/SKILL.md"
printf -- '---\nname: calm\nmodel: inherit\neffort: low\n---\nx\n' > "$IP/skills/calm/SKILL.md"
skill() { fixture "PreToolUse Skill, main thread" "$(jq -n -c --arg k "$1" '"(.tool_input.skill = " + ($k | tojson) + ")"' | jq -r .)"; }
run on-tool.sh "$(skill kodflow-specialists:deep-skill)"
[ "$RC" -eq 2 ] && motif fable && ok "a skill pinned to a gated model is refused" || bad "skill fable" "rc=$RC $ERR"
date +%s > "$SD/mod-beat"
run on-tool.sh "$(skill kodflow-specialists:deep-skill)"
expect_rc "with the mod beating, the skill is the mod's to judge" 0
rm -f "$SD/mod-beat"
run on-tool.sh "$(skill kodflow-specialists:calm)"
expect_rc "a skill on model: inherit passes" 0
date +%s > "$SD/fable-granted"
run on-tool.sh "$(skill kodflow-specialists:deep-skill)"
[ "$RC" -eq 2 ] && ok "nor for a skill" || bad "self-grant skill" "rc=$RC"
rm -f "$SD/fable-granted"
run on-tool.sh "$(skill kodflow-specialists:deep-skill)" KODFLOW_FABLE=allow
expect_rc "KODFLOW_FABLE=allow runs the gated skill without the mod" 0
date +%s > "$SD/mod-beat"
run on-tool.sh "$(agent "probe" "" "x" fable)"
expect_rc "a fresh mod beat leaves the judgement to the mod" 0
rm -f "$SD/mod-beat"
# No jq on the machine: the fallback still refuses
NJ=$T/nojq; mkdir -p "$NJ"
for b in bash cat tr awk date head sed grep cut cksum mkdir rm mv dirname env stat sort; do
    p=$(command -v "$b") && ln -sf "$p" "$NJ/$b"
done
OUT=$(agent "probe" "" "x" fable | PATH=$NJ "$NJ/bash" "$S/on-tool.sh" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
[ "$RC" -eq 2 ] && motif fable && ok "without jq, a per-call fable is still refused" || bad "no jq" "rc=$RC $ERR"
OUT=$(agent "probe" kodflow-specialists:deep | PATH=$NJ "$NJ/bash" "$S/on-tool.sh" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
[ "$RC" -eq 2 ] && motif fable && ok "without jq, a fable frontmatter is still refused" || bad "no jq fm" "rc=$RC $ERR"
# Another JSON layout: indented, several spaces and a tab around the colons
wide() { jq . | sed -e 's/": /":  	 /g'; }
run on-tool.sh "$(agent "probe" "" "x" fable | wide)"
[ "$RC" -eq 2 ] && motif fable && ok "an indented payload with wide spacing: still refused (jq decodes it)" || bad "wide jq" "rc=$RC $ERR"
OUT=$(agent "probe" "" "x" fable | wide | PATH=$NJ "$NJ/bash" "$S/on-tool.sh" 2>"$T/err"); RC=$?; ERR=$(cat "$T/err")
[ "$RC" -eq 2 ] && motif fable && ok "the same without jq: still refused" || bad "wide nojq" "rc=$RC $ERR"
run on-tool.sh "$(skill kodflow-specialists:deep-skill | wide)"
[ "$RC" -eq 2 ] && motif fable && ok "a gated skill in that layout: refused" || bad "wide skill" "rc=$RC $ERR"
# An unreadable gated list falls back to the policy's model
( . "$S/lib/agents.sh"; KF_AGENTS_LIB=$T/nowhere; unset KF_GATED; kf_is_gated claude-fable-5-1 ) && ok "an unreadable gated list still gates fable" || bad "gated unreadable" ""

echo "== SessionStart · a session that starts on a gated model is told"
run on-session.sh "$(fixture "SessionStart startup, headless (no model key)" '.model = "claude-fable-5-1"')"
printf '%s' "$OUT" | jq -e '(.systemMessage | test("gated model")) and (.hookSpecificOutput.additionalContext | test("gated model"))' >/dev/null 2>&1 \
    && ok "the payload's model, gated: one notice" || bad "notice payload" "$OUT"
printf '{"model":"fable"}' > "$CFG/settings.json"
run on-session.sh "$(fixture "SessionStart startup, headless (no model key)")"
printf '%s' "$OUT" | jq -e '.systemMessage | test("starts on fable")' >/dev/null 2>&1 \
    && ok "no model in the payload: the settings' model is read" || bad "notice settings" "$OUT"
run on-session.sh "$(fixture "SessionStart startup, headless (no model key)")" KODFLOW_FABLE=allow
{ [ -z "$OUT" ] || printf '%s' "$OUT" | jq -e '.systemMessage // "" | test("gated") | not' >/dev/null 2>&1; } \
    && ok "KODFLOW_FABLE=allow: no notice" || bad "notice allow" "$OUT"
rm -f "$CFG/settings.json"
run on-session.sh "$(fixture "SessionStart startup, headless (no model key)" '.model = "claude-opus-5-5"')"
{ [ -z "$OUT" ] || printf '%s' "$OUT" | jq -e '.systemMessage // "" | test("gated") | not' >/dev/null 2>&1; } \
    && ok "an ungated model: no notice" || bad "notice ungated" "$OUT"

echo "== agent feedback · asked, kept, proposed once"
run on-agent.sh "$(fixture "SubagentStart, plugin agent")"
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("6\\. End your final answer with a section \"## Agent feedback\"")' >/dev/null 2>&1 \
    && ok "SubagentStart asks for the feedback section (rule 6)" || bad "rule 6" "$OUT"
run on-agent.sh "$(fixture "SubagentStart, plugin agent")" KODFLOW_FEEDBACK=off
printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("Agent feedback") | not' >/dev/null 2>&1 \
    && ok "KODFLOW_FEEDBACK=off: no rule 6" || bad "rule 6 off" "$OUT"
AIDF=$(fixture "PostToolUse Agent, async launch: agentId and resolvedModel" | jq -r '.tool_response.agentId')
run on-tool.sh "$(fixture "PostToolUse Agent, async launch: agentId and resolvedModel")"
grep -q "^$AIDF"$'\t''claude-haiku-5-5'$'\t''low' "$SD/agent-models.tsv" 2>/dev/null \
    && ok "PostToolUse Agent records agent id, resolved model, per-call effort" || bad "agent-models" "$(cat "$SD/agent-models.tsv" 2>&1)"
# Credential-shaped assignments, assembled at run time with throwaway values:
# the file carries neither a key name joined to a value nor a value a
# scanner would read as a real one.
TOKV=t$$x$RANDOM; AKN="AWS_SECRET""_ACCESS_KEY"; AKV=v$RANDOM$$q$RANDOM
FB="ok\\n\\n## Agent feedback\\nThe brief named token=$TOKV and $AKN=$AKV but the file was gone."
STOPF=$(fixture "SubagentStop, frontmatter effort low under a medium session, feedback section" \
    ".agent_id = \"$AIDF\" | .last_assistant_message = \"$FB\"")
run on-agent.sh "$STOPF"
L1=$(tail -n 1 "$SD/agent-feedback.jsonl" 2>/dev/null)
printf '%s' "$L1" | jq -e --arg id "$AIDF" --arg tv "$TOKV" --arg an "$AKN" --arg av "$AKV" '.agent_id == $id and .model == "claude-haiku-5-5" and .source == "tool_result" and .effort == "low" and (.feedback | test("token=<redacted>")) and (.feedback | contains($tv) | not) and (.feedback | contains($an + "=<redacted>")) and (.feedback | contains($av) | not)' >/dev/null 2>&1 \
    && ok "SubagentStop keeps the feedback, joined to its model, redacted" || bad "feedback line" "$L1"
[ ${#L1} -le 1024 ] && ok "the line is under 1 KB" || bad "size" "${#L1}"
HB=$(fixture "auto mode: PostToolUse SubagentHandback, report in tool_input.message" \
    ".agent_id = \"$AIDF\" | .tool_input.message = \"$FB\"")
run on-tool.sh "$HB"
[ "$(wc -l < "$SD/agent-feedback.jsonl" | tr -d ' ')" = 1 ] && ok "the same report through SubagentHandback is kept once" || bad "dedupe" "$(cat "$SD/agent-feedback.jsonl")"
run on-tool.sh "$(fixture "auto mode: PostToolUse SubagentHandback, report in tool_input.message" \
    '.agent_id = "a-other" | .agent_type = "kodflow-specialists:developer-specialist-go" | .tool_input.message = "done\n\n## Agent feedback\nThe tools list lacks WebFetch."')"
tail -n 1 "$SD/agent-feedback.jsonl" | jq -e --arg d "$IP/agents/developer-specialist-go.md" '.agent_id == "a-other" and .model == "sonnet" and .source == "frontmatter" and .definition == $d and .owner == "kodflow"' >/dev/null 2>&1 \
    && ok "a hand-back with no recorded model names the frontmatter's" || bad "handback fm" "$(tail -n 1 "$SD/agent-feedback.jsonl")"
n=$(wc -l < "$SD/agent-feedback.jsonl" | tr -d ' ')
run on-agent.sh "$(fixture "SubagentStop, frontmatter effort low under a medium session, feedback section" '.agent_id = "a-none"')"
[ "$(wc -l < "$SD/agent-feedback.jsonl" | tr -d ' ')" = "$n" ] && ok "'none' is no feedback" || bad "none" ""
run on-agent.sh "$(fixture "SubagentStop, frontmatter effort low under a medium session, feedback section" '.agent_id = "a-off" | .last_assistant_message = "x\n## Agent feedback\nreal point"')" KODFLOW_FEEDBACK=off
[ "$(wc -l < "$SD/agent-feedback.jsonl" | tr -d ' ')" = "$n" ] && ok "KODFLOW_FEEDBACK=off keeps nothing" || bad "feedback off" ""

stop() { run on-stop.sh "$(jq -n -c --arg sid "$SID" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:$sid,hook_event_name:"Stop",cwd:$cwd,scratchpad_dir:$sp,stop_hook_active:false}')" "$@"; rm -f "$T/tmp/sp/stop-count"; }
proposes() { printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext // "" | test("Subagents reported problems")' >/dev/null 2>&1; }
printf '%s\n' "$(( $(date +%s) - 3600 ))" > "$SD/composer-at"
stop; proposes && bad "absent user" "$OUT" || ok "nobody typed in 10 minutes: kept, not proposed"
date +%s > "$SD/composer-at"
stop
proposes && printf '%s' "$OUT" | jq -e '.hookSpecificOutput.additionalContext | test("lacks WebFetch") and test("Open nothing before the user says yes")' >/dev/null 2>&1 \
    && ok "the user present: proposed, asking before any issue" || bad "proposal" "$OUT"
stop; proposes && bad "proposed twice" "$OUT" || ok "proposed once"
run on-agent.sh "$(fixture "SubagentStop, frontmatter effort low under a medium session, feedback section" '.agent_id = "a-new" | .last_assistant_message = "x\n## Agent feedback\nA new point."')"
stop; proposes && printf '%s' "$OUT" | grep -q 'A new point' && ! printf '%s' "$OUT" | grep -q 'lacks WebFetch' \
    && ok "a new entry is proposed alone" || bad "new entry" "$OUT"
run on-agent.sh "$(fixture "SubagentStop, frontmatter effort low under a medium session, feedback section" '.agent_id = "a-late" | .last_assistant_message = "x\n## Agent feedback\nLater."')"
stop KODFLOW_FEEDBACK=off; proposes && bad "stop off" "$OUT" || ok "KODFLOW_FEEDBACK=off: no proposal"
printf '%s\n' "$(( $(date +%s) - 3600 ))" > "$SD/composer-at"; rm -f "$SD/mod-beat"
run on-user.sh "$(jq -n -c --arg sid "$SID" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:$sid,hook_event_name:"UserPromptSubmit",cwd:$cwd,scratchpad_dir:$sp,prompt:"go on"}')" KODFLOW_MOD=off
[ $(( $(date +%s) - $(cat "$SD/composer-at") )) -le 5 ] && ok "without the mod, a user prompt marks the user present" || bad "presence shell" "$(cat "$SD/composer-at")"
stop KODFLOW_MOD=off; proposes && printf '%s' "$OUT" | grep -q 'Later' && ok "so the feedback is proposed with KODFLOW_MOD=off" || bad "proposal mod off" "$OUT"
printf '%s\n' "$(( $(date +%s) - 3600 ))" > "$SD/composer-at"
run on-user.sh "$(jq -n -c --arg sid "$SID" --arg cwd "$T/repo" --arg sp "$T/tmp/sp" '{session_id:$sid,hook_event_name:"UserPromptSubmit",cwd:$cwd,scratchpad_dir:$sp,prompt:"<task-notification>x</task-notification>"}')" KODFLOW_MOD=off
[ $(( $(date +%s) - $(cat "$SD/composer-at") )) -ge 3000 ] && ok "a system turn does not" || bad "presence systurn" ""

echo "== every script fed the recorded payloads exits 0 or blocks on purpose"
while IFS= read -r c; do
    p=$(fixture "$c")
    ev=$(printf '%s' "$p" | jq -r .hook_event_name)
    case "$ev" in
        SessionStart) s=on-session.sh ;; SubagentStart|SubagentStop) s=on-agent.sh ;;
        PreModelSwitch|PostModelSwitch) continue ;; *) s=on-tool.sh ;;
    esac
    run "$s" "$p"
    [ "$RC" -eq 0 ] && ok "$c" || bad "$c" "rc=$RC ${ERR:0:200}"
done < <(jq -r '.case' "$FX")

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
