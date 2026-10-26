# /hunt — freeze, final pass, push, after merge

Convergence is a fact `hunt-push` recomputes from the ledger, not a feeling
root has. The phases below only arrange for that fact to become true.

---

## 1. Freeze

Root freezes when **all** hold, read from `status.json` and the ledger:

- every fixer idle (no open `claim`, no `fix-ready` waiting);
- counter at 0 (`fixed-local`, `needs-decision`, `off-topic` do not count);
- no `tip-before` without its `tip-after`;
- no Codex review `pending` (a `skipped` one is retried once now; past the
  scope's `thresholds.codex_defer_s` it becomes `abandoned`).

Then: `state` → `frozen` (`hunt-ledger owner <slug> --set-state frozen`), the
integrator fetches the base of each repository, rebases `hunt/<slug>` on it
through `hunt-git … integrate` when the base moved (a moved base is a new
integration, verified as one), and records the frozen SHA per repository.

## 2. Final pass

`state` → `final-pass`. A fresh hunter plays **every** cell of the matrix on the
frozen SHA, at full N, with each witness's expected polarity:

| Witness | Expected |
|---------|----------|
| a cell with no issue | green |
| a fixed issue's witness | green at `N_fix` |
| a `needs-decision` issue's witness | excluded by the `huntopen` tag (adapter) |

- A new finding sends the hunt back to hunting (`state` → `hunting`); the pass
  counter moves on.
- A `no-verdict` cell is replayed; the pass is not complete while one remains.
- Limits: `thresholds.max_passes` or `thresholds.max_hours` reached → stop with
  the report below, nothing pushed.

## 3. Push — `hunt-push` only

```bash
hunt-push <slug>
```

The script recomputes convergence itself and refuses otherwise: every matrix
cell has a verdict at the frozen SHA, the frozen SHA is the current tip of
`hunt/<slug>`, counter 0, no Codex pending. Then, per repository, dependencies
first:

1. autosquash the `fixup!` commits; `git diff <frozen> <squashed>` must be
   empty;
2. push `hunt/<slug>`;
3. open the MR/PR to the scope's `mr_target` with every `Closes #N` in the
   description (through `hunt-forge`);
4. append `converged`, `push`, `mr-opened`; labels move to `hunt:fixed`, each
   issue gets a comment with the pushed SHA.

`state` → `awaiting-merge`. **Never merge.** The MRs wait for the user.

### Multi-repository order (Go)

A consumer that depends on another `owned` repository of the scope:

1. the dependency is pushed first;
2. the integrator re-pins the consumer on the pushed SHA (`GOWORK=off go get
   dep@<sha>`, a dedicated commit), then the consumer is pushed;
3. the consumer's MR is opened as work in progress (not ready), titled "waits for the merge of
   <dep>".

Details in `adapters/go.md`.

### CI

`hunt-forge <slug> <repo> ci-status` after each push. A red pipeline is an
issue and a commit, like any finding, then the next grouped push. A CI failure
is never fixed by pushing outside `hunt-push`.

## 4. After merge

The state survives the session: `--status` and `--resume` both check, in
`awaiting-merge`, whether the MRs were merged (`hunt-forge … mr-status`).

On a merge:

1. `merged` event with the merge SHA;
2. issues the forge did not close are closed by the integrator with
   "FIXED SINCE <merge sha>" (`issue-close`) and a `closed` event;
3. consumers are re-pinned on the merge SHA — `hunt-push <slug> --repin`,
   allowed only when the dependency's merge SHA is in the ledger;
4. once every MR is merged and every consumer re-pinned: `state` → `done`.

Then offer `/hunt --teardown <slug>`.

## Report

At convergence, at a limit, or on a stop:

- coverage — cells with a verdict / total, per pass;
- issues opened, fixed, `needs-decision` (with their question), `off-topic`,
  duplicates;
- Codex — done, skipped, abandoned, and "converged without Codex on #…" when
  any issue went unreviewed;
- residue — what was not verified at full N and why;
- labels to revisit on a stop before convergence.

Every stop or pause writes a ledger line read at the next start, and raises a
desktop notification through `hunt-ledger`.
