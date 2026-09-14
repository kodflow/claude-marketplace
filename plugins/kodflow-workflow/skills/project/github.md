# /project — Phases 1-3: naming, resolution, bootstrap

MCP-first: prefer `mcp__github__*` for API calls, fall back to `gh` when a tool
is unavailable. Git operations on the working copy always use `git` itself.

---

## Phase 1 — Name

The repository name is asked, never inferred silently.

1. If `$1` is present, use it.
2. Otherwise call `AskUserQuestion` **once**:
   - header `Project`, question "What is this project called?"
   - options: any name already implied by the conversation, the current
     directory's basename, and a descriptive suggestion — the user can always
     type their own.

Then slugify to a valid GitHub name and show the result before using it:

| Rule | Effect |
|------|--------|
| allowed characters | `A-Z a-z 0-9 . _ -` — everything else becomes `-` |
| collapse | runs of `-` collapse to one |
| trim | no leading/trailing `-` or `.` |
| length | ≤ 100 characters |
| reserved | `.` and `..` are rejected outright |

If the slug differs from what the user typed, say so in one line and continue.

## Phase 1b — Owner and visibility

```bash
gh api user --jq .login                       # personal account
gh api user/orgs --jq '.[].login'             # organisations
```

- `--owner <org>` given → use it, after checking it appears in that list.
- One candidate only → use it, state which.
- Several → `AskUserQuestion` with each login as an option.

Visibility defaults to **private**. `--public` is the only way to get a public
repository; never infer it.

Verify the owner can actually receive a repo before creating:

```bash
gh api "repos/<owner>/<name>" --silent 2>/dev/null   # 0 = exists, non-0 = free
```

---

## Phase 2 — Resolution

Exactly one case applies. Determine it before running anything that writes.

```
              ┌─ IN_REPO=1 and REPO_ROOT is the target ──────────→ ADOPT
              │
  resolve ────┼─ CODE_HOME/<name> exists ──┬─ remote matches ────→ ADOPT
              │                            └─ remote differs ────→ CONFLICT
              │
              ├─ remote <owner>/<name> exists on GitHub ─────────→ CLONE
              │
              └─ nothing exists anywhere ────────────────────────→ CREATE
```

### ADOPT

```bash
cd "<workspace>"
git fetch --all --prune
git symbolic-ref --quiet --short refs/remotes/origin/HEAD | sed 's|^origin/||'   # default branch
```

- `REPO_DIRTY` > 0 → report the uncommitted files and **stay on the current
  branch**. Do not stash, do not checkout.
- clean and not on the default branch → offer to switch; do not switch unasked.
- clean and on the default branch → `git pull --ff-only`.

A missing `origin/HEAD` is common on fresh clones; repair it rather than guessing:

```bash
git remote set-head origin --auto
```

### CLONE

```bash
git clone "https://github.com/<owner>/<name>.git" "<CODE_HOME>/<name>"
cd "<CODE_HOME>/<name>"
git remote set-head origin --auto
git checkout "$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD | sed 's|^origin/||')"
```

Clone the repository's own default branch. It is usually `main`, but a repo whose
default is `master` or `develop` must be checked out on *its* default — forcing
`main` produces a branch that does not exist.

### CREATE

```bash
gh repo create "<owner>/<name>" --<private|public> --clone --description "<one line>"
#                                ^ --private unless the user passed --public (Phase 1b)
cd "<CODE_HOME>/<name>"
git symbolic-ref HEAD refs/heads/main        # only when the repo is still empty
```

Set `init.defaultBranch` once for the host if it is unset, so future `git init`
does not produce `master`:

```bash
git config --global init.defaultBranch main
```

Then Phase 3, then a single initial commit:

```bash
git add -A && git commit -m "chore: initialise project workspace"
git push -u origin main
```

Commit messages follow Conventional Commits and carry no AI attribution.

### CONFLICT

`CODE_HOME/<name>` exists and is not the target repository. **Stop.** Report:

- the path, and what it actually is (a different remote / not a git repo / empty)
- the three ways out: a different name, a different directory, or adopting what
  is already there

Never delete, move or re-initialise it.

---

## Phase 3 — Bootstrap

Create only what is missing. `test -e` before every write; an existing file is
left exactly as it is.

```
<workspace>/
├── CLAUDE.md
├── .gitignore
└── .claude/{contexts,plans,goals}/
```

`.gitignore` additions — append, never replace:

```gitignore
# Claude Code — session-local, never committed
.claude/goals/
.claude/*.local.md

# Secrets
.env
.env.*
!.env.example
```

`CLAUDE.md` is created with the ledger skeleton from `constraints.md` — header,
an empty **Constraints** section, and nothing else. It is filled in Phase 4.

On ADOPT, an existing `CLAUDE.md` is **kept**. Phase 4 appends to it; it is never
regenerated, because it may hold constraints from sessions you cannot see.

---

## Failure modes

| Symptom | Cause | Do this |
|---------|-------|---------|
| `gh: command not found` | `gh` absent | fall back to `mcp__github__*`; if that is also unavailable, run with `--no-github` and tell the user |
| `HTTP 401` / `gh auth status` fails | not authenticated | ask the user to run `! gh auth login`; do not attempt to authenticate for them |
| `HTTP 403` on create | no permission in that org | list the orgs that do work, ask which to use |
| `HTTP 422 name already exists` | race with an existing repo | re-resolve — it is a CLONE, not a CREATE |
| clone succeeds, `git checkout main` fails | default branch is not `main` | read `origin/HEAD`; never assume the branch name |
| remote URL contains a token | credential pasted into `.git/config` | do not print it; tell the user to rotate it and use a credential helper |
