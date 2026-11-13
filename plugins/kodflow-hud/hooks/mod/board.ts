// board.ts — the task board read from tasks.json, and what each task's
// worker is doing. Pure: no `$`, no I/O.
//
// tasks.json (version 2) is kodflow-hooks' file, a contract it shares with
// lib/epics.jq and /recap; this module only reads it. The board is the main
// agent's: an epic is open while it is not closed (`closed_at`, task_focus
// close=true) and has a task left to do, or is the active epic while it has
// no task yet; it stays listed 30 minutes after its last task was done, so
// what was opened and closed in seconds is still seen. Epics come in the
// order they were opened, the active one marked, never moved. The main
// agent's tasks filed under no epic (epic 0) form one more group, « Hors
// épopée », with no number (its id is 0): the pane's tab already says
// « Tâches », so the group does not say it again.
//
// A subagent's own tasks are no epic of theirs: they hang under the task the
// subagent was handed (its `workers`, tree.ts), and those of a task in a
// closed epic are hidden with it. A subagent's task left open by an agent
// that is no longer live is an orphan: counted, toasted when it was in
// progress, never drawn. The predicates (`closed`, `idle`, `orphan`) are
// the ones kodflow-hooks holds in tasks.ts and lib/epics.jq, against the
// same fixture (tests/epic-predicates.ts, generated from kodflow-hooks').
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
export const NO_EPIC_TITLE = "Hors épopée";
/** How long an epic with nothing left to do stays on the board after its last task was done. */
export const KEEP_DONE_MS = 30 * 60_000;
/** What `$.agent.list()` reports for an agent whose loop still stands. */
export const LIVE = new Set(["running", "waiting", "idle"]);
/** A loop whose standing could not be read: never silent, never stopped. */
export const UNKNOWN = "unknown";
/** An epic with nothing moving for this long is idle (seconds). */
export const IDLE_AFTER = 24 * 3600;

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
  if (Array.isArray(raw.workers)) {
    const ids = [
      ...new Set(raw.workers.map(text).filter((w: string) => w !== "")),
    ] as string[];
    if (ids.length) task.workers = ids;
  }
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
 * Closed by task_focus(close=true): `closed_at` a finite number above 0.
 * Anything else (absent, null, 0, a string, true, -1, 1e999) is open.
 */
export function closed(epic: unknown): boolean {
  const c = isObj(epic) ? epic.closed_at : undefined;
  return typeof c === "number" && Number.isFinite(c) && c > 0;
}

/**
 * Idle: nothing touched the epic or its tasks for 24 h (`now` in seconds),
 * no task of it in progress on a live worker (`live`: agent ids), and none
 * of the person's waiting in it. Closed or not is the caller's to weigh.
 */
export function idle(
  epic: Obj,
  tasks: readonly unknown[],
  now: number,
  live: readonly string[],
): boolean {
  const agent = text(epic.agent) || MAIN;
  const own = tasks.filter(
    (t): t is Obj =>
      isObj(t) &&
      (text(t.agent) || MAIN) === agent &&
      (Number.isInteger(t.epic) ? t.epic : 0) === epic.id,
  );
  const last = Math.max(num(epic.touched), ...own.map((t) => num(t.updated)));
  if (now - last <= IDLE_AFTER) return false;
  if (
    own.some(
      (t) => t.status === "in_progress" && live.includes(text(t.worker_id)),
    )
  )
    return false;
  return !own.some((t) => t.status === "waiting" && t.assignee === "human");
}

/**
 * A subagent's task left open by an agent no longer live: `live` the agent
 * ids `$.agent.list()` says stand (undefined when it could not be read:
 * nothing is an orphan then).
 */
export function orphan(
  task: { agent?: unknown; status?: unknown },
  live: readonly string[] | undefined,
): boolean {
  const agent = text(task.agent) || MAIN;
  if (!live || agent === MAIN) return false;
  if (task.status === "completed" || task.status === "deleted") return false;
  return !live.some((id) => id === agent || safe(id) === agent);
}

/**
 * The task a worker's own tasks hang under: of the main agent's tasks that
 * name it in `workers`, the one in progress, else the most recently updated.
 */
export function anchorOf(
  tasks: readonly HudTask[],
  worker: string,
): HudTask | undefined {
  const holding = tasks.filter(
    (t) =>
      t.agent === MAIN &&
      (t.workers ?? []).some((w) => w === worker || safe(w) === worker),
  );
  return (
    holding.find((t) => t.status === "in_progress") ??
    [...holding].sort((a, b) => b.updated - a.updated)[0]
  );
}

/**
 * Whether a group with nothing left to do is still shown: its last task was
 * done less than `KEEP_DONE_MS` ago. A completed task's `updated` (seconds)
 * is when it was done, kodflow-hooks stamping it on the status change. With
 * no clock given the board is what it was: finished groups go at once.
 */
function justDone(tasks: readonly HudTask[], now: number | undefined): boolean {
  if (now === undefined || tasks.length === 0) return false;
  const last = Math.max(...tasks.map((t) => t.updated));
  return last > 0 && now - last * 1000 < KEEP_DONE_MS;
}

/**
 * The board: the main agent's open epics in the order they were opened (the
 * active one marked), then the tasks filed under no epic while one of them
 * is left to do. With `now` (ms), an epic or the group under no epic whose
 * last task was done less than 30 minutes ago is kept too, and an epic
 * idle for 24 h is marked so. `live` (agent ids, undefined when unknown)
 * marks the subagents' tasks whose agent no longer stands.
 */
export function parseBoard(
  fileText: string | undefined,
  now?: number,
  live?: readonly string[],
): HudBoard {
  if (fileText === undefined) return { found: false, epics: [], helpers: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch {
    return { found: true, epics: [], helpers: [] };
  }
  const tasks = parseTasks(raw);
  const data: Obj = isObj(raw) ? raw : {};
  const rawTasks: unknown[] = Array.isArray(data.tasks) ? data.tasks : [];
  const active: Obj = isObj(data.active) ? data.active : {};
  const epics: HudEpic[] = [];
  const shut = new Set<number>();
  for (const e of Array.isArray(data.epics) ? data.epics : []) {
    if (!isObj(e) || !Number.isInteger(e.id)) continue;
    const agent = text(e.agent) || MAIN;
    if (agent !== MAIN) continue;
    if (closed(e)) {
      shut.add(e.id);
      continue;
    }
    const own = tasks.filter((t) => t.epic === e.id && t.agent === agent);
    const left = own.some((t) => t.status !== "completed");
    const isActive = active[agent] === e.id;
    const emptyActive = own.length === 0 && isActive;
    if (!left && !emptyActive && !justDone(own, now)) continue;
    const epic: HudEpic = {
      id: e.id,
      title: text(e.title),
      agent,
      created: num(e.created) || num(e.touched),
      touched: num(e.touched),
      tasks: own,
    };
    if (isActive) epic.active = true;
    if (
      now !== undefined &&
      left &&
      idle(e, rawTasks, Math.floor(now / 1000), live ?? [])
    )
      epic.idle = true;
    epics.push(epic);
  }
  // In the order they were opened: a new epic goes last, nothing moves
  epics.sort((a, b) => a.created - b.created || a.id - b.id);
  const loose = tasks.filter((t) => t.epic === 0 && t.agent === MAIN);
  if (loose.some((t) => t.status !== "completed") || justDone(loose, now))
    epics.push({
      id: 0,
      title: NO_EPIC_TITLE,
      agent: MAIN,
      created: Math.min(...loose.map((t) => t.updated)),
      touched: 0,
      tasks: loose,
    });
  // A subagent's tasks, unless the task it was handed sits in a closed epic
  const helpers: (HudTask & { stopped?: boolean })[] = [];
  for (const t of tasks) {
    if (t.agent === MAIN) continue;
    const anchor = anchorOf(tasks, t.agent);
    if (anchor && shut.has(anchor.epic)) continue;
    helpers.push(orphan(t, live) ? { ...t, stopped: true } : t);
  }
  return { found: true, epics, helpers };
}

/**
 * What is shown and counted: the tasks of the board's epics, and the
 * subagents' tasks that are not orphans (all of them when the liveness was
 * not read). The CI, the tab's count and the toasts read this.
 */
export function visibleTasks(board: HudBoard): HudTask[] {
  return [
    ...board.epics.flatMap((e) => e.tasks),
    ...(board.helpers ?? []).filter((t) => !t.stopped),
  ];
}

/** What the board needs from the world to judge a task. */
export type Ctx = {
  /** Milliseconds since the epoch. */
  now: number;
  agents: readonly HudAgent[];
  activity: Readonly<Record<string, HudActivity>>;
  /** How long an in_progress task may stay without activity. */
  silentMs: number;
  /**
   * "unknown" when `$.agent.list()` could not be read: a subagent's loop is
   * then neither silent nor stopped, its state "unknown".
   */
  liveness?: "unknown";
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
  if (loop !== MAIN)
    state =
      ctx.liveness === UNKNOWN
        ? UNKNOWN
        : (findAgent(ctx.agents, loop)?.status ?? "absent");
  const verdict: Verdict = { loop, state, last, silent: false };
  // Nobody can say whether that loop stands: no verdict on it
  if (task.status !== "in_progress" || state === UNKNOWN) return verdict;
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
