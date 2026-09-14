---
name: project
description: >-
  Open or create the workspace for a coding project, then turn the conversation
  into enforceable constraints. Detects whether the current directory is already
  a git work tree; if not, finds where this user keeps their code (localized
  Documents, ~/Projects, %USERPROFILE%\Documents, ...) and adopts, clones, or
  creates the GitHub repository. Every decision, preference and idea exchanged
  afterwards is recorded as a numbered, verifiable constraint in the project's
  CLAUDE.md so later sessions inherit them instead of re-deriving them.
when_to_use: >-
  Use at the very start of work on a project — "let's work on X", "start a new
  project", "clone X and set it up" — and again whenever a discussion settles a
  rule the project must follow from now on.
argument-hint: "[name] | --constraint \"<rule>\" | --sync | --status | --owner <org>"
model: opus
allowed-tools:
  - "Bash(git:*)"
  - "Bash(gh:*)"
  - "Bash(bash:*)"
  - "Bash(uname:*)"
  - "Bash(ls:*)"
  - "Bash(mkdir:*)"
  - "Bash(cat:*)"
  - "Bash(sed:*)"
  - "Bash(grep:*)"
  - "Bash(wc:*)"
  - "Bash(date:*)"
  - "Bash(command:*)"
  - "Bash(xdg-user-dir:*)"
  - "Read(**/*)"
  - "Glob(**/*)"
  - "Grep(**/*)"
  - "Write(CLAUDE.md)"
  - "Write(.claude/**)"
  - "Write(.gitignore)"
  - "Write(README.md)"
  - "Edit(CLAUDE.md)"
  - "Edit(.claude/**)"
  - "mcp__github__*"
  - "AskUserQuestion"
  - "Skill(*)"
---

# /project — workspace resolution + constraint ledger

$ARGUMENTS

Two jobs, always in this order:

1. **Put the session in the right directory** — an existing checkout, a fresh
   clone, or a brand-new GitHub repository.
2. **Make the conversation durable** — every rule agreed in chat becomes a
   numbered constraint with a verifier in the project's `CLAUDE.md`.

Job 2 is the point. A constraint that only exists in this conversation is lost
at the next `/clear`; a constraint in `CLAUDE.md` is re-read by every future
session and by `/warmup`, `/plan`, `/refine` and `/review`.

---

## Arguments

| Pattern | Action |
|---------|--------|
| *(none)* | Resolve the workspace, then capture constraints from this conversation |
| `<name>` | Skip the name question; use `<name>` as the project/repository name |
| `--owner <org>` | Force the GitHub owner instead of asking |
| `--private` / `--public` | Force visibility on creation (default: `--private`) |
| `--constraint "<rule>"` | Append ONE constraint to the ledger and stop |
| `--sync` | Re-scan this conversation for un-recorded decisions and append them |
| `--status` | Print the resolved workspace + the constraint ledger, change nothing |
| `--no-github` | Local git only — never create or contact a remote |
| `--help` | Print the help block below and stop |

## --help

```
════════════════════════════════════════════════════════════════
  /project — workspace resolution + constraint ledger
════════════════════════════════════════════════════════════════

Usage: /project [name] [options]

  (none)               Resolve workspace, then capture constraints
  <name>               Use <name>, do not ask
  --owner <org>        GitHub owner (default: asked, or your login)
  --private|--public   Visibility on creation           (default: private)
  --constraint "<r>"   Append one constraint, then stop
  --sync               Harvest un-recorded decisions from this session
  --status             Show workspace + ledger, change nothing
  --no-github          Local git only
  --help               This help

Resolution order:
  in a git work tree ........ ADOPT it
  repo exists on GitHub ..... CLONE it on its default branch
  neither ................... CREATE it, then clone

Constraints live in  CLAUDE.md  (spilling to .claude/constraints.md
past 250 lines, per the /warmup thresholds).

Workflow:
  /project → /warmup → /search → /plan → /refine → /goal → /git
════════════════════════════════════════════════════════════════
```

**If `$ARGUMENTS` contains `--help`:** print the block and STOP.

---

## Phase map

| Phase | What | Module |
|-------|------|--------|
| 0 | Locate: git work tree? where does this user keep code? | `locate.md` |
| 1 | Name + owner + visibility | `github.md` |
| 2 | Resolve: ADOPT \| CLONE \| CREATE \| CONFLICT | `github.md` |
| 3 | Bootstrap the workspace skeleton | `github.md` |
| 4 | Capture constraints from the conversation | `constraints.md` |
| 5 | Pin architecture patterns as constraints | `architecture.md` |
| 6 | Hand off to `/warmup` | this file |

Read a module only when you reach its phase.

---

## Phase 0 — Locate

Run the locator once and keep its output; it answers both questions in one shot
and is the only source of truth for paths.

```bash
bash "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}"/skills/project/scripts/locate-code-home.sh
```

- `IN_REPO=1` → the workspace is `REPO_ROOT`. Go to Phase 2 case **ADOPT**.
- `IN_REPO=0` → the code home is `CODE_HOME`. Go to Phase 1.

`CODE_HOME` is picked by evidence (the candidate holding the most git
repositories), not by hardcoding `~/Documents`. See `locate.md` before
overriding it, and never invent a path the script did not print.

**If `CANDIDATE_COUNT=0`** the user has no recognisable code directory: ask where
projects should live, and create that directory.

## Phase 1 — Name and owner

Needed only when `IN_REPO=0`.

- Name: `$1` if given, else **ask with `AskUserQuestion`** (one question, header
  `Project`, offering the derived candidates plus free text). Never guess a
  project name from the conversation without confirming it.
- Owner and visibility: `github.md`.

## Phase 2 — Resolve the workspace

Exactly one of four outcomes. `github.md` holds the commands and the
preconditions for each.

| Case | Condition | Outcome |
|------|-----------|---------|
| **ADOPT** | `IN_REPO=1`, or `CODE_HOME/<name>` is a checkout of the target | `cd`, fetch, checkout default branch, pull |
| **CLONE** | remote exists, no local copy | clone into `CODE_HOME/<name>` on its default branch |
| **CREATE** | neither exists | `gh repo create`, clone, initial commit on `main` |
| **CONFLICT** | `CODE_HOME/<name>` exists but is not that repo | STOP and ask — never overwrite |

## Phase 3 — Bootstrap

Create only what is missing; never overwrite a file that already exists.

```
<workspace>/
├── CLAUDE.md              # constraint ledger  (Phase 4 fills it)
├── .gitignore             # language-appropriate, + .claude/goals/
└── .claude/
    ├── contexts/          # /search output
    ├── plans/             # /plan output
    └── goals/             # /refine output   (gitignored)
```

## Phase 4 — Capture the constraints

This is the phase that must never be skipped, including on an ADOPT of a mature
repository. Read `constraints.md` and apply it to the whole conversation so far.

The short version: every settled decision becomes

```
### C-007 — Errors carry context
- **Category:** quality
- **Rule:** MUST wrap every returned error with `fmt.Errorf("...: %w", err)`.
- **Verify:** `golangci-lint run --enable=wrapcheck ./...` exits 0
- **Origin:** 2026-09-08 — agreed after the silent-failure incident in worker.go
```

An ID, a MUST/MUST NOT/SHOULD rule, a command that proves it, and where it came
from. A "constraint" with no verifier is a preference — record it as `SHOULD`
and say so, rather than dressing it up as a rule.

## Phase 5 — Architecture patterns as constraints

Read `architecture.md`. Patterns from `~/.claude/docs/` are proposed as
constraints, confirmed by the user, then pinned into the ledger with the doc
path as their reference — so `/plan` and `/review` enforce the same architecture
the project chose, instead of re-litigating it every session.

## Phase 6 — Hand off

Print the resolved workspace, the case taken, and the constraint count, then:

```
/project → /warmup → /search <topic> → /plan → /refine → /goal → /git
```

Invoke `Skill(skill="warmup")` when the workspace was ADOPTed or CLONEd (there
is existing context to load). Skip it on CREATE — an empty repository has
nothing to warm up.

---

## Guardrails (absolute)

| Action | Status | Reason |
|--------|--------|--------|
| Hardcode `~/Documents` instead of reading `CODE_HOME` | **FORBIDDEN** | breaks on macOS/Windows and localized desktops |
| `git init` inside an existing work tree | **FORBIDDEN** | creates a nested repository |
| Overwrite a directory that already holds a different repo | **FORBIDDEN** | data loss; ask instead |
| Create a public repository without being told to | **FORBIDDEN** | default is `--private` |
| `git push --force` on the default branch | **FORBIDDEN** | never during setup |
| Commit `.claude/goals/` or `.env` | **FORBIDDEN** | transient / secret |
| Skip Phase 4 because "nothing was decided" | **FORBIDDEN** | say the ledger is empty; do not skip the phase |
| Invent a constraint the user never agreed to | **FORBIDDEN** | the ledger is a record, not a wish list |
| Rewrite or renumber an existing constraint | **FORBIDDEN** | supersede it (see `constraints.md`) |
| Write a secret, token or PAT into `CLAUDE.md` | **FORBIDDEN** | it is a committed file |

---

## Related

- `../warmup/SKILL.md` — reads the ledger back at session start
- `../plan/SKILL.md` — plans must satisfy the ledger
- `../refine/SKILL.md` — turns a plan into a verifiable goal contract
- the `/review` skill (kodflow-review) — reviews cite constraint IDs when a change violates one
