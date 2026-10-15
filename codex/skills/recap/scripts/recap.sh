#!/bin/bash
# ============================================================================
# recap.sh - The session's work, as one JSON document, for /recap
# Usage: recap.sh state [<session-id>]
#        recap.sh seen  <session-id> [<rendered table>]   (else stdin)
# Exit 0 = answered · 2 = usage · 3 = jq missing
# ============================================================================
# /recap draws a table the user reads in ten seconds. The model must not
# reconstruct it from memory of the conversation: the task list and the
# subagents live in files kodflow-hooks writes, and this script reads them.
#
#   state  open epics and their open tasks (main agent only, the ones the
#          status line shows), who has to act on each, the running
#          subagents, and the branch and GitHub repository of each one's
#          worktree, so the skill can look up its PR and CI.
#   seen   reads the rendered table (third argument, else stdin) and
#          prints `new` or `same` against the previous call for this
#          session, then remembers it. A loop iteration with nothing new
#          prints one line, not the table.
#
# Files, under <config>/kodflow/sessions/<session>/ (<config> being
# CLAUDE_CONFIG_DIR or ~/.claude), all optional:
#   tasks.json      the kodflow-hooks task list, version 2 (v1 tolerated)
#   agents.json     subagents: {agents: {<id>: {type, started, stopped, epic}}}
#   worktrees.json  {agents: {<id>: {paths: [...]}}}
#   recap-last      written here: the fingerprint `seen` compares against
#
# Read-only on every file but recap-last. Bash 3.2 (macOS /bin/bash) safe.
# ============================================================================

set -u

command -v jq >/dev/null 2>&1 || { echo '{"error":"jq not found"}'; exit 3; }

cmd="${1:-}"
sid="${2:-}"
table="${3:-}"
base="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/kodflow/sessions"

# An unsubstituted ${CLAUDE_SESSION_ID} (an older engine, a copy pasted by
# hand) arrives literally. Fall back on the session whose task list moved
# last: on a single-session machine it is this one, and `state` names it so
# the reader can tell.
case "$sid" in
    ''|*'$'*|*'{'*|*/*) sid="" ;;
esac
if [ -z "$sid" ] && [ -d "$base" ]; then
    newest="$(ls -t "$base"/*/tasks.json 2>/dev/null | head -1)"
    [ -n "$newest" ] && sid="$(basename "$(dirname "$newest")")"
fi
dir="$base/$sid"

json_or_empty() { # file -> its JSON, or {} when absent or malformed
    if [ -f "$1" ] && jq -e . "$1" >/dev/null 2>&1; then cat "$1"; else echo '{}'; fi
}

# owner/repo of a worktree's GitHub remote, empty for any other forge.
github_repo() {
    url="$(git -C "$1" remote get-url origin 2>/dev/null)" || return 0
    case "$url" in
        *github.com[:/]*) url="${url#*github.com}"; url="${url#[:/]}"; echo "${url%.git}" ;;
    esac
}

state() {
    now="$(date +%s)"
    # Branch and repository of every running subagent's worktree: one TSV
    # line per path, joined into the JSON below.
    wt_tsv=""
    worktrees="$(json_or_empty "$dir/worktrees.json")"
    while IFS="$(printf '\t')" read -r agent path; do
        [ -n "$agent" ] && [ -d "$path" ] || continue
        branch="$(git -C "$path" branch --show-current 2>/dev/null)"
        repo="$(github_repo "$path")"
        wt_tsv="${wt_tsv}${agent}	${path}	${branch}	${repo}
"
    done <<EOF
$(printf '%s' "$worktrees" | jq -r '(.agents // {}) | to_entries[]
    | select(.value | type == "object") | .key as $a
    | (.value.paths // [])[] | select(type == "string") | "\($a)\t\(.)"' 2>/dev/null)
EOF

    jq -n \
        --arg sid "$sid" --argjson now "$now" --arg wt "$wt_tsv" \
        --arg src "$([ -f "$dir/tasks.json" ] && echo files || echo none)" \
        --argjson t "$(json_or_empty "$dir/tasks.json")" \
        --argjson a "$(json_or_empty "$dir/agents.json")" '
    def obj: if type == "object" then . else {} end;
    def arr: if type == "array" then . else [] end;
    # GitHub PRs a description names by URL or owner/repo#N.
    def prs: [ (. // "") | tostring
               | (scan("github\\.com/([\\w.-]+/[\\w.-]+)/pull/([0-9]+)"),
                  scan("(?<![\\w/])([\\w.-]+/[\\w.-]+)#([0-9]+)"))
               | {repo: .[0], number: (.[1] | tonumber)} ] | unique;

    ($t | obj) as $t
    # v1 kept one epic per agent in a dict; only the main agent matters here.
    | ($t.epics | if type == "object"
                  then [to_entries[] | (.value | obj) + {agent: .key}]
                  else arr end
       | map(obj | select((.agent // "main") == "main" and (.id | type) == "number"))) as $epics
    | (($t.active | obj).main // ($t.epics | obj).main.id? // 0) as $active
    | ($t.tasks | arr | map(obj | select((.agent // "main") == "main"))) as $tasks
    | ($a | obj | .agents | obj | to_entries
       | map(select((.value | obj).stopped == null)
             | {id: .key, type: (.value.type // "?"), epic: (.value.epic // 0),
                since_min: ((($now - (.value.started // $now)) / 60) | floor)})) as $running
    | ($wt | split("\n") | map(select(length > 0) | split("\t")
       | {agent: .[0], path: .[1], branch: .[2], repo: .[3]})) as $wts
    | def alive($w; $wid): any($running[]; .id == $wid or .type == $w or .id == $w);
      def done_ids: [$tasks[] | select(.status == "completed") | .id | tostring];
      done_ids as $done
    | {
        session: $sid,
        source: $src,
        epics: [ $epics[] | .id as $id
                 | [$tasks[] | select((.epic // 0) == $id and .status != "deleted")] as $et
                 | select(any($et[]; .status != "completed") or ($id == $active and ($et | length) == 0))
                 | {id, title: (.title // ""), active: ($id == $active),
                    done: ([$et[] | select(.status == "completed")] | length),
                    total: ($et | length), touched: (.touched // 0)} ]
               | sort_by(-.touched),
        tasks: [ $tasks[]
                 | select(.status != "completed" and .status != "deleted")
                 | (.worker // "") as $w | (.worker_id // "") as $wid
                 | ([(.blockedBy // [])[] | tostring] - $done) as $waits_on
                 | {id: (.id | tostring), epic: (.epic // 0), subject: (.subject // ""),
                    status, parent: (.parent // null), ref: (.ref // null),
                    worker: (if $w == "" then null else $w end),
                    worker_alive: (if $w == "" then null else alive($w; $wid) end),
                    waits_on: $waits_on,
                    prs: (.description | prs),
                    who: (if .assignee == "human" or .status == "waiting" then "user" else "agent" end),
                    blocked: (($w != "" and (alive($w; $wid) | not) and .status == "in_progress")
                              or ($waits_on | length) > 0) } ],
        agents: [ $running[] | .id as $id | .type as $ty
                  | . + {task: (first($tasks[] | select(.status == "in_progress"
                                   and ((.worker_id // "") == $id or (.worker // "") == $ty))
                                   | .id | tostring) // null),
                         worktrees: [$wts[] | select(.agent == $id) | del(.agent)]} ]
      }'
}

seen() {
    [ -n "$sid" ] || { echo new; return 0; }
    mkdir -p "$dir" 2>/dev/null
    if [ -n "$table" ]; then input() { printf '%s\n' "$table"; }; else input() { cat; }; fi
    if command -v shasum >/dev/null 2>&1; then sum="$(input | shasum -a 256 | cut -d' ' -f1)"
    else sum="$(input | sha256sum | cut -d' ' -f1)"; fi
    last="$(cat "$dir/recap-last" 2>/dev/null)"
    printf '%s\n' "$sum" > "$dir/recap-last" 2>/dev/null
    if [ "$sum" = "$last" ]; then echo same; else echo new; fi
}

case "$cmd" in
    state) state ;;
    seen)  seen ;;
    *) echo "usage: recap.sh state|seen [<session-id>]" >&2; exit 2 ;;
esac
