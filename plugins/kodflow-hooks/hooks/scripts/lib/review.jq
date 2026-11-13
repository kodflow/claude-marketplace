# review.jq — the main agent's open tasks, one line per epic, for the review
# SessionStart asks for, closed epics left out. Empty output when nothing is open.
include "epics";
v2
| . as $d
| closed_ids as $shut
| [.tasks[] | select((.agent // "main") == "main" and .status != "completed")
             | (.epic // 0) as $e | select(any($shut[]; . == $e) | not)] as $open
| if ($open | length) == 0 then empty else
    ([$d.epics[] | {key: (.id | tostring), value: (.title // "")}] | from_entries) as $titles
    | $open | group_by(.epic // 0)
    | map((.[0].epic // 0) as $e
        | "- " + (if $e == 0 then "no epic" else "epic #\($e) \($titles[$e | tostring] // "?")" end) + ": "
          + (map("#\(.id) [\(.status)] \(.subject)") | join("; ")))
    | join("\n")
  end
