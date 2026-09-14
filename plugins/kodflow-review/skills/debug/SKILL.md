---
name: debug
description: 'Systematic, root-cause-first debugging. Enforces a no-fix-without-root-cause
  contract: reproduce, isolate, prove the cause, then fix and verify. Stops and questions
  the architecture after repeated failed fixes instead of thrashing.'
when_to_use: Use for a bug whose cause is not obvious — a flaky test, an intermittent failure,
  a wrong result with no exception. Not for a compile error or a stack trace that already
  names the line.
argument-hint: <symptom> [--loop]
model: opus
allowed-tools:
- Read(**/*)
- Glob(**/*)
- Grep(**/*)
- Bash(*)
- Edit(**/*)
- Agent(*)
---

# /debug - Systematic Root-Cause Debugging

$ARGUMENTS

Port of the `systematic-debugging` discipline (obra/superpowers, MIT) adapted to
this template. The single rule that makes debugging fast is counter-intuitive:
**slow down**. A guessed fix that "seems to work" hides the real defect and
costs more later. This skill forces evidence before edits.

## Parse Arguments

- **No args**: debug the most recent failure in context (failing test, stack
  trace, error the user just pasted).
- **Free text**: the symptom description (e.g. `/debug intermittent 500 on POST /orders`).
- **`--fix`**: allowed to apply the fix once the root cause is proven (default:
  propose the fix, let the user approve).
- **`--no-checkpoint`**: skip the architecture checkpoint (not recommended).

## The Contract (non-negotiable)

1. **NO FIX WITHOUT A PROVEN ROOT CAUSE.** A change that makes the symptom
   disappear is not a fix until you can explain the causal chain from cause to
   symptom and why the change breaks that chain.
2. **One variable at a time.** Never change two things between observations.
3. **Reproduce first.** If you cannot reproduce it, the first task is a
   reproduction, not a fix.
4. **The cited evidence wins over intuition.** "It's probably X" is a hypothesis
   to test, not a conclusion.

## Workflow

### Phase 1 — Reproduce

- Establish the smallest reliable reproduction (a failing test, a curl, a script).
- Record the exact observed behaviour vs the expected behaviour.
- If non-deterministic: capture the conditions (timing, concurrency, data, env)
  that change the outcome. Note the failure rate.
- **Gate:** you have a command/test that fails on demand (or a documented
  flaky-rate). If not, stay here.

### Phase 2 — Isolate

- Bisect the surface: narrow by file/function/input/commit (`git bisect`,
  binary-search logs, disable half the inputs) until the fault localizes.
- Build the call/data path to the failure point (use the blast-radius idea from
  `/review`: who calls this, what feeds this input).
- Form ONE hypothesis with a concrete, falsifiable prediction
  ("if the cause is X, then changing Y will flip the outcome").

### Phase 3 — Prove the cause

- Run the experiment that confirms or refutes the hypothesis. Add an assertion,
  a log line, a breakpoint, or a unit test that observes the cause directly.
- State the causal chain explicitly: `root cause -> mechanism -> symptom`.
- **Gate:** you can produce the cause→symptom chain with cited file:line
  evidence. A grep returning nothing is not proof. If unproven, return to Phase 2.

### Phase 4 — Fix & verify

- Apply the minimal change that breaks the causal chain (with `--fix`, or propose
  the diff for approval).
- Verify: the Phase-1 reproduction now passes AND nothing adjacent regressed
  (run the surrounding tests / `make test`).
- Add a regression test that fails without the fix and passes with it.
- Confirm no other call site relied on the buggy behaviour (blast radius).

## Architecture Checkpoint (after 3 failed fix attempts)

If three hypotheses have been refuted or three fixes failed to hold, **STOP
editing**. Thrashing means the mental model is wrong. Step back and ask:
- Is the bug a symptom of a wrong abstraction / missing invariant, not a local
  defect?
- Are two components disagreeing on a contract (types, ownership, ordering)?
- Is the reproduction actually exercising the real failure, or a different one?
- Should this be escalated to `/plan` for a design fix rather than patched?

Write the checkpoint findings down (offer to record an ADR via `/adr` when the
conclusion is a design decision) before resuming.

## Red Flags (stop and reconsider if you catch yourself doing these)

| Red flag | Why it's wrong | Do instead |
|----------|----------------|------------|
| "Let me just try changing X" | Guessing, not diagnosing | Form a falsifiable hypothesis first |
| Adding `try/catch` to silence the error | Hides the cause | Find why it throws |
| `sleep`/retry to fix a race | Masks the real ordering bug | Map the shared state + synchronization |
| Changing 3 things then re-running | Can't attribute the result | One variable at a time |
| "It works now" with no explanation | Coincidence, not a fix | Prove the causal chain |
| Reverting random commits until green | Bisect-by-vibes | `git bisect` with the reproduction |

## Output

- The proven `root cause -> mechanism -> symptom` chain with cited evidence.
- The minimal fix (applied with `--fix`, else proposed as a diff).
- The regression test added.
- Verification result (reproduction passes, adjacent tests green).
- If an architecture checkpoint fired: the design finding + suggested `/plan` or `/adr`.

## Notes

- Pure-prose discipline — no external dependency. Composes with `/plan` (design
  fix), `/adr` (record a design decision), and `/review` (blast-radius of the fix).
- For large codebases, dispatch read-only `Explore`/`general-purpose` agents to
  gather the call path in parallel, then reason over the synthesis here.
