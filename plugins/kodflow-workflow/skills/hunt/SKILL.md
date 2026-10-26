---
name: hunt
description: 'Hunt every defect of one topic across one or several repositories until a full pass on a frozen commit finds none: verified issues, one fix commit and one Codex review per issue, nothing pushed before convergence, all resumable from a JSONL ledger. Use when a whole topic needs its defects found and fixed over several sessions.'
when_to_use: Use when a whole topic needs its defects found and fixed, not a single bug — "fix
  every defect in the consensus layer", "harden the payments state machine" — and the work will
  outlast one session. For one known defect use /fix then /debug. Not for a topic you cannot
  express as a matrix of cells with a runnable witness each.
argument-hint: '"<topic>" | --resume <slug> | --status <slug> | --teardown <slug> [--force]'
model: inherit
effort: high
allowed-tools:
- Bash(hunt-ledger:*)
- Bash(hunt-status:*)
- Bash(hunt-queue:*)
- Bash(hunt-forge:*)
- Bash(hunt-git:*)
- Bash(hunt-push:*)
- Bash(lourd:*)
- Bash(codex exec -s read-only:*)
- Bash(codex login status:*)
- Bash(gh auth status:*)
- Bash(jq:*)
- Bash(nproc:*)
- Bash(df:*)
- Bash(docker ps:*)
- Bash(kind get clusters:*)
- Bash(date:*)
- Bash(mkdir:*)
- Bash(ls:*)
- Bash(systemctl --user:*)
- Bash(notify-send:*)
- Read(**/*)
- Glob(**/*)
- Grep(**/*)
- Write(~/.local/state/hunt/*/scope.json)
- Write(.claude/settings.local.json)
- Edit(.claude/settings.local.json)
- Agent(*)
- SendMessage
- Monitor
- AskUserQuestion
- mcp__kodflow-hooks__*
---

# /hunt — hunt a topic's defects until a frozen pass finds none

$ARGUMENTS

One topic, a coverage matrix, one hunter, a handful of fixers, and one rule that
holds the rest together: **nothing leaves the machine before convergence**. The
hunt ends when a complete pass over a frozen commit gives every cell a verdict
and opens no issue. Then, and only then, `hunt-push` pushes, opens one MR/PR per
repository with every `Closes #N`, and the hunt waits for the merge.

The skill is generic. The topic, the matrix, the globs, the witness commands,
the environment and the exclusive jobs all come from `scope.json`; everything
language-specific lives in an adapter (`adapters/<lang>.md`, Go first).

---

## Arguments

| Pattern | Action |
|---------|--------|
| `"<topic>"` | Preflight, write `scope.json`, get it approved once, start the hunt |
| `--resume <slug>` | Rebuild state from the ledger and continue (`resume.md`) |
| `--status <slug>` | Print `hunt-status <slug>`, change nothing; detects merged MRs in `awaiting-merge` |
| `--teardown <slug> [--force]` | Remove what the hunt created (`teardown.md`); refused in `awaiting-merge` without `--force` |
| `--help` | Print the help block and stop |

The slug is `[a-z0-9-]{1,40}`, derived from the topic and shown in the scope.

## --help

```
════════════════════════════════════════════════════════════════
  /hunt — hunt a topic's defects until a frozen pass finds none
════════════════════════════════════════════════════════════════

Usage: /hunt "<topic>"
       /hunt --resume <slug> | --status <slug> | --teardown <slug> [--force]

  State   ~/.local/state/hunt/<slug>/  scope.json · ledger.jsonl ·
          status.json · tip.bundle      (never in a repo, never /tmp)
  Follow  Monitor on `hunt-status <slug> --watch` (one line per event)
  Push    only through hunt-push, only after convergence; never merges

  You approve scope.json once. Every issue the hunt opens after that
  is covered by that approval (tracker.md, /hunt exception).

Chain:  /hunt → (merge the MRs yourself) → /hunt --status → --teardown
════════════════════════════════════════════════════════════════
```

**If `$ARGUMENTS` contains `--help`:** print it and STOP.

---

## Phase map

| Phase | What | Module |
|-------|------|--------|
| 0 | Preflight — refuse to start on an unsafe machine | this file |
| 1 | Write `scope.json`, compute the budget, one approval | this file, `scope.example.json` |
| 2 | Register the hunt, arm Monitor and the watchdog | this file, `ledger.md` |
| 3 | Hunt: passes, findings, verification, issues | `roles.md`, `queue.md`, `adapters/<lang>.md` |
| 4 | Fix and integrate, Codex review per issue | `roles.md`, `queue.md` |
| 5 | Freeze, final pass, push, after-merge | `convergence.md` |
| — | Resume after any interruption | `resume.md` |
| — | Teardown | `teardown.md` |

Every script named below is on `PATH` while the plugin is enabled
(`plugins/kodflow-workflow/bin/`) and answers `--help`. Exit codes everywhere:
`0` ok · `1` refused or failed · `2` usage · `75` queue or lock timeout (**no
verdict**) · `124` a job killed at its `--deadline` (**no verdict**) · `3`
(`hunt-forge`) the nonce lookup failed: nothing created; retry the lookup,
never the write.

| Script | Does |
|--------|------|
| `hunt-ledger` | the only writer of `ledger.jsonl`, `status.json`, `active.json` (`ledger.md`) |
| `hunt-status` | the table, `--json`, `--watch` for Monitor, the watchdog and its timer |
| `hunt-queue` | every heavy job: gate, tokens, scope env, per-job temp dirs (`queue.md`) |
| `hunt-git` | every git operation of a role, confined to the hunt's worktrees and branches; never pushes |
| `hunt-forge` | issues, MRs/PRs, CI on github, gitlab, forgejo (and `local`, for tests) |
| `hunt-push` | the only push, after it has recomputed convergence; never merges |

---

## Phase 0 — Preflight (blocking)

Every check below must pass. A failure is reported with the exact fix and the
hunt does not start; nothing is half-created.

| # | Check | How | On failure |
|---|-------|-----|------------|
| 1 | Agent teams off on **every** settings layer | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is unset or `0` in the process env, `~/.claude/settings.json`, the project's `.claude/settings.json` and `.claude/settings.local.json`, and the managed settings (`/etc/claude-code/managed-settings.json`, and the `managed-settings.d/` drop-ins next to it). Read each with `jq -r '.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS // empty'` | refuse; a managed layer at `1` cannot be overridden by the user — say so |
| 2 | Forked subagents off | `CLAUDE_CODE_FORK_SUBAGENT=0` in the env block that the session runs with | refuse; name the settings file to edit |
| 3 | Forge reachable and authenticated, per repository of the scope | `hunt-forge <slug> <repo> auth` — `gh api user` for `github`, `GET /user` with the token variable the scope names for `gitlab` and `forgejo` | refuse; never print or echo a token |
| 4 | Codex reachable | `codex login status` | **not** blocking: record `codex: unavailable`, the final report will say "converged without Codex" |
| 5 | Machine budget | `nproc`, `MemAvailable` from `/proc/meminfo` → hunters, fixers, heavy tokens (below) | refuse when even the minimum (1 hunter, 1 fixer, 1 token) does not fit |
| 6 | Disk | `df -P` on `~/Projects/.worktrees`, `~/.local/state` and the Go/build caches | refuse under the scope's `thresholds.disk_min_gib` |
| 7 | Other workloads | running kind clusters / containers (`docker ps`, `kind get clusters`) | ask the user to stop them; record what was stopped, teardown restarts it |
| 8 | Toolchain pinned | `GOTOOLCHAIN=local` is in the scope's env and is set on every command; `-mod=mod` appears nowhere in the scope | refuse |
| 9 | Not already running | `~/.local/state/hunt/active.json` — `hunt-ledger init` refuses a slug whose owner process is alive | refuse; offer `--status` |
| 10 | Dry run done once | the ledger of some earlier hunt on this machine holds a complete cycle (finding → confirmed → fixed → integrated) with no permission prompt | warn, and do not leave the hunt unattended until one has run (`tests/e2e-dryrun.sh` proves the scripts; this check proves the permissions) |

### Budget — computed, fixers first

```text
cores   = nproc - 1                       # one core stays free for the session and the desktop
mem_gib = MemAvailable / GiB - 2          # headroom for the editor and the root session
tokens  = max(1, min(cores, floor(mem_gib / 3.5)))    # heavy jobs in parallel (hunt-queue)
fixers  = max(1, min(tokens, 4))                      # fixers before anything else
hunters = tokens >= 4 ? 2 : 1
agents  = 1 root + hunters + fixers (+ at most 1 verifier alive at a time)
```

Example: 4 threads and ~9 GiB available → 2 tokens, 2 fixers, 1 hunter. The
budget goes into `scope.json` (`budget`), the token count into `HUNT_TOKENS` on
every `hunt-queue` call. A second hunt on the same machine shares the same
tokens (`~/.cache/lourd/`): preflight refuses it when the first already holds
the budget.

---

## Phase 1 — scope.json, approved once

Root writes `~/.local/state/hunt/<slug>/scope.json` — the only file root ever
writes besides the project's `.claude/settings.local.json` deny rule. Every field
is documented in `scope.example.json`. Root fills it from the repository and
the conversation:

- topic and slug; the repositories (path, forge, API URL, CA, token variable,
  `owned`, base branch, MR target, In/Out globs, exclusive project lock, image
  variable and tag template, language and its env, witness tag sets);
- open issues on the topic, imported so the hunter does not refile them;
- the coverage matrix — one cell per behaviour × condition, each with the
  witness command template the adapter defines;
- thresholds: cap 10 open, resume at ≤7, max passes, max hours, stall and
  disk thresholds, Codex deferral timeout;
- the computed budget.

Then show it **once**:

```
⏸  Start hunt <slug> on <N> repositories
   Topic     : <topic>
   Matrix    : <cells> cells · witness: <adapter>
   Budget    : <hunters> hunter · <fixers> fixers · <tokens> heavy tokens
   Issues    : up to <cap> open at once, labelled hunt:<slug>, opened WITHOUT
               per-issue preview (this approval covers them — tracker.md, /hunt)
   Push      : never before convergence; one MR per repo to <target>; never merged

   [1] start   [2] show scope.json   [3] edit a field   [4] cancel
```

Nothing is created before an explicit **start**. The `start` event records
`scope_sha256`; every script refuses a `scope.json` that no longer matches it
(`hunt-ledger scope-check`). To change the scope later, show the change, get a
yes, then append `scope-update` with the new hash. That answer is recorded as
the first ledger line (`hunt-ledger init`, then `append <slug> start`) and it is
the only approval the hunt asks for — later questions are `hunt:needs-decision`
tasks, never blocking prompts.

## Phase 2 — register, deny push, arm the follow

1. `hunt-ledger init <slug>` — registers the hunt in `active.json` with this
   session's process identity (its nearest `claude` ancestor); refuses a slug
   whose owner is another live process. Then `hunt-ledger append <slug> start`.
2. Add `Bash(git push:*)`, `Bash(git -C:*)` and `Bash(git -c:*)` to
   `permissions.deny` of the **project's** `.claude/settings.local.json`
   (create it if absent, keep every other key); teardown removes exactly these.
   Bash rules match the command text, so `git push` alone would not catch
   `git -C <dir> push`; and no role runs bare git at all (`hunt-git` only), so
   denying the global-option forms costs nothing. This is a **first filter,
   not a wall** — `env git push` or a script still gets past it, and only the
   auto-mode classifier judges those. Pushing is meant to go only through
   `hunt-push`.
3. Arm **Monitor** on `hunt-status <slug> --watch`. It prints one line per new
   ledger event and a `stall` line when the hunt stops beating; it is silent
   otherwise, so an idle hunt costs no turn (it polls every
   `HUNT_WATCH_INTERVAL` seconds, default 2). Re-arm it before 30 minutes
   elapse and on every resume.
4. Install the watchdog: `hunt-status --install-watchdog` writes and starts
   the `systemd --user` timer `hunt-watchdog.timer`, which runs
   `hunt-status --watchdog` every 5 minutes. It covers what Monitor cannot —
   a crashed session, a Monitor lost when the session went to the background:
   it appends `stall` (and notifies) for a hunt whose owner died or whose beat
   is older than `thresholds.stall_ms`. The unit names the script by its
   absolute path: install it again after every plugin update (resume does).
5. `hunt-ledger owner <slug> --set-state hunting` (a `state` event), then
   `hunt-git <slug> <repo> integ-init <base>` per `owned` repository, then
   dispatch per `roles.md`.

## Phases 3–5

`roles.md` (who does what, briefs, blocks), `queue.md` (heavy jobs),
`convergence.md` (freeze, final pass, push, after merge), the adapter for the
language of each repository. Root reads the module before entering its phase.

---

## Root's discipline

- **Root never writes code**, never commits, never edits a file in a repository.
  It decides, dispatches, watches, and appends to the ledger.
- **Never call Agent with `name`.** Subagents are addressed by the agent id
  recorded in the ledger (`agent` event), through SendMessage; when that id no
  longer answers, a fresh agent gets a brief rebuilt from the ledger.
- **Never use a fork** (`subagent_type: "fork"`) — preflight disables it; every
  role starts from a brief, not from root's context.
- Resolve the plugin path once per session (`$CLAUDE_PLUGIN_ROOT`) and put it in
  every brief; never persist it — it changes with each plugin update.
- Every brief sets `HUNT_SLUG=<slug>`, `HUNT_REPO=<repo>` and `HUNT_TOKENS` for
  the role's `hunt-queue` calls.
- Writes to the ledger go through `hunt-ledger append` only, never Write/Edit.
- Every decision rests on a ledger line or a script's output, never on memory of
  the conversation: after `/clear`, the ledger is the conversation.

---

## Guardrails

| Action | Status |
|--------|--------|
| Push, or open an MR/PR, outside `hunt-push` | **FORBIDDEN** — `git push`, `git -C`, `git -c` are denied for the hunt's duration (a first filter, not a wall) |
| Merge anything | **FORBIDDEN** — the user merges |
| Start without the one-time scope approval | **FORBIDDEN** |
| Start with agent teams `1` on any settings layer, or forks enabled | **FORBIDDEN** |
| Root writing code, committing, or editing a repository file | **FORBIDDEN** |
| Call Agent with `name`, or use a fork | **FORBIDDEN** |
| Write `ledger.jsonl` or `status.json` with Write/Edit | **FORBIDDEN** — `hunt-ledger` only |
| Open an issue from an unverified finding | **FORBIDDEN** — a verifier replays it first |
| Open an issue past the cap, or without reserving the slot under the ledger lock | **FORBIDDEN** |
| Count a killed, timed-out, or non-compiling run as a pass or a fail | **FORBIDDEN** — `no-verdict` |
| Retry after a permission-classifier block | **FORBIDDEN** — `pause: permission` and stop |
| Treat a subagent report that mentions a warning or a block as success | **FORBIDDEN** — unconfirmed until re-checked |
| A heavy command outside `hunt-queue` / `lourd` | **FORBIDDEN** |
| Run fixes in the main checkout of a repository | **FORBIDDEN** — worktrees under `~/Projects/.worktrees` only |
| Bare `git` in a role (commit, cherry-pick, rebase, branch, worktree) | **FORBIDDEN** — `hunt-git` only |
| Touch a non-`owned` repository | **FORBIDDEN** — file an issue there and wait |
| Print, echo, log or pass a token in argv | **FORBIDDEN** |
| Teardown during `awaiting-merge` without `--force` | **FORBIDDEN** |
| Name a project, company or private topic in this skill's files | **FORBIDDEN** — the scope carries names |

---

## Related

- `../_shared/tracker.md` — the `/hunt` exception to the per-issue preview
- `../_shared/model-policy.md` — the tier and effort of every role
- `../_shared/specialists.md` — who the hunter consults on the technology
- `../fix/SKILL.md`, then `kodflow-review:debug` — for one defect, not a topic
- `../git/SKILL.md` — not used during a hunt; `hunt-push` replaces it
