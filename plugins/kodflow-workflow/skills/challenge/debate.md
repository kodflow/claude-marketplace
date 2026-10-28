# /challenge — Phases 1-2: the panel and the rounds

## Phase 1 — who is actually on the panel

The panel is **never three generic reviewers**. It is three lenses *plus every
installed specialist whose domain the plan touches*, and the specialists are the
half that catches the errors a generalist cannot see.

### 1.1 What does the plan touch?

Read the plan and the files it names. Do not guess from the prose alone — open
what it points at.

```bash
ls ~/.claude/agents/*.md | xargs -n1 basename | sed 's/\.md$//'
```

Route on evidence using the shared table in `../_shared/specialists.md` — one
specialist per matched domain. That file is the single source of truth for the
routing, so `/challenge`, `/feature` and `/fix` never disagree about who reviews
what.

**Every match is dispatched.** A plan touching Go and Kubernetes gets both, and
the panel is six reviewers, not three. Skipping a matched specialist because the
panel "feels big enough" is exactly how a plan ships with a defect the installed
specialist would have named on sight.

**No match at all** — a pure prose, process or documentation plan — is the only
case where the panel is the three lenses alone. Say so explicitly; do not let it
pass as normal.

### 1.2 The full panel

Every lens reviewer is a **review worker** under `../_shared/model-policy.md`,
so all three take that role's tier and effort — not a cheaper one because the
lens sounds lighter. An operator lens that misses a rollback hazard costs
exactly what a correctness lens missing a race costs.

| Reviewer | Lens | Model | Availability |
|----------|------|-------|--------------|
| **architect** | Is the shape right? Boundaries, coupling, what this makes hard later. | review-worker tier | always |
| **sceptic** | What is assumed and unproven? Where does this fail? | review-worker tier | always |
| **operator** | What happens at 3am? Rollback, migration, blast radius, observability. | review-worker tier | always |
| **`<specialist>`** | Is this correct *in this technology*? Idiom, footgun, version reality. | its own frontmatter — a specialist's model is part of its definition, and the policy does not override it | one per matched domain |
| **codex** | An outside-the-family read of the same plan. | — | only when the CLI answers and not `--no-codex` |

The three lenses are chosen to *conflict*: the architect wants the boundary, the
operator wants the smallest deployable change, the sceptic wants evidence for
both. Specialists conflict with all three, because a language's actual
constraints do not care what shape anyone wanted.

### 1.3 Every specialist must cite what it checked

`../_shared/specialists.md` defines what a specialist owes back: `consulted`
(the sources actually checked, per claim that needed it: a documentation URL, a
source file read at a named revision as `path@rev`, or a scratch measurement with
its command and result) and `unverified` (what it could not confirm). Put that
requirement in every specialist brief.

In a technology objection, `consulted` cites at least one entry of the
brief's **reference sources** (Phase 2), or an authoritative source outside
that list that substantiates the claim — the vendor's documentation, a raw
manual page, the source read at a revision — with the topic it settles, whether
the list already covers that topic or not. A `path@rev` read and a scratch
measurement stay valid evidence beside it.

**A technology objection with an empty `consulted` list is a memory claim.**
Route it to *needs the user* or send it back for verification — do not accept it
as evidence. That is the whole reason for dispatching a specialist rather than
reasoning about the technology yourself: not that it knows more, but that it
goes and checks.

### 1.4 Codex

Verified working on this machine with CLI 0.153.4 and ChatGPT-token auth. Probe
first — the panel must never claim a reviewer that did not run:

```bash
command -v codex >/dev/null 2>&1 && codex doctor 2>&1 | grep -q "auth is configured"
```

Invoke it as a structured panel member, not as a chat:

```bash
codex exec --skip-git-repo-check --ephemeral -s read-only \
  -m "$CODEX_MODEL" \
  -c model_reasoning_effort="high" \
  --output-schema  "$SCHEMA"   \
  -o               "$OUT"      \
  "Follow the reviewer brief on stdin. Return objections only." \
  < "$SCRATCH/codex-brief-r$ROUND.md"
```

Why each flag earns its place:

| Flag | Why |
|------|-----|
| `--output-schema` | the same objection schema the Claude reviewers return, so triage treats every panel member identically instead of parsing prose; the objections come back as an array, and its order gives their local numbers |
| `-o <file>` | the verdict lands in a file rather than being scraped out of progress output |
| `-s read-only` | a reviewer has no business writing; the sandbox makes that structural rather than a request |
| `--ephemeral` | no session state for a one-shot review |
| `-c model_reasoning_effort=` | effort is a config key on this CLI, not a flag |
| `-m <model>` | set it from `../_shared/model-policy.md`, resolved — never hardcoded |

The **complete reviewer brief** goes in on **stdin**, never `plan.md` alone: the
brief 2.1 builds for every reviewer, opening with `Plan review mode` like a
specialist's, argued from the outside-the-Claude-family lens, with the plan
inline, the constraints, the project records, the reference sources, the
scratch directory and, from round 2, the prior objections and Codex's own
triage-ID table. Write it to `$SCRATCH/codex-brief-r$ROUND.md`, `ROUND` being
the round number, when the round's briefs are built. Fed the plan alone,
Codex has neither the sources its objections must cite nor the mapping its
prior-objection verdicts answer. A prompt argument and stdin are both
accepted, and stdin arrives as a `<stdin>` block.

A non-zero exit, a timeout, an empty output file or output that does not validate
against the schema all mean the same thing: **Codex did not review.** Say so in
the panel line and continue with the Claude reviewers. Never fabricate its
verdict, and never let its absence quietly shrink the panel to two.

### 1.5 Announce the panel

Every run, before the first round:

```
Plan touches: Go · Kubernetes · GitHub Actions
Panel (6): architect · sceptic · operator   [review-worker tier, resolved]
         + developer-specialist-go · devops-specialist-kubernetes
         + tooling-specialist-github-actions
         codex: absent (CLI not installed)
```

If a domain matched but its specialist is not installed, say that too — it is a
gap in the panel, and the user should know the plan went unreviewed from that
angle rather than assume it passed.

## Phase 2 — the rounds

`N = --concurrency` (default 3, hard max 6). Each round is four steps.

Before round 1, create one scratch directory for the whole run, outside the
project, and name it in every brief:

```bash
TS="$(date +%Y%m%d-%H%M%S)"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/challenge-${TS}.XXXXXX")"
```

It is the only place a reviewer may write (a throwaway measurement, a fetched
source file), and only where its own Command scope allows it. A brief that names
no scratch directory leaves the reviewer read-only everywhere: the claim it could
have measured goes under `unverified`.

Gather the **project records** once too: the documents and ADRs Phase 0 already
hands to reviewers, the verification scripts the plan cites (a dependency or
layering check, a lint gate), and the benchmark methodology file when the plan
makes a performance claim. Find them in the repository and the plan; each goes
in the brief as a path with a one-line purpose, so a specialist reads the
domain's founding decisions instead of rediscovering them.

Build the **reference sources** once too, and before round 1. Walk the plan
section by section and list every technology topic it touches — a socket unit,
a service unit, kill behaviour, a notify protocol, an API at a named version —
using the same evidence that routed the specialists in 1.1, so the topic list
and the panel agree. For each topic record at least one source, found in the
order "What every specialist owes back" in `../_shared/specialists.md` sets.
Each entry is a topic, a URL or a path, and a one-line purpose; a page already
downloaded as plain text into `$SCRATCH` is cited by its scratch path and its
URL. **A topic with no entry blocks dispatch**: fill the gap first, or a missing
page (the `systemd.socket(5)` the plan relied on) surfaces only in round 2.

### 2.1 Argue — all reviewers, one message, in parallel

Each reviewer gets the **plan text inline**, not a path. A reviewer that has to
go fetch the plan spends its turns fetching instead of judging.

The brief, per reviewer. Every brief opens with the literal marker `Plan review
mode` and carries the same six-field contract: that marker is what switches a
specialist from the output format of its own definition to this one, and the
caller's format wins over the agent's, always (see "Plan review mode" in
`../_shared/specialists.md`). The three lenses run on `general-purpose` by
design, so their brief opens with `[general-purpose-ok]`, the marker the
kodflow-hooks routing gate reads as a deliberate dispatch, then the line
`Plan review mode`; a specialist's brief starts with `Plan review mode` alone.

```
[general-purpose-ok]
Plan review mode
Here is a plan. Argue against it from the <lens> lens.

<the full plan>

Constraints this project has already accepted:
<the MUST/MUST NOT constraints from the ledger, verbatim>

Project records:
<path — one-line purpose, per record>

Reference sources:
<topic — URL or path (and its scratch copy, if downloaded) — one-line purpose, per entry>

Scratch directory: <$SCRATCH>

Prior objections (round 2 on; omit in round 1):
<per objection: ID, claim verbatim, remedy, disposition (accepted / rejected /
needs the user / unverified), and the rejection proof or the plan location where
the fix was applied>

Your objections by triage ID (round 2 on; omit in round 1):
| triage ID | your local number | round |
<one row per objection you raised, merged ones included>
Under a heading "Prior objections", give one verdict per triage ID: whether the
fix is correct, or why the rejection is wrong. These verdicts do not count
against the budget below.

Return objections only; the output format of
your own definition does not apply here. Number your new objections 1, 2, 3…
(a label, not a field). At most 8 objections, each with the six fields:
severity (blocking / material / minor), claim, evidence (file:line, or the plan
line it contradicts), remedy, consulted (the sources you checked, one entry per
source: a URL, a file read at a revision as path@rev, or a scratch measurement
with its command and result), unverified (what you could not confirm, and what
you tried). A technology objection cites at least one reference source in
consulted, or an authoritative outside source that substantiates the claim,
naming the topic it settles.
With more than 8, keep the most severe; never shorten a field to fit more. An
objection with no concrete failure behind it is noise — leave it out. If the
plan is sound from your lens, say so and stop; do not manufacture an objection
to look useful.
```

Structured return per objection: `severity`, `claim`, `evidence`, `remedy`,
`consulted`, `unverified` — the six fields of the contract, the same for the
lenses, the specialists and Codex.

**The budget is a count, never a length.** Every brief states "at most 8
objections, each with the six fields", and no brief sets a word or character
limit on the response: under a word limit, eight objections fit only by
compressing the very fields triage needs. A reviewer's local number is a label
on the objection, not a seventh field; it restarts at 1 in every round, and
each later round's new objections are mapped exactly like round 1's.

### 2.2 Triage — you, not a reviewer

Give each objection a stable ID, `R<round>-<n>`, kept for the rest of the run,
and record against it the reviewer, the round and that reviewer's local
number. When objections from several reviewers are merged into one triage ID,
the ID keeps every contributing reviewer and local number, and the claim text
of each. That mapping is what each reviewer's table in the next brief is cut
from, so no reviewer has to rebuild it from summaries.

A reviewer that cites an authoritative source outside the reference sources
has found a gap or a better source, whether the list covers that topic or not
(the raw freedesktop.org page where the list named a Context7 entry): when it
substantiates the claim, take it as evidence and add that source to the list for
the next round. A technology objection citing neither a list entry nor an
outside source that substantiates it falls under the empty-`consulted` rule of
1.3.

Then judge each objection against the plan and the codebase:

| Verdict | Meaning | Effect |
|---------|---------|--------|
| **accepted** | It is right; the plan changes | rewrite in 2.4 |
| **rejected** | Provably wrong — cite what proves it | recorded, never silently dropped |
| **needs the user** | A real choice only the user can make — a trade-off, a priority, a scope call | phase 2.3 |
| **unverified** | Nobody could reach the documentation that would settle it | recorded as an open uncertainty, **not** put to the user |

A reviewer contradicting another is normal and often the most useful signal.
Do not average them: pick, and say why.

**Rejected objections are recorded in the output.** A reviewer that was wrong
about something specific is information for the next round.

The next round's briefs carry every objection so far **with its text**, not its
ID alone: a reviewer handed `R1-3: fixed` cannot tell whether the fix answers
the claim or misreads it.

### 2.3 Ask — the moment a difficulty appears

Any objection landing in *needs the user* stops the round and becomes a question
**immediately**. Not batched to the end, not resolved by assumption.

`AskUserQuestion`, one question per genuine difficulty, and each question:

- offers exactly **3 options**
- marks **one as recommended** — put it first and append `(Recommended)` to its
  label. **This is mandatory.** A question with no recommendation pushes the
  decision back without the analysis that earned it.
- the free-text answer is always available (the tool adds it), so a fourth path
  is never blocked

Each option's description says what it costs, not just what it is. "Simpler, but
you cannot add per-tenant limits later without a migration" is useful; "simpler
approach" is not.

Cap: **4 questions per round.** Beyond that the plan is too unformed to debate —
say so and send it back to `/plan`.

Answers become **constraints for every later round**. A reviewer that re-opens a
settled question is answered with the decision, not re-argued.

### 2.4 Rewrite — the plan changes, not its defence

Apply every accepted objection and every answer to the plan text itself. The
rewritten plan is what round N+1 argues with.

**Do not defend the plan.** If an objection is accepted, the plan was wrong; say
what changed. Arguing back is how three rounds produce zero improvement.

### Stopping

Stop at the first of:

- a round produces **no accepted objection** *and* the plan was not rewritten
  during it — only then is it converged. A round where the user's answers
  changed the plan ends with a version nobody reviewed; that is not
  convergence, and calling it so is how an unreviewed rewrite ships.
- `N` rounds are done
- the user answers a question in a way that invalidates the plan's premise —
  stop and say the plan needs redoing, do not patch around it

Report the round count and **which of three states the plan ended in**:

| State | Means |
|-------|-------|
| `converged` | last round raised no accepted objection and changed nothing |
| `rewritten-unreviewed` | the last round changed the plan; no reviewer has seen that version |
| `review-incomplete` | the round cap was reached with objections still open |

Never report the last two as convergence. A run that converged in one round is a
better result than one that used all three; a run that hit the cap is not a
result at all, it is a plan that needs another pass.

## Recording

Per round, keep: objections raised, the triage ID ↔ reviewer local number
mapping, verdict on each, questions asked and answered, what changed in the
plan, and any source added to the reference sources. This becomes the *What
changed* / *What you decided* / *What is still open* sections of the handover,
and — when the plan belongs to a `/feature` or `/fix` subject — the comment posted on its issue.

## Guardrails

| Action | Status |
|--------|--------|
| Name a reviewer that did not run | **FORBIDDEN** |
| Fabricate a Codex verdict when the CLI is absent | **FORBIDDEN** |
| Manufacture an objection to fill a round | **FORBIDDEN** |
| Batch a difficulty to the end instead of asking when it appears | **FORBIDDEN** |
| Ask without marking one option recommended | **FORBIDDEN** |
| Ask more than 4 questions in a round | **FORBIDDEN** — send it back to `/plan` |
| Drop a rejected objection from the record | **FORBIDDEN** |
| Defend the plan instead of rewriting it | **FORBIDDEN** |
| Re-argue a question the user already answered | **FORBIDDEN** |
| Run past `--concurrency` | **FORBIDDEN** |
| Dispatch a brief with a technology topic missing from its reference sources | **FORBIDDEN** |
| Set a word or character limit on a reviewer's response | **FORBIDDEN** — the budget is at most 8 objections, each with the six fields |
| Hand a reviewer prior objections without its own triage ID table | **FORBIDDEN** |
