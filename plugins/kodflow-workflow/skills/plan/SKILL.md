---
name: plan
description: 'Enter Claude Code planning mode with RLM decomposition. Analyzes codebase, designs
  approach, creates step-by-step plan. Use when: starting a new feature, refactoring, or complex
  task.'
when_to_use: Use before implementing anything non-trivial — a feature, a refactor, a migration.
  Produces a step-by-step plan in .claude/plans/, validated against the project's constraint
  ledger.
argument-hint: <description> [--context[=<slug>]] [--goal [--fast]] [--auto]
model: opus
allowed-tools:
- Read(**/*)
- Glob(**/*)
- Grep(**/*)
- mcp__context7__*
- Task(*)
- WebFetch(*)
- WebSearch(*)
- mcp__github__*
- mcp__playwright__*
- Write(.claude/plans/*.md)
- Write(.claude/contexts/*.md)
- ExitPlanMode(*)
- Skill(*)
- Bash(bash ~/.claude/skills/_shared/scripts/detect-models.sh:*)
- Bash(jq:*)
---

# /plan - Claude Code Planning Mode (RLM Architecture)

$ARGUMENTS

## Overview

Planning mode with **RLM** patterns:

- **Peek** - Quick codebase scan
- **Decompose** - Split into subtasks
- **Parallelize** - Multi-domain exploration
- **Synthesize** - Structured plan

**Principle**: Plan -> Validate -> Implement (never the reverse)

---

## Arguments

| Pattern | Action |
|---------|--------|
| `<description>` | Plans the implementation of the feature/fix |
| `--auto` | Auto mode: no questions, AI reasons internally and presents final plan |
| `--context` | Auto-detect most recent `.claude/contexts/*.md` |
| `--context=<name>` | Load specific `.claude/contexts/{name}.md` |
| `--goal` | After plan write, chain `/review` (plan gate) → `/refine` (contract) → suggest `/goal` |
| `--goal --fast` | Skip the `/review` gate — chain straight to `/refine` (trivial plans) |
| `--help` | Show help |

### `--goal` flag (PR5a — Skills Architecture v1.3)

```yaml
goal_chain:
  trigger: "--goal in $ARGUMENTS"
  after_plan_write:
    # skills-cleanup C3 (DD1): gate the plan through /review BEFORE /refine.
    primitive: |
      Skill(skill="review", args="--plan <slug>")   # gate — review the plan in place
      Skill(skill="refine", args="<slug>")           # then compact to a /goal CONTRACT
    fast_bypass:
      trigger: "--goal --fast"
      message: "skips the /review gate; runs /refine directly (trivial plans only)."
    fallback_when_review_absent:
      message: "fall back to --fast (plan → refine) with a warning."
    fallback_when_refine_absent:
      message: "plan written; run /goal with the explicit condition manually."
```

---

## --help

```
═══════════════════════════════════════════════════════════════
  /plan - Claude Code Planning Mode (RLM)
═══════════════════════════════════════════════════════════════

Usage: /plan <description> [options]

Options:
  <description>     What to implement
  --auto            No questions — AI reasons internally, presents final plan
  --goal            After plan write, chain /review (gate) → /refine → /goal
  --goal --fast     Skip the /review gate, chain straight to /refine
  --context         Load most recent .claude/contexts/*.md
  --context=<name>  Load specific .claude/contexts/{name}.md
  --help            Show this help

RLM Patterns:
  1. Peek       - Quick codebase scan
  2. Decompose  - Split into subtasks
  3. Parallelize - Parallel exploration
  4. Synthesize - Structured plan

Workflow:
  /search <topic> → /plan <feature> → /review → /refine → /goal

Examples:
  /plan "Add user authentication with JWT"
  /plan "Refactor database layer" --context
  /plan "Fix memory leak in worker process"

═══════════════════════════════════════════════════════════════
```

---

## Phase Reference

| Phase | Module | Description |
|-------|--------|-------------|
| 1.0-3.0 | Read `explore.md` | Peek + Decompose + Parallelize |
| 4.0 | Read `patterns.md` | Pattern consultation + DTO convention |
| 5.0-6.0 | Read `synthesize.md` | Plan generation + complexity check + validation |

---

## Execution Mode Detection (Agent Teams)

@../_shared/team-mode.md

Before Phase 3.0 (Parallelize), determine runtime mode:

```bash
source "$HOME/.claude/scripts/team-mode-primitives.sh"
MODE=$(detect_runtime_mode)
```

Branch:
- `TEAMS_TMUX` / `TEAMS_INPROCESS` → **TEAMS exploration** (below)
- `SUBAGENTS` → legacy parallel Task-tool dispatch in `explore.md` (unchanged)

### TEAMS exploration

Lead: `developer-orchestrator`. Spawn up to 4 exploration teammates via `developer-specialist-review` (one per axis), each with a read-only task-contract v1 block:

```text
TaskCreate × 4:
  explorer-backend   → scope: backend/domain
  explorer-frontend  → scope: UI/assets
  explorer-test      → scope: tests/ + conventions
  explorer-patterns  → scope: ~/.claude/docs/ pattern consultation
Each task: access_mode=read-only, owned_paths=[], acceptance_criteria=["return 5-10 essential files + findings"]
```

Wait for all 4 TeammateIdle → synthesize in Phase 5.0. Token ceiling ≤ 2x legacy (exploration is cheap). Fallback is byte-functionally equivalent.

---

## Auto Mode (`--auto`)

When `--auto` is passed, ALL interactive checkpoints are skipped:
- Phase 1.5 (validate scope) → AI decides scope internally
- Phase 2.5 (validate objectives, explore.md) → AI decides decomposition internally
- Phase 3.5 (propose approaches, synthesize.md) → AI picks best approach with internal reasoning
- Phase 5.9 (risk review) → AI assesses risks internally
- Plan is presented at the end for user review via ExitPlanMode

The AI documents its reasoning in the plan file under a "## Reasoning" section so the user can review why choices were made.

**When to use `--auto`:** When you trust the AI's judgment and want speed over interaction. You always review the final plan before `/refine → /goal`.

---

## Architecture decisions → `/adr`

When the plan settles a non-obvious architectural trade-off (a new dependency or
service, a layering/pattern choice, a public-contract or wire-format change, a
notable perf-vs-simplicity call), record the *why* before implementing. After the
plan is written, emit a textual `Suggested next step: /adr <decision>` so the
decision is captured as `docs/adr/NNNN-*.md` rather than lost. Routine
implementation choices evident from the code do NOT warrant an ADR.

---

## Auto-Grouping (Parallelization Table)

When generating the Parallelization table, the AI MUST:
1. Scan all files to modify
2. Map import/dependency chains between them
3. Group files that share NO dependencies into parallel steps
4. Flag shared files (package.json, go.mod, config) as sequential
5. Present groups with confidence level

Auto-grouping is the PRIMARY method. Manual `worktree: yes/no` tags in the Parallelization table (see synthesize.md) serve as OVERRIDES when the AI's automatic grouping needs correction. Precedence: manual tags > auto-grouping.

---

## Execution Flow

```
Phase 1.0: Peek (RLM Pattern)
  → Recover context from .claude/contexts/
  → Scan project structure
  → Identify relevant patterns

Phase 2.0: Decompose (RLM Pattern)
  → Extract objectives from description
  → Categorize by domain
  → Order by dependency

Phase 3.0: Parallelize (RLM Pattern)
  → Launch 4 parallel exploration agents
  → backend, frontend, test, patterns

Phase 4.0: Pattern Consultation
  → Consult ~/.claude/docs/ for applicable patterns
  → DTO convention reminder (if Go)

Phase 5.0: Synthesize (RLM Pattern)
  → Generate structured plan document
  → Persist to .claude/plans/{slug}.md
  → Persist context to .claude/contexts/{slug}.md
  → Add worktree parallelization table (if applicable)
  → Each exploration agent MUST return 5-10 essential files list

Phase 5.5: Spec Self-Review (before submitting plan)
  → Placeholder scan: Any TBD, TODO, incomplete sections?
  → Internal consistency: Do sections contradict?
  → Scope check: Focused enough for single implementation?
  → Ambiguity check: Could any requirement be interpreted two ways?

Phase 5.7: Complexity Check
  → If > 15 files, ask user to split

Phase 5.8: Frontend Guidelines (conditional)
  → IF plan involves HTML, CSS, React, Vue, or frontend code:
    - "Commit to a BOLD aesthetic direction before coding"
    - "Choose distinctive fonts (AVOID: Arial, Inter, Roboto)"
    - "Use CSS variables for color consistency"
    - "Prioritize one well-orchestrated animation over scattered micro-interactions"
    - "FORBIDDEN AI cliches: purple gradients on white, predictable centered layouts"
    - "Each design must feel context-specific, never cookie-cutter"

Phase 6.0: Validation Request
  → Wait for user approval before /refine → /goal
```

---

## HARD GATE (ABSOLUTE)

```
Do NOT invoke /refine → /goal, write any code, scaffold any project, or take ANY 
implementation action until the plan is approved by the user.
This applies to EVERY task regardless of perceived simplicity.
Anti-pattern: "This is too simple to need a plan" — EVERY task gets a plan.
```

---

## Model allocation (mandatory, not negotiable)

Read `../_shared/model-policy.md` and resolve the tiers **before** writing the
plan:

```bash
bash ~/.claude/skills/_shared/scripts/detect-models.sh
```

Every plan carries the allocation, in one line under its constraints:

```
Models: orchestrator <CLAUDE_TOP> @high · code workers Opus @high ·
        review workers Opus @xhigh · mechanical workers Sonnet @low ·
        workers never inherit the orchestrator model · worktree isolation
        wherever workers write concurrently.
```

Three rules the plan may not weaken:

- **Resolve, never hardcode.** A hardcoded top model is wrong the day a better
  one ships.
- **Never let a worker inherit.** On a top-tier orchestrator that silently runs
  every worker at the top rate — the single most expensive mistake available.
- **The orchestrator never does the work.** If it is editing, the allocation has
  collapsed.

A plan that omits, reworders or weakens this is rejected and rewritten.

## Guardrails (ABSOLUTE)

| Action | Status |
|--------|--------|
| Skip Phase 1 (Peek) | **FORBIDDEN** |
| Sequential exploration | **FORBIDDEN** |
| Skip Pattern Consultation | **FORBIDDEN** |
| Implement without approved plan | **FORBIDDEN** |
| Plan without concrete steps | **FORBIDDEN** |
| Plan without rollback strategy | **WARNING** |
| Skip spec self-review | **FORBIDDEN** |
| Start /refine → /goal before user approval | **FORBIDDEN** |
