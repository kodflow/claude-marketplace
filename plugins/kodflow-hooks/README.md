# kodflow-hooks

The lifecycle machinery the other kodflow plugins assume: shell-output
compression that never rewrites a read whose bytes matter, a git guard, session
context, a formatter, a turn-end quality gate, and one structured log.

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
| `PreToolUse` · Bash | `on-tool.sh` | no guarded git op on the line | `--no-verify`/`-n` · AI attribution or `.claude/` path in the message · credential shapes in the staged blobs · forced push inside a compound line | `--force` → `--force-with-lease` · `rtk rewrite` unless a segment must stay byte-exact | log |
| `PreToolUse` · Write/Edit | `on-tool.sh` | no file path | protected path (defaults or `.claude/protected-paths`) | — | project-linter pre-check when a server listens · log |
| `PostToolUse` · Write/Edit | `on-tool.sh` | file absent, markdown, `.claude/` | — | format (Makefile `fmt`/`format` first, then the formatter for the extension) and say so when the bytes changed | edited-file tracker · risky construct warning once per session · log |
| `PostToolUse` · other | `on-tool.sh` | — | — | — | log |
| `PostToolUseFailure` | `on-tool.sh` | — | — | — | remediation hint · log (error redacted) |
| `SessionStart` | `on-session.sh` | — | — | post-compaction rules on `compact` · a warning when rtk is absent | log |
| `SessionEnd` | `on-session.sh` | — | — | — | one log line with the session's event count (1.5 s budget) |
| `PreCompact` | `on-session.sh` | — | — | — | log |
| `ConfigChange` | `on-session.sh` | — | — | — | log · `bypassPermissions` flagged in `security-events.jsonl` |
| `UserPromptSubmit` | `on-user.sh` | — | — | branch, latest plan, latest goal as context | reset the Stop loop counter · log |
| `Notification` | `on-user.sh` | — | — | bell (`terminalSequence`) on idle, permission and elicitation prompts | log |
| `SubagentStart` | `on-agent.sh` | — | — | the standing rules, injected into the subagent | log |
| `SubagentStop` | `on-agent.sh` | `stop_hook_active` | — | — | log |
| `TaskCreated` · `TaskCompleted` · `TeammateIdle` | `on-agent.sh` | — | — | — | log |
| `Stop` | `on-stop.sh` | `stop_hook_active` · 3 feedbacks without a new prompt | project-linter verdict over HTTP, passed through verbatim | feedback in one document: linter report on this session's Go packages · the CLAUDE.md of each directory changed this session, once per directory · the tasks still open in the session list, once per open set (skipped when `CLAUDE_CODE_ENABLE_TODO_TOOLS` is off) | bell · log |

`lib/format.sh` is the formatter table (sourced lazily, never registered) and
`lib/event.jq` is the one sanitization policy behind every log line.

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

## Tests

```
bash scripts/tests/test_hooks.sh
```

Fifty-odd cases in a throwaway repository: every block, every rewrite, the
fidelity guard, the tracker fed a file name that is also a shell command, the
redaction of every persisted string, the Stop reminder firing once, and every
script fed garbage or nothing and exiting 0.
