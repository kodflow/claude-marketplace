---
name: feature
description: Open a piece of feature work and keep its trail. Records the feature where the
  project actually tracks work — a note store when one is grafted onto the session, otherwise
  a GitLab or GitHub issue — then cuts a branch named after the issue so forges and external
  trackers link the two automatically. Run it again on the same subject and it appends the
  new exchange as a comment instead of duplicating anything, so the original understanding
  and every refinement since stay readable side by side.
when_to_use: Use when starting work on something the project does not do yet, and again each
  time the discussion sharpens what that thing is. For a defect in existing behaviour use
  /fix instead.
argument-hint: <what the feature is> [--no-branch] [--local] [--status]
model: opus
allowed-tools:
- Bash(git:*)
- Bash(gh:*)
- Bash(glab:*)
- Bash(curl:*)
- Bash(jq:*)
- Bash(bash:*)
- Bash(python3:*)
- Bash(date:*)
- Bash(mkdir:*)
- Bash(ls:*)
- Read(**/*)
- Glob(**/*)
- Grep(**/*)
- Write(.claude/issues/*.md)
- Edit(.claude/issues/*.md)
- mcp__github__*
- mcp__gitlab__*
- AskUserQuestion
- Skill(*)
- Agent(*)
- mcp__context7__*
- WebFetch(*)
---

# /feature — open feature work, keep the trail

$ARGUMENTS

Two things must be true when this finishes: the feature is written down where
the project tracks work, and there is a branch whose name links it to that
record. Everything else is in service of those two.

Read `../_shared/tracker.md` before acting — it owns destination resolution, the
ledger format, the comment protocol and the branch rules, and `/fix` follows the
same ones.

---

## Arguments

| Pattern | Action |
|---------|--------|
| `<description>` | Open (or extend) the feature and cut its branch |
| `--no-branch` | Record it, do not touch git |
| `--local` | Force a local draft; do not contact any forge |
| `--status` | Show what is tracked for the current branch or subject, change nothing |
| `--help` | Print the help block and stop |

## --help

```
════════════════════════════════════════════════════════════════
  /feature — open feature work, keep the trail
════════════════════════════════════════════════════════════════

Usage: /feature <what the feature is> [options]

  --no-branch   record only, no git
  --local       local draft, never contact a forge
  --status      show what is tracked, change nothing
  --help        this help

Destination, first that answers:
  note store (the note store) → GitLab issue → GitHub issue → .claude/issues/

Re-running on the same subject appends a comment. It never rewrites
the original body — that record is the point.

Chain:  /feature → /search → /challenge → /goal → /git
════════════════════════════════════════════════════════════════
```

**If `$ARGUMENTS` contains `--help`:** print it and STOP.

---

## Phases

### 0 — Locate

```bash
bash "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}"/skills/_shared/scripts/detect-tracker.sh
```

Resolve the destination per `../_shared/tracker.md` §1, and check whether this
subject is already tracked per §3 — `BRANCH_ISSUE`, then the ledger, then an
open-issue search on the forge. **Always search before creating.**

Found → this is a re-run, go to phase 4. Not found → phase 1.

### 1 — Make the feature describable

A feature nobody can test is not a feature, it is a wish. Before writing
anything, the description must carry:

| | |
|---|---|
| **What** | the capability, in one sentence, from the user's side |
| **Why** | the problem it solves — not "because it would be nice" |
| **Acceptance** | how someone else confirms it works, as checkable statements |
| **Out of scope** | what this deliberately does not cover |

If the argument gives you all four, use it. If it does not, **ask once** with
`AskUserQuestion` for the missing pieces — one question, options drawn from what
the codebase suggests, plus free text. Do not interrogate; one round, then work
with what you have and record the gaps under *Still open*.

Ambition check, once, briefly: if the feature as described cannot be verified,
say so and propose the smallest version that can. Then follow the user's call.

### 1.5 — Have the specialists check it

**Mandatory whenever the feature touches a technology with an installed
specialist.** Route with `../_shared/specialists.md` and dispatch every match in
one message.

The brief:

```
A feature is about to be opened. Judge it in <your technology>, not in general.

<what / why / acceptance / out of scope, verbatim>
<the files or packages it will touch>

Answer three things:
1. Does the platform already provide this? Name the API, flag or built-in if so
   — the cheapest feature is the one already written.
2. Are the acceptance criteria checkable in this technology? A criterion nobody
   can write a test for is the defect to catch now, not after implementation.
3. What will bite? The version constraint, the footgun, the thing that looks
   fine and is not.

Return `consulted` (documentation you actually checked) and `unverified`
(anything you could not confirm). A claim about this technology with an empty
`consulted` list is a memory claim — mark it.
```

What comes back changes the issue before it is published:

- **already provided** → say so and ask whether to continue. Opening work the
  platform already does is the most expensive mistake available here, and it is
  the cheapest to catch.
- **an uncheckable criterion** → rewrite it until it is checkable, or record it
  explicitly as a gap.
- **a version constraint** → into the body, with the source that says so.

Feature is prose, no technology named, no match: say so and continue. Do not
manufacture a match to have someone to ask.

### 2 — Show it before publishing

Print the exact title and body. Publishing is outward-facing and the body is what
a colleague reads first.

```
⏸  Open a feature on <destination>
   Title  : <title>
   Labels : <labels or "none">
   Body   : <N> lines

   <the body, in full when under 40 lines, else the first 20 and a count>

   [1] open it   [2] show me the exact payload   [3] cancel
```

Nothing is created before an explicit yes.

### 3 — Create

Note store and/or issue per `../_shared/tracker.md` §1. Then write the ledger at
`.claude/issues/<slug>.md` with the frontmatter from §2 and a first
`### <date> — opened` section.

Report the issue number and URL. If a note was written, report its id too — and
only if a tool call actually returned one.

### 4 — Extend (re-run)

The subject already exists. Nothing is rewritten.

1. Read the ledger and the issue body — what was already understood.
2. Determine what this run adds: a sharpened requirement, a decision, a scope
   change, an answered question.
3. **Nothing new?** Say so and stop. A comment that restates the issue is noise
   in the trail you are trying to keep readable.
4. Post it as a comment (§3 shape) and append a dated ledger section.

### 5 — Branch

Per `../_shared/tracker.md` §4: `feature/<iid>-<slug>` from the default branch.
Refuse over a dirty tree. Skip entirely under `--no-branch`.

### 6 — Hand off

```
/feature → /search <the unknowns>   research what the ledger cannot answer
         → /challenge               debate the plan, lock it into a /goal prompt
         → /goal                    execute
         → /git --commit            land it
```

Name the *Still open* items as the argument for `/search`. That is what they are
for.

---

## Guardrails

Everything in `../_shared/tracker.md` §5, plus:

| Action | Status |
|--------|--------|
| Open a feature with no acceptance criteria | **FORBIDDEN** — ask, or record the gap explicitly |
| Start implementing | **FORBIDDEN** — this skill opens work, it does not do it |
| Post a comment that adds nothing | **FORBIDDEN** — say "nothing new" |
| Ask more than one round of questions | **FORBIDDEN** — one round, then proceed and record gaps |
| Publish without consulting the specialists the technology matched | **FORBIDDEN** |
| Accept a technology claim with an empty `consulted` list | **FORBIDDEN** — it is memory, not evidence |
| Guess a note-store tool name | **FORBIDDEN** — absent means fall through to the forge |
