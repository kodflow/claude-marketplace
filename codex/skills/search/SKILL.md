---
name: search
description: 'Research a technology, API or practice and write a plan-grade context file to
  .claude/contexts/<slug>.md. Consults the local knowledge base first — but treats it as dated
  evidence, not scripture: every document carries a `verified` date, and a stale one is a
  hypothesis to confirm against the web rather than a source to cite. Fans out over official
  documentation, cross-validates, resolves conflicts, and writes the confirmed answer back
  into the local base so it stops rotting. The output is shaped for /plan to consume directly.
  Use when before designing anything you do not already know cold — a new library, an unfamiliar
  API, a protocol, a migration, a security mechanism — and any time correctness depends on
  a current version rather than on memory.'
metadata:
  short-description: 'Research a technology, API or practice and write a plan-grade context
    file to '
  generated-from: plugins/*/skills/search
  argument-hint: <query> | --refresh <topic> | --append | --status | --list | --clear [--all]
---

# /search — research that produces a plannable answer

the arguments

The output is not a summary. It is the input `/plan` needs: version-pinned
facts, the decisions that are actually open, the trade-off on each, the known
pitfalls, and an explicit list of what is still unknown.

## The local base is dated, not sacred

`~/.claude/docs/` holds 152 validated documents. Each carries a `verified` date
and a category TTL, indexed in `~/.claude/docs/INDEX.json`.

```
verified age ≤ TTL       fresh    → citable as validated
TTL < age ≤ 2×TTL        stale    → a hypothesis; confirm before citing
age > 2×TTL              expired  → ignore as evidence; re-derive from the web
```

This is the correction to the old "LOCAL > EXTERNAL, always" rule. A pattern's
*shape* survives for years; its code examples, library recommendations and
security advice do not. Treating a two-year-old security note as validated is
how a research skill launders staleness into a plan.

Security and DevOps carry a 180-day TTL for that reason. Structural and
behavioural patterns carry 1095.

---

## Arguments

| Pattern | Action |
|---------|--------|
| `<query>` | Research the topic, write `.claude/contexts/<slug>.md` |
| `--refresh <topic>` | Re-verify the matching local docs against the web and restamp them |
| `--append` | Add to the existing context for this slug instead of replacing |
| `--status` | Print the current context file |
| `--list` | List available contexts, newest first |
| `--clear [--all]` | Delete one context, or all of them |
| `--help` | Print the help block and stop |

## --help

```
════════════════════════════════════════════════════════════════
  /search — documentation research (freshness-aware, local-first)
════════════════════════════════════════════════════════════════

Usage: /search <query> [options]

  <query>            Research the topic
  --refresh <topic>  Re-verify local docs against the web, restamp them
  --append           Extend the existing context
  --status           Show the current context
  --list             List contexts
  --clear [--all]    Delete one / all contexts
  --help             This help

Output: .claude/contexts/<slug>.md   (slug = keywords, lowercase, ≤ 40 chars)
        "OAuth2 JWT authentication" → oauth2-jwt-auth

Local base: ~/.claude/docs/ — 152 docs, INDEX.json carries verified dates.
            fresh → citable · stale → confirm first · expired → ignore

Workflow:
  /project → /warmup → /search <topic> → /plan → /refine → /goal
════════════════════════════════════════════════════════════════
```

**If `the arguments` contains `--help`:** print the block and STOP.

---

## Phase map

| Phase | Action | Module |
|-------|--------|--------|
| 0 | Classify the query — decides whether the web is mandatory | this file |
| 1 | Local lookup via `INDEX.json`, with freshness | `local.md` |
| 2 | Decompose into sub-queries and gaps | `local.md` |
| 3-5 | Web fan-out, fetch, summarise | `parallel.md` |
| 6-7 | Cross-validate, resolve conflicts | `validate.md` |
| 8 | Ask the user only where a real ambiguity blocks the answer | `parallel.md` |
| 9 | Write `.claude/contexts/<slug>.md` | `generate.md` |
| 10 | Write confirmed findings back into `~/.claude/docs/` | `refresh.md` |

---

## Phase 0 — classify the query

The classification, not a coverage percentage, decides whether the web runs.

| Class | Example | Web |
|-------|---------|-----|
| **VERSIONED** — depends on a current release, API, CVE or default | "Go 1.26 loop semantics", "is X still maintained", "OAuth2 for a SPA in 2026" | **MANDATORY**, always, even at 100% local coverage |
| **CONCEPTUAL** — a pattern's shape, a trade-off, a definition | "when to use CQRS", "saga vs 2PC" | Skippable **only** when every matched doc is `fresh` |
| **INTERNAL** — this repository's own code or history | "how does our auth middleware work" | No web. This is not a `/search` — read the code, or use `Explore` |

Anything naming a version, a date, a library, a vulnerability, a price or a
default is VERSIONED. When unsure, it is VERSIONED — the cost of one extra web
pass is minutes; the cost of planning against a stale API is a rewrite.

**INTERNAL queries exit here** with a one-line redirect. `/search` researches the
world outside the repository; it is not a code reader, and dressing up a source
read as "research" produces a context file with no citable sources.

---

## Phase 1 gate — what may be skipped

```
/search <query>
  │
  ├─ Phase 0 classify ── INTERNAL ──→ redirect, STOP
  │
  ├─ Phase 1 local lookup (INDEX.json)
  │     ├─ CONCEPTUAL + coverage ≥ 80% + every match `fresh`
  │     │      → LOCAL_COMPLETE: write the context from local, STOP
  │     │        Valid ONLY when you name the matched files and their dates.
  │     └─ anything else → compute GAPS, run the engine ↓
  │
  ├─ engine (Workflow `research`)
  │     Scope → Search∥ → Fetch∥ → Verify(3-vote) → Synthesize
  │     returns { context_md, sources, confidence_map } — writes nothing
  │
  ├─ Phase 9  the SKILL writes .claude/contexts/<slug>.md   (sole writer)
  │
  └─ Phase 10 write confirmed findings back to ~/.claude/docs/, restamp
```

`LOCAL_COMPLETE` requires **naming the matched files with their `verified`
dates**. "I know this already" is not local coverage; neither is the project's
own source code. If you cannot cite the documents, the engine runs.

**Degraded path.** If the `Workflow` tool itself errors, fall back to the
parallel `Agent` path in `parallel.md` — and say in the output that you did,
so the result is not mistaken for an engine run.

---

## Source preference

Ordered, not absolute. Prefer the highest tier that answers the question, and
record the tier used against every claim in the context file.

| Tier | Sources |
|------|---------|
| **1 — normative** | the project's own docs and spec; RFCs (`rfc-editor.org`, `datatracker.ietf.org`); standards bodies (`w3.org`, `owasp.org`, `unicode.org`); `developer.mozilla.org` |
| **2 — first-party** | the maintainer's own site, repository, `CHANGELOG`, release notes, migration guide, ADRs, `pkg.go.dev` / `docs.rs` / `docs.python.org` and equivalents |
| **3 — corroborating** | the maintainer's issue tracker and discussions, a CVE record, a benchmark whose method is published |
| **4 — orientation only** | blogs, Stack Overflow, tutorials, LLM-generated pages |

Tier 4 may be used to **find** a fact and never to **support** one: chase it to
its tier 1-2 source, cite that, and drop the claim if the chase fails.

The previous version of this skill hard-blocked everything outside a fixed
domain list. That was worse, not stricter: it blocked a library's own GitHub
release notes — the single most authoritative answer to "what changed" — while
allowing a stale vendor page. Tier, not domain, is the test.

---

## Guardrails

| Action | Status |
|--------|--------|
| Skip the local lookup | **FORBIDDEN** |
| `LOCAL_COMPLETE` without naming the matched files and dates | **FORBIDDEN** |
| `LOCAL_COMPLETE` on a VERSIONED query | **FORBIDDEN** |
| Cite a `stale`/`expired` doc as validated without web confirmation | **FORBIDDEN** |
| Skip the engine when the gate did not short-circuit | **FORBIDDEN** |
| Support a claim with a tier-4 source | **FORBIDDEN** |
| State a version, default or limit without the source that says it | **FORBIDDEN** |
| Present a single-source claim as confirmed | **FORBIDDEN** — mark it `single-source` |
| Silently drop a conflict between sources | **FORBIDDEN** — record both, see `validate.md` |
| Restamp `verified` on a doc you did not actually re-check | **FORBIDDEN** |
| Write a context file with no "Open questions" section | **FORBIDDEN** — say "none" explicitly |
| Answer from memory when a fetch failed | **FORBIDDEN** — report the gap |

---

## The output contract

`.claude/contexts/<slug>.md` must let `/plan` design without re-researching.
Full template in `generate.md`; the required sections are:

| Section | Must contain |
|---------|--------------|
| **Answer** | the direct answer in ≤ 5 lines |
| **Facts** | one row per claim: statement · source URL · tier · confidence |
| **Versions** | every version, default and limit that the plan depends on |
| **Decisions open** | each real choice, its options, and the trade-off — *not* a recommendation dressed as a fact |
| **Pitfalls** | failure modes the sources actually document, with the citation |
| **Conflicts** | where sources disagree, and which was believed and why |
| **Open questions** | what remains unknown — explicitly `none` when nothing does |
| **Local base** | docs consulted with their `verified` dates; docs restamped by Phase 10 |

A context file whose "Decisions open" section is empty on a genuinely open
design question is a failed search: it means a preference was recorded as a
finding.

---

## Chain

```
/project → /warmup → /search <topic> → /plan --context <slug> → /refine → /goal
```

When the query carries clear implementation intent (`generate.md` Phase 9.5),
offer the chain — `the /plan skill` — rather than
starting to implement.
