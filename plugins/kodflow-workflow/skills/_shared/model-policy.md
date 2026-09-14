# Model policy — mandatory, and not a plan's to negotiate

Every plan this harness produces carries this allocation. It is **not a section
a plan may weaken, reword or drop**: a plan that assigns models differently is
rejected and rewritten, the same way a plan with no acceptance criteria is.

The reason it is fixed is that the failure it prevents is invisible. A worker on
too weak a model produces code that looks right, passes a shallow read, and is
found three weeks later. Nothing in the run reports it.

---

## 1. Resolve, never hardcode

```bash
bash ~/.claude/skills/_shared/scripts/detect-models.sh
```

**A hardcoded top model is wrong the day a better one ships**, and on the current
release cadence that is weeks. The detector reads what this machine actually has:

| Key | Means |
|-----|-------|
| `CLAUDE_TOP` | the highest model this account may select, from the CLI's own cache — the same list `/model` shows, so it updates itself when access changes |
| `CLAUDE_PLAN` | the rate-limit tier |
| `CLAUDE_BILLING` | `subscription` or `api-key` — decides what "cost" means, see §5 |
| `CODEX_CLI`, `CODEX_AUTH` | whether the second provider is reachable at all |
| `CODEX_MODEL_MAP_AGE_DAYS` | age of the local OpenAI model map, **which its own header declares drift-prone** |

**Never read the Codex model map as current.** It is a cache. When it is more
than a few days old, confirm the top model against the vendor's docs before
assigning it — that map was 21 days old and did not know about the model
released five days earlier.

If `CLAUDE_TOP` comes back empty, say so and fall back to the session model. Do
not guess a model id: an invalid one fails the run at the first dispatch.

---

## 2. The allocation

| Role | Model | Effort | Why this one |
|------|-------|--------|--------------|
| **Orchestrator** | `CLAUDE_TOP` (today `claude-fable-5-1`; `gpt-6-astra` on the Codex side) | `high` | It decomposes, routes and synthesises. Reasoning depth belongs in the workers; an orchestrator at `max` mostly deliberates about delegation. |
| **Code worker** | Opus | `high` | The code is the product. Quality here is not "clever approach", it is *correct, idiomatic, complete* output. |
| **Review / verify worker** | Opus | `xhigh` | A missed defect costs more than the tokens that would have caught it. This is the one role where paying up is straightforwardly right. |
| **Mechanical worker** | Sonnet | `low`–`medium` | Search, extract, classify, per-file transform. The answer is looked up, not reasoned to. |
| **Bulk / triage worker** | Haiku | `low` | High volume, shallow judgement, throwaway output. |

**Set every worker's model explicitly.** The hazard this policy exists for is
*silent inheritance*: a worker with no model set runs on the orchestrator's,
which on a top-tier orchestrator means the whole swarm at the top rate with
nothing in the output saying so.

That is a rule about explicitness, not about which id appears where. A review
worker that genuinely needs the top model may have it — say so and say why.
What is forbidden is arriving there by omission, and putting the top model on
work a cheaper tier finishes just as correctly.

### On "quality" meaning code, not cleverness

A worker is judged on what it emits, not how interestingly it got there. When
choosing between two tiers for a code-writing role, the question is *which
produces code that needs fewer corrections* — a question only measurement
answers.

The code worker starts a tier below the orchestrator as a **baseline to test**,
not as a finding. The reasoning behind it — that past some point extra
deliberation changes the approach rather than the output, and a plan already
debated does not want its approach changed — is a hypothesis. It is stated here
so it can be refuted, and §4 says how. Do not repeat it as established.

---

## 3. Parallelism: wide on Sonnet, measured on Opus

**Sonnet fans out freely.** A mechanical stage over 20 files is 20 Sonnet workers
at `low`. There is no reason to serialise work whose per-item answer is
independent, and the concurrency cap is the real limit.

**Opus fans out deliberately.** Effort multiplies per worker, so a 10-wide Opus
`xhigh` stage costs an order of magnitude more than the same stage on Sonnet
`low` — for work that may not repay it. Before a wide Opus stage, state what
each worker will decide that a Sonnet worker could not.

**Worktrees where workers write.** Parallel agents editing the same tree
conflict, and the conflict surfaces as a corrupted result rather than an error.
`isolation: "worktree"` gives each its own checkout — it costs setup time and
disk, so use it exactly when workers mutate files concurrently, and not for
read-only fan-out.

A worker inherits the orchestrator's model unless told otherwise. **On a top-tier
orchestrator that is the single most expensive mistake available here**: every
worker silently runs at the top rate. Set the model on every worker, always.

---

## 4. The measurement obligation

This allocation is derived from vendor guidance and this machine's constraints.
**It has not been measured on this codebase.** It ships as a starting point with
an obligation attached, not as a tuned result — claiming otherwise would be the
same unverified-assertion failure the specialists are told to avoid.

What to measure, in order:

1. **Cost per completed task, not per request.** A cheaper worker that needs a
   second pass is not cheaper. This is the only number that settles a tier.
2. **Whether the code worker at `high` needs `xhigh`.** Raise it only where
   measurement shows corrections that the higher effort would have avoided.
3. **Whether a mechanical stage really needs Sonnet.** Several will not.

Record what you measure in the project's constraint ledger, so the next plan
inherits the finding instead of re-deriving it.

---

## 5. What "cost" means here

`CLAUDE_BILLING=subscription` and `CODEX_BILLING=subscription` on this machine:
both sides are plan-based, not metered.

**So per-token prices are an equivalence, not a bill.** The binding constraint on
a swarm is the rate limit — how fast it burns quota — and the per-token figures
matter only as a proxy for that. Optimising a dollar number nobody is charged
is the wrong target; optimising *how much work fits before the limit* is the
right one.

Two consequences worth holding:

- **A cache read is roughly an order of magnitude cheaper than fresh input.**
  Anything that invalidates the cached prefix mid-session is expensive in quota,
  not just in money.
- **Caches are model-scoped.** A mixed orchestrator/worker allocation forfeits
  cache reuse across the tiers. That is an accepted cost here — workers start
  from fresh context anyway — but it is a real argument against splitting a
  *single* conversation across models.

---

## 6. Guardrails

| Action | Status |
|--------|--------|
| Hardcode a model id instead of resolving it | **FORBIDDEN** |
| Let a worker inherit the orchestrator's model | **FORBIDDEN** — set it explicitly, every time |
| Put the orchestrator on anything below `CLAUDE_TOP` | **FORBIDDEN** |
| Assign a worker the top model without saying why that role needs it | **FORBIDDEN** — allowed, but never by default |
| Fan out wide on Opus without saying what each worker decides | **FORBIDDEN** |
| Parallel writers without worktree isolation | **FORBIDDEN** |
| Read the local OpenAI model map as current | **FORBIDDEN** — confirm against the docs |
| Present this allocation as measured | **FORBIDDEN** — it is a starting point (§4) |
| Weaken, reword or omit this section in a plan | **FORBIDDEN** — the plan is rejected |
