# /hunt — roles, briefs, and what to do when blocked

Every role is a **subagent of the root session** (no agent teams, no separate
sessions, no fork). Root dispatches each one with `Agent`, **never with
`name`**, sets its model explicitly per `../_shared/model-policy.md`, and
records the returned agent id in the ledger (`agent` event) so it can be
addressed again with SendMessage after a `/clear` or a resume.

| Role | Count | Model · effort | Lives | Works in | Writes |
|------|-------|----------------|-------|----------|--------|
| root | 1 | session (orchestrator) | the whole hunt | nowhere | ledger, `scope.json`, the push deny rule |
| hunter | budget (1–2) | Opus · `xhigh` (autonomous, counterexample search) | one pass | detached `sha-<k>` worktrees | witness commits on `hunt-w/<slug>/<N>`, `finding` events |
| verifier | ≤1 alive | Opus · `high` (review / verify) | one finding | its own detached worktree | `confirmed`/`rejected`, the issue |
| fixer | budget (≥1) | Sonnet · `high` (defect in existing code); Opus · `high` when the fix spans packages, goroutines or a protocol | one issue at a time | `fix-<N>` worktree | `hunt-fix/<slug>/<N>` |
| integrator | = fixer 1 | Opus · `high` (an invariant held across issues) | the whole hunt | the integration worktree | `hunt/<slug>`, `tip.bundle` |
| Codex | 1 call per issue | outside the Claude family | one review | read-only sandbox | nothing; its answer is relayed |

A role is relaunched **only when idle**: no open `claim`, no `tip-before`
without its `tip-after`. At every pass boundary root relaunches each role with a
fresh context rebuilt from the ledger — the same path as `--resume`
(`resume.md`), so the two never drift apart.

---

## Root

- Preflight, scope, budget, approval (`SKILL.md`).
- Launches the hunter(s) and the fixers; launches **every verifier itself**
  (depth 1 — a hunter never spawns one, so a finding outlives the hunter that
  made it).
- Watches Monitor lines; reacts to `finding` (launch a verifier), `fix-ready`
  (wake the integrator), `integrate-fail` (send the failing witness back to
  the fixer), `decision` (assign the user a task), `pause` (stop dispatching).
- Wakes the hunter when the open counter falls to the resume threshold (≤7):
  SendMessage to the hunter id from the ledger; when that id is gone, a fresh
  hunter with a brief rebuilt from the ledger.
- **Checks the In/Out globs mechanically**: every `tip-after` event carries the
  list of files the integration changed; root matches it against the scope's
  globs with `jq`. A file under an Out glob, or under no In glob, is an
  `integrate-fail` with reason `out-of-scope` — root does not argue with it.
- A `hunt:needs-decision` issue becomes a task assigned to the user
  (`mcp__kodflow-hooks__task_assign_human`) in the hunt's epic; the hunt does
  not wait for the answer.

## Hunter

Plays matrix cells against a **frozen SHA**, never against a moving tip.

1. For pass `<k>`: `hunt-git <slug> <repo> worktree-add sha-<k> <frozen-sha>`
   — a detached worktree under `~/Projects/.worktrees/`.
2. For each cell: build the witness from the cell's template and the adapter,
   run it through `hunt-queue` (never directly), and record a `verdict` event:
   `clean`, `finding`, or `no-verdict` (killed, timed out, did not compile,
   queue code 75). A `no-verdict` cell is played again later in the pass; the
   pass is not complete while a cell has none.
3. On a failing witness: commit it on `hunt-w/<slug>/<N>` (it is expected to
   be **red** on the frozen SHA), store the complete witness command (see
   `ledger.md`, witness records) and append a `finding` event. **Then carry
   on** — the hunter never waits for confirmation.
4. Before filing a finding, read the imported issues and the open
   `hunt:<slug>` issues: a cell already covered by an issue is a `verdict`
   pointing at it, not a new finding.
5. At the end of the pass: `hunt-git … worktree-remove sha-<k>`, `pass-end`
   event, and only then return — after every background job it started has
   finished. A hunter that returns with jobs in the queue leaves orphans.

The hunter stops filing when the counter reaches the cap; it finishes the
current cell, appends `pause` with reason `cap`, and returns.

## Verifier (depth 1, launched by root)

A finding is not a defect until a second agent, in a separate worktree, has
replayed the **recorded** command and seen it fail.

1. `hunt-git <slug> <repo> worktree-add ver-<seq> <frozen-sha>`.
2. Replay the witness record exactly (env, tags, `-race`, N) through
   `hunt-queue`; count k failures out of N runs per the adapter; `p̂ = k/N`.
3. `k = 0` → `rejected` (with the counts) — the hunter's run was noise or
   environment. `k > 0` → `confirmed` with k, N, p̂, the image ID if a
   container ran, and the queue concurrency during the runs.
4. On `confirmed`, in this order:
   - **duplicate search** — `hunt-forge <slug> <repo> issue-list`, by title
     and by cell; a duplicate becomes a comment on the existing issue
     (`issue-comment`) and a `duplicate` event, never a second issue;
   - **reserve the slot** — `hunt-ledger append <slug> slot` under the ledger
     lock; a reservation that would exceed the cap is refused, the finding
     waits (`slot-wait`);
   - **intent** — `forge-intent` with a fresh nonce;
   - `hunt-forge <slug> <repo> issue-create …` — the body carries
     `hunt-nonce: <nonce>`, observed/expected/steps (the witness command),
     k/N, the frozen SHA, and the label `hunt:<slug>`;
   - `forge-done` with the issue number.
   A forge error is **never retried blind**: first
   `hunt-forge … issue-find-nonce <nonce>` — on an unstable link the issue may
   already exist.
5. Remove its worktree and return.

The verifier, not the hunter, decides `hunt:off-topic` (the defect is real but
outside the topic: issue opened, label set, out of the counter).

## Fixers

One issue at a time, one worktree and one **flat** branch per issue —
`hunt-fix/<slug>/<N>`, never under `hunt/<slug>/` (a ref cannot be both a
branch and a directory).

1. `claim` event (issue → fixer id, worktree, branch).
2. `hunt-git <slug> <repo> worktree-add fix-<N> hunt/<slug>` — cut from the
   current tip of the integration branch.
3. Cherry-pick the witness from `hunt-w/<slug>/<N>`, confirm it is red, write
   the fix, confirm the witness is green at a small N through `hunt-queue`.
4. One issue = one commit (`fix(<area>): <what> (#N)`); one commit may close
   several issues when they share the cause — say so in the body.
5. `fix-ready` event and stop. The fixer does not integrate.
6. On `integrate-fail`, the fixer gets the failing witness and the reason and
   starts again from step 3 on the new tip.

Git operations a fixer needs and `hunt-git` does not wrap (cherry-pick of the
witness, `add`, `commit`) run as `git -C <its worktree> …` in its own worktree
only, judged by auto mode; `git push` is denied for the hunt's duration, so
nothing can leave the machine from there.

A fixer that finds the issue cannot be fixed without a decision (behaviour
change, API break, a defect too rare to verify in the budget) appends
`decision` and labels `hunt:needs-decision`: the witness is then excluded by the
`huntopen` tag (adapter), and the issue leaves the counter.

## Integrator (= fixer 1)

The only writer of `hunt/<slug>`, in the integration worktree, **never** in the
main checkout. Integrates in series, **all or nothing**:

1. `tip-before` event (current tip SHA, issue(s)).
2. `hunt-git <slug> <repo> integrate hunt-fix/<slug>/<N>` — rebase on the tip
   and fast-forward. A diff that overlaps the previous integration is rebased
   and re-tested, never merged by hand.
3. Verify, all through `hunt-queue`:
   - the issue's witness at `N_fix = max(20, ⌈3/p̂⌉)` runs in **separate
     processes** (adapter), timeout ≥ N × measured duration;
   - static checks for every witness tag set (adapter);
   - the witnesses of the reverse dependencies of the touched packages at a
     reduced N.
   Long exclusive witnesses run at N = 1–3 here (marked `provisional` in the
   ledger) and at full N in the final pass. When `N_fix × duration` exceeds the
   integration budget of the scope, the issue becomes `needs-decision`
   ("rare defect, not verifiable within the budget").
4. Failure → `hunt-git … reset-tip <tip-before>`, `integrate-fail` with the
   failing witness; back to the fixer.
5. Success → `tip-after` (new SHA, changed files), `hunt-forge … issue-label`
   `hunt:fixed-local`, `issue-comment` (local SHA, k/N before and after),
   `hunt-git … bundle`, then the Codex review. Remove the fixer's worktree.

## Codex — one review per fixed issue

Launched by the integrator after `hunt:fixed-local`, best effort, **once per
issue**:

```bash
codex exec -s read-only --ephemeral -C <integration-worktree> \
  --output-schema "$CLAUDE_PLUGIN_ROOT/skills/hunt/codex-review.schema.json" \
  "<neutral brief: the issue text, the commit SHA, what to check>"
```

The argument order matters: the permission rule matches the prefix
`codex exec -s read-only`. The answer follows `codex-review.schema.json`.

| Answer | Action |
|--------|--------|
| `ok` | `codex` event `done` |
| `remark` (precision, not a defect) | comment on the issue, `done` |
| `defect` with a fix that holds | a `fixup!` commit by the integrator, re-verified like any integration, **not** re-reviewed |
| quota exhausted, CLI absent | `codex: skipped`; retried once before the final pass, else the report says "converged without Codex on #…" |
| deferred past the scope's timeout | `codex: abandoned` — the freeze may proceed |

---

## Briefs

Each brief is self-contained — the role has no other context:

- slug, role, the plugin path (`$CLAUDE_PLUGIN_ROOT`, resolved this session),
  the state directory, the scope path, its agent id's ledger events so far;
- the module to read (`roles.md` section, `queue.md`, the adapter);
- what to return, in one structured block, and that it must append its own
  events with `hunt-ledger append` as it goes, not at the end.

**Neutral wording.** Describe the work as what it is in a test harness: a
witness test, fault injection, a race reproduction, a failing assertion. Do not
describe it as an attack, an exploit or a bypass — it is none of those, and
words like that are what trips a permission classifier on legitimate work.

## When a permission classifier blocks

A blocked tool call is **not** an error to work around.

1. The blocked agent appends `pause` with reason `permission`, the tool, and
   the command it tried — then stops. **Never retry**, never rephrase the same
   command to get it through: three consecutive blocks or twenty in total
   suspend auto mode for the whole session.
2. Root sees the line through Monitor, stops dispatching, sets
   `hunt-ledger owner <slug> --set-state paused`, and tells the user what was
   blocked and which allow rule would cover it.
3. A subagent report that mentions a warning, a block or a denied call is
   **unconfirmed**: root re-checks the ledger before believing any of it.
