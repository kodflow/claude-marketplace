# Review Dimension Taxonomy (consumed by Phase 5 micro pass)

The full per-dimension checklist that `developer-executor-*` and `developer-specialist-*`
producers run during the **MICRO PASS** (review.md Phase 5) and that the **MACRO PASS**
(Phase 4) consumes at file level. Not prose — a checklist. Each dimension declares its
**owner agent** (binding, from review.md Phase 5 `dimensions_checked`), the **required
counterexample type**, and its **activation gate**.

## How producers consume this file

```yaml
consume_protocol:
  - "You own only the dimensions whose `owner` names your agent. Run those macro + micro checks."
  - "A finding ships ONLY with file:line(s) + the dimension's required counterexample. No counterexample -> DEMOTE to Needs-Verification (gating), never drop. (review.md §Severity)"
  - "Mark a dimension checked:true ONLY if you emitted a finding OR an explicit clean statement:
       clean: \"<reason> @ <file:line>\"  (cited line mandatory)."
  - "A checked:true with neither a finding nor a cited clean line is REJECTED by the Judge (Phase 7.5) and reverts the dimension to `unverified` -> verdict cannot be APPROVE."
  - "Gated dimensions (portability, a11y/i18n): if the gate is false, emit `N/A` with the gate reason; do NOT fabricate checks."
  - "Ground every library/API/deprecation/license claim via mcp__context7__* before asserting it."
```

## Owner + counterexample + gate quick-reference

| # | Dimension | Owner agent | Required counterexample | Gate |
|---|-----------|-------------|-------------------------|------|
| 1 | Correctness / logic | `developer-executor-correctness` | **repro** (input -> wrong output) | always |
| 2 | Security (+ data-privacy/PII, licensing) | `developer-executor-security` | **source->sink** (+ POC where feasible) | always |
| 3 | Language idioms & conventions | `developer-specialist-{go|python|nodejs|react|rust|c|cpp}` (SQL: `data-specialist-postgres`; shell/CI: `developer-executor-shell`) | **repro** (footgun -> wrong output); pure style -> nitpick, no CE | always (per matched ext) |
| 4 | Architecture & folder (+ maintainability) | `developer-executor-design` (maintainability: `developer-executor-quality`) | **contract-diff** (offending dep/import edge) | always |
| 5 | Cross-platform portability | `developer-specialist-{lang}` | **repro** (per target: wrong output on target T) | **Phase 0.7 `cross_platform==true`** |
| 6 | Performance | `developer-executor-design` | **benchmark** (A/B before vs after) | always |
| 7 | Concurrency | `developer-executor-correctness` | **interleaving** (A:lineX / B:lineY) | always |
| 8 | Error handling | `developer-executor-correctness` | **repro** (failure input -> inconsistent state) | always |
| 9 | API / contract & backward-compat | `developer-executor-design` | **contract-diff** (signature/schema/wire before vs after) | always |
| 10 | Testing adequacy | `developer-executor-quality` | **repro** (mutation: injected bug -> tests stay green) | always |
| 11 | Docs / comments accuracy | `developer-executor-quality` | **contract-diff** (doc/docstring vs actual behavior) | always |
| 12 | Dependency / supply-chain | `developer-executor-security` | **source->sink** (CVE reachability); license -> **contract-diff** | manifest/lockfile touched |
| 13 | Observability | `developer-executor-shell` | **repro** (failure path that emits no log/metric/trace) | always |
| 14 | Accessibility / i18n | `developer-specialist-react` / `developer-specialist-nodejs` | **repro** (keyboard/SR fail or wrong locale output) | **UI-touch / user-facing strings** |
| 15 | Documentation & CLAUDE.md sync | `developer-commentator` (or general specialist) | **contract-diff** (cited doc/CLAUDE.md line that contradicts the new code) | always |

Counterexample-type contract: **§Counterexample Reference** at the bottom.

---

## 1. Correctness / logic bugs

```yaml
dimension: correctness
owner: developer-executor-correctness
counterexample: repro            # concrete input -> wrong output (runnable when feasible, else simulation trace)
gate: always
why: |
  Highest-value dimension: wrong results ship to users regardless of input. Diff-only
  scope structurally misses cross-file logic breakage — close it with the call graph.
macro:                           # whole-codebase / architecture level
  - "Blast radius: for every changed symbol, locate ALL callers/dependents (Phase 3.5 graph) and verify the change breaks no caller contract (arg count/types, nullability, error semantics, ordering, side effects)."
  - "Intent-vs-implementation: diff implements exactly the PR/issue acceptance criteria — no scope creep, no unmet criterion."
  - "Change-implies-change (Phase 3.7): touched lib whose historically co-changing test/doc/migration/sibling is NOT touched -> probable missed edit."
  - "Invariant preservation: global invariants / state machines touched still hold across ALL entry points, not just the modified path."
  - "can_be_split: PR mixes unrelated themes (bugs hide in incoherent diffs)."
micro:                           # per-function / per-line (projection-simulate boundary inputs)
  - "Null/undefined/None deref; off-by-one; boundary cases: empty collection, single element, max/min, overflow."
  - "Wrong operator/comparison, inverted conditional, wrong default value, shallow-vs-deep copy/merge."
  - "Resource leaks: unclosed file/handle/connection, missing defer/finally/with, missing cleanup on the error path."
  - "Dead/unreachable code; committed debug code (hard-coded `return true`, leftover stub, commented-out block)."
  - "Each finding carries a concrete input->wrong-output pair; hard-to-repro != drop (demote with simulation trace)."
clean_template: 'clean: "boundary+nil+overflow simulated, branches reachable & correct @ <file:line-range>"'
```

---

## 2. Security (+ data-privacy/PII, licensing sub-lenses)

```yaml
dimension: security
owner: developer-executor-security
counterexample: source->sink     # exact source line + sink line; minimal POC where feasible
gate: always
why: |
  Highest blast radius per defect. Deterministic SAST/secrets/SCA tiers (Phase 3) feed
  grounded hits here; the old FP loopholes (defer secrets to a hook, dismiss 'theoretical')
  are abolished — dismissal requires a cited justifying line (else it is itself a finding).
macro:
  - "Manual taint/dataflow from every user-controlled SOURCE (request params, env, files, network) to sensitive SINK (SQL, shell, eval, deserialization, file path, template) ACROSS file boundaries."
  - "Auth/authorization on every new/changed endpoint: authN present, authZ/ownership enforced (IDOR), privilege boundary not crossed, session/JWT validated."
  - "Trust-boundary map: what newly crosses process/network/tenant boundaries; CORS, security headers, TLS/cert validation, SSRF surface."
  - "Ingest Phase 3 security tiers as grounded input: semgrep, gitleaks/trufflehog/detect-secrets, osv-scanner/trivy/govulncheck, checkov/tfsec, actionlint, hadolint."
  - "ENFORCEMENT-COMPLETENESS (independent threat-model of the PROPOSED control, #397). For EVERY new/changed security control (signature/MAC verification, revocation/CRL/OCSP, auth, access control, input validation, sandboxing), red-team the control ITSELF from a blank threat-model — do NOT start from what the diff/plan CLAIMS. Walk the checklist: (a) AUTHENTICITY — is the artifact cryptographically bound to the trusted authority? e.g. CRL parsed but no CheckSignatureFrom(CA) ⇒ any CRL revokes anything; (b) FRESHNESS — expiry/validity window enforced? [ThisUpdate,NextUpdate], nonce, monotonic counter, replay; (c) INPUT ROBUSTNESS — every accepted encoding/format handled or explicitly rejected? DER-only path breaks on a PEM input; (d) FAIL MODE — on parse/verify/IO error does it fail-CLOSED (deny) or fail-OPEN (allow)? A missing verify step is a MISSING half of a control, and a half-enforced security control is a HIGH finding even when every claim the document makes is individually true."
micro:
  - "Injection: SQL/NoSQL, command, LDAP/XPath, XXE, template, path traversal — cite exact source line AND sink line."
  - "Crypto/secrets: hardcoded key/token, weak algo (MD5/SHA1/DES/ECB), non-CSPRNG randomness, missing cert validation."
  - "Code execution: unsafe deserialization (pickle / YAML load / Java), eval/exec on tainted input."
  - "XSS (reflected/stored/DOM), sensitive-data/PII logging, debug-info leak, verbose errors leaking internals."
  - "TOCTOU & security-relevant races -> require a concrete interleaving; NEVER auto-dismiss as theoretical."
sub_lenses:
  data_privacy:                  # owner: developer-executor-security
    why: "PII / LI-data exposure is CRITICAL (ETSI/3GPP lawful-interception context)."
    checks: "PII at-rest/in-transit encryption, retention/minimization, audit-log presence, no PII in logs/metrics/errors, ETSI/3GPP wire-format handling for intercepted data."
    counterexample: source->sink   # PII source -> unprotected sink
  licensing:                     # owner: developer-executor-security
    why: "New deps introduce license/legal risk."
    checks: "License of each new dependency compatible with project license; flag copyleft into permissive; vendored/copied code attributed + licensed."
    counterexample: contract-diff  # license(dep) vs project license incompatibility
clean_template: 'clean: "no tainted source reaches a sink; secrets/crypto/authZ checked @ <file:line>"'
```

---

## 3. Language idioms & conventions

```yaml
dimension: idioms
owner: developer-specialist-{lang}    # routed via ~/.claude/scripts/route-agent.sh (review.md Phase 6)
counterexample: repro                  # idiom footgun -> wrong output; PURE style -> nitpick bucket, no CE
gate: always (fire only on matching file extensions)
why: |
  Idiomatic violations cause subtle bugs + maintenance cost; each language has non-obvious
  footguns. Run the language linter as a deterministic tier (Phase 3) and feed output here
  rather than asking the model to invent lint findings.
macro:
  - "Phase 3 ran the language linter/static analyzer (golangci-lint+go vet, clippy, ruff+mypy, eslint+tsc, clang-tidy+cppcheck, ...). Ingest its grounded hits; `absent` tool -> dimension confidence-capped + named."
  - "Project-wide convention conformance (naming, error-wrapping style, module layout) vs the repo's ACTUAL established patterns — learn from existing code, not generic style."
  - "Path-glob scoping: tests/ reviewed differently from src/api/; only fire a language rule on its matching extension."
micro_by_language:                     # verbatim per-language footgun lists
  go:                                  # developer-specialist-go
    - "error wrapping (%w), context propagation, goroutine leaks, defer in loops, nil interface vs nil pointer, struct DTO tags, no naked returns in long funcs"
  rust:                                # developer-specialist-rust
    - "unwrap/expect/panic in library code, unnecessary clone, lifetime/borrow misuse, unsafe blocks without justification, Result/Option handling, blocking in async"
  python:                              # developer-specialist-python
    - "mutable default args, bare except, == vs is, missing __init__ exports, type hints, Decimal for money, f-string injection"
  ts_js:                               # developer-specialist-nodejs (+developer-specialist-react when react detected)
    - "any usage, == vs ===, floating promises/missing await, non-null assertion abuse, enum vs union, exhaustive switch"
  c:                                   # developer-specialist-c
    - "buffer bounds, signed/unsigned, integer overflow, use-after-free/double-free, missing free, format-string, uninitialized memory, alignment"
  cpp:                                 # developer-specialist-cpp
    - "buffer bounds, signed/unsigned, integer overflow, use-after-free/double-free, missing free, format-string, uninitialized memory, alignment (plus RAII, rule-of-5, move/forwarding, span/iterator invalidation, packing/alignment)"
  sql:                                 # data-specialist-postgres (lint: sqlfluff; pg: EXPLAIN ANALYZE)
    - "injection-safe params: parameterized queries / bind vars ONLY — string-concatenated user input into SQL is a source->sink finding, never an idiom nitpick"
    - "N+1: per-row query inside an application loop instead of a set-based JOIN/IN; cite the loop site + the query (counterexample: benchmark or row-count projection)"
    - "index usage: predicate not sargable (function on column, leading-wildcard LIKE, implicit cast defeating index), missing index on join/filter/FK columns, SELECT * on wide tables (counterexample: EXPLAIN showing Seq Scan)"
    - "migration safety: destructive vs additive (column drop/rename breaks rolling deploy), lock-heavy DDL on large tables (ALTER without CREATE INDEX CONCURRENTLY), non-reversible migration (no down), unbatched backfill (counterexample: contract-diff before vs after schema)"
    - "correctness footguns: NOT IN with NULL (silently empty), missing transaction boundary on multi-statement mutation, float for money, ambiguous ORDER BY without deterministic tiebreak"
clean_template: 'clean: "linter green for changed ext + project conventions matched @ <file:line>"'
```

---

## 4. Architecture & folder structure (+ maintainability sub-lens)

```yaml
dimension: architecture
owner: developer-executor-design       # maintainability sub-lens: developer-executor-quality
counterexample: contract-diff          # the offending dependency/import edge (allowed-direction vs actual)
gate: always
why: |
  Locally-correct changes can violate layering, SRP, module boundaries — the structural,
  senior-judgment layer. Needs call-graph context (Phase 3.5), which diff-only review lacks.
macro:
  - "Layering respected: no inversion (domain importing infra, UI importing DB); dependency direction correct."
  - "File/folder placement matches project structure (new files in correct package/dir; new public API surface intentional, not accidental)."
  - "Detect God/Brain class growth, low cohesion (LCOM4), cross-cutting concerns leaking across modules."
  - "Emit a Mermaid sequence/flow/ER diagram when the change touches multiple services, a schema, or core business logic."
micro:
  - "Function smells: Brain Method, Bumpy Road, deep nesting, complex conditional, too many arguments, primitive obsession, constructor over-injection."
  - "Per-function cyclomatic + cognitive complexity; flag functions whose complexity TREND worsens vs prior revisions (git blame/log)."
  - "Duplication that matters: DRY violations on logic that historically changes together (behavioral, not incidental)."
maintainability_sub_lens:              # owner: developer-executor-quality
  note: "Complexity/metrics judgment is owned by developer-executor-quality. When a metric tool is absent, label the judgment `static-heuristic`, do NOT assert a number. Soft-pedal code being refactored; escalate degrading hotspots (change-frequency x complexity)."
clean_template: 'clean: "dep direction + placement + cohesion checked; no inversion @ <file:line>"'
```

---

## 5. Cross-platform portability  (CONDITIONAL)

```yaml
dimension: portability
owner: developer-specialist-{lang}
counterexample: repro                   # per target: input -> wrong/divergent output on target T
gate: "Phase 0.7 platform_probe.cross_platform == true (matrix/build-tags/cfg!/ifdef found OR CLAUDE.md says so). Else emit: portability: N/A — single target."
why: |
  A change correct on the author's machine can break on another OS/arch/runtime. High value
  for systems/CLI/telecom code (C/Go). Rarely covered by generic AI reviewers.
macro:
  - "Identify platform-specific assumptions introduced (path separators, line endings, case-sensitive FS, endianness, word size, syscalls) and whether they are guarded."
  - "Build/CI matrix still covers the targeted platforms; flag features unavailable on a supported target / min runtime version."
  - "Conditional-compilation correctness across ALL declared targets (Go build tags, #ifdef, cfg!)."
micro:
  - "Hardcoded paths (/tmp, C:\\), shell builtins assuming bash, GNU-vs-BSD flag differences in invoked tools."
  - "Time zone / locale / encoding assumptions; 32-vs-64-bit integer truncation; struct packing/alignment for wire formats."
  - "Filesystem case-sensitivity, max path length, permission-model differences."
  - "Per the gate: check EVERY target in platform_probe.targets."
clean_template: 'clean: "no unguarded platform assumption; build tags valid for all targets @ <file:line>"'
```

---

## 6. Performance

```yaml
dimension: perf
owner: developer-executor-design
counterexample: benchmark               # A/B before-vs-after in scratch (build/test tools allow-listed); not isolable -> demote
gate: always
why: |
  Regressions degrade UX and cost money; static review catches algorithmic and query issues.
  Asserted speedups with NO benchmark cannot raise confidence (review.md §5.5).
macro:
  - "Identify changes on hot paths (cross-ref behavioral hotspots = git change-frequency x complexity) and weight findings there."
  - "Detect N+1 query patterns, missing batching/pagination, unbounded fan-out, synchronous calls in loops across the call graph."
  - "Where a finding claims a speedup, generate a minimal optimized variant + A/B benchmark in scratch and report the MEASURED delta; not isolable -> demote."
micro:
  - "Quadratic loops over large collections; repeated recompute inside loops; unnecessary allocations/copies on hot paths."
  - "Missing indexes implied by new query predicates; SELECT *; full-table scans."
  - "Inefficient data structures (list membership vs set), eager vs lazy, redundant serialization."
clean_template: 'clean: "no hot-path regression; complexity unchanged or improved @ <file:line>"'
```

---

## 7. Concurrency

```yaml
dimension: concurrency
owner: developer-executor-correctness
counterexample: interleaving            # concrete thread A:lineX / thread B:lineY ordering
gate: always
why: |
  Races/deadlocks are the hardest-to-reproduce, highest-value bugs. They land in
  Needs-Verification (gating) when no clean repro exists — NEVER dropped as 'theoretical'.
macro:
  - "Map shared mutable state introduced/touched; verify all access paths are synchronized consistently (same lock order everywhere), across files."
  - "Detect lock-ordering inversions that deadlock when two paths acquire locks in opposite order."
  - "Verify channel/queue lifecycle: close semantics, send-on-closed, goroutine/thread leak on cancellation."
micro:
  - "Data races: unguarded read/write of shared var, non-atomic check-then-act, concurrent map access (Go), shared mutable captured in closures."
  - "Missing/incorrect memory ordering on atomics; double-checked-locking errors."
  - "Each race supplies a concrete interleaving (thread A line X / thread B line Y); never drop because 'theoretical'."
clean_template: 'clean: "shared state synchronized; lock order consistent; no send-on-closed @ <file:line>"'
```

---

## 8. Error handling

```yaml
dimension: error_handling
owner: developer-executor-correctness
counterexample: repro                   # failure input -> swallowed/wrong handling -> inconsistent state
gate: always
why: |
  Silent failures and swallowed errors cause data corruption and undebuggable incidents —
  a category generic linters miss.
macro:
  - "Error-propagation contract consistent across the changed call chain (errors wrapped/typed, not lost between layers)."
  - "New failure modes handled at the appropriate boundary (retry/rollback/compensation), not just logged-and-continued where correctness requires abort."
micro:
  - "Swallowed errors (empty catch, `_ = err`, ignored error); errors logged but not returned where the caller must know."
  - "Missing rollback/cleanup on partial failure (transactions, multi-step mutations); error path leaving inconsistent state."
  - "Panics/unwraps reachable from untrusted input; generic catch hiding a specific recoverable error; lost error context."
clean_template: 'clean: "errors propagated/typed; partial-failure rollback present @ <file:line>"'
```

---

## 9. API / contract & backward compatibility

```yaml
dimension: api_contract
owner: developer-executor-design
counterexample: contract-diff           # before vs after of signature / schema / wire format / flag
gate: always
why: |
  Breaking a public API, wire format, or DB schema breaks consumers silently. Diff-only
  review misses downstream consumers — use the Phase 3.5 graph to find them.
macro:
  - "Detect breaking changes to public signatures, exported types, REST/gRPC/event schemas, CLI flags, config keys; verify ALL callers/consumers (incl. other repos/services) updated or a compat shim exists."
  - "DB migration backward-compat: additive vs destructive, safe for rolling deploy, reversible (down migration), no lock-heavy ops on large tables."
  - "Version/contract semantics: semver impact, deprecation path, ETSI/3GPP wire-format conformance where relevant."
micro:
  - "Changed function signature without updating all call sites; added required param/field with no default."
  - "Serialization tag/field rename or reorder breaking wire compatibility; enum value reuse."
  - "Endpoint path/method/status-code/contract drift vs spec/OpenAPI."
clean_template: 'clean: "no breaking signature/schema/wire change OR all consumers updated @ <file:line>"'
```

---

## 10. Testing adequacy

```yaml
dimension: testing
owner: developer-executor-quality
counterexample: repro                    # mutation signal: inject a plausible bug into changed lines -> existing tests still pass
gate: always
why: |
  Untested changed code is unverified. Field tools treat missing tests for changed code,
  and test-code quality itself, as first-class.
macro:
  - "Every changed public function / new branch has corresponding test coverage; flag changed code with zero touching tests."
  - "Tests assert behavior tied to the change's intent (not merely that it runs); edge/error cases covered."
  - "Mutation signal: would existing tests catch a plausible injected bug in the changed lines? If not, coverage is theatrical."
micro:
  - "Test smells: large/duplicated assertion blocks, missing abstractions, tests asserting implementation not behavior, flaky time/network dependence."
  - "Missing negative tests, missing boundary tests, over-mocked tests that cannot fail."
  - "New config/feature flag with no test exercising BOTH states."
clean_template: 'clean: "changed symbols covered; mutation of changed line would fail a test @ <test_file:line>"'
```

---

## 11. Docs / comments accuracy

```yaml
dimension: docs
owner: developer-executor-quality
counterexample: contract-diff            # doc/docstring claim vs actual code behavior
gate: always
why: |
  Comments that lie are worse than none. CLAUDE.md mandates comments explain WHY not WHAT.
macro:
  - "Docs drift: public behavior changed but README/API docs/changelog/architecture docs not updated; new docs/*.md not registered in nav config."
  - "PR description / auto-generated walkthrough accurately reflects what the code does."
micro:
  - "Docstring/signature mismatch (params, return type, raised errors out of date); comment describing OLD behavior."
  - "Comments explaining WHAT (restating code) instead of WHY; missing docstrings on new public functions (params/types/return)."
  - "Misleading variable/function names vs actual behavior."
clean_template: 'clean: "docstrings match signatures; public-behavior docs updated @ <file:line>"'
```

---

## 12. Dependency / supply-chain

```yaml
dimension: deps
owner: developer-executor-security
counterexample: source->sink             # CVE reachability: vulnerable symbol reached via call graph; license sub-finding -> contract-diff
gate: "manifest/lockfile in diff (package-lock.json, yarn.lock, pnpm-lock.yaml, Cargo.lock, go.sum, poetry.lock, go.mod, package.json, requirements*.txt, ...)"
why: |
  New deps introduce CVEs, license risk, and maintenance burden. Phase 3 SCA must ASSERT it
  ran (exit code + counts from .out); a deferred-without-assertion scan is a gap.
macro:
  - "Phase 3 SCA executed on changed manifests/lockfiles (osv-scanner / trivy / govulncheck) and surfaced CVEs with severity inline; assert it RAN (status from _table.tsv)."
  - "License compatibility of each new dependency with the project license; flag copyleft into permissive (contract-diff)."
  - "Justify each new dependency: necessary, maintained, reputable (typosquat / abandonment / maintainer-change check)? Could stdlib/existing dep cover it?"
micro:
  - "Lockfile updated consistently with manifest; no unpinned/floating versions for security-relevant deps."
  - "No accidental dependency on a transitive that may vanish; no dev dependency leaking into prod."
  - "Vendored/copied code attributed and licensed."
clean_template: 'clean: "SCA ran clean (exit 0); new deps licensed-compatible & pinned @ <manifest:line>"'
```

---

## 13. Observability

```yaml
dimension: observability
owner: developer-executor-shell
counterexample: repro                    # exercise a failure path that emits no log/metric/trace (silent branch)
gate: always
why: |
  Changes that cannot be debugged in prod create long incidents. High value for
  backend/telecom services; rarely covered by generic AI reviewers.
macro:
  - "New failure modes and key state transitions emit logs/metrics/traces at the right level; new endpoints/handlers instrumented consistently with existing ones."
  - "Correlation/trace IDs propagate across the new call path; SLO-relevant operations are measured."
micro:
  - "Log levels appropriate (no error-spam, no missing error logs); no PII/secrets in logs; structured fields consistent."
  - "Metric cardinality safe (no unbounded label like user-id); counter/gauge/histogram chosen correctly."
  - "No log inside a tight loop causing flood; actionable error messages (include identifiers/context)."
clean_template: 'clean: "failure paths instrumented; trace IDs propagate; no PII in logs @ <file:line>"'
```

---

## 14. Accessibility / i18n  (CONDITIONAL)

```yaml
dimension: a11y_i18n
owner: developer-specialist-react        # or developer-specialist-nodejs for non-react user-facing code
counterexample: repro                    # keyboard/screen-reader failure OR wrong locale-formatted output
gate: "diff touches UI (frontend components) OR adds/changes user-facing strings. Else emit: a11y_i18n: N/A — no UI / user-facing strings."
why: |
  For UI / multi-locale code, a11y and i18n defects exclude users and are legally material.
macro:
  - "If the diff touches UI: verify semantic markup, ARIA roles/labels, keyboard navigation, focus management, color-contrast on new components."
  - "If user-facing strings added: verify they are externalized for translation, not concatenated, and pluralization/locale formatting (date/number/currency/RTL) is handled."
micro:
  - "Missing alt text, label-for association, accessible names on interactive elements."
  - "Hardcoded user-facing strings bypassing the i18n catalog; locale-unsafe string ops (case, sort, split on words)."
  - "Time/number/currency formatted without locale; assumption of LTR layout."
clean_template: 'clean: "ARIA/keyboard/contrast checked; strings externalized & locale-formatted @ <file:line>"'
```

---

## 15. Documentation & CLAUDE.md sync  (MANDATORY, GATED)

```yaml
dimension: doc_sync
owner: developer-commentator           # docs/commentator specialist; or a general specialist when no commentator routes
counterexample: contract-diff          # a cited doc/CLAUDE.md line that CONTRADICTS the new code
gate: always
why: |
  Code drifts the prose. Stale docs and a stale CLAUDE.md hierarchy mislead the NEXT review
  iteration (and every human reader). This dimension keeps human docs honest and keeps every
  touched folder's CLAUDE.md *iso* with the change. It is gated: the non-LLM verifier
  recomputes the required CLAUDE.md set from the diff and INVALIDATES the run (exit 1) if any
  required folder's CLAUDE.md is absent from manifest.doc_sync.claude_md[]. Review is
  LOCAL-ONLY and NON-MUTATING — this dimension DETECTS and EMITS the updates into the plan;
  they are applied via /refine -> /goal, never written here.
macro:                                 # impacted PROJECT documentation (stale vs the diff)
  - "From the diff, find human docs now stale vs the code that MUST be updated: README*, docs/** (vision / architecture / workflow / guides), API docs (OpenAPI, *.proto doc comments), changelog, and any *.md whose claims the diff contradicts."
  - "Each stale doc is a finding with a cited doc line that contradicts the new code (contract-diff: doc claim vs actual post-change behavior). New docs/*.md must be registered in the project's nav/index where one exists."
  - "Record impacted docs in manifest.doc_sync.docs[] as {path, status}."
micro:                                 # CLAUDE.md re-sync — touched folders + ALL ancestors
  - "Compute the required set = EVERY directory touched by the change AND all its ANCESTOR directories up to the repo root (the repo root maps to the bare top-level CLAUDE.md). Scope is touched-folders+ancestors ONLY — NOT the whole repo."
  - "For each required directory, re-synchronize <dir>/CLAUDE.md following /warmup:update refresh mechanics (../warmup/update.md): keep < 200 lines, reflect new/removed files, structure, and decisions so it stays iso for future iterations."
  - "If a touched folder has NO CLAUDE.md, one is CREATED (status: created). An existing-and-already-accurate CLAUDE.md is status: current; an edited one is status: updated."
  - "Emit each required CLAUDE.md into manifest.doc_sync.claude_md[] as {path, status: updated|created|current}. The verifier FAILS the run if any required path is missing or carries any other status."
emit: |
  The concrete doc + CLAUDE.md edits are written into .claude/plans/review-fixes-{ts}.md
  (applied by /refine -> /goal), and summarized in manifest.doc_sync. Nothing is written to
  the repo by /review itself.
clean_template: 'clean: "all touched-dir+ancestor CLAUDE.md iso with change; no doc line contradicts code @ <file:line>"'
```

---

## Counterexample Reference (binding per category)

```yaml
counterexample_contract:               # review.md §5.5 / §Severity — missing CE => DEMOTE (gating), never drop
  repro:
    must_contain: "concrete input -> observed wrong output (runnable repro in scratch when feasible, else a step-by-step simulation trace)."
    used_by: [correctness, idioms, error_handling, portability, testing(mutation), observability, a11y_i18n]
  source->sink:
    must_contain: "exact tainted SOURCE line + dangerous SINK line (file:line each); minimal exploit POC where feasible."
    used_by: [security, data_privacy, deps(CVE-reachability)]
  interleaving:
    must_contain: "a concrete thread/goroutine ordering: thread A @ file:lineX, thread B @ file:lineY producing the race/deadlock."
    used_by: [concurrency, security(TOCTOU)]
  benchmark:
    must_contain: "A/B measurement (before vs after) on a representative workload in scratch, with the measured delta. Not isolable -> demote."
    used_by: [perf]
  contract-diff:
    must_contain: "before vs after of the contract artifact (signature / schema / wire field / CLI flag / config key / docstring / license / doc or CLAUDE.md line) showing the break or divergence."
    used_by: [api_contract, architecture, docs, deps(license), doc_sync]
demotion_rule: "A finding lacking its required counterexample is DEMOTED to Needs-Verification (which gates: any CRITICAL/HIGH there caps merge score <=3 and blocks --loop exit). Demotion is the default; proof is the bonus. Never silently dropped."
```

## False-negative guard (Judge cross-check, Phase 7.5)

```yaml
clean_statement_rule:
  - "Every dimension marked checked:true with no finding MUST carry a clean: line with a cited file:line."
  - "A clean statement with no cited line -> dimension reverts to `unverified`; verdict cannot be APPROVE."
  - "Cross-checked against the Phase 0.8 canary: if the seeded defect was not flagged, an empty findings array -> INCONCLUSIVE."
  - "Gated dimensions emit `N/A` + gate reason (not `clean`) when their gate is false."
```
