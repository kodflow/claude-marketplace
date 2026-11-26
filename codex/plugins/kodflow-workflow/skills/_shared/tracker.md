# Work tracking — destination, ledger, and the comment protocol

Shared by `/feature`, `/fix` and `/search`, and by `/hunt` through §6. It answers three questions once, so
the three skills cannot disagree about where a piece of work lives. §7 is read
by every skill or agent that publishes on a forge — `/review` answering review
threads included.

---

## 1. Where the work is recorded

Run the detector first. It is the only source of truth for paths and forge:

```bash
bash "${CODEX_HOME:-$HOME/.codex}/plugins/cache/kodflow/kodflow-workflow/0.0.0-rf46a6f232438"/skills/_shared/scripts/detect-tracker.sh
```

Then resolve the destination in this order. **Stop at the first that answers.**

| # | Destination | How you know it is available |
|---|-------------|------------------------------|
| 1 | **Note store (the note store)** | A note/knowledge MCP is present in *your own tool list* — look for `mcp__<note-store>__*`, or any MCP server exposing note create/append/search. The detector cannot see MCP servers and reports `NOTE_STORE=UNKNOWN`; resolving it is your job. |
| 2 | **GitLab issue** | `FORGE=gitlab` |
| 3 | **GitHub issue** | `FORGE=github` |
| 4 | **Local draft** | `FORGE=none/unknown` — no remote, or a forge nobody here can reach |

The note store wins when present because it is the only destination that
survives the repository being renamed, moved, or mirrored. When it is present
**and** the repo has a forge, write to both: the note carries the full exchange,
the issue carries the summary and the link. Say which destinations you used.

**Never invent a note-store tool name.** If nothing in your tool list matches,
the note store is absent — go to 2. Announcing "saved to the note store" without a tool
call that succeeded is the one failure this whole file exists to prevent.

### GitLab: read-only MCP is normal

Some GitLab MCP deployments run with `GITLAB_READ_ONLY_MODE=true` and expose no
write tool at all. Check for the GitLab tool in your tool list before
planning to use it. When it is absent, publish over the API:

```bash
curl -sS -X POST \
  --header "PRIVATE-TOKEN: $GITLAB_PERSONAL_ACCESS_TOKEN" \
  --data-urlencode "title=$TITLE" \
  --data-urlencode "description=$DESCRIPTION" \
  --data-urlencode "labels=$LABELS" \
  "$GITLAB_API_URL/projects/$PROJECT_ENC/issues"
```

- `PROJECT_ENC` comes from the detector and **keeps every subgroup**. A greedy
  path regex turns `acme/products/messaging/service` into `messaging/service`, which
  404s on every project that lives in a subgroup.
- The token travels only in the `PRIVATE-TOKEN` header. Never in a URL, never
  echoed, never in a `--data` field.
- If the token is not in the environment, read it from the `gitlab` MCP server's
  own `env` block in `~/.claude.json` by command substitution — same credential,
  same place — without printing it.
- On a certificate error, retry with `--cacert "$NODE_EXTRA_CA_CERTS"` when that
  variable is set.
- A `4xx` is final: show the response body (it names the reason) and stop. A
  connection error is not final: say so and offer to retry.

### GitHub

Prefer the GitHub tool; fall back to `gh issue create`.

---

## 2. The local ledger

Every tracked subject gets one file, whatever the destination:

```
<repo>/.claude/issues/<slug>.md
```

It is the join between a branch, an issue, and the conversation that produced
them. Without it, a re-run cannot find what it is re-running on.

```markdown
---
slug: oauth2-device-flow
kind: feature            # or fix
title: Device flow for the CLI login
destination: gitlab      # note | gitlab | github | local
issue_iid: 412
issue_url: https://gitlab.example.com/acme/.../issues/412
note_id: note:<id>   # when a note store was used
branch: feature/412-oauth2-device-flow
opened: 2026-09-08
---

## Exchange log

### 2026-09-08 — opened
<the description as first agreed>

### 2026-09-08 — refined
<what changed, and why>
```

**Append-only.** A re-run adds a dated section; it never rewrites an earlier one.
The value is the trail, and a trail you edit is not a trail.

Commit this file. It is shared project knowledge, unlike `.claude/goals/`.

---

## 3. Re-running on the same subject

A second `/feature` or `/fix` on a subject already tracked must **extend**, never
duplicate. Resolve the existing subject in this order:

1. `BRANCH_ISSUE` from the detector — the current branch is already named for an
   issue, so that is the subject.
2. A ledger file under `.claude/issues/` whose slug or title matches the new
   argument.
3. An open issue on the forge whose title matches closely — search before
   creating. **Always search.** A duplicate issue is the most common and most
   annoying failure of a skill like this.

When a subject is found:

- **The issue body is never rewritten.** It is the record of the original
  understanding, and overwriting it destroys exactly what makes the trail useful.
- The new exchange becomes **a comment** on the issue, and a dated section in the
  ledger.
- Only if the user explicitly asks to correct the original — "the description is
  wrong" — do you edit the body, and then you first post a comment quoting what
  it said before.

Comment shape:

```markdown
**Refined 2026-09-08**

<what is now understood that was not before>

**Changes to scope:** <added / removed / unchanged>
**Still open:** <questions that remain, or "none">
```

---

## 4. The branch

Created immediately after the issue exists, from the default branch, named so
that forges and external trackers link it automatically:

```bash
git fetch origin --quiet
git switch -c "<kind>/<iid>-<slug>" "origin/$DEFAULT_BRANCH"
```

- `<kind>` is `feature` or `fix`.
- `<iid>` is the issue number. GitLab links a branch to an issue when the number
  leads the branch name; GitHub and Jira-style tools key off the same shape.
- `<slug>` is the title, lowercased, non-alphanumerics collapsed to `-`, trimmed
  to ~40 characters.

Preconditions, checked before switching:

| Condition | Action |
|-----------|--------|
| `DIRTY > 0` | **Stop.** Report the uncommitted files. Never stash or discard someone's work to make room for a branch. |
| Branch already exists | Switch to it, say so. Do not recreate. |
| `CURRENT_BRANCH=DETACHED` | Stop and report. |
| No issue number (local draft destination) | Use `<kind>/<slug>` with no number, and say the branch is not linked to any tracker. |

---

## 5. Guardrails

| Action | Status |
|--------|--------|
| Claim a note store was written without a successful tool call | **FORBIDDEN** |
| Create a second issue for a subject that already has one | **FORBIDDEN** — search first |
| Rewrite an issue body on a re-run | **FORBIDDEN** — comment instead |
| Rewrite or delete an earlier ledger section | **FORBIDDEN** — append |
| Print, echo or log a token | **FORBIDDEN** |
| Build a GitLab project path with a greedy regex | **FORBIDDEN** — subgroups vanish |
| Create a branch over a dirty tree | **FORBIDDEN** |
| Open an issue without showing the user the title and body first | **FORBIDDEN** |
| Retry a comment POST, or post several comments one by one | **FORBIDDEN** — §7 |

---

## 6. Exception — `/hunt`

`/hunt` opens issues in batches, unattended, for hours. Showing each one
before publishing (§5, last row) would stop the hunt at every finding, so the
preview is replaced — not removed — by **one approval at launch**:

- the user approves the hunt's `scope.json` once; the approval screen states
  that issues will be opened without a per-issue preview, on which
  repositories, with which label (`hunt:<slug>`) and up to which cap;
- that approval covers every issue `/hunt` opens for that slug, and nothing
  else — not another slug, not an issue opened by any other skill;
- every other rule of §5 still applies to `/hunt`: search before creating
  (a duplicate becomes a comment), never rewrite a body, never print a token.

§5 itself is unchanged: for `/feature`, `/fix` and `/search`, an issue is never
opened without showing its title and body first.

`/hunt` reaches the forge only through its `hunt-forge` script. For GitLab and
Forgejo the scope names the **variable** that holds the token, never the token,
one variable per forge: `GITLAB_PERSONAL_ACCESS_TOKEN` for GitLab (the same as
§1), `FORGEJO_TOKEN` for Forgejo; GitHub goes through `gh`. The token reaches
`curl` through `-K` from a process substitution, never in argv.

---

## 7. Publishing on a forge — drafts, one publish, verified

Every comment notifies a human. Replying to review threads, or posting several
comments on one pull or merge request, goes through drafts and **one** publish,
so the reviewer gets one notification instead of one per comment, and no answer
lands twice.

1. **Draft every answer.** GitLab: one draft note per thread
   (the GitLab tool with `in_reply_to_discussion_id`, or
   `POST …/merge_requests/:iid/draft_notes`). GitHub: one pending review — the
   review tool with `method: create` and no `event` — then each line comment
   added to it; a reply to an existing thread joins the same pending review
   through the GraphQL mutation `addPullRequestReviewThreadReply` given the
   pending review's `pullRequestReviewId` (the REST `…/comments/<id>/replies`
   endpoint publishes at once, so it is not used here).
2. **List the drafts** (the GitLab tool, or the pending review's
   comments) and check there is exactly one per thread to answer: a missing one
   is drafted, a duplicate deleted, before anything is published.
3. **Publish in one call.** GitLab: the GitLab tool
   (`POST …/draft_notes/bulk_publish`). GitHub: submit the pending review
   (`method: submit_pending`, event `COMMENT`).
4. **Verify.** After publishing, count the comments of each thread by the
   author since the run started: one new answer per thread. Only then say
   « posted ».

A single comment (an issue comment of §3) skips the drafts, not the rest: it is
sent once and verified.

**No retry loop on a POST.** A write that fails or times out may still have
landed. Before any new attempt, re-read the state — the drafts, or the notes of
the thread — and match on author, creation time after the run started, and the
**full** body. Never decide « already posted » on a prefix, and never compare a
prefix cut in bytes to one cut in characters: on any non-ASCII text they differ,
the check never matches, and the loop posts again. When the state cannot be
read, stop and report; do not post blind.

Same rule for every send that notifies a human — a review, a mention, a
re-request of review, an issue: it goes out once, and its effect is read back
before it is announced.
