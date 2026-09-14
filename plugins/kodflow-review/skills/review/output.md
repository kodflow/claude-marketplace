# /review — output format, flags, and budget

How the review is rendered, which flags change it, and the budget controller
that keeps a large diff from exhausting the run. Read this at Phase 9, when
the findings are settled and the report is being written.

## Output

LOCAL only — **never posts** review comments or MR/PR replies. Phase 2.5 answers and Phase
1.5 descriptions are emitted as **drafts the user may choose to post** (with the NO-AI-
mention rule applied to the draft text). Generates:
- Console report: walkthrough, Mermaid (when applicable), verdict (0–5 or INCONCLUSIVE),
  Confirmed findings (by severity×confidence), **Needs-Verification tier (gating)**,
  nitpicks bucket, tier-status table (from `.out`), verifier result, coverage-manifest
  summary, suppression appendix.
- `.claude/review-manifest-{ts}.json` (machine, verifier-checked).
- `.claude/plans/review-fixes-{timestamp}.md` for `/refine` -> `/goal`.

Synthesis details: **read `synthesis.md`**.

---

## Usage / Flags

```
/review                     # Single review (no fix, no loop)
/review --loop [N]          # Cyclic until correctness-clear AND verifier-green
/review --pr <n>            # GitHub PR    /review --mr <n>   # GitLab MR
/review --staged            # Staged changes only
/review --file <path>       # Single file (still macro+micro+manifest+verifier for it)
/review --security|--correctness|--design|--quality|--concurrency|--perf|--portability|--privacy
/review --deep              # Force deep pass + ensemble (N=3)
/review --strictness chill|assertive       # default: assertive
/review --triage            # Large-diff mode (>30 files OR >1500 lines); micro-deferral -> INCONCLUSIVE
/review --describe          # Force auto-describe (draft only)
/review --tier all|internal|external|qodo|coderabbit|deterministic
/review --no-poc            # Skip POC/benchmark (findings demoted; verdict forced INCONCLUSIVE)
/review --help
```

**IF `$ARGUMENTS` contains `--help`**: print this Usage block and STOP.

---

## Budget Controller

```yaml
budget:
  normal: {max_files: 30, max_lines: 1500, max_comments: 80}
  graph:  {max_symbols: 40, max_callers_per_symbol: 25}     # hard caps to bound context
  manifest: "compact form: counts + ranges, not full source echoes"
  triage:
    trigger: "files > 30 OR lines > 1500"
    action: "Prioritize risk-touched + security; STILL emit a manifest covering 100% of hunks
             at macro level. Deferred micro on risk-touched files -> verdict INCONCLUSIVE
             (never a clean pass); deferred micro on low-risk files -> listed as
             micro_pass: deferred(reason), never silently omitted."
  output_caps: {critical: unlimited, high: 10, medium: 5, low(nitpicks): collapsed}
```

Even in TRIAGE the verifier accounts for **every** hunk; deferred micro passes are
explicit and downgrade the verdict.

---
