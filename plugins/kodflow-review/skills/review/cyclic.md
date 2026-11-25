# Cyclic Workflow & Guardrails (Phase 14-15)

## Path Resolution (MANDATORY)

All `.claude/` paths MUST be absolute: `${WORKSPACE_ROOT}/.claude/plans/` (resolve via `git rev-parse --show-toplevel || echo /workspace`).

---

## Phase 14.0: Language-Specialist Dispatch

**Route fixes to language-specialist agents via /goal:**

```yaml
language_specialist_dispatch:
  goal: "Delegate fixes to language specialist"

  routing:
    ".go":    "developer-specialist-go"
    ".py":    "developer-specialist-python"
    ".ts":    "developer-specialist-nodejs"
    ".js":    "developer-specialist-nodejs"
    ".rs":    "developer-specialist-rust"
    ".cpp":   "developer-specialist-cpp"
    ".cc":    "developer-specialist-cpp"
    ".hpp":   "developer-specialist-cpp"
    ".c":     "developer-specialist-c"
    ".h":     "developer-specialist-c"
    ".zig":   "developer-specialist-zig"
    ".sql":   "data-specialist-postgres"
    ".sh":    "developer-executor-shell"
    "Dockerfile": "developer-executor-shell"

  dispatch:
    # skills-cleanup C2: fixes are not auto-applied here. /review --loop writes the fixes
    # plan; /refine compacts it into a goal contract; /goal (the canonical executor) then
    # drives that contract to completion. The handoff is /refine -> /goal, matching the
    # other review modules (review.md Phase 5 "applied by /refine -> /goal"); no custom loop engine.
    primitive: |
      /refine review-fixes-{timestamp}      # prepares the goal contract from the fixes plan
      # -> emits a /goal directive that applies each fix_patch grouped by language via
      #    developer-specialist-{lang}, stopping when a re-review reports 0 CRITICAL and 0 HIGH.
    fallback_when_goal_absent: "apply the fixes listed in the review-fixes plan manually"
    executor: "developer-specialist-{lang}"

  integration_with_goal:
    workflow:
      1: "/review generates plan with findings + fix_patch"
      2: "/refine compacts the review-fixes plan into a goal contract (.claude/goals/<slug>.md)"
      3: "/goal loads the contract (convention) and groups fixes by language"
      4: "language-specialist agents apply fixes until the stop condition holds"
      5: "if --loop, re-run /review to confirm 0 CRITICAL/HIGH"
```

---

## Phase 15.0: Cyclic Validation

**Loop until perfect OR --loop limit:**

```yaml
cyclic_workflow:
  trigger: "/review --loop [N]"

  modes:
    no_flag: "Single review, no fix, no loop"
    loop_only: "--loop → Infinite until perfect"
    loop_N: "--loop 5 → Max 5 iterations"

  flow:
    iteration_1:
      1_review: "Full analysis (15 phases, 5 agents)"
      2_generate_plan: ".claude/plans/review-fixes-{timestamp}.md"
      3_dispatch_to_goal: "/goal \"execute the review-fixes plan to 0 CRITICAL/HIGH\""

    iteration_2_to_N:
      1_review_validation: |
        /review (re-scan post-fix). The re-review narrows the INPUT, never the ROSTER:
        every dimension owner of iteration 1 runs again (on the full diff, with the
        since-fix diff marked as new code). Each fix is reviewed as new code AND against
        the class of its finding (passes.md, Phase 5.3): a helper added by a fix is
        checked on every input type and every call site it now receives, and the
        criteria table is recomputed, since a test added by a fix may prove a
        different path than the criterion's.
      2_check_remaining:
        if: "findings.CRITICAL + findings.HIGH > 0"
        then: "Generate new plan, continue loop"
        else: "Exit loop (success)"
      3_check_loop_limit:
        if: "iteration >= N"
        then: "Exit loop (limit reached)"

  exit_conditions:
    - "No CRITICAL/HIGH findings remaining"
    - "--loop limit reached"
    - "User interrupt (Ctrl+C)"

  output_per_iteration:
    format: |
      ═══════════════════════════════════════════════════════════════
        Iteration {X}/{N}
        Findings: CRIT={a}, HIGH={b}, MED={c}, LOW={d}
        Fixes applied: {n} files modified
        Status: {CONTINUE|SUCCESS|LIMIT_REACHED}
      ═══════════════════════════════════════════════════════════════
```

---

## Guardrails

| Action | Status |
|--------|--------|
| Auto-approve/merge | FORBIDDEN |
| Skip security issues | FORBIDDEN |
| Modify code directly | FORBIDDEN |
| Post comment without user validation | FORBIDDEN |
| Mention AI in PR responses | **ABSOLUTE FORBIDDEN** |
| Skip Phase 0-1 (context/intent) | FORBIDDEN |
| Challenge without context (skip Phase 3-4) | FORBIDDEN |
| Expose secrets in evidence/output | FORBIDDEN |
| Ignore budget limits | FORBIDDEN |
| Pattern analysis on docs-only PR | SKIP (not forbidden) |

---

## No-Regression Checklist

```yaml
no_regression:
  check_in_pr:
    - "Tests added/adjusted for changes?"
    - "Migration/rollback needed?"
    - "Backward compatibility maintained?"
    - "Config changes documented?"
    - "Observability (logs/metrics) added?"
```

---

## Error Handling

```yaml
error_handling:
  mcp_rate_limit:
    action: "Exponential backoff (1s, 2s, 4s)"
    fallback: "git diff local"
    max_retries: 3

  agent_timeout:
    # A reasoning producer routinely runs for minutes: a fixed short wait abandons it.
    # Its report file decides (SKILL.md, Phase 6): last status line not "complete"
    # when the producer has stopped -> that pass is INCOMPLETE; re-brief it narrower
    # or cover the dimension inline. Never read the silence as a clean pass.
    action: "Wait for the producer's completion; INCOMPLETE pass when its report file is not complete"

  large_diff:
    threshold: 5000 lines
    action: "Force TRIAGE mode, warn user"
```

---

## Shell Safety Checks (if *.sh present)

```yaml
shell_safety_axes:
  1_download_safety:
    checks:
      - "mktemp for temporary files?"
      - "curl --retry --proto '=https'?"
      - "install -m instead of chmod?"
      - "rm -f cleanup?"

  2_download_robustness:
    checks:
      - "Track download failures?"
      - "Exit if critical?"
      - "Avoid silent failures?"

  3_path_determinism:
    checks:
      - "Absolute paths in configs?"
      - "No implicit PATH dependency?"

  4_fallback_completeness:
    checks:
      - "Fallback copies binary to correct location?"

  5_input_resilience:
    checks:
      - "Handles empty input?"
      - "set -e with graceful handling?"

  6_url_validation:
    checks:
      - "Release URL exists?"
      - "Official script if available?"
```

---

## DTO Convention Check (Go files)

**Verify Go DTOs use `dto:"direction,context,security"`:**

```yaml
dto_validation:
  trigger: "*.go files in diff"
  severity: MEDIUM

  detection:
    suffixes: [Request, Response, DTO, Input, Output, Payload, Message, Event, Command, Query]
    serialization_tags: ["json:", "yaml:", "xml:"]

  check: |
    Struct name matches *Request/*Response/*DTO/etc.
    AND has serialization tags
    → MUST have dto:"dir,ctx,sec" on each PUBLIC field

  valid_format: 'dto:"<direction>,<context>,<security>"'
  valid_values:
    direction: [in, out, inout]
    context: [api, cmd, query, event, msg, priv]
    security: [pub, priv, pii, secret]

  report_format: |
    ### DTO Convention
    | File | Struct | Status | Issue |
    |------|--------|--------|-------|
    | user_dto.go | CreateUserRequest | OK | - |
    | order.go | OrderResponse | FAIL | Missing dto:"..." tags |

  reference: "~/.claude/docs/conventions/dto-tags.md"
```

---

## Review Iteration Loop

```yaml
iteration_loop:
  description: |
    Continuous improvement based on bot feedback.

  process:
    1: "Collect bot suggestions (Phase 2.6)"
    2: "Extract BEHAVIOR (not the fix)"
    3: "Categorize (shell/security/quality)"
    4: "Add to workflow (user approves)"
    5: "Commit the improvement"

  example:
    input: "Use mktemp to prevent partial writes"
    output:
      behavior: "Downloads should use temp files"
      category: "shell_safety"
      axis: "1_download_safety"
```
