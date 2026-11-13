# epics.jq — read side of tasks.json for the hooks (the mod's task tools write it).
# Loaded with `jq -L "$LIB" 'include "epics"; ...'`. Every definition
# tolerates a file of any shape: a v1 file (one epic per agent, a dict) is
# read as v2, a malformed field as empty, so a hook never fails on it. A
# task may carry `assignee: "human"` (task_assign_human): it is a waiting
# task like any other here.

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

# An epic closed by task_focus(close=true): closed_at a finite number above
# 0 (1e999, 0, -1, a string, true, null are open). The mod (tasks.ts
# `closed`) and kodflow-hud hold the same test against the same fixture
# (tests/fixtures/epic-predicates.json). Applied to an epic object.
def closed:
  (if type == "object" then .closed_at else null end) as $c
  | ($c | type) == "number" and ($c | isinfinite | not) and $c > 0;

# The agent ids taken as live from agents.json's `agents` object: not
# stopped and started within 12 h, as the Stop hook counts them.
def live_ids($ag; $now):
  [($ag | if type == "object" then to_entries[] else empty end)
   | select((.value | type) == "object" and .value.stopped == null
            and ((.value.started // 0) | type) == "number" and (.value.started // 0) >= $now - 43200)
   | .key];

# An epic left 24 h without a touch or a task update, with no task in
# progress on a live worker and none of the user's waiting in it. Applied to
# an epic object; $tasks is the file's task list, $live a list of agent ids.
def idle($tasks; $now; $live):
  . as $e
  | [$tasks[] | objects | select((.agent // "main") == ($e.agent // "main") and (.epic // 0) == $e.id)] as $t
  | ([$e.touched, ($t[] | .updated)] | map(select(type == "number" and (isinfinite | not))) | max // 0) as $last
  | ($now - $last > 86400)
    and (any($t[]; .status == "in_progress" and ((.worker_id // "") as $w | any($live[]; . == $w))) | not)
    and (any($t[]; .status == "waiting" and .assignee == "human") | not);

# The agent's active epic id, 0 when it has none, it points nowhere or it is closed.
def active($agent):
  (.active[$agent] // 0) as $a
  | if any(.epics[]; .id == $a and (.agent // "main") == $agent and (closed | not)) then $a else 0 end;

# The ids of the closed epics, any agent.
def closed_ids: [.epics[] | select(closed) | .id];

# The tasks the turn-end rules look at: the agent's active epic, or the tasks
# with no epic when no epic is active.
def active_tasks($agent):
  active($agent) as $e
  | .tasks[] | select((.agent // "main") == $agent and (.epic // 0) == $e);

# The agent's open epics (closed ones left out) with their progress:
# {id, title, touched, done, total, current}.
def epic_rows($agent):
  [.tasks[] | select((.agent // "main") == $agent)] as $mine
  | .epics[] | select((.agent // "main") == $agent and (closed | not))
  | .id as $id | [$mine[] | select((.epic // 0) == $id)] as $t
  | {id, title: (.title // ""), touched: (.touched // 0),
     done: ([$t[] | select(.status == "completed")] | length), total: ($t | length),
     current: (first($t[] | select(.status == "in_progress")) // null)};
