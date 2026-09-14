# Review threads — how a PR/MR/change stops being blocked

Read by `--watch` (Phase 4.5) and `--merge` (Phase 4.0). Two rules and the
commands that implement them on each platform. The point of the commands is
autonomy: a review that is answered in prose but never resolved on the
platform blocks the merge exactly as an unanswered one does.

## Rule 1 — the description describes the head

A PR body written at creation describes the commits that existed then. Every
push after it makes the body wrong, and reviewers (human or bot) read the body
first. So the body carries the SHA it describes, and any workflow that reaches
the PR compares it:

```
<!-- describes: <head sha> -->      ← last line of every body /git writes
```

```bash
HEAD=$(git rev-parse HEAD)
DESCRIBED=$(gh pr view "$PR" --json body -q .body | sed -n 's/.*<!-- describes: \([0-9a-f]*\) -->.*/\1/p')
[ "$HEAD" = "$DESCRIBED" ] || regenerate the body   # then: gh pr edit "$PR" --body-file body.md
```

Regenerate means: re-read the full commit list (`git log --reverse base..HEAD`)
and the diff summary (`git diff --stat base...HEAD`), rewrite *What / Why /
How to verify*, keep the template, stamp the new SHA. GitLab: `glab mr update
--description-file`, or the GitLab tool `update_merge_request`. Gerrit has no
body: the commit message *is* the description, amend it and push a new
patchset.

## Rule 2 — every bot finding ends as fixed or refuted, on the platform

The legitimacy filter in `watch.md` decides *fix* or *reject*. This file is
what happens next. Both outcomes end with the thread resolved; the difference
is whether a commit precedes it.

| Outcome | Action, in order |
|---------|------------------|
| **Legitimate** | fix → commit (conventional, no attribution) → push → reply on the thread with the commit SHA → resolve the thread |
| **Illegitimate** | reply on the thread with the *reason and the evidence* (a file:line, a doc link, a CLAUDE.md rule, a measurement) → resolve the thread |
| **Unclear** | a multiple-choice question to the user; never resolve on the user's behalf |
| **Human comment** | never resolved by the workflow; flagged to the user |

A refutation without evidence is a dismissal, and CodeRabbit re-raises
dismissed findings on the next push. "Not applicable" is not a reason;
"`vendor/` is excluded in `.gitignore:12`, the rule cannot fire there" is.

### GitHub

Inline findings are *review comments* grouped in *review threads*. The REST
API replies; only GraphQL resolves.

```bash
# every unresolved thread, with the first comment's id, path, line and author
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved isOutdated comments(first:1){nodes{databaseId path line author{login} body}}}}}}}' \
  -f o=ORG -f r=REPO -F n=$PR --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved|not)'

# reply to a finding (databaseId of the thread's first comment)
gh api "repos/ORG/REPO/pulls/$PR/comments/$COMMENT_ID/replies" -f body="Fixed in abc1234: …"
gh api "repos/ORG/REPO/pulls/$PR/comments/$COMMENT_ID/replies" -f body="Not applied: … (evidence: …)"

# resolve the thread (GraphQL node id from the query above)
gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id="$THREAD_ID"

# a CHANGES_REQUESTED review that is now stale blocks the merge until dismissed
gh api "repos/ORG/REPO/pulls/$PR/reviews" --jq '.[]|select(.state=="CHANGES_REQUESTED")|.id'
gh api -X PUT "repos/ORG/REPO/pulls/$PR/reviews/$REVIEW_ID/dismissals" -f message="All findings fixed or answered in-thread; see commits since $SHA."
```

The GitHub tool (the GitHub tool) is preferred where it covers the call:
`pull_request_read(get_review_comments)` lists threads with `isResolved`,
`add_reply_to_pull_request_comment` replies, `update_pull_request` edits the
body. Resolving and dismissing have no MCP equivalent: use `gh api`.

**Bot commands**, posted as PR comments:

| Bot | Re-run | Resolve everything it raised | Notes |
|-----|--------|------------------------------|-------|
| CodeRabbit | `@coderabbitai review` (incremental) · `@coderabbitai full review` | `@coderabbitai resolve` | only after the fixes are pushed; it re-reviews every push anyway |
| Qodo | `/review` · `/improve` | none — findings live in one comment that the next `/review` rewrites | P0/P1 are addressed, P2 may be answered in a reply to the summary comment |
| Codacy | re-runs on push | resolves on push | a finding that stays is a real one or a rule to disable in `.codacy.yml` |

Order matters: **fix → push → wait for the re-review → then resolve what is
left**. Resolving before the re-review hides findings the bot will reopen.

### GitLab

Threads are *discussions*; a resolvable discussion blocks the merge when
*All threads must be resolved* is on (it is, on every kodflow project).

```bash
glab mr view "$MR" --comments                      # or mcp__gitlab__list_merge_request_discussions
# reply inside the discussion, then resolve it
mcp__gitlab__create_merge_request_discussion_note   (discussion_id, body)
mcp__gitlab__resolve_merge_request_thread           (discussion_id, resolved: true)
# CLI equivalents
glab api -X POST "projects/:id/merge_requests/$MR/discussions/$DISC/notes" -f body="…"
glab api -X PUT  "projects/:id/merge_requests/$MR/discussions/$DISC" -f resolved=true
# body refresh
glab mr update "$MR" --description-file body.md
```

Approval is a separate gate: the GitLab tool only when the
project's rules allow the author's session to approve; otherwise the review
ends with the threads resolved and the pipeline green, and a human approves.

### Gerrit

No PR object: one *change*, successive *patchsets*, votes on labels. Comments
are *unresolved* until a reply marks them resolved; a change with unresolved
comments cannot be submitted when the project enforces it.

```bash
# push a new patchset (fixes) — the Change-Id footer keeps it on the same change
git commit --amend --no-edit && git push origin HEAD:refs/for/main
# list unresolved comments on the current revision
curl -s -u "$GERRIT_USER:$GERRIT_HTTP_PASSWORD" "$GERRIT/a/changes/$CHANGE/revisions/current/comments" | tail -n +2 \
  | jq 'to_entries[] | .value[] | select(.unresolved==true) | {id, path, line, message}'
# reply and resolve in one review call; votes go in the same body
curl -s -u "$GERRIT_USER:$GERRIT_HTTP_PASSWORD" -H 'Content-Type: application/json' \
  -X POST "$GERRIT/a/changes/$CHANGE/revisions/current/review" \
  -d '{"comments":{"src/x.go":[{"line":42,"in_reply_to":"<comment id>","unresolved":false,"message":"Fixed in patchset 3."}]},"labels":{"Verified":1}}'
# submit once Code-Review+2 (human) and Verified+1 are present
curl -s -u "$GERRIT_USER:$GERRIT_HTTP_PASSWORD" -X POST "$GERRIT/a/changes/$CHANGE/submit"
```

Codex-Review+2 is never self-granted: the session pushes patchsets, answers and
resolves comments, sets `Verified` when CI is green, and stops.

## Exit condition, all platforms

The workflow is done with reviews when **all** of these hold, and reports
which one fails otherwise:

1. no unresolved bot thread whose finding is legitimate and unfixed;
2. every resolved thread carries a reply (fix SHA or refutation with evidence);
3. no stale `CHANGES_REQUESTED` review (GitHub) / unresolved discussion
   (GitLab) / unresolved comment (Gerrit);
4. the body (or commit message) describes the current head;
5. the re-review after the last push raised nothing new.

Three passes through *fix → push → re-review* without reaching that state
means the finding is not mechanical: stop and hand the remaining threads to
the user with the reasons tried.
