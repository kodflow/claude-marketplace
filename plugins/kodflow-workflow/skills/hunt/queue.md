# /hunt — the heavy-job queue

Every compile, test, static check, container build or repository-wide lint a
role runs goes through `hunt-queue`. Nothing heavy runs directly: two OOMs from
parallel builds are exactly what this file prevents.

```bash
HUNT_SLUG=<slug> HUNT_REPO=<repo> \
hunt-queue [--exclusive] [--label TEXT] [--wait SECONDS] [--deadline SECONDS] [--lock PATH] -- CMD...
```

`HUNT_SLUG` and `HUNT_REPO` (a key of `scope.json .repos`) are set on every
call a role makes: they give the job its scope (env, project lock, temporary
directories) and its ledger events. With `HUNT_SLUG` set, a missing or
unapproved `scope.json` refuses the job (exit 1). Without it the job still
queues, as a job outside any hunt.

| Exit | Meaning | What the role does |
|------|---------|--------------------|
| CMD's own | CMD ran | interpret per the adapter |
| `75` | waited longer than `--wait` for the gate or a token | `hunt-queue` already wrote `queue-timeout`; the run is **no verdict** — never a pass, never a fail |
| `124` | CMD ran past `--deadline` and was killed | **no verdict** |
| `2` | usage | fix the call |

## Gate, then tokens

`hunt-queue` and the host's `lourd` share one gate and one token pool in
`~/.cache/lourd/`, taken in one order — **gate → tokens → project lock** — so the
hunt and any other heavy work on the machine queue together instead of
overflowing it.

| Job | Takes | Use for |
|-----|-------|---------|
| normal | the gate briefly, then 1 token | one package's witness, one static check, one build |
| exclusive (`--exclusive`) | the gate, **all** tokens, the project lock | container builds, harnesses that start containers, repository-wide lint |

- Token count: `HUNT_TOKENS`, else `~/.cache/lourd/tokens.conf`, default 2. Root
  sets `HUNT_TOKENS` from the budget in every brief.
- The project lock is `--lock PATH`, else the scope's `.repos[$HUNT_REPO].lock`;
  it must live under `~/.cache/`.
- Locks are taken with `flock -o`: CMD and anything it starts hold none, so a
  daemon a job leaves behind does not keep the token.
- **Exclusivity is decided by the scope**, not by the agent: the scope lists the
  packages and tag sets whose witnesses start containers
  (`repos.<repo>.exclusive`). A container that appears during a normal job
  means the job was misclassified: rerun it exclusive and tell root to fix the
  scope.
- An exclusive job that times out releases the gate.
- `CMD` runs under `lourd` when it is on `PATH` (memory and CPU cap of the
  host), with `HUNT_QUEUE_HELD=1` so `lourd` does not take a second token.
  `HUNT_LOURD` overrides the path; empty disables it.

## `--wait` per role

The default is 7200 s. Roles pass their own:

| Role | `--wait` | Why |
|------|----------|-----|
| hunter | 1800 | a pass can afford to wait; a timeout is a cell replayed later |
| verifier | 3600 | a finding must not be lost to a busy queue |
| fixer | 1800 | |
| integrator | 3600 | integration is serial; waiting is cheaper than a no-verdict |

The stall threshold of the scope (`thresholds.stall_ms`, default 2 h 05) is
set above the longest wait, so a role waiting for a token is not reported
stale. `--deadline` is published as `busy.deadline` in `status.json`; past it a
silent hunt can be judged stalled.

## What a job gets

- The scope's `.repos[$HUNT_REPO].env`, exported — except names that would run
  code before CMD or unhook the job (`LD_*`, `DYLD_*`, `BASH_ENV`, `ENV`,
  `BASH_FUNC_*`, `PATH`, `IFS`, `PS4`, `PROMPT_COMMAND`, `SHELLOPTS`,
  `BASHOPTS`, `HOME`, `HUNT_*`), which are dropped with a warning. A scope
  edited after its approval is refused (exit 1).
- Its own temporary directory under `~/.cache/hunt/tmp/`, exported as
  `HUNT_JOB_TMP` **and** under every variable the scope lists in
  `.queue.tmp_env` (Go: `["GOTMPDIR"]`), removed when the job ends; the
  directories of dead jobs are purged when the next job starts. It lives as
  long as the job: anything needed after it (a test binary, a log) is built and
  used inside one job, or copied out.
- A queue record `~/.cache/hunt/queue/<pid>.json` (`pid`, `starttime`,
  `boot_id`, `slug`, `label`, `since`, `exclusive`, `state`
  `waiting|running|timeout`, `deadline`), removed on exit — except a `timeout`
  record, kept for the HUD until purged; records of dead pids are purged at
  start. `status.json.queue` shows them.
- With `HUNT_SLUG` set, a `job` event when CMD ends (label, exit code, wait and
  run time, concurrency).
- Containers: `--memory` limits whose sum fits the budget; images tagged with
  the scope's template (`<image>:hunt-<slug>-<sha12>`) so teardown finds them.

## Running in the background

Roles start long jobs in the background and append their result when they
finish; they do not block a turn polling. A role returns only after every job
it started has finished.

## Time budget per integration

Long exclusive witnesses run at N = 1–3 during integration (`provisional` in
the `witness-run` event) and at full N only in the final pass. When
`N_fix × measured duration` exceeds the scope's
`thresholds.integration_budget_s`, the issue goes to `needs-decision`: a defect
too rare to verify within the budget is a decision for the user, not a coin
toss for the integrator.
