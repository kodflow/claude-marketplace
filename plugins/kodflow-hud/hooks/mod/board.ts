// board.ts — the task board read from tasks.json, and what each task's
// worker is doing. Pure: no `$`, no I/O.
//
// tasks.json (version 2) is kodflow-hooks' file, a contract it shares with
// the status line and lib/epics.jq; this module only reads it. An epic is
// open as the status line counts it: a task left to do, or the agent's active
// epic while it has no task yet. Tasks filed under no epic (epic 0) form one
// more group, "Tâches", as the status line names its pill for them.
//
// A task may also carry the tree's fields (kodflow-hooks writes them only
// once set): `parent`, `blockedBy`, `ref`. A file without them is a flat
// list, every task at the top.

import type {
  HudActivity,
  HudAgent,
  HudBoard,
  HudEpic,
  HudTask,
} from "../../types";
import { safe } from "./paths.ts";

export const MAIN = "main";
export const NO_EPIC_TITLE = "Tâches";
/** What `$.agent.list()` reports for an agent whose loop still stands. */
export const LIVE = new Set(["running", "waiting", "idle"]);

type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string =>
  typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;

/** The pull request URLs a task cites, once each, in order. */
export function prsOf(...texts: string[]): string[] {
  const seen = new Set<string>();
  for (const t of texts) for (const m of t.match(PR_URL) ?? []) seen.add(m);
  return [...seen];
}

function toTask(raw: Obj): HudTask {
  const task: HudTask = {
    id: text(raw.id),
    subject: text(raw.subject),
    status: text(raw.status) || "pending",
    epic: Number.isInteger(raw.epic) ? raw.epic : 0,
    agent: text(raw.agent) || MAIN,
    updated: num(raw.updated) || num(raw.created),
    prs: prsOf(text(raw.subject), text(raw.description)),
  };
  if (raw.worker) task.worker = text(raw.worker);
  if (raw.worker_id) task.workerId = text(raw.worker_id);
  if (raw.assignee) task.assignee = text(raw.assignee);
  if (raw.description) task.description = text(raw.description);
  if (raw.parent) task.parent = text(raw.parent);
  if (Array.isArray(raw.blockedBy)) {
    const ids = raw.blockedBy.map(text).filter((id: string) => id !== "");
    if (ids.length) task.blockedBy = ids;
  }
  if (raw.ref) task.ref = text(raw.ref);
  return task;
}

/** Every task of the file, deleted ones being already gone from it. */
export function parseTasks(raw: unknown): HudTask[] {
  if (!isObj(raw) || !Array.isArray(raw.tasks)) return [];
  return raw.tasks
    .filter((t: unknown) => isObj(t) && Object.hasOwn(t, "id"))
    .map(toTask)
    .filter((t: HudTask) => t.status !== "deleted");
}

/**
 * The board: the open epics, most recently touched first, then the tasks
 * filed under no epic while one of them is left to do.
 */
export function parseBoard(fileText: string | undefined): HudBoard {
  if (fileText === undefined) return { found: false, epics: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    return { found: true, epics: [] };
  }
  const tasks = parseTasks(raw);
  const data: Obj = isObj(raw) ? raw : {};
  const active: Obj = isObj(data.active) ? data.active : {};
  const epics: HudEpic[] = [];
  for (const e of Array.isArray(data.epics) ? data.epics : []) {
    if (!isObj(e) || !Number.isInteger(e.id)) continue;
    const agent = text(e.agent) || MAIN;
    const own = tasks.filter((t) => t.epic === e.id && t.agent === agent);
    const left = own.some((t) => t.status !== "completed");
    const emptyActive = own.length === 0 && active[agent] === e.id;
    if (!left && !emptyActive) continue;
    epics.push({
      id: e.id,
      title: text(e.title),
      agent,
      created: num(e.created) || num(e.touched),
      touched: num(e.touched),
      tasks: own,
    });
  }
  epics.sort((a, b) => b.touched - a.touched);
  const loose = tasks.filter((t) => t.epic === 0);
  if (loose.some((t) => t.status !== "completed"))
    epics.push({
      id: 0,
      title: NO_EPIC_TITLE,
      agent: MAIN,
      created: Math.min(...loose.map((t) => t.updated)),
      touched: 0,
      tasks: loose,
    });
  return { found: true, epics };
}

/** What the board needs from the world to judge a task. */
export type Ctx = {
  /** Milliseconds since the epoch. */
  now: number;
  agents: readonly HudAgent[];
  activity: Readonly<Record<string, HudActivity>>;
  /** How long an in_progress task may stay without activity. */
  silentMs: number;
};

export type Verdict = {
  /** The loop working the task: its worker, else the agent that owns it. */
  loop: string;
  /** That loop's state as `$.agent.list()` gives it; "main" for the main loop. */
  state: string;
  /** The last sign of life: the task's own change or a tool call of the loop. */
  last: number;
  silent: boolean;
  /** Why it is silent: the loop stopped, or nothing happened for too long. */
  why?: "stopped" | "quiet";
};

const findAgent = (agents: readonly HudAgent[], id: string) =>
  agents.find((a) => a.id === id) ??
  agents.find((a) => safe(a.id) === safe(id));

/** The activity recorded for a loop, by its id or its path-safe spelling. */
export function activityOf(
  activity: Readonly<Record<string, HudActivity>>,
  loop: string,
): HudActivity | undefined {
  return (
    activity[loop] ??
    Object.values(activity).find((a) => safe(a.agentId) === safe(loop))
  );
}

/**
 * Who works a task, how that loop stands, and whether the task went silent:
 * in progress with its loop stopped, or with nothing from it for `silentMs`.
 */
export function judge(task: HudTask, ctx: Ctx): Verdict {
  const loop = task.workerId || task.agent;
  const updated = task.updated * 1000;
  const seen = activityOf(ctx.activity, loop)?.last ?? 0;
  const last = Math.max(updated, seen);
  let state = MAIN;
  if (loop !== MAIN) state = findAgent(ctx.agents, loop)?.status ?? "absent";
  const verdict: Verdict = { loop, state, last, silent: false };
  if (task.status !== "in_progress") return verdict;
  // A worker that was named and is gone is the clearest case: nobody is on it
  if (loop !== MAIN && !LIVE.has(state)) {
    verdict.silent = true;
    verdict.why = "stopped";
  } else if (ctx.now - last >= ctx.silentMs) {
    verdict.silent = true;
    verdict.why = "quiet";
  }
  return verdict;
}

/** The label of the loop a task belongs to, for the board's rows. */
export function loopLabel(loop: string, agents: readonly HudAgent[]): string {
  if (loop === MAIN) return "principal";
  return findAgent(agents, loop)?.label ?? loop.slice(0, 8);
}

/** "45s", "3m", "1h02", "2j": how long ago, in the fewest cells. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)}j`;
}
