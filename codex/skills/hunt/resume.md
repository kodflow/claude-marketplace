# /hunt --resume — rebuild everything from the ledger

The resume path is also the path of every pass boundary: root relaunches each
role with a context rebuilt from the ledger, never from its own memory. If
this module works, a `/clear` in the middle of a hunt costs a few minutes.

```text
/hunt --resume <slug>
```

---

## 1. Ownership

- `hunt-ledger init <slug>` takes over the slug in `active.json` with this
  session's process identity (the nearest `claude` ancestor); it refuses
  (exit 1) while the recorded owner process is still alive and is not this
  session (same pid, start time and boot). Two sessions never drive one hunt.
  It keeps `created` and the state, and rebuilds `status.json`.
- Preflight runs again (`SKILL.md` phase 0) — the machine may have changed
  since; the budget is recomputed and recorded.
- `hunt-ledger rebuild <slug>` — `status.json` rebuilt from the whole ledger,
  rewritten in the current format if the format changed.

## 2. Repositories back to a known state

Per `owned` repository, in the integration worktree and every hunt worktree:

1. abort any rebase, cherry-pick or merge in progress —
   `hunt-git <slug> <repo> abort integ` for the integration worktree,
   `abort <name>` for the others;
2. reset `hunt/<slug>` to the SHA of the last `tip-after`
   (`hunt-git <slug> <repo> reset-tip <sha>`, refused unless that SHA is an
   ancestor of the tip); a `tip-before` with no `tip-after` is an integration
   that never happened;
3. if the branch is missing, `hunt-git <slug> <repo> bundle-restore`
   recreates it at the head of the verified bundle (`tip.bundle`, or
   `tip-<repo>.bundle` when the scope has several repositories), then
   `hunt-git <slug> <repo> integ-init <base>` re-attaches the integration
   worktree. If it exists but does not match, `bundle-restore` refuses to move
   it and only fetches the bundle's objects: `reset-tip <bundle sha>` when that
   SHA is an ancestor, otherwise the user decides.

## 3. Worktrees: resume or discard

Every `$HUNT_WORKTREES/<repo>-hunt-<slug>-*` (default
`~/Projects/.worktrees`, `<repo>` the basename of the scope's `path`) is
classified from the ledger:

| Worktree | Ledger says | Decision |
|----------|-------------|----------|
| `fix-<N>` | open `claim`, commits beyond the tip | **resume** — the fixer continues there |
| `fix-<N>` | issue integrated or released | discard |
| `ver-<seq>` | finding without `confirmed`/`rejected` | discard; launch a fresh verifier |
| `sha-<k>` | pass not ended | discard; the hunter replays the cells without a verdict |
| integration | — | keep |
| unknown | not in the ledger | report it, do not delete it |

Discard with `hunt-git <slug> <repo> worktree-remove <name>`.

## 4. Processes and queue

- Stop the hunt's leftover jobs: with the host's `lourd`, each job runs in a
  transient `run-*.scope` unit; the unit names no slug, so stop only those
  whose processes run in this hunt's worktrees (`systemctl --user status
  'run-*.scope'`). Queue records and job temporary directories of dead pids are purged by the
  next `hunt-queue` start; nothing to do by hand.
- Forge intents without their done: `hunt-forge … issue-find-nonce <nonce>`
  for each, then append the missing `forge-done` or allow the retry.

## 5. Follow

Re-arm Monitor on `hunt-status <slug> --watch` and re-install the watchdog
with `hunt-status --install-watchdog` — always on resume: the unit names the
script by its absolute path, which changes with every plugin update.

Append `resume` (`from_seq`: the seq the rebuild started from) **only when the
hunt may run again**: the event moves a `paused` hunt back to `hunting`. A
hunt whose pause reason still holds stays paused, with no `resume`.

## 6. Roles

From the ledger, for each role that was alive (`agent` without `agent-end`):

1. **by id first** — SendMessage to the recorded agent id with "resume from
   seq <n>: <its open work>";
2. no answer, or the id is unknown to this session → a **fresh** agent, never
   named, with a brief rebuilt from the ledger: its open claim or pass, the
   cells without a verdict, the failing witnesses, the decisions taken.

A role is relaunched only when idle in the ledger's eyes (no open claim, no
`tip-before` without `tip-after` after step 2).

## 7. States

| State at resume | Continue with |
|-----------------|---------------|
| `hunting` | dispatch per `roles.md` |
| `paused` | show the reason; resume only once it is resolved (`permission`: an allow rule added; `disk`: space freed; `cap`: counter ≤ threshold) |
| `frozen`, `final-pass` | `convergence.md` §1–2 — the frozen SHA must still be the tip, else back to hunting |
| `pushing` | `hunt-push <slug>` again — it is idempotent on what it already pushed and the MRs it already opened |
| `awaiting-merge` | check the MRs (`convergence.md` §4) |
| `done` | offer teardown |
