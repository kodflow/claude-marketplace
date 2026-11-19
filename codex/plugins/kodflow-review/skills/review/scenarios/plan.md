<!-- scenario-contract v1
name: plan
selects_when: arg is a plan slug OR a path under .claude/plans/
lenses: [completeness, testability, sequencing, reviewability, self-consistency, keystone-propagation, fidelity-vision, enforcement-completeness]
writes: .claude/plans/<slug>.md
engine: workflow
-->

# /review scenario — `plan`

Reviews a **plan/contract before `/goal`**, applying the durable authoring lenses
(skills-cleanup C7 / D9). Selected when the argument is a plan slug or a path under
the plans directory.

## Lenses (fan-out, each adversarially verified)

| Lens | Question |
|---|---|
| **completeness** | Missing deps / files / acceptance criteria? |
| **testability** | Each acceptance line a real command — **and does it run**? Executable-acceptance: the reviewer RUNS the `[current-state]` greps AND every cited build/test/lint/vet command **verbatim, in the cwd the plan specifies** (`cd tools/x && go build .` ≠ `go build ./tools/x/`), toolchain permitting (#397). A cited command that errors, or "succeeds" matching **0 targets** (silent-green), makes the acceptance criterion WRONG-AS-WRITTEN → a finding. `[final-state]` lines are validated, not gated. |
| **sequencing** | PR/commit order causal? hidden coupling? rollback sound? |
| **reviewability** | Each unit ≤ ~15 files / 1 concept (blast-radius)? |
| **self-consistency** | Slogans ("never", "always") match the actual actions? |
| **keystone-propagation** | Every verified fact carries its consequence? |
| **fidelity-vision** | Does the plan deliver the stated user vision? |
| **enforcement-completeness** | If the plan proposes a NEW security control (signature/CRL/OCSP verify, auth, input validation), red-team the control ITSELF from a blank threat-model (authenticity / freshness / input-robustness / fail-open-vs-closed — see dimensions.md §Security), independent of what the plan CLAIMS. A half-enforced control (e.g. CRL parsed but signature never checked) is a HIGH finding even if every stated claim is individually true (#397). |

## Write contract (single-writer + backup, GI7)

The `plan` scenario edits `.claude/plans/<slug>.md` **IN PLACE** (single-writer = `/review`).
Before any write:

```bash
mkdir -p .claude/plans/.history/<slug>/
cp .claude/plans/<slug>.md .claude/plans/.history/<slug>/$(date -u +%Y%m%dT%H%M%SZ).md
# … apply corrections …
# emit a diff-like summary of what changed and why
```

All writes stay under `.claude/plans/` (authorized dir — no path traversal).
