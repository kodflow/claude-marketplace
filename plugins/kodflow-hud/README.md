# kodflow-hud

An optional heads-up display beside the status line. One pane and a few
toasts, nothing else: the status line keeps the context gauge, the epics'
pills and everything it already draws, and this mod shows only what it does
not.

- **Tâches** — the open epics (« épopées ») of the session's task list as a
  tree (R12): subtasks under their task, for each one who works it (« ◉
  principal » or « ↳ name · role » in that subagent's own colour), the
  model and effort it runs on, how long since it moved, what it waits on or
  unblocks, the critical path in the margin, and the tasks waiting on the
  person. Tab turns it into a graph by state (R4). The tab counts the tasks
  left to do: « Tâches (2) ». It is the mod's only pane, so always its
  first tab and the one shown.
- **Refus** and **Documents** — two more views in the bar under the tree
  (see [Refus](#refus) and [Documents](#documents)): what kodflow-hooks
  refused in the session, and the project's documents (present, missing,
  ignored). « Refus (n) » counts the refusals of the last hour,
  « Documents (n) » the documents missing.
- **Chasse** — a last view, only while `/hunt` lists a run (see
  [Chasse](#chasse)): each hunt's state, counter, pass, heavy queue, tip,
  Codex, pending decisions and what happened since the view was last left;
  « Chasse 7/10 » counts the busiest hunt's open issues against its cap.
- **Toasts** — a task done, a task blocked (`waiting`), a task gone silent:
  at most one per task and per state.
- **Coloured words** — a few words of a reply drawn in colour in the
  transcript, never a whole paragraph and never an emoji (see
  [Coloured words](#coloured-words)).

It is a mod: a hooks module (`hooks/mod/register.tsx`) the engine loads from
`hooks/hooks.json` → `modules`. It needs **Claude Code 2.1.293 or later**
(tested on 2.1.296, the version the CI pins) and reads the task list that
**kodflow-hooks** keeps; without kodflow-hooks the Tasks pane says there is no
list.

The subagents have no pane of their own: Claude Code lists them under the
prompt, and the tree names the one at work on each task. An older version
had an « Agents » tab; it said the same as the engine's list, and as a
second pane it kept coming in front of « Tâches » (below).

## Install, open, close

```
/plugin install kodflow-hud@kodflow
```

`scripts/install.sh` at the repository root installs it with the others.
`claude plugin disable kodflow-hud@kodflow` turns it off without touching the
rest.

| Command | Effect |
|---------|--------|
| `/hud` (`/hud tasks`, `tâches`) | opens the Tasks pane, or shows it when it is up, with the keyboard |
| `/hud off` (`close`) | closes it |
| `/hud agents` | says the Agents tab is gone (a toast and the command's answer) |

With `autoOpen` on (the default) the Tasks pane opens when a session
starts. A session that starts with the pane still up (a reload, a restart)
keeps it; an « Agents » tab an older version left up is closed then, once:
a close shows the pane left, never brings a new one in front. Every poll
(3 s) the tab is retitled when its count moved.

Why one pane: in the engine (2.1.309) the tabs stand in the order the
panes were opened (a new one goes last, a retitle keeps its place, and
`$.ui.open` takes no index); a NEW pane is shown unless a pane holds the
keyboard; and a mod cannot show a pane already up except with `focus`,
which the engine grants only while no pane holds the keyboard and which
hands the pane the keyboard. So a second tab that opened with the first
subagent came in front of « Tâches », and with « Tâches » opened first it
could not be brought back without taking the keyboard. `/hud` uses
`focus`, at the person's command.

The tab holds still under a click, as the tree's rows do: its title is
always its name and its count, one width from 0 to 99 (« Tâches (0) », a
figure space after a single digit), so a tab of another plugin beside it
does not move from under the pointer; and a retitle never changes the tab
shown.

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
(eight, picked from its id, none a state's), on every row it works. No cell
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
Arbre   Graphe   Refus (0)    Documents (0)               ↑↓ choisir · ⏎ plier · tab vue
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
Arbre   Graphe   Refus (0)    Documents (0)               ↑↓ choisir · ⏎ plier · tab vue
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
| `tab` | the next view: Arbre, Graphe, Refus, Documents, Chasse (only while a hunt is listed), then Arbre again |
| click on a task | choose it; on a task with subtasks, or a second click, fold it |
| click on « Arbre » / « Graphe » / « Refus » / « Documents » / « Chasse » | that view |

The tree is a `Client` region (`hooks/mod/client.tsx`, a surface module):
the engine hands it keys once a click has given it the focus (Escape gives
the focus back) and every pointer event over it, in cells
(`ClientSurface.onKey`, `ClientSurface.onPointer` in the engine's
`claude-code` typings). The selection, the open branches and the view live
in that instance's state, across redraws. The terminal and the desktop draw
a `Client`; VS Code and the mobile app do not, and get the same tree drawn
still, at its first state.

The engine gives a `Client` one second of wall clock a run, so a stall of
the whole process (the machine waking up, a long pause) can fail it, and a
failed `Client` is never drawn again unasked. The hooks module hears the
fault (`ui.fault`) and draws a new instance under a new key, back on the
tree at its first state (`hooks/mod/fault.ts`). Past three faults within a
minute the pane rests drawn still for five minutes, then the `Client` is
tried again, so a fault that would recur cannot loop.

A click never moves the row it hit. The task chosen is pinned to the line
it was clicked on (`Ui.pin`, `hooks/mod/layout.tsx`): the next screen
scrolls, and picks the finished branches folded or not, so that it stays
there. A click that opens a top-level task folds the ones below it, never
one above. ↑ ↓ pin the task on its line too, so the list moves only when
the selection leaves it, by one line. Before this, the list re-centred on
the task chosen and opening a branch closed the one above it: the row moved
from under the pointer, and a second click landed on another task.

### Refus

What kodflow-hooks refused in this session, read from `blocks.jsonl` (the
session's folder, beside `tasks.json`; one JSON line a blocking, 500 kept),
newest first: the time, the kind (`hook`, `classifier`, `permission`, `ci`,
`agent`), the tool, the summary and, when kodflow-hooks could deduce it, the
permission rule that would have allowed the call. Above the list, what has
piled up: the count of each kind in the last hour and since the session
began, and the reason seen most often (a hook's motif, else the summary).
The count in the bar is the last hour's.

The unlock. A click on a refusal that carries a rule (or `⏎` on it) shows
that exact rule on the confirmation line, and where it would go:

```
Autoriser  Bash(git push:*)  dans .claude/settings.local.json ?
[ajouter]  [copier]  [annuler]   a · c · n
```

Only « ajouter » (or `a`) writes: the rule joins `permissions.allow` of the
project's `.claude/settings.local.json` (the session's root), every other
key kept, written whole (a file beside it, then `mv`) or not at all, never
over a file that is not a JSON object. « copier » puts the rule on the
clipboard for `/permissions`; « annuler » closes the line. Why this road:

- The engine gives a mod no way to add a permission rule (`$.settings` is
  read only) nor to open `/permissions` on a given rule: `$.command.run`
  would open the dialog, where the rule is still picked by hand, which is
  what the button is meant to spare.
- Only the person's own click or key reaches the write: the surface module
  posts it (`ui.message`), and no tool, no hook and nothing the model says
  goes that way. The hooks module checks it again: the rule must be one a
  refusal of this session carries, in settings.json's shape, one line, at
  most 200 characters, and never one that hands over a whole shell or every
  write (`Bash`, `Edit`, `Write`, `Bash(*)`, `Edit(**)`...).
- `settings.local.json` is the narrowest place a rule can live: this
  project, this machine, not committed. A broader one is still the
  person's to add with `/permissions`.

A refusal with no rule (a classifier's, a CI run's) shows its detail and its
link, nothing to add.

### Documents

The project's documents as kodflow-hooks computes them (`docs.json`, the
session's folder): one line each, `●` green present, `●` red missing, `○`
grey ignored (with the manifest's reason), and its path. The count in the
bar is the missing ones.

- A click on a line (or `⏎`) ignores the document, or brings it back: the
  project's `docs/manifest.json` (at the git root, the path docs.json names)
  is rewritten whole, its unknown keys kept, the documents in the
  catalogue's order, two spaces, a final newline; never over a file that is
  not a JSON object. The line changes at once, without waiting for
  kodflow-hooks to recompute docs.json.
- « [créer] » on a missing line (or `c`), « Créer les manquants » (or `t`)
  put the docs prompt in the prompt box as a DRAFT, never sent:
  `/kodflow-workflow:docs trd,flow --mode both`, with no id for every
  missing one. The mode is chosen on the same line, `ask`, `context` or
  `both` (the default; `m` turns it). A box that already holds a draft is
  never overwritten: a toast says so. The draft is posed by `$.prompt.fill`;
  Escape gives the keyboard back to the prompt, ⏎ sends it.

### Chasse

What `/hunt` (kodflow-workflow) is doing, read from the two files its own
scripts write whole (a file beside, then `mv`): `active.json`, the hunts
under way, and each hunt's `status.json`, a snapshot of at most 16 KiB. The
paths are built from `$HOME` and the slug made path-safe, never from a field
of a file: `$HOME/.local/state/hunt/active.json` and
`$HOME/.local/state/hunt/<slug>/status.json` (never `XDG_STATE_HOME`). Never
the hunt's journal (`ledger.jsonl`): /hunt folds it, the view only reads the
result.

The tab is there only while `active.json` lists a hunt, always last, and of
one width whatever the figures: « Chasse 7/10 », the busiest hunt's open
issues against its cap, « ×2 » with two hunts; under 64 cells of bar it is
« Chasse » alone, and a bar too narrow even for that leaves it to `tab`.
`tab` does not stop on it while no hunt is listed, and a view left on it
when the hunt ends shows the tree.

One section a hunt: its state (`chasse`, `gel`, `passe finale`, `push`,
`attente du merge`, `pause` with its reason, `terminée`), the counter and
where it resumes, the pass (number, frozen SHA, cells played), the heavy
queue (each token labelled by the hunt holding it, `hors chasse` for
another job, then what waits), the tip and its last bundle, Codex (pending,
done, skipped, abandoned), the decisions waiting on the person, the beat,
a failed desktop notification (`notify_failed`, the watchdog retries), and
« nouveau »: the events since the view was last left (all of the last 20 on
a first visit).

- **figée** — in an active state only (`hunting`, `frozen`, `final-pass`,
  `pushing`): no progress for 2 h 05 (hunt-status' default `stall_ms`) and
  no job of the hunt running; a job past its deadline counts as none.
- **orpheline probable** — the same past 4 h 10, or the watchdog's last
  event says the owner is gone. The view cannot test a process, hence
  « probable ». A paused hunt, or one waiting for its merge, is never
  judged.
- **« reprendre »** (or `⏎` on that hunt) — only on an orphan: puts
  `/hunt --resume <slug>` in an EMPTY prompt box as a draft, never sent,
  as « Créer » does; the hooks module checks the slug again (listed now,
  probably orphaned, `[a-z0-9-]{1,40}`), and /hunt's preflight decides.
- **unreadable** — a torn file says « état illisible », a format this
  version does not know « format vN non lu, mettre à jour kodflow-hud »;
  nothing is guessed. This read runs after everything else of a poll, in
  its own try/catch: whatever /hunt's files hold, « Tâches » goes on.

Toasts, in every session that shows the HUD: each new event of a hunt,
three at most a poll and then « +N autres ». The first read of a hunt is
the reference, silent; a snapshot older than the last one seen is ignored;
a slug reused (a new `created` in active.json) starts from zero. The cursor
lives in `$.state`: after `/clear` or `/resume` the next read is a new,
silent reference, the view's « nouveau » catches up. The events that call
for the person now (pause, decision, convergence, MR opened, stall) are
never toasted: /hunt sends one desktop notification for each, and the view
shows them. The HUD never notifies the desktop.

The option `hunt` (`false`) or `KODFLOW_HUD_HUNT=off` (or `0`, `false`,
`no`) turns the view and its toasts off; nothing is read then.

### Switching panes

The tab strip shows the panes of every plugin, « Tâches » among them. What
switches them is the engine's, not this mod's: a click on a tab, ctrl+x tab
(the keyboard to the next pane, which is then shown), and the engine's
`pane:next` / `pane:previous` actions ("show next/previous plugin pane"),
bound to no key by default; binding one in `~/.claude/keybindings.json`
does it from the prompt, for example (`ctrl+x n` is free in 2.1.309):

```json
{ "bindings": [{ "context": "Global", "bindings": { "ctrl+x n": "pane:next" } }] }
```

The letters `a` and `t` that once switched to « Agents » and back are gone
with that tab. They could not have worked: a mod is handed keys only while
its pane holds the keyboard, and 2.1.309 shows a pane already up only on
`focus`, which it declines exactly then.

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
| CI | `gh pr checks <url>` for the GitHub pull request URLs an open task cites, every 5 minutes at most |
| refusals, documents | `blocks.jsonl` and `docs.json` beside tasks.json, re-read whenever their modification time or their size moves |
| « Chasse » | `$HOME/.local/state/hunt/active.json`, then each listed hunt's `<slug>/status.json` (/hunt's, format v1), re-read every poll and compared as text; never its journal |

Nothing is a second source of truth: the pane draws from `$.state`, which
holds what was last read from tasks.json, `$.agent.list()` and, for each
loop, the time of its last tool call; a reload of the module reads them
again.

## What it never does

- Change or refuse a call. `tool.call` is observed after `next`: the result
  goes back as it came, even when the observation fails (`.catch` replays
  `next`). A refused call is not recorded.
- Add anything else to what the model reads: no tool, no `context`; one
  system prompt section, the colour convention, and none with
  `KODFLOW_COLORS=off`. `/hud` answers one short line, as any command does.
- Scan the disk. No `find`; `fs.list` only on a document's folder the
  person just brought back, to see whether it holds a `.md`. Two processes:
  `gh pr checks`, only for cited pull requests, and `mv`, which ends a whole
  write of a file the person asked to change (`docs/manifest.json`,
  `.claude/settings.local.json`). Nothing for « Chasse »: two reads.

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
| `autoOpen` | `true` | open the Tasks pane when a session starts |
| `ci` | `true` | ask `gh pr checks` about cited pull requests |
| `hunt` | `true` | the « Chasse » view and its toasts (also `KODFLOW_HUD_HUNT=off`) |

`KODFLOW_HUD_TRACE=/absolute/path.json` writes what the pane would draw to
that file when the session ends: how a run with no pane (`claude -p`, a
bench) shows what was collected.

## Where it draws nothing

- `claude -p`: there is no screen; the hooks run (collection, trace), no
  pane is drawn and toasts go nowhere. Expected.
- VS Code: the extension does not show a mod's panes. Expected.
- A terminal narrower than 144 columns: the pane opened at start waits until
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
CI). `tests/tree.test.tsx` draws the « Tâches » pane through
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
`tests/wiring.test.tsx` loads the module in the engine with the host in
memory and a mocked clock: « Tâches » alone at start and shown, the title
keeping one width, panes mounted at several widths on the terminal and
desktop surfaces, each loop in its colour, results returned untouched and
each loop's last call dated, refused calls not recorded, toasts once per
task and state, CI at most every five minutes. The host (`tests/host.ts`)
keeps the engine's rules for the tab shown: a retitle never moves it, a new
pane takes it unless a pane holds the keyboard, `focus` is granted only
while no pane holds it. `tests/front.test.tsx` holds « Tâches » the only
tab and the one shown while subagents start, grow, end and start again; an
« Agents » tab of an older version closed at start, left or right of it; a
retitle leaving the person on the pane they picked; `/hud`, `/hud off`,
`/hud agents`; and `a` no key of the mod's any more.
`tests/hunt.test.tsx` holds « Chasse »: the shared status.json fixtures
(`tests/fixtures/`, kodflow-workflow's own copied byte for byte, and
`tests/hunt-fixtures.ts`, the same bytes as constants since a test imports
code only; `bash scripts/check-hunt-fixtures.sh` at the repository's root
checks both), a torn file and an unknown version, the paths, « figée » and
« orpheline probable » only in an active state, the toast cursor, the tab
shown or hidden at each width, a rewrite of the same size seen, the digest,
the hunt gone while shown, « reprendre » drafted and never for a slug not
listed. `tests/wiring.test.tsx` also holds a corrupt status.json leaving
« Tâches » updating, the toasts through the engine, the option and
`KODFLOW_HUD_HUNT=off`, and blocks.jsonl re-read when only its size moved.
`tests/reported.test.tsx` draws the reported case: one epic and one loose
task, the main loop alone (the word « Tâches » only on the tab), then three
subagents (a general-purpose one, a specialist, one of unknown type, one
frozen), the tree line for line.

A real run, for the attribution by agent (the kit's `$.tool.call` carries no
`agentId`):

```
KODFLOW_HUD_TRACE=$PWD/trace.json claude -p --plugin-dir plugins/kodflow-hud \
  --allowedTools Read Agent -- \
  "Read a.txt, then launch one general-purpose subagent that reads b/c.txt"
```

`trace.json` then holds two loops under `activity`, `main` and the
subagent's id, each with the time of its last call.
