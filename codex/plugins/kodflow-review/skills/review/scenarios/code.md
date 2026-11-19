<!-- scenario-contract v1
name: code
selects_when: arg is a PR number, a git diff/range, or --staged/--pr/--code
lenses: [correctness, security, design, quality, shell]
writes: .claude/plans/review-fixes-<timestamp>.md
engine: workflow
-->

# /review scenario — `code`

Reviews **code / a diff / a PR** (the legacy default `/review` behaviour). Selected
when the argument is a PR number, a git range, or `--staged`/`--pr`/`--code`.

## Lenses (5-lens guarded fan-out → merge → challenge)

| Lens | Agent | Notes |
|---|---|---|
| correctness | `reviewer-correctness` (sonnet) | invariants, off-by-one, error surfacing |
| security | `reviewer-security` (opus) | taint source→sink, OWASP |
| design | `reviewer-design` (sonnet) | conditional on arch risk |
| quality | `reviewer-quality` (haiku) | complexity, smells, style |
| shell | `reviewer-shell` (haiku) | conditional on shell/docker/ci |

Findings are merged (evidence-gated, 3×MED→HIGH) then challenged (Grep-verified
KEEP/REJECT/DEFER). On `--loop`, fixes are written to a `review-fixes-<timestamp>`
plan under `.claude/plans/` and handed to `/refine` → `/goal`.
