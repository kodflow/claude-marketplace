# kodflow-hud

An optional heads-up display beside the status line. Two panes and a few
toasts, nothing else: the status line keeps the context gauge, the epics'
pills and everything it already draws, and this mod shows only what it does
not.

- **Tâches** — the open epics of the session's task list, and for each task
  the worker it was handed to, how that worker really stands, how long since
  anything moved, a *silent* flag, and the tasks waiting on the person in a
  column of their own.
- **Agents** — for each loop (the main one and every subagent), the folder it
  works in, the files it last read, wrote or committed, and the time of its
  last call.
- **Toasts** — a task done, a task blocked (`waiting`), a task gone silent:
  at most one per task and per state.

It is a mod: a hooks module (`hooks/mod/register.tsx`) the engine loads from
`hooks/hooks.json` → `modules`. It needs **Claude Code 2.1.293 or later**
(tested on 2.1.296, the version the CI pins) and reads the task list that
**kodflow-hooks** keeps; without kodflow-hooks the Tasks pane says there is no
list and the Agents pane works on its own.

## Install, open, close

```
/plugin install kodflow-hud@kodflow
```

`scripts/install.sh` at the repository root installs it with the others.
`claude plugin disable kodflow-hud@kodflow` turns it off without touching the
rest.

| Command | Effect |
|---------|--------|
| `/hud` | opens both panes |
| `/hud tasks` (`tâches`) | opens the Tasks pane |
| `/hud agents` | opens the Agents pane |
| `/hud off` (`close`) | closes both |

With `autoOpen` on (the default) both panes open when a session starts. The
engine seats a pane nobody asked for only where it has room — from 144
columns, docked beside the transcript in the fullscreen layout — and keeps it
waiting below that; `/hud` seats it at any width.

## What it looks like

Captures in text, as the terminal draws them (colours described in brackets).

**Tâches**, 120 columns, the person's tasks in their own column:

```
#7 SDK status-line 1/4 [mauve]                                                  Pour toi (1)
■ #21 Read the renderer [dim]                                                   □ #24 Approve the palette    0s
■ #22 Wire the pane                      ● hud running 2m  CI ✓ [amber ■, green]
■ #23 Draft the README                                   14m silencieux [red]
□ #24 Approve the palette                                  0s
Tâches 0/1 [mauve]
◇ #25 Ask for the token                                    6m [amber ◇]
```

**Tâches**, 40 columns and 4 rows: the worker column goes, the age stays from
48 columns down to nothing, the silent flag shrinks to `!`, and the completed
tasks fold into one line per epic when the board is taller than the pane:

```
#7 SDK status-line 1/4
■ 1 terminée
■ #22 Wire the pane
■ #23 Draft the README !
```

**Agents**, 80 columns:

```
● principal ~/Projects/kodflow/claude-marketplace                    14:03:41
  W plugins/kodflow-hud/README.md [orange]
  C plugins/kodflow-hud/hooks/mod/view.tsx [green]
  R plugins/kodflow-hooks/hooks/mod/tasks.ts [violet]
● hud ~/Projects/kodflow/status-line                                 14:03:12
  R internal/presentation/renderer/powerline.go
```

The vocabulary is the status line's (`internal/presentation/renderer`): an
epic is its title and done/total in mauve (256-colour 182); `■` a task done
(dim), an amber `■` the task under way, `□` one left to do; `◇` a task
waiting. The tasks under no epic form the group the status line calls
`Tâches`. A worker's dot is green while it runs, amber while it waits or
idles, grey once stopped. A file is violet when read (`R`), orange when
written (`W`), green once committed (`C`), as filetree colours them.

## Where each thing comes from

| Shown | Source |
|-------|--------|
| epics and tasks | `<config>/kodflow/sessions/<session>/tasks.json` (version 2, kodflow-hooks' file), re-read whenever its modification time moves, looked at every 3 s and right after a `task_*` call |
| worker, its state | the task's `worker` / `worker_id`, matched against `$.agent.list()` |
| time since it moved | the later of the task's `updated` and the last tool call of its loop (worker, else the agent that owns it) |
| silent | in progress, and its loop stopped, gone from the list, or quiet for `silentMinutes` |
| the person's column | tasks with `assignee: "human"`, when tasks.json carries the field |
| folder of a loop | the last call that names one: a file tool's file, Grep/Glob/LS's `path`, a leading `cd X` or `git -C X` in a shell command (the status line's `activity/dir.go`), taken to the root of its git work tree |
| files of a loop | Read (read); Write, Edit, MultiEdit, NotebookEdit (write); a `git commit` turns the loop's writes under that repository to commit. Kept 45 s, eight per loop, five shown at most |
| CI | `gh pr checks <url>` for the GitHub pull request URLs an open task cites, every 5 minutes at most |

Nothing is a second source of truth: the panes draw from `$.state`, which
holds what was last read from tasks.json, `$.agent.list()` and the tool
calls; a reload of the module reads them again.

## What it never does

- Change or refuse a call. `tool.call` is observed after `next`: the result
  goes back as it came, even when the observation fails (`.catch` replays
  `next`). A refused call is not recorded.
- Add anything to what the model reads: no tool, no `context`, no prompt
  section. `/hud` answers one short line, as any command does.
- Scan the disk. No `find`, no `fs.list`; finding a work tree's root costs one
  `exists` per parent folder the first time a folder is seen, none after. The
  only process it runs is `gh pr checks`, and only for cited pull requests.

## Options

Set them in `/config` or under `pluginConfigs["kodflow-hud"].options`.

| Option | Default | Meaning |
|--------|---------|---------|
| `silentMinutes` | `10` | quiet time after which a task in progress is flagged silent |
| `autoOpen` | `true` | open both panes when a session starts |
| `ci` | `true` | ask `gh pr checks` about cited pull requests |

`KODFLOW_HUD_TRACE=/absolute/path.json` writes what the panes would draw to
that file when the session ends: how a run with no pane (`claude -p`, a
bench) shows what was collected.

## Where it draws nothing

- `claude -p`: there is no screen; the hooks run (collection, trace), no
  pane is drawn and toasts go nowhere. Expected.
- VS Code: the extension does not show a mod's panes. Expected.
- A terminal narrower than 144 columns: the panes opened at start wait until
  `/hud` or a wider window.

## Known limits

- A commit is recognised from the command, not from git: `git commit` written
  inside an `echo` counts, and files committed that the loop did not write
  through a file tool are not listed.
- Files written by a shell command are not seen: only the folder it points
  at. Seeing them would mean a scan after every command.
- `$.agent.list()` drops a subagent some time after it ends; its worker then
  reads `absent`, which counts as stopped.
- A toast is raised once per task and state for the session: a task that goes
  silent, moves, then goes silent again is toasted once.

## Tests

```
claude plugin validate --strict --json plugins/kodflow-hud   # only the "version" warning
claude plugin test plugins/kodflow-hud                        # pure modules and wiring
```

`tests/pure.test.ts` holds the pure modules (board, silence, toasts,
activity, paths, CI). `tests/wiring.test.tsx` loads the module in the engine
with the host in memory and a mocked clock: panes mounted at several widths
on the terminal and desktop surfaces, results returned untouched, refused
calls not recorded, toasts once per task and state, CI at most every five
minutes, no process and no folder listing on a tool call.

A real run, for the attribution by agent (the kit's `$.tool.call` carries no
`agentId`):

```
KODFLOW_HUD_TRACE=$PWD/trace.json claude -p --plugin-dir plugins/kodflow-hud \
  --allowedTools Read Agent "Bash(ls:*)" "Bash(cd:*)" -- \
  "Read a.txt, then launch one general-purpose subagent that reads b/c.txt and runs: cd b && ls"
```

`trace.json` then holds two loops under `activity`: `main` with `a.txt`, and
the subagent's id with `b/c.txt` and the folder `b`.
