# kodflow-hud

An optional heads-up display beside the status line. Two panes and a few
toasts, nothing else: the status line keeps the context gauge, the epics'
pills and everything it already draws, and this mod shows only what it does
not.

- **Tâches** — the open epics (« épopées ») of the session's task list as a
  tree (R12): subtasks under their task, for each one who works it (« ◉
  principal » or « ↳ name · role » in that subagent's own colour), the
  model and effort it runs on, how long since it moved, what it waits on or
  unblocks, the critical path in the margin, and the tasks waiting on the
  person. Tab turns it into a graph by state (R4). The tab counts the tasks
  left to do: « Tâches (2) ». It is the view a session starts on.
- **Agents** — only while a subagent runs, its tab counting them (« Agents
  (1) »): the main loop on one line, then each subagent with its name, its
  role (its type, short), its model, its state (a frozen one in red), the
  task it holds, the folder it works in and the files it last read, wrote or
  committed.
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
| `a` (in « Tâches ») | shows the Agents tab, while a subagent runs |
| `t` (in « Agents ») | shows the Tâches tab |
| a click on a tab | shows it (the engine's tab strip) |
| `/hud` | opens the Tasks pane, and the Agents pane while a subagent runs |
| `/hud tasks` (`tâches`) | opens the Tasks pane |
| `/hud agents` | opens the Agents pane while a subagent runs; with none, says so and opens it with the first |
| `/hud off` (`close`) | closes both; the Agents tab no longer opens by itself until `/hud` |

With `autoOpen` on (the default) the Tasks pane opens when a session starts,
alone, so it is the one shown; a session that starts with the panes still
up (a reload, a restart) is brought back to « Tâches » as well. The Agents
tab opens with the first subagent and closes with the last: the main loop
alone never gets a tab. Every poll (3 s) the two tabs are retitled when
their count moved. An open or a retitle may raise the pane it names; the
pane shown before is opened again after, so the view does not jump to
Agents.

The tabs hold still under a click, as the tree's rows do:

- A title is always its name and its count, one width from 0 to 99
  (« Tâches (0) », a figure space after a single digit). A tab that grew or
  shrank with its count (« Tâches » becoming « Tâches (1) ») moved the
  Agents tab beside it from under the pointer.
- A retitle puts back only what its own open raised. Before, a click on a
  tab that landed while the poll retitled was undone: the pane shown before
  the retitle was raised again over the person's choice.

The engine seats a pane nobody asked for
only where it has room — from 144 columns, docked beside the transcript in
the fullscreen layout — and keeps it waiting below that; `/hud` seats it at
any width.

## What it looks like

Captures in text of the drawn tree, read back by the tests at the pane's
minimum: 90 columns with its frame (88 of body) by 20 rows. Colour is the
text's alone, and always one of the theme's own colours, which the engine
shades for a light or a dark theme: `merged` (purple) the epic and the
critical path, `warning` (amber) the task under way, `success` (green) done,
`planMode` (teal) ready, `permission` the tasks waiting on the person,
`error` (red) blocked or frozen, `ide` (blue) the model, `claude` the main
loop. Each subagent has one mid-tone colour of its own for the session
(eight, picked from its id, none a state's), the same in both panes. No cell
paints a background, so a transparent terminal shows through.

**R12, the tree** (the view a pane opens on):

```
─ #1 Routage model/effort ──────────────────────────────────────────────────────────────
  TÂCHE                           AGENT                   MODÈLE         ÂGE  LIENS
  ◆ #1     Routage model/effort  7/15                                 1 h 52
  ├▸ ✓ T0     Événements réels    ◉ principal             opus           2 h  ⇢ C6 C7
  ├▸ ✓ C1–C5  Policy et routage   ◉ principal             opus        1 h 20  ⇢ C9
┃ ├▾ ● C6     Porte Fable         ↳ mkt-routi… · general  opus·xhigh  12 min  ⇢ C9
  │  ├─ ✓ agent.spawn             ◉ principal             opus        20 min
┃ │  ├▾ ● Grant de session        ↳ mkt-routi… · general  opus·xhigh   3 min  ⇢ #10
  │  │  ├─ ✓ Test resume          ◉ principal             opus         8 min
┃ │  │  └─ ⊘ Test parallèle                                                   ⇠ #8
  │  └─ ○ Repli shell
┃ ├─ ◇ C7     Feedback agents     toi                                  6 min  ⇢ C9
┃ ├▸ ▶ C8     Spécialistes ×5     prête                                       ⇢ C9
┃ └─ ⊘ C9     CI et PR                                                        ⇠ C6 C7 C8
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
┃ chemin critique  C6 → C9  ·  C7 → C9  ·  C8 → C9  ·  #8 → #10      bloqué par toi (C7)
● C6  Porte Fable   mkt-routing-pr · general-purpose · opus·xhigh · 12 min · ⇢ C9 · figé
  Le mod juge, il ne réécrit jamais e.model
────────────────────────────────────────────────────────────────────────────────────────
Arbre   Graphe                         ↑↓ choisir · ⏎ plier/déplier · tab changer de vue
```

**R4, the graph** (tab, or a click on « Graphe »):

```
─ #1 Routage model/effort ──────────────────────────────────────────────────────────────
FAIT · PRÊT                    EN COURS · ATTENTE             BLOQUÉ
✓ T0    Événements réels ──┬─▶ ● C6    Porte Fable ───────┐
  principal · opus · 2 h   │     mkt-routing-pr · 12 min  │
                           └─▶ ◇ C7    Feedback agents ───┤
                                 attend toi · 6 min       │
✓ C1–C5 Policy et routage ────────────────────────────────┼─▶ ⊘ C9    CI et PR
  principal · 1 h 20                                      │     attend C6 C7 C8
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
| tree | 30 | 3 a level, the glyph 2, the ref 7 (top level), the title 17, cut with `…` |
| agent | 22 | `◉ principal` (the main loop, theme colour `claude`), `↳ name · role` (a subagent in its own colour, the role its type short: `general`, a specialist's topic; the name cut first, the role keeping up to seven cells; no role when the type is unknown), `toi` for the person's, `prête` for a ready task |
| model | 10 | `opus·xhigh`, `sonnet·med`: the family and the effort, shortened to fit |
| age | 6 | right-aligned: `45 s`, `12 min`, `1 h 20`, `2 h`, `3 j`; red when silent |
| links | 10 | `⇠ C6 C7 C8` what it waits on, else `⇢ C9` what it unblocks, then `+n` |

An epic's line carries no agent and no model: its title runs over those
columns, followed by its progress, `7/15` (green once every task is done).
The tasks filed under no epic sit under a quiet `◌ Hors épopée`, with no
number, no progress and no age. The section's title never repeats the tab's
name: the epic when one is open (`#1 Routage model/effort`), else how many
(`2 épopées ouvertes`), then the tasks under no epic (`1 tâche hors
épopée`).

Glyphs: `✓` done, `●` under way, `◇` waiting on the person, `▶`
ready — pending, every blocker done, nobody on it —, `⊘` blocked — pending
with a blocker left —, `○` a subtask left to do under a task not done
(whoever takes the task takes it). `▸`/`▾` a task with subtasks, folded or
not. The critical path is the longest `blockedBy` chain of tasks not done,
down to the epic's final tasks; every task on a chain of that length gets the
margin, the footer names the chains and the task that waits on the person
(« bloqué par toi » when it is on the path).

Rows, at 20: the title, the headers, the epic (done/total, its age), 11
tasks, a rule, the critical path, two lines on the selection (its glyph,
ref, title, agent and role, model, age, links, CI, « figé » when silent,
then its description) and the views' bar. One top-level task is open at a
time.

Narrower than 88 cells of body the links go, then the model under 76, then
the agent under 64: below that, the tree and the age. Fewer
than 20 rows, the finished top-level branches fold into « ✓ fait (n) »
first, then the detail drops to one line, then to none, then the list
scrolls with the selection. The fold sits first under its epic, where the
finished work mostly stood, the open tasks below it in their order, and
only the last row of the epic turns `└─`:

```
  ◆ #3     Forgejo Raft  68/69      20 j
  ├─ ✓ fait (68)
┃ └─ ● F7     F7 observateur e…    8 min
```

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
| `a` | the Agents tab |
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

A click never moves the row it hit. The task chosen is pinned to the line
it was clicked on (`Ui.pin`, `hooks/mod/layout.tsx`): the next screen
scrolls, and picks the finished branches folded or not, so that it stays
there. A click that opens a top-level task folds the ones below it, never
one above. ↑ ↓ pin the task on its line too, so the list moves only when
the selection leaves it, by one line. Before this, the list re-centred on
the task chosen and opening a branch closed the one above it: the row moved
from under the pointer, and a second click landed on another task.

### Switching tabs from the keyboard

A mod is handed keys only where it draws and only while that place has the
keyboard: the tree's `Client` after a click in it, a pane's Buttons after a
click or ctrl+x tab (`ClientSurface.onKey`, `ButtonProps.hotkey` in the
engine's typings). It cannot claim a chord of its own at the prompt: a
Button's `action` only borrows one of the engine's existing actions. So the
switch is a plain letter while a pane has the keyboard:

- `a` in « Tâches » (the tree posts it, `register.tsx` opens Agents); with no
  subagent at work it opens nothing and a toast says why;
- `t` in « Agents », a Button on its last row (`t: Tâches`), also clickable.

Neither ctrl+t (the engine's task list) nor ctrl+a (start of line) is
touched. From the prompt, the engine itself has `pane:next` and
`pane:previous` ("show next/previous plugin pane"), bound to no key by
default; binding one in `~/.claude/keybindings.json` switches the tabs
without the mod, for example (`ctrl+x n` is free in 2.1.309):

```json
{ "bindings": [{ "context": "Global", "bindings": { "ctrl+x n": "pane:next" } }] }
```

**Agents**, 88 columns by 10 rows (`tests/agents.test.tsx`, the last row the
Button back to « Tâches »), its tab
« Agents (3) »:

```
─ 3 sous-agents en cours ───────────────────────────────────────────────────────────────
  AGENT               RÔLE                    MODÈLE      ÉTAT
◉ principal           fil principal           opus        ● actif · 15 s
    /w/repo
↳ hud-agents          general-purpose                     ● actif · 15 s
    ● #2 Rendu des agents  ·  /w/repo
↳ vault-audit         devops · hashicorp                  ⏸ figé · 11 min
    /w/repo
↳ sans-type           type inconnu                        ◇ attend
t: Tâches
```

The main loop heads the list in the theme's `claude` colour; each subagent
follows in its own colour (the same as in the Tâches pane), the ones at work
first, then for half an hour, dimmed, the ones that stopped. The role is the
agent's type (`subagent_type`) short: the plugin prefix dropped, a
specialist's `<area>-specialist-<topic>` read `area · topic`; a type nobody
gave reads « type inconnu », never a guess. The state: `● actif` (green, a
call in the last minute), `● en cours` (amber), `◇ attend` (waiting),
`⏸ figé` (red, bold: no call for `silentMinutes`), `◌ au repos`, `✓ terminé`,
`✗ échec`. Under each, the task it holds and its folder, then, as rows
allow, the files it last read (`R`, violet), wrote (`W`, orange) or
committed (`C`, green), as filetree colours them. Under 76 columns the role
moves under the name; under 56 the model goes.

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
| `autoOpen` | `true` | open the Tasks pane when a session starts, and the Agents tab while a subagent runs |
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
- Whether opening or retitling a pane raises it is the engine's to decide,
  and its typings do not say. The mod assumes the worst (every open raises)
  and opens the pane shown before again after its own opens; the tests prove
  that against a host that raises, not against the terminal itself. With a
  focused pane the person holds, re-raising it does not take the keyboard.

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
listeners; a second click at the same place on the same task, in a pane
that scrolls and in one that does not, and ↑ ↓ moving the list by one line
only once the selection leaves it; the same tree on the surfaces with no `Client`; the derived
states, the critical path, the cells (model·effort, links, ages, wide
glyphs) and a model column filled only from what the session said.
`tests/wiring.test.tsx` loads the module in the engine
with the host in memory and a mocked clock: « Tâches » alone at start and
shown, the Agents tab opened and counted with the subagents and closed with
the last while « Tâches » stays in front (the host raising every pane it
opens), a click on a tab standing through a retitle, the titles keeping one
width, `a` and `t` switching the tabs (and `a` with no subagent opening
nothing), a session starting on « Tâches » even with both tabs up and
`autoOpen` off, `/hud off` keeping it shut, panes mounted at several widths on the
terminal and desktop surfaces, each loop in its colour, results returned
untouched, refused calls not recorded, toasts once per task and state, CI
at most every five minutes, no process and no folder listing on a tool call.
`tests/agents.test.tsx` draws the reported case: one epic and one loose
task, the main loop alone (no Agents tab, the word « Tâches » only on the
tab), then three subagents (a general-purpose one, a specialist, one of
unknown type, one frozen), both panes line for line, the colours, and the
Agents pane at 60 columns.

A real run, for the attribution by agent (the kit's `$.tool.call` carries no
`agentId`):

```
KODFLOW_HUD_TRACE=$PWD/trace.json claude -p --plugin-dir plugins/kodflow-hud \
  --allowedTools Read Agent "Bash(ls:*)" "Bash(cd:*)" -- \
  "Read a.txt, then launch one general-purpose subagent that reads b/c.txt and runs: cd b && ls"
```

`trace.json` then holds two loops under `activity`: `main` with `a.txt`, and
the subagent's id with `b/c.txt` and the folder `b`.
