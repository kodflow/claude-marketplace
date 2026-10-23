# Funnel Read Strategy (Phase 2-4)

## Phase 2.0: Funnel (Funnel Reading)

```yaml
funnel_strategy:
  principle: "Read from most general to most specific"

  levels:
    depth_0:
      files: ["/CLAUDE.md"]
      source: "already in context (loaded at launch) — extract, do not Read"
      extract: ["project_rules", "structure", "workflow", "safeguards"]
      detail_level: "HIGH"

    depth_1:
      files: ["src/CLAUDE.md", ".devcontainer/CLAUDE.md"]
      source: "on demand — read only when the task or the briefing needs it"
      extract: ["conventions", "key_files", "domain_rules"]
      detail_level: "MEDIUM"

    depth_2_plus:
      files: ["**/CLAUDE.md"]
      source: "on demand — headings only unless the task points there"
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
        IF file.loaded:                       # Phase 1.0 marked it
            context[file] = extract_essential(<text already in context>)
        ELIF file is on the task's path OR depth == 1:
            outline  = Grep '^#{1,3} ' file (with -n)       # table of contents
            sections = the ones carrying rules (MUST, NEVER, FORBIDDEN, guardrails)
            context[file] = Read(file, offset, limit) of those sections only
        ELSE:
            context[file] = outline only                     # path + headings
        extract_essential(context[file], detail_level)

    consolidate(context, depth)
```

A file under 150 lines may be read whole — the outline would cost as much.
A subdirectory CLAUDE.md is attached to the session when Claude reads, writes
or edits *another* file in that directory (memory docs). Read only the ones
the next task is likely to need; reading a sibling file is what loads the rest.

---

## Phase 3.0: Probe (answer only the open questions)

The probes exist to answer four questions: *what is the source layout*, *how is
it built and run*, *how is it tested*, *what does the ledger say*. The last one
is Phase 1.5's job, done directly (SKILL.md). For the other three:

```yaml
probe_policy:
  skip_when_answered: |
    A probe whose answer is already in a loaded CLAUDE.md (a Structure section,
    a build/test table, a Verification block) is NOT run. Cite the file:line
    in the briefing instead. Phase 1.0's detect-project.sh output already
    answers most of `config` (Makefile targets, CI, test frameworks).

  skip_when_absent: |
    A probe whose scope does not exist is not run. A repo with no tests
    directory gets a briefing line saying tests were not found — not a
    fabricated result.

  inline_when_small: |
    tracked_files < 300 (Phase 1.0): answer the open probes yourself, in ONE
    message of parallel calls — Glob of the source roots, Grep -c for
    'TODO|FIXME|HACK', Glob of the test convention. No subagent: its spawn
    and summary cost more than the reads.

  explore_when_large: |
    tracked_files >= 300 and at least one probe still open: launch the open
    probes as Explore agents, ALL in ONE message so they run concurrently.
    Never more than the open ones.
```

```yaml
probes:
  agent: "Explore"          # read-only, returns conclusions not file dumps

  - name: source
    breadth: medium
    scope: "the source roots found in Phase 1 (src/, internal/, cmd/, pkg/, lib/)"
    ask: |
      Map the source layout: top-level packages/modules and what each owns,
      the architectural shape you can actually see (layering, ports/adapters,
      bounded contexts), and the TODO/FIXME/HACK count with the top 3 by
      file:line. Read excerpts, not whole files. Return at most 30 lines:
      {packages[], architecture, attention_points[]}.

  - name: config
    breadth: medium
    scope: "build + runtime configuration at the repo root and .devcontainer/"
    ask: |
      Report how this project is built, run and tested: entry points, the
      Makefile/task targets that exist, services in docker-compose, and any
      MCP servers declared. Return at most 20 lines:
      {build[], run[], services[], mcp[]}.

  - name: tests
    breadth: medium
    scope: "test files by the project's own convention (*_test.go, tests/, *.test.ts, ...)"
    ask: |
      Report the test layout: frameworks in use, how tests are named and
      located, which packages have none, and how integration tests get their
      dependencies. Return at most 20 lines:
      {frameworks[], layout, untested_packages[]}.
```

Give each probe the facts already known (project type, source roots, what the
loaded CLAUDE.md says) so it does not rediscover them. `Explore` is read-only
by construction, which is what makes this phase safe to run before anything is
understood.

---

## Phase 4.0: Synthesize (Consolidated Context)

```yaml
synthesize_workflow:
  1_merge:
    action: "Merge results"
    inputs:
      - "context_tree (Phase 2)"
      - "health checks (Phase 1.2)"
      - "constraint_ledger (Phase 1.5)"
      - "the probes that ran (Phase 3)"

  2_prioritize:
    action: "Prioritize information"
    levels:
      - CRITICAL: "Active MUST / MUST NOT constraints, guardrails"
      - HIGH:     "Project structure, architecture in use, build+test commands"
      - MEDIUM:   "SHOULD constraints, services, MCP, test coverage, oversized CLAUDE.md"
      - LOW:      "Attention points, dated state candidates, minor conventions"
    rule: |
      A constraint always outranks an inference. When the ledger says one thing
      and the code appears to say another, report BOTH and flag the drift --
      that gap is usually the most useful thing warmup can surface.

  3_bound:
    action: "Fit the briefing in 40 lines"
    rules:
      - "At most 3 items per section, then '+<n> more (<where to look>)'"
      - "Never paste text of a loaded CLAUDE.md — it is already in context; cite file:line"
      - "MUST / MUST NOT constraints are the exception: list every id, one line each"
      - "Drop LOW before MEDIUM, MEDIUM before HIGH; never drop CRITICAL"

  4_format:
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
    ├─ CLAUDE.md files ....... <n>  (<n> already loaded, <n> read, <n> outlined)
    ├─ Launch cost ........... ~<n> tokens of CLAUDE.md + rules
    ├─ Constraints ........... <n> active, <n> superseded
    ├─ Probes ................ <ran> / <skipped: answered|absent>
    └─ Test files ............ <n>

  Constraints in force (MUST / MUST NOT)
    C-002  MUST NOT add a runtime dependency without an ADR
    C-011  MUST keep `make ci` green before any push
    (<n> SHOULD entries not listed — /warmup --constraints for all)

  Architecture
    <pattern> — <the one file that proves it>

  Build & test
    build: <cmd>   test: <cmd>   lint: <cmd>

  Drift detected
    ⚠ C-004 says Postgres sessions; internal/session/ imports go-redis
    ⚠ CLAUDE.md 871 l / 56 KB — CRITICAL, condense or split with /warmup --update
    ⚠ 4 dated state lines older than 30 days (CLAUDE.md:572, :818, …)

  Attention
    <n> TODO · <n> FIXME · <n> HACK   (top 3 by file:line)

  Ready for → /search <topic> · /plan <feature> · /kodflow-review:review
═══════════════════════════════════════════════════════════════
```

Report only what was actually read. An empty section is printed as `none`;
it is never filled with a plausible guess. If a probe failed, say which and
why — a briefing that hides a gap is worse than one that admits it. A probe
skipped because its answer was already loaded is not a gap: say where the
answer lives.
