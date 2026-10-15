# /ktn — Phase 2: agent dispatch

Four specialists in two waves, one concern each. Read this when Phase 1
(pre-flight) has completed and the reconcile decision is made.

## Phase 2 — Agent dispatch (two messages, 2 Task calls each)

**Wave 1** — `binary` and `phases` in ONE assistant message, so they run
concurrently. **Wave 2** — `hooks` and `daemon` in ONE message, sent once wave
1 has returned: both run the binary wave 1 installs or upgrades. Each agent
receives a self-contained prompt and acts on its own concern only. When
route-agent.sh answers with its `general-purpose` fallback (exit 10), the
prompt carries `[general-purpose-ok]`, the `marker` of that JSON: the
kodflow-hooks routing gate reads it as a deliberate dispatch.

Every write of a hook entry, of the per-user daemon's state and of the MCP
entry goes through ktn-linter's own subcommands. No agent edits a
`settings.json`, kills a process or binds a port (kodflow/ktn-linter#771).

The binary is `ktn-linter`. `project-linter` is the old name: an agent finding
only that one on PATH reports it and uses it for read-only probes, and the
binary agent installs `ktn-linter` in its place.

### Agent A — `binary` (wave 1)

```yaml
# PR4 — Skills Architecture v1.3: routed via route-agent.sh to
# devops-executor-linux instead of general-purpose. The route-agent
# call returns {subagent_type, resolved_model, effort}; pass them
# through to the Task primitive.
subagent_type: kodflow-specialists:devops-executor-linux
description: "ktn-linter binary health + upgrade"
prompt: |
  You manage the ktn-linter binary lifecycle. Goal: ktn-linter and ktn-hook
  (the client its command hooks run, shipped in the same archive) are
  present, side by side, at the latest release.

  Mode: {{READ_ONLY ? "read-only — REPORT ONLY, do not write" : "reconcile"}}

  STEP 1 — Detect current state
    a. resolved_path = `command -v ktn-linter || echo absent`
       If absent, legacy_path = `command -v project-linter || echo absent`
       (the old name: reported, never upgraded in place).
    b. local_version = `ktn-linter version 2>/dev/null | head -1` (parse
       `ktn-linter version X.Y.Z`). If output contains "dev" → dev_build=true.
    c. hook_client = ktn-hook in the directory of the real binary, present
       and executable? Follow the symlinks with plain `readlink` — macOS's
       has no `-f`, and an empty result would look for ./ktn-hook:
         p=$resolved_path
         while [ -L "$p" ]; do
             t=$(readlink "$p")
             case "$t" in /*) p=$t ;; *) p=$(dirname "$p")/$t ;; esac
         done
         hook_client=$(dirname "$p")/ktn-hook
    d. latest_tag = WebFetch
       https://api.github.com/repos/kodflow/ktn/releases/latest →
       extract `.tag_name` (strip leading `v`). kodflow/ktn is the public
       mirror of the releases; the source repository is private.

  STEP 2 — Decide
    - absent (only project-linter, or nothing) → INSTALL
    - dev_build=true → SKIP (refuse upgrade over dev build, surface warning)
    - local_version < latest_tag (semver) → UPGRADE
    - ktn-hook missing beside the binary → INSTALL (same directory)
    - else → NO-OP

  STEP 3 — Act (skip entirely in --check mode)
    INSTALL path:
      target_dir = the directory of an existing ktn-linter, else the first
        writable of ~/.local/bin, ~/bin (must be on $PATH)
      asset = ktn-linter_{{GOOS}}_{{GOARCH}}.tar.gz
      base  = https://github.com/kodflow/ktn/releases/download/v{{latest_tag}}
      work=$(mktemp -d)
      curl -fsSL "$base/$asset" -o "$work/$asset"
      curl -fsSL "$base/checksums.txt" -o "$work/checksums.txt"
      verify: the sha256 of "$work/$asset" (sha256sum, or shasum -a 256)
        equals the checksums.txt line naming "$asset" — refuse otherwise
      tar -xzf "$work/$asset" -C "$work" ktn-linter ktn-hook
      for each of ktn-linter, ktn-hook: copy to a temporary file in
        target_dir, chmod 755, mv over the final name (same-directory rename)
    UPGRADE path:
      Prefer `ktn-linter upgrade` (atomic rename in the same dir, dev-build
      aware). If ktn-hook is still missing or older afterwards, or the
      upgrade fails, fall back to the INSTALL path.

  STEP 4 — Verify
    `ktn-linter version` reports the expected version and ktn-hook sits
    beside it (`ktn-linter hook doctor` in wave 2 reports a client of
    another build as `client_build`).

  RETURN exactly this JSON on the last line of your reply:
  {
    "agent": "binary",
    "status": "ok|fixed|skipped|error",
    "action": "noop|installed|upgraded|refused-dev-build",
    "before": "absent|X.Y.Z|dev|project-linter X.Y.Z",
    "after":  "X.Y.Z",
    "path":   "~/.local/bin/ktn-linter|...",
    "hook_client": "present|missing",
    "notes":  "..."
  }
```

### Agent B — `phases` (wave 1)

```yaml
# PR4 — Skills Architecture v1.3: routed via route-agent.sh to
# devops-executor-linux instead of general-purpose. The route-agent
# call returns {subagent_type, resolved_model, effort}; pass them
# through to the Task primitive.
subagent_type: kodflow-specialists:devops-executor-linux
description: ".ktn-linter.yaml phase configuration"
prompt: |
  You manage /workspace/.ktn-linter.yaml. Upstream default active set is
  {1..7} (phase 8 = `tests` is opt-in). Don't touch the file unless a
  PHASES_SPEC was provided OR the file is invalid. When only
  .project-linter.yaml exists (the old name), read it, report it, and write
  any change to .ktn-linter.yaml instead.

  PHASES_SPEC: {{PHASES_SPEC or "(none)"}}
  SCOPE_SPEC: {{SCOPE_SPEC or "(none)"}}
  Mode: {{READ_ONLY ? "read-only" : "reconcile"}}

  STEP 1 — Read .ktn-linter.yaml if present.
    Parse `phases.enabled` and `phases.disabled`. Reject if BOTH are set
    (ErrPhasesEnabledDisabledMutex) — surface drift=mutex-violation.
    Reject legacy `max_phase:` (ErrMaxPhaseRemoved) — drift=legacy-max-phase.

    Also parse the ROOT `review_scope` field (sibling of `phases:`).
    Validate it is one of {diff, full}; a typo like `difff` →
    surface drift=invalid-review-scope (mirror ErrInvalidReviewScope).
    Absent field → resolved scope is the default `diff` (scope_source=default,
    or scope_source=yaml when the field is present and valid).

    Token parser (per pkg/config/phasetoken.go):
      ints 1..9 OR canonical/variant aliases (case-insensitive):
        1 structural    2 signatures|signature  3 logic
        4 performance|perf  5 modern  6 style
        7 comment|comments  8 tests|test  9 health
      Unknown → ErrInvalidPhaseAlias.

  STEP 2 — Apply PHASES_SPEC (if any, skip in --check mode)
    "default"        → delete file (or write {version:1, phases:{enabled:[1,2,3,4,5,6,7]}})
    "all"            → phases.enabled = [1..8]
    "1-7"            → range expand
    "1,3,6"          → explicit subset
    "structural,logic,style" → alias → ints, sort, dedupe
    "+tests"         → current ∪ {8}
    "-comment"       → current \ {7}
    "show"           → DO NOT write; just report the resolved active set
                       with source precedence (CLI > YAML > default)

  STEP 2b — Apply SCOPE_SPEC (if any, skip writes in --check / read-only mode)
    "diff"   → set root review_scope: diff (scope_source=cli)
    "full"   → set root review_scope: full (scope_source=cli)
    "show"   → DO NOT write; report the resolved review_scope + source
               with precedence (CLI > YAML > default)
    unknown  → drift=invalid-review-scope, do NOT write
    Writing review_scope MUST preserve the existing `phases:` block — it is a
    sibling root key; merge it in, never overwrite the file wholesale.

  STEP 3 — Validate after write
    Re-parse the file: every phase entry must be an int 1..9 and
    enabled/disabled cannot both be set; `review_scope`, if present, must be
    one of {diff, full}.

  RETURN:
  {
    "agent": "phases",
    "status": "ok|fixed|error",
    "drift": "none|mutex-violation|legacy-max-phase|invalid-alias|out-of-range|invalid-review-scope|legacy-file-name|none-spec-applied",
    "active_set": [1,2,3,4,5,6,7],
    "source": "default|yaml|cli",
    "review_scope": "diff|full",
    "scope_source": "default|yaml|cli",
    "wrote_file": true|false,
    "notes": "..."
  }
```

### Agent C — `hooks` (wave 2)

```yaml
# PR4 — Skills Architecture v1.3: routed via route-agent.sh to
# devops-executor-linux instead of general-purpose. The route-agent
# call returns {subagent_type, resolved_model, effort}; pass them
# through to the Task primitive.
subagent_type: kodflow-specialists:devops-executor-linux
description: "ktn-linter hooks + mcp.json entry"
prompt: |
  You check ktn-linter's command hooks and its MCP entry, and let ktn-linter
  repair them. You NEVER edit a settings.json yourself: `ktn-linter hook
  install` is the one writer of those entries, `hook uninstall` the one
  remover, `hook doctor` the one judge.

  Mode: {{UNINSTALL ? "uninstall" : (READ_ONLY ? "read-only" : "reconcile")}}

  STEP 1 — Preconditions
    BIN=$(command -v ktn-linter) — if absent → reason=binary-missing (Agent A
    reports why). A binary that answers exit 40 to `hook doctor` predates
    `hook install` (ktn-linter v1.46.0) → reason=binary-too-old. Either way
    nothing below that runs ktn-linter is attempted: in reconcile and
    read-only mode return status=skipped (missing) or error (too old). In
    UNINSTALL mode still run STEP 3 UNINSTALL b (the mcp.json entry needs no
    binary) and return status=error with the hook removal reported as not
    done, naming `ktn-linter hook uninstall` to run once a current binary is
    installed.

  STEP 2 — Judge
    before=$(ktn-linter hook doctor --json)   # exit 0 sound, 1 with defects
    Keep `.ok` and every `.defects[].code` (not_installed, missing_entry,
    stale_entry, legacy_http, client_missing, client_build,
    unreadable_file, hooks_path) for the report.

  STEP 3 — Act (skip entirely in --check mode)
    RECONCILE, in this order:
      a. ktn-linter hook install
         Its output says, per host, `(written)` or `(unchanged)`;
         wrote_file = any `(written)`. It replaces our entries of an older
         form — the per-project HTTP hooks included — in place, and keeps
         every other byte of the file.
      b. after=$(ktn-linter hook doctor --json) — must report "ok": true.
         A defect hook install cannot fix (hooks_path: the git hooks
         directory in force lacks commit-msg; unreadable_file) is reported
         with its message, never patched by hand.
      c. ktn-linter mcp install
         Run AFTER (a): with the user-level hooks in place it writes the
         mcp.json entry only, not the per-project hooks — before (a), every
         event would be delivered twice. In ktn-linter's own repository
         `make hooks-install` is the same bootstrap and may be run instead.
    UNINSTALL (b runs even when a cannot, see STEP 1):
      a. ktn-linter hook uninstall   (wrote_file = any `(written)`)
      b. delete the entry from mcp.json, preserving every other server:
         jq 'del(.servers["ktn-linter"], .mcpServers["ktn-linter"],
                 .servers["project-linter"], .mcpServers["project-linter"])' \
           mcp.json > mcp.json.new && mv mcp.json.new mcp.json

  STEP 4 — Verify
    reconcile: `ktn-linter hook doctor --json` → `.ok == true`, and
      `jq -e '(.servers["ktn-linter"]? // .mcpServers["ktn-linter"]?) != null' mcp.json`
    uninstall: `ktn-linter hook doctor --json` → a `not_installed` defect,
      and no ktn-linter / project-linter key left in mcp.json.

  CRITICAL: when wrote_file is true the host prints a session-restart prompt.
  Claude Code re-reads settings.json only at session start.

  RETURN:
  {
    "agent": "hooks",
    "status": "ok|fixed|skipped|error",
    "doctor_before": {"ok": true|false, "defects": ["legacy_http", ...]},
    "doctor_after":  {"ok": true|false, "defects": [...]},
    "hook_binary": "<.hook_binary of the doctor report>",
    "wrote_file": true|false,
    "mcp": "registered|written|removed|missing",
    "notes":  "..."
  }
```

### Agent D — `daemon` (wave 2)

```yaml
# PR4 — Skills Architecture v1.3: routed via route-agent.sh to
# devops-executor-linux instead of general-purpose. The route-agent
# call returns {subagent_type, resolved_model, effort}; pass them
# through to the Task primitive.
subagent_type: kodflow-specialists:devops-executor-linux
description: "ktn-linter per-user daemon"
prompt: |
  You check ktn-linter's daemon through ktn-linter alone. You DO NOT write
  any file, probe any port, or signal any process: no kill, no pkill, no
  `serve` started by hand.

  Mode: {{UNINSTALL ? "uninstall" : (READ_ONLY ? "read-only" : (FORCE_RESTART ? "force-restart" : "reconcile"))}}
  KTN_USER_DAEMON: {{USER_DAEMON}}

  STEP 1 — Preconditions
    If `command -v ktn-linter` fails → status=skipped,
    reason=binary-missing.

  STEP 2 — Without the per-user daemon (KTN_USER_DAEMON is not 1)
    The daemon is per project: the MCP server registered in mcp.json starts
    it with the session (Agent C keeps that entry). There is nothing here to
    start, stop or restart. Return status=ok, action=not-applicable, with
    this note: "per-project daemon: restart the Claude Code session, or run
    `make hooks-install` (ktn-linter's own repository) / `ktn-linter mcp
    install` to re-register it". With --restart, say exactly that.

  STEP 3 — With the per-user daemon (KTN_USER_DAEMON=1, kodflow/ktn-linter#757)
    before = exit code of `ktn-linter daemon status`
             (0 healthy; 1-5: see ktn-linter's runbook — keep its output)
    READ-ONLY: report `before`, act on nothing.
    RECONCILE: before != 0 → `ktn-linter daemon ensure` (the one path that
      (re)launches it); else noop.
    FORCE-RESTART: `ktn-linter daemon stop`, then `ktn-linter daemon ensure`.
    UNINSTALL: `ktn-linter daemon stop` (endpoint.json is kept; nothing is
      respawned).
    after = exit code of `ktn-linter daemon status`.

  RETURN:
  {
    "agent": "daemon",
    "status": "ok|fixed|skipped|error",
    "mode": "per-user|per-project",
    "before_status": <int|null>,
    "after_status":  <int|null>,
    "action": "noop|ensured|restarted|stopped|not-applicable",
    "notes":  "..."
  }

  Status decision matrix (per-user):
    - before == 0 && !force-restart       → status=ok,    action=noop
    - before != 0 && READ_ONLY            → status=ok,    action=noop  (drift surfaced via before_status)
    - before != 0 && !READ_ONLY, after==0 → status=fixed, action=ensured
    - force-restart && !READ_ONLY         → status=fixed, action=restarted
    - after != 0 after ensure             → status=error, notes=<daemon status output>
```

---
