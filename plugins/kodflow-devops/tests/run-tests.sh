#!/usr/bin/env bash
# run-tests.sh — assertions for skills/usage/scripts/usage_report.py.
#
# Every fixture below is written here, into a throwaway directory. The suite
# never reads ~/.claude/projects: a test that depends on the machine's own
# sessions passes for reasons nobody can reconstruct, and fails the day someone
# deletes a transcript.
#
#   ./tests/run-tests.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="$ROOT/skills/usage/scripts/usage_report.py"

PASS=0
FAIL=0
ok()   { printf '  ok    %s\n' "$1"; PASS=$((PASS + 1)); }
ko()   { printf '  FAIL  %s\n        %s\n' "$1" "$2"; FAIL=$((FAIL + 1)); }
is()   { [ "$2" = "$3" ] && ok "$1" || ko "$1" "expected [$3], got [$2]"; }
has()  { case "$2" in *"$3"*) ok "$1";; *) ko "$1" "[$3] missing from output";; esac; }

BOX="$(mktemp -d "${TMPDIR:-/tmp}/kodflow-usage-tests.XXXXXX")"
trap 'rm -rf -- "$BOX"' EXIT INT TERM

# rec <msg-id> <iso-ts> <model> <effort> <in> <cache-read> <write-5m> <write-1h> <out> [agent]
# Shaped like the real records: the fields the report reads, and nothing else.
rec() {
  local agent=""
  [ -n "${10:-}" ] && agent=",\"attributionAgent\":\"${10}\",\"agentId\":\"a1\""
  printf '{"type":"assistant","timestamp":"%s","effort":"%s","isSidechain":%s%s,"message":{"id":"%s","role":"assistant","model":"%s","usage":{"input_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s,"cache_creation":{"ephemeral_5m_input_tokens":%s,"ephemeral_1h_input_tokens":%s},"output_tokens":%s}}}\n' \
    "$2" "$4" "$([ -n "${10:-}" ] && echo true || echo false)" "$agent" \
    "$1" "$3" "$5" "$6" "$(( $7 + $8 ))" "$7" "$8" "$9"
}

# noise — the lines that are not assistant records, so the reader must skip them
noise() {
  printf '{"type":"user","message":{"role":"user","content":"bonjour"}}\n'
  printf '{"type":"ai-title","aiTitle":"fixture"}\n'
  printf '\n'
}

# run <projects-dir> [args...] -> JSON on stdout
run_json() { python3 "$REPORT" --projects "$1" --json "${@:2}"; }

# field <json-file> <python expression over d>
field() {
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$1" "$2"
}

newbox() { local d="$BOX/$1/-home-user-proj"; mkdir -p "$d"; printf '%s' "$d"; }

# --- 1. the same message id, counted once ----------------------------------
echo "dedup by message id"
P="$(newbox dedup)"
{
  noise
  # One response, appended three times as it streamed: identical usage each time.
  rec msg_A 2026-03-02T10:00:00.000Z claude-opus-5 high 1000000 0 0 0 1000000
  rec msg_A 2026-03-02T10:00:01.000Z claude-opus-5 high 1000000 0 0 0 1000000
  rec msg_A 2026-03-02T10:00:02.000Z claude-opus-5 high 1000000 0 0 0 1000000
  rec msg_B 2026-03-02T10:05:00.000Z claude-opus-5 high 1000000 0 0 0 1000000
} > "$P/s-dedup.jsonl"
run_json "$BOX/dedup" > "$BOX/dedup.json"
is "two distinct ids, not four records" "$(field "$BOX/dedup.json" 'd["weeks"]["2026-W10"]["requests"]')" "2"
is "duplicates are reported, not hidden" "$(field "$BOX/dedup.json" 'd["stats"]["duplicates"]')" "2"
is "cost counts each message once" "$(field "$BOX/dedup.json" 'round(d["weeks"]["2026-W10"]["cost"]["total"],2)')" "60.0"

# --- 2. the cost split ------------------------------------------------------
echo "cost split across input / cache read / cache write / output"
P="$(newbox split)"
# 1M of each class on claude-opus-5: $5 input, $0.50 read, $6.25 write (5m),
# $10 write (1h), $25 output — the multipliers the price table spells out.
{ rec msg_C 2026-03-02T10:00:00.000Z claude-opus-5 xhigh 1000000 1000000 1000000 1000000 1000000; } > "$P/s-split.jsonl"
run_json "$BOX/split" > "$BOX/split.json"
W='d["weeks"]["2026-W10"]["cost"]'
is "input priced at list"        "$(field "$BOX/split.json" "round($W[\"input\"],4)")"       "5.0"
is "cache read is 0.1x input"    "$(field "$BOX/split.json" "round($W[\"cache_read\"],4)")"  "0.5"
is "cache write is 1.25x + 2x"   "$(field "$BOX/split.json" "round($W[\"cache_write\"],4)")" "16.25"
is "output priced at list"       "$(field "$BOX/split.json" "round($W[\"output\"],4)")"      "25.0"
is "total is the sum of the four" "$(field "$BOX/split.json" "round($W[\"total\"],4)")"      "46.75"
is "context band follows the 3M context" \
   "$(field "$BOX/split.json" 'd["weeks"]["2026-W10"]["bands"][">400k"]["requests"]')" "1"

# --- 3. main thread versus subagents, by agent type -------------------------
echo "main thread versus subagents"
P="$(newbox attrib)"
mkdir -p "$P/s-attrib/subagents/workflows/wf_1"
{ rec msg_M 2026-03-02T10:00:00.000Z claude-opus-5 high 0 0 0 0 1000000; } > "$P/s-attrib.jsonl"
# Named by the record itself.
{ rec msg_S1 2026-03-02T10:01:00.000Z claude-opus-5 high 0 0 0 0 1000000 reviewer; } \
  > "$P/s-attrib/subagents/agent-a1.jsonl"
# Older shape: no attributionAgent on the record, only the sibling meta file.
{ rec msg_S2 2026-03-02T10:02:00.000Z claude-opus-5 high 0 0 0 0 2000000; } \
  > "$P/s-attrib/subagents/workflows/wf_1/agent-a2.jsonl"
printf '{"agentType":"workflow-subagent","description":"verify:git"}\n' \
  > "$P/s-attrib/subagents/workflows/wf_1/agent-a2.meta.json"
run_json "$BOX/attrib" > "$BOX/attrib.json"
W='d["weeks"]["2026-W10"]'
is "main thread keeps only its own request" \
   "$(field "$BOX/attrib.json" "$W[\"main\"][\"requests\"]")" "1"
is "main-thread cost excludes the agents" \
   "$(field "$BOX/attrib.json" "round($W[\"main\"][\"cost\"][\"total\"],2)")" "25.0"
is "the agent names itself" \
   "$(field "$BOX/attrib.json" "round($W[\"agents\"][\"reviewer\"][\"cost\"][\"total\"],2)")" "25.0"
is "the meta file names the one that does not" \
   "$(field "$BOX/attrib.json" "round($W[\"agents\"][\"workflow-subagent\"][\"cost\"][\"total\"],2)")" "50.0"
is "subagent requests stay out of the context histogram" \
   "$(field "$BOX/attrib.json" "sum(b[\"requests\"] for b in $W[\"bands\"].values())")" "1"

# --- 4. the re-prime detector ----------------------------------------------
echo "re-primes"
P="$(newbox reprime)"
{
  rec msg_R1 2026-03-02T08:00:00.000Z claude-opus-5 high 0 200000 0 0 1000
  # 15 minutes later, a big write: the cache was still warm, this is ordinary
  # growth, not a reload.
  rec msg_R2 2026-03-02T08:15:00.000Z claude-opus-5 high 0 50000 200000 0 1000
  # Three hours later, the whole context rewritten: the cache had expired.
  rec msg_R3 2026-03-02T11:15:00.000Z claude-opus-5 high 0 10000 300000 0 1000
  # Long gap but a small write — a resumed session that hit a live 1-hour cache.
  rec msg_R4 2026-03-02T16:00:00.000Z claude-opus-5 high 0 300000 10000 0 1000
} > "$P/s-reprime.jsonl"
run_json "$BOX/reprime" > "$BOX/reprime.json"
R='d["weeks"]["2026-W10"]["reprimes"]'
is "only the expired-cache reload is flagged" "$(field "$BOX/reprime.json" "$R[\"requests\"]")" "1"
is "and it is named" "$(field "$BOX/reprime.json" "$R[\"where\"][0][\"session\"]")" "s-reprime"
is "with what it rewrote" "$(field "$BOX/reprime.json" "$R[\"where\"][0][\"cache_write_tokens\"]")" "300000"

# --- 5. ISO week bucketing --------------------------------------------------
echo "week bucketing"
P="$(newbox weeks)"
{
  # 2026-01-03 is a Saturday and belongs to 2026-W01; 2026-01-05 is the Monday
  # that opens 2026-W02. A calendar-month split would put both in January.
  rec msg_W1 2026-01-03T23:00:00.000Z claude-opus-5 high 0 0 0 0 1000000
  rec msg_W2 2026-01-05T01:00:00.000Z claude-opus-5 high 0 0 0 0 2000000
} > "$P/s-weeks.jsonl"
run_json "$BOX/weeks" > "$BOX/weeks.json"
is "two weeks, not one month" "$(field "$BOX/weeks.json" 'len(d["weeks"])')" "2"
is "the Saturday closes W01" \
   "$(field "$BOX/weeks.json" 'round(d["weeks"]["2026-W01"]["cost"]["total"],2)')" "25.0"
is "the Monday opens W02" \
   "$(field "$BOX/weeks.json" 'round(d["weeks"]["2026-W02"]["cost"]["total"],2)')" "50.0"
is "weeks are emitted in order" \
   "$(field "$BOX/weeks.json" 'list(d["weeks"])')" "['2026-W01', '2026-W02']"

# --- 6. an unknown model id -------------------------------------------------
echo "unknown model id"
P="$(newbox unknown)"
{
  rec msg_U1 2026-03-02T10:00:00.000Z claude-opus-5 high 0 0 0 0 1000000
  rec msg_U2 2026-03-02T10:01:00.000Z claude-someday-9 high 500000 0 0 0 1000000
  # A dated snapshot and a context marker are the same billing model.
  rec msg_U3 2026-03-02T10:02:00.000Z claude-haiku-4-5-20251001 low 0 0 0 0 1000000
  rec msg_U4 2026-03-02T10:03:00.000Z 'claude-opus-5[1m]' high 0 0 0 0 1000000
} > "$P/s-unknown.jsonl"
run_json "$BOX/unknown" > "$BOX/unknown.json"
is "the unknown model is named" \
   "$(field "$BOX/unknown.json" 'list(d["unknown_models"])')" "['claude-someday-9']"
is "its tokens are still counted" \
   "$(field "$BOX/unknown.json" 'd["unknown_models"]["claude-someday-9"]["tokens"]')" "1500000"
is "it is priced at zero, not guessed" \
   "$(field "$BOX/unknown.json" 'round(sum(p["cost"]["total"] for p in d["weeks"]["2026-W10"]["pairs"] if p["model"]=="claude-someday-9"),4)')" "0.0"
is "a dated snapshot resolves to its base price" \
   "$(field "$BOX/unknown.json" 'round(sum(p["cost"]["total"] for p in d["weeks"]["2026-W10"]["pairs"] if p["model"]=="claude-haiku-4-5"),2)')" "5.0"
is "a context marker resolves too" \
   "$(field "$BOX/unknown.json" 'sum(p["requests"] for p in d["weeks"]["2026-W10"]["pairs"] if p["model"]=="claude-opus-5")')" "2"
TEXT="$(python3 "$REPORT" --projects "$BOX/unknown" 2>&1)"
has "the text report says so loudly" "$TEXT" "UNKNOWN MODEL IDS"
has "and warns the totals are understated" "$TEXT" "UNDERSTATEMENT"

# --- 7. a transcript still being written ------------------------------------
echo "truncated and malformed lines"
P="$(newbox truncated)"
{
  rec msg_T1 2026-03-02T10:00:00.000Z claude-opus-5 high 0 0 0 0 1000000
  printf 'not json at all\n'
  printf '[1,2,3]\n'
  rec msg_T2 2026-03-02T10:01:00.000Z claude-opus-5 high 0 0 0 0 1000000
  # The last line of a live transcript: written up to the moment we read it.
  printf '{"type":"assistant","timestamp":"2026-03-02T10:02:00.000Z","message":{"id":"msg_T3","mod'
} > "$P/s-truncated.jsonl"
OUT="$(python3 "$REPORT" --projects "$BOX/truncated" 2>&1)"
STATUS=$?
is "no traceback, exit 0" "$STATUS" "0"
has "and no traceback in the output" "$OUT" "2026-W10"
case "$OUT" in *Traceback*) ko "output is clean" "a traceback reached stdout";; *) ok "output is clean";; esac
run_json "$BOX/truncated" > "$BOX/truncated.json"
is "the readable records are kept" \
   "$(field "$BOX/truncated.json" 'd["weeks"]["2026-W10"]["requests"]')" "2"

# --- 8. the filters ---------------------------------------------------------
echo "filters"
P="$(newbox filters)"
{
  rec msg_F1 2026-03-02T10:00:00.000Z claude-opus-5 high 0 0 0 0 1000000
  rec msg_F2 2026-03-09T10:00:00.000Z claude-opus-5 high 0 0 0 0 1000000
} > "$P/s-filters.jsonl"
OTHER="$BOX/filters/-home-user-other"; mkdir -p "$OTHER"
{ rec msg_F3 2026-03-02T11:00:00.000Z claude-opus-5 high 0 0 0 0 1000000; } > "$OTHER/s-other.jsonl"
run_json "$BOX/filters" --since 2026-03-09 > "$BOX/f1.json"
is "--since drops earlier weeks" "$(field "$BOX/f1.json" 'list(d["weeks"])')" "['2026-W11']"
run_json "$BOX/filters" --until 2026-03-02 > "$BOX/f2.json"
is "--until includes its own day" "$(field "$BOX/f2.json" 'list(d["weeks"])')" "['2026-W10']"
run_json "$BOX/filters" --project proj > "$BOX/f3.json"
is "--project keeps one project" "$(field "$BOX/f3.json" 'd["stats"]["files"]')" "1"

# --- 9. an empty tree -------------------------------------------------------
echo "nothing to report"
mkdir -p "$BOX/empty"
OUT="$(python3 "$REPORT" --projects "$BOX/empty" 2>&1)"; STATUS=$?
is "an empty root is not an error" "$STATUS" "0"
has "and says so" "$OUT" "no priced requests in range"
OUT="$(python3 "$REPORT" --projects "$BOX/does-not-exist" 2>&1)"; STATUS=$?
is "a missing root is not an error either" "$STATUS" "0"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
