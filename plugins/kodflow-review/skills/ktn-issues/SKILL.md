---
name: ktn-issues
description: 'Clear a linter''s whole open-issue queue (default kodflow/ktn-linter): judge every issue lazy or legitimate against earlier lazy verdicts, close the lazy ones with a rewrite that lints clean, fix the rest red-test-first and narrow, one commit per issue, one PR, then a review round that tries to break every new exemption.'
when_to_use: Use when the issue queue of ktn-linter, or of another linter run the same way, must
  be cleared as a batch — "triage and fix all open issues", "go through the false positives".
  Not for one known defect (`kodflow-workflow:fix`, then `/debug`), nor for running the linter
  on a project (`/lint`).
argument-hint: '[<owner>/<repo>] [--triage-only] [--issue <N>[,<N>...]] [--resume]'
model: inherit
effort: medium
allowed-tools:
- Read(**/*)
- Glob(**/*)
- Grep(**/*)
- Write(**/*)
- Edit(**/*)
- Bash(*)
- Agent(*)
- SendMessage
- Skill(*)
- TaskCreate(*)
- TaskUpdate(*)
- TaskList(*)
- mcp__github__*
- mcp__kodflow-hooks__*
---

# /ktn-issues — every open issue judged, the lazy ones closed, the rest fixed

$ARGUMENTS

A linter's issue queue holds two kinds of report that look alike. A
**legitimate** one says the rule is wrong: the code it flags is fine, or the
rewrite it asks for is worse or impossible. A **lazy** one says the rule is
inconvenient: the reporting project would rather be exempted than change code
the rule is right about. Exempting a lazy report is not kindness — it silences
every real finding of the same shape, in every project, from then on.

So the order is fixed: precedent first, verdict second, code last. And the code
that does get written is held to one rule above all others:

> **Narrow, never widen.** An exemption that silences genuinely wrong code is
> as serious as the false positive it fixed. Measured on a real run: two
> independent reviews found **23 too-wide exemptions in 46 fixes**. Budget that
> review round from the start; it is not optional polish.

---

## Arguments

| Pattern | Action |
|---------|--------|
| *(none)* | Target `kodflow/ktn-linter`, full run: phases 0 → 8 |
| `<owner>/<repo>` | Same run on another linter repository |
| `--triage-only` | Phases 0 → 4: verdicts and lazy closures, no fix |
| `--issue <N>[,<N>...]` | Restrict to these issues — still checked against **all** precedents |
| `--resume` | Reload the ledger (below) and continue at the first issue without a final state |
| `--help` | Print the help block and stop |

## --help

```
════════════════════════════════════════════════════════════════
  /ktn-issues — judge every open issue, close the lazy, fix the rest
════════════════════════════════════════════════════════════════

Usage: /ktn-issues [<owner>/<repo>] [--triage-only] [--issue N,...] [--resume]

  Read     ALL open issues, no sampling · every closed `lazy` verdict
  Lazy     close not_planned + label `lazy` + a rewrite that lints clean
  Fix      red test first · narrow · negative control both directions
  Ship     one commit per issue (Fixes #N) · one PR · never merges
  Review   /code-review max · /review · exemption breaker · corpus diff

  Ledger   ${XDG_STATE_HOME:-~/.local/state}/ktn-issues/<owner>-<repo>/
════════════════════════════════════════════════════════════════
```

**If `$ARGUMENTS` contains `--help`:** print it and STOP.

---

## Phase map

| Phase | What | Module |
|-------|------|--------|
| 0 | Preflight: target, commands, heavy-work wrapper, agent cap, baseline | this file |
| 1 | Inventory: every open issue, counted against the forge's own total | this file |
| 2 | Precedents: every closed `lazy` verdict and its closing comment | `triage.md` |
| 3 | Verdict per issue, with an independent challenge of each lazy one | `triage.md` |
| 4 | Close the lazy ones | `lazy.md` |
| 5 | Fix the legitimate ones and every non-rule issue, heavy ones done properly | `fix.md` |
| 6 | One commit per issue on one batch branch | `commits.md` |
| 7 | Strict review round, fixups folded into each issue's own commit | `gate.md` |
| 8 | Push once, open one PR, report | this file |

Phases run in order. A phase does not start while the previous one has an
issue without a recorded outcome.

---

## The ledger

One line per issue in `$STATE/ledger.tsv`, where
`STATE=${XDG_STATE_HOME:-$HOME/.local/state}/ktn-issues/<owner>-<repo>` — never
under a temporary directory a session may wipe, never in the repository.

```
number  kind  verdict  precedent  state  commit  note
```

- `kind`: `rule` (a report against a rule's verdict) or `other` (bug, feature,
  refactor, performance, docs).
- `verdict`: `lazy` | `legitimate` | `n/a` (for `other`) | `obsolete` (already
  fixed on the default branch — proved by re-running the reproduction).
- `state`: `open` → `judged` → `closed-lazy` | `red` → `fixed` → `reviewed` → `shipped`.

The run is finished only when **every issue number from phase 1 has a final
state**. A number with no line is a skipped issue, and skipping is the one thing
this skill exists to prevent. `--resume` reads the ledger and starts at the
first non-final line.

---

## Phase 0 — Preflight

| # | Check | Refuse when |
|---|-------|-------------|
| 1 | `gh auth status` and read access to the target | not authenticated |
| 2 | A clean checkout of the target's default branch, fetched; work happens in a **worktree** of its own (`<repo parent>/.worktrees/<repo>-issues-<date>`), never on the default branch | the main checkout is dirty and no worktree can be made |
| 3 | The project's commands, read from its `CLAUDE.md` / `Makefile`: build, full test, fixture validation, self-lint, single-file lint, corpus run if any. For ktn-linter: `make build`, `make test`, `make validate`, `make lint`, `./builds/ktn-linter run <file>` | no build or no test command can be found |
| 4 | **Heavy-work wrapper.** On a shared, memory-capped host every build, test, lint and corpus run goes through the host's wrapper. Never hard-code one: take it from the user's or the project's `CLAUDE.md` (a section on heavy work or memory caps naming a command), confirm it with `command -v`, and prefix every heavy command with it — in your own calls and in every agent brief. None named: run heavy jobs one at a time when `MemAvailable` is under 16 GiB | — |
| 5 | **Agent cap.** The host's limit on live and compiling agents, from `CLAUDE.md`; none stated: 3 alive, 2 compiling | — |
| 6 | **Baseline red.** Run the full test suite once on the base commit, write the names of the tests already failing to `$STATE/baseline-red.txt`. Every agent brief quotes that list **by test name**; any other red test is that agent's to explain | the build itself is red on the base |
| 7 | **Scratch.** `$STATE/scratch/` with one subdirectory per issue (`$STATE/scratch/<N>/`). Each agent writes only in its own; two agents sharing a scratch file overwrite each other's reproductions silently | — |
| 8 | The `lazy` label exists on the target (`gh label list`); create it if missing | no right to create labels |

## Phase 1 — Inventory

```bash
gh issue list -R <owner>/<repo> --state open --limit 1000 \
  --json number,title,body,labels,author,createdAt,url > "$STATE/open.json"
```

Then **prove the inventory is complete**: compare `jq length` with the forge's
count of open issues (`gh api repos/<owner>/<repo>` → `open_issues_count`
minus open pull requests, or `gh issue list --state open --limit 1000 | wc -l`
on a second call). A mismatch is a stop, not a rounding error. Write one ledger
line per number, state `open`. Read **every body in full**, comments included
(`gh issue view <N> --comments`): the reproduction is often in a comment.

`--issue` restricts phases 3–8 to the listed numbers; phase 2 still reads every
precedent.

## Phases 2 to 7

Follow the modules in order: `triage.md` (precedents and verdicts), `lazy.md`
(closing the lazy), `fix.md` (red test, narrow fix, controls, heavy issues),
`commits.md` (one commit per issue, fixup and autosquash, per-commit build),
`gate.md` (the review round). `--triage-only` stops after `lazy.md` and prints
the ledger.

## Phase 8 — Push, PR, report

1. The branch passed `gate.md` (every check green, autosquash done, the
   per-commit build green). The review round runs on the **local** branch,
   before the first push, so history is rewritten only where nobody else has it.
2. Push the batch branch and open **one** PR (through the forge MCP,
   else `gh pr create`). Body: a table of every issue of the run —
   number, verdict, commit or closure link — plus every `Fixes #N`, the
   review round's counts (exemptions challenged, too wide, narrowed) and the
   corpus diff per rule.
3. **Never merge.** Watch CI to its end; a red check is fixed by a new commit
   on the branch, never by a force-push over a reviewed history unless the
   project allows it.
4. Report: issues read, lazy closed (with precedent), fixed, obsolete, PR
   number, CI state, and every issue left without a final state — which should
   be none.

---

## Agents

Parallel work is welcome, within the agent cap, one issue per agent:

- **Route by capability, not by title.** A specialist agent with a narrow
  command scope (the developer specialists are read-only) cannot create a
  worktree, commit or call `gh`. Use specialists to judge or review; give
  fix-and-commit work to a general-purpose agent that can do all three, with
  `model: "sonnet"` and `effort: "high"` on the call (a defect in existing code,
  the tier table, model-policy §2).
- Each brief carries: the issue number and full text, its scratch directory
  `$STATE/scratch/<N>/`, its own worktree and branch, the heavy-work wrapper,
  the baseline-red test names, and `fix.md`'s contract (red first, narrow,
  both control directions). Not your verdict when you want a challenge — an
  agent handed a hypothesis tends to return it confirmed.
- An agent returns: its commit sha, the red output it saw, both control
  directions, and the full-rule lint of its fixtures. A claim without that
  evidence is re-run, not accepted.

---

## Guardrails

| Action | Status |
|--------|--------|
| Sampling issues, or stopping before every ledger line is final | FORBIDDEN |
| Closing as lazy without searching the precedents first | FORBIDDEN |
| A lazy closure whose rewrite was not linted with **all** rules | FORBIDDEN |
| A fix written before its failing test was seen red | FORBIDDEN |
| An exemption without a negative control checked in both directions | FORBIDDEN |
| Copying the issue's proposed fix without judging its width | FORBIDDEN |
| A minimal patch where the issue asks for a move, split, dedup or optimisation | FORBIDDEN |
| Several issues in one commit, or one issue across several | FORBIDDEN |
| Skipping the review round, or reviewing only after the push | FORBIDDEN |
| Path-based exclusions (`testdata`, file names) to make a finding disappear | FORBIDDEN |
| A heavy command outside the host's wrapper when one is named | FORBIDDEN |
| Merging the PR, pushing to the default branch, `--no-verify` | FORBIDDEN |
