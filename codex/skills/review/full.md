# /review --full — commit, open, review, fix, watch, merge on request

`/review --full [<PR#>|<branch>] [--merge]` takes a piece of work from the
working tree to a merged (or closed) pull or merge request: commit and push it,
open the PR/MR when the branch has none, run the full review, deliver the fixes,
then watch the PR — CI, conflicts, every review comment — until it is merged or
closed. Plain `/review` is untouched: same phases, local report, drafts only.

Read this module when `the arguments` carries `--full`. Everything else the review
does (Phases 0–9.5, the verifier, the severity model) is the rest of this skill
and is not restated here.

## What it adds over a commit-review-watch loop

| | |
|---|---|
| Review | the full evidence-bound review, external manifest verifier included, at entry; then an incremental review of each fix commit's delta, patch-ID aware |
| CodeRabbit | reads its coverage of the current head (`probe.py covered`) instead of guessing, honours the capacity hint when opening, and merges through the hooks' merge gate, which relaunches it and waits |
| Conflicts | rebased onto the default branch and pushed with `--force-with-lease`, without asking, on the PR's own branch |
| Trace | a branch named after a `kodflow-workflow:feature` / `kodflow-workflow:fix` issue links the PR to that issue |
| Merge | asked each time, or done on `--merge` / an explicit instruction — head pinned, through the gate |

## Who does what

The main thread reads, reviews, posts, waits and merges. It never writes code
and never commits: the hooks' delegation gate refuses that, and this mode does
not work around it.

| Action | By |
|---|---|
| Forge reads, the review phases, comments, replies, resolving threads, the merge | main thread |
| Commit, push, open the PR/MR, fix batches, rebase | a subagent that can deliver (`../_shared/specialists.md` « Who delivers a change »), routed by `route-agent.sh` as in Phase 6, in its own worktree |
| Merge | main thread only — a subagent's merge is refused by the hooks |

A fix subagent works in a worktree cut from the PR's head
(`git worktree add --detach <path> origin/<branch>`, since the user's checkout
may hold the branch), commits one batch and pushes `HEAD:<branch>`. Its brief
carries the findings of the batch (patch-IDs, `file:line`, expected fix), the
conventional commit subject, and: never merge, never push to the default branch,
`--force-with-lease` only after a rebase.

## 1. Preconditions

- **Target.** A PR/MR number → that PR/MR. A branch → its open PR/MR, or none
  yet. Nothing → the current branch. `--full` with `--file`, `--staged` or a
  path is refused: there is nothing to open or watch.
- **Default branch.** Read it (`git symbolic-ref refs/remotes/origin/HEAD`, or
  the forge's repository record); never assume `main`. On the default branch,
  cut a conventional branch first — `<kind>/<slug>`, `<kind>` the conventional
  type of the change — and never commit there.
- **Issue trace.** A branch shaped `<kind>/<iid>-<slug>` (`../_shared/tracker.md`
  §4, what `kodflow-workflow:feature` and `kodflow-workflow:fix` cut) is linked:
  `Closes #<iid>` in the PR/MR body when the change completes the issue,
  `Refs #<iid>` otherwise.
- **Forge.** GitHub PRs and GitLab MRs both. the GitHub tool / the GitLab tool
  first; `gh` / `glab` only for what the MCP lacks (resolving a review thread,
  a job's failed log), and say which.
- **Third-party PR** (its author is not the authenticated account): no push to
  its branch and no rebase without asking, fixes posted as review suggestions,
  and never an automatic merge — `--merge` does not cover it.
- **CodeRabbit probe.** The hooks ship the one reader of CodeRabbit's state;
  this mode calls it and re-implements none of it:

  ```bash
  PROBE=$(ls -d ~/.claude/plugins/cache/*/kodflow-hooks/*/hooks/coderabbit/probe.py 2>/dev/null | tail -1)
  ```

  No kodflow-hooks installed: say CodeRabbit is not tracked and carry on
  without it (GitLab: the probe reads GitHub only, coverage is `unknown`).

## 2. Commit, push, open

- **Uncommitted work** in the checkout is already written: the main thread cuts
  the branch (`git switch -c` keeps the tree), then a delivering subagent commits
  and pushes from that checkout — the one case where it is briefed to work in
  the checkout it is given, because moving the work would mean a stash nobody
  asked for. One conventional commit per coherent change, a body in general
  terms.
- **Open the PR/MR** when the branch has none, from that subagent. Before it,
  `python3 "$PROBE" capacity --action pr_create --cwd <checkout>`: when
  CodeRabbit is rate limited, open as a **draft** and say so in the round
  report; mark it ready once the probe says the quota is back. Title
  conventional, body: what and why, the issue link, the test evidence.
- Nothing to commit and a PR/MR open: skip to 3.

## 3. Review at entry, then per fix

1. **Entry:** Phases 0–9.5 on the PR/MR, verifier included. A run the verifier
   invalidates is not a review: fix the run, do not post it.
2. **Post** the Confirmed and Needs-Verification findings as **one review** of
   inline comments on their `file:line` (GitHub: a pending review, its
   comments, then submit with event `COMMENT`; GitLab: one discussion per
   finding). Each comment carries its patch-ID. Nitpicks stay in the local
   report. Never `APPROVE` nor `REQUEST_CHANGES`.
3. **Fix** every actionable finding through subagents (above), grouped by
   language, one commit per batch.
4. **Incremental review** of each fix commit's delta (`<last reviewed head>..<new
   head>`): Phases 0–8 on that range, verifier included. Patch-ID tracking
   (Phase 9.5) applies: a resolved item is never re-reported, a new one gets a
   new ID. A fixed finding gets the reply `Fixed in <sha>` and its thread is
   resolved.
5. Commits pushed by someone else enter the same delta review.

## 4. Watch until merged or closed

Each round reads, acts, reports, then waits.

**Read** — every round, nothing skipped:

- PR/MR state: merged or closed ends the mode (report, step 6).
- Head sha, mergeability, every CI check by name: success, pending, failed,
  skipped (a skipped check is named, never counted green).
- Every review comment and thread, human or bot, since the last round.
- CodeRabbit on the head: `python3 "$PROBE" covered --repo OWNER/NAME --pr N`
  (add `--policy-dir "$KODFLOW_CODERABBIT_POLICY_DIR"` when it is set) →
  `{head, last_reviewed, eligible, covered}`. Never inferred from a review's
  `commit_id` nor from silence.

**Act** — in this order:

1. **Conflict** → a subagent rebases the branch onto the default branch and
   pushes `--force-with-lease`, without asking (own PR only).
2. **Red check** → read its log, find the cause, fix it on the branch through a
   subagent. A failure that does not come from the branch (runner, flaky
   infrastructure) is re-run once and named as such, never silenced.
3. **Each unanswered comment** → fixed (reply `Fixed in <sha>`, thread
   resolved) or answered with the reason, citing code. A human question gets an
   answer. Only threads it fixed are resolved; a disagreement stays open for
   its author.
4. **New commits** → incremental review (3.4).

**Report** — one block per round, so the run can be resumed by anyone:

```
PR #<n> · head <sha7> · checks <green>/<total> (<pending> pending, <failed> failed)
threads <open> open · CodeRabbit covered=<x> eligible=<y> · verdict <v>
pending: <what the next round waits for>
```

**Wait** — never a tight poll:

- CI running: `gh run watch <id> --exit-status` (or `glab ci status --live`)
  in the background, followed with Monitor; or ScheduleWakeup with a delay
  matched to the CI's recent run durations.
- Waiting on reviewers or CodeRabbit: a wake-up in minutes (the delay the
  capacity probe announces when it is rate limited), never under one minute.
- Resumable: `/review --full <PR#>` picks up from the PR itself — the
  `Fixed in <sha>` replies and patch-IDs in the posted comments tell what is
  resolved.

**Ready to merge** when all hold: every check read and green (none pending,
none failed), mergeable, no thread left unanswered, no CRITICAL/HIGH open in
Confirmed or Needs-Verification, verdict not INCONCLUSIVE, the last verifier
run green.

## 5. Merge

- **Ask** each time with AskUserQuestion: the recommended option first —
  « Merge now (recommended) » — then « Keep watching », « Stop here, leave it
  open ». **Unless** the user's prompt says otherwise: `--merge`, or an explicit
  instruction to merge (« and merge it », « merge when green ») — then merge
  without asking.
- **Always ask**, flag or instruction notwithstanding: a third-party PR, and a
  merge that deploys to production (a workflow on the default branch targeting
  a production environment, or the project's CLAUDE.md saying so) — a
  production deployment keeps its explicit go.
- **How:** the main thread, head pinned — the GitHub tool with
  `expectedHeadSha`, or `gh pr merge <n> --match-head-commit <sha>`; GitLab
  the GitLab tool with `sha`. The method is the one the
  repository allows. Never `--admin` unless the user says so.
- **The CodeRabbit merge gate** (kodflow-hooks) runs on that call. A denial
  naming a time is a wait, not a failure: wake at that time and retry with the
  same pin. A moved head sends the run back to step 4.

## 6. Final report

Short, once merged, closed or stopped:

```
PR #<n> <merged|closed|open> · head <sha7>
checks <green>/<total> · threads resolved <r>, answered <a>, open <o>
review verdict <v> · findings fixed <f>, open <k> · CodeRabbit covered=<x>
```

Then remove the worktrees this run created.

## Guardrails

| Action | Status |
|---|---|
| Commit on the default branch | FORBIDDEN (cut a branch) |
| Main thread writing code or committing | FORBIDDEN (subagents, delegation gate) |
| Merge without the user's go, `--merge` or an explicit instruction | FORBIDDEN |
| Merge a third-party PR, or deploy to production, without asking | FORBIDDEN |
| Merge unpinned, or from a subagent | FORBIDDEN |
| A forced push other than `--force-with-lease` on the PR's own branch | FORBIDDEN |
| Count a pending or skipped check as green | FORBIDDEN |
| Leave a review comment unanswered | FORBIDDEN |
| Resolve a thread it did not fix | FORBIDDEN |
| Guess CodeRabbit's coverage | FORBIDDEN (`probe.py covered`) |
| Poll in a tight loop | FORBIDDEN |
| Mention AI, or attribute to it, in anything posted, committed or titled | ABSOLUTE FORBIDDEN |
