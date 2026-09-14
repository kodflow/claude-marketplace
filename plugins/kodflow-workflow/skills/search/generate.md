# Phase 9.0: Generate Named Context File (RLM Pattern: Programmatic)

## Path Resolution (MANDATORY)

All `.claude/` paths MUST be absolute, anchored to workspace root:
```bash
WORKSPACE_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo /workspace)
```
- Write contexts to: `${WORKSPACE_ROOT}/.claude/contexts/{slug}.md`

**NEVER use relative `.claude/` paths** — subagents may operate from subdirectories.

---

**Slug generation from query keywords:**

```yaml
slug_generation:
  input: "OAuth2 JWT authentication for REST API"
  steps:
    1_extract: "oauth2 jwt authentication rest api"
    2_remove_stopwords: "oauth2 jwt authentication rest api"  # remove: for, the, a, an, with, to, of, in, on
    3_truncate: "oauth2-jwt-auth"  # max 40 chars, kebab-case, take first 3-5 significant words
  output: ".claude/contexts/oauth2-jwt-auth.md"
```

**The file must be plan-grade.** `/plan` reads it instead of re-researching, so
a missing section is a gap `/plan` will fill by guessing. Every section below is
required; a section with nothing to say says `none` — it is never omitted.

```markdown
---
topic: <topic>
slug: <slug>
generated: <ISO8601>
query: "<verbatim query>"
class: VERSIONED | CONCEPTUAL
gate: LOCAL_COMPLETE | LOCAL_PARTIAL | LOCAL_NONE
engine: workflow:research | degraded:agents | none
---

# Context: <topic>

## Answer

<The direct answer, at most 5 lines. If the question has no single answer,
say what it depends on — do not pad.>

## Facts

| # | Claim | Source | Tier | Confidence |
|---|-------|--------|------|------------|
| 1 | <one falsifiable statement> | <url> | 1 | confirmed (3 sources) |
| 2 | <...> | <url> | 2 | single-source |

`confidence` is derived, not asserted: `confirmed` needs >= 2 independent
tier 1-2 sources; anything else is `single-source` and must say so.

## Versions

| Thing | Value | As of | Source |
|-------|-------|-------|--------|
| <library/protocol/API> | <version, default, limit> | <date> | <url> |

Everything the plan will depend on that could change with a release. Empty only
for a purely conceptual query.

## Decisions open

| Decision | Options | Trade-off | Depends on |
|----------|---------|-----------|------------|
| <the real choice> | A / B | <what each costs> | <the project fact that settles it> |

The choices the research did NOT settle, because they depend on this project.
Do not collapse one into a recommendation — that is `/plan`'s call, made against
the constraint ledger. An empty table on a genuinely open design question means
the search failed.

## Pitfalls

- **<failure mode>** — <what goes wrong, and when> ([source](<url>))

Only pitfalls a source documents. A plausible-sounding hazard with no citation
is speculation, and it will be read as fact by the next reader.

## Conflicts

| Topic | Source A says | Source B says | Believed | Why |
|-------|---------------|---------------|----------|-----|

Empty is fine and common. Silently resolving a conflict is not.

## Open questions

- <what is still unknown, and what would settle it>

Write `none` explicitly when nothing is. A search that claims complete knowledge
of an unfamiliar area is the least trustworthy output this skill can produce.

## Local base

| Doc | Verified | Status | Role | Action |
|-----|----------|--------|------|--------|
| security/jwt.md | 2026-03-11 | stale | claims 2, 5 | confirmed → restamped 2026-09-08 |
| security/oauth2.md | 2026-03-11 | stale | claim 3 | corrected → see its changelog |

Filled by Phase 10 (`refresh.md`). `none` when no local document was consulted.

## Sources

| # | Title | URL | Tier | Fetched |
|---|-------|-----|------|---------|

---
_Written by /search. Committed with the project — this is shared research._
```

**Write to:** `.claude/contexts/{slug}.md`

---

## --append

Enrich existing context:

1. Generate slug from query keywords (same rules)
2. Read existing `.claude/contexts/{slug}.md`
3. Identify gaps (missing sections)
4. Search only for gaps
5. Merge without duplicates

---

## --list

List all available contexts:

```yaml
list_workflow:
  action: "Glob .claude/contexts/*.md"
  output: |
    ═══════════════════════════════════════════════
      /search - Available Contexts
    ═══════════════════════════════════════════════

      Contexts in .claude/contexts/:
        ├─ oauth2-jwt-auth.md (2024-01-15)
        ├─ kubernetes-ingress.md (2024-01-14)
        └─ react-server-components.md (2024-01-13)

      Total: 3 context files

    ═══════════════════════════════════════════════
```

---

## --status

Display the most recent context file content (or specific by slug).

---

## --clear

Delete context files:

```yaml
clear_workflow:
  "--clear <slug>": "Delete .claude/contexts/{slug}.md"
  "--clear": "Delete context matching current query slug"
  "--clear --all": "Delete all files in .claude/contexts/"
```

---

## Phase 9.5: Plan chain (PR1 — Skills Architecture v1.3)

If the query exposed implementation-intent (keywords: *implement*, *build*,
*add*, *migrate*, *refactor*, *plan how to*), chain into `/plan` so the
context just generated immediately becomes the input for a structured plan.

```yaml
plan_chain:
  trigger:
    keywords: ["implement", "build", "add", "migrate", "refactor", "plan how to"]
    OR explicit_flag: "--then-plan"
  primitive: |
    Skill(skill="plan", args="--context {slug}")
  fallback_when_skill_absent: "/plan --context {slug}"
```

The 5th chain (`/plan → /refine`) is wired in PR5a once `/refine` lands.
