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
integration, verified as one). The frozen SHA of each repository is its tip
after that (`hunt-git <slug> <repo> tip`).

## 2. Final pass

`state` → `final-pass`. A fresh hunter appends `pass-start` with the frozen
SHA — a map `{repo: sha}` when several repositories are `owned`; **this last
`pass-start` is what `hunt-push` reads as the frozen pass** — and plays
**every** cell of the matrix on it, at full N, with each witness's expected
polarity:

| Witness | Expected |
|---------|----------|
| a cell with no issue | green |
| a fixed issue's witness | green at `N_fix` |
| a `needs-decision` issue's witness | excluded by the `huntopen` tag (adapter); the cell is judged on what remains |

Every cell must end with a `verdict` `clean` in this pass: `hunt-push` takes the
latest verdict of each cell after the last `pass-start`, and anything but
`clean` refuses the push.

- A new finding sends the hunt back to hunting (`state` → `hunting`); the pass
  counter moves on.
- A `no-verdict` cell is replayed; the pass is not complete while one remains.
- Limits: `thresholds.max_passes` or `thresholds.max_hours` reached → stop with
  the report below, nothing pushed.

## 3. Push — `hunt-push` only

```bash
hunt-push <slug>
```

The script recomputes convergence from the ledger itself and refuses
otherwise (exit 1, the reasons on stderr, nothing pushed):

- the frozen SHA is the `sha` of the last `pass-start` (a map REPO → SHA when
  several repositories are `owned`);
- every `scope.matrix` cell has, after that `pass-start`, a latest `verdict`
  `clean`;
- each frozen SHA is the current tip of `hunt/<slug>` (or was already pushed
  from it: a re-run is idempotent);
- `counter.open` is 0 in a status rebuilt from the ledger;
- no `codex` review is `pending` (`skipped` and `abandoned` do not block).

Then it appends `converged` (`state` → `pushing`) and, per repository,
dependencies (`depends_on`) first:

1. autosquash the `fixup!` commits on a detached HEAD; `git diff <frozen>
   <squashed>` must be empty;
2. re-pin on the dependencies pushed in this run (below);
3. push to `hunt/<slug>` on the repository's `remote` (default `origin`) with
   `--force-with-lease`, and move the local `hunt/<slug>` to what was pushed —
   it only ever pushes `hunt/<slug>`, and refuses a branch that is the base,
   the MR target, `main` or `master`; `push` event (`state` →
   `awaiting-merge`);
4. open the MR/PR to `mr_target` (else `base`) through `hunt-forge`, with one
   `Closes #N` per issue whose last `label` is `fixed-local` — once per
   repository and frozen SHA; `mr-opened` event;
5. move those labels to `hunt:fixed` with a comment carrying the pushed SHA;
   a `label` event `fixed` each.

Ledger order: `converged`, then per repository `push`, `mr-opened`, `label`.
**Never merge.** The MRs wait for the user.

### Multi-repository order and re-pin

A consumer that depends on another `owned` repository of the scope
(`repos.<consumer>.depends_on`):

1. the dependency is pushed first;
2. `hunt-push` re-pins the consumer on the pushed SHA by running the scope's
   `repos.<consumer>.repin = {cmd: [argv…], env: {…}}` in its integration
   worktree, and commits the result as `chore(deps): pin <dep> to <sha12>`;
   then the consumer is pushed. In `cmd`, `{sha}` is the dependency's SHA,
   `{dep}` its key, `{dep.<field>.<field>}` a field of its scope entry; the
   env is the consumer's `env` plus `repin.env`. No `repin` → no re-pin, said
   on stderr;
3. the consumer's MR is opened as a draft, titled "… (waits for the merge of
   <dep>)", while no `merged` event exists for the dependency.

The re-pin command per language is in the adapter (`adapters/go.md`).

### CI

`hunt-forge <slug> <repo> ci-status hunt/<slug>` (or the pushed SHA) after
each push: `{state, url}`, state `pending|running|success|failed|none`. A red pipeline is an
issue and a commit, like any finding, then the next grouped push. A CI failure
is never fixed by pushing outside `hunt-push`.

## 4. After merge

The state survives the session: `--status` and `--resume` both check, in
`awaiting-merge`, whether the MRs were merged (`hunt-forge … mr-status`).

On a merge:

1. `hunt-forge … mr-status <mr>` → `{state: merged, merge_sha}`; `merged`
   event (`repo`, `mr`, `merge_sha`);
2. issues the forge did not close are closed by the integrator with
   `issue-close <N> --body "FIXED SINCE <merge sha>"` and a `closed` event;
3. consumers are re-pinned on the merge SHA — `hunt-push <slug> --repin`,
   refused unless the dependency's `merged` event and a previous `push` of the
   consumer are in the ledger; it appends `repin` and `push`;
4. once every MR is merged and every consumer re-pinned:
   `hunt-ledger owner <slug> --set-state done`.

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
