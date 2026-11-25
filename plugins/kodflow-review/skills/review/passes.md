# /review — Phases 4 and 5: the macro and micro passes

The two mandatory reading passes. **Macro** takes each changed FILE and asks
about blast radius, architecture and placement. **Micro** takes each changed
FUNCTION and each non-function hunk and simulates it line by line.

No finding leaves these passes without `file:line` of real cited code plus a
category-appropriate counterexample — a repro, a source→sink path, an
interleaving, or a benchmark.

## Phase 4 — MACRO PASS (per file, mandatory)

For **each changed file**, before touching lines, record in the manifest:

```yaml
macro_per_file:
  - file: <path>
    file_class: <from Phase 0.6>
    role: "domain | infra | api | ui | test | config | build | docs"
    layering_ok: true|false        # no domain->infra / ui->db inversion; correct dep direction
    placement_ok: true|false       # file lives where the project structure dictates
    public_surface_intentional: true|false   # new exports deliberate, not accidental
    cohesion: "ok | god-class-growth | low-LCOM"
    intent_alignment: "Fully | Partially | Not | Requires-Verification"   # vs PR/issue
    blast_radius: <n callers/dependents from Phase 3.5>
    can_be_split: true|false       # does this file mix unrelated themes?
```

Whole-PR macro artifacts (emit once): **plain-language walkthrough**; **change-cohort
grouping + can_be_split** for the whole PR; a **Mermaid diagram** (sequence/flow/ER) when
the change touches multiple services, a schema, or core business logic.

Architecture micro-smells to flag at file level: Brain/God class growth, deep nesting,
cross-cutting concerns leaking across modules, primitive obsession, constructor
over-injection. Weight by **behavioral hotspot** (git change-frequency × complexity) and
**complexity trend** (worse than prior revision -> escalate; being refactored ->
soft-pedal). Complexity is judged by the `developer-executor-quality` agent
(maintainability/metrics owner); when a metric tool is absent, label the judgment
"static-heuristic" rather than asserting a number.

---

## Phase 5 — MICRO PASS (per function AND per non-function hunk, mandatory)

For **each changed function** (and each new branch), do NOT eyeball —
**projection-simulate**: execute the function mentally/programmatically with boundary
inputs and derive a concrete counterexample where it breaks.

```yaml
micro_per_function:
  - symbol: <pkg.Func / Class.method>
    loc: <file:line-range>
    simulated_inputs: ["empty", "single", "max/min", "overflow", "nil/None", "concurrent"]
    dimensions_checked:        # owner agent in (); recorded with finding_ids in manifest
      correctness:    {checked: true, owner: developer-executor-correctness, finding_ids: [...]}
      security:       {checked: true, owner: developer-executor-security,    finding_ids: [...]}
      concurrency:    {checked: true, owner: developer-executor-correctness, finding_ids: [...]}
      error_handling: {checked: true, owner: developer-executor-correctness, finding_ids: [...]}
      perf:           {checked: true, owner: developer-executor-design,      finding_ids: [...]}
      architecture:   {checked: true, owner: developer-executor-design,      finding_ids: [...]}
      maintainability:{checked: true, owner: developer-executor-quality,     finding_ids: [...]}
      idioms:         {checked: true, owner: <language specialist Phase 6>,   finding_ids: [...]}
      api_contract:   {checked: true, owner: developer-executor-design,      finding_ids: [...]}
      testing:        {checked: true, owner: developer-executor-quality,     finding_ids: [...]}
      docs:           {checked: true, owner: developer-executor-quality,     finding_ids: [...]}
      observability:  {checked: true, owner: developer-executor-shell,       finding_ids: [...]}
      data_privacy:   {checked: true, owner: developer-executor-security,    finding_ids: [...]}  # PII at-rest/in-transit, retention, ETSI/3GPP/LI handling
      licensing:      {checked: true, owner: developer-executor-security,    finding_ids: [...]}  # new-dep license/legal
      portability:    {checked: true|N/A, owner: <language specialist>}                            # only if Phase 0.7 cross_platform
      a11y_i18n:      {checked: true|N/A, owner: developer-specialist-react/nodejs}                # only if diff touches UI / user-facing strings

micro_per_hunk:                # for config|iac|sql|schema|protobuf|Dockerfile|yaml
  - hunk: <file:line-range>
    kind: "iac | k8s | sql | protobuf/asn1 | dockerfile | ci | config"
    checks: "schema validity, secret material, privilege/scope creep, breaking wire/field
             changes, default drift, idempotency, resource limits, image pinning"
    owner: developer-executor-security + relevant specialist (devops-specialist-* for IaC)
    finding_ids: [...]
```

**Dimension ownership is binding:** a dimension marked `checked: true` MUST name an owner
agent that actually produced a verdict for it. The Judge (Phase 7.5) rejects any
`checked: true` whose owner emitted neither a finding nor an explicit "clean: <reason +
line>". This kills unfalsifiable check-marks.

Full taxonomy (macro + micro checks per dimension): **read
`dimensions.md`**.

### Phase 5.3 — Path pass (per acceptance criterion, mandatory when Phase 1 found criteria)

The micro pass reads one function at a time, so it cannot see what only holds along a
whole path: a criterion proven nowhere end to end, a deadline that each step respects
while their sum does not. For **each acceptance criterion** extracted in Phase 1, and
for each request entry point the diff changes, trace the path from the production entry
point (route, handler, consumer, CLI command) to the store or peer it reaches, across
every hunk it crosses, and record:

```yaml
path_pass:
  - criterion: "<text from the issue or PR>"
    path: ["<entry file:line>", "<hop file:line>", "...", "<store/peer file:line>"]
    proof: "end-to-end | double-only | none"   # which test proves it, and through what
    proof_at: "<test_file:line>"                # empty when proof == none
    budget: "<sum of per-step timeouts> vs <server timeout> @ <file:line>"   # when the path sets deadlines
```

- `end-to-end`: a test drives the production entry point and the real dependency
  (or a container of it) and reads the outcome back the way the consumer will.
- `double-only`: the only proof runs against a test double. A double that accepts any
  input proves the caller's assumption, not the contract: the counterpart's real
  validation must run on the same payload somewhere (a shared fixture both sides use).
- `none`: no test reaches the criterion's outcome.

A criterion at `double-only` or `none` is a finding (severity in `triage.md`), owned by
`developer-executor-quality` (testing dimension). Per-step deadlines along one path are
summed: a sum above the server's write timeout is a finding owned by
`developer-executor-design` (perf/resilience), whatever each step does alone.

**Report the class, not the instance.** When a finding is one site of a pattern (a value
that must not reach a log, an unbounded client string echoed back, a missing deadline, an
ignored error), the producer lists every site of the same pattern in the touched files
and in their direct callers and callees, as one finding with a `sites` list. The fix
closes the class; a re-review that finds one more site of a class already reported
records it as a miss of that finding, not as a new discovery.

### Phase 5.4 — Conformance pass (normed domain only, mandatory there)

Applies when the diff or the linked issue is in a normed domain
(`../_shared/standards.md` section 1). The micro pass asks whether each hunk follows its
standard; this pass also asks what the standard requires that no hunk does.

1. Probe the normative source (standards.md section 2) before anything else. Unavailable:
   ask the user at once (section 3); the clauses it blocks are listed, and the verdict is
   INCONCLUSIVE until they are read (`contract.md`).
2. List the clauses the diff touches: those cited in the code, the issue or the PR, and
   those governing each message, field, state or procedure a hunk handles, at the version
   in force.
3. **Standard -> code.** For each clause, enumerate every obligation it states (standards.md
   section 5 lists what to read for) and find the `file:line` that meets it.
4. **Code -> standard.** For each hunk on a normed element, the clause it follows or breaks.
5. Note what the next version of each clause changes.

```yaml
conformance_pass:
  source: "<name> @ <version> — ok | unavailable: <message>"
  rows:
    - requirement: "<obligation, quoted>"
      clause: "<spec> <version> <clause>"
      in_code: "<file:line> | absent"
      missing: "<what is not done> | none"
      next_version: "<change> | no change in <version checked> | not read: <why>"
      status: "met | missing | broken | BLOCKED"
```

A `missing` or `broken` row is a finding, owned by the domain specialist dispatched in
Phase 6 (or reviewed inline and labelled unbacked when none is installed); `missing` on an
obligation the change was meant to deliver is at least HIGH. The rows also go in the
report (`synthesis.md`, « Conformance »).

### Phase 5.5 — POC / A-B (attempt to prove; demote by default)

- **Correctness** -> produce an `input -> wrong output` pair (runnable repro when
  feasible). Infeasible isolation -> demote to Needs-Verification with the simulation
  trace. Demotion is the default, not a failure.
- **Concurrency** -> a concrete interleaving (`thread A:lineX / thread B:lineY`). Never
  dismissed as "theoretical."
- **Security** -> exact source line + sink line; minimal exploit POC where feasible.
- **Perf / optimization claim** -> when the function is isolable, generate a minimal
  optimized variant + A/B benchmark in scratch (build/test tools are allow-listed) and
  report the measured delta. When not isolable, demote — an asserted speedup with no
  benchmark cannot raise confidence.

POCs/benchmarks live under the scratchpad, never in the repo.

### Phase 5.7 — Documentation & CLAUDE.md Sync (MANDATORY, GATED)

Every change drifts the project's prose. This phase makes that drift a **first-class,
verifier-gated** review dimension so docs and the CLAUDE.md hierarchy stay *iso* with the
code for future review iterations. It is **local-only and non-mutating**: like every other
/review output, it does NOT write repo files — it DETECTS the required updates and EMITS
them into the generated plan, applied later via `/refine` -> `/goal`.

**MACRO — impacted project documentation.** From the diff, identify human docs now stale
vs the code: `README*`, `docs/**` (vision/architecture/workflow/guide), API docs
(OpenAPI/`*.proto` doc comments), changelog, and any `*.md` whose claims the diff
contradicts. Each entry is a finding owned by `developer-commentator` (or a general
specialist), with a **cited doc line that contradicts the new code** as the required
counterexample (a `contract-diff`: doc claim vs actual behavior).

**MICRO — CLAUDE.md re-synchronization (touched-folders + ancestors).** Compute the
required CLAUDE.md set and emit a re-sync action for each, following `/warmup:update`
semantics so every touched folder's CLAUDE.md describes the post-change reality:

```bash
# Touched directories + ALL ancestor directories up to the repo root.
# Scope is touched-folders+ancestors, NOT the whole repo. The repo root maps to
# the bare "CLAUDE.md". This is EXACTLY what the verifier's doc-sync check recomputes.
DOC_DIRS="$(
  printf '%s\n' "$CHANGED_FILES" | while IFS= read -r f; do
    [ -n "$f" ] || continue
    d="$(dirname "$f")"
    while :; do
      if [ "$d" = "." ] || [ "$d" = "/" ] || [ -z "$d" ]; then echo "."; break; fi
      echo "$d"; d="$(dirname "$d")"
    done
  done | sort -u
)"
# Derive the required CLAUDE.md path per dir ("." -> repo-root "CLAUDE.md").
printf '%s\n' "$DOC_DIRS" | while IFS= read -r d; do
  [ "$d" = "." ] && echo "CLAUDE.md" || echo "$d/CLAUDE.md"
done | sort -u
```

For each required CLAUDE.md: if it exists, re-synchronize it (`/warmup:update` refresh
mechanics — keep within the /warmup size table, reflect new files/structure/decisions); **if a touched folder
has no CLAUDE.md, one is CREATED**. Route every CLAUDE.md/doc edit to the docs/commentator
specialist (`developer-commentator`) — see `dimensions.md`
dimension "Documentation & CLAUDE.md sync".

**Emit into the manifest + plan.** Record the outcome in `coverage_manifest.doc_sync`
(§Phase 8): per required CLAUDE.md a `{path, status: updated|created|current}` entry, plus
the stale `docs[]`. The non-LLM verifier RECOMPUTES the required CLAUDE.md set from the diff
and **FAILS (exit 1, INVALID) if any required folder's CLAUDE.md is absent** from
`doc_sync.claude_md[]` or carries a status outside `{updated,created,current}`. The concrete
edits go into `.claude/plans/review-fixes-{ts}.md`, applied by `/refine` -> `/goal`.

---
