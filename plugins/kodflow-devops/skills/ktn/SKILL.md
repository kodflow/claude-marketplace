---
name: ktn
description: 'Autonomous health-and-heal for the project-linter MCP stack. Dispatches 5 specialist
  agents in parallel: each verifies + fixes ONE concern (binary version, mcp.json entry, .claude/settings.json
  hooks, daemon on :7717, phase config). Idempotent: does nothing when the stack is already
  healthy, prompts a session restart only when settings.json was actually modified. Use when:
  a fresh container starts, a Claude session can''t reach project-linter, hooks misbehave, or
  you just want a one-command sanity check.'
when_to_use: Use when a session cannot reach project-linter, its hooks misbehave, a fresh container
  starts, or you want a one-command sanity check of the ktn stack.
argument-hint: '[--check] [--phases <spec>] [--scope <diff|all>] [--restart]'
model: opus
allowed-tools:
- Read(**/*)
- Write(.claude/settings.json)
- Write(mcp.json)
- Write(.project-linter.yaml)
- Edit(.claude/settings.json)
- Edit(mcp.json)
- Edit(.project-linter.yaml)
- Bash(curl:*)
- Bash(jq:*)
- Bash(command:*)
- Bash(which:*)
- Bash(project-linter:*)
- Bash(pkill:*)
- Bash(pgrep:*)
- Bash(kill:*)
- Bash(ss:*)
- Bash(lsof:*)
- Bash(readlink:*)
- Bash(stat:*)
- Bash(cut:*)
- Bash(nohup:*)
- Bash(uname:*)
- Bash(chmod:*)
- Bash(mv:*)
- Bash(mkdir:*)
- Bash(sleep:*)
- Bash(sort:*)
- Bash(test:*)
- Bash([:*)
- Bash(echo:*)
- Bash(cat:*)
- Bash(head:*)
- Bash(sed:*)
- Bash(make:*)
- Bash(rtk:*)
- Bash(grep:*)
- Bash(rg:*)
- Bash(find:*)
- Bash(ls:*)
- Glob(**/*)
- Grep(**/*)
- WebFetch(api.github.com/*)
- WebFetch(github.com/*)
- mcp__github__get_latest_release
- Task(*)
- TaskCreate(*)
- TaskUpdate(*)
- TaskList(*)
---

# /ktn — Autonomous project-linter MCP Lifecycle

$ARGUMENTS

---

## Arguments

| Pattern | Action |
|---------|--------|
| _(none)_ | Full parallel reconcile (default) |
| `--check` | Read-only diagnostic — no writes, no daemon spawn |
| `--phases <spec>` | Configure `.project-linter.yaml` then reconcile (spec syntax in `--help`) |
| `--scope <diff\|full\|show>` | Set `review_scope` in `.project-linter.yaml` (`show` = read-only, prints resolved scope) |
| `--restart` | Force daemon respawn (skip health probe) |
| `--uninstall` | Remove `mcp.json` project-linter entry + settings.json hook entries (binary kept) |
| `--help` | Show this help and STOP |

**IF `$ARGUMENTS` contains `--help`**: Print [Help](#help) verbatim and **STOP**. Do NOT spawn agents.

---

## Help

```text
═══════════════════════════════════════════════════════════════
  /ktn — project-linter MCP autonomous health + heal
═══════════════════════════════════════════════════════════════

  DEFAULT (no args)
    Dispatches 5 agents in parallel. Each verifies ONE concern
    and fixes it iff drifted. Idempotent — second run is no-op.

  FLAGS
    (none)                Full reconcile (default)
    --check               Read-only — never writes
    --phases <spec>       Apply phase config then reconcile
    --scope <spec>        Set review_scope (diff|full|show) then reconcile
    --restart             Force daemon respawn
    --uninstall           Remove mcp.json + settings hook entries (binary kept)
    --help                Show this help

  PHASES SPEC (--phases)
    default               Reset to {1..7} (phase 8 opt-in)
    all                   Universe {1..8}
    1-7                   Range
    1,3,6                 Subset
    structural,logic      Aliases (canonical or variants)
    +tests                Add phase 8 to current set
    -comment              Remove phase 7 from current set
    show                  Print resolved active set + source

  SCOPE SPEC (--scope)
    diff                  Surface only issues on code changed vs default branch (default)
    full                  Surface every issue across the whole project (legacy)
    show                  Print resolved review_scope + source (no write)

  REVIEW SCOPE (who honours it)
    Daemon / MCP scan / HTTP /scan / hooks   honour review_scope (diff default)
    project-linter lint (CLI) / make lint        ALWAYS full (CI/audit path)
    MCP scan accepts a per-request scope override from the same cached scan.

  PROJECT GATE (always first)
    Detects Go via rtk grep (go.mod, *.go, BUILD.bazel rules, etc).
    If no signal: pauses with a Yes/No AskUserQuestion prompt.
    Cancel = abort, no writes. Confirm = continue.

  PARALLEL AGENTS (after the gate)
    1. binary       Install / upgrade project-linter from GitHub releases
    2. mcp          Ensure mcp.json registers project-linter
    3. settings     Wire PreToolUse + PostToolUse HTTP hooks
    4. daemon       Health-check :7717 + respawn if dead
    5. phases       Validate .project-linter.yaml phases + review_scope (write if --phases/--scope)

  EXAMPLES
    /ktn                  First-run / fresh container reconcile
    /ktn --check          CI-style read-only audit
    /ktn --phases 1,3,6   Restrict to structural+logic+style
    /ktn --phases +tests  Opt into phase 8 (KTN-TEST-*)
    /ktn --scope full     Surface whole-project issues (restore legacy view)
    /ktn --scope show     Print the resolved review_scope
    /ktn --restart        After kernel-suspend / OOM kill

  EXIT BEHAVIOR
    All ✓ + no writes        → silent OK ("nothing to do")
    Any agent wrote a file   → consolidated report + restart prompt
                                iff .claude/settings.json was touched
    --check finds drift      → non-zero report, no writes

═══════════════════════════════════════════════════════════════
```

---

## Overview

`/ktn` is a **read–decide–heal** loop, not a configuration UI. It owns the
MCP-server lifecycle around `project-linter` and complements `/lint` (which runs
scans). 5 specialist agents work in parallel because the 5 concerns are
file-disjoint:

| Agent | Reads | Writes | Network |
|-------|-------|--------|---------|
| `binary` | `which project-linter`, `project-linter version` | `/usr/local/bin/project-linter` (or `~/.local/bin/`) | GitHub releases API |
| `mcp` | `mcp.json` | `mcp.json` | — |
| `settings` | `.claude/settings.json` | `.claude/settings.json` | — |
| `daemon` | `curl :7717/health` | (none — process op only) | localhost:7717 |
| `phases` | `.project-linter.yaml` | `.project-linter.yaml` (only with `--phases`) | — |

No two agents touch the same path → safe to dispatch as **one parallel wave**.

### Daemon guard

> `/ktn` drives the **MCP daemon** on `:7717`, NOT the `project-linter lint` CLI.
> The CLI now preflights `GET :7717/health` and **ABORTS** (exit code
> `DaemonActive=42`) when the daemon is live, steering you to the MCP scan /
> dump surface instead of running a second, divergent analysis. Bypass with
> `--force` or `KTN_FORCE_LOCAL=1` (prints a loud EXCEPTIONAL OVERRIDE notice).
> A template-consumer project's `make lint` should **NOT** add `--force` — the
> guard is desired there (it keeps CI and the live daemon from disagreeing).
>
> Note the scope asymmetry: the daemon / MCP scan / HTTP `/scan` honour the
> root `review_scope` field (default `diff` — only issues on code changed vs
> the default branch), while `project-linter lint` and `make lint` ALWAYS run
> `full`. An existing project with NO `review_scope` field silently moves from
> whole-project to `diff`; pin `review_scope: full` to restore the legacy view.

### `--uninstall` mode

Reverses the lifecycle in a single parallel wave:

| Agent | Action |
|-------|--------|
| `mcp` | Delete `project-linter` from both `.servers` and `.mcpServers` |
| `settings` | Strip every hook whose URL begins with `http://localhost:7717/` from PreToolUse + PostToolUse; drop matchers whose hooks array becomes empty |
| `daemon` | `pkill project-linter serve` (best-effort, no respawn) |
| `binary` | Skipped — the binary is intentionally kept |
| `phases` | Skipped — `.project-linter.yaml` belongs to the user |

Restart prompt fires iff `.claude/settings.json` was modified.

---

## Phase 0 — Project gating (MANDATORY first step)

project-linter only applies to Go repositories. Detect Go signals (go.mod/go.work,
then any `*.go`, then ancillary markers) and **stop the skill** when none are
found — do not heal a stack the project cannot use. Detection script and exit
contract: read `gating.md`.

## Phase 1 — Pre-flight (host, not an agent)

Execute these checks before spawning any agent. They define the per-agent
inputs:

```bash
# Target dirs
WORKSPACE="${WORKSPACE_FOLDER:-/workspace}"
SETTINGS_FILE="$WORKSPACE/.claude/settings.json"
MCP_FILE="$WORKSPACE/mcp.json"
PHASES_FILE="$WORKSPACE/.project-linter.yaml"

# OS/arch for binary fetch. Devcontainer is Linux by construction, but derive
# from `uname` so the skill stays correct if a user runs it on a host shell
# outside the container (issue #356 mentions `go env GOOS/GOARCH`; we avoid
# the `go` dependency since `uname` is universal).
case "$(uname -s)" in
    Linux)   GOOS="linux"  ;;
    Darwin)  GOOS="darwin" ;;
    *)       echo "✗ Unsupported OS: $(uname -s)"; exit 1 ;;
esac
case "$(uname -m)" in
    x86_64)         GOARCH="amd64" ;;
    aarch64|arm64)  GOARCH="arm64" ;;
    armv7l)         GOARCH="armv6l" ;;
    *)              echo "✗ Unsupported arch: $(uname -m)"; exit 1 ;;
esac

# Track if --check (read-only)
READ_ONLY=0
[[ "$ARGUMENTS" == *"--check"* ]] && READ_ONLY=1

# Track if --phases <spec> was passed (extract the spec)
PHASES_SPEC=""
case "$ARGUMENTS" in
    *"--phases "*)
        PHASES_SPEC="$(echo "$ARGUMENTS" | sed -n 's/.*--phases \([^ ]*\).*/\1/p')"
        ;;
esac

# Track --scope <spec> was passed (extract the spec: diff|full|show)
SCOPE_SPEC=""
case "$ARGUMENTS" in
    *"--scope "*)
        SCOPE_SPEC="$(echo "$ARGUMENTS" | sed -n 's/.*--scope \([^ ]*\).*/\1/p')"
        ;;
esac

FORCE_RESTART=0
[[ "$ARGUMENTS" == *"--restart"* ]] && FORCE_RESTART=1

# Track --uninstall (mutually exclusive with reconcile)
UNINSTALL=0
[[ "$ARGUMENTS" == *"--uninstall"* ]] && UNINSTALL=1
```

Surface a single banner line:

```text
[ktn] os=<linux|darwin>/<arch> mode={reconcile|check|uninstall} phases-spec={none|<spec>} restart={0|1}
```

---

## Phase 2 — Parallel agent dispatch

Five specialists dispatched in ONE message, one concern each: binary version,
`mcp.json` entry, `settings.json` hooks, the daemon on :7717, and the phase
config. Full prompts and contracts: read `dispatch.md`.

## Phase 3 — Synthesize results

Collect the 5 JSON payloads. Decide the final user message in this order:

1. **Any `status: "error"`** → print the agent's `notes` line by line under a
   `═══ /ktn — ERRORS` banner, then list any agent that did succeed.
   Exit non-zero in spirit (return code is informational; the user sees the report).

2. **All `status: "ok"` AND no agent reports `wrote_file: true` AND
   `daemon.action: "noop"` AND `daemon.fresh: true`** → silent OK:

   ```text
   ✓ project-linter healthy — nothing to do.
       binary    {version} ({path})
       mcp       registered  (key=servers|mcpServers)
       settings  pre+post hooks wired
       daemon    :7717  health=200 ready=200  fresh=yes
       phases    {active_set}  scope={diff|full}  (source={default|yaml})
   ```

   When `daemon.fresh: false` is observed in `--check` mode (read-only, no
   respawn), emit the **stale daemon banner** instead — drift surfaced,
   no writes performed:

   ```text
   ⚠ project-linter daemon is alive but STALE
       pid       {pid}
       exe       {exe}
       bin       {bin}
       reason    {stale_reason}   # exe-deleted | inode-mismatch | missing-exe-path
       action    rerun /ktn (without --check) to kill+respawn
   ```

3. **Otherwise (any fix happened)** → consolidated report:

   ```text
   ═══════════════════════════════════════════════════════════════
     /ktn — reconcile complete
   ═══════════════════════════════════════════════════════════════

     binary    {before} → {after}   {action}
     mcp       {drift → none}        wrote={true|false}
     settings  {drift → none}        wrote={true|false}  +entries={pre,post}
     daemon    health {before → after}  fresh={yes|no→yes}  {action}  pid={pid}
     phases    active={...}  scope={diff|full}  source={default|yaml|cli}  wrote={true|false}
   ```

   **Conditional restart prompt** — print ONLY when `settings.wrote_file == true`:

   ```text
   ⚠ Restart the Claude Code session to activate the new hooks.
     (settings.json is read at session start — current session is unhooked.)
   ```

   If `settings.wrote_file == false` and only `binary` / `mcp` / `daemon` /
   `phases` changed, DO NOT print the restart prompt — those don't require a
   session restart (mcp.json is read by the MCP client, phases hot-reloads via
   the daemon watcher, daemon respawn is in-place).

---

## Idempotency contract

Two consecutive `/ktn` invocations from a clean state MUST produce zero file
changes on the second run:

| Agent | Idempotency key |
|-------|----------------|
| binary | local version == latest tag |
| mcp | `.servers["project-linter"].args` matches `["serve"]` or `["serve","--port","7717"]` (accept `.mcpServers` on read) |
| settings | any inner hook URL startswith `http://localhost:7717/` under matcher `Edit\|Write\|MultiEdit` for both Pre and Post |
| daemon | `/health` returns 200 AND `/proc/<pid>/exe` resolves to the same inode as the on-disk `project-linter` binary (no `(deleted)` marker) |
| phases | `.project-linter.yaml` parses; no spec passed |

If you find yourself patching the same file twice in a row, you have a bug in
the drift detection — fix the detection, not the write logic.

---

## Guardrails

- **NEVER** write `/usr/local/bin/project-linter` without trying `sudo -n` first
  and falling back to `~/.local/bin/` / `~/bin/` (must be on `$PATH`).
- **NEVER** overwrite `mcp.json` or `.claude/settings.json` wholesale — always
  `jq`-merge to preserve unrelated entries (git-guard, rtk, post-edit, …).
- **NEVER** delete a user's `.project-linter.yaml` without `--phases default`.
- **NEVER** print the restart prompt unless `.claude/settings.json` was
  actually modified by Agent C.
- **NEVER** spawn the daemon with `--port` different from `7717` — that's the
  hard-coded default in upstream `cmd/project-linter/cmd/serve.go` and what the
  hooks point to.
- **NEVER** run `/ktn` against a binary that reports `dev` — surface a warning
  and bail out of the upgrade step (a developer rebuilding locally doesn't
  want their workspace clobbered by a release asset).
- **NEVER** run scans here. That's `/lint`. `/ktn` owns the **lifecycle**.
- **`--check`** mode is read-only: no `Write`, no `Edit`, no `nohup`, no
  `pkill`. It exits with a structured drift report only.

## Boundaries vs `/lint`

| `/ktn` (this skill) | `/lint` |
|---|---|
| Installs / upgrades the binary | Runs scans |
| Wires hooks in `.claude/settings.json` | Reads hook output |
| Configures `.project-linter.yaml` phases | Respects the configured phase set |
| Spawns / heals the `:7717` daemon | Calls the daemon (or falls back) |

## PR8 — Daily health probe (Skills Architecture v1.3)

```bash
# Schedules a daily health probe at 08:07 local time (avoids :00 spike).
# CronCreate is gated by PR0's primitives.json.
/ktn --schedule-daily

# Equivalent:
# CronCreate(
#   cron: "7 8 * * *",
#   prompt: "/ktn --check",
#   recurring: true,
#   durable: true
# )
```

`/ktn --check` is read-only (see boundaries above). Only emits a
`PushNotification` when drift is detected; silent on a healthy stack.
