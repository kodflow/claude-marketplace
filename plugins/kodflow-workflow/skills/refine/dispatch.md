# refine/dispatch.md — Skills Architecture v1.5 (PR3, fix #17)

> **v1.6 note:** this phase is FULL-mode only. BARE and FROM-CONTRACT skip lens dispatch entirely — they jump straight to the synthesis pipeline (which itself adapts to the mode). The single-source-of-truth char-cap logic in `synthesis.md` is what BARE and FROM-CONTRACT reuse without reimplementing it. The char-cap is always 4000; lens depth (4 critical vs all 10) is independent.

## Lenses (10)

| Phase | Critical? | Default agent | Effort |
|---|---|---|---|
| `lens-1-correctness`  | yes | developer-executor-correctness   | xhigh  |
| `lens-2-security`     |     | developer-executor-security      | high   |
| `lens-3-edge-cases`   |     | developer-executor-correctness   | high   |
| `lens-4-rollback`     |     | devops-executor-linux            | medium |
| `lens-5-testability`  | yes | developer-executor-quality       | high   |
| `lens-6-dependency`   |     | devops-specialist-security       | medium |
| `lens-7-performance`  |     | developer-executor-design        | high   |
| `lens-8-observability`|     | developer-executor-shell         | medium |
| `lens-9-scope`        | yes | developer-orchestrator           | medium |
| `lens-10-goal-detect` | yes | developer-specialist-review      | high   |

Light depth runs only critical lenses (1, 5, 9, 10). Full depth runs all 10.
Char-cap stays 4000 in both cases.

## Dispatch sequence

```bash
# 1. Try router
ROUTER=~/.claude/scripts/route-agent.sh
DISPATCH=$(bash "$ROUTER" --skill /refine --phase "$LENS" --profile "$PROFILE")
RC=$?

# 2. Router exit 0 or 10 → use returned dispatch JSON
# 3. Router exit 20-31 → static fallback (fix #17)
if [ "$RC" -ge 20 ] && [ "$RC" -le 31 ]; then
  source ~/.claude/scripts/refine-static-fallback.sh
  DISPATCH=$(refine_static_lens "$LENS")
  [ -z "$DISPATCH" ] && {
    # Drop lens; annotate telemetry
    echo "{\"lens\":\"$LENS\",\"dropped\":true}" >> ~/.claude/logs/refine-dropped-lenses.jsonl
    continue
  }
fi

# 4. Hand off to actual agent invocation (Task or Agent primitive)
```

## Router-independence invariant

Critical lenses (1, 5, 9, 10) MUST reach the agent invocation step even
when `route-agent.sh` returns exit 20-31. This is enforced by the static
fallback above and verified by `TestRefineFallsBackToStaticWhenRouterErrors`.

## Refine pipeline (post-lens, 3 passes)

> **skills-cleanup C4:** the ten mono-concern `refine-*` labels collapsed onto the
> **3 real agents** they always routed to (quality ×N, orchestrator ×N, correctness ×N
> — "label theater" removed). Behaviour is unchanged; the three passes carry the same
> concerns, ordered and causal.

After lens findings are collected (FULL mode only — BARE and FROM-CONTRACT skip
lenses entirely), synthesis runs a **second**, ordered pipeline of three passes.
Each pass's output feeds the next; no pass runs before its inputs exist.

| # | Pass | Agent | Concerns merged |
|---|---|---|---|
| 1 | `refine-correctness-pass` | `developer-executor-correctness` | constraint distillation, binary done-criteria, producer→consumer sequence validation |
| 2 | `refine-scope-pass` | `developer-orchestrator` | scope fencing (no creep / no amputation) + escalation isolation (manual verifiers, ADR triggers) |
| 3 | `refine-density-pass` | `developer-executor-quality` | content pruning, verifier binding (1:1), imperative rewrite, auto-chain stripping, and final density compression — **MUST run last**, any earlier compression destroys structure |

Pipeline invariants (locked by `refine-pipeline-rewire.bats`):

- Order is fixed (1 → 3); each pass is causal (producer before consumer).
- `refine-density-pass` is **always** the terminal step.
- BARE and FROM-CONTRACT skip pass 1-2 (no lens findings); pass 3 still runs on
  the rendered directive.

### Static fallback (refine-* pipeline)

If `route-agent.sh` cannot resolve a `refine-*` pass, fall back to the static map
in `refine-static-fallback.sh` — the same three passes, bit-identical agent
mappings, so router-success and fallback are interchangeable.
