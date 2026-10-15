// models.ts — what each loop runs on, and who worked each task. Pure.
//
// The tree's model·effort column shows only what the session said, from
// three places, the later filling what the earlier left out:
//   agent-models.tsv  kodflow-hooks' record of every Agent call (its
//                     PostToolUse: agent id, resolvedModel, the call's
//                     effort, the type), read for the loops started before
//                     this module loaded;
//   agent.spawn       the model core resolved for the subagent it started;
//   tool.call Agent   the call's `effort` and the result's resolvedModel.
// The main loop's model is `$.session.model()`; its effort is said nowhere
// a hooks module reads, so it stays absent. Nothing is guessed: a loop no
// source names has an empty cell.

import type { HudModel, HudSeen, HudTask } from "../../types";

/** Fields of `b` that are set win over `a`'s. */
export function merge(a: HudModel | undefined, b: HudModel): HudModel {
  const out: HudModel = { ...a };
  if (b.model) out.model = b.model;
  if (b.effort) out.effort = b.effort;
  return out;
}

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/** agent-models.tsv: `agentId \t resolvedModel \t effort \t type`, latest last. */
export function parseModels(
  text: string | undefined,
): Record<string, HudModel> {
  const out: Record<string, HudModel> = {};
  for (const line of (text ?? "").split("\n")) {
    const [id, model, effort] = line.split("\t");
    if (!id) continue;
    out[id] = merge(out[id], {
      ...(model && { model }),
      ...(effort && { effort }),
    });
  }
  return out;
}

/** What an Agent call says of the loop it started: its id, model, effort. */
export function fromAgentCall(
  input: { effort?: unknown },
  result: unknown,
): { id: string; model: HudModel } | undefined {
  const r = (result ?? {}) as { agentId?: unknown; resolvedModel?: unknown };
  const id = str(r.agentId);
  if (!id) return undefined;
  const model: HudModel = {};
  const m = str(r.resolvedModel);
  const effort = str(input.effort);
  if (m) model.model = m;
  if (effort) model.effort = effort;
  return { id, model };
}

/**
 * The worker of every task in progress, added to what was seen before:
 * tasks.json drops the link when a task leaves in_progress, the tree still
 * names who did it. Undefined when nothing changed.
 */
export function seenFrom(
  tasks: readonly HudTask[],
  before: Readonly<Record<string, HudSeen>>,
): Record<string, HudSeen> | undefined {
  let out: Record<string, HudSeen> | undefined;
  for (const t of tasks) {
    if (t.status !== "in_progress" || !(t.worker || t.workerId)) continue;
    const key = `${t.agent}:${t.id}`;
    const was = before[key];
    if (was?.worker === t.worker && was?.workerId === t.workerId) continue;
    out ??= { ...before };
    out[key] = {
      ...(t.worker && { worker: t.worker }),
      ...(t.workerId && { workerId: t.workerId }),
    };
  }
  return out;
}
