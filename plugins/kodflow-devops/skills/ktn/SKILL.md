---
name: ktn
description: 'Health-and-heal for the ktn-linter stack: binary version, its own command hooks
  (hook install, then hook doctor), the MCP entry, the per-user daemon when KTN_USER_DAEMON=1,
  and the phase config. Delegates every write to ktn-linter itself; idempotent; asks for a session
  restart only when the hooks changed.'
when_to_use: Use when a session cannot reach ktn-linter, its hooks misbehave, a fresh container
  starts, or you want a one-command sanity check of the ktn stack.
argument-hint: '[--check] [--phases <spec>] [--scope <diff|full|show>] [--restart] [--uninstall]'
model: inherit
effort: low
allowed-tools:
- Read(**/*)
- Write(mcp.json)
- Write(.ktn-linter.yaml)
- Edit(mcp.json)
- Edit(.ktn-linter.yaml)
- Bash(curl:*)
- Bash(jq:*)
- Bash(command:*)
- Bash(which:*)
- Bash(ktn-linter:*)
- Bash(project-linter:*)
- Bash(readlink:*)
- Bash(uname:*)
- Bash(chmod:*)
- Bash(mv:*)
- Bash(mkdir:*)
- Bash(tar:*)
- Bash(sha256sum:*)
- Bash(shasum:*)
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

# /ktn — ktn-linter stack, checked and healed

$ARGUMENTS

---

## Arguments

| Pattern | Action |
|---------|--------|
| _(none)_ | Full reconcile (default) |
| `--check` | Read-only diagnostic — no writes, no process started or stopped |
| `--phases <spec>` | Configure `.ktn-linter.yaml` then reconcile (spec syntax in `--help`) |
| `--scope <diff\|full\|show>` | Set `review_scope` in `.ktn-linter.yaml` (`show` = read-only, prints resolved scope) |
| `--restart` | Restart the per-user daemon (`KTN_USER_DAEMON=1`); otherwise says how the per-project one restarts |
| `--uninstall` | `ktn-linter hook uninstall`, the `mcp.json` entry removed, the per-user daemon stopped (binary kept) |
| `--help` | Show this help and STOP |

**IF `$ARGUMENTS` contains `--help`**: Print [Help](#help) verbatim and **STOP**. Do NOT spawn agents.

---

## Help

```text
═══════════════════════════════════════════════════════════════
  /ktn — ktn-linter stack, checked and healed
═══════════════════════════════════════════════════════════════

  DEFAULT (no args)
    Wave 1: binary + phases. Wave 2: hooks/mcp + daemon.
    Each agent checks ONE concern and lets ktn-linter fix it
    iff drifted. Idempotent — a second run is a no-op.

  FLAGS
    (none)                Full reconcile (default)
    --check               Read-only — never writes
    --phases <spec>       Apply phase config then reconcile
    --scope <spec>        Set review_scope (diff|full|show) then reconcile
    --restart             Restart the per-user daemon (KTN_USER_DAEMON=1)
    --uninstall           hook uninstall + mcp.json entry + daemon stop (binary kept)
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
    Daemon / MCP scan / hooks         honour review_scope (diff default)
    ktn-linter run (CLI) / make lint  ALWAYS full (CI/audit path)
    MCP scan accepts a per-request scope override from the same cached scan.

  PROJECT GATE (always first)
    Detects Go via rtk grep (go.mod, *.go, BUILD.bazel rules, etc).
    If no signal: pauses with a Yes/No AskUserQuestion prompt.
    Cancel = abort, no writes. Confirm = continue.

  AGENTS (after the gate)
    1. binary       Install / upgrade ktn-linter + ktn-hook
    2. phases       Validate .ktn-linter.yaml (write if --phases/--scope)
    3. hooks        ktn-linter hook install → hook doctor --json → mcp install
    4. daemon       KTN_USER_DAEMON=1: ktn-linter daemon ensure|status|stop
                    otherwise: the MCP server's own daemon (nothing to start)

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
    Anything was written     → consolidated report + restart prompt
                                iff hook install wrote the user settings
    --check finds drift      → non-zero report, no writes

═══════════════════════════════════════════════════════════════
```

---

## Overview

`/ktn` is a **read–decide–heal** loop, not a configuration UI. It checks the
stack around `ktn-linter` and complements `kodflow-review:lint` (which runs scans). It never
writes a hook entry, never kills a process and never binds a port itself:
ktn-linter owns its hooks (`hook install|uninstall|doctor`) and its per-user
daemon (`daemon ensure|start|stop|status`), and `/ktn` calls them. A second
writer of the same entries — the HTTP-hook reconciler this skill used to carry
— rewrote what `hook install` had just removed, and two reconciliations in two
worktrees killed each other's daemon by port (kodflow/ktn-linter#771).

**Name.** The binary is `ktn-linter` and the configuration `.ktn-linter.yaml`.
`project-linter` / `.project-linter.yaml`, the old names, are only a detection
fallback when `ktn-linter` is not on PATH: they are reported, and the binary
agent replaces them with a `ktn-linter` install.

| Agent | Wave | Reads | Writes (through) | Network |
|-------|------|-------|------------------|---------|
| `binary` | 1 | `command -v ktn-linter`, `ktn-linter version` | the binary's directory (`ktn-linter upgrade`, or the release archive) | GitHub releases (public mirror `kodflow/ktn`) |
| `phases` | 1 | `.ktn-linter.yaml` | `.ktn-linter.yaml` (only with `--phases` / `--scope`) | — |
| `hooks` | 2 | `ktn-linter hook doctor --json`, `mcp.json` | user settings (`ktn-linter hook install`), `mcp.json` (`ktn-linter mcp install`) | — |
| `daemon` | 2 | `ktn-linter daemon status` | none — `ktn-linter daemon ensure\|stop` | — |

Wave 2 waits for wave 1 because it runs the binary wave 1 installs. Inside a
wave no two agents touch the same path. Inside `hooks` the order is fixed:
`hook install` before `mcp install`, because `mcp install` writes the
per-project hooks only when no user-level install exists — run the other way
round, every event would be delivered twice.

### Daemon guard

> The CLI (`ktn-linter run`) refuses to rescan beside a live per-project daemon
> (exit `DaemonActive=42`), and under the per-user daemon it waits for a slot.
> Bypass with `--force` or `KTN_FORCE_LOCAL=1` (prints a loud EXCEPTIONAL
> OVERRIDE notice). A template-consumer project's `make lint` should **NOT**
> add `--force` — the guard keeps CI and the live daemon from disagreeing.
>
> Note the scope asymmetry: the daemon / MCP scan honour the root
> `review_scope` field (default `diff` — only issues on code changed vs the
> default branch), while `ktn-linter run` and `make lint` ALWAYS run `full`. An
> existing project with NO `review_scope` field silently moves from
> whole-project to `diff`; pin `review_scope: full` to restore the legacy view.

### `--uninstall` mode

Reverses the lifecycle, still through ktn-linter:

| Agent | Action |
|-------|--------|
| `hooks` | `ktn-linter hook uninstall` (every entry of ours, every form, from the user host files), then the `ktn-linter` entry (and a legacy `project-linter` one) deleted from `mcp.json` |
| `daemon` | `KTN_USER_DAEMON=1`: `ktn-linter daemon stop`; otherwise nothing to stop — the per-project daemon is the MCP server and ends with the session |
| `binary` | Skipped — the binary is intentionally kept |
| `phases` | Skipped — `.ktn-linter.yaml` belongs to the user |

Restart prompt fires iff `hook uninstall` changed the user settings.

---

## Phase 0 — Project gating (MANDATORY first step)

ktn-linter only applies to Go repositories. Detect Go signals (go.mod/go.work,
then any `*.go`, then ancillary markers) and **stop the skill** when none are
found — do not heal a stack the project cannot use. Detection script and exit
contract: read `gating.md`.

## Phase 1 — Pre-flight (host, not an agent)

Execute these checks before spawning any agent. They define the per-agent
inputs:

```bash
# Target dirs
WORKSPACE="${WORKSPACE_FOLDER:-/workspace}"
MCP_FILE="$WORKSPACE/mcp.json"
PHASES_FILE="$WORKSPACE/.ktn-linter.yaml"
# The old name, read only when the new one is absent
[ -f "$PHASES_FILE" ] || { [ -f "$WORKSPACE/.project-linter.yaml" ] && PHASES_FILE="$WORKSPACE/.project-linter.yaml"; }

# The binary: ktn-linter, else the old name as a detection fallback
BIN=$(command -v ktn-linter || command -v project-linter || echo absent)

# The per-user daemon is opt-in (kodflow/ktn-linter#757)
USER_DAEMON=0
[ "${KTN_USER_DAEMON:-}" = 1 ] && USER_DAEMON=1

# OS/arch for the release archive
case "$(uname -s)" in
    Linux)   GOOS="linux"  ;;
    Darwin)  GOOS="darwin" ;;
    *)       echo "✗ Unsupported OS: $(uname -s)"; exit 1 ;;
esac
case "$(uname -m)" in
    x86_64|amd64)   GOARCH="amd64" ;;
    aarch64|arm64)  GOARCH="arm64" ;;
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
[ktn] os=<linux|darwin>/<arch> bin=<ktn-linter|project-linter|absent> user-daemon={0|1} mode={reconcile|check|uninstall} phases-spec={none|<spec>} restart={0|1}
```

---

## Phase 2 — Agent dispatch

Two waves: `binary` and `phases` in one message, then `hooks` and `daemon` in
one message once wave 1 has returned. Full prompts and contracts: read
`dispatch.md`.

## Phase 3 — Synthesize results

Collect the 4 JSON payloads. Decide the final user message in this order:

1. **Any `status: "error"`** → print the agent's `notes` line by line under a
   `═══ /ktn — ERRORS` banner, then list any agent that did succeed.
   Exit non-zero in spirit (return code is informational; the user sees the report).

2. **All `status: "ok"` AND no agent reports `wrote_file: true` AND
   `daemon.action` is `noop` or `not-applicable`** → silent OK:

   ```text
   ✓ ktn-linter healthy — nothing to do.
       binary    {version} ({path})
       hooks     hook doctor ok  ({hook_binary})
       mcp       registered
       daemon    {per-user: status ok | per-project: the MCP server's own}
       phases    {active_set}  scope={diff|full}  (source={default|yaml})
   ```

   In `--check` mode, a doctor defect or an unhealthy per-user daemon is
   reported as drift instead, with the defect codes `hook doctor --json`
   listed and the command that heals it (`/ktn` without `--check`).

3. **Otherwise (any fix happened)** → consolidated report:

   ```text
   ═══════════════════════════════════════════════════════════════
     /ktn — reconcile complete
   ═══════════════════════════════════════════════════════════════

     binary    {before} → {after}   {action}
     hooks     doctor {defects before → ok}   install={written|unchanged}
     mcp       {drift → none}        wrote={true|false}
     daemon    {status before → after}  {action}
     phases    active={...}  scope={diff|full}  source={default|yaml|cli}  wrote={true|false}
   ```

   **Conditional restart prompt** — print ONLY when `hooks.wrote_file == true`
   (`hook install` or `hook uninstall` reported `(written)`):

   ```text
   ⚠ Restart the Claude Code session to activate the new hooks.
     (settings.json is read at session start — current session is unhooked.)
   ```

   If only `binary` / `mcp` / `daemon` / `phases` changed, DO NOT print the
   restart prompt — mcp.json is read by the MCP client, phases hot-reload via
   the daemon watcher, `daemon ensure` acts in place.

---

## Idempotency contract

Two consecutive `/ktn` invocations from a clean state MUST produce zero file
changes on the second run:

| Agent | Idempotency key |
|-------|----------------|
| binary | local version == latest tag, `ktn-hook` beside `ktn-linter` |
| hooks | `ktn-linter hook doctor --json` → `ok: true`; `hook install` reports `(unchanged)`; `mcp.json` holds the `ktn-linter` entry |
| daemon | `KTN_USER_DAEMON=1`: `ktn-linter daemon status` exits 0; otherwise nothing to check |
| phases | `.ktn-linter.yaml` parses; no spec passed |

If you find yourself writing the same file twice in a row, you have a bug in
the drift detection — fix the detection, not the write logic.

---

## Guardrails

- **NEVER** write a hook entry into any `settings.json` by hand: `ktn-linter
  hook install` is the one writer of ktn-linter's hooks, `hook uninstall` the
  one remover, `hook doctor` the one judge.
- **NEVER** kill a process by port or by pattern (`kill`, `pkill`) and never
  start `serve` yourself: the per-user daemon is `ktn-linter daemon
  ensure|stop`; the per-project one is the MCP server, restarted with the
  session or by `make hooks-install` / `ktn-linter mcp install`.
- **NEVER** overwrite `mcp.json` wholesale — `ktn-linter mcp install` merges,
  and the uninstall `jq` deletes one key, preserving every other server.
- **NEVER** delete a user's `.ktn-linter.yaml` without `--phases default`.
- **NEVER** print the restart prompt unless `hook install` / `hook uninstall`
  actually wrote the user settings.
- **NEVER** run `/ktn` against a binary that reports `dev` — surface a warning
  and bail out of the upgrade step (a developer rebuilding locally doesn't
  want their workspace clobbered by a release asset).
- **NEVER** run scans here. That's `kodflow-review:lint`. `/ktn` owns the **lifecycle**.
- **`--check`** mode is read-only: no `Write`, no `Edit`, no `hook install`,
  no `mcp install`, no `daemon ensure|stop`. It exits with a structured drift
  report only (`hook doctor --json`, `daemon status`).

## Boundaries vs `kodflow-review:lint` and `/ktn-view`

| `/ktn` (this skill) | `kodflow-review:lint` |
|---|---|
| Installs / upgrades the binary | Runs scans |
| Runs `ktn-linter hook install` and `hook doctor` | Reads hook output |
| Configures `.ktn-linter.yaml` phases | Respects the configured phase set |
| Runs `ktn-linter daemon ensure` (per-user) | Calls the daemon (or falls back) |

`/ktn-view` (plugin `kodflow-ktn`) shows the per-user daemon's state and
findings in a pane, and its launch button runs the same `daemon ensure`; it
never touches the binary, the hooks or `mcp.json`, and `/ktn` draws nothing.

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
