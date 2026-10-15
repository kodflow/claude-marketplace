---
name: recap
description: One compact table, in French, of where the session's work stands — open epics
  and their tasks, running subagents, the PRs of tasks in progress with their CI — with a
  column saying who must act, you or an agent, and what waits on you first. --loop [N] reprints
  it every N minutes, --stop ends it. Use when you want the state of the work at a glance
  instead of scrolling back — after a break, while several subagents run, before deciding
  what to unblock. --loop keeps it fresh while you do something else.
metadata:
  short-description: One compact table, in French, of where the session's work stands — open
    epics an
  generated-from: plugins/*/skills/recap
  argument-hint: '[--loop [N] | --stop | --help]'
---

# /recap — Where the Work Stands

the arguments

## Overview

The user reads this in ten seconds. One table, in French, that says what is
open, who has to act on it, and what waits on **them** before anything else.
No prose around it: at most one line above the table, nothing under it.

**Principle**: read, never recall. Every cell comes from a file kodflow-hooks
wrote or from the forge, fetched for this recap. A row reconstructed from the
conversation is how a finished task stays "en cours" on screen.

---

## Arguments

| Pattern | Action |
|---------|--------|
| (no args) | Gather, print the table |
| `--loop [N]` | Print the table now, then again every N minutes (N = 1 to 59, default 1) |
| `--tick` | One loop iteration: the table if anything changed, otherwise one line |
| `--stop` | End the loop |
| `--help` | This table |

`--tick` is what the loop sends; the user does not need to type it.

---

## Gather

### 1. The session's work

```bash
bash "${CODEX_HOME:-$HOME/.codex}"/skills/recap/scripts/recap.sh state "${CLAUDE_SESSION_ID}"
```

One JSON document, read from `<config>/kodflow/sessions/<session>/`
(`tasks.json`, `agents.json`, `worktrees.json`, where `<config>` is
`CLAUDE_CONFIG_DIR` or `~/.claude`). It holds the main agent's tasks, the
ones the status line shows; a subagent's own list is its business.

| Key | Holds |
|-----|-------|
| `epics[]` | open epics, most recently touched first: `id`, `title`, `active`, `done`/`total` |
| `tasks[]` | open tasks: `status`, `who` (`user` when assigned to the user or `waiting`, else `agent`), `worker` and `worker_alive`, `blocked` (worker stopped while `in_progress`, or a `blockedBy` not completed), `prs` named in the description |
| `agents[]` | running subagents: `type` (its name), `task` it holds, `worktrees[]` with `branch` and GitHub `repo` |
| `source` | `none` when no task file exists: say so in the one line and print no table |

If `recap.sh` exits 3 (no `jq`), fall back on `task_list` for the tasks and
say in the one line that subagents and PRs are missing.

### 2. The PRs and their CI

The PRs to look up: one per `agents[].worktrees[]` with a `repo` (head =
`<owner>:<branch>`), plus every `tasks[].prs[]`. Open PRs only.

1. the GitHub tool (`state: open`, `head`), then
   the GitHub tool for the check runs of its head.
2. If the GitHub MCP server does not answer: say so in the one line (it is a
   failure to report, not a missing capability), then
   `gh pr list -R <repo> --head <branch> --state open --json number,url,isDraft,statusCheckRollup`.

CI in one word: `vert` (every required check passed), `rouge` (one failed),
`en cours`, `aucune`. A draft PR says `brouillon` before it.

---

## The table

```text
| Qui | Épopée | Tâche | État | PR · CI | Ensuite |
|-----|--------|-------|------|---------|---------|
| toi | Fusion sans redite 1/2 | #10 Autoriser l'édition | attend ta réponse | — | dire go |
| agent · colors-impl | Messages en couleurs 2/3 | #14 PR mod couleurs | en cours | #57 rouge | corriger la CI |
| agent · principal | Skill recap 0/1 | #15 Skill /recap | en cours | — | — |
```

| Column | Content |
|--------|---------|
| **Qui** | `toi` when the next move is the user's, otherwise `agent · <worker>`, `agent · principal` for the main thread |
| **Épopée** | title and `done/total`, the active epic first among equals |
| **Tâche** | `#id subject`, the subject as stored |
| **État** | `attend ta réponse` · `bloqué (<why>)` · `en cours` · `à faire` · `à faire, attend #N` |
| **PR · CI** | `#N vert` and the like, `—` when none |
| **Ensuite** | the next gesture in three to five words, `—` when obvious |

**Who acts.** The user (`toi`) for a task with `who: user`, and for a PR whose
CI is `vert` once no running subagent holds it: the merge is their call. An
agent for everything else, including a `rouge` CI.

**Order.** Rows for `toi` first, then `bloqué`, then `en cours`, then
`à faire`. Within a group, the active epic first.

**What is a row.** Every task `waiting`, `in_progress` or blocked; `pending`
tasks of the active epic. A non-active epic whose only open tasks are
`pending` collapses into one row: Tâche `<k> à faire`. A running subagent
holding no task gets a row of its own, Tâche `—`. Completed tasks never.

**Stable cells.** No clock, no "for 12 min", no counter that moves by itself:
the loop compares tables, and a cell that ticks makes every iteration "new".

**The one line.** Optional, above the table, counts only:
`2 attendent ta réponse · 1 bloqué · 3 en cours`. When the session's
instructions carry the kodflow-hud colour markup (`{{v:…}}` waits on the
user, `{{r:…}}` blocked), wrap those two counts in it on this line. Never
inside the table: its cells are copied, and markup there is noise. Without
the markup, plain text; never assume the mod is there.

**Nothing open.** One line: `Rien d'ouvert.` and no table.

---

## The loop

The scheduler is Claude Code's own: `CronCreate`, session-only, fired only
while the session is idle, so a recap never lands in the middle of a turn.
This skill writes none.

### `--loop [N]`

1. N not an integer from 1 to 59: refuse with the usage line, schedule nothing.
2. `CronList`; `CronDelete` every job whose prompt is `/recap --tick`. One
   loop per session; a new N replaces the old one.
3. `CronCreate` with `cron: "*/N * * * *"` (`"* * * * *"` for 1),
   `prompt: "/recap --tick"`, `recurring: true`.
4. Print the table as for a plain `/recap` (it records the fingerprint), then
   one line under it, the only time something goes there:
   `Boucle toutes les N min, prochaine à <next run from the CronCreate result>. Arrêt : /recap --stop. Expire seule après 7 jours.`

If `CronCreate` is not available in this engine, schedule nothing and say:
`Planificateur absent. Tape /loop Nm /recap --tick, arrêt comme /loop l'indique.`

### `--tick`

Gather, build the table, then pass it to `seen`:

```bash
bash "${CODEX_HOME:-$HOME/.codex}"/skills/recap/scripts/recap.sh seen "${CLAUDE_SESSION_ID}" '<the table, exactly as it would be printed>'
```

The table goes in one single-quoted argument (a `'` in a cell written `'\''`),
so the call stays inside this skill's allowed command.

- `new`: print the table (and the one line, if any).
- `same`: print only `Rien de nouveau (HH:MM).`

The fingerprint is the table, not the one line, so the colour markup never
makes an iteration "new". A plain `/recap` also passes its table to `seen`,
so the next tick compares against what the user last saw.

### `--stop`

`CronList`, then `CronDelete` every job whose prompt is `/recap --tick`.
Print `Boucle arrêtée.` or `Aucune boucle active.`, nothing else.

---

## Guardrails

| Action | Status |
|--------|--------|
| A row, a status or a PR state not read for this recap | FORBIDDEN |
| Prose under the table, or more than one line above it | FORBIDDEN |
| Colour markup inside a table cell | FORBIDDEN |
| A cell that changes with the clock alone | FORBIDDEN |
| Writing a scheduler, a sleep loop or a background shell | FORBIDDEN |
| More than one `/recap --tick` job in a session | FORBIDDEN |
| Changing a task, a PR or a job other than `/recap --tick` | FORBIDDEN |
| Printing the table on a tick `seen` answered `same` | FORBIDDEN |

The recap reads. It never closes a task, merges a PR or retries a CI run,
whatever the table shows: the column **Qui** says who does that.
