# /hunt --teardown — remove what the hunt created

```text
/hunt --teardown <slug> [--force]
```

Teardown removes the hunt's machinery and gives back what preflight took. It
keeps the ledger: the trail outlives the hunt.

## Refusals

| Condition | Action |
|-----------|--------|
| `state` is `awaiting-merge` | refuse — the after-merge step still needs the branches and the state; `--force` overrides, and the report says what was left unverified |
| the owner process is alive in another session | refuse |
| `hunt/<slug>` neither pushed nor bundled | refuse — it would be the only copy |

## Steps

1. Show what will be removed, wait for a yes.
2. Stop Monitor on this slug; disable and remove the watchdog timer when no
   other hunt is active.
3. Worktrees: every `~/Projects/.worktrees/<repo>-hunt-<slug>*`, through
   `hunt-git <slug> <repo> worktree-remove <name>`.
4. Local branches — **only** these: `hunt-fix/<slug>/*`, `hunt-w/<slug>/*`,
   and `hunt/<slug>` once pushed or bundled. Nothing else, ever.
5. Images tagged `*:hunt-<slug>-*`.
6. Queue records of this slug in `~/.cache/hunt/queue/`.
7. Labels `hunt:*` removed from the issues that stayed open
   (`hunt-forge … issue-label`); closed issues keep theirs as history.
8. Remove the `Bash(git push:*)` deny rule from the project's
   `.claude/settings.local.json` — that rule only, every other key kept.
9. Restart what preflight stopped (clusters, containers), as recorded.
10. Append `teardown` with what was removed, then
    `hunt-ledger owner <slug> --release`.

`ledger.jsonl`, `scope.json`, `status.json` and `tip.bundle` stay in
`~/.local/state/hunt/<slug>/`; deleting them is the user's call.
