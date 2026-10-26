# /hunt — the ledger, status.json and active.json

The ledger is the hunt. Everything root or a role knows after a `/clear`, a
crash or a reboot comes from it; anything not in it did not happen.

```
~/.local/state/hunt/                 always $HOME/.local/state/hunt — never XDG_STATE_HOME
├── active.json                      every hunt on this machine (HUD contract)
├── .active.lock
└── <slug>/
    ├── scope.json                   written by root, approved once
    ├── ledger.jsonl                 append-only, hunt-ledger only
    ├── ledger.lock
    ├── status.json                  bounded snapshot (≤16 KiB), folded on append
    ├── witness/<sha256>.json        complete witness commands, referenced by hash
    └── tip.bundle                   git bundle of hunt/<slug> after each integration
```

Never in a repository, never under `/tmp` (wiped when a session starts).

---

## Writer rules

| Rule | Why |
|------|-----|
| The only writer is `hunt-ledger append <slug> <kind> [json]` | flock on `ledger.lock`, one `write` ≤4096 bytes, fsync — appends from several agents never tear |
| Write/Edit on `ledger.jsonl` or `status.json` | **forbidden** |
| A line over 4096 bytes is refused (exit 1) | store the bulk in `witness/<sha256>.json` and append the hash |
| `converged` and `push` are refused unless written by `hunt-push` | convergence is a fact the script recomputes, not a claim |
| The reader skips an unterminated last line | `hunt-ledger read <slug> [--since SEQ]` returns complete lines only |
| `seq` and `ts` are added by the script | never put them in the JSON you pass |

Witness records (`witness/<sha256>.json`) hold what a verifier needs to replay a
run exactly: repository, package, test name, the full command line, env
(including `GOTOOLCHAIN=local` and the scope's env), tag set, `-race`, N,
timeout, and the image ID when a container runs. The file name is the SHA-256
of its content; it is written once, by the agent that ran the witness, and
never rewritten.

## Event vocabulary

Pass only the fields listed; `hunt-ledger` adds `seq`, `ts`, `kind`.

| Kind | Fields | Written by |
|------|--------|------------|
| `start` | `topic`, `scope_sha256`, `budget` | root, after the approval |
| `agent` | `id`, `role`, `model`, `worktree?` | root, on each dispatch |
| `agent-end` | `id`, `role`, `outcome` | root |
| `state` | `to` (`hunting`, `frozen`, `final-pass`, `pushing`, `awaiting-merge`, `done`) | root, with `hunt-ledger owner --set-state` |
| `pass-start` / `pass-end` | `n`, `sha` (per repo), `cells_total` / `cells_done`, `findings` | hunter |
| `verdict` | `pass`, `cell`, `repo`, `result` (`clean`, `finding`, `no-verdict`), `witness`, `k?`, `n?` | hunter, final pass |
| `finding` | `cell`, `repo`, `witness`, `branch` (`hunt-w/<slug>/<N>`), `summary` | hunter |
| `confirmed` / `rejected` | `finding` (its seq), `k`, `n`, `p_hat`, `image?`, `queue_concurrency` | verifier |
| `duplicate` | `finding`, `repo`, `issue` | verifier |
| `slot` / `slot-wait` | `finding`, `repo` | verifier |
| `forge-intent` / `forge-done` | `op`, `repo`, `nonce`, `issue?` | verifier, integrator |
| `label` | `repo`, `issue`, `label` (`fixed-local`, `needs-decision`, `off-topic`, `fixed`) | verifier, fixer, integrator |
| `decision` | `repo`, `issue`, `title`, `question` | fixer, integrator |
| `claim` / `release` | `repo`, `issue`, `fixer`, `worktree`, `branch` | fixer |
| `fix-ready` | `repo`, `issue`, `branch`, `commit` | fixer |
| `tip-before` / `tip-after` | `repo`, `sha`, `issues`, `files?` (after) | integrator |
| `integrate-fail` | `repo`, `issue`, `witness`, `reason` | integrator, root (`out-of-scope`) |
| `witness-run` | `witness`, `n`, `k`, `provisional?`, `duration_ms` | integrator |
| `bundle` | `repo`, `sha` | integrator |
| `codex` | `repo`, `issue`, `result` (`pending`, `done`, `skipped`, `abandoned`), `verdict?` | integrator |
| `queue-timeout` | `label`, `witness?` | any role, on exit code 75 |
| `pause` | `reason` (`permission`, `cap`, `disk`, `budget`, `stall`, `user`), `detail` | any role |
| `resume` | `from_seq` | root |
| `converged` / `push` | reserved | `hunt-push` only |
| `mr-opened` | `repo`, `url`, `closes` | `hunt-push` |
| `merged` | `repo`, `mr`, `merge_sha` | root (after-merge) |
| `repin` | `consumer`, `dep`, `sha` | integrator |
| `closed` | `repo`, `issue`, `since_sha` | integrator |
| `teardown` | `removed` | root |

Act-now kinds (`pause`, `decision`, `converged`, `mr-opened`, `stall`) also
raise a desktop notification from `hunt-ledger` itself; one decision per event,
recorded in `notified_seq`. When no display bus is reachable, `notify_failed`
is set and the watchdog retries — the hunt never notifies twice for one event.

## Counter

`counter.open` = issues opened by the hunt (`forge-done` on `issue-create`),
minus those labelled `fixed-local`, `needs-decision`, `off-topic`, `fixed`, or
closed as duplicate. Cap 10; a reopening past the cap pauses the hunter until
the counter is back at the resume threshold (7). The verifier reserves its
slot with a `slot` event **before** calling the forge — two verifiers can never
both take the last slot.

## Forge idempotence

Every forge write is bracketed by `forge-intent` (with a nonce) and
`forge-done`. The nonce is also in the issue body (`hunt-nonce: <nonce>`). An
intent without its done is resolved on resume, or before any retry, with
`hunt-forge <slug> <repo> issue-find-nonce <nonce>`: found → append the
missing `forge-done`; absent → the write may be retried.

---

## status.json — the snapshot the HUD reads

Folded by `hunt-ledger append` **under the ledger lock**, after each event
(tmp + mv); fully rebuilt when `status.seq + 1 ≠ event.seq` or the format
version differs, and by `hunt-ledger rebuild <slug>` on every resume.
`hunt-status <slug> --json` prints it; nobody else writes it.

```text
{ v, slug, seq, state, pause:{reason,since}|null,
  counter:{open,cap,resume_at},
  pass:{n,sha,cells_done,cells_total},
  queue:{tokens_total, holders:[{slug,pid,label,since,exclusive}],
         waiting:[{slug,label,since}]},
  tip:{sha,bundle_at}, codex:{pending,done,skipped,abandoned},
  decisions:[{repo,issue,title}], beat, busy:{since,deadline}|null,
  notified_seq, notify_failed, events:[last 20 {seq,kind,text}] }
```

- `beat` — epoch ms of the last progress event; never written by the watchdog.
- `busy` — a queue job is running, until its `deadline`; past it, false.
- "stale" and "orphaned" are judged **only in active states** (`hunting`,
  `frozen`, `final-pass`, `pushing`), never in `paused` or `awaiting-merge`.
  The stall threshold (`scope.thresholds.stall_ms`) exceeds the queue's
  longest wait, so a hunt waiting for a token is not reported stale.

Fixtures shared with kodflow-hud: `tests/fixtures/status-v1.json`,
`status-torn.json`, `status-v99.json`.

## active.json — every hunt on this machine

Read-modify-write only under `~/.local/state/hunt/.active.lock`, by
`hunt-ledger` (`init`, progress events, `owner --set-state`, `owner --release`)
and by the watchdog (`watch` field only). One entry per hunt:
`slug`, `created`, `owner {session, proc {pid, starttime, boot_id}}`, `beat`,
`watch`, `state`.

**The owner is alive** when its process identity matches — same pid, same
start time, same boot — whatever the age of `beat`. Only the preflight of
`/hunt` judges that; the HUD never tests a process.

## Reading the ledger

```bash
hunt-ledger read <slug>                 # everything, complete lines only
hunt-ledger read <slug> --since 1200    # what happened after seq 1200
hunt-status <slug>                      # the French summary table
hunt-status <slug> --json               # status.json as is
```

Query with `jq`; never grep the raw file for a decision.
