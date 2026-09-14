# /search — Phases 1-2: local lookup and decomposition

## Phase 1.0 — index-driven lookup

Read the index once. Do not walk the directory tree; the index exists so this
phase costs one file read instead of 152.

```bash
jq -r '.documents[] | [.path,.title,.status,.verified,(.tags|join(","))] | @tsv' \
   ~/.claude/docs/INDEX.json | grep -iE '<keyword1>|<keyword2>'
```

`INDEX.json` fields per document: `path` `name` `category` `title` `summary`
`tags` `verified` `age_days` `ttl_days` `status` `lines`.

If `INDEX.json` is missing or older than the newest document, rebuild it first:

```bash
python3 ~/.claude/docs/reindex.py
```

### Matching

1. Match query keywords against `tags`, `name`, `title`, `summary` — in that
   order of weight. `tags` carry `lang:go`, `lang:rust` … so a language-specific
   query narrows correctly.
2. Read the matched documents in full. A tag match is a candidate, not an answer.
3. Record, for each: path, `verified`, `status`, and **what it actually answers**.

### Freshness gate

| `status` | Treat as | Allowed use |
|----------|----------|-------------|
| `fresh` | validated | citable directly |
| `stale` | hypothesis | citable **only after** a web source confirms it; otherwise report the conflict |
| `expired` | not evidence | ignore for facts; may still frame the question |

A document's *structural* claims (what the pattern is, when it applies) age far
more slowly than its *operational* ones (this library, this flag, this default,
this CVE). When a `stale` doc is right about the shape and wrong about the
tooling, say exactly that — do not discard the whole file, and do not cite the
tooling half.

### Category map

| Query domain | Directories |
|--------------|-------------|
| design patterns | `creational/` `structural/` `behavioral/` |
| architecture | `architectural/` `integration/` |
| domain modelling | `ddd/` `enterprise/` |
| distributed / cloud | `cloud/` `resilience/` `messaging/` |
| concurrency | `concurrency/` |
| performance | `performance/` |
| security | `security/` |
| testing | `testing/` |
| infrastructure & delivery | `devops/` |
| language-agnostic rules | `principles/` `refactoring/` `conventions/` |

## Phase 1.5 — coverage verdict

```yaml
verdict:
  inputs: [query_class (Phase 0), matched_docs, their statuses]

  LOCAL_COMPLETE:
    requires_all:
      - "query_class == CONCEPTUAL"
      - "matched_docs cover >= 80% of the query"
      - "every matched doc has status == fresh"
      - "you can NAME each file and its verified date"
    then: "write the context from local, skip the engine, STOP"

  LOCAL_PARTIAL:
    when: "matched_docs cover >= 40%, or any match is stale/expired"
    then: "list the GAPS explicitly, run the engine on the gaps"

  LOCAL_NONE:
    when: "no matched validated document"
    then: "run the engine on the full query"
```

**The three ways this gate gets cheated — all forbidden:**

- Counting the project's own source code, git history, or your own recall as
  "local coverage". Validated docs means `~/.claude/docs/**` and the repo's
  `docs/*.md`, nothing else.
- Declaring `LOCAL_COMPLETE` on a VERSIONED query. Phase 0 already ruled that
  out; re-deciding it here is the same error with extra steps.
- Citing a `stale` document as if it were `fresh`. The status is in the index
  and in the file's frontmatter; it is not a judgement call.

**Output**

```
═══════════════════════════════════════════════════════════════
  /search — local base
═══════════════════════════════════════════════════════════════

  Query    : <query>            Class: VERSIONED | CONCEPTUAL
  Keywords : <k1>, <k2>, <k3>

  Matched (~/.claude/docs/, index 2026-09-08):
    ├─ security/jwt.md          verified 2026-03-11   stale    ~90%
    ├─ security/oauth2.md       verified 2026-03-11   stale    ~70%
    └─ ddd/repository.md        verified 2026-03-11   fresh    ~30%

  Coverage : 70% → LOCAL_PARTIAL
  Gaps:
    ├─ current recommended flow for a public client (2026)
    └─ whether the local doc's library advice still holds

  Next: engine runs on the gaps + confirmation of the 2 stale docs.
═══════════════════════════════════════════════════════════════
```

Report the real numbers. A coverage figure you did not derive from named files
is a decoration, and it is the single easiest way for this phase to lie.

---

## Phase 2.0 — decomposition

Decompose before searching, so the fan-out covers the question instead of
repeating it.

1. **Split the query into concepts.** "OAuth2 with JWT for a REST API" is four:
   OAuth2 flow · JWT structure and validation · API authorisation model ·
   how they compose.
2. **Attach a source tier to each.** OAuth2 → RFC 6749/9700 (tier 1); JWT →
   RFC 7519 (tier 1); library specifics → maintainer docs (tier 2).
3. **Subtract what Phase 1 already answered.** Only gaps go to the engine —
   plus explicit *confirmation* tasks for every `stale` doc being relied on.
4. **Cap the fan-out at 6.** Beyond that the sub-queries overlap and the
   synthesis degrades.

```
═══════════════════════════════════════════════════════════════
  /search — decomposition
═══════════════════════════════════════════════════════════════

  Concepts:
    1. OAuth2 flow for a public client   → RFC 9700, oauth.net      [gap]
    2. JWT validation rules              → RFC 7519, RFC 8725       [confirm security/jwt.md]
    3. Token storage in a browser        → OWASP ASVS               [gap]
    4. Composition with our API gateway  → local: integration/api-gateway.md [covered]

  Engine tasks: 3 (2 gaps, 1 confirmation)
═══════════════════════════════════════════════════════════════
```
