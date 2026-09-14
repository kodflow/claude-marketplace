# /project — Phase 4: the constraint ledger

A conversation is erased by `/clear`. A constraint in `CLAUDE.md` is re-read by
every future session, by `/warmup` at start-up, by `/plan` before it designs, by
`/refine` when it builds a goal contract, and by `/review` when it judges a diff.
Phase 4 is what converts one into the other.

---

## The record format

`CLAUDE.md` carries a `## Constraints` section. One entry each:

```markdown
### C-007 — Errors carry context
- **Category:** quality
- **Rule:** MUST wrap every returned error with `fmt.Errorf("...: %w", err)`.
- **Verify:** `golangci-lint run --enable=wrapcheck ./...` exits 0
- **Origin:** 2026-09-08 — agreed after the silent-failure incident in worker.go
```

| Field | Rule |
|-------|------|
| **ID** | `C-NNN`, zero-padded, allocated once, never reused, never renumbered |
| **Title** | ≤ 8 words, states the rule not the topic — "Errors carry context", not "Error handling" |
| **Category** | one of `architecture` · `quality` · `security` · `workflow` · `product` · `ops` |
| **Rule** | one sentence, starts with **MUST** / **MUST NOT** / **SHOULD** / **SHOULD NOT** |
| **Verify** | a command with a pass condition, or `manual: <what a reviewer checks>` |
| **Origin** | ISO date + the sentence in the conversation that settled it |

### MUST vs SHOULD

`MUST` is for a rule with a mechanical verifier — something CI or a linter can
fail on. `SHOULD` is for a preference a human judges. Do not promote a
preference to `MUST` because it feels important; an unverifiable `MUST` teaches
future sessions that the ledger can be ignored.

If a rule deserves `MUST` but has no verifier yet, record it as `SHOULD` with
`**Verify:** manual: …` and add a follow-up note. Upgrading it later is a normal
supersede.

---

## What becomes a constraint

Capture a decision when **all three** hold:

1. It is **settled** — the user stated it, or agreed to a proposal.
2. It **outlives this task** — it will still apply to the next feature.
3. It is **falsifiable** — a future change could violate it.

| Said in chat | Ledger entry |
|--------------|--------------|
| "no ORM, raw SQL only" | `MUST NOT` add an ORM dependency · verify: dependency grep |
| "everything through the Makefile" | `MUST` expose each dev task as a make target · verify: `make -n <task>` |
| "keep it under 100 ms p99" | `MUST` keep p99 < 100 ms on the bench · verify: `make bench` threshold |
| "I prefer tabs" | formatting — belongs in the formatter config, not the ledger |
| "let's try Redis for this" | not settled — an idea, not a constraint |
| "fix the bug in worker.go" | a task, not a constraint |

Anything else stays out. The ledger is a record of what was agreed, never a
wish list, and never a place to park your own recommendations.

### Do not duplicate the toolchain

A rule already enforced by a committed config file — `.golangci.yml`,
`ruff.toml`, `tsconfig.json`, `.editorconfig` — does not need a ledger entry.
Point at the config instead. The ledger holds what the tools *cannot* check.

---

## The capture procedure

1. **Re-read the whole conversation**, not only the last turn. Constraints are
   often set early and casually.
2. **Extract candidates** against the three tests above.
3. **Deduplicate** against the existing ledger. A near-duplicate is either the
   same constraint (skip) or a refinement (supersede — never edit in place).
4. **Confirm before writing.** Present the candidates as a compact list and ask
   with a multiple-choice question to the user which to record (multi-select). A user who says "all
   of them" gets all of them; nothing is written unconfirmed.
5. **Allocate IDs** from `max(existing) + 1`.
6. **Append** to `## Constraints`, keeping numeric order.
7. **Report** the IDs written, one line each.

`--constraint "<rule>"` skips steps 1-4: the user has already stated the rule, so
normalise it, allocate an ID, and append.

`--sync` runs the full procedure and reports "no new constraints" when the
conversation added nothing — an honest empty result, not an invented entry.

---

## Superseding

Constraints are append-only. A rule that changes gets a new entry and a marked
old one:

```markdown
### C-004 — Sessions in Postgres  *(superseded by C-019 on 2026-09-08)*
- **Category:** architecture
- **Rule:** MUST store sessions in Postgres.
- **Verify:** manual: session store is `pgstore`
- **Origin:** 2026-04-02 — chosen for transactional consistency

### C-019 — Sessions in Redis
- **Category:** architecture
- **Rule:** MUST store sessions in Redis with a 24 h TTL.
- **Verify:** `grep -r "redis.NewClient" internal/session/` matches
- **Origin:** 2026-09-08 — supersedes C-004; Postgres session table became the write bottleneck
- **Supersedes:** C-004
```

The history is the value: it records *why* the project moved, which is exactly
what a reviewer needs to avoid re-proposing the abandoned design. When a
supersede reflects a genuine architectural decision, also write an ADR with
`the /adr skill` and cross-reference it.

---

## File layout and size

`CLAUDE.md` obeys the `/warmup` thresholds — 0-150 lines ideal, 251-300 critical,
301+ forbidden. When the ledger pushes the file past **250 lines**, split it:

```markdown
<!-- CLAUDE.md -->
## Constraints

Full ledger: [.claude/constraints.md](.claude/constraints.md) — 34 active.

Non-negotiable in every task:
- **C-002** MUST NOT add a runtime dependency without an ADR.
- **C-011** MUST keep `make ci` green before any push.
- **C-019** MUST store sessions in Redis with a 24 h TTL.
```

`CLAUDE.md` then keeps only the handful that apply to *every* change; the rest
live in `.claude/constraints.md` (committed — it is shared project knowledge,
unlike `.claude/goals/`). Both files stay under the thresholds.

---

## Skeleton for a new CLAUDE.md

```markdown
# <project>

<one paragraph: what this is and who it is for>

## Stack

| Layer | Choice |
|-------|--------|
| Language | … |
| Build | … |
| Test | … |

## Commands

| Task | Command |
|------|---------|
| build | … |
| test | … |
| lint | … |

## Constraints

<!-- Appended by /project. Append-only: supersede, never rewrite. -->
```

---

## Guardrails

| Action | Status |
|--------|--------|
| Write a constraint the user never agreed to | **FORBIDDEN** |
| Rewrite or renumber an existing entry | **FORBIDDEN** — supersede |
| Reuse the ID of a deleted entry | **FORBIDDEN** |
| Record a secret, token, hostname or credential | **FORBIDDEN** — it is committed |
| Record a one-off task as a constraint | **FORBIDDEN** |
| `MUST` with no verifier | **FORBIDDEN** — use `SHOULD` + `manual:` |
| Regenerate an existing `CLAUDE.md` from scratch | **FORBIDDEN** — append only |
| Report "captured" without naming the IDs | **FORBIDDEN** |
