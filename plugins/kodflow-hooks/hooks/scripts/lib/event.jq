# event.jq — the one sanitization policy for everything the hooks persist.
#
# Every script appends to .claude/logs/<branch>/session.jsonl through this
# program, so a field is either allow-listed here or it is not written. Tool
# responses are never stored whole: a Read result is the file's content, and a
# log that copies it becomes a second, unreviewed copy of every secret the
# session touched. Strings are clipped, then redacted.
#
# Usage: jq -c --arg b "$BRANCH" -f event.jq  <  hook-input.json

def redact:
  if type == "string" then
      gsub("(?<k>(token|api[_-]?key|pass" + "word|secret|authorization)\\s*[:=]\\s*(Bearer\\s+)?)[^\\s\"']+"; "\(.k)<redacted>"; "i")
    | gsub("(gh[pousr]_|github_pat_|sk-|AK" + "IA)[A-Za-z0-9_-]{8,}"; "<redacted>")
    | gsub("Bearer [A-Za-z0-9._-]+"; "Bearer <redacted>")
  else . end;

def clip($n): if type == "string" and length > $n then .[:$n] + "…(truncated)" else . end;

# Keep only the short scalar fields of an object.
def small: with_entries(select((.value | type) != "string" or (.value | length) < 200));

def input_of($t; $i):
  if $t == "Bash" then
      {command: ($i.command | clip(500) | redact), description: $i.description, run_in_background: $i.run_in_background}
  elif ($t | test("^(Write|Edit|MultiEdit|NotebookEdit)$")) then
      {file_path: $i.file_path, content_len: (($i.content // "") | length),
       old_len: (($i.old_string // "") | length), new_len: (($i.new_string // "") | length)}
  elif $t == "Read" then {file_path: $i.file_path, offset: $i.offset, limit: $i.limit}
  elif ($t | test("^(Glob|Grep)$")) then {pattern: $i.pattern, path: $i.path}
  elif ($t | test("^(Task|Agent)$")) then {description: $i.description, subagent_type: $i.subagent_type}
  else ($i | del(.content, .new_string, .old_string, .prompt) | small)
  end;

def response_of($t; $r):
  if ($r | type) != "object" then {summary: ($r | tostring | clip(300) | redact)}
  elif $t == "Bash" then
      {return_code: $r.return_code,
       stdout: (($r.stdout // $r.output // "") | clip(2000) | redact),
       stderr: (($r.stderr // "") | clip(1000) | redact),
       interrupted: $r.interrupted}
  else ($r | del(.content, .file, .text, .output, .result) | small
           | map_values(if type == "string" then (clip(200) | redact) else . end))
  end;

{ timestamp: (now | todate),
  hook_event_name: .hook_event_name,
  session_id: .session_id,
  branch: $b,
  cwd: .cwd,
  permission_mode: .permission_mode,
  agent_type: .agent_type,
  agent_id: .agent_id,
  tool_use_id: .tool_use_id,
  tool_name: .tool_name,
  # Set by on-tool.sh on the two events that measure the reviewer gate:
  # "deny" when the main thread was stopped, "dispatch" when it delegated.
  # Read from the environment so the other scripts need no new argument.
  root_guard: (($ENV.KODFLOW_ROOT_GUARD // "") | if . == "" then null else . end) }
+ (if .tool_name then
     {tool_input: input_of(.tool_name; (.tool_input // {})),
      tool_response: (if .tool_response then response_of(.tool_name; .tool_response) else null end)}
   else {} end)
+ (if .error then {error: (.error | clip(500) | redact), error_code: .error_code} else {} end)
+ { source: .source, reason: .reason, trigger: .trigger, file_path: .file_path,
    prompt_len: (if .prompt then (.prompt | length) else null end),
    task_id: .task_id, task_subject: .task_subject, teammate_name: .teammate_name, team_name: .team_name,
    notification_type: .notification_type,
    last_msg_len: (if .last_assistant_message then (.last_assistant_message | length) else null end),
    stop_hook_active: .stop_hook_active }
| with_entries(select(.value != null))
