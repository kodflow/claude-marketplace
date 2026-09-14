# Funnel Read Strategy (Phase 2-4)

## Phase 2.0: Funnel (Funnel Reading)

```yaml
funnel_strategy:
  principle: "Read from most general to most specific"

  levels:
    depth_0:
      files: ["/CLAUDE.md"]
      extract: ["project_rules", "structure", "workflow", "safeguards"]
      detail_level: "HIGH"

    depth_1:
      files: ["src/CLAUDE.md", ".devcontainer/CLAUDE.md"]
      extract: ["conventions", "key_files", "domain_rules"]
      detail_level: "MEDIUM"

    depth_2_plus:
      files: ["**/CLAUDE.md"]
      extract: ["specific_rules", "attention_points"]
      detail_level: "LOW"

  extraction_rules:
    include:
      - "MANDATORY/ABSOLUTE rules"
      - "Directory structure"
      - "Specific conventions"
      - "Guardrails"
    exclude:
      - "Complete code examples"
      - "Implementation details"
      - "Long code blocks"
```

**Reading algorithm:**

```
FOR depth FROM 0 TO max_depth:
    files = filter(claude_files, depth)

    PARALLEL FOR each file IN files:
        content = Read(file)
        context[file] = extract_essential(content, detail_level)

    consolidate(context, depth)
```

---

## Phase 3.0: Parallelize (Analysis by Domain)

```yaml
parallel_analysis:
  mode: "PARALLEL — one message, four Agent calls"
  agent: "Explore"          # read-only, returns conclusions not file dumps

  probes:
    - name: source
      breadth: medium
      scope: "the source roots found in Phase 1 (src/, internal/, cmd/, pkg/, lib/)"
      ask: |
        Map the source layout: top-level packages/modules and what each owns,
        the architectural shape you can actually see (layering, ports/adapters,
        bounded contexts), and every TODO/FIXME/HACK with its file:line.
        Return {packages[], architecture, attention_points[]}.

    - name: config
      breadth: medium
      scope: "build + runtime configuration at the repo root and .devcontainer/"
      ask: |
        Report how this project is built, run and tested: entry points, the
        Makefile/task targets that exist, services in docker-compose, and any
        MCP servers declared. Return {build[], run[], services[], mcp[]}.

    - name: tests
      breadth: medium
      scope: "test files by the project's own convention (*_test.go, tests/, *.test.ts, ...)"
      ask: |
        Report the test layout: frameworks in use, how tests are named and
        located, which packages have none, and how integration tests get their
        dependencies. Return {frameworks[], layout, untested_packages[]}.

    - name: constraints
      breadth: medium
      scope: "the ledger path from Phase 1.5, plus every CLAUDE.md"
      ask: |
        Extract every ACTIVE constraint: id, category, MUST/MUST NOT/SHOULD
        rule, verifier, and the ~/.claude/docs/ pattern it cites when it has
        one. Skip entries marked superseded except to note the id.
        Return {constraints[], superseded_ids[]}.
        Return an empty list if there is no ledger -- do not infer rules.
```

**Launch all four in ONE message** so they run concurrently. `Explore` is
read-only by construction, which is what makes this phase safe to run before
anything is understood.

**Skip a probe whose scope does not exist.** A repo with no tests directory gets
three probes and a briefing line saying tests were not found — not a fabricated
fourth result.

---

## Phase 4.0: Synthesize (Consolidated Context)

```yaml
synthesize_workflow:
  1_merge:
    action: "Merge agent results"
    inputs:
      - "context_tree (Phase 2)"
      - "constraint_ledger (Phase 1.5)"
      - "source / config / tests / constraints probes (Phase 3)"

  2_prioritize:
    action: "Prioritize information"
    levels:
      - CRITICAL: "Active MUST / MUST NOT constraints, guardrails"
      - HIGH:     "Project structure, architecture in use, build+test commands"
      - MEDIUM:   "SHOULD constraints, services, MCP, test coverage"
      - LOW:      "Attention points, minor conventions"
    rule: |
      A constraint always outranks an inference. When the ledger says one thing
      and the code appears to say another, report BOTH and flag the drift --
      that gap is usually the most useful thing warmup can surface.

  3_format:
    action: "Format context for session"
    output: "Session context ready"
```

**Final Output (Normal Mode):**

```
═══════════════════════════════════════════════════════════════
  /warmup — context loaded
═══════════════════════════════════════════════════════════════

  Project : <name>            Type: <detected_type(s)>
  Branch  : <branch>          Dirty: <n> files

  Read
    ├─ CLAUDE.md files ....... <n>  (deepest: <path>)
    ├─ Constraints ........... <n> active, <n> superseded
    ├─ Packages .............. <n>
    └─ Test files ............ <n>

  Constraints in force (MUST / MUST NOT)
    C-002  MUST NOT add a runtime dependency without an ADR
    C-011  MUST keep `make ci` green before any push
    C-019  MUST store sessions in Redis with a 24 h TTL
    (<n> SHOULD entries not listed — /warmup --constraints for all)

  Architecture
    <pattern> — <the one file that proves it>

  Build & test
    build: <cmd>   test: <cmd>   lint: <cmd>

  Drift detected
    ⚠ C-004 says Postgres sessions; internal/session/ imports go-redis
    ⚠ 3 CLAUDE.md over the WARNING threshold (<paths>)

  Attention
    <n> TODO · <n> FIXME · <n> HACK   (top 3 by file:line)

  Ready for → /search <topic> · /plan <feature> · /review
═══════════════════════════════════════════════════════════════
```

Report only what was actually read. An empty section is printed as `none`;
it is never filled with a plausible guess. If a probe failed, say which and
why — a briefing that hides a gap is worse than one that admits it.
