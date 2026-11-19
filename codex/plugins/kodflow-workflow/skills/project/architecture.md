# /project — Phase 5: architecture patterns as constraints

An architecture chosen in conversation and never written down gets re-litigated
every session, and drifts. Phase 5 pins the chosen patterns into the same ledger
as everything else, so `/plan` designs against them and `/review` can cite them.

A pattern becomes a constraint **only when the project has actually committed to
it**. Proposing patterns the user never asked for turns the ledger into noise.

---

## The local pattern library

`~/.claude/docs/` holds 175 validated pattern documents. They are the reference a
constraint points at — the ledger states the rule, the doc explains it.

| Category | Directory | Patterns |
|----------|-----------|----------|
| Architectural | `architectural/` | hexagonal, layered, modular-monolith, monolith, microservices, serverless, cqrs, event-driven, event-sourcing |
| DDD | `ddd/` | aggregate, bounded-context, domain-event, domain-service, entity, repository, specification, value-object |
| Enterprise | `enterprise/` | active-record, data-mapper, domain-model, dto, gateway, identity-map, lazy-load, remote-facade, repository, service-layer, transaction-script, unit-of-work |
| Cloud | `cloud/` | ambassador, cache-aside, circuit-breaker, claim-check, gateway-\*, saga, sharding, strangler-fig, valet-key, … |
| Resilience | `resilience/` | bulkhead, circuit-breaker, health-check, rate-limiting, retry, timeout |
| Messaging | `messaging/` | dead-letter, idempotent-receiver, pipes-filters, process-manager, scatter-gather, transactional-outbox, … |
| Integration | `integration/` | anti-corruption-layer, api-gateway, bff, service-mesh, sidecar |
| Concurrency | `concurrency/` | actor-model, copy-on-write, future-promise, mutex-semaphore, pipeline, producer-consumer, read-write-lock, thread-pool |
| Performance | `performance/` | batch-processing, cache-strategies, connection-pool, debounce-throttle, lazy-load, memoization, object-pool, ring-buffer |
| Security | `security/` | abac, api-keys, input-validation, jwt, oauth2, rbac, secrets-management, session-auth |
| Testing | `testing/` | builder, contract-testing, fixture, object-mother, property-based, snapshot, test-containers, test-doubles |
| DevOps | `devops/` | blue-green, canary, feature-toggles, gitops, iac, immutable-infrastructure, rolling-update, terraform-\*, vault-patterns |
| Principles | `principles/` | SOLID, GRASP, DRY, KISS, YAGNI, defensive |
| Behavioral / Structural / Creational / Functional | `behavioral/` `structural/` `creational/` `functional/` | the GoF set + composition, either, lens, monad, option |

`ls ~/.claude/docs/<category>/` for the current contents — the table above is a
map, not a cache.

---

## Procedure

### 1. Detect what the project already is

On ADOPT, the architecture is a fact to be read, not a choice to be made.

```bash
ls -d */ internal/ cmd/ pkg/ src/ 2>/dev/null
```

| Evidence | Reads as |
|----------|----------|
| `internal/domain/`, `internal/adapters/`, `ports.go` | hexagonal |
| `handlers/ services/ repositories/` | layered |
| `internal/<context>/` with no cross-imports | modular-monolith or bounded-context |
| `*_event.go`, an event bus, an outbox table | event-driven, transactional-outbox |
| one `docker-compose.yml` per service | microservices |
| `Retry(`, `breaker.`, `context.WithTimeout` | retry, circuit-breaker, timeout |

State what you found and ask for confirmation before pinning it. An inferred
architecture written into the ledger as fact is worse than no entry.

### 2. Pick, do not prescribe

Propose **at most 5** patterns, each with a one-line reason tied to something the
project actually does. Offer them through a multiple-choice question to the user (multi-select) so the
user selects. Patterns nobody selected are not recorded.

Bias toward the smallest set that constrains real decisions. Three enforced
constraints beat twelve decorative ones.

### 3. Write them as constraints

Same format as `constraints.md`, category `architecture`, plus a `Pattern` line
pointing at the doc:

```markdown
### C-012 — Domain has no infrastructure imports
- **Category:** architecture
- **Pattern:** hexagonal — `~/.claude/docs/architectural/hexagonal.md`
- **Rule:** MUST NOT import any package under `internal/adapters/` or a driver
  library from `internal/domain/`; dependencies point inward only.
- **Verify:** `! grep -rE '"(database/sql|github.com/lib/pq|net/http)"' internal/domain/`
- **Origin:** 2026-09-08 — hexagonal layering confirmed during /project setup
```

The rule is what a reviewer can act on; the pattern name alone is not a rule.
"MUST follow hexagonal architecture" fails the falsifiability test — no diff can
be shown to violate it. "MUST NOT import infrastructure from the domain" passes.

### 4. Verifiers that actually work

| Pattern | Verifiable as |
|---------|---------------|
| hexagonal / layered | an import-direction grep, or `go-arch-lint` / `import-linter` / `dependency-cruiser` |
| repository | no SQL string outside `internal/repo/` — `! grep -rlE '\b(SELECT\|INSERT)\b' --include='*.go' internal/ \| grep -v internal/repo/` |
| dto | request/response types carry the project's dto tags (`~/.claude/docs/conventions/dto-tags.md`) |
| retry / timeout | every outbound call takes a `context.Context` with a deadline |
| circuit-breaker | every external client is wrapped — grep the client constructors |
| transactional-outbox | no publish outside the transaction — grep publish calls in the service layer |
| secrets-management | `gitleaks detect --no-git` exits 0 |
| test-containers | integration tests declare a container fixture rather than a live host |
| SOLID / DRY / KISS | **not verifiable** — do not pin these; they are review vocabulary, not constraints |

When no mechanical check exists, use `SHOULD` + `manual: <what a reviewer looks
for>`. Do not invent a command that would not actually fail on a violation — a
verifier that always passes is worse than an honest manual note.

### 5. Feed the rest of the chain

Once pinned:

- `/warmup` loads the ledger with the rest of `CLAUDE.md`.
- `/plan` must produce a design that satisfies every `MUST`, and say which ones
  it touches.
- `/review` cites the constraint ID when a diff violates one.
- A change to a pinned pattern is an architectural decision — supersede the
  constraint **and** write an ADR (`the /adr skill`).

---

## Guardrails

| Action | Status |
|--------|--------|
| Pin a pattern the user did not select | **FORBIDDEN** |
| Record an inferred architecture as confirmed | **FORBIDDEN** — ask first |
| `MUST follow <pattern>` with no falsifiable rule | **FORBIDDEN** |
| A verifier command that cannot fail | **FORBIDDEN** |
| Pin more than 5 architecture constraints in one pass | **FORBIDDEN** — the set stops being read |
| Cite a `~/.claude/docs/` path without checking it exists | **FORBIDDEN** |
