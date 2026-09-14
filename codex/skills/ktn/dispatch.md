# /ktn — Phase 2: parallel agent dispatch

Five specialists, one message, one concern each. Read this when Phase 1
(pre-flight) has completed and the reconcile decision is made.

## Phase 2 — Parallel agent dispatch (single message, 5 Task calls)

**MANDATORY: spawn all 5 agents in ONE assistant message** so they execute
concurrently. Each agent receives a self-contained prompt + permission to
write its own file only.

### Agent A — `binary`

```yaml
# PR4 — Skills Architecture v1.3: routed via route-agent.sh to
# devops-executor-linux instead of general-purpose. The route-agent
# call returns {subagent_type, resolved_model, effort}; pass them
# through to the Task primitive.
subagent_type: devops-executor-linux
description: "project-linter binary health + upgrade"
prompt: |
  You manage the project-linter binary lifecycle. Goal: make sure the local
  project-linter binary is present and matches the latest GitHub release.

  Mode: {{READ_ONLY ? "read-only — REPORT ONLY, do not write" : "reconcile"}}

  STEP 1 — Detect current state
    a. resolved_path = `command -v project-linter || echo absent`
    b. local_version = `project-linter version 2>/dev/null | head -1` (parse
       `project-linter version X.Y.Z`). If output contains "dev" → dev_build=true.
    c. latest_tag = WebFetch
       https://api.github.com/repos/kodflow/project-linter/releases/latest →
       extract `.tag_name` (strip leading `v`).

  STEP 2 — Decide
    - absent → INSTALL
    - dev_build=true → SKIP (refuse upgrade over dev build, surface warning)
    - local_version < latest_tag (semver) → UPGRADE
    - else → NO-OP

  STEP 3 — Act (skip entirely in --check mode)
    INSTALL path:
      target_dir = first writable of:
        /usr/local/bin (try sudo -n mv)
        ~/.local/bin
        ~/bin
      mkdir -p $target_dir && ensure on $PATH
      asset_url = https://github.com/kodflow/project-linter/releases/download/v{{latest_tag}}/project-linter-{{GOOS}}-{{GOARCH}}
      curl -fsSL "$asset_url" -o /tmp/project-linter.new
      chmod +x /tmp/project-linter.new
      mv /tmp/project-linter.new $target_dir/project-linter
    UPGRADE path:
      Prefer `project-linter upgrade` (atomic rename in same dir, ErrDevBuild aware).
      If that fails OR dev_build=true, fall back to INSTALL path with --force semantics.

  STEP 4 — Verify
    `project-linter version` reports the expected version.

  RETURN exactly this JSON on the last line of your reply:
  {
    "agent": "binary",
    "status": "ok|fixed|skipped|error",
    "action": "noop|installed|upgraded|refused-dev-build",
    "before": "absent|X.Y.Z|dev",
    "after":  "X.Y.Z",
    "path":   "/usr/local/bin/project-linter|...",
    "notes":  "..."
  }
```

### Agent B — `mcp`

```yaml
# PR4 — Skills Architecture v1.3: routed via route-agent.sh to
# devops-executor-linux instead of general-purpose. The route-agent
# call returns {subagent_type, resolved_model, effort}; pass them
# through to the Task primitive.
subagent_type: devops-executor-linux
description: "mcp.json project-linter registration"
prompt: |
  You own the project-linter entry inside /workspace/mcp.json.

  Mode: {{UNINSTALL ? "uninstall" : (READ_ONLY ? "read-only" : "reconcile")}}

  Canonical schema for this repo: the postStart merger writes the merged
  config under the top-level `.servers` key (see
  /etc/mcp/mcp.json.tpl — `{"servers": {...}}`), with the Go feature
  fragment defining project-linter as `command: "project-linter", args: ["serve"]`
  (port 7717 is the upstream default in cmd/project-linter/cmd/serve.go).
  Some setups use the legacy `.mcpServers` key — accept either on read,
  but write to `.servers` to match this repo's template.

  STEP 1 — Read current mcp.json
    If file absent → drift=missing-file; the postStart MCP merger will
    regenerate it from /etc/mcp/mcp.json.tpl on next container start, so in
    that case we only write a minimal stub IFF reconcile mode AND the
    template merger is unavailable. Otherwise report drift and exit.

  STEP 2 — Detect drift
    Required shape (under `.servers` for this repo, but accept `.mcpServers`
    on read):
      "project-linter": {
        "command": "project-linter",
        "args": ["serve"]          (canonical; "--port" "7717" also valid)
      }
    drift = none if either args==["serve"] OR args==["serve","--port","7717"];
            missing-entry | mismatched-args | missing-file otherwise.

  STEP 3 — Act (skip in --check mode)
    Prefer the canonical upstream entrypoint:
      project-linter mcp install --port=7717
    which writes mcp.json + merges .claude/settings.json in one idempotent
    call (see upstream cmd/project-linter/cmd/mcp_install.go).
    If `project-linter mcp install` is unavailable (older binary, missing
    subcommand), fall back to a `jq` merge that writes ONLY the
    project-linter entry under `.servers`, preserving every other server:
      jq '.servers["project-linter"] = {command:"project-linter",args:["serve"]}' \
        mcp.json > mcp.json.new && mv mcp.json.new mcp.json
    NEVER rewrite the whole file by hand.

    UNINSTALL mode: remove project-linter from .servers AND .mcpServers
    (delete both keys; idempotent if absent):
      jq 'del(.servers["project-linter"], .mcpServers["project-linter"])' \
        mcp.json > mcp.json.new && mv mcp.json.new mcp.json

  STEP 4 — Verify
    `jq -e '(.servers["project-linter"]? // .mcpServers["project-linter"]?) | (.command == "project-linter" and (.args[0]? == "serve"))' mcp.json`
    For uninstall: the inverse — both keys must be null.

  RETURN:
  {
    "agent": "mcp",
    "status": "ok|fixed|error",
    "drift":  "none|missing-entry|mismatched-args|missing-file",
    "wrote_file": true|false,
    "schema_key": "servers|mcpServers",
    "notes":  "..."
  }
```

### Agent C — `settings`

```yaml
# PR4 — Skills Architecture v1.3: routed via route-agent.sh to
# devops-executor-linux instead of general-purpose. The route-agent
# call returns {subagent_type, resolved_model, effort}; pass them
# through to the Task primitive.
subagent_type: devops-executor-linux
description: ".claude/settings.json hook wiring"
prompt: |
  You own the project-linter HTTP hook entries inside /workspace/.claude/settings.json.

  Mode: {{UNINSTALL ? "uninstall" : (READ_ONLY ? "read-only" : "reconcile")}}

  Required entries (idempotency key = URL prefix "http://localhost:7717"):

    hooks.PreToolUse[]:
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "http",
                    "url":  "http://localhost:7717/hooks/pre-tool-use",
                    "timeout": 5 }] }

    hooks.PostToolUse[]:
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "http",
                    "url":  "http://localhost:7717/hooks/post-tool-use",
                    "timeout": 15 }] }

  STEP 1 — Read settings.json (create empty {} if absent and reconcile mode).
  STEP 2 — Detect drift
    For each of {pre, post}: missing-entry if no hooks-array entry contains
    any inner hook with URL starting with "http://localhost:7717/hooks/".
    DO NOT touch unrelated existing hooks (e.g. command-type git-guard, rtk,
    post-edit). Merge as a NEW item appended to the existing PreToolUse /
    PostToolUse arrays.
  STEP 3 — Act (skip in --check mode)
    Use `jq` deep-merge. NEVER overwrite the whole settings.json.
    If PreToolUse[] / PostToolUse[] don't exist yet, create them as arrays.
    If the matcher "Edit|Write|MultiEdit" already exists but lacks the HTTP
    hook, append the HTTP hook into THAT entry's "hooks" array — do NOT
    create a duplicate matcher entry.

    UNINSTALL mode: delete every inner hook whose URL startswith
    "http://localhost:7717/hooks/" from both PreToolUse and PostToolUse,
    then drop any matcher whose hooks array becomes empty:
      jq '(.hooks.PreToolUse, .hooks.PostToolUse) |= (map(.hooks |= map(select((.url? // "") | startswith("http://localhost:7717/") | not)) | select(.hooks | length > 0)))' \
        settings.json > settings.json.new && mv settings.json.new settings.json
    DO NOT touch unrelated hooks (git-guard, rtk, post-edit, …).

  STEP 4 — Verify
    `jq -e '
      (.hooks.PreToolUse  // []) | any(.hooks[]?; .url? // "" | startswith("http://localhost:7717/")) and
      (.hooks.PostToolUse // []) | any(.hooks[]?; .url? // "" | startswith("http://localhost:7717/"))
    ' settings.json`

  CRITICAL: if you write this file, the host will print a session-restart
  prompt. Claude Code re-reads settings.json only at session start.

  RETURN:
  {
    "agent": "settings",
    "status": "ok|fixed|error",
    "drift":  "none|pre-missing|post-missing|both-missing|file-missing",
    "wrote_file": true|false,
    "added_entries": ["pre"|"post"|...],
    "notes":  "..."
  }
```

### Agent D — `daemon`

```yaml
# PR4 — Skills Architecture v1.3: routed via route-agent.sh to
# devops-executor-linux instead of general-purpose. The route-agent
# call returns {subagent_type, resolved_model, effort}; pass them
# through to the Task primitive.
subagent_type: devops-executor-linux
description: "project-linter daemon health + freshness on :7717"
prompt: |
  You verify and (if needed) respawn the project-linter MCP daemon on
  127.0.0.1:7717. You DO NOT write any file.

  Mode: {{UNINSTALL ? "uninstall" : (READ_ONLY ? "read-only" : (FORCE_RESTART ? "force-restart" : "reconcile"))}}

  Canonical daemon command (matches Go feature MCP fragment in this repo):
    project-linter serve --port=7717
  (NOT `project-linter mcp serve` — the upstream entrypoint is the top-level
  `serve` subcommand defined in cmd/project-linter/cmd/serve.go.)

  CRITICAL: "healthy" and "running the current binary" are two INDEPENDENT
  gates. A daemon whose binary was rebuilt or replaced keeps serving from
  its in-memory image — /health still returns 200, but the analyzer code is
  frozen at the pre-rebuild commit. Linux marks this with
  `/proc/<pid>/exe → <path> (deleted)`. Reusing such a daemon means phantom
  findings against on-disk source the user has already fixed (issue #361).

  STEP 1 — Preconditions
    If `command -v project-linter` fails → status=skipped, reason=binary-missing,
    return immediately (Agent A will install it; you respawn on next /ktn run
    after session restart).
    Resolve BIN_REAL once for later freshness checks:
      BIN=$(command -v project-linter)
      BIN_REAL=$(readlink -f "$BIN" 2>/dev/null || echo "$BIN")

  STEP 2 — Probe liveness
    health = curl -fsS --max-time 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:7717/health
    ready  = same on /ready
    Decide alive = (health == 200).

  STEP 3 — Discover the port owner (PID by port, NOT by pgrep pattern)
    pgrep on a command-line pattern is fragile: this template's MCP fragment
    spawns `project-linter serve --port 7717` (space-separated), but upstream
    install-hooks.sh spawns `project-linter mcp serve --port=7717`. Port
    ownership is unambiguous and covers every invocation shape.

      DAEMON_PID=""
      if command -v ss >/dev/null 2>&1; then
          DAEMON_PID=$(ss -H -ltnp 'sport = :7717' 2>/dev/null \
              | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)
      fi
      if [ -z "$DAEMON_PID" ] && command -v lsof >/dev/null 2>&1; then
          DAEMON_PID=$(lsof -tiTCP:7717 -sTCP:LISTEN 2>/dev/null | head -1 || true)
      fi

  STEP 4 — Freshness gate (independent from liveness, FAIL-CLOSED)
    # Default to STALE when alive but unverifiable. The whole point of the
    # gate is to refuse reuse of a daemon we can't prove is running the
    # current binary — silently leaving STALE=false on "I don't know" is
    # exactly the fail-open hole that issue #361 exists to close.
    STALE=false
    STALE_REASON=""
    DAEMON_EXE_RAW=""

    if [ "$alive" = "true" ]; then
        if [ -z "$DAEMON_PID" ]; then
            # Daemon answers /health but ss/lsof couldn't identify the owner
            # (e.g. busybox container with no port-discovery tools, namespace
            # boundary, locked-down /proc). We cannot verify freshness →
            # treat as stale so the reconcile path kills + respawns.
            STALE=true
            STALE_REASON="missing-exe-path"
        elif [ ! -r "/proc/$DAEMON_PID/exe" ]; then
            # PID known but /proc/<pid>/exe unreadable (perm, hidepid=2,
            # PID raced and exited). Same conclusion: cannot verify →
            # stale.
            STALE=true
            STALE_REASON="missing-exe-path"
        else
            DAEMON_EXE_RAW=$(readlink "/proc/$DAEMON_PID/exe" 2>/dev/null || true)

            if [ -z "$DAEMON_EXE_RAW" ]; then
                STALE=true
                STALE_REASON="missing-exe-path"
            else
                # Kernel marker for an unlinked inode whose process still
                # holds the old image. Canonical "rebuilt while running"
                # signature on Linux.
                case "$DAEMON_EXE_RAW" in
                    *"(deleted)"*)
                        STALE=true
                        STALE_REASON="exe-deleted"
                        ;;
                esac

                # Different on-disk paths with the same inode (hardlink /
                # install copy) are acceptable; only a real mismatch
                # triggers restart.
                if [ "$STALE" = "false" ] \
                        && [ "$DAEMON_EXE_RAW" != "$BIN_REAL" ]; then
                    if [ ! -f "$DAEMON_EXE_RAW" ] || [ ! -f "$BIN_REAL" ]; then
                        STALE=true
                        STALE_REASON="inode-mismatch"
                    else
                        d_ino=$(stat -c %i "$DAEMON_EXE_RAW" 2>/dev/null || echo a)
                        b_ino=$(stat -c %i "$BIN_REAL"       2>/dev/null || echo b)
                        if [ "$d_ino" != "$b_ino" ]; then
                            STALE=true
                            STALE_REASON="inode-mismatch"
                        fi
                    fi
                fi
            fi
        fi
    fi

  STEP 5 — Act (skip writes in --check mode)
    UNINSTALL mode: SIGTERM the actual port owner, escalate to SIGKILL if it
    lingers; do NOT respawn. Fallback to pkill only if PID discovery failed.
      if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
          kill -TERM "$DAEMON_PID" || true
          for _ in 1 2 3; do kill -0 "$DAEMON_PID" 2>/dev/null || break; sleep 1; done
          kill -0 "$DAEMON_PID" 2>/dev/null && kill -KILL "$DAEMON_PID" || true
      else
          pkill -f 'project-linter serve'     || true
          pkill -f 'project-linter mcp serve' || true   # legacy form
      fi
      return status=fixed, action=stopped.

    NEEDS_RESPAWN = (not alive) OR STALE OR force-restart
    If NEEDS_RESPAWN:
      # Read-only mode never writes/spawns — surface drift only.
      if READ_ONLY: return without acting (see RETURN below).

      # 5a. Kill the actual port owner first (TERM → KILL escalation).
      if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
          kill -TERM "$DAEMON_PID" || true
          for _ in 1 2 3; do kill -0 "$DAEMON_PID" 2>/dev/null || break; sleep 1; done
          kill -0 "$DAEMON_PID" 2>/dev/null && kill -KILL "$DAEMON_PID" || true
      else
          # Fallback if ss/lsof unavailable (e.g. busybox container).
          pkill -f 'project-linter serve'     || true
          pkill -f 'project-linter mcp serve' || true   # legacy form
      fi
      sleep 1

      # 5b. Prefer the canonical Makefile bootstrap when present (matches
      # upstream scripts/install-hooks.sh / Makefile:hooks-install).
      if [ -f "$WORKSPACE/Makefile" ] && \
         grep -qE '^hooks-install:' "$WORKSPACE/Makefile"; then
          (cd "$WORKSPACE" && make hooks-install) && return
      fi

      # 5c. Direct respawn fallback.
      nohup "$BIN" serve --port=7717 \
        >/tmp/project-linter-mcp.log 2>&1 < /dev/null & disown
      # Poll /health up to 5 s.
      for i in 1 2 3 4 5; do
        sleep 1
        curl -fsS --max-time 1 http://127.0.0.1:7717/health >/dev/null 2>&1 && break
      done

  STEP 6 — Smoke-test hook endpoint (only after a successful respawn or when alive=true && !STALE)
    curl -fsS -X POST http://127.0.0.1:7717/hooks/post-tool-use \
      -H 'content-type: application/json' \
      -d '{"session_id":"ktn-skill","cwd":"/workspace","tool_input":{},"tool_response":{}}' \
      > /dev/null

  RETURN:
  {
    "agent": "daemon",
    "status": "ok|fixed|skipped|error",
    "before_health": "200|503|connection-refused|...",
    "after_health":  "200|...",
    "fresh":         true|false,
    "stale_reason":  null|"exe-deleted"|"inode-mismatch"|"missing-exe-path",
    "action": "noop|respawned|forced-restart|stopped",
    "pid":    <int|null>,
    "exe":    "<DAEMON_EXE_RAW or null>",
    "bin":    "<BIN_REAL>",
    "notes":  "..."
  }

  Status decision matrix:
    - alive && !STALE && !force-restart   → status=ok,    action=noop
    - alive &&  STALE && READ_ONLY        → status=ok,    action=noop  (surfaces drift via fresh=false)
    - alive &&  STALE && !READ_ONLY       → status=fixed, action=respawned
    - !alive && !READ_ONLY                → status=fixed, action=respawned
    - force-restart && !READ_ONLY         → status=fixed, action=forced-restart
    - error during kill/respawn           → status=error, notes=<diagnostic>
```

### Agent E — `phases`

```yaml
# PR4 — Skills Architecture v1.3: routed via route-agent.sh to
# devops-executor-linux instead of general-purpose. The route-agent
# call returns {subagent_type, resolved_model, effort}; pass them
# through to the Task primitive.
subagent_type: devops-executor-linux
description: ".project-linter.yaml phase configuration"
prompt: |
  You manage /workspace/.project-linter.yaml. Upstream default active set is
  {1..7} (phase 8 = `tests` is opt-in). Don't touch the file unless a
  PHASES_SPEC was provided OR the file is invalid.

  PHASES_SPEC: {{PHASES_SPEC or "(none)"}}
  SCOPE_SPEC: {{SCOPE_SPEC or "(none)"}}
  Mode: {{READ_ONLY ? "read-only" : "reconcile"}}

  STEP 1 — Read .project-linter.yaml if present.
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
    "drift": "none|mutex-violation|legacy-max-phase|invalid-alias|out-of-range|invalid-review-scope|none-spec-applied",
    "active_set": [1,2,3,4,5,6,7],
    "source": "default|yaml|cli",
    "review_scope": "diff|full",
    "scope_source": "default|yaml|cli",
    "wrote_file": true|false,
    "notes": "..."
  }
```

---
