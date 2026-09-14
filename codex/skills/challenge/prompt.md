# /challenge — Phases 3-4: composing and certifying the directive

The debate produced a plan someone argued with. This turns it into something
`/goal` can execute without re-deriving anything — and proves it did, with a
program rather than a claim.

## Phase 3 — compose

Write to `.claude/goals/<slug>.md`. Eight sections, exactly these names, in this
order. The validator matches on `^## NAME`.

```markdown
## CONTEXT
<Why this work exists and the state of the world it starts from. Enough that
someone with no memory of the debate can act. 3-6 lines.>

## OBJECTIVE
<One sentence. The end state, not the activity.>

## SCOPE
In:  <files, packages, surfaces this may touch>
Out: <what it must not touch — the boundary the debate settled>

## TASKS
- [ ] <first change, stated as a change to a named thing>
- [ ] <second>
- [ ] <...>

## CONSTRAINTS
<Rules that bind the work: constraint-ledger MUSTs it touches, decisions taken
during the debate, and anything the user answered. One line each.>
Models: orchestrator <CLAUDE_TOP> @high · code workers Opus @high · review
workers Opus @xhigh · mechanical Sonnet @low · workers never inherit · worktree
isolation where workers write concurrently.

## ACCEPTANCE
1. <binary, checkable statement>
2. <binary, checkable statement>

## VERIFY
1. `<command>` <expected result>
2. `<command>` <expected result>

## STOP
<The condition under which this is finished. Never empty.>
```

### The rules that make it executable

**TASKS is the point.** Every task starts unticked. It exists so a half-finished
run is visibly half-finished — the failure this whole skill is built against is
a plan that reports success at 60%. Each task names what it changes; "handle
errors" is not a task, "wrap every returned error in `internal/store/` with
`%w`" is.

**ACCEPTANCE pairs 1:1 with VERIFY.** Criterion 3 is proved by verifier 3. A
criterion with no verifier is a wish, and the validator rejects the file.

**Verifiers must be runnable.** A shell command in backticks, or a `file:line`
someone can open. "Tests pass" is not a verifier; `go test ./internal/store/...`
exits 0 is.

**No vague verbs in ACCEPTANCE.** *improve, optimise, refactor, clean up, handle,
support, as needed* — each is a way to reach the goal state without anything
being true. The validator greps for them and fails the file when they appear
inside ACCEPTANCE.

**The model allocation line is mandatory.** Resolve it with
`~/.codex/skills/_shared/scripts/detect-models.sh` and write the resolved id,
not the placeholder. `../_shared/model-policy.md` owns the rule; the validator
rejects a directive whose CONSTRAINTS carry no `Models:` line, because a plan
that does not say who runs what will silently run everything on the orchestrator.

**No placeholders.** `<name>`, `TBD`, `TODO`, `...` — the directive is the
handover; an unresolved placeholder means the debate did not finish.

### The budget

4000 characters, hard. It is a `/goal` tool limit: a longer directive is
rejected outright, so an over-long one is not a slightly worse prompt, it is no
prompt.

Aim for the **shortest text that carries the contract**, never for 4000. When it
does not fit, in this order:

1. Cut CONTEXT to what the executor cannot infer from the repository.
2. Merge tasks that are one change split in two.
3. Cite a file path instead of quoting its content.
4. Move detail to the plan file and reference it: `see .claude/plans/<slug>.md`.
5. **Only then** consider whether the work is really two goals. Splitting is a
   legitimate outcome — say so rather than compressing until the contract breaks.

Never drop TASKS, ACCEPTANCE or VERIFY entries to fit. Losing a criterion to
save characters defeats the entire exercise.

## Phase 4 — certify

Run the validator. It is a program, not a review:

```bash
bash ~/.codex/skills/challenge/scripts/validate-goal-prompt.sh .claude/goals/<slug>.md
```

It checks: character count within 400-4000 · all eight sections present · at
least 2 task checkboxes, none pre-ticked · at least one runnable verifier · no
vague verb inside ACCEPTANCE · no placeholders · STOP non-empty.

Exit `0` valid · `1` invalid, with a `FAIL` line per problem · `2` usage.

### The repair loop

On exit 1: fix exactly what the FAIL lines name, re-run, repeat. **Maximum 3
repair passes.** Still failing after three means the debate did not produce
enough to write a directive from — report the remaining FAIL lines and send it
back to `/plan`. Do not weaken the directive to satisfy the validator: deleting
a verifier to pass the verifier check is the worst possible outcome.

Show the user the final validator output verbatim. It is the evidence, and a
summary of it is not.

```
$ validate-goal-prompt.sh .claude/goals/oauth-device-flow.md
  ok   length 2140 chars (2214 bytes), within 4000
  ok   section CONTEXT
  ...
  ok   task list: 6 checkbox items
  ok   VERIFY: 4 runnable check(s)
  ok   no placeholders
  ok   STOP is non-empty

VALID — 2140/4000 chars, 6 tasks, 4 verifiers
```

Under `--dry-run`, validate a temporary file and delete it; write nothing to
`.claude/goals/`.

## Guardrails

| Action | Status |
|--------|--------|
| Hand over a directive the validator did not pass | **FORBIDDEN** |
| Summarise the validator output instead of showing it | **FORBIDDEN** |
| Delete a verifier or criterion to make the validator pass | **FORBIDDEN** |
| More than 3 repair passes | **FORBIDDEN** — send it back to `/plan` |
| Pre-tick a task | **FORBIDDEN** |
| Write an acceptance criterion with no paired verifier | **FORBIDDEN** |
| Pad toward 4000 characters | **FORBIDDEN** |
| Write to `.claude/goals/` under `--dry-run` | **FORBIDDEN** |
