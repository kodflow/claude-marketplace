# /ktn — Phase 0: project gating

project-linter is a Go linter. Running the stack in a non-Go repository is pure
cost, so this gate gets the first word and can stop the skill outright.

## Phase 0 — Project gating (Go detection, MANDATORY first step)

> project-linter only lints Go code. Running `/ktn` on a non-Go project would
> install a binary, wire hooks, and spawn a daemon that will never be used.
> Before doing anything irreversible (binary download, settings.json merge,
> daemon respawn) the skill MUST confirm a Go project is present — or get
> explicit user opt-in to proceed anyway.

### Step 0.1 — Scan

Run the cheapest possible probe (no recursion into `vendor/`, `node_modules/`,
`.git/`). Use **`rtk grep`** so the output is token-compressed automatically;
the agent never sees the raw listing — just a count.

```bash
# Detect Go signals. Stop at first hit; 50ms typical on a clean repo.
go_signals=0

# 1. go.mod / go.work at root or one level deep (very fast Glob).
if ls "$WORKSPACE"/go.mod "$WORKSPACE"/go.work \
        "$WORKSPACE"/*/go.mod 2>/dev/null | head -1 | grep -q .; then
    go_signals=1
fi

# 2. Otherwise widen to *.go anywhere outside the usual junk dirs.
#    Limit to 1 hit — we only care "any Go file exists?".
if [ "$go_signals" -eq 0 ]; then
    if rtk grep -r -l --include='*.go' \
            --exclude-dir=vendor \
            --exclude-dir=node_modules \
            --exclude-dir=.git \
            --exclude-dir=dist \
            --exclude-dir=build \
            -m 1 . "$WORKSPACE" 2>/dev/null | head -1 | grep -q .; then
        go_signals=1
    fi
fi

# 3. Last-ditch: ancillary Go markers (legacy or Bazel-only repos).
if [ "$go_signals" -eq 0 ]; then
    for marker in Gopkg.toml .golangci.yml .golangci.yaml BUILD.bazel WORKSPACE.bazel; do
        if [ -e "$WORKSPACE/$marker" ]; then
            # BUILD.bazel exists in many non-Go repos — confirm Go rules in it.
            if [ "$marker" = "BUILD.bazel" ] || [ "$marker" = "WORKSPACE.bazel" ]; then
                if rtk grep -l -E 'go_(library|binary|test|module)' \
                        "$WORKSPACE/$marker" 2>/dev/null | head -1 | grep -q .; then
                    go_signals=1; break
                fi
                continue
            fi
            go_signals=1; break
        fi
    done
fi
```

The `Glob` and `Grep` tools are equivalent fast paths if shell is awkward in
the host context — same semantics, same gate.

### Step 0.2 — Branch

| `go_signals` | Action |
|--------------|--------|
| `1` | Print one line `[ktn] go-project=yes` and **continue to Phase 1 silently**. |
| `0` | **PAUSE**. Call `AskUserQuestion` with the prompt below and block until the user picks an option. |

### Step 0.3 — The question (only when `go_signals == 0`)

Use **`AskUserQuestion`** with **exactly** this shape — a single-select Yes/No
that surfaces a Submit / Cancel UI:

```json
{
  "questions": [{
    "question": "No Go files detected in this project (no go.mod, no *.go, no BUILD.bazel with Go rules). project-linter only lints Go code — running /ktn here will install a binary, wire hooks in .claude/settings.json, and spawn an HTTP daemon on :7717 that nothing will ever call. Proceed anyway?",
    "header": "No Go found",
    "multiSelect": false,
    "options": [
      {
        "label": "No, cancel",
        "description": "Stop /ktn now. No files written, no daemon spawned. (Recommended — re-run /ktn from a Go project root.)"
      },
      {
        "label": "Yes, proceed anyway",
        "description": "Continue with the full reconcile. Use this only if you intend to add Go code later or are bootstrapping a fresh template."
      }
    ]
  }]
}
```

Notes on the wording:

- **Default focus is "No, cancel"** (listed first) — the safer option is
  always the default when no Go is detected.
- The question is **one sentence** with explicit consequences spelled out so
  the user can decide without rereading the help.
- `multiSelect: false` → the UI shows radio buttons + Submit / Cancel actions
  (Cancel maps to the user dismissing the question; treat dismissal as
  "No, cancel").
- DO NOT add a third "Other" option — `AskUserQuestion` injects the free-text
  fallback automatically; we do not want to encourage prose answers here.

### Step 0.4 — Resolve the answer

| User picked | Action |
|-------------|--------|
| `No, cancel` (or dismissal / free-text rejecting) | Print the abort banner below and **STOP**. Do not enter Phase 1. |
| `Yes, proceed anyway` | Print `[ktn] go-project=no, user-confirmed=yes` and continue to Phase 1. |

Abort banner:

```text
═══════════════════════════════════════════════════════════════
  /ktn — cancelled
═══════════════════════════════════════════════════════════════

  Reason : no Go signals in $WORKSPACE
  Probes : go.mod  go.work  **/*.go  Gopkg.toml
           .golangci.yml  BUILD.bazel(with go_*)

  No files were written. No daemon was spawned.
  Re-run /ktn from a directory that contains Go code, or pass
  --check to inspect the current project-linter state without
  any writes.
═══════════════════════════════════════════════════════════════
```

### Step 0.5 — Read-only short-circuit

`--check` still requires a Go project gate — but the question becomes
informational rather than blocking: print the abort banner and **STOP**
without prompting (a read-only audit of a stack you don't use is noise).
Honoring `--check` with a forced prompt would defeat its automation use case
(CI, scripted audits).

---
