# T2 CodeRabbit Integration (External Tier)

## External Tier (T2) — Parallel with T1

**Launch the external review tool in parallel with the 5 internal agents:**

```yaml
external_tiers:
  dispatch:
    mode: "parallel with T1 (1 Bash call alongside 5 Task calls)"
    tier_filter: "--tier flag controls which tiers run (default: all)"

    coderabbit:
      tier: "T2"
      trigger: "command -v coderabbit"   # binary present is enough to TRY; auth is probed below
      # CodeRabbit requires a prior `coderabbit auth login`. Probe auth FIRST so an
      # unauthenticated CLI is skipped-with-note instead of erroring mid-review.
      bootstrap: |
        if ! command -v coderabbit >/dev/null 2>&1; then
          echo "T2 CodeRabbit: SKIP (binary absent)"          # tool-absent, not a failure
        elif ! coderabbit auth status >/dev/null 2>&1; then
          echo "T2 CodeRabbit: SKIP (unauthenticated — run 'coderabbit auth login' to enable)"
        else
          CODERABBIT_OK=1                                       # authenticated -> run review below
        fi
      command: |
        # Only runs when bootstrap set CODERABBIT_OK=1 (binary present AND auth status OK).
        coderabbit review --plain --no-color --type committed \
          --base "{base_branch}" --cwd /workspace \
          > /tmp/coderabbit-review-{timestamp}.md 2>&1
      timeout: 120000  # 2 minutes max
      fallback: "skip-with-note (T2 unavailable: binary absent OR unauthenticated) — does NOT fail the run"
```

**Tier Selection:**

| `--tier` Value | T1 (Agents) | T2 (CodeRabbit) |
|----------------|-------------|-----------------|
| `all` (default) | Yes | Yes |
| `internal` | Yes | No |
| `external` | No | Yes |
| `coderabbit` | No | Yes |

---

## Agents Architecture

```
/review (15 phases, 5 agents)
    │
    ├── Phase 0-2.5: Context + Feedback (sequential)
    │     ├── 0: Context Detection (GitHub/GitLab auto)
    │     ├── 0.5: Repo Profile (cached 7d)
    │     ├── 1: Intent + Risk Model
    │     ├── 1.5: Auto-Describe (drift detection)
    │     ├── 2: Feedback Collection
    │     ├── 2.3: CI Diagnostics (conditional)
    │     └── 2.5: Question Handling
    │
    ├── Phase 3-4.7: Parallel Analysis
    │       │
    │       ├── 3: Peek & Route (categorize files)
    │       │
    │       ├── 4: PARALLEL (5 agents)
    │       │       │
    │       │       ├── developer-executor-correctness (sonnet)
    │       │       │     Focus: Invariants, bounds, state, concurrency
    │       │       │     Output: oracle, failure_mode, repro
    │       │       │
    │       │       ├── developer-executor-security (opus)
    │       │       │     Focus: OWASP, taint analysis, supply chain
    │       │       │     Output: source, sink, taint_path, CWE refs
    │       │       │
    │       │       ├── developer-executor-design (sonnet)
    │       │       │     Focus: Antipatterns, DDD, layering, SOLID
    │       │       │     Output: pattern_reference, official_reference
    │       │       │
    │       │       ├── developer-executor-quality (haiku)
    │       │       │     Focus: Complexity, duplication, style, DTOs
    │       │       │
    │       │       └── developer-executor-shell (haiku)
    │       │             Condition: *.sh OR Dockerfile exists
    │       │             Focus: 6 shell safety axes
    │       │
    │       └── 4.7: Merge & Dedupe (normalize, evidence-required)
    │
    ├── Phase 5: Challenge (with full context)
    │
    ├── Phase 6-6.5: Output (LOCAL ONLY)
    │       ├── 6: Generate report + /plan file
    │       └── 6.5: Apply to language-specialist via /goal
    │
    └── Phase 7: Cyclic Validation (--loop)
          Loop: review → fix → review until perfect
```
