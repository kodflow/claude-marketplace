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
    ├── tip.bundle                   git bundle of hunt/<slug> after each integration
    │                                (tip-<repo>.bundle, one per repo, when the scope has several)
    ├── .push-token                  exists only while hunt-push runs
    └── forge-local/<repo>/          the `local` fake forge (tests and dry runs)
```

Never in a repository, never under `/tmp` (wiped when a session starts).

---

## hunt-ledger

```bash
hunt-ledger init <slug>                      # register in active.json (scope.json must exist)
hunt-ledger append <slug> <kind> [json]      # one event; prints the seq it wrote
hunt-ledger read <slug> [--since SEQ]        # complete events, one JSON object per line
hunt-ledger rebuild <slug>                   # status.json from the whole ledger (printed)
hunt-ledger owner <slug> --set-state STATE   # appends a `state` event {to: STATE}
hunt-ledger owner <slug> --release           # drop the owner; the entry goes once `done`
hunt-ledger notify <slug>                    # retry the last failed desktop notification
```

Exit `0` ok · `1` refused · `2` usage · `75` the ledger lock was not obtained
(`HUNT_LEDGER_WAIT`, default 60 s).

## Writer rules

| Rule | Why |
|------|-----|
| The only writer is `hunt-ledger append <slug> <kind> [json]` | flock on `ledger.lock`, one `write` ≤4096 bytes, fsync — appends from several agents never tear |
| Write/Edit on `ledger.jsonl` or `status.json` | **forbidden** |
| A line over 4096 bytes is refused (exit 1) | store the bulk in `witness/<sha256>.json` and append the hash |
| `converged` and `push` are refused unless written by `hunt-push` | they need the token `hunt-push` holds for its own run; convergence is a fact the script recomputes, not a claim |
| A `slot` that would take the counter past `thresholds.cap` is refused (exit 1) | checked and written under the same lock: two verifiers never both take the last slot |
| The reader skips an unterminated last line; the next writer truncates it | `hunt-ledger read <slug> [--since SEQ]` returns complete lines only |
| `seq` and `ts` are added by the script | never put them in the JSON you pass; `append` prints the `seq` |

Witness records (`witness/<sha256>.json`) hold what a verifier needs to replay a
run exactly: repository, cell, the witness commit, the full command line, env
(the scope's `env` for the repository included), tag set, `-race`, N, timeout,
and the image ID when a container runs. The file name is the SHA-256 of its
content; it is written once, by the agent that ran the witness, and never
rewritten.

## Event vocabulary

Pass only the fields listed; `hunt-ledger` adds `seq`, `ts`, `kind`. A short
`text` (or `summary`, `title`, `reason`) is what the HUD shows for the event.

| Kind | Fields | Written by |
|------|--------|------------|
| `start` | `topic`, `scope_sha256`, `budget` | root, after the approval |
| `agent` | `id`, `role`, `model`, `worktree?` | root, on each dispatch |
| `agent-end` | `id`, `role`, `outcome` | root |
| `state` | `to` (`hunting`, `paused`, `frozen`, `final-pass`, `pushing`, `awaiting-merge`, `done`) | `hunt-ledger owner --set-state` only |
| `pass-start` | `n`, `sha`, `cells_total` — `sha` is the frozen SHA, or a map `{repo: sha}` (required when several repositories are `owned`) | hunter |
| `pass-end` | `n`, `cells_done`, `findings` | hunter |
| `verdict` | `pass`, `cell` (the matrix `id`), `repo`, `result` (`clean`, `finding`, `no-verdict`), `witness`, `k?`, `n?` | hunter, final pass |
| `finding` | `cell`, `repo`, `witness`, `commit` (the witness commit), `summary` | hunter |
| `confirmed` / `rejected` | `finding` (its seq), `k`, `n`, `p_hat`, `image?`, `queue_concurrency` | verifier |
| `duplicate` | `finding`, `repo`, `issue` | verifier |
| `slot` / `slot-wait` | `finding`, `repo` | verifier |
| `forge-intent` / `forge-done` | `op`, `repo`, `nonce`, `issue` (on done) | verifier, integrator |
| `label` | `repo`, `issue`, `label` (`fixed-local`, `needs-decision`, `off-topic`, `fixed`, `open`, `reopened`; a `hunt:` prefix is accepted) | verifier, fixer, integrator, `hunt-push` (`fixed`) |
| `decision` | `repo`, `issue`, `title`, `question` | fixer, integrator |
| `claim` / `release` | `repo`, `issue`, `fixer`, `worktree`, `branch` | fixer |
| `fix-ready` | `repo`, `issue`, `branch`, `commit` | fixer |
| `tip-before` / `tip-after` | `repo`, `sha`, `issues`, `files` (after) | integrator |
| `integrate-fail` | `repo`, `issue`, `witness`, `reason` | integrator, root (`out-of-scope`) |
| `witness-run` | `witness`, `n`, `k`, `provisional?`, `duration_ms` | integrator |
| `bundle` | `repo`, `sha` | integrator |
| `codex` | `repo`, `issue`, `result` (`pending`, `done`, `skipped`, `abandoned`), `verdict?` | integrator |
| `job` | `label`, `rc`, `exclusive`, `waited_ms`, `run_ms`, `concurrency` | `hunt-queue`, when `HUNT_SLUG` is set |
| `queue-timeout` | `label`, `exclusive`, `wait_s` | `hunt-queue`, on exit 75, when `HUNT_SLUG` is set |
| `pause` | `reason` (`permission`, `cap`, `disk`, `budget`, `user`), `detail` | any role |
| `resume` | `from_seq` | root |
| `stall` | `reason` (`beat`, `owner-dead`), `text` | `hunt-status --watchdog` |
| `converged` | `shas` (`{repo: sha}`), `pass` | `hunt-push` only |
| `push` | `repo`, `frozen`, `sha`, `branch`, `repin?` | `hunt-push` only |
| `mr-opened` | `repo`, `frozen`, `url`, `mr`, `closes` | `hunt-push` |
| `merged` | `repo`, `mr`, `merge_sha` | root (after-merge) — `hunt-push --repin` needs it |
| `repin` | `consumer`, `dep`, `sha` | `hunt-push --repin` |
| `closed` | `repo`, `issue`, `since_sha` | integrator |
| `teardown` | `removed` | root |

Act-now kinds (`pause`, `decision`, `converged`, `mr-opened`, `stall`) also
raise a desktop notification from `hunt-ledger` itself, recorded in
`notified_seq`. When no display bus is reachable, `notify_failed` is set and
the watchdog retries with `hunt-ledger notify` — the hunt never notifies twice
for one event.

## How events move status.json

One reducer folds each event; the same function rebuilds from the whole ledger,
so the two paths cannot disagree.

| Event | Effect |
|-------|--------|
| `state` | `state = to`; any state but `paused` clears `pause` |
| `pause` | `state = paused`, `pause = {reason, since}` |
| `resume` | `paused` → `hunting`, `pause` cleared |
| `converged` | `state = pushing` |
| `push` | `state = awaiting-merge` |
| `teardown` | `state = done` |
| `pass-start` | new pass: `n`, `sha`, `cells_done` 0, `cells_total` |
| `verdict` | counts the **distinct** cells of the current pass with a verdict; `no-verdict` does not count |
| `slot` | `counter.reserved` + 1 |
| `forge-done` with `op: issue-create` | the issue enters the counter, one reservation is consumed |
| `label` `fixed-local` / `needs-decision` / `off-topic` / `fixed` | the issue leaves the counter (`needs-decision` also lists it in `decisions`) |
| `label` `open` / `reopened` | the issue enters the counter again |
| `decision` | the issue leaves the counter and is listed in `decisions` |
| `closed` | the issue leaves the counter and `decisions` |
| `codex` | the issue's latest result, counted per result |
| `tip-after`, `bundle` | `tip.sha`, `tip.bundle_at` |

`counter.open` = issues in the counter + `counter.reserved`. Every kind except
`stall` is progress and moves `beat`. Routine kinds (`verdict`, `agent`,
`claim`, `job`, `slot`, `forge-*`, `codex`, `finding`, `bundle`…) stay out of
the last-20 `events` list.

## Counter

`counter.open` — issues opened by the hunt (`forge-done` on `issue-create`)
still open in the hunt's eyes, plus the slots reserved and not yet turned into
issues. The cap is `thresholds.cap` (10); the hunter is woken again when the
counter falls to `thresholds.resume_at` (7). The verifier reserves its slot
with `hunt-ledger append <slug> slot` **before** calling the forge; exit 1
means the cap is reached and the finding waits (`slot-wait`). A reopening
(`label reopened`) past the cap pauses the hunter until the counter is back at
the resume threshold.

## Forge idempotence

Every forge write is bracketed by `forge-intent` (with a nonce) and
`forge-done`. The nonce is also in the issue body (`hunt-nonce: <nonce>`), and
`hunt-forge … issue-create --nonce` returns the existing issue instead of a
second one. An intent without its done is resolved on resume, or before any
retry, with `hunt-forge <slug> <repo> issue-find-nonce <nonce>`: found (exit 0,
the number) → append the missing `forge-done`; absent (exit 1) → the write may
be retried; lookup failed (exit 3) → nothing is known: retry the lookup later,
never the write. `issue-create` itself creates nothing when its own lookup
fails (exit 3).

---

## status.json — the snapshot the HUD reads

Folded by `hunt-ledger append` **under the ledger lock**, after each event
(tmp + mv); fully rebuilt when `status.seq + 1 ≠ event.seq` or the format
version differs, and by `hunt-ledger rebuild <slug>` on every resume.
`hunt-status <slug> --json` prints it; nobody else writes it.

```text
{ v, slug, seq, state, pause:{reason,since}|null,
  counter:{open,cap,resume_at,issues,reserved},
  pass:{n,sha,cells_done,cells_total,cells},
  queue:{tokens_total, holders:[{slug,pid,label,since,exclusive}],
         waiting:[{slug,label,since}]},
  tip:{sha,bundle_at}, codex:{pending,done,skipped,abandoned,by_issue},
  decisions:[{repo,issue,title}], beat, busy:{since,deadline}|null,
  notified_seq, notify_failed, events:[last 20 {seq,kind,text}] }
```

- `counter.issues` (`repo#N` keys), `counter.reserved`, `pass.cells` and
  `codex.by_issue` keep the fold exact when an event repeats; a reader may
  ignore them.
- `pass.sha` is the SHA, or `repo:sha12 …` when the pass froze several
  repositories.
- `queue` and `busy` are a snapshot of the live queue records at the time of
  the fold; `busy` is set while one of this hunt's jobs runs, until its
  `deadline`.
- `beat` — epoch ms of the last progress event; never written by the watchdog.
- "stale" and "orphaned" are judged **only in active states** (`hunting`,
  `frozen`, `final-pass`, `pushing`), never in `paused` or `awaiting-merge`.
  The stall threshold (`scope.thresholds.stall_ms`, default 7 500 000 ms)
  exceeds the queue's default wait (7200 s), so a hunt waiting for a token is
  not reported stale.

Fixtures shared with kodflow-hud: `tests/fixtures/status-v1.json`,
`status-torn.json`, `status-v99.json`.

## active.json — every hunt on this machine

Read-modify-write only under `~/.local/state/hunt/.active.lock`, by
`hunt-ledger` (`init`, every append mirrors `state` and, for progress kinds,
`beat`; `owner --release`) and by the watchdog (`watch` field only). One entry
per hunt: `slug`, `created`, `owner {session, proc {pid, starttime, boot_id}}`,
`beat`, `watch`, `state`.

The owner process is the nearest ancestor named `claude` of the
`hunt-ledger init` call (the session), or `HUNT_OWNER_PID` when set. **The owner
is alive** when its process identity matches — same pid, same start time, same
boot — whatever the age of `beat`. `hunt-ledger init` refuses a slug whose
owner is alive and is not the caller; `hunt-status` shows `ORPHELINE` and the
watchdog appends `stall` (`owner-dead`) when it is gone in an active state. The
HUD never tests a process.

`owner --release` clears the owner; the entry itself is removed once the hunt
is `done`.

## Reading the ledger

```bash
hunt-ledger read <slug>                 # everything, complete lines only
hunt-ledger read <slug> --since 1200    # what happened after seq 1200
hunt-status <slug>                      # the French summary table
hunt-status <slug> --json               # status.json as is
```

Query with `jq`; never grep the raw file for a decision.
