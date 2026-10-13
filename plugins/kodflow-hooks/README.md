# kodflow-hooks

The lifecycle machinery the other kodflow plugins assume: a git and forge
guard that reads a Bash line as the shell would and never rewrites it, the
delegation gate (code in a git repository is produced by subagents), session context, a
formatter, a turn-end quality gate, one structured log, and the session task
list.

Two halves. The shell scripts (`hooks/scripts/`) hold every hard guard and run
on any Claude Code. The function hooks (`hooks/mod/`, a mod: TypeScript the
engine loads from `hooks/hooks.json` → `modules`) serve the task tools and
blank the attribution text; they need **Claude Code 2.1.293 or later**.

## The mod and what is lost without it

`hooks/mod/register.ts` is wiring only, one `on(...)` per event; the logic
sits in pure modules beside it (`tasks.ts`, `store.ts`, `calls.ts`,
`paths.ts`, `lint.ts`, and for the three guards below `machine-guards.ts` over a port, with
`modwall.ts`, `collision.ts`, `zsh.ts`), which never touch `$`: the engine
follows `$` and `on` only inside register.ts.

| Event | What the mod does |
|-------|-------------------|
| `session.start` | registers `task_create`, `task_update`, `task_epic`, `task_focus`, `task_list`, `task_assign_human` (`isDeferred: false`), listed as `mcp__kodflow-hooks__task_*`, and the `/lint-setup` command |
| `classic.SessionStart` with `source: compact` | adds to the context the tasks still waiting on the user (`task_assign_human`), read fresh from `tasks.json`, so a summary cannot drop a pending "go" |
| `command.run` on `lint-setup` | checks project-linter for a Go module (below) |
| `classic.SessionStart`, `prompt.submit`, every `tool.call` | writes the beat, `<config>/kodflow/sessions/<session>/mod-beat` (time in seconds), before the shell hook of the same event runs, once the tools are registered |
| `tool.call` on a task tool | answers it (below); a refusal is `{ deny }` with the text the model reads, an internal failure a text error, never a crash |
| `attribution.text` | `""` for `commit` and `pr`; `exemption` and `remedy` untouched |
| `plugin.register` | **modwall**: refuses every user-tier hooks module whose provenance is not `*@kodflow` (the list is in `modwall.ts`, nothing the model writes widens it); built-in and managed tiers are not judged. Each decision goes to `$.store` (`modwall`, last 100) and the debug log; a refusal is toasted once the session binds |
| `command.run` · `/kodflow-mods` | the modules judged at this load, and the refusals on record |
| `session.start` | **zsh-safe**: `ZDOTDIR` → `hooks/zsh`, the user's own in `KODFLOW_USER_ZDOTDIR` (`""` when unset); `hooks/zsh/.zshenv` gives ZDOTDIR back, sources the user's `.zshenv`, then `setopt nonomatch noequals`: `echo *.none` prints `*.none` instead of failing |
| `tool.call` on `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | **collision-guard**: when another session of this machine, beating within 30 min, wrote the same file within 30 min (its `edits.tsv`), asks Continue / Move to a worktree (the model is told to call `EnterWorktree`) / Cancel, but only when the user typed a prompt at the terminal (`origin.kind` `composer`, noted by `prompt.submit`) in the last 10 minutes, the presence rule of the merge gate: otherwise it journals the collision to the debug log and lets the edit through, so a night run never waits on a question; once written, notes `<seconds>\t<path>` in `<config>/kodflow/sessions/<session>/edits.tsv` (no prompt, no content); `<config>/projects` is never checked |
| `session.end` | empties this session's `edits.tsv` |

Every hook fails open. `KODFLOW_MOD=off` (environment or the `env` block of
the settings) makes the module pass-through: no tool, no beat, no marker.
A modwall judge that throws lets the module load; with no one to answer
(`-p`) or the dialog dismissed, collision-guard lets the edit through.

modwall judges only the modules that register after kodflow-hooks: one
loaded before it (load order is the engine's) is admitted by core alone, and
`/kodflow-mods` says so. This limit is accepted: closing it would take
kodflow-hooks into the managed `prepend` tier, which managed settings alone
can do, and they are not used. `on-session.sh` stays the net: it warns about
any plugin outside the kodflow marketplace that declares `modules`.

The shell reads the beat (`lib/beat.sh`): younger than 5 s, the task tools
answer; older, the mod was loaded and is gone; absent, it never loaded.

| Without the mod (Claude Code < 2.1.293, `KODFLOW_MOD=off`, a failed reload) | |
|---|---|
| task tools | absent: tasks are not tracked, the status line shows no epic |
| triage gate, triage directive, epic state in the prompt, session-start review | off: nothing could lift a gate the tools cannot answer |
| built-in `TaskCreate`/`TodoWrite` | allowed again: they are the only list left |
| attribution text | Claude Code's own (the shell guard still refuses AI attribution in a commit) |
| what the user is told | once per session that the task tools did not load (not with `KODFLOW_MOD=off`); after an unload, `/reload-plugins` |

Every hard guard (git, delegation, protected paths, secrets) is shell and
does not depend on the mod.

## One script per event

Hooks registered on the same event run **in parallel** — the Claude Code hooks
reference says so in one line, and it decides the design. A chain of small
scripts on `PreToolUse` has no order: the guard may inspect a command the
rewriter has already changed. The only way to get a sequence is to have one
script per event and put the sequence inside it.

Every script runs the same four stages, in this order, and leaves at the first
stage that has nothing more to do:

| Stage | Meaning | Exit |
|-------|---------|------|
| **1 · gate** | the cheapest test that lets most calls leave at once | `0` |
| **2 · block** | what must stop the call | `2`, reason on stderr |
| **3 · transform** | what Claude reads (context, the task identity of a `task_*` call), emitted as **one** JSON document; a Bash command is never rewritten | `0` |
| **4 · observe** | logging and advice, off the critical path | `0` |

Every path that is not a deliberate block exits `0`. A `PreToolUse` hook that
fails by accident blocks every shell call of the session.

## Events → scripts

| Event | Script | Gate | Block | Transform | Observe |
|-------|--------|------|-------|-----------|---------|
| `PreToolUse` · Bash | `on-tool.sh` | no `git`/`gh`/`glab`/`curl`/`wget`/`http` on the line once unquoted (and no `$'…'`) | read by the shell reader below: the main thread producing into a repository (delegation gate) · `--no-verify`, `-n` on a commit, `-c core.hooksPath` · AI attribution or workflow leak in a commit message, AI attribution in a PR/MR title or body · credential shapes in the staged blobs · a forced push (`--force`, `-f`, `+refspec`), with the command to run instead · from a subagent: any merge, any push to the default branch | none: the input is never rewritten | log; a main-thread merge is tagged `root_guard: merge` |
| `PreToolUse` · task tools | `on-tool.sh` | the mod's task tools never reach it (a call a function hook answers fires no `PreToolUse`); the old MCP names are logged and passed | built-in `TaskCreate`/`TodoWrite` while the mod beats: their chat panel duplicates the status line, the refusal points at the kodflow task tools | — | log |
| `PreToolUse` · Write/Edit | `on-tool.sh` | main thread writing inside a git work tree (memory and Claude configuration excepted) · no file path | the main thread producing into a repository (delegation gate) · protected path (defaults or `.claude/protected-paths`) | — | project-linter pre-check when a server listens · log |
| `PreToolUse` · forge MCP (`mcp__github__*`, `mcp__gitlab__*`, `mcp__GitKraken__*`) | `on-tool.sh` | no message, title, body, description, branch or merge field, and a subagent or a read/merge/review/issue tool (decided without jq) | a forge write from the main thread (files, branches, pull requests) · AI attribution or workflow leak in a commit field (`message`, `commit_message`, `commit_title`, `squash_commit_message`, `merge_commit_message`) · AI attribution in the title, body or description of a PR/MR tool · from a subagent: a merge (`merge_pull_request`, `merge_merge_request`, `merge_when_pipeline_succeeds`, `auto_merge`), a file write to `main`/`master` | — | log; a main-thread merge is tagged `root_guard: merge` |
| `PostToolUse` · Write/Edit | `on-tool.sh` | file absent, markdown, `.claude/` | — | format (Makefile `fmt`/`format` first, then the formatter for the extension) and say so when the bytes changed | edited-file tracker · risky construct warning once per session · log |
| `PostToolUse` · Task/Agent | `on-tool.sh` | — | — | — | log tagged `root_guard: dispatch` |
| `PostToolUse` · other | `on-tool.sh` | — | — | — | log |
| `PostToolUseFailure` | `on-tool.sh` | — | — | — | remediation hint · log (error redacted) |
| `SessionStart` | `on-session.sh` | — | — | the open tasks to reconcile, while the mod beats · post-compaction rules on `compact` · a warning when rtk is absent · a warning to the user (`systemMessage`) and to Claude when `disableAllHooks` is set, when `CLAUDE_CODE_PLUGIN_DIRS` is set, or when an enabled plugin, a skills directory or a plugin dir outside the kodflow marketplace declares `modules` · the same warning when an installed guard (`on-tool.sh`) differs from `hooks/fingerprints.sha256`, when that file is missing, or when it differs from the marketplace clone's (D8: nothing is blocked; the file is generated by `scripts/hooks-fingerprints.sh` and checked by CI) | log |
| `SessionEnd` | `on-session.sh` | — | — | — | one log line with the session's event count (1.5 s budget) |
| `PreCompact` | `on-session.sh` | — | — | — | log |
| `ConfigChange` | `on-session.sh` | — | — | — | log · `bypassPermissions` flagged in `security-events.jsonl` |
| `UserPromptSubmit` | `on-user.sh` | — | — | branch, latest plan, latest goal · while the mod beats: the main agent's epics (active one with its task in progress, other open ones with done/total) when `tasks.json` exists, and the triage directive with the epic mandatory on `task_create` · the delegation line (code in a repository: dispatch or message the epic's subagent) unless `KODFLOW_ROOT=off` · no triage directive on a turn the user did not type · a `systemMessage` when the mod is gone | raise the triage gate (mod beating) and reset the Stop loop counter, except on a turn the user did not type · log |
| `Notification` | `on-user.sh` | — | — | bell (`terminalSequence`) on idle, permission and elicitation prompts | log |
| `SubagentStart` | `on-agent.sh` | — | — | the standing rules, injected into the subagent (own worktree, deliver through a PR) | running-agents registry, with the main agent's active epic at start · log |
| `SubagentStop` | `on-agent.sh` | `stop_hook_active` | — | — | running-agents registry · log |
| `TaskCreated` · `TaskCompleted` · `TeammateIdle` | `on-agent.sh` | — | — | — | log |
| `Stop` | `on-stop.sh` | `stop_hook_active` · 3 feedbacks without a new prompt | project-linter verdict over HTTP, passed through verbatim | feedback in one document: linter report on this session's Go packages · the CLAUDE.md of each directory changed this session, once per directory · the main agent's tasks still open in its **active epic** (tasks with no epic when none is active; tasks MCP, and the built-in list unless `CLAUDE_CODE_ENABLE_TODO_TOOLS` is off), once per open set · an active epic with tasks to do but none `in_progress` or `waiting`, every turn until corrected · more untied tasks `in_progress` than free workers, every turn · a task `in_progress` whose `worker` has stopped, once per set · a main-agent task `in_progress` on an epic no running subagent is attributed to and not tied to a running `worker` (the main thread producing), every turn, unless `KODFLOW_ROOT=off` | bell · log |

## Main thread = reviewer, code is delegated

The user's rule: the main thread triages, manages epics and tasks,
dispatches, reviews, merges after the user's OK, and informs. Code
production in a git repository is delegated: every epic is carried by at
least one subagent working in its own git worktree
beside the repository (`<repo parent>/.worktrees/<repo>-<epic-slug>`; when
that parent is or sits under `~/Documents`, `~/Desktop` or `~/Downloads`, which
macOS TCC protects, `~/Projects/.worktrees/<repo>-<epic-slug>` instead) that
delivers through a PR. The main thread keeps every other permission —
it is also the workstation's sysadmin (sudo, apt, systemctl, nmcli, installs,
files outside repositories, configuration).

The gate is mechanical. A `PreToolUse` payload carries `agent_id` only when the
call comes from inside a subagent (measured on 855 real events: every one
carrying it came from a subagent, no main-thread one did), so a call without
it is the main thread's own hand. Subagents are never gated. The main thread
is refused exactly three things:

| Tool | Refused | Still allowed |
|------|---------|---------------|
| `Write`/`Edit`/`MultiEdit`/`NotebookEdit` | a file inside a git work tree: its directory and parents are walked up looking for `.git` (a directory, or a worktree's gitdir file), no exec, after the path is normalised lexically | everything outside a repository; `<config>/projects/*/memory/*`, `<config>/settings.json`, `settings.local.json`, `<config>/CLAUDE.md` and `~/CLAUDE.md` even inside one |
| `Bash` | `git commit`, `push`, `rebase`, `cherry-pick`, `merge`, `am`, `apply`, `revert`, `reset --hard`, `worktree add`; `gh pr create`, `glab mr create` — wherever the shell reader finds them (below) | everything else: no allow-list, no redirection rule, unknown commands pass; `gh pr merge` and `glab mr merge` pass (journaled as `root_guard: merge` until the mod that asks the user exists) |
| forge MCP (`mcp__github__*`, `mcp__gitlab__*`, `mcp__GitKraken__*`) | file, branch, push and pull-request writes, and any tool not classified | reads, merges, reviews, comments, issues (decided in the jq-free fast path) |

## The shell reader

A regex over the raw line cannot tell `git "commit"`, `\git commit` or
`=git commit` from a commit, and it reads a heredoc that merely quotes a
commit as one. `on-tool.sh` does the shell's first pass instead: it cuts the
line into simple commands on `;` `&&` `||` `|` `&` and newlines, removes
quotes and backslashes, decodes `$'…'`, joins `\`+newline, sets heredoc and
here-string bodies aside as the command's stdin, walks past `VAR=value`,
reserved words and wrappers (`env`, `command`, `exec`, `sudo`, `doas`,
`nohup`, `nice`, `timeout`, `xargs`, `rtk`, `rtk proxy`…), and queues for
another pass every text the shell would itself run: `$( )`, backticks,
`<( )`, `bash -c`/`sh -c`/`zsh -c`, `eval`, `su -c`/`sg -c`, a heredoc or a
here-string fed to a shell, and `echo …`/`cat <<EOF` piped into one. A
heredoc fed to anything else is data: `cat > notes.md <<EOF` quoting a commit
and a `.claude/` path passes.

It never expands a variable or an alias. Those, and an interpreter other than
a shell (`python -c "os.system(…)"`), `find -exec` and a git alias defined on
the line, are the known gaps; each has a `known_gap` case in the corpus.

The attribution guard follows the scopes of kodflow/post-commit's
`patterns.txt`. A commit message meets every §5 pattern. A pull or merge
request title or body meets the attribution patterns only (AI trailers such
as Co-Authored-By, AI noreply addresses, "Generated with/by", the robot
emoji, "AI-assisted"): a PR may well be about the tooling, so naming Claude
Code or a `.claude/` path, or a `Plan:` line, passes there. The lists are
copied into `on-tool.sh` until `patterns.txt` is read at a pinned ref
(L0.7, a known gap).

Plugin machinery stays in marketplaces (L0.6). For every caller, Edit and
Write, and a shell redirection, are refused when they write a
`.claude-plugin/` or a `hooks/hooks.json` under a skills directory
(`~/.claude/skills/**`, `<config>/skills/**`, `**/.claude/skills/**`), and
`claude plugin install|i` or `claude plugin marketplace add` are refused
unless the plugin is `name@kodflow` or the marketplace is
`kodflow/claude-marketplace`. `cp`, `tee`, `sed -i` and `git clone` into a
skills directory are not read (known gaps).

Every refusal ends with a `[motif:<id>]` line (`root`, `no-verify`,
`attribution`, `leak`, `secrets`, `force`, `merge`, `push-default`,
`mod-write`, `plugin-source`): tests
compare it, never the wording. The corpus is
`tests/fixtures/bash-guard.jsonl`, one case per line (`cmd` or `tool` and
`input`, `rc`, `motif`, `agent`, `root`, `known_gap`), played by
`scripts/tests/test_hooks.sh` (`HOOK_SHELL=/bin/bash` plays it under macOS's
bash 3.2). Its attribution shapes are written with `\u` escapes so the file
does not carry them in clear.

The denial is short: it is code production in a repository, so dispatch the
epic's subagent (focus the epic first, so the subagent is attributed to it)
or `SendMessage` it if it is running; `ROOT_OK=1` for a genuine exception.

The Stop rule closes the other side: a main-agent task `in_progress` on an
epic with no running subagent attributed to it (`agents.json` `epic`, not
stopped, started less than 12 h ago) means the main thread is doing the
epic's work itself; it is flagged every turn — dispatch a subagent for the
epic, or set the task back to `pending`/`waiting`.

Ways out: `ROOT_OK=1` leading a Bash line, `KODFLOW_ROOT=off` in the
environment for the session (gate, Stop rule and prompt line all off), and
plan mode, where the gate never fires. Every anomaly — no jq, a malformed
payload, an empty command or path — fails open. Each denial is logged with
`root_guard: deny` and each dispatch with `root_guard: dispatch`:

```bash
L=.claude/logs/$(git branch --show-current | tr / _)/session.jsonl
grep -c '"root_guard":"deny"' "$L"; grep -c '"root_guard":"dispatch"' "$L"
```

`lib/format.sh` is the formatter table (sourced lazily, never registered) and
`lib/event.jq` is the one sanitization policy behind every log line.
`lib/epics.jq` is the hooks' read side of `tasks.json` (v1 or v2, malformed
read as empty), shared by `on-user.sh`, `on-agent.sh` and `on-stop.sh`.

## The task list (mod)

Six tools the mod registers and answers itself (`hooks/mod/tasks.ts`):
`task_create`, `task_update`, `task_epic`, `task_focus`, `task_list`,
`task_assign_human`, named
`mcp__kodflow-hooks__task_*`. They keep the session task list in
`<config>/kodflow/sessions/<session>/tasks.json`, `<config>` being
`CLAUDE_CONFIG_DIR` or `~/.claude` (always an absolute path). They replace the
built-in task tools, whose panel in the chat duplicates the status line. The
file format (version 2) is a contract shared with the status line, which draws
one pill per open epic of the main agent. They were an MCP server in Python
(`mcp/tasks.py`, gone): the port gives the same answers and leaves the same
files, proven by a corpus recorded from it (Tests, below).

- **One list per agent.** The mod reads the caller from the call itself
  (`agentId`, absent on the main loop, kept path-safe) and the session from
  `$.session.id()` on every call, so a `/clear` or a `/resume` lands in the
  right file. The status line and the Stop rules read the main agent's
  entries only.
- **Writes.** The file is read fresh on every call and replaced whole: a
  temporary file in the session directory, then `mv` (exit code checked), so
  a reader never sees half a list. Calls are queued one at a time inside the
  process (the main loop and every subagent share one copy of the mod), and a
  `mkdir` lock (`.lock.d`, the protocol of `lib/lock.sh`: stale after 10 s,
  broken by a rename, written through after 2 s) keeps two processes apart.
  `task_list` writes nothing. Timestamps are in seconds, lengths in code
  points. Each call is logged through `on-mod.sh` and `lib/event.jq`.
- **Tasks only the user can do.** `task_assign_human(subject, epic,
  description)` files a "go", a Touch ID, a gesture on a NAS as a task with
  `assignee: "human"` and the status `waiting`, in the epic it unblocks
  (required, never 0). Main agent only (a subagent says what it needs in its
  answer), at most 5 open. `task_update` closes it with `completed` once the
  user has answered, or `deleted`; it never goes `in_progress` or `pending`.
  `task_list` marks it "(assigned to the user)", the prompt's epic state lists
  the open ones ("waiting on the user: …"), and after a compaction the mod
  puts them back in the context. The field is optional: the status line,
  `lib/epics.jq` and the Stop rules read such a task as any `waiting` one.
  Nothing is submitted on the user's behalf (no `$.prompt.submit`).
- **Statuses:** `pending`, `in_progress`, `waiting` (blocked on the user: a
  decision, an approval, an answer), `completed`, `deleted`. The list must say
  what is true now; the Stop hook flags an active epic with tasks to do and
  none in progress or waiting, on every turn until it does.
- **Epics, several open at once.** An epic is one subject with its own tasks
  and its own pill. `task_epic(title)` opens one and makes it **active**; the
  others stay open. `task_focus(epic)` (id or exact title) switches the active
  epic back to an open one. `task_create` **requires** `epic`: the id of one
  of the caller's epics, or `0` for a task outside any epic. There is no
  default — a task that silently followed the active epic is how work got
  filed under the wrong subject — so a call without it is refused with the
  caller's open epics (the active one marked) and the syntax; an unknown id,
  or another agent's epic, is refused the same way. An epic is
  open while a task of it is not completed, or while it is active and still
  empty; completed epics cannot be focused, and `task_epic` with the title of
  an open epic focuses it instead of duplicating it. `task_list` shows the
  active epic's tasks, one `#id title done/total` line per other open epic,
  then the tasks with no epic. Each create, update and focus stamps the
  epic's `touched`, which orders the pills.
- **Triage.** `UserPromptSubmit` injects the epic state and a directive to
  sort every message before acting, every `task_create` naming its epic:
  new work for an open epic (create it there, focus when starting), context on the task in progress (apply, no new
  task), a change to a completed task (`Rework #N: …` in its epic), a new
  subject (`task_epic`), or plain discussion (nothing).
- **One task in progress per worker.** The main agent may have one task
  `in_progress` plus one per subagent that is `running`, `waiting` or `idle`
  in `$.agent.list()` (`agents.json` when the list cannot be read); a
  subagent has one. `task_update` refuses an extra start, and the Stop hook flags more
  tasks in progress than workers, across every epic, on every turn.
- **A task tied to its worker.** `task_update(status=in_progress,
  worker=<type, name or agent id>)` hands a task to a subagent as
  `$.agent.list()` names it (its id, its `SendMessage` name or its type). The
  start is refused if that subagent is stopped, unknown, or already holds
  another task in progress; otherwise it is accepted
  whatever the headcount, so tasks left `in_progress` by finished subagents
  no longer block a live one. `worker` and `worker_id` are stored on the task
  and dropped when it leaves `in_progress`; without `worker`, the headcount
  above applies as before. Every refusal lists the running subagents (type,
  id, for how long) and, for each task in progress, its worker and whether it
  runs, or "no worker linked", then says how to unblock (how long each has
  run comes from `agents.json`, when `on-agent.sh` recorded it). At Stop, a task
  whose worker has stopped is named once per set of such tasks; the
  headcount rule counts only untied tasks, against the main thread plus the
  running subagents that hold no tied task; and a task tied to a running
  subagent never trips the delegation rule.
- **Session start review.** On `startup`, `resume`, `clear` and `compact`,
  `SessionStart` lists the main agent's open tasks of every epic
  (`lib/review.jq`) and asks to reconcile them first — an `in_progress` left
  by the previous run is not work in progress — and raises the triage gate,
  so nothing is done before the list is true again. Only while the mod beats.
- **Turns the user did not type.** `UserPromptSubmit` also fires for a
  background task finishing and for a message relayed from another agent (a
  subagent's hand-back arrives inside that wrapper, never on its own). Their
  `prompt` starts with `<task-notification>` or `<agent-message …>`;
  `<teammate-message …>` and `[SYSTEM NOTIFICATION - NOT USER INPUT]` are
  matched too, as shapes seen reaching a session but not yet in a hook
  payload. Matched anchored, so quoting one is still a user message. Those
  raise no gate, get no triage directive and leave the Stop loop counter
  alone — a notification is not the user taking back control. The branch,
  plan, goal and epic state are still injected: a finishing task is exactly
  when where-things-stand is wanted. A `Stop hook feedback:` turn is *not*
  in that list: it quotes the user's own pending message, so it keeps the gate.
- **Triage gate.** Every user message raises
  `<config>/kodflow/sessions/<session>/triage-pending`, while the mod beats;
  until the main agent calls a task tool (the mod removes the flag; a
  subagent's call does not), `PreToolUse` refuses the main agent every tool
  but Read, Glob, Grep, LS, ToolSearch and AskUserQuestion — the message is
  filed in the task list before anything is done about it. Subagents are not
  gated. A stale beat lifts the gate (nothing could lower it any more) and
  says `/reload-plugins`. The
  `PreToolUse` matcher is the catch-all for this; tools the script does not
  handle are decided without jq (~6 ms per call, measured, the delegation gate
  included).
- **Limits:** task subjects 40 characters, epic titles 20, refused beyond:
  they are shown in full on the status line.
- **v1 files** (one epic per agent, a dict) are read as v2 and rewritten by
  the next change; the hooks read both shapes.
- **Running subagents** are recorded next to it, in `agents.json`, by the
  `SubagentStart`/`SubagentStop` hooks, each with the main agent's active epic
  at its start (`0` when none), so the status line counts it on that pill.
  Writes hold `lib/lock.sh`, a `mkdir` lock (`.agents.lock.d`): `flock(1)`
  does not exist on macOS, where the former `flock -w 2` serialised nothing
  and concurrent starts lost entries. A lock older than 10 s is broken by an
  atomic rename; one not obtained in 2 s is written through, never blocking.

`tests/run-tests.sh` runs the mod's node suite (when node can run TypeScript),
then `test_root_gate.sh` and `test_lock.sh`.

## What the log is

`.claude/logs/<branch>/session.jsonl`, one line per event, every script through
the same jq program. Tool inputs are allow-listed per tool — a `Read` keeps its
path, never its content; a `Bash` keeps 500 characters of command and 2000 of
output — and every string is clipped, then redacted (`token=`, `api_key=`,
`Bearer`, provider token prefixes). `/learn` reads it. It is gitignored.

## What was removed, and why

| Was | Now | Reason |
|-----|-----|--------|
| `permission-request.sh` auto-approving "safe" Bash prefixes | gone | a prefix match approved `git status; rm -rf ~`. Claude Code's own `permissions.allow` rules do this properly |
| `worktree-create.sh` / `worktree-remove.sh` | gone | a `WorktreeCreate` hook *replaces* Claude Code's worktree support, and the replacement deleted `index.lock` and ran `git fetch` on every creation. The native path handles `.worktreeinclude` and removes unchanged worktrees itself |
| worktree cleanup in `session-init.sh` | gone | it force-removed any worktree older than 24 h, including one with uncommitted work |
| `task-created.sh` contract registry | gone | it needed a capability file nothing writes and a primitives library the plugin never shipped, so it never ran. Team tasks are logged, not adjudicated |
| `feature-update.sh` | gone | `errexit` on a fail-open hook; its only output went to an async hook and arrived a turn late |
| `rtk` rewrite with `permissionDecision: allow` | rewrite only, then gone | `allow` skipped the permission prompt for every command rtk knows. The rewrite itself went next (D3): a hook that changes the input is a second author of every command. rtk is now a prefix the caller chooses |
| `--force` → `--force-with-lease` rewrite | refusal with the command to run | the rewrite was only correct when the whole line was the push; the refusal says what to run instead |
| stderr "warnings" on exit 0 | `additionalContext` | stderr on exit 0 goes to the debug log; Claude never saw them |
| `printf '\a'` | `terminalSequence` | hooks have no terminal; the bell never rang, and on `Stop` it corrupted the JSON that followed it |
| per-event jsonl files, `checkpoint.json`, compaction snapshots | one log | no reader for any of them; compaction recovery is Claude Code's job |
| `CLAUDE_ENV_FILE` caching of `GH_ORG`/`GH_REPO` | gone | no consumer |
| `common.sh`, hook profiles | gone | sourced by one script that used none of it; `HOOK_PROFILE` set nowhere |

## Measured

Wall time per hook invocation on the same machine, 20 runs, realistic payloads
(`scripts/tests/test_hooks.sh` has the harness):

| Event | 24 scripts | 5 scripts |
|-------|-----------:|----------:|
| PreToolUse · Bash `ls` | 145 ms | 44 ms |
| PreToolUse · Bash `git commit` | 176 ms | 85 ms |
| PreToolUse · Edit | 34 ms | 14 ms |
| PostToolUse · Edit | 103 ms | 37 ms |
| PostToolUse · Bash / Read | 77 ms | 14 ms |
| UserPromptSubmit | 26 ms | 20 ms |
| Stop | 43 ms | 16 ms |

The shell reader runs only when the unquoted line names a verb it knows; a
2.5 kB heredoc commit message costs about 100 ms under bash 5 and bash 3.2
alike. Global substitutions (`${x//…/}`) are quadratic in bash 3.2 and are
kept off long strings. Logging is a detached subshell and no longer on the
path; its lock is a `mkdir`, `flock` being absent on macOS.

## Project knobs

| File | Effect |
|------|--------|
| `.claude/protected-paths` | one glob per line; replaces the default list (`node_modules/`, `.git/`, `vendor/`, `dist/`, `build/`, `.env*`, `*.lock`, lockfiles, `go.sum`) |
| `KTN_LINTER_PORT` (default 7717) | where a project-linter server listens; nothing is called when the port is closed, nor for a file outside a Go project: the `go.mod` nearest the changed file, never above the project root (`lib/gomod.sh`, `lint.ts`, one fixture file `tests/fixtures/gomod.json`). At turn end project-linter runs from each module's directory on its own packages |
| `/lint-setup [path]` | checks, for the Go module of `path` (default the session root), the project-linter binary, the daemon's `/health` and the phase configuration (`KTN_*_PHASES`, the module's `.project-linter.yaml`); proposes installing the latest release into `~/.local/bin` and starting `project-linter serve`, each only after a yes in `$.ui.ask`; phase problems are reported, never written |
| `KTN_PRE_PHASES`, `KTN_STOP_PHASES` | linter phases at edit time and at turn end |
| `ROOT_OK=1` prefix on a command | that line is exempt from the delegation gate |
| `KODFLOW_ROOT=off` | the delegation gate, its Stop rule and its prompt line are off for the session |
| `KODFLOW_MOD=off` | the mod hooks nothing: no task tools, no beat, attribution left to Claude Code |

## Tests

```
bash scripts/tests/test_hooks.sh
bash plugins/kodflow-hooks/tests/run-tests.sh   # mod (node) + delegation gate
claude plugin validate --json plugins/kodflow-hooks
claude plugin test plugins/kodflow-hooks         # tests/mod/*.test.ts, in the engine
node plugins/kodflow-hooks/tests/mod/run-node.ts # corpus, real disk, several processes
```

The mod is held three ways. `tests/mod/conformance.corpus.ts` was recorded
from `mcp/tasks.py` before it was removed (38 scenarios, 184 calls: the 26
tests of its suite, the worker cases, the order of validation, code points,
`task_list` writing nothing, the agent id made path-safe, a worker judged by its id alone): each step keeps the
file before, the call, the answer and the file after, and the port must match
every one (`conformance.ts`, run by `claude plugin test` and by node).
`tests/mod/register.test.ts` runs the wiring in the engine's own test kit,
with the host in memory: registration, the temporary file and `mv` under the
lock, refusals as `{ deny }`, the cap read from `$.agent.list()`, the beat
written before the call goes on, `KODFLOW_MOD=off`, the attribution text.
`run-node.ts` runs the store on a real disk, a stale lock, and six processes
writing one `tasks.json` at once (every task kept, ids unique).

A hundred and forty cases in a throwaway repository, plus the bash-guard
corpus (about two hundred lines, rc and motif compared): every block, the
input never rewritten, the tracker fed a file name that is also a shell command, the
redaction of every persisted string, the Stop reminder firing once, the task rules on the active epic only, the
triage and epic state injected with each prompt, and every
script fed garbage or nothing and exiting 0.

`test_hooks.sh` runs with `KODFLOW_ROOT=off` so its main-thread payloads reach
the guard they test. The delegation gate has its own suite,
`tests/test_root_gate.sh` (run by `tests/run-tests.sh`): writes inside and
outside a work tree (worktree gitdir files, relative and `..` paths), memory
and configuration inside a repository, sysadmin commands allowed, every
producing git/forge op refused including wrapped forms, merges allowed (journaled), the
forge MCP tools, the escapes, the subagent never gated, the Stop rule with and
without a subagent on the epic, and the log tags.
