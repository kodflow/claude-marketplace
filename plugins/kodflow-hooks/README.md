# kodflow-hooks

The lifecycle machinery the other kodflow plugins assume: shell-output
compression that never rewrites a read whose bytes matter, a git guard, the
delegation gate (code in a git repository is produced by subagents), session context, a
formatter, a turn-end quality gate, and one structured log.

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
| **3 · transform** | rewrite the input, emitted as **one** JSON document | `0` |
| **4 · observe** | logging and advice, off the critical path | `0` |

Every path that is not a deliberate block exits `0`. A `PreToolUse` hook that
fails by accident blocks every shell call of the session.

## Events → scripts

| Event | Script | Gate | Block | Transform | Observe |
|-------|--------|------|-------|-----------|---------|
| `PreToolUse` · Bash | `on-tool.sh` | main thread and a repository-producing git/forge op on the line · no guarded git op on the line | the main thread producing into a repository (delegation gate) · `--no-verify`/`-n` · AI attribution or `.claude/` path in the message · credential shapes in the staged blobs · forced push inside a compound line | `--force` → `--force-with-lease` · `rtk rewrite` unless a segment must stay byte-exact | log |
| `PreToolUse` · task tools | `on-tool.sh` | — | built-in `TaskCreate`/`TodoWrite`: their chat panel duplicates the status line, the refusal points at the MCP | the MCP call (`task_create`/`update`/`list`/`epic`/`focus`) gets `_session` and `_agent` (the caller's `agent_id`, else `main`), overriding the model | log |
| `PreToolUse` · Write/Edit | `on-tool.sh` | main thread writing inside a git work tree (memory and Claude configuration excepted) · no file path | the main thread producing into a repository (delegation gate) · protected path (defaults or `.claude/protected-paths`) | — | project-linter pre-check when a server listens · log |
| `PreToolUse` · forge MCP (`mcp__github__*`, `mcp__gitlab__*`, `mcp__GitKraken__*`) | `on-tool.sh` | subagent, or a read/merge/review/issue tool (decided without jq) | a forge write from the main thread (files, branches, pull requests) | — | log |
| `PostToolUse` · Write/Edit | `on-tool.sh` | file absent, markdown, `.claude/` | — | format (Makefile `fmt`/`format` first, then the formatter for the extension) and say so when the bytes changed | edited-file tracker · risky construct warning once per session · log |
| `PostToolUse` · Task/Agent | `on-tool.sh` | — | — | — | log tagged `root_guard: dispatch` |
| `PostToolUse` · other | `on-tool.sh` | — | — | — | log |
| `PostToolUseFailure` | `on-tool.sh` | — | — | — | remediation hint · log (error redacted) |
| `SessionStart` | `on-session.sh` | — | — | post-compaction rules on `compact` · a warning when rtk is absent | log |
| `SessionEnd` | `on-session.sh` | — | — | — | one log line with the session's event count (1.5 s budget) |
| `PreCompact` | `on-session.sh` | — | — | — | log |
| `ConfigChange` | `on-session.sh` | — | — | — | log · `bypassPermissions` flagged in `security-events.jsonl` |
| `UserPromptSubmit` | `on-user.sh` | — | — | branch, latest plan, latest goal · the main agent's epics (active one with its task in progress, other open ones with done/total) when `tasks.json` exists · the triage directive, always, with the epic mandatory on `task_create` · the delegation line (code in a repository: dispatch or message the epic's subagent) unless `KODFLOW_ROOT=off` | reset the Stop loop counter · log |
| `Notification` | `on-user.sh` | — | — | bell (`terminalSequence`) on idle, permission and elicitation prompts | log |
| `SubagentStart` | `on-agent.sh` | — | — | the standing rules, injected into the subagent (own worktree, deliver through a PR) | running-agents registry, with the main agent's active epic at start · log |
| `SubagentStop` | `on-agent.sh` | `stop_hook_active` | — | — | running-agents registry · log |
| `TaskCreated` · `TaskCompleted` · `TeammateIdle` | `on-agent.sh` | — | — | — | log |
| `Stop` | `on-stop.sh` | `stop_hook_active` · 3 feedbacks without a new prompt | project-linter verdict over HTTP, passed through verbatim | feedback in one document: linter report on this session's Go packages · the CLAUDE.md of each directory changed this session, once per directory · the main agent's tasks still open in its **active epic** (tasks with no epic when none is active; tasks MCP, and the built-in list unless `CLAUDE_CODE_ENABLE_TODO_TOOLS` is off), once per open set · an active epic with tasks to do but none `in_progress` or `waiting`, every turn until corrected · a main-agent task `in_progress` on an epic no running subagent is attributed to (the main thread producing), every turn, unless `KODFLOW_ROOT=off` | bell · log |

## Main thread = reviewer, code is delegated

The user's rule: the main thread triages, manages epics and tasks,
dispatches, reviews, merges after the user's OK, and informs. Code
production in a git repository is delegated: every epic is carried by at
least one subagent working in its own git worktree
(`~/Documents/worktrees/<repo>-<epic-slug>`) that delivers through a PR. The
main thread keeps every other permission — it is also the workstation's
sysadmin (sudo, apt, systemctl, nmcli, installs, files outside repositories,
configuration).

The gate is mechanical. A `PreToolUse` payload carries `agent_id` only when the
call comes from inside a subagent (measured on 855 real events: every one
carrying it came from a subagent, no main-thread one did), so a call without
it is the main thread's own hand. Subagents are never gated. The main thread
is refused exactly three things:

| Tool | Refused | Still allowed |
|------|---------|---------------|
| `Write`/`Edit`/`MultiEdit`/`NotebookEdit` | a file inside a git work tree: its directory and parents are walked up looking for `.git` (a directory, or a worktree's gitdir file), no exec, after the path is normalised lexically | everything outside a repository; `<config>/projects/*/memory/*`, `<config>/settings.json`, `settings.local.json`, `<config>/CLAUDE.md` and `~/CLAUDE.md` even inside one |
| `Bash` | `git commit`, `push`, `rebase`, `cherry-pick`, `merge`, `am`, `apply`, `revert`, `reset --hard`, `worktree add`; `gh pr create`, `glab mr create` — found anywhere on the line, past `cd … &&`, `git -C`/`-c`, `env`/`sudo`/`xargs` prefixes and `bash -c "…"`, the attribution guard's shape | everything else: no allow-list, no redirection rule, unknown commands pass; `gh pr merge` and `glab mr merge` pass |
| forge MCP (`mcp__github__*`, `mcp__gitlab__*`, `mcp__GitKraken__*`) | file, branch, push and pull-request writes, and any tool not classified | reads, merges, reviews, comments, issues (decided in the jq-free fast path) |

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

## The task list (MCP)

`mcp/tasks.py`, declared in `.mcp.json`: a standard-library Python MCP server
(`task_create`, `task_update`, `task_epic`, `task_focus`, `task_list`) that
keeps the session task list in `<config>/kodflow/sessions/<session>/tasks.json`,
`<config>` being `CLAUDE_CONFIG_DIR` or `~/.claude`. It replaces the built-in
task tools, whose panel in the chat duplicates the status line. The file
format (version 2) is a contract shared with the status line, which draws one
pill per open epic of the main agent.

- **One list per agent.** An MCP server cannot tell who calls it; `on-tool.sh`
  writes `_session` and `_agent` into every call. The status line and the Stop
  rules read the main agent's entries only.
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
  `in_progress` plus one per running subagent (`agents.json`); a subagent
  has one. `task_update` refuses an extra start, and the Stop hook flags more
  tasks in progress than workers, across every epic, on every turn.
- **Session start review.** On `startup`, `resume`, `clear` and `compact`,
  `SessionStart` lists the main agent's open tasks of every epic
  (`lib/review.jq`) and asks to reconcile them first — an `in_progress` left
  by the previous run is not work in progress — and raises the triage gate,
  so nothing is done before the list is true again.
- **Triage gate.** Every user message raises `triage-pending`; until a task
  tool is called, `PreToolUse` refuses the main agent every tool but Read,
  Glob, Grep, LS, ToolSearch and AskUserQuestion — the message is filed in the
  task list before anything is done about it. Subagents are not gated. The
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
- Without the hook, the session is found through the parent Claude Code
  process (`<config>/sessions/<pid>.json`) and every call belongs to `main`.

`tests/run-tests.sh` drives the server over stdio.

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
| `rtk` rewrite with `permissionDecision: allow` | rewrite only | `allow` skips the permission prompt for every command rtk knows — most of them. The rewritten command now goes through the normal permission flow |
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

The remaining cost of a Bash call is `rtk rewrite` itself (≈22 ms), which is
the transform. Logging is a detached subshell and no longer on the path.

## Project knobs

| File | Effect |
|------|--------|
| `.claude/protected-paths` | one glob per line; replaces the default list (`node_modules/`, `.git/`, `vendor/`, `dist/`, `build/`, `.env*`, `*.lock`, lockfiles, `go.sum`) |
| `KTN_LINTER_PORT` (default 7717) | where a project-linter server listens; nothing is called when the port is closed |
| `KTN_PRE_PHASES`, `KTN_STOP_PHASES` | linter phases at edit time and at turn end |
| `NO_RTK=` prefix on a command | that line is never rewritten |
| `ROOT_OK=1` prefix on a command | that line is exempt from the delegation gate |
| `KODFLOW_ROOT=off` | the delegation gate, its Stop rule and its prompt line are off for the session |

## Tests

```
bash scripts/tests/test_hooks.sh
bash plugins/kodflow-hooks/tests/run-tests.sh   # tasks MCP + delegation gate
```

A hundred cases in a throwaway repository: every block, every rewrite, the
fidelity guard, the tracker fed a file name that is also a shell command, the
redaction of every persisted string, the Stop reminder firing once, the task rules on the active epic only, the
triage and epic state injected with each prompt, and every
script fed garbage or nothing and exiting 0.

`test_hooks.sh` runs with `KODFLOW_ROOT=off` so its main-thread payloads reach
the guard they test. The delegation gate has its own suite,
`tests/test_root_gate.sh` (run by `tests/run-tests.sh`): writes inside and
outside a work tree (worktree gitdir files, relative and `..` paths), memory
and configuration inside a repository, sysadmin commands allowed, every
producing git/forge op refused including wrapped forms, merges allowed, the
forge MCP tools, the escapes, the subagent never gated, the Stop rule with and
without a subagent on the epic, and the log tags.
