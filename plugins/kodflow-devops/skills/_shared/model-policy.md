# Model policy — mandatory, and not a plan's to negotiate

Every plan this harness produces carries this allocation, and every agent and
skill of this marketplace pins it in its frontmatter. It is **not a section a
plan may weaken, reword or drop**: a plan that assigns models differently is
rejected and rewritten, the same way a plan with no acceptance criteria is.

The reason it is fixed is that the failure it prevents is invisible. A worker on
too weak a model produces code that looks right, passes a shallow read, and is
found three weeks later. A worker on too strong a model burns quota that nothing
reports. Neither shows in the output.

---

## 1. Resolve, never hardcode

```bash
bash "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}"/skills/_shared/scripts/detect-models.sh
```

**A hardcoded top model is wrong the day a better one ships**, and on the current
release cadence that is weeks. The detector reads what this machine actually has:

| Key | Means |
|-----|-------|
| `CLAUDE_TOP` | the highest model this account may select, from the CLI's own cache — the same list `/model` shows, so it updates itself when access changes. It may be a gated model (§6) |
| `CLAUDE_TOP_UNGATED` | the highest model that is **not** listed in `_shared/gated-models.txt`: the orchestrator's model. When the cache offers none, the alias `opus`, which the CLI resolves to its current Opus |
| `CLAUDE_GATED` | the gated tokens, `|`-joined, as `gated-models.txt` lists them |
| `CLAUDE_PLAN` | the rate-limit tier |
| `CLAUDE_BILLING` | `subscription` or `api-key` — decides what "cost" means, see §5 |
| `CODEX_CLI`, `CODEX_AUTH` | whether the second provider is reachable at all |
| `CODEX_MODEL_MAP_AGE_DAYS` | age of the local OpenAI model map, **which its own header declares drift-prone** |

**Never read the Codex model map as current.** It is a cache. When it is more
than a few days old, confirm the top model against the vendor's docs before
assigning it.

If `CLAUDE_TOP_UNGATED` comes back empty, say so and fall back to the session
model. Do not guess a model id: an invalid one fails the run at the first
dispatch.

---

## 2. The allocation

Effort is the reasoning budget each call is asked to spend (`low`, `medium`,
`high`, `xhigh`, `max`). It is a soft instruction over every output token —
text, tool calls and thinking — and each model has its own scale: Sonnet at
`medium` is not Opus at `medium`.

| Role | Model | Effort | Why this one |
|------|-------|--------|--------------|
| **Orchestrator** (the main session, every skill) | `CLAUDE_TOP_UNGATED` | `high` | It decomposes, routes and synthesises. Reasoning depth belongs in the workers; an orchestrator at `max` mostly deliberates about delegation. A gated model only per §6 |
| **Code worker, well specified** | Sonnet | `medium` | The plan already decided the approach; the worker writes correct, idiomatic, complete code to it |
| **Code worker, defect in existing code** | Sonnet | `high` | Reading code it did not write and finding why it fails takes more than writing to a spec. Hook and mod code is always this row: a guard that fails open in silence is a defect nobody sees |
| **Code worker, several modules, concurrency or a protocol** | Opus | `high` | The work is an invariant held across files or across interleavings, not a function |
| **Review / verify worker** | Opus | `high` | A missed defect costs more than the tokens that would have caught it |
| **Correctness and security executors** | Opus | `xhigh` | Counterexamples and taint paths: the one place where searching longer is the job |
| **Autonomous run over 30 minutes** | Opus | `xhigh` | Long agentic work is what `xhigh` exists for |
| **Mechanical worker** | Sonnet | `low` | Search, extract, classify, per-file transform. The answer is looked up, not reasoned to |
| **Bulk / triage worker** | Haiku | `low` | High volume, shallow judgement, throwaway output |

**Set every worker's model and effort explicitly.** The hazard this policy
exists for is *silent inheritance*: a worker with no model set runs on the
orchestrator's, and one with no effort runs at the session's — `xhigh` included
— with nothing in the output saying so. Every agent of `kodflow-specialists`
pins both in its frontmatter; a dispatch to `general-purpose` or a built-in
agent passes `model` on the call.

That is a rule about explicitness, not about which id appears where. A review
worker that genuinely needs the top model may have it — say so and say why.
What is forbidden is arriving there by omission, and putting the top model on
work a cheaper tier finishes just as correctly.

### On "quality" meaning code, not cleverness

A worker is judged on what it emits, not how interestingly it got there. When
choosing between two tiers for a code-writing role, the question is *which
produces code that needs fewer corrections* — a question only measurement
answers. The Sonnet default for code workers is a **baseline to test** (§4),
not a finding.

---

## 3. Escalation: when a call may override the frontmatter

The Agent tool takes `model` and `effort` per call. The call's values win over
the agent's frontmatter, and the tool honours `effort` only when instructions
explicitly ask for it. **This section is that instruction**, for these cases
only:

| Case | Override |
|------|----------|
| The agent's description says `Escalate to <model>/<effort> when …` and the condition holds | exactly that model and effort |
| A worker at a lower tier failed the same task once (wrong result, not a tool error) | one tier up — Sonnet → Opus, or `medium` → `high` — never two |
| The user names a model or an effort for the work | what the user said |
| A bulk stage the plan sized as Haiku work, dispatched to an agent pinned higher | `model: "haiku"`, `effort: "low"` |

Anything else dispatches with no override: the frontmatter is the decision.
A per-call `model` naming a gated model is refused by the hooks unless §6 holds.

---

## 4. Parallelism: wide on Sonnet, measured on Opus

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

---

## 5. The measurement obligation, and what "cost" means

This allocation is derived from vendor guidance and this machine's constraints.
**It has not been measured on this codebase.** It ships as a starting point with
an obligation attached, not as a tuned result.

What to measure, in order (`kodflow-devops:usage` reads the transcripts):

1. **Cost per completed task, not per request.** A cheaper worker that needs a
   second pass is not cheaper. This is the only number that settles a tier.
2. **Whether the Sonnet code worker needs Opus.** Raise it only where
   measurement shows corrections that the higher tier would have avoided.
3. **Whether a mechanical stage really needs Sonnet.** Several will not.

Take a `/usage` baseline before an allocation change lands and another a week
after, and record both in the project's constraint ledger, so the next plan
inherits the finding instead of re-deriving it.

On a subscription (`CLAUDE_BILLING=subscription`) per-token prices are an
equivalence, not a bill: the binding constraint is the rate limit. Two
consequences:

- **A cache read is roughly an order of magnitude cheaper than fresh input.**
  Anything that invalidates the cached prefix mid-session is expensive in quota.
- **Caches are model-scoped.** A skill pinned to another model re-reads the whole
  conversation uncached, which is why every skill here pins `model: inherit` and
  sets only `effort`. Changing effort keeps the cache on the 5.5 family with
  first-party authentication; on another provider or an older model it may not.
  Skill `effort` has no Codex equivalent: the generated Codex skills drop it.

---

## 6. Gated models

`_shared/gated-models.txt` lists the models that are never reached by default —
today Fable, at two and a half times Opus's price. One token a line; a model is
gated when its id, lower-cased, contains a listed token.

- **No agent pins a gated model.** `validate-frontmatter.py` refuses it.
- **A session reaches it only with the user's yes, once per session.** The
  kodflow-hooks mod asks the first time a dispatch would run on it (a per-call
  `model`, the agent's frontmatter, `CLAUDE_CODE_SUBAGENT_MODEL`, or a parent
  already on it); the yes holds for the rest of that session. Nobody at the
  prompt, the dispatch is refused with the reason.
- **A `/model` the user types is itself the consent**, for that session.
- `KODFLOW_FABLE=allow` lifts the gate, `KODFLOW_FABLE=off` removes it with the
  hooks' other checks still on.

The orchestrator line of a plan therefore names `CLAUDE_TOP_UNGATED`, and names
a gated model only when the user has said so for that work.

---

## 7. Guardrails

| Action | Status |
|--------|--------|
| Hardcode a model id instead of resolving it | **FORBIDDEN** |
| Let a worker inherit the orchestrator's model or the session's effort | **FORBIDDEN** — set both explicitly, every time |
| Put the orchestrator below `CLAUDE_TOP_UNGATED` | **FORBIDDEN** |
| Put anything on a gated model without the user's yes for the session | **FORBIDDEN** (§6) |
| Pin a gated model in an agent's frontmatter | **FORBIDDEN** — CI refuses it |
| Override a call's model or effort outside §3 | **FORBIDDEN** |
| Assign a worker the top model without saying why that role needs it | **FORBIDDEN** — allowed, but never by default |
| Fan out wide on Opus without saying what each worker decides | **FORBIDDEN** |
| Parallel writers without worktree isolation | **FORBIDDEN** |
| Read the local OpenAI model map as current | **FORBIDDEN** — confirm against the docs |
| Present this allocation as measured | **FORBIDDEN** — it is a starting point (§5) |
| Weaken, reword or omit this section in a plan | **FORBIDDEN** — the plan is rejected |
