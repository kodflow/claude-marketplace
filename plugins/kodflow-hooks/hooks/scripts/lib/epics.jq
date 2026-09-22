# epics.jq — read side of tasks.json for the hooks (the tasks MCP writes it).
# Loaded with `jq -L "$LIB" 'include "epics"; ...'`. Every definition
# tolerates a file of any shape: a v1 file (one epic per agent, a dict) is
# read as v2, a malformed field as empty, so a hook never fails on it.

# Any tasks.json → the v2 shape, in memory only.
def v2:
  (if type == "object" then . else {} end)
  | if (.epics | type) == "object" then
      .active = ((if (.active | type) == "object" then .active else {} end)
                 + (.epics | with_entries(.value = (.value.id? // 0))))
      | .epics = [.epics | to_entries[] | {id: (.value.id? // 0), agent: .key, title: (.value.title? // "")}]
    else . end
  | .epics = [(if (.epics | type) == "array" then .epics[] else empty end) | objects | select(.id | type == "number")]
  | .active = (if (.active | type) == "object" then .active else {} end)
  | .tasks = [(if (.tasks | type) == "array" then .tasks[] else empty end) | objects];

# The agent's active epic id, 0 when it has none (or it points nowhere).
def active($agent):
  (.active[$agent] // 0) as $a
  | if any(.epics[]; .id == $a and (.agent // "main") == $agent) then $a else 0 end;

# The tasks the turn-end rules look at: the agent's active epic, or the tasks
# with no epic when no epic is active.
def active_tasks($agent):
  active($agent) as $e
  | .tasks[] | select((.agent // "main") == $agent and (.epic // 0) == $e);

# The agent's epics with their progress: {id, title, touched, done, total, current}.
def epic_rows($agent):
  [.tasks[] | select((.agent // "main") == $agent)] as $mine
  | .epics[] | select((.agent // "main") == $agent)
  | .id as $id | [$mine[] | select((.epic // 0) == $id)] as $t
  | {id, title: (.title // ""), touched: (.touched // 0),
     done: ([$t[] | select(.status == "completed")] | length), total: ($t | length),
     current: (first($t[] | select(.status == "in_progress")) // null)};
