# /review — scoring contract and anti-theater rules

Reference material for the phases in `SKILL.md`: how severity and confidence
are scored (they are decoupled), and the hard rules that make a fake pass
mechanically detectable. Read this before assigning a severity or writing the
verdict.

## Severity & Confidence Model (decoupled — and the gate is real)

**Two independent axes plus a gating verification status. Confidence NEVER deletes a
finding.**

**Axis 1 — Severity / impact:**
- `CRITICAL` — exploitable security, data loss/corruption, crash on common path,
  money/safety, PII/LI-data leakage.
- `HIGH` — real bug or vuln needing specific conditions.
- `MEDIUM` — quality/maintainability/perf with bounded impact.
- `LOW` — nit/style (collapsed into a nitpicks bucket).

Cross-tag category (Logic/Security/Concurrency/Perf/Arch/ErrorHandling/API/Test/Docs/
Deps/Observability/Privacy/Licensing/Portability/Style) and an actionability flag
(**Blocking** vs Non-blocking). Blocking findings gate the generated `/refine` -> `/goal` plan.

**Axis 2 — Confidence (0–100)**, derived from EVIDENCE, not vibes. Anchored at
0/25/50/75/100. Boosters: deterministic-tool confirmation, multi-pass/ensemble agreement
(cap 100), a working POC/repro/exploit, cross-tier confirmation. Confidence is
**recomputed from objective signals** — the model cannot low-ball it to dodge work, and a
missing-but-applicable tool caps the achievable confidence for that dimension.

**Verification status (replaces all "drop" rules — and it GATES):**
- `Confirmed` — grounded with command trail + counterexample.
- `Needs Verification` — genuine severity, weak/absent confirmation. Surfaced in its own
  clearly-labeled tier. **Any CRITICAL/HIGH in this tier caps the merge score at <=3 and
  blocks `--loop` exit.** This is a gate, not a soft-drop. (Subtle races / logic bugs with
  no clean repro live here and still block.)
- `Rejected (hallucination)` — Judge could not ground it; logged in the appendix.

**Mandatory evidence per finding:** `file:line(s)` + tool/command trail +
category-appropriate counterexample (repro / source->sink / interleaving / benchmark).
Missing the counterexample -> **demote** (which now gates), never drop.

**Verdict synthesis:** one **0–5 PR merge score** fusing max severity + blast-radius/
complexity + pattern-alignment: `5 = merge`, `3 = address-first`, `0–1 = rethink`. Plus a
sixth terminal state **INCONCLUSIVE** (see below). A **ratchet/delta gate** blocks only
when the change makes a *touched* file WORSE, not on pre-existing debt.

**INCONCLUSIVE (non-APPROVE) is forced when:** verifier failed; canary failed; `--no-poc`
was used; TRIAGE deferred micro on risk-touched files; or an applicable tier needed for a
CRITICAL-capable dimension is absent and no manual grounding replaced it. INCONCLUSIVE is
the honest outcome and is preferred over a fabricated green manifest.

**Output discipline:** rank by severity × confidence; collapse a nitpicks bucket; cap
surfaced findings per tier with a verbose appendix; tunable strictness (`--strictness
chill|assertive`, default assertive). Every filtered finding + reason is logged.

Full rubric anchors + JSON schema: **read `triage.md`**.

---

## Anti-Theater Guardrails (hard rules)

| Guardrail | Enforcement |
|-----------|-------------|
| Evidence-or-reject | No `file:line` -> Judge auto-rejects before output |
| Counterexample per category | repro / source->sink / interleaving / benchmark, else demote (gating) |
| External manifest verifier | `review-verify-manifest.sh` recomputes hunks+symbols from git; exit 0=PASS, 1=INVALID, 2=not-approve-eligible, 3=usage (any nonzero blocks APPROVE) |
| Symbol-set binding | `symbols_inspected` must ⊇ verifier's diff-extracted symbol set; under-count = INVALID |
| Doc & CLAUDE.md sync | verifier recomputes required CLAUDE.md set (touched dirs + ancestors); any absent/wrong-status entry in `doc_sync.claude_md[]` = INVALID; blocks loop exit |
| Tier table from output | exit/findings PARSED from `.out`; model-authored tier numbers = INVALID |
| Dimension ownership | every `checked:true` names an owner that emitted a finding or a cited `clean:` line |
| Canary self-test | seeded defect must be flagged; failure -> empty-findings verdict becomes INCONCLUSIVE |
| Needs-Verification gate | any CRITICAL/HIGH there caps score <=3 and blocks loop exit (no "unexamined" weasel) |
| --no-poc / TRIAGE micro-defer | forces INCONCLUSIVE, never a clean APPROVE |
| Judge stage | re-grounds every finding; logs all drops; "empty grep != proof" |
| No theater edits | replying/LGTM/re-emitting a summary is NOT a review; diff_hash mismatch detects no-op |
| Tool-absent honesty | `absent` is loud and caps confidence; never silently treated as pass |
| Auditable suppression | every FP exclusion MUST cite the justifying line; unjustified exclusion is itself a finding |
| Hard gates live here | the verdict-gating rules live in THIS file + the verifier script, not only in "read the module" prose |

---
