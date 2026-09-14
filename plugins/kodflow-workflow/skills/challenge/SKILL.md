---
name: challenge
description: 'Put a plan through an adversarial debate before anyone builds it. The panel
  is never generic: three contradictory lenses — architecture, scepticism, operations — plus
  every installed specialist whose technology the plan actually touches, and Codex from outside
  the Claude family when its CLI answers. Specialists must cite the documentation they checked;
  an objection resting on an unverified version claim is marked, not taken as fact. At most
  three rounds, the plan rewritten between them rather than defended, and every difficulty
  put to you immediately as a three-option question with a recommendation. Output: a /goal
  directive of at most 4000 characters with an unticked task list and a runnable verifier
  per acceptance criterion, mechanically validated.'
when_to_use: Use once a plan exists and before it is executed — after /plan, /feature or /fix,
  when the approach is still arguable, or when a previous attempt went wrong and the plan
  is suspect. Not for a task whose steps are already obvious.
argument-hint: <plan slug|file|description> [--concurrency N] [--no-codex] [--dry-run]
model: opus
allowed-tools:
- Read(**/*)
- Glob(**/*)
- Grep(**/*)
- Bash(git:*)
- Bash(bash:*)
- Bash(python3:*)
- Bash(command:*)
- Bash(wc:*)
- Bash(jq:*)
- Bash(date:*)
- Bash(mkdir:*)
- Write(.claude/plans/*.md)
- Write(.claude/goals/*.md)
- Edit(.claude/plans/*.md)
- Edit(.claude/goals/*.md)
- Agent(*)
- Workflow(*)
- AskUserQuestion
- mcp__context7__*
- WebFetch(*)
- Bash(bash "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}"/skills/_shared/scripts/detect-models.sh:*)
- Bash(codex exec:*)
- Bash(codex doctor:*)
---

# /challenge — debate the plan, lock the directive

$ARGUMENTS

A plan that has never been argued with is a first draft. This skill spends a
bounded number of rounds trying to break one, rewrites it between rounds, and
ends with a directive `/goal` can execute without re-deriving anything.

Three things make it worth running instead of just thinking harder:

- **The reviewers are independent.** They run as separate agents with their own
  context. A reviewer that shares your context agrees with you.
- **The lenses contradict.** An architect and an operator want different things
  from the same plan; where they disagree is where the plan is actually weak.
- **The specialists are mandatory, not optional.** Every installed specialist
  whose technology the plan touches joins the panel, and each must cite the
  documentation it checked before asserting how that technology behaves. A
  generalist cannot tell you that the API you planned against moved two releases
  ago; the specialist that just read the release notes can.
- **Difficulty becomes a question, not an assumption.** The moment the debate
  cannot settle something, you are asked — immediately, not in a summary at the
  end.

---

## Arguments

| Pattern | Action |
|---------|--------|
| `<slug>` | Debate `.claude/plans/<slug>.md` |
| `<path>` | Debate that file |
| `"<description>"` | Debate a plan given inline (structured first) |
| *(none)* | Debate the most recent `.claude/plans/*.md` |
| `--concurrency N` | Cap the debate at `N` rounds (default 3, max 6) |
| `--no-codex` | Claude panel only, even if the Codex CLI is installed |
| `--dry-run` | Debate and show the directive; write nothing |
| `--help` | Print the help block and stop |

`--concurrency` is the round cap: how many times the plan may be argued and
rewritten. Three is the default because rounds four and beyond, measured across
this kind of loop, mostly re-litigate settled points.

## --help

```
════════════════════════════════════════════════════════════════
  /challenge — debate the plan, lock the directive
════════════════════════════════════════════════════════════════

Usage: /challenge [plan] [options]

  --concurrency N   round cap (default 3, max 6)
  --no-codex        Claude panel only
  --dry-run         show the directive, write nothing
  --help            this help

Rounds stop early when a round produces no accepted objection.

Output: .claude/goals/<slug>.md — <= 4000 chars, validated by
        challenge/scripts/validate-goal-prompt.sh before you see it.
        Sections: CONTEXT OBJECTIVE SCOPE TASKS CONSTRAINTS
                  ACCEPTANCE VERIFY STOP

Chain:  /plan → /challenge → /goal → /git
════════════════════════════════════════════════════════════════
```

**If `$ARGUMENTS` contains `--help`:** print it and STOP.

---

## Phase map

| Phase | What | Module |
|-------|------|--------|
| 0 | Load the plan; refuse to debate nothing | this file |
| 1 | Detect the panel — which reviewers are actually available | `debate.md` |
| 2 | Rounds: argue → triage → ask → rewrite | `debate.md` |
| 3 | Compose the `/goal` directive | `prompt.md` |
| 4 | Validate mechanically, repair, re-validate | `prompt.md` |
| 5 | Hand over | this file |

---

## Phase 0 — load the plan

Resolve the argument to a plan. Read the project's constraint ledger too
(`CLAUDE.md` and `.claude/constraints.md`) — a plan that violates a recorded
`MUST` is wrong before any reviewer opens it, and that check costs nothing.

**If there is no plan**, do not invent one to have something to debate. Say so
and point at `/plan`. A description given inline is acceptable: structure it into
a plan first, show it, and debate that.

Read `../_shared/tracker.md` §1 only if the plan came from a `/feature` or `/fix`
subject — the debate outcome is worth a comment on that issue.

## Phase 5 — hand over

Print, in this order:

1. **What changed** — the material differences between the plan that went in and
   the plan that came out, one line each. If nothing changed, say that plainly:
   a plan that survived three rounds untouched is a real result.
2. **What you decided** — each question asked and the option taken.
3. **What is still open** — objections accepted but deliberately not addressed,
   and why. Never silently drop one.
4. **The directive**, and its validator output.

```
/challenge → /goal   paste the directive
           → /git    land it
```

When the plan came from a tracked subject, offer to post the summary as a
comment on its issue. That is where the reasoning belongs for anyone who was not
in the room.

---

## Guardrails

| Action | Status |
|--------|--------|
| Emit a directive the validator rejected | **FORBIDDEN** — repair and re-validate |
| Emit a directive over 4000 characters | **FORBIDDEN** — a hard `/goal` limit |
| Emit a directive with no unticked task list | **FORBIDDEN** |
| Emit an acceptance criterion with no runnable verifier | **FORBIDDEN** |
| Run more rounds than `--concurrency` allows | **FORBIDDEN** |
| Defend the plan instead of rewriting it | **FORBIDDEN** — reviewers argue, the plan changes |
| Resolve a difficulty by picking for the user | **FORBIDDEN** — ask, with 3 options + open |
| Ask a question without marking one option recommended | **FORBIDDEN** |
| Drop an accepted objection without recording it | **FORBIDDEN** |
| Claim Codex participated when its CLI is absent | **FORBIDDEN** — say who actually reviewed |
| Run the panel without the specialists the plan's technology matched | **FORBIDDEN** — every match is dispatched |
| Accept a technology objection whose `consulted` list is empty | **FORBIDDEN** — that is a memory claim, not evidence |
| Leave a matched-but-uninstalled specialist unreported | **FORBIDDEN** — the plan went unreviewed from that angle |
| Start implementing the plan | **FORBIDDEN** — this skill produces a directive |
| Pad the directive toward 4000 characters | **FORBIDDEN** — shortest that carries the contract |

---

## Related

- `../plan/SKILL.md` — produces what this debates
- `../refine/SKILL.md` — the other route to a `/goal` contract, without a debate
- `../feature/SKILL.md`, `../fix/SKILL.md` — where a debated plan's subject lives
