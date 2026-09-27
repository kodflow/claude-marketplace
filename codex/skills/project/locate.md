# /project — Phase 0: locating the workspace

The locator script is the only source of truth for paths:

```bash
bash "${CODEX_HOME:-$HOME/.codex}"/skills/project/scripts/locate-code-home.sh
```

It prints `KEY=VALUE` lines. Read them; do not re-derive any of them by hand.

| Key | Meaning |
|-----|---------|
| `IN_REPO` | `1` when the cwd is inside a git work tree |
| `REPO_ROOT` | top level of that work tree |
| `REPO_REMOTE` | `origin` URL, empty when the repo has no remote |
| `REPO_BRANCH` | current branch, or `DETACHED` |
| `REPO_DEFAULT_BRANCH` | branch `origin/HEAD` points at, empty when unset |
| `REPO_DIRTY` | count of modified/untracked entries |
| `CANDIDATE_<n>` | `path\|repos=<n>\|dirs=<n>` — one per probed code home, real path |
| `EXCLUDED_<n>` | `path\|reason=macos-tcc` — a folder that exists but is never ranked |
| `CANDIDATE_COUNT` | how many candidates existed |
| `CODE_HOME` | the winning candidate, or `$HOME/Projects` when there is none |
| `CODE_HOME_EXISTS` | `0` when `CODE_HOME` is the fallback and still has to be created |
| `PLATFORM` | `Linux` \| `Darwin` \| `MINGW64_NT-*` … |
| `GH_PRESENT`, `GH_USER` | whether `gh` is installed and who it is authenticated as |
| `GIT_DEFAULT_BRANCH` | `init.defaultBranch`, empty when never configured |

## Why a script and not a heuristic

"The most standard path" is not the same string on every machine:

| Platform | Typical code home |
|----------|-------------------|
| Linux (English) | `~/Projects`, `~/Documents`, `~/src` |
| Linux (localized) | `~/Projects`, then `~/Documentos`, `~/Dokumente`, `~/文档` — resolved via `xdg-user-dir DOCUMENTS` |
| macOS | `~/Projects`, `~/Developer` — **never** `~/Documents`, `~/Desktop`, `~/Downloads` |
| Windows (Git Bash / MSYS) | `%USERPROFILE%\Documents`, `%USERPROFILE%\source\repos` |
| Windows + OneDrive | `%OneDrive%\Documents` (Documents is redirected) |

The script probes all of them, then **ranks by evidence**: the candidate holding
the most git repositories wins, counted one level down (`<home>/<repo>`) and two
levels down (`<home>/<owner>/<repo>`); ties break on subdirectory count, then on
probe order, and `~/Projects` is probed before `~/Documents`. A directory that
already holds this user's other projects is, by definition, where the next one
belongs. Two names for one directory — a symlink, or `~/projects` and
`~/Projects` on a case-insensitive file system — are one candidate, printed with
the spelling stored on disk.

**macOS:** `~/Documents`, `~/Desktop` and `~/Downloads` are excluded outright,
not merely ranked last. TCC protects them, and the kernel can refuse git, the
shell and claude every read there; a code home that works until the day it
locks the session out is worse than none. They appear as `EXCLUDED_<n>`.

`$CLAUDE_CODE_HOME` overrides everything when it is set and exists — even a
TCC folder, because it is the user's decision, not a guess.

## Decision table

| `IN_REPO` | `REPO_REMOTE` | Read as | Next |
|-----------|---------------|---------|------|
| `1` | non-empty | An existing project, already connected to a remote | Phase 2 **ADOPT** |
| `1` | empty | A local-only repo — offer to publish it with `gh repo create --source .` | Phase 2 **ADOPT**, then ask about publishing |
| `0` | — | Not in a project yet | Phase 1, then Phase 2 |

**`REPO_DIRTY` > 0 on ADOPT:** report the count and do not switch branches. A
setup command must never move a user off dirty work; say what is uncommitted and
let them decide.

**`REPO_BRANCH=DETACHED`:** report it and stop before any checkout.

## Nested-repository trap

`IN_REPO=1` can be true because the *parent* directory is a repository — this
host's `$HOME` is itself a git work tree, so every subdirectory looks
"in a repo" until `REPO_ROOT` is checked. Always compare `REPO_ROOT` with the
project you are actually being asked about:

- `REPO_ROOT` == the intended project → genuine ADOPT.
- `REPO_ROOT` is an ancestor that merely contains it (e.g. `$HOME`) → treat this
  as `IN_REPO=0` for resolution purposes, and **never** run `git init` inside it.

## When there is no candidate

`CANDIDATE_COUNT=0` means no conventional code directory exists (`CODE_HOME`
is then the `$HOME/Projects` fallback, with `CODE_HOME_EXISTS=0`). Ask once with
a multiple-choice question to the user where projects should live, offering `$HOME/Projects`
(recommended, first) and `$HOME/src` — plus `$HOME/Documents` on Linux or
Windows only, never on macOS — then `mkdir -p` the answer and use it as
`CODE_HOME`. Record the answer as a constraint so the next session does not ask
again:

```
### C-001 — Project root
- **Category:** workflow
- **Rule:** MUST place new checkouts under `<chosen path>`.
- **Verify:** `test -d "<chosen path>"`
- **Origin:** <date> — chosen during /project setup
```
