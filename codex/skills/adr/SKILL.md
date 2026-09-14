---
name: adr
description: Capture Architecture Decision Records. Detects decision moments, writes docs/adr/NNNN-title.md
  from a MADR-style template, maintains the index, and links the decision back to the code/PR.
  The template captures patterns and contracts but never the *why* — this fills that gap.
  Use when the moment a decision is made that a future maintainer would ask 'why' about —
  a technology chosen over an alternative, a boundary drawn, a constraint accepted. Also when
  reviewing a change whose rationale is not in the code.
metadata:
  short-description: Capture Architecture Decision Records
  generated-from: plugins/*/skills/adr
  argument-hint: '[--new "<title>"] [--list] [--link <id>]'
---

# /adr - Architecture Decision Records

the arguments

An ADR records a single significant decision: the context, the options weighed,
the choice, and the consequences. Code shows *what*; an ADR preserves *why* — so
six months later nobody re-litigates a settled trade-off or silently violates it.

## Parse Arguments

- **No args**: scan the current session/diff for an undocumented decision moment
  ("we went with X instead of Y", a new dependency, a layering choice, a protocol
  pick) and propose an ADR for it.
- **Free text**: the decision title/topic (e.g. `/adr use registry cache for buildkit`).
- **`--list`**: list existing ADRs with status.
- **`--supersede <NNNN>`**: create a new ADR that supersedes ADR NNNN (marks the
  old one `Superseded by NNNN`).
- **`--status <proposed|accepted|rejected|deprecated|superseded>`**: set status
  (default `accepted` when recording a decision already made).

## Location & numbering

- ADRs live in `docs/adr/` as **NNNN-kebab-title.md** (zero-padded 4-digit, e.g.
  `docs/adr/0007-buildkit-registry-cache.md` (example)).
- Next number = highest existing + 1 (start at `0001`). Resolve with:
  ```bash
  ls docs/adr/[0-9]*.md 2>/dev/null | sed -E 's@.*/([0-9]+)-.*@\1@' | sort -n | tail -1
  ```
- `docs/adr/README.md` is the index (table of number, title, status, date).
  Create it if absent.

## Template (MADR-derived)

```markdown
# NNNN. <Title — the decision, not the problem>

- Status: <proposed | accepted | rejected | deprecated | superseded by NNNN>
- Date: <YYYY-MM-DD>
- Deciders: <who>
- Related: <PR/issue links, related ADRs>

## Context

What forces are at play — technical, business, constraints. The problem being
solved and why it matters now. Cite the code/area affected.

## Decision

The choice, stated in active voice: "We will …". Be specific and falsifiable.

## Options considered

1. **<Chosen>** — why it wins.
2. **<Alternative>** — why rejected (the trade-off, not a strawman).
3. **<Alternative>** — why rejected.

## Consequences

- Positive: what gets better / unlocked.
- Negative / cost: what we accept (debt, lock-in, perf, complexity).
- Follow-ups: migrations, fitness functions, things to revisit.
```

## Workflow

1. **Resolve the decision.** From args or by scanning the session/diff. If
   nothing rises to the bar of "significant + not obvious from code", say so and
   stop — do not manufacture ADRs for trivia.
2. **Pick the number**, create `docs/adr/NNNN-<slug>.md` from the template,
   fill every section. Convert relative dates to absolute (today).
3. **Update `docs/adr/README.md`** index (create if missing).
4. **Cross-link**: reference the ADR number in the relevant PR/commit body where
   appropriate (the decision's provenance).
5. **Supersede** (`--supersede`): set the old ADR's status to
   `superseded by NNNN` and add a `Superseded by` link; the new ADR links back.

## Integration

- **`/plan`**: when a plan settles a non-obvious architectural trade-off, it
  emits a `Suggested next step: /adr <decision>` so the *why* is captured before
  implementation, not lost.
- **`/git`**: before opening a PR that changes architecture (new dependency,
  layering, public contract, protocol), `/git` checks for a matching ADR and
  suggests `/adr` if none exists. ADRs are committed with the change.
- **`/debug`**: an architecture-checkpoint conclusion ("the bug was a wrong
  abstraction") is a decision worth an ADR.

## Bar for "significant" (when to write one)

Write an ADR when the decision: introduces/removes a dependency or service;
changes a public API / wire format / schema; picks an architectural pattern
(hexagonal, CQRS, event-sourcing…); sets a cross-cutting convention; accepts a
notable trade-off (perf vs simplicity, build-time vs image-size). Do NOT write
one for routine implementation choices fully evident from the code.

## Notes

- Pure-prose skill, no external dependency. Plain-markdown KB, greppable, diffable.
- Keep each ADR immutable once `accepted` — change a decision by superseding,
  never by rewriting history.
