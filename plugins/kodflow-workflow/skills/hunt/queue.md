# /hunt — the heavy-job queue

Every compile, test, static check, container build or repository-wide lint a
role runs goes through `hunt-queue`. Nothing heavy runs directly: two OOMs from
parallel builds are exactly what this file prevents.

```bash
hunt-queue [--exclusive] [--label TEXT] [--wait SECONDS] [--lock PATH] -- CMD...
```

| Exit | Meaning | What the role does |
|------|---------|--------------------|
| CMD's own | CMD ran | interpret per the adapter |
| `75` | waited longer than `--wait` for the gate or a token | `queue-timeout` event; the run is **no verdict** — never a pass, never a fail |
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
- Locks are taken with `flock -o`, so a daemon a job leaves behind does not
  keep the token.
- **Exclusivity is decided by the scope**, not by the agent: the scope lists the
  packages and tag sets whose witnesses start containers
  (`repos[].exclusive`). A container that appears during a normal job means the
  job was misclassified: rerun it exclusive and tell root to fix the scope.
- An exclusive job that times out releases the gate.
- `CMD` runs under `lourd` when it exists (memory and CPU cap of the host).

## `--wait` per role

| Role | `--wait` | Why |
|------|----------|-----|
| hunter | 1800 | a pass can afford to wait; a timeout is a cell replayed later |
| verifier | 3600 | a finding must not be lost to a busy queue |
| fixer | 1800 | |
| integrator | 3600 | integration is serial; waiting is cheaper than a no-verdict |

The stall threshold of the scope is set above the longest wait, so a role
waiting for a token is not reported stale.

## What a job gets

- `GOTMPDIR` — a fresh `mktemp -d` under the state directory, removed by trap
  when the job ends; dead jobs' directories are purged at queue start and on
  resume.
- A queue record `~/.cache/hunt/queue/<pid>.json` (`slug`, `label`, `since`,
  `exclusive`, `state` `waiting|running|timeout`), removed on exit; records of
  dead pids are purged at start. `status.json.queue` shows them.
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
