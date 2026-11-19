# /ktn-issues — commits and history

One commit per issue, each with `Fixes #N`, all on one batch branch, one PR.
The history is the review artefact: a reviewer reads one commit and sees one
issue, its red case, its fix and its control — nothing else.

---

## Branches

- One batch branch for the run, cut from the fetched default branch
  (`fix/issues-<date>`), in the run's worktree.
- Parallel agents each work in a worktree and branch of their own, cut from the
  same base. Their single commit is cherry-picked onto the batch branch in
  issue-number order. Never let two agents commit to the same branch.

## The commit

```
fix(<rule-or-area>): <what is now true, in one line> (#N)

<the precise case, the condition added, the control and what it proves>

Fixes #N
```

Exactly one issue per commit, and one commit per issue: no "and also #M", no
issue spread over three commits. Open equivalents fixed by the same change get
their own `Fixes #M` line in that commit only when the change is literally the
same; otherwise they get their own commit.

## Fixups from the review round

The review round (`gate.md`) will find too-wide exemptions — plan on it. Its
fixes belong to the commit of the issue they correct, not to a "review fixes"
commit at the end:

```bash
git commit --fixup=<sha of the issue's commit>
# once every fixup is in:
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>
```

### Avoiding autosquash conflicts

Fixups of **different** commits that edit the same lines conflict when they are
folded: count lines (a rule total in the README, a row in `CLAUDE.md`), a shared
fixture both issues appended to, the same registry list. Before the review round
starts:

- Keep each issue's fixture in a file of its own (`fix.md` §2).
- When several commits must edit one count line, have each edit it in its own
  commit, and keep fixups away from that line: a fixup that changes a count is
  split so the count edit lands in the last commit touching the line.
- **Trial autosquash** on a throwaway branch first; resolve or re-cut fixups
  there, never on the batch branch mid-rebase:

```bash
git switch -c trial-autosquash
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>   # conflicts show here
git switch - && git branch -D trial-autosquash
```

## Every commit compiles alone

After the autosquash, build each commit on its own — a bisect that lands on a
commit that does not build is a broken history:

```bash
git rebase --exec '<wrapper> <build command>' <base>
```

The build command comes from preflight (for ktn-linter `make build`, which also
catches stale `BUILD.bazel` files), the wrapper is the host's heavy-work wrapper
when one is named. A commit that fails is fixed in place (`git commit --amend`
during the stopped rebase), then `git rebase --continue`.

Then the full test suite once on the tip.
