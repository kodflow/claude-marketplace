---
name: warmup
description: >-
  Pre-load a project's context before working on it. Maps the CLAUDE.md
  hierarchy without re-reading what Claude Code already loaded, loads the
  constraint ledger written by /project, explores only what the docs leave
  open, and emits one bounded briefing. `--update` refreshes, creates and
  splits the CLAUDE.md files, enforcing the size thresholds.
when_to_use: >-
  Use at the start of a session in an unfamiliar or long-idle repository, before
  a complex task, after switching projects, and with --update after a structural
  change that made the documentation stale.
argument-hint: "[--update] [--dry-run] [--constraints]"
model: inherit
effort: medium
allowed-tools:
  - "Read(**/*)"
  - "Glob(**/*)"
  - "Grep(**/*)"
  - "Write(**/CLAUDE.md)"
  - "Write(.claude/constraints.md)"
  - "Write(.claude/rules/**)"
  - "Edit(**/CLAUDE.md)"
  - "Edit(.claude/constraints.md)"
  - "Edit(.claude/rules/**)"
  - "Bash(git:*)"
  - "Bash(ls:*)"
  - "Bash(wc:*)"
  - "Bash(find:*)"
  - "Bash(cat:*)"
  - "Bash(grep:*)"
  - "Agent(*)"
  - "mcp__context7__*"
---

# /warmup — project context pre-loading

$ARGUMENTS

Load context first, act second. Every phase below exists to make the *next*
task cheaper, so the output is a briefing — not code, not a plan, not a fix.
Warmup itself must stay cheap: a handful of tool calls on a small repository,
no subagent unless the repository is too large to sample inline.

## What Claude Code already loaded — never re-read it

Before the first tool call, the session already holds (Claude Code memory docs,
<https://code.claude.com/docs/en/memory>):

| Already in context at launch | Loaded later, on demand |
|------------------------------|-------------------------|
| `CLAUDE.md`, `.claude/CLAUDE.md`, CLAUDE.local.md of the working directory **and every directory above it** | `CLAUDE.md` of a subdirectory, once a file in it is read or edited |
| every `@path` import of those files (up to four hops) | `.claude/rules/*.md` with `paths:` frontmatter, once a matching file is touched |
| `.claude/rules/*.md` without `paths:` | |
| `~/.claude/CLAUDE.md`, `~/.claude/rules/`, auto memory (`~/.claude/projects/<project>/memory/MEMORY.md`, first 200 lines or 25 KB) | |

Reading a loaded file again pays for it twice (a 56 KB root CLAUDE.md is
~14 000 tokens). Measure it (`wc -lc`), cite it by `file:line`, extract from
context; `Read` it only when it is not there (a nested file dropped by a
compaction, a `--update` edit).

## Method

| Step | Pattern | Why |
|------|---------|-----|
| Peek | map the CLAUDE.md hierarchy + sizes + project type, one batch of calls | know the shape before reading |
| Ledger | load the constraint ledger | rules beat inference |
| Funnel | root → leaves, detail decreasing with depth, loaded files used in place | general rules frame specific ones |
| Probe | answer only what the docs leave open — inline when small, `Explore` when large | a probe whose answer is already loaded is waste |
| Synthesize | one bounded briefing (≤ 40 lines) | context, not a transcript |

---

## Arguments

| Pattern | Action |
|---------|--------|
| *(none)* | Pre-load the full project context |
| `--constraints` | Load and print the constraint ledger only — fast path, no exploration |
| `--update` | Refresh every CLAUDE.md, create the missing ones, split the oversized ones |
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
  --update           Refresh + create missing + split oversized CLAUDE.md
  --update --dry-run Preview the changes, write nothing
  --help             This help

CLAUDE.md size thresholds (the worse of lines and bytes wins):
  IDEAL       0-500 lines     ≤ 25 KB   no action
  ACCEPTABLE  501-700         ≤ 35 KB   fine for a busy directory
  WARNING     701-850         ≤ 42 KB   review at the next pass
  CRITICAL    851-1000        ≤ 50 KB   condensation mandatory
  FORBIDDEN   1001+           > 50 KB   must be split
  A file warmup creates targets < 200 lines (Claude Code docs).

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
| 1.0 | Peek — hierarchy, sizes, load state, project type | `scan.md` |
| 1.2 | Health — oversized CLAUDE.md, dated state sections | `scan.md` |
| 1.5 | Constraint ledger | below |
| 2.0 | Funnel read (root → leaves), loaded files in place | `read.md` |
| 3.0 | Probes — only the open questions | `read.md` |
| 4.0 | Synthesize the bounded briefing | `read.md` |

### Update mode (`--update`)

| Phase | Action | Module |
|-------|--------|--------|
| 1.0 | Full scan, honouring `.gitignore` | `update.md` |
| 2.0 | Create the missing CLAUDE.md files | `update.md` |
| 3.0 | Detect stale content, dated state included | `update.md` |
| 3.5 | Split the oversized CLAUDE.md files | `update.md` |
| 4.0 | Generate the updates | `update.md` |
| 5.0 | Apply (interactive) or print (`--dry-run`) | `update.md` |
| 7.0 | Learn — extract recurring conventions | `update.md` |

Read a module when you reach its phase, not before. Normal mode never opens
`update.md`.

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
   history; read it only for the *why*, never as a current rule. Note the
   superseded ids, nothing more.
2. Surface every `MUST` and `MUST NOT` in the briefing, by ID. These bound
   everything the session may propose.
3. Note which verifiers are commands. `/plan` and `/kodflow-review:review` will
   run them.

Where to read it: a ledger inside the root `CLAUDE.md` is already in context —
use the `grep -n` line numbers, do not re-read the file. A
`.claude/constraints.md` is not auto-loaded (no `@` import of it, checked by
`grep -n "@.claude/constraints.md" CLAUDE.md`): read the entries the grep
located, by `offset`/`limit`, never the whole file twice.

Per entry, extract: id, category, rule, verifier, and the `~/.claude/docs/`
pattern it cites when it has one. This is done here, directly — no subagent.

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
| Re-read a file Claude Code already loaded | **FORBIDDEN** | it is in context; a second read pays twice |
| Read a whole file to answer one question | **FORBIDDEN** | `Grep` or `Read` with `offset`/`limit` |
| Spawn a probe whose answer is already loaded | **FORBIDDEN** | see `read.md` Phase 3.0 |
| Briefing over 40 lines, or pasting loaded CLAUDE.md text into it | **FORBIDDEN** | cite `file:line` instead |
| Modify `~/.claude/skills/` | **FORBIDDEN** | warmup reads the project, not the harness |
| Delete a CLAUDE.md | **FORBIDDEN** | update and split only |
| Drop content while splitting | **FORBIDDEN** | move it, leave a pointer |
| Create a CLAUDE.md in a gitignored directory | **FORBIDDEN** | vendor/, node_modules/, build outputs |
| Ignore `.gitignore` | **FORBIDDEN** | it is the source of truth for exclusions |
| CLAUDE.md at FORBIDDEN size | **FORBIDDEN** | split it (`--update`, Phase 3.5) |
| Finish a task without updating the CLAUDE.md of each directory it changed | **FORBIDDEN** | see *Session end* below |
| Update a CLAUDE.md in a directory the task did not touch | **FORBIDDEN** | scope is what changed, nothing else |
| Paste implementation code into a CLAUDE.md | **FORBIDDEN** | context, not code |
| Restate a superseded constraint as current | **FORBIDDEN** | check the supersede marker |
| Start the task instead of reporting the briefing | **FORBIDDEN** | warmup loads; it does not act |

### Size thresholds — the single source

The table in `--help` above is the only one; `update.md` and the briefing use
it. A level is the **worse** of the line level and the byte level: 870 long
lines can weigh 56 KB, and bytes are what the context pays. A file warmup
**creates or rewrites** targets under 200 lines ("Longer files consume more
context and reduce adherence", Claude Code docs); the table bounds what exists,
it is not a budget to fill. How to split so the launch cost actually drops:
`update.md`, Phase 3.5. A ledger that pushes `CLAUDE.md` past 250 lines (the
`/project` spill point, `../project/constraints.md`) moves to
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
| session or container start | `/plan`, `/kodflow-review:review`, `/goal` |
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
