# Reference

One card per installed skill. `/flow <skill>` prints the matching card and
nothing else. Every `then` and `after` here was checked against the file that
claims it — a skill merely mentioning another in a table is not an edge.

Index, by lane:

| Lane | Skills |
|------|--------|
| open | `/project` `/feature` `/fix` |
| load | `/warmup` |
| research | `/search` |
| design | `/plan` `/challenge` `/refine` |
| verify | `/review` `/debug` `/lint` |
| ship | `/git` `/adr` |
| keep | `/learn` |
| machine | `/audit` `/update` `/ktn` `/infra` |

`/goal` appears in every route and is **not** a skill — see the last card.

---

## /project

`kodflow-workflow` · opus · **Resolve the workspace, record C-NNN constraints**

**Type** `/project [name] | --constraint "<rule>" | --sync | --status | --owner <org>`

| | |
|---|---|
| reads | the whole conversation, re-read at Phase 4 · an existing `## Constraints` section · `gh api user/orgs` |
| writes | `CLAUDE.md` `## Constraints` (append-only `C-NNN`) · `.claude/constraints.md` on overflow · `.gitignore` · the bootstrap tree. **CREATE only** also makes the repo and the first commit on `main`; ADOPT checks out and pulls, CLONE clones — neither commits. |
| after | nothing — this is an entry point |
| then | `/warmup` (automatic, on adopt or clone) · `/adr` (automatic, when a supersede is architectural) |
| gate | Phase 2 is a four-way switch — adopt, clone, create, **conflict**. A conflicting directory is a dead stop: never overwritten, never re-initialised. A dirty or detached tree stops before any checkout. |
| loop | `--sync` re-reads the conversation and honestly reports "no new constraints" |

A rule that lives only in chat dies at the next `/clear`. `C-NNN` carries a
verifier, so `/warmup`, `/plan`, `/refine` and `/review` can all read it back —
and a review cites the ID when a diff breaks one.

---

## /warmup

`kodflow-workflow` · opus · **Pre-load the CLAUDE.md hierarchy and the ledger**

**Type** `/warmup [--update] [--dry-run] [--constraints]`

| | |
|---|---|
| reads | every `CLAUDE.md` root to leaf · the constraint ledger · source, config, tests and docs through four parallel probes in one message |
| writes | nothing by default. `--update` rewrites the `CLAUDE.md` of each directory it touched |
| after | `/project` · `/git` · the `Stop` hook, which names the directories you changed |
| then | `/search` · `/plan` · `/review` · `/goal` |
| gate | two disjoint modes off one argument. The default path reads and stops; only `--update` writes. |

---

## /search

`kodflow-workflow` · opus · **Research a topic into a plan-grade context file**

**Type** `/search "<query>" | --refresh <topic> | --append | --status | --list`

| | |
|---|---|
| reads | `~/.claude/docs/` with `INDEX.json` first · then official documentation on the web |
| writes | `.claude/contexts/<slug>.md` · restamped docs back into `~/.claude/docs/` with a rebuilt `INDEX.json` |
| after | `/warmup` |
| then | `/plan` |
| gate | the freshness gate short-circuits to local only when the question is conceptual, coverage is at least 80%, and every matched doc is fresh. Otherwise it goes to the web. |

`verified:` plus a category TTL decides the weight of a local document: fresh is
citable, stale is a hypothesis to confirm, expired is not evidence. This is the
loop that stops the base rotting.

---

## /plan

`kodflow-workflow` · opus · **Design a validated plan before any code**

**Type** `/plan <description> [--context[=<slug>]] [--goal [--fast]] [--auto]`

| | |
|---|---|
| reads | `.claude/contexts/<slug>.md` · the constraint ledger · the codebase, through four parallel explorers |
| writes | `.claude/plans/<slug>.md` **and** `.claude/contexts/<slug>.md` (Phase 5) — both survive a compaction, so `/goal` can find them on disk |
| after | `/search` |
| then | `/review` (the plan gate) · `/refine` · `/goal` · `/adr` · `/challenge` |
| gate | **ExitPlanMode is terminal.** Every outgoing edge sits behind your approval, and `--auto` skips the four question checkpoints but never this one. `/plan` does not implement. |

`--goal` chains the gate then the contract. `--goal --fast` skips the gate for a
plan too small to argue about.

---

## /challenge

`kodflow-workflow` · opus · **Debate a plan, emit a validated directive**

**Type** `/challenge <slug|file|description> [--concurrency N] [--no-codex] [--dry-run]`

| | |
|---|---|
| reads | `.claude/plans/<slug>.md`, or the most recent plan when you name none |
| writes | `.claude/goals/<slug>.md` · the plan, rewritten in place between rounds |
| after | `/plan` · `/feature` · `/fix` |
| then | `/goal` |
| gate | a script validates the directive before you see it: length, an unticked task list, a runnable check per criterion, no vague verbs. A directive that would let a run claim success at 60% does not ship. |
| loop | at most three rounds. The plan is **rewritten** between them, not defended. |

The panel is never generic: three contradictory lenses — architecture,
scepticism, operations — plus every installed specialist whose technology the
plan actually touches. An objection resting on an unverified version claim is
marked, not accepted.

---

## /refine

`kodflow-workflow` · opus · **Turn a plan or a sentence into a binary contract**

**Type** `/refine <slug> | "<description>" [--bare] [--full <slug>] [--lenses light|full]`

| | |
|---|---|
| reads | FULL: the plan **and** the context. FROM-CONTRACT: an existing contract. BARE: your sentence and nothing else. |
| writes | `.claude/goals/<slug>.md` — except FROM-CONTRACT, which writes no file |
| after | `/plan` · `/search` · `/review` (via the review-fixes plan) |
| then | `/goal` |
| gate | synthesis rejects vague verbs. Acceptance criteria must be binary and paired one-to-one with a verifier, so "fix ça" cannot reach the goal state. |

The three modes are a branch, not three pipelines: only FULL runs the lens
dispatch. The 4000-character ceiling is a hard tool limit, and `/refine` aims for
the shortest contract that survives, never pads to fill it.

---

## /feature

`kodflow-workflow` · opus · **Open feature work as a tracked issue and a branch**

**Type** `/feature <what the feature is> [--no-branch] [--local] [--status]`

| | |
|---|---|
| reads | the tracker detection, then the branch, then the ledger, to find whether this subject already exists |
| writes | `.claude/issues/<slug>.md` (committed, append-only) · a GitLab or GitHub issue, or a note store entry · a branch named after the issue |
| after | nothing — an entry point |
| then | `/search` · `/challenge` · `/goal` · `/git` · every matched specialist |
| loop | run it again on the same subject and it appends a comment. The original understanding is never rewritten. |

---

## /fix

`kodflow-workflow` · opus · **Open a reproducible defect and cut its branch**

**Type** `/fix <what is broken> [--no-branch] [--local] [--status]`

| | |
|---|---|
| reads | the same tracker resolution as `/feature` |
| writes | `.claude/issues/<slug>.md` with `kind: fix` · an issue or note · a branch · a `## Not yet reproduced` section naming exactly what is missing |
| after | nothing — an entry point |
| then | `/debug` · `/challenge` · `/git` · specialists (mandatory when the technology matches) |
| gate | **no reproduction, no bug.** Observed, expected, and the steps that show it. |
| gate | a specialist verdict of "documented behaviour" ends the run having created nothing, and hands you to `/feature`. |

---

## /git

`kodflow-workflow` · opus · **Commit, open the PR/MR, drive CI green, merge**

**Type** `/git --commit | --watch | --merge | --finish [--branch <name>]`

| | |
|---|---|
| reads | the git identity, the diff, the CI status, `docs/adr/` before a PR that changes architecture |
| writes | a conventional commit · a PR or MR · a merge · the git identity when it was unset |
| after | `/feature` · `/fix` · `/challenge` · `/goal` |
| then | `/warmup --update` · `/review` · `/adr` |
| gate | `--watch` **never merges by itself.** All-green only prints the next step. |
| loop | `--merge` falling back to `--watch` is the only automatic edge between the three arms, and it points backwards. |

Review threads are answered on the platform, not in the terminal.

---

## /review

`kodflow-review` · opus lead, per-role producers · **Evidence-bound review**

**Type** `/review [<PR#>|<branch>|<path>] [--loop] [--plan <slug>]`

| | |
|---|---|
| reads | every changed file and every changed hunk · the constraint ledger · the real output of linters, SAST, SCA, secret, IaC and build/test runs |
| writes | `.claude/plans/review-fixes-<ts>.md` · `$SCRATCH/review-manifest-<ts>.json` · edits a plan in place with a backup under `.claude/plans/.history/` |
| after | `/plan` · `/git` |
| then | `/refine` then `/goal` — that is the cycle |
| gate | an **external, non-LLM verifier** recomputes hunks and symbols from git and invalidates the run on a mismatch. That is what makes a fake pass mechanically detectable. |
| gate | no finding ships without `file:line` of real cited code plus a counterexample. Severity and confidence are decoupled: a high-severity low-confidence finding is routed to "Needs Verification", never dropped. |

`--loop` converges on correctness, not on tone. Tool-absent is a distinct
outcome from not-applicable.

---

## /debug

`kodflow-review` · opus · **Prove the root cause before any fix**

**Type** `/debug <symptom> [--loop]`

| | |
|---|---|
| reads | the failing behaviour, reproduced on demand |
| writes | a proven chain `root cause -> mechanism -> symptom` · the minimal change that breaks it · a regression test that fails without the fix |
| after | `/fix` |
| then | `/plan` · `/adr` |
| gate | **no fix without a proven cause.** The proof gate sends the run back to isolation when the chain has no cited evidence, so the fix phase is unreachable until it does. |
| loop | phase 1 self-loops until the bug reproduces on demand |

After repeated failed fixes it stops and questions the architecture rather than
thrashing.

---

## /lint

`kodflow-review` · opus · **Run the project's linters and fix what they find**

**Type** `/lint [path] [--fix] [--strict]`

| | |
|---|---|
| reads | the detected languages, build system and tools |
| writes | edited source, until the linters are quiet |
| after | — |
| then | — |
| gate | `make lint` short-circuits everything: if the Makefile has the target, it runs and the language-specific path is skipped entirely. |

---

## /adr

`kodflow-review` · sonnet · **Record an architecture decision**

**Type** `/adr [--new "<title>"] [--list] [--link <id>] [--supersede <id>]`

| | |
|---|---|
| reads | the existing `docs/adr/` numbering and index |
| writes | `docs/adr/NNNN-kebab-title.md` · `docs/adr/README.md` · the superseded ADR's status · the ADR number in the PR or commit body |
| after | `/plan` · `/git` · `/debug` — all three only **suggest** it |
| then | nothing. A leaf: three arrows in, none out. |
| gate | its first step is a refusal gate — not every change is a decision |

The template captures patterns and contracts but never the why. This fills that
gap, so a future maintainer does not have to re-derive it.

---

## /learn

`kodflow-review` · sonnet · **Save session patterns to the local base**

**Type** `/learn [<description>] | --list | --status`

| | |
|---|---|
| reads | the session log, else the git history, else the live conversation |
| writes | `~/.claude/docs/learned/<name>.md` and the index |
| after | — |
| then | — |
| gate | **nothing is written without your yes.** One mandatory confirmation with three branches: save, edit first, or skip. |

Trivial fixes, one-time incidents and things already in the base are filtered
out before you are ever asked.

---

## /audit

`kodflow-devops` · sonnet · **Health-check this installation**

**Type** `/audit [--fix] [--dimension agents|skills|hooks|mcp|settings|security|knowledge]`

| | |
|---|---|
| reads | every skill, agent, hook, script and MCP server, plus knowledge-base freshness |
| writes | a dashboard in the transcript. `--fix` also repairs the mechanically unambiguous faults: a missing directory, a stale index, a non-executable hook. |
| after | — |
| then | `/search --refresh` — the remediation it prints for expired documents |
| gate | a dimension it could not check is reported as skipped, not as passing |

Seven dimensions, each scored, each naming the specific files at fault.

---

## /update

`kodflow-devops` · sonnet · **Sync the devcontainer from the template**

**Type** `/update [--check] [--component plugins|hooks|lifecycle|docs|...]`

| | |
|---|---|
| reads | the upstream template, as one tarball rather than a file at a time |
| writes | the resolved target — the harness on a host, the workspace in a container |
| after | — |
| then | itself, when validation reports a missing component |
| gate | two axes are auto-detected before anything is written, and the context gates roughly half the apply steps |

---

## /ktn

`kodflow-devops` · opus · **Heal the project-linter MCP stack**

**Type** `/ktn [--check] [--phases <spec>] [--scope <diff|full|show>] [--restart] [--uninstall]`

| | |
|---|---|
| reads | the binary version, the MCP entry, the hook wiring, the daemon on :7717, the phase config |
| writes | the binary, the MCP config, the settings, the daemon state |
| after | — |
| then | itself, on a schedule or when the daemon is stale |
| gate | idempotent: it does nothing when the stack is already healthy, and asks for a restart only when the settings actually changed |

Five agents in **one** message, not a sequence — they are file-disjoint, which
is what makes the single wave safe.

---

## /infra

`kodflow-devops` · opus · **Terraform, OpenTofu and Terragrunt work**

**Type** `/infra --init | --plan | --apply | --validate | --docs [--module <path>]`

| | |
|---|---|
| reads | the module tree, the state, the plan file |
| writes | `tfplan` · the state, on apply · module `README.md` on `--docs` |
| after | `/plan` |
| then | `--plan` hands to `--apply` through `tfplan` |
| gate | **`--apply` refuses without the `tfplan` that `--plan` wrote.** That file is the only bridge between the two arms. |

---

## /flow

`kodflow-workflow` · haiku · **This diagram**

**Type** `/flow [<skill>] [--path|--artifacts|--hooks|--agents|--all] [--ascii] [--check]`

| | |
|---|---|
| reads | `diagrams.md` · `reference.md` · the live inventory script |
| writes | nothing |
| gate | `--check` reports drift and never edits the map to resolve it |

---

## /goal — not a skill

`/goal` appears at the end of every design route and is **not** part of this
marketplace. It is the executor: it takes the directive `/refine` or
`/challenge` wrote and runs it.

| | |
|---|---|
| reads | `.claude/goals/<slug>.md`, and the plan it points at |
| limit | 4000 characters, a hard runtime ceiling — which is why both writers validate length before you see the directive |

If `/flow` is asked for a `/goal` card, say this and do not draw it as a node
the marketplace owns.
