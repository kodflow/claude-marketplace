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
2. Stop Monitor on this slug; `hunt-status --remove-watchdog` when no other
   hunt is active.
3. Worktrees: every `$HUNT_WORKTREES/<repo>-hunt-<slug>-<name>` through
   `hunt-git <slug> <repo> worktree-remove <name>`, the integration worktree
   last with `worktree-remove integ`.
4. Local branches, through `hunt-git <slug> <repo> branch-delete <branch>` —
   which refuses anything but these: `hunt-fix/<slug>/*`, `hunt-w/<slug>/*`,
   and `hunt/<slug>` — the latter only when its tip is on
   `<remote>/hunt/<slug>` or is the head of the verified bundle (checked by the
   script). Nothing else, ever.
5. Images tagged `*:hunt-<slug>-*`.
6. Queue records of this slug in `~/.cache/hunt/queue/`.
7. Labels `hunt:*` removed from the issues that stayed open
   (`hunt-forge … issue-label`); closed issues keep theirs as history.
8. Remove the deny rules the hunt added (`Bash(git push:*)`, `Bash(git -C:*)`,
   `Bash(git -c:*)`) from the project's `.claude/settings.local.json` — those
   only, every other key kept.
9. Restart what preflight stopped (clusters, containers), as recorded.
10. Append `teardown` with what was removed (`state` → `done`), then
    `hunt-ledger owner <slug> --release` — the hunt leaves `active.json`.

`ledger.jsonl`, `scope.json`, `status.json` and `tip.bundle` stay in
`~/.local/state/hunt/<slug>/`; deleting them is the user's call.
