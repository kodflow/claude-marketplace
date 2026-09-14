<!-- scenario-contract v1
name: architecture
selects_when: --architecture flag, an ADR path, or a diff with cross-module/structural impact
lenses: [layering, coupling-cohesion, pattern-fit, adr-consistency]
writes: .claude/plans/review-fixes-<timestamp>.md
engine: workflow
-->

# /review scenario — `architecture`

Conception / ADR review. Selected by `--architecture`, an ADR path, or a diff with
cross-module structural impact.

## Lenses

| Lens | Focus |
|---|---|
| layering | dependency direction, layer violations |
| coupling-cohesion | module boundaries, hidden coupling |
| pattern-fit | pattern misuse / over-engineering (consult ~/.claude/docs/) |
| adr-consistency | change matches the recorded architecture decisions |

Findings are written to a `review-fixes-<timestamp>` plan under `.claude/plans/`
for `/goal` execution. No disk writes outside that authorized dir.
