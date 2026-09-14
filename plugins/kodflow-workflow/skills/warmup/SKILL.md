---
name: warmup
description: >-
  Pre-load a project's context before working on it. Discovers the CLAUDE.md
  hierarchy and reads it root-to-leaves (funnel), loads the constraint ledger
  written by /project, explores source, config, tests and docs in parallel, and
  emits one consolidated briefing. `--update` refreshes and creates the CLAUDE.md
  files themselves, enforcing the line thresholds.
when_to_use: >-
  Use at the start of a session in an unfamiliar or long-idle repository, before
  a complex task, after switching projects, and with --update after a structural
  change that made the documentation stale.
argument-hint: "[--update] [--dry-run] [--constraints]"
model: opus
allowed-tools:
  - "Read(**/*)"
  - "Glob(**/*)"
  - "Grep(**/*)"
  - "Write(**/CLAUDE.md)"
  - "Write(.claude/constraints.md)"
  - "Edit(**/CLAUDE.md)"
  - "Edit(.claude/constraints.md)"
  - "Bash(git:*)"
  - "Bash(ls:*)"
  - "Bash(wc:*)"
  - "Bash(find:*)"
  - "Bash(cat:*)"
  - "Agent(*)"
  - "mcp__context7__*"
---

# /warmup — project context pre-loading

$ARGUMENTS

Load context first, act second. Every phase below exists to make the *next*
task cheaper, so the output is a briefing — not code, not a plan, not a fix.

## Method

| Step | Pattern | Why |
|------|---------|-----|
| Peek | discover the CLAUDE.md hierarchy + project type | know the shape before reading |
| Ledger | load the constraint ledger | rules beat inference |
| Funnel | read root → leaves, detail decreasing with depth | general rules frame specific ones |
| Parallelize | explore source / config / tests / knowledge base at once | four cheap reads, one round trip |
| Synthesize | one consolidated briefing | context, not a transcript |

---

## Arguments

| Pattern | Action |
|---------|--------|
| *(none)* | Pre-load the full project context |
| `--constraints` | Load and print the constraint ledger only — fast path, no exploration |
| `--update` | Refresh every CLAUDE.md and create the missing ones |
| `--update --dry-run` | Show what `--update` would change, write nothing |
| `--help` | Print the help block and stop |

## --help

```
════════════════════════════════════════════════════════════════
  /warmup — project context pre-loading
════════════════════════════════════════════════════════════════

Usage: /warmup [options]

  (none)             Pre-load the complete context
  --constraints      Constraint ledger only (fast path)
  --update           Refresh + create missing CLAUDE.md
  --update --dry-run Preview the changes, write nothing
  --help             This help

CLAUDE.md line thresholds:
  IDEAL       0-500    no action
  ACCEPTABLE  501-700  fine for a busy directory
  WARNING     701-850  review at the next pass
  CRITICAL    851-1000 condensation mandatory
  FORBIDDEN   1001+    must be split

Exclusions: .gitignore is authoritative, plus vendor/, node_modules/,
.git/, bin/, dist/, build/, target/, zig-out/, zig-cache/.

Workflow:
  /project → /warmup → /search → /plan → /refine → /goal → /git
════════════════════════════════════════════════════════════════
```

**If `$ARGUMENTS` contains `--help`:** print the block and STOP.

---

## Phase map

### Normal mode

| Phase | Action | Module |
|-------|--------|--------|
| 1.0 | Peek — hierarchy discovery + project detection | `scan.md` |
| 1.5 | Constraint ledger | `scan.md` |
| 2.0 | Funnel read (root → leaves) | `read.md` |
| 3.0 | Parallel exploration (source, config, tests, knowledge base) | `read.md` |
| 4.0 | Synthesize the briefing | `read.md` |

### Update mode (`--update`)

| Phase | Action | Module |
|-------|--------|--------|
| 1.0 | Full scan, honouring `.gitignore` | `update.md` |
| 2.0 | Create the missing CLAUDE.md files | `update.md` |
| 3.0 | Detect stale content | `update.md` |
| 4.0 | Generate the updates | `update.md` |
| 5.0 | Apply (interactive) or print (`--dry-run`) | `update.md` |
| 7.0 | Learn — extract recurring conventions | `update.md` |

Read a module when you reach its phase, not before.

---

## Phase 1.5 — the constraint ledger

The single highest-value thing to load, and the one an ordinary file read
misses, because it is a *contract* rather than documentation.

```bash
ls .claude/constraints.md 2>/dev/null
grep -n "^### C-[0-9]" CLAUDE.md .claude/constraints.md 2>/dev/null
```

`/project` writes this ledger: numbered `C-NNN` entries, each a MUST / MUST NOT /
SHOULD rule with a verifier and an origin. When it exists:

1. Read every **active** entry — an entry marked `*(superseded by C-NNN)*` is
   history; read it only for the *why*, never as a current rule.
2. Surface every `MUST` and `MUST NOT` in the briefing, by ID. These bound
   everything the session may propose.
3. Note which verifiers are commands. `/plan` and `/review` will run them.

When there is no ledger, say so in one line and suggest `/project` — do not
reconstruct a ledger by guessing from the code. Inferred rules that look
authoritative are worse than none.

Architecture constraints carry a `**Pattern:**` line pointing into
`~/.claude/docs/`. Load the referenced doc lazily — only when the session's task
actually touches that pattern.

`--constraints` stops here and prints the ledger.

---

## Guardrails (absolute)

| Action | Status | Reason |
|--------|--------|--------|
| Skip Phase 1 (Peek) | **FORBIDDEN** | hierarchy discovery is the whole basis |
| Skip Phase 1.5 when a ledger exists | **FORBIDDEN** | constraints outrank anything inferred |
| Read out of funnel order | **FORBIDDEN** | leaf rules read wrong without the root |
| Modify `~/.claude/skills/` | **FORBIDDEN** | warmup reads the project, not the harness |
| Delete a CLAUDE.md | **FORBIDDEN** | update and split only |
| Create a CLAUDE.md in a gitignored directory | **FORBIDDEN** | vendor/, node_modules/, build outputs |
| Ignore `.gitignore` | **FORBIDDEN** | it is the source of truth for exclusions |
| CLAUDE.md over 1000 lines | **FORBIDDEN** | split it |
| Finish a task without updating the CLAUDE.md of each directory it changed | **FORBIDDEN** | see *Session end* below |
| Update a CLAUDE.md in a directory the task did not touch | **FORBIDDEN** | scope is what changed, nothing else |
| Paste implementation code into a CLAUDE.md | **FORBIDDEN** | context, not code |
| Restate a superseded constraint as current | **FORBIDDEN** | check the supersede marker |
| Start the task instead of reporting the briefing | **FORBIDDEN** | warmup loads; it does not act |

### Line thresholds

```
┌────────────┬─────────┬────────────────────────────────────────┐
│   Level    │ Lines   │ Action                                 │
├────────────┼─────────┼────────────────────────────────────────┤
│ IDEAL      │ 0-500   │ none                                   │
│ ACCEPTABLE │ 501-700 │ fine for a busy directory              │
│ WARNING    │ 701-850 │ review at the next pass                │
│ CRITICAL   │ 851-1000│ condensation MANDATORY                 │
│ FORBIDDEN  │ 1001+   │ split or restructure                   │
└────────────┴─────────┴────────────────────────────────────────┘
```

A ledger that pushes `CLAUDE.md` past 850 lines moves to
`.claude/constraints.md`, leaving only the always-applicable `MUST`s inline.

### Session end — the update is not optional

When a task ends — a turn that finishes the work, a worktree about to be
merged, a session about to close — the CLAUDE.md of **every directory the task
changed** is brought up to date, and only those. This is the `--update`
convention applied to a scope: what changed, why, and what the next session
must know; no history, no diff narration, under 1000 lines.

```
for each file edited this session
    d = nearest directory at or above it that has a CLAUDE.md
    if d/CLAUDE.md was not edited this session → update it
no CLAUDE.md anywhere above → create one at the project root (--update)
```

The `Stop` hook (kodflow-hooks) computes that set from its edit tracker and
reminds once per directory. A reminder answered with "nothing to update" is
acceptable only when it says why.

---

## Chain

```
/project        establish the workspace and the ledger
    ↓
/warmup         load it                          ← you are here
    ↓
/search <topic> research what the ledger does not answer
    ↓
/plan           design within the constraints
    ↓
/refine → /goal contract, then execution
    ↓
/git            commit
    ↓
/warmup --update  fold what changed back into the docs
```

| Before `/warmup` | After `/warmup` |
|------------------|-----------------|
| session or container start | `/plan`, `/review`, `/goal` |
| `/project` | any non-trivial task |

---

## Patterns applied

| Pattern | Category | Use |
|---------|----------|-----|
| Cache-Aside | cloud | check loaded context before re-reading |
| Lazy Loading | performance | phase-by-phase funnel; pattern docs on demand |
| Progressive Disclosure | devops | detail decreases with depth |

References: `~/.claude/docs/cloud/cache-aside.md`,
`~/.claude/docs/performance/lazy-load.md`,
`~/.claude/docs/devops/feature-toggles.md`.
