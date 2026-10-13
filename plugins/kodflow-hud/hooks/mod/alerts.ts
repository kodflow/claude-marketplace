// alerts.ts — which tasks deserve a toast now. Pure.
//
// Three states are news: a task completed, a task blocked (waiting), a task
// gone silent. Each is toasted at most once per task, keyed
// `<session>:<task>:<state>`, the keys kept in `$.state` so a reload of the
// module does not toast them again. The first board read in a session is the
// baseline: what stands then is recorded without a toast, so opening a
// session full of finished work does not fire a volley of them.

import type { HudTask } from "../../types";
import { judge, type Ctx } from "./board.ts";

export type Alert = { key: string; text: string };

/** The news state of a task, if it is in one. */
export function newsOf(
  task: HudTask,
  ctx: Ctx,
): "done" | "waiting" | "silent" | undefined {
  if (task.status === "completed") return "done";
  if (task.status === "waiting") return "waiting";
  if (judge(task, ctx).silent) return "silent";
  return undefined;
}

function line(task: HudTask, state: string, ctx: Ctx): string {
  const head = `#${task.id} ${task.subject}`;
  if (state === "done") return `${head} : terminée`;
  if (state === "waiting") return `${head} : bloquée, en attente`;
  const v = judge(task, ctx);
  return v.why === "stopped"
    ? `${head} : silencieuse, son worker est arrêté`
    : `${head} : silencieuse, aucune activité depuis ${Math.round(ctx.silentMs / 60000)} min`;
}

/**
 * The alerts to raise and the keys to record. With `baseline`, every key is
 * recorded and nothing is raised.
 */
export function alertsFor(
  session: string,
  tasks: readonly HudTask[],
  ctx: Ctx,
  toasted: ReadonlySet<string>,
  baseline: boolean,
): { alerts: Alert[]; keys: string[] } {
  const alerts: Alert[] = [];
  const keys: string[] = [];
  for (const task of tasks) {
    const state = newsOf(task, ctx);
    if (!state) continue;
    const key = `${session}:${task.id}:${state}`;
    if (toasted.has(key)) continue;
    keys.push(key);
    if (!baseline) alerts.push({ key, text: line(task, state, ctx) });
  }
  return { alerts, keys };
}

/** Keep the recorded keys bounded: the newest `max`. */
export const trimKeys = (keys: readonly string[], max = 500): string[] =>
  keys.length > max ? keys.slice(keys.length - max) : [...keys];
