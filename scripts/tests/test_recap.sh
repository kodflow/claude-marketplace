#!/bin/bash
# ============================================================================
# test_recap.sh - recap.sh against fixture sessions
# ============================================================================
# /recap prints what this script reads, so a wrong read is a wrong table the
# user trusts at a glance. Each case plants a session directory and checks
# the field the table is built from: who acts, what is blocked, which epics
# are open, which subagents run and on which branch, and whether `seen`
# tells an unchanged table from a changed one.
# ============================================================================

set -u

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/plugins/kodflow-workflow/skills/recap/scripts/recap.sh"
pass=0; fail=0

check() { # name expected actual
    if [ "$2" = "$3" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        printf 'FAIL %s\n  expected: %s\n  actual:   %s\n' "$1" "$2" "$3"
    fi
}

cfg="$(mktemp -d)"
trap 'rm -rf "$cfg"' EXIT
s="$cfg/kodflow/sessions/sess-1"
mkdir -p "$s"

# A worktree on a GitHub remote, for the branch lookup.
wt="$cfg/wt"
git init -q -b feat/x "$wt"
git -C "$wt" remote add origin "git@github.com:acme/widgets.git"

cat > "$s/tasks.json" <<'JSON'
{"version":2,"next_id":9,"next_epic":4,"active":{"main":2},
 "epics":[{"id":1,"agent":"main","title":"Done epic","touched":10},
          {"id":2,"agent":"main","title":"Active","touched":30},
          {"id":3,"agent":"main","title":"Other","touched":20},
          {"id":9,"agent":"sub-a","title":"Not mine","touched":99}],
 "tasks":[{"id":"1","agent":"main","epic":1,"subject":"old","status":"completed"},
          {"id":"2","agent":"main","epic":2,"subject":"go needed","status":"waiting","assignee":"human"},
          {"id":"3","agent":"main","epic":2,"subject":"live","status":"in_progress","worker":"impl","worker_id":"a-impl-1",
           "description":"see https://github.com/acme/widgets/pull/57 and acme/other#3"},
          {"id":"4","agent":"main","epic":3,"subject":"orphan","status":"in_progress","worker":"gone","worker_id":"a-gone-1"},
          {"id":"5","agent":"main","epic":2,"subject":"next","status":"pending","blockedBy":["3"]},
          {"id":"6","agent":"main","epic":2,"subject":"free","status":"pending","blockedBy":["1"]},
          {"id":"7","agent":"main","epic":2,"subject":"dropped","status":"deleted"},
          {"id":"8","agent":"sub-a","epic":9,"subject":"theirs","status":"in_progress"}]}
JSON
cat > "$s/agents.json" <<'JSON'
{"agents":{"a-impl-1":{"type":"impl","started":100,"stopped":null,"epic":2},
           "a-gone-1":{"type":"gone","started":100,"stopped":200,"epic":3},
           "a-idle-1":{"type":"idle","started":100,"stopped":null,"epic":3}}}
JSON
printf '{"agents":{"a-impl-1":{"paths":["%s"]}}}\n' "$wt" > "$s/worktrees.json"

out="$(CLAUDE_CONFIG_DIR="$cfg" bash "$SRC" state sess-1)"
q() { printf '%s' "$out" | jq -r "$1"; }

check "state names the session"            "sess-1"              "$(q .session)"
check "open epics, latest touched first"   "2 3"                 "$(q '[.epics[].id] | join(" ")')"
check "the active epic is marked"          "true"                "$(q '.epics[0].active')"
check "done/total ignores deleted tasks"   "0/4"                 "$(q '.epics[0] | "\(.done)/\(.total)"')"
check "open main tasks only"               "2 3 4 5 6"           "$(q '[.tasks[].id] | join(" ")')"
check "a human task waits on the user"     "user"                "$(q '.tasks[] | select(.id=="2") | .who')"
check "a running worker is alive"          "true"                "$(q '.tasks[] | select(.id=="3") | .worker_alive')"
check "a stopped worker blocks its task"   "true"                "$(q '.tasks[] | select(.id=="4") | .blocked')"
check "an open blocker blocks"             "3"                   "$(q '.tasks[] | select(.id=="5") | .waits_on | join(" ")')"
check "a completed blocker does not"       "false"               "$(q '.tasks[] | select(.id=="6") | .blocked')"
check "PRs named in a description"         "acme/other#3 acme/widgets#57" \
      "$(q '[.tasks[] | select(.id=="3") | .prs[] | "\(.repo)#\(.number)"] | join(" ")')"
check "running subagents only"             "a-idle-1 a-impl-1"   "$(q '[.agents[].id] | sort | join(" ")')"
check "a subagent's task"                  "3"                   "$(q '.agents[] | select(.id=="a-impl-1") | .task')"
check "a subagent without a task"          "null"                "$(q '.agents[] | select(.id=="a-idle-1") | .task')"
check "worktree branch and GitHub repo"    "feat/x acme/widgets" \
      "$(q '.agents[] | select(.id=="a-impl-1") | .worktrees[0] | "\(.branch) \(.repo)"')"

# No session id, or one the engine did not substitute: the newest task list.
check "literal \${CLAUDE_SESSION_ID} falls back" "sess-1" \
      "$(CLAUDE_CONFIG_DIR="$cfg" bash "$SRC" state '${CLAUDE_SESSION_ID}' | jq -r .session)"

# No files at all: an empty answer, not a failure.
empty="$(mktemp -d)"
check "no session: source none"            "none" \
      "$(CLAUDE_CONFIG_DIR="$empty" bash "$SRC" state | jq -r .source)"
rm -rf "$empty"

check "a session with no task file: source none" "none" \
      "$(CLAUDE_CONFIG_DIR="$cfg" bash "$SRC" state sess-unknown | jq -r .source)"

# A malformed task file reads as empty.
mkdir -p "$cfg/kodflow/sessions/bad"; echo 'not json' > "$cfg/kodflow/sessions/bad/tasks.json"
check "malformed tasks.json reads as empty" "0" \
      "$(CLAUDE_CONFIG_DIR="$cfg" bash "$SRC" state bad | jq '.tasks | length')"

# seen: first call new, same table same, changed table new, stdin too.
t1='| Qui | Tâche |
| toi | #2 go |'
check "seen: first table is new"     "new"  "$(CLAUDE_CONFIG_DIR="$cfg" bash "$SRC" seen sess-1 "$t1")"
check "seen: same table is same"     "same" "$(CLAUDE_CONFIG_DIR="$cfg" bash "$SRC" seen sess-1 "$t1")"
check "seen: same table on stdin"    "same" "$(printf '%s\n' "$t1" | CLAUDE_CONFIG_DIR="$cfg" bash "$SRC" seen sess-1)"
check "seen: a changed cell is new"  "new"  "$(CLAUDE_CONFIG_DIR="$cfg" bash "$SRC" seen sess-1 "$t1 vert")"

CLAUDE_CONFIG_DIR="$cfg" bash "$SRC" bogus >/dev/null 2>&1
check "unknown command exits 2"      "2"    "$?"

printf 'recap.sh: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
