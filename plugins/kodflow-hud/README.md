# kodflow-hud

An optional heads-up display beside the status line. Two panes and a few
toasts, nothing else: the status line keeps the context gauge, the epics'
pills and everything it already draws, and this mod shows only what it does
not.

- **Tâches** — the open epics of the session's task list as a tree (R12):
  subtasks under their task, for each one the worker it was handed to, the
  model and effort that worker runs on, how long since it moved, what it
  waits on or unblocks, the critical path in the margin, and the tasks
  waiting on the person. Tab turns it into a graph by state (R4).
- **Agents** — for each loop (the main one and every subagent), the folder it
  works in, the files it last read, wrote or committed, and the time of its
  last call.
- **Toasts** — a task done, a task blocked (`waiting`), a task gone silent:
  at most one per task and per state.
- **Coloured words** — a few words of a reply drawn in colour in the
  transcript, never a whole paragraph and never an emoji (see
  [Coloured words](#coloured-words)).

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

Captures in text of the drawn tree, read back by the tests at the pane's
minimum: 90 columns with its frame (88 of body) by 20 rows. Colour is the
text's alone — mauve the epic and the critical path, amber the task under
way, green done, teal ready, red blocked or silent, blue the model — and no
cell paints a background, so a transparent terminal shows through.

**R12, the tree** (the view a pane opens on):

```
─ Tâches · #1 Routage model/effort ─────────────────────────────────────────────────────
  TÂCHE                            AGENT              MODÈLE         ÂGE  LIENS
  ◆ #1     Routage model/effort    7 / 15             ━━━━━─────  1 h 52
  ├▸ ✓ T0     Événements réels     main               opus           2 h  ⇢ C6 C7
  ├▸ ✓ C1–C5  Policy et routage    main               opus        1 h 20  ⇢ C9
┃ ├▾ ● C6     Porte Fable          mkt-routing-pr     opus·xhigh  12 min  ⇢ C9
  │  ├─ ✓ agent.spawn              main               opus        20 min
┃ │  ├▾ ● Grant de session         mkt-routing-pr     opus·xhigh   3 min  ⇢ #10
  │  │  ├─ ✓ Test resume           main               opus         8 min
┃ │  │  └─ ⊘ Test parallèle                                               ⇠ #8
  │  └─ ○ Repli shell
┃ ├─ ◇ C7     Feedback agents      toi                             6 min  ⇢ C9
┃ ├▸ ▶ C8     Spécialistes ×5      prête                                  ⇢ C9
┃ └─ ⊘ C9     CI et PR                                                    ⇠ C6 C7 C8
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
┃ chemin critique  C6 → C9  ·  C7 → C9  ·  C8 → C9  ·  #8 → #10      bloqué par toi (C7)
● C6  Porte Fable   mkt-routing-pr · opus·xhigh · 12 min · ⇢ C9 · silencieux
  Le mod juge, il ne réécrit jamais e.model
────────────────────────────────────────────────────────────────────────────────────────
Arbre   Graphe                         ↑↓ choisir · ⏎ plier/déplier · tab changer de vue
```

**R4, the graph** (tab, or a click on « Graphe »):

```
─ Tâches · #1 Routage model/effort ─────────────────────────────────────────────────────
FAIT · PRÊT                    EN COURS · ATTENTE             BLOQUÉ
✓ T0    Événements réels ──┬─▶ ● C6    Porte Fable ───────┐
  main · opus · 2 h        │     mkt-routing-pr · 12 min  │
                           └─▶ ◇ C7    Feedback agents ───┤
                                 attend toi · 6 min       │
✓ C1–C5 Policy et routage ────────────────────────────────┼─▶ ⊘ C9    CI et PR
  main · opus · 1 h 20                                    │     attend C6 C7 C8
▶ C8    Spécialistes ×5 ──────────────────────────────────┘
  prête · personne dessus




┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
prochaine action  ▶ C8 prête, personne dessus                     t'attend  ◇ C7 · 6 min
┃ chemin critique  C6 → C9  ·  C7 → C9  ·  C8 → C9  ·  #8 → #10
livrable  ⊘ C9 CI et PR · attend C6 C7 C8
────────────────────────────────────────────────────────────────────────────────────────
Arbre   Graphe                         ↑↓ choisir · ⏎ plier/déplier · tab changer de vue
```

### The tree, column by column

Every column is a Box of a fixed width, a gap of 2 between them; what goes
in one is cut to it first, counted in terminal cells (string-width's count:
wide characters and emoji two, the ambiguous glyphs ✓ ● ◆ ▶ ┃ ⇢ one), so
nothing is lined up with spaces and a long title never shifts a column.

| Column | Cells | What |
|--------|-------|------|
| margin | 2 | `┃` for a task on the critical path |
| tree | 31 | 3 a level, the glyph 2, the ref 7 (top level), the title 18, cut with `…` |
| agent | 17 | the worker (the `kodflow-specialists:developer-` prefix dropped), `main`, `toi` for the person's, `prête` for a ready task |
| model | 10 | `opus·xhigh`, `sonnet·med`: the family and the effort, shortened to fit |
| age | 6 | right-aligned: `45 s`, `12 min`, `1 h 20`, `2 h`, `3 j`; red when silent |
| links | 14 | `⇠ C6 C7 C8` what it waits on, else `⇢ C9` what it unblocks, three then `+n` |

Glyphs: `✓` done, `●` under way, `◇` waiting (mauve: on the person), `▶`
ready — pending, every blocker done, nobody on it —, `⊘` blocked — pending
with a blocker left —, `○` a subtask left to do under a task not done
(whoever takes the task takes it). `▸`/`▾` a task with subtasks, folded or
not. The critical path is the longest `blockedBy` chain of tasks not done,
down to the epic's final tasks; every task on a chain of that length gets the
margin, the footer names the chains and the task that waits on the person
(« bloqué par toi » when it is on the path).

Rows, at 20: the title, the headers, the epic (done/total, a progress bar,
its age), 11 tasks, a rule, the critical path, two lines on the selection
(its glyph, ref, title, agent, model, age, links, CI, then its description)
and the views' bar. One top-level task is open at a time.

Narrower than 88 cells of body the links go, then the model under 72, then
the agent under 60: at 60 columns with the frame, the tree and the age. Fewer
than 20 rows, the finished top-level branches fold into « ✓ fait (n) »
first, then the detail drops to one line, then to none, then the list
scrolls with the selection.

### The graph

Three columns of 26 — FAIT · PRÊT, EN COURS · ATTENTE, BLOQUÉ — and two
gutters of 5; each top-level task on two rows, its title then its agent and
age. A gutter joins its links on a vertical (`┬ ┐ ┤ ┼ ┘ └`), links that
share no lane on stretches of their own; a task feeding the right-hand column
directly runs on a lane the middle one leaves free, as a solid line, so no
two lines cross. Links within a column, or
leftwards, are not drawn (the tree shows them). The footer gives the next
action (a ready task, on the path first), what waits on the person, the
critical path and the deliverable (the epic's final task, and what it waits
on). Narrower than 88 cells the three columns share what is left; under 40 a
node no longer holds its glyph, ref and title, and the graph says so in place
of its lanes.

### Keys and mouse

| Key or click | Effect |
|--------------|--------|
| `↑` `↓` | choose a task |
| `⏎` (or space) | fold or unfold it; opening a top-level task folds the other |
| `tab` | tree ↔ graph |
| click on a task | choose it; on a task with subtasks, or a second click, fold it |
| click on « Arbre » / « Graphe » | that view |

The tree is a `Client` region (`hooks/mod/client.tsx`, a surface module):
the engine hands it keys once a click has given it the focus (Escape gives
the focus back) and every pointer event over it, in cells
(`ClientSurface.onKey`, `ClientSurface.onPointer` in the engine's
`claude-code` typings). The selection, the open branches and the view live
in that instance's state, across redraws. The terminal and the desktop draw
a `Client`; VS Code and the mobile app do not, and get the same tree drawn
still, at its first state.

**Agents**, 80 columns:

```
● principal ~/Projects/kodflow/claude-marketplace                    14:03:41
  W plugins/kodflow-hud/README.md [orange]
  C plugins/kodflow-hud/hooks/mod/view.tsx [green]
  R plugins/kodflow-hooks/hooks/mod/tasks.ts [violet]
● hud ~/Projects/kodflow/status-line                                 14:03:12
  R internal/presentation/renderer/powerline.go
```

A worker's dot is green while it runs, amber while it waits or idles, grey
once stopped. A file is violet when read (`R`), orange when written (`W`),
green once committed (`C`), as filetree colours them.

## Where each thing comes from

| Shown | Source |
|-------|--------|
| epics and tasks | `<config>/kodflow/sessions/<session>/tasks.json` (version 2, kodflow-hooks' file), re-read whenever its modification time moves, looked at every 3 s and right after a `task_*` call |
| worker, its state | the task's `worker` / `worker_id`, matched against `$.agent.list()`; kept once the task moves on (tasks.json drops it) |
| subtasks, links, ref | the task's `parent`, `blockedBy`, `ref` (kodflow-hooks' `task_create` / `task_update`) |
| ready, blocked, critical path | derived from those links, nothing typed |
| model · effort | a subagent's: the Agent call's `effort` and its result's `resolvedModel`, the model `agent.spawn` resolved, and kodflow-hooks' `agent-models.tsv` (its PostToolUse record); the main loop's: `$.session.model()`, no effort (none is said to a mod). A loop no source names has an empty cell, never a guess |
| time since it moved | the later of the task's `updated` and the last tool call of its loop (worker, else the agent that owns it) |
| silent | in progress, and its loop stopped, gone from the list, or quiet for `silentMinutes` |
| `toi` | tasks with `assignee: "human"`, when tasks.json carries the field |
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
- Add anything else to what the model reads: no tool, no `context`; one
  system prompt section, the colour convention, and none with
  `KODFLOW_COLORS=off`. `/hud` answers one short line, as any command does.
- Scan the disk. No `find`, no `fs.list`; finding a work tree's root costs one
  `exists` per parent folder the first time a folder is seen, none after. The
  only process it runs is `gh pr checks`, and only for cited pull requests.

## Coloured words

The model may wrap a few words of a reply in a mark; the transcript draws
them in colour, bold, and the mark is not shown:

| Mark | Colour | Meaning |
|------|--------|---------|
| `{{r:words}}` | red | what blocks |
| `{{o:words}}` | orange | what needs attention |
| `{{v:words}}` | green | what waits on the person, their answer or their action |
| `{{p:words}}` | pink | a decision the person already made, cited with its date |

The convention reaches the model as one system prompt section,
`kodflow-hud:colors`, added last by a `prompt.compose` hook on the
`session` side of the cache boundary. It is composed afresh for every
prompt, so it holds after a compaction. It says when to mark and how: a few
words, a few marks a message at most, never in code, a command, a path or a
table meant to be copied, and `p` only for a decision of the person's whose
date is cited. It is left out where nothing draws the reply: a `-p` run
(the `print` trait), `--bare`, a render with no surface.

A `ui.render` hook on `AssistantMessage` redraws a reply that holds a mark,
paragraph by paragraph (paragraphs split on blank lines): a marked
paragraph becomes coloured runs, every other one, and every fenced code
block, goes back to the engine's `Markdown`. A mark inside a code block,
an unclosed fence or inline code is shown as typed. A reply with no mark is
the engine's own drawing, untouched. A failure while drawing falls back to
the engine's (`.catch` replays `next(e)`).

`KODFLOW_COLORS=off` (or `0`, `false`, `no`) turns off both the drawing and
the prompt section.

Limits:

- A marked paragraph keeps its bold and loses the rest of its markdown:
  links, italics, a heading's or a list's markers are drawn as typed. The
  convention tells the model to keep them out of a marked paragraph.
- The marks only reach a transcript that draws. A reply read elsewhere (a
  subagent's answer read by its parent, a log, the stored transcript)
  carries them as typed; ctrl+o shows the stored text too.
- Where an organization manages Claude Code, an installed plugin's
  `prompt.compose` hook does not run (`claude plugin validate` says so): the
  drawing works, but the model is not told the convention.

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

## Grey panel on a transparent terminal

The panes sit on an opaque grey block even when the terminal background is
transparent. The mod is not the cause and cannot remove it: it draws no
background of its own (`grep backgroundColor hooks/mod` finds nothing).

In Claude Code 2.1.300 the engine wraps the docked pane column in a box
painted with the theme token `composerSidebarBackground` (`rgb(38, 38, 38)`
in the `dark` preset, `ansi256(235)` once the terminal maps it). `$.ui.open`
(`PaneOpenArgs`: `id`, `title`, `focus`, `closeOnEscape`, `holdToasts`, `rows`,
`columns`) has no option for it, the `Pane` render props carry none, and a
`backgroundColor` inside the tree is read only as `rgb()`, `#hex`,
`ansi256()`, `ansi:<name>` or a theme key: nothing means "terminal default".
The token is not in the documented list of
[custom theme overrides](https://code.claude.com/docs/en/terminal-config#create-a-custom-theme).

Workarounds, none of them in this plugin:

- **Ghostty**: set `background-opacity-cells = true` (available since 1.2.0).
  Per the [Ghostty reference](https://ghostty.org/docs/config/reference), the
  opacity then also applies to cells that carry an explicit background
  colour, which is the case of the grey block.
- **Any terminal**: a custom theme in `~/.claude/themes/` can override
  `composerSidebarBackground` with the colour of your terminal background.
  The token is undocumented and read from the 2.1.300 bundle, not from the
  documentation, and the override is an opaque colour: it hides the grey
  without making the pane see-through.

Until the engine offers a transparent or default-background pane surface,
this stays one of its limits.

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

`tests/colors.test.tsx` holds the coloured words: the split into marked
paragraphs and runs (code blocks, inline code, bold, unknown marks), the
`kodflow-hud:colors` section last and `session`, absent with
`KODFLOW_COLORS=off`, under `-p` and `--bare`, and a marked reply drawn on
the terminal through the engine, the markup gone, the code block left to
the engine's markdown. `tests/pure.test.ts` holds the pure modules (board, silence, toasts,
activity, paths, CI). `tests/tree.test.tsx` draws the « Tâches » pane through
the engine and reads it back as text (`tests/capture.ts`, which cuts every
Box to its width as the terminal lays it out): both views at 90 by 20, line
for line, every line 88 cells and no background; the columns dropping at 86,
70 and 58; the folds, then the detail, under 20 rows; ↑ ↓ ⏎ tab and clicks on
a task and on the views' bar, through the `Client`'s own key and pointer
listeners; the same tree on the surfaces with no `Client`; the derived
states, the critical path, the cells (model·effort, links, ages, wide
glyphs) and a model column filled only from what the session said.
`tests/wiring.test.tsx` loads the module in the engine
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
