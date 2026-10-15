# feedback.jq — the agent feedback a subagent left in its last message.
#
# A subagent is asked (SubagentStart, rule 6) to end its answer with a
# "## Agent feedback" section, or an "agent_feedback" key when it answers in
# JSON, naming what in its own instructions was wrong, missing or ambiguous.
# SubagentStop carries that message whole as last_assistant_message, a
# SubagentHandback call as tool_input.message (tests/fixtures/agent-hooks.jsonl). The record is one line of
# <session>/agent-feedback.jsonl, redacted with event.jq's rules and kept
# under 1 KB: it names the agent, what it ran on and the feedback, nothing
# else of the conversation.
#
#   jq -c -L "$LIB" --arg model M --arg source S 'include "feedback"; record' < SubagentStop

def redact:
  if type == "string" then
      gsub("(?<k>[A-Za-z0-9_-]*(token|api[_-]?key|pass" + "word|secret|authorization)[A-Za-z0-9_-]*\\s*[:=]\\s*(Bearer\\s+)?)[^\\s\"']+"; "\(.k)<redacted>"; "i")
    | gsub("(gh[pousr]_|github_pat_|sk-|AK" + "IA)[A-Za-z0-9_-]{8,}"; "<redacted>")
    | gsub("Bearer [A-Za-z0-9._-]+"; "Bearer <redacted>")
  else . end;

def clip($n): if length > $n then .[:$n] + "…" else . end;

# The text of the feedback, or empty when there is none worth keeping
def feedback:
  (.last_assistant_message // .tool_input.message // "") as $m
  | ( ($m | capture("(?ms)^#{2,3}[ \\t]*Agent feedback[ \\t]*\\n(?<f>.*?)(?=^#{1,3}[ \\t]|\\z)").f? // empty),
      ($m | capture("\"agent_feedback\"\\s*:\\s*\"(?<f>(?:[^\"\\\\]|\\\\.)*)\"").f? // empty | (try ("\"" + . + "\"" | fromjson) catch .)),
      "" )
  | gsub("^\\s+|\\s+$"; "")
  | select(test("^(none|n/?a|nothing|-|—)?\\.?$"; "i") | not)
  | . ;

def record:
  (first(feedback) // "") as $f
  | if $f == "" then empty else
      { ts: (now | floor), sid: .session_id, agent_type: .agent_type, agent_id: .agent_id,
        model: (if $ARGS.named.model == "" then null else $ARGS.named.model end),
        effort: (.effort.level // null), source: $ARGS.named.source,
        definition: (if ($ARGS.named.def // "") == "" then null else $ARGS.named.def end),
        owner: ($ARGS.named.owner // "local"),
        feedback: ($f | redact | clip(700)) }
    end;
