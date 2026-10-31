# The trail PR — how the owner's feedback and the panel's evidence reach the repository

`/move`, `/anim-review` and `/anim-feedback` write their files straight into
the project's working tree, by the main thread: feedback ADRs in
`docs/adr/feedback/`, specs, constraints, cached sources and run records in
`docs/anim/`. That is what makes a verdict a rule at once (the next agent's
`RULES digest` reads it). It also leaves them untracked, and an untracked
file is lost the day the checkout is cleaned.

So each of those skills ends by handing the files to **one permanent pull
request**, on the branch `chore/anim-trail`, through a subagent. The main
thread never commits.

## Dispatch

One `Agent` call, `subagent_type: "general-purpose"`, model `sonnet`, with
this brief (fill the brackets):

```
Persist the animation trail of <project root> into its permanent PR. Do not
merge. Work only in a git worktree of your own.

1. List the files to carry, from the main checkout, without changing it:
   git -C <root> ls-files --others --exclude-standard -- docs/adr/feedback docs/anim
   plus the ones modified there (git -C <root> diff --name-only -- docs/anim).
   Never carry docs/adr/feedback/.RULES.md, a .tmp-* file, or anything else.
   Nothing listed: report "trail: nothing to carry" and stop.
2. git -C <root> fetch origin. If origin has chore/anim-trail, add a worktree
   on it; otherwise create it from the default branch (read it:
   git -C <root> symbolic-ref --short refs/remotes/origin/HEAD).
   Worktree path: <repo parent>/.worktrees/<repo>-anim-trail.
3. Copy the listed files into the worktree at the same paths. A feedback
   ADR that already exists there with other bytes is a conflict: stop and
   report it, never overwrite (ADRs are written once).
4. Commit with a conventional message, "docs(anim): <n> feedback ADR(s),
   <m> run(s), <k> source(s)", the project's commit identity, no AI
   attribution. Push with --force-with-lease only.
5. Open the PR "docs(anim): animation trail" if none is open for
   chore/anim-trail (GitHub MCP first, gh otherwise); else it is updated by
   the push. Body: the list of ADR rules added, one line each.
6. Report: PR URL, files carried, anything refused.
```

## Why one PR

ADRs are created once under unique names and never edited, so the trail
branch only ever gains files: it rebases on anything, conflicts only on a
genuine double write, and the owner merges it when they like. A PR per run
would bury the owner in reviews of files nobody edits.

The digest's `pending: <n>` line counts the ADRs not yet on the branch the
agent runs on; it falls to zero once the trail PR is merged.
