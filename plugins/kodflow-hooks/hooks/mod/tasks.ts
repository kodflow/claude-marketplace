// tasks.ts — the session task list, one list per agent. Pure: no `$`, no I/O.
//
// Tasks are grouped in epics, one per subject. An agent can have several epics
// open at once; one of them is active (the one being worked on). Every task
// names its epic when it is created — there is no default. The file format
// (tasks.json, version 2) is a contract shared with the status line and the
// shell hooks (lib/epics.jq), which read it directly.
//
// This is a line-for-line port of the former mcp/tasks.py: same messages, same
// order of validation, timestamps in seconds, lengths in code points. The
// conformance corpus (tests/mod/conformance.corpus.ts), recorded from tasks.py,
// holds it to that.
//
// One tool came after the port: task_assign_human files a task only the user
// can do (a "go", a Touch ID, a gesture on a NAS). It is a task like the
// others, with `assignee: "human"` and the status `waiting`, so the readers
// of tasks.json that know nothing of the field still count it right.

export const MAX_SUBJECT = 40;
export const MAX_TITLE = 20;
export const STATUSES = [
  "pending",
  "in_progress",
  "waiting",
  "completed",
  "deleted",
] as const;
export const MAIN = "main";
/** `assignee` of a task only the user can do (task_assign_human). */
export const HUMAN = "human";
/** At most this many of them open at once: a queue nobody reads is noise. */
export const MAX_HUMAN_OPEN = 5;

/** A refusal the caller reads: the tool answers `{ deny: message }`. */
export class TaskError extends Error {
  readonly kind = "task-error";
}

export function isTaskError(err: unknown): err is TaskError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { kind?: unknown }).kind === "task-error"
  );
}

type Obj = Record<string, any>;
export type Data = Obj & {
  version: 2;
  next_id: number;
  next_epic: number;
  epics: Obj[];
  active: Record<string, any>;
  tasks: Obj[];
};

/** A subagent of the session, as the caller resolved it. */
export type Worker = {
  id: string;
  type: string;
  name?: string;
  alive: boolean;
  started?: number;
};

/** What a step reads from the world: the time in seconds, the subagents. */
export type Ctx = { now: number; workers: readonly Worker[] };

// --- Python semantics the port depends on -----------------------------------

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v);
// dict.get(key, default): a key present with null keeps null
const get = (o: Obj, k: string, d: unknown): any =>
  Object.hasOwn(o, k) ? o[k] : d;
// `x or y`
const truthy = (v: unknown): boolean =>
  !(
    v === undefined ||
    v === null ||
    v === false ||
    v === 0 ||
    v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (isObj(v) && Object.keys(v).length === 0)
  );
const or = <T>(v: unknown, d: T): any => (truthy(v) ? v : d);

/** str(value) for the JSON values a tool call can carry. */
export function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

// str.strip(): Python's whitespace, not JavaScript's (\x1c-\x1f in, ﻿ out)
const WS =
  "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP = new RegExp(`^[${WS}]+|[${WS}]+$`, "gu");
export const strip = (s: string): string => s.replace(STRIP, "");

/** len(): code points, not UTF-16 units. */
export const codePoints = (s: string): number => [...s].length;

// --- the file ----------------------------------------------------------------

/**
 * Bring a tasks.json of any earlier shape to version 2, in memory.
 *
 * v1 kept one epic per agent, {"<agent>": {"id", "title"}}; v2 keeps a list
 * of epics, several open at once, and the agent's active one in `active`.
 * The file is rewritten in v2 by the next mutation.
 */
export function upgrade(raw: unknown, now: number): Data {
  const data: Obj = isObj(raw) ? raw : {};
  let epics: any = data.epics;
  const active: Obj = isObj(data.active) ? data.active : {};
  if (isObj(epics)) {
    const converted: Obj[] = [];
    for (const [agent, epic] of Object.entries(epics)) {
      if (isObj(epic) && isInt(epic.id)) {
        converted.push({
          id: epic.id,
          agent,
          title: pyStr(or(epic.title, "")),
          created: now,
          touched: now,
        });
        active[agent] = epic.id;
      }
    }
    epics = converted;
  }
  if (!Array.isArray(epics)) epics = [];
  epics = epics.filter((e: unknown) => isObj(e) && isInt(e.id));
  let tasks: any[] = Array.isArray(data.tasks) ? data.tasks : [];
  tasks = tasks.filter((t) => isObj(t) && Object.hasOwn(t, "id"));
  for (const task of tasks) {
    task.id = pyStr(task.id);
    if (!Object.hasOwn(task, "agent")) task.agent = MAIN;
    if (!Object.hasOwn(task, "status")) task.status = "pending";
    if (!Object.hasOwn(task, "subject")) task.subject = "";
    if (!isInt(task.epic)) task.epic = 0;
  }
  const ids: number[] = epics.map((e: Obj) => e.id);
  const highest = ids.length ? Math.max(...ids) : 0;
  Object.assign(data, {
    version: 2,
    next_id: isInt(data.next_id) ? data.next_id : 1,
    next_epic: Math.max(
      isInt(data.next_epic) ? data.next_epic : 1,
      highest + 1,
    ),
    epics,
    active,
    tasks,
  });
  return data as Data;
}

/** Parse the file's text; anything unreadable is an empty list. */
export function parse(text: string | undefined, now: number): Data {
  let raw: unknown = {};
  if (text !== undefined) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = {};
    }
  }
  return upgrade(raw, now);
}

/** The file's text, as tasks.py wrote it (indent 1, UTF-8 kept). */
export const serialize = (data: Data): string => JSON.stringify(data, null, 1);

// --- validation ----------------------------------------------------------------

function checkText(
  value: unknown,
  what: string,
  limit: number,
  hint: string,
): string {
  const v = strip(pyStr(or(value, "")));
  if (!v) throw new TaskError(`${what} is required`);
  const n = codePoints(v);
  if (n > limit)
    throw new TaskError(
      `${what} is ${n} characters, the limit is ${limit}: ${hint}`,
    );
  return v;
}

const checkSubject = (subject: unknown): string =>
  checkText(
    subject,
    "subject",
    MAX_SUBJECT,
    "it is shown in full on the status line. Shorten it to an imperative title " +
      "and move the detail to description.",
  );

const checkTitle = (title: unknown): string =>
  checkText(
    title,
    "title",
    MAX_TITLE,
    "it is the label of a pill on the status line. Use a short noun phrase " +
      '("SDK status-line", "api-gateway").',
  );

// --- epics ---------------------------------------------------------------------

const agentEpics = (data: Data, agent: string): Obj[] =>
  data.epics.filter((e) => get(e, "agent", MAIN) === agent);

function findEpic(data: Data, agent: string, epicId: unknown): Obj | undefined {
  return agentEpics(data, agent).find((e) => e.id === epicId);
}

/** The id of the agent's active epic, 0 when it has none. */
function activeEpic(data: Data, agent: string): any {
  const epicId = get(data.active, agent, 0);
  return findEpic(data, agent, epicId) ? epicId : 0;
}

const tasksOf = (data: Data, agent: string, epicId: unknown): Obj[] =>
  data.tasks.filter(
    (t) => get(t, "agent", MAIN) === agent && get(t, "epic", 0) === epicId,
  );

function progress(
  data: Data,
  agent: string,
  epicId: unknown,
): [number, number] {
  const tasks = tasksOf(data, agent, epicId);
  return [tasks.filter((t) => t.status === "completed").length, tasks.length];
}

/** Open: a task not completed, or the active epic with no task yet. */
function isOpen(data: Data, agent: string, epic: Obj): boolean {
  const [done, total] = progress(data, agent, epic.id);
  return done < total || (total === 0 && activeEpic(data, agent) === epic.id);
}

/** The agent's open epics, most recently touched first. */
function openEpics(data: Data, agent: string): Obj[] {
  return agentEpics(data, agent)
    .filter((e) => isOpen(data, agent, e))
    .sort((a, b) => get(b, "touched", 0) - get(a, "touched", 0));
}

function touch(data: Data, agent: string, epicId: unknown, now: number): void {
  const epic = findEpic(data, agent, epicId);
  if (epic) epic.touched = now;
}

function parseEpicId(value: unknown): number | null {
  const text = strip(pyStr(value)).replace(/^#+/, "");
  return /^[0-9]+$/.test(text) ? parseInt(text, 10) : null;
}

function describeOpen(data: Data, agent: string): string {
  const epics = openEpics(data, agent);
  if (epics.length === 0) return "no epic is open";
  const active = activeEpic(data, agent);
  return (
    "open epics: " +
    epics
      .map((e) => `#${e.id} ${e.title}${e.id === active ? " (active)" : ""}`)
      .join(", ")
  );
}

const EPIC_SYNTAX =
  "task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside " +
  "any epic; task_epic(title) opens a new epic first.";

// --- workers ---------------------------------------------------------------------

/** A worker is named by its agent id, its SendMessage name or its type. */
const matches = (w: Worker, name: string): boolean =>
  name === w.id || name === (w.type || "") || (!!w.name && name === w.name);

/**
 * Whether the worker linked to a task is still running, by its recorded id
 * alone: an agent resumed by SendMessage keeps its id (measured on 2.1.296).
 */
function workerAlive(workers: readonly Worker[], task: Obj): boolean {
  const entry = workers.find((w) => w.id === (task.worker_id || ""));
  return entry !== undefined && entry.alive;
}

function since(started: number, now: number): string {
  const minutes = Math.max(
    0,
    Math.floor(Math.trunc(now - (started || 0)) / 60),
  );
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`
    : `${minutes} min`;
}

/** Who is counted: the running workers, and who holds each task in progress. */
function workersReport(ctx: Ctx, data: Data, agent: string): string {
  const live = ctx.workers
    .filter((w) => w.alive)
    .map((w, i) => [w, i] as const)
    .sort(([a, i], [b, j]) => (a.started || 0) - (b.started || 0) || i - j)
    .map(([w]) => w);
  const lines = [
    "Running subagents: " +
      (live
        .map((w) =>
          w.started === undefined
            ? `${w.type || "?"} (id ${w.id})`
            : `${w.type || "?"} (id ${w.id}, for ${since(w.started, ctx.now)})`,
        )
        .join(", ") || "none"),
  ];
  for (const t of data.tasks) {
    if (get(t, "agent", MAIN) !== agent || t.status !== "in_progress") continue;
    if (truthy(t.worker)) {
      lines.push(
        `#${t.id} ${t.subject}: worker ${t.worker} (${workerAlive(ctx.workers, t) ? "running" : "STOPPED"})`,
      );
    } else {
      lines.push(`#${t.id} ${t.subject}: no worker linked`);
    }
  }
  return lines.join("\n");
}

/** Resolve the worker a task is handed to; refuse a stopped or busy one. */
function claimWorker(
  ctx: Ctx,
  data: Data,
  agent: string,
  taskId: string,
  worker: string,
): string {
  const named = ctx.workers.filter((w) => matches(w, worker));
  const running = named.filter((w) => w.alive);
  const unblock =
    "Name a running subagent (its type or id, listed above) with worker=, or start one for this task " +
    "first; a task nobody runs stays pending.";
  if (running.length === 0) {
    const why = named.length
      ? "is stopped"
      : "is not a subagent of this session";
    throw new TaskError(
      `cannot start #${taskId} on worker ${worker}: it ${why}.\n${workersReport(ctx, data, agent)}\n${unblock}`,
    );
  }
  const holding = new Map<string, Obj>();
  for (const t of data.tasks) {
    if (
      get(t, "agent", MAIN) === agent &&
      t.status === "in_progress" &&
      t.id !== taskId &&
      truthy(t.worker_id)
    ) {
      holding.set(t.worker_id, t);
    }
  }
  const free = running.filter((w) => !holding.has(w.id));
  if (free.length === 0) {
    const t = holding.get(running[0]!.id)!;
    throw new TaskError(
      `cannot start #${taskId} on worker ${worker}: it already holds #${t.id} ${t.subject}. One task per worker: set #${t.id} to ` +
        `completed, pending or waiting first, or hand this one to another subagent.\n${workersReport(ctx, data, agent)}`,
    );
  }
  return free[0]!.id;
}

/**
 * How many tasks an agent may have in progress: one per worker.
 *
 * A subagent is one worker. The main agent is one worker plus every
 * subagent it has running: a task handed to a subagent is in progress
 * while that subagent works, and only then.
 */
const inProgressCap = (ctx: Ctx, agent: string): number =>
  agent === MAIN ? 1 + ctx.workers.filter((w) => w.alive).length : 1;

// --- the tools ---------------------------------------------------------------------

/** A tool call checked: whether it writes, and the change it makes. */
export type Step = { mutates: boolean; run: (data: Data, ctx: Ctx) => string };

function taskCreate(agent: string, args: Obj): Step {
  const subject = checkSubject(args.subject);
  const wanted = args.epic;
  return {
    mutates: true,
    run(data, ctx) {
      // No default epic: a task that silently lands in whatever epic happens
      // to be active is how work gets filed under the wrong subject. The
      // caller names the epic every time, 0 included.
      if (
        wanted === undefined ||
        wanted === null ||
        strip(pyStr(wanted)) === ""
      ) {
        throw new TaskError(
          `epic is required: name the epic this task belongs to; ${describeOpen(data, agent)}. ${EPIC_SYNTAX}`,
        );
      }
      const epicId = parseEpicId(wanted);
      if (epicId === null || (epicId !== 0 && !findEpic(data, agent, epicId))) {
        throw new TaskError(
          `no epic ${pyStr(wanted)} for this agent; ${describeOpen(data, agent)}. ${EPIC_SYNTAX}`,
        );
      }
      const task = {
        id: String(data.next_id),
        agent,
        epic: epicId,
        subject,
        description: or(args.description, ""),
        status: "pending",
        created: ctx.now,
        updated: ctx.now,
      };
      data.next_id += 1;
      data.tasks.push(task);
      touch(data, agent, epicId, ctx.now);
      let note = "";
      if (epicId && epicId !== activeEpic(data, agent)) {
        note = ` (epic #${epicId} is not the active one: task_focus it when you start working on it)`;
      } else if (epicId) {
        note = ` in epic #${epicId} ${findEpic(data, agent, epicId)!.title}`;
      }
      return `Task #${task.id} created: ${subject}${note}`;
    },
  };
}

function taskUpdate(agent: string, args: Obj): Step {
  const taskId = strip(pyStr(or(args.id, ""))).replace(/^#+/, "");
  // A caller that names the argument something else — task_id is the common
  // slip — would otherwise look the empty id up and be told "no task # in
  // this agent's list", which sends the reader hunting for an ownership
  // problem instead of a missing argument.
  if (!taskId) throw new TaskError('task_update needs the task id: id="36"');
  const status = args.status;
  let subject = args.subject;
  if (
    status !== undefined &&
    status !== null &&
    !(STATUSES as readonly unknown[]).includes(status)
  ) {
    throw new TaskError(`status must be one of ${STATUSES.join(", ")}`);
  }
  if (subject !== undefined && subject !== null)
    subject = checkSubject(subject);
  // worker only means something on a start; with any other status it is
  // ignored, and leaving in_progress drops the link anyway
  const worker =
    status === "in_progress" ? strip(pyStr(or(args.worker, ""))) : "";
  return {
    mutates: true,
    run(data, ctx) {
      const idx = data.tasks.findIndex(
        (t) => t.id === taskId && get(t, "agent", MAIN) === agent,
      );
      if (idx < 0)
        throw new TaskError(`no task #${taskId} in this agent's list`);
      const task = data.tasks[idx]!;
      touch(data, agent, get(task, "epic", 0), ctx.now);
      if (status === "deleted") {
        data.tasks.splice(idx, 1);
        return `Task #${taskId} deleted`;
      }
      // Nobody but the user works on the user's task: no start, no worker
      if (
        isHuman(task) &&
        (status === "in_progress" || status === "pending")
      ) {
        throw new TaskError(
          `#${taskId} is assigned to the user: it stays waiting until they answer, then completed (or deleted when it no longer applies).`,
        );
      }
      // One task in progress per worker: an amber cell on the status
      // line must mean someone is on it right now
      const starting =
        status === "in_progress" && task.status !== "in_progress";
      if (worker) {
        // A named worker is checked for itself: running, and on no other
        // task. The headcount below cannot tell a task held by a live
        // subagent from one left by a dead one.
        task.worker_id = claimWorker(ctx, data, agent, taskId, worker);
        task.worker = worker;
      } else if (starting) {
        const busy = data.tasks.filter(
          (t) =>
            get(t, "agent", MAIN) === agent &&
            t.status === "in_progress" &&
            t.id !== taskId,
        );
        const cap = inProgressCap(ctx, agent);
        if (busy.length >= cap) {
          const workers =
            cap === 1 ? "you" : `you and ${cap - 1} running subagent(s)`;
          throw new TaskError(
            `cannot start #${taskId}: ${busy.length} task(s) already in progress (${busy.map((t) => `#${t.id} ${t.subject}`).join(", ")}) ` +
              `for ${cap} worker(s), ${workers}.\n${workersReport(ctx, data, agent)}\n` +
              "One task per worker: complete a task nobody is on, or set it to pending or waiting; " +
              "to hand this one to a running subagent, pass worker=<its type or id> with " +
              "status=in_progress (refused if that subagent is stopped or already holds a task).",
          );
        }
      }
      if (truthy(status) && status !== "in_progress") {
        // The link lasts as long as the task is in progress
        delete task.worker;
        delete task.worker_id;
      }
      if (truthy(status)) task.status = status;
      if (truthy(subject)) task.subject = subject;
      if (args.description !== undefined && args.description !== null)
        task.description = args.description;
      task.updated = ctx.now;
      const held = truthy(task.worker) ? ` on worker ${task.worker}` : "";
      return `Task #${taskId} updated: ${task.subject} (${task.status}${held})`;
    },
  };
}

function taskList(agent: string): Step {
  return {
    mutates: false,
    run(data) {
      const active = activeEpic(data, agent);
      const lines: string[] = [];
      const rows = (tasks: Obj[]) =>
        lines.push(
          ...tasks.map(
            (t) =>
              `#${t.id} [${t.status}] ${t.subject}${isHuman(t) ? " (assigned to the user)" : ""}`,
          ),
        );
      if (active) {
        const epic = findEpic(data, agent, active)!;
        const [done, total] = progress(data, agent, active);
        lines.push(`Epic #${active}: ${epic.title} (active, ${done}/${total})`);
        if (total) rows(tasksOf(data, agent, active));
        else lines.push("No tasks yet.");
      }
      const others = openEpics(data, agent).filter((e) => e.id !== active);
      if (others.length) {
        lines.push("Other open epics:");
        for (const epic of others) {
          const [done, total] = progress(data, agent, epic.id);
          lines.push(`#${epic.id} ${epic.title} ${done}/${total}`);
        }
      }
      const loose = tasksOf(data, agent, 0);
      if (loose.length) {
        lines.push(
          active
            ? "Tasks with no epic:"
            : "No active epic. Tasks with no epic:",
        );
        rows(loose);
      }
      return lines.join("\n") || "No tasks and no epic.";
    },
  };
}

function taskEpic(agent: string, args: Obj): Step {
  const title = checkTitle(args.title);
  return {
    mutates: true,
    run(data, ctx) {
      for (const epic of openEpics(data, agent)) {
        if (epic.title === title) {
          data.active[agent] = epic.id;
          epic.touched = ctx.now;
          const [done, total] = progress(data, agent, epic.id);
          return `Epic #${epic.id} ${title} is already open (${done}/${total}): focused it instead of opening a duplicate.`;
        }
      }
      const epic = {
        id: data.next_epic,
        agent,
        title,
        created: ctx.now,
        touched: ctx.now,
      };
      data.next_epic += 1;
      data.epics.push(epic);
      data.active[agent] = epic.id;
      const others = openEpics(data, agent).filter((e) => e.id !== epic.id);
      const tail = others.length
        ? " Still open: " +
          others.map((e) => `#${e.id} ${e.title}`).join(", ") +
          "."
        : "";
      return `Epic #${epic.id} ${title} opened and active: file its tasks with task_create(epic=${epic.id}).${tail}`;
    },
  };
}

function taskFocus(agent: string, args: Obj): Step {
  const wanted = strip(pyStr(or(args.epic, "")));
  if (!wanted)
    throw new TaskError("epic is required: an epic id or its exact title");
  return {
    mutates: true,
    run(data, ctx) {
      const epics = openEpics(data, agent);
      const epicId = parseEpicId(wanted);
      let match = epics.filter((e) => e.id === epicId);
      if (!match.length) match = epics.filter((e) => e.title === wanted);
      if (!match.length) {
        const closed = epicId !== null && findEpic(data, agent, epicId);
        const why = closed
          ? `epic ${wanted} is completed`
          : `no open epic ${wanted}`;
        throw new TaskError(
          `${why}; ${describeOpen(data, agent)}. Open a new one with task_epic.`,
        );
      }
      const epic = match[0]!;
      data.active[agent] = epic.id;
      epic.touched = ctx.now;
      const [done, total] = progress(data, agent, epic.id);
      return `Epic #${epic.id} ${epic.title} is now active (${done}/${total}): file its tasks with task_create(epic=${epic.id}).`;
    },
  };
}

// --- the user's tasks ----------------------------------------------------------------

const isHuman = (t: Obj): boolean => get(t, "assignee", "") === HUMAN;

/** The main agent's tasks assigned to the user and not yet answered. */
export function humanOpen(data: Data): Obj[] {
  return data.tasks.filter(
    (t) =>
      get(t, "agent", MAIN) === MAIN &&
      isHuman(t) &&
      t.status !== "completed",
  );
}

function taskAssignHuman(agent: string, args: Obj): Step {
  // The user talks to the main agent: a subagent's need reaches them
  // through the main agent's answer, never as a task of its own list.
  if (agent !== MAIN)
    throw new TaskError(
      "task_assign_human is the main agent's: say in your answer what you need from the user, and the main agent assigns it.",
    );
  const subject = checkSubject(args.subject);
  const wanted = args.epic;
  return {
    mutates: true,
    run(data, ctx) {
      const epicId =
        wanted === undefined || wanted === null ? null : parseEpicId(wanted);
      if (!epicId || !findEpic(data, agent, epicId)) {
        throw new TaskError(
          `epic is required: a task for the user belongs to the epic it unblocks; ${describeOpen(data, agent)}. task_epic(title) opens one first.`,
        );
      }
      const open = humanOpen(data);
      if (open.length >= MAX_HUMAN_OPEN) {
        throw new TaskError(
          `the user already has ${open.length} tasks waiting (${open.map((t) => `#${t.id} ${t.subject}`).join(", ")}), the limit is ${MAX_HUMAN_OPEN}: ` +
            "close the ones they answered with task_update(status=completed), or delete the ones that no longer apply, first.",
        );
      }
      const task = {
        id: String(data.next_id),
        agent,
        epic: epicId,
        subject,
        description: or(args.description, ""),
        status: "waiting",
        assignee: HUMAN,
        created: ctx.now,
        updated: ctx.now,
      };
      data.next_id += 1;
      data.tasks.push(task);
      touch(data, agent, epicId, ctx.now);
      return (
        `Task #${task.id} assigned to the user, waiting: ${subject} in epic #${epicId} ${findEpic(data, agent, epicId)!.title}. ` +
        `Ask them for it in your reply; once they have answered, task_update(id="${task.id}", status="completed").`
      );
    },
  };
}

/**
 * What the model is told again after a compaction: the user's open tasks,
 * so a "go" asked before the summary is still known to be awaited.
 * Undefined when there is none.
 */
export function humanContext(data: Data): string | undefined {
  const open = humanOpen(data);
  if (!open.length) return undefined;
  const line = (t: Obj): string => {
    const epic = findEpic(data, MAIN, get(t, "epic", 0));
    const what = strip(pyStr(or(t.description, "")));
    const detail = what
      ? `: ${codePoints(what) > 200 ? [...what].slice(0, 200).join("") + "…" : what}`
      : "";
    return `  - #${t.id} ${t.subject}${epic ? ` (epic #${epic.id} ${epic.title})` : ""}${detail}`;
  };
  return [
    "Tasks assigned to the user (task_assign_human), still waiting on them:",
    ...open.map(line),
    "Once the user has answered one, close it with task_update(id, status=completed); do not redo what only they can do.",
  ].join("\n");
}

export const TOOL_NAMES = [
  "task_create",
  "task_update",
  "task_epic",
  "task_focus",
  "task_list",
  "task_assign_human",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Check a call's arguments and return the change it makes. Throws TaskError
 * on the checks that need no file, in tasks.py's order; the rest throw from
 * `run`, which sees the file as it is under the lock.
 */
export function plan(tool: ToolName, agent: string, args: Obj): Step {
  switch (tool) {
    case "task_create":
      return taskCreate(agent, args);
    case "task_update":
      return taskUpdate(agent, args);
    case "task_epic":
      return taskEpic(agent, args);
    case "task_focus":
      return taskFocus(agent, args);
    case "task_list":
      return taskList(agent);
    case "task_assign_human":
      return taskAssignHuman(agent, args);
  }
}

// --- who the workers are ------------------------------------------------------------

const STALE_AGENT = 12 * 3600; // a subagent with no stop for this long was lost with its session
const LIVE = new Set(["running", "waiting", "idle"]);

/**
 * The session's subagents. `listed` is `$.agent.list()` (undefined when it
 * failed) and decides who runs; agents.json, written by on-agent.sh under
 * the same ids, only adds when each started. Without the list, agents.json
 * decides alone, as tasks.py did.
 */
export function resolveWorkers(
  listed:
    | readonly { id: string; type: string; name?: string; status: string }[]
    | undefined,
  agentsJson: string | undefined,
  now: number,
): Worker[] {
  let recorded: Obj = {};
  try {
    const parsed = agentsJson === undefined ? {} : JSON.parse(agentsJson);
    const agents = isObj(parsed) ? or(parsed.agents, {}) : {};
    if (isObj(agents)) recorded = agents;
  } catch {
    recorded = {};
  }
  const startedOf = (id: string): number | undefined => {
    const e = recorded[id];
    return isObj(e) && typeof e.started === "number" ? e.started : undefined;
  };
  if (listed) {
    return listed.map((a) => {
      const w: Worker = { id: a.id, type: a.type, alive: LIVE.has(a.status) };
      if (a.name) w.name = a.name;
      const started = startedOf(a.id);
      if (started !== undefined) w.started = started;
      return w;
    });
  }
  return Object.entries(recorded)
    .filter(([, e]) => isObj(e))
    .map(([id, e]) => {
      const w: Worker = {
        id,
        type: pyStr(or(e.type, "")),
        alive:
          get(e, "stopped", null) === null &&
          (or(e.started, 0) as number) >= now - STALE_AGENT,
      };
      if (typeof e.started === "number") w.started = e.started;
      return w;
    });
}

// --- what the model reads -------------------------------------------------------------

const WORKFLOW =
  " Work is grouped in epics, one per subject; several can be open at once, one is active (the one being " +
  "worked on) and every task names its epic explicitly. The user's status line shows every open epic live, so the list must say what is true at every " +
  "moment: in_progress while you work on a task, waiting while it is blocked on the user, completed as soon " +
  "as it is done and verified.";

export const TOOLS: readonly {
  name: ToolName;
  description: string;
  inputSchema: Obj;
}[] = [
  {
    name: "task_create",
    description:
      "Add a task. Use tasks for work with three or more distinct steps, or when the user lists several " +
      "things to do; skip them for a single trivial change. epic is REQUIRED, there is no default: the id " +
      "of the epic the task belongs to (task_list, or the Epics line given with each prompt, lists them), " +
      "or 0 for a task outside any epic; open a new subject with task_epic first. task_focus the epic when " +
      'you start its work. A change to an already completed task is a new task "Rework #N: ..." in that ' +
      "task's epic. subject: at most 40 characters, " +
      'imperative, no final punctuation ("Add the effort gauge"); detail goes in description. New tasks ' +
      "start pending." +
      WORKFLOW,
    inputSchema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          maxLength: MAX_SUBJECT,
          description: "Short imperative title, 40 characters at most.",
        },
        description: { type: "string", description: "What needs to be done." },
        epic: {
          type: "integer",
          minimum: 0,
          description:
            "Required. Id of one of your epics, or 0 for no epic. No default.",
        },
      },
      required: ["subject", "epic"],
    },
  },
  {
    name: "task_update",
    description:
      "Update one of your tasks: set in_progress before starting it, completed as soon as its work is done " +
      "and verified, waiting when it is blocked on the user (a decision, an approval, an answer), deleted " +
      "when it no longer applies. Never end a turn with tasks left to do but none in_progress or waiting: " +
      "either one is under way, or they wait on the user and say so. One task in_progress per worker: you " +
      "may have one, plus one per running subagent (each subagent works on exactly one task); switching " +
      "to another task means setting the current one back to pending first, and a task handed to a " +
      "subagent goes in_progress once that subagent has started, with worker=<its type or id> so the task is " +
      "tied to it. With worker, the start is refused if that subagent is stopped or already holds another " +
      "task; without it, a start beyond the worker count is refused. The link is dropped when the task " +
      "leaves in_progress. A refusal lists the running subagents and who holds each task in progress.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Task id, as returned by task_create.",
        },
        status: { type: "string", enum: [...STATUSES] },
        subject: { type: "string", maxLength: MAX_SUBJECT },
        description: { type: "string" },
        worker: {
          type: "string",
          description:
            "With status=in_progress: the running subagent that takes the task, by " +
            "type (its name) or agent id. Optional.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "task_epic",
    description:
      "Open a new epic and make it active: a separate subject with its own task list and its own pill on " +
      "the user's status line. Use it when the user brings a new subject, rather than appending its tasks " +
      "to an unrelated epic; other open epics stay open. If an open epic already has this exact title it " +
      'is focused instead. title: at most 20 characters, a short noun phrase ("SDK status-line").' +
      WORKFLOW,
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          maxLength: MAX_TITLE,
          description: "Subject of the epic, 20 characters at most.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "task_focus",
    description:
      "Make an open epic the active one, by id or exact title, when the work turns back to it: the status " +
      "line expands it. Completed epics cannot be focused; open a new one " +
      "with task_epic." +
      WORKFLOW,
    inputSchema: {
      type: "object",
      properties: {
        epic: {
          type: "string",
          description: 'Epic id ("3" or "#3") or its exact title.',
        },
      },
      required: ["epic"],
    },
  },
  {
    name: "task_list",
    description:
      "List the active epic's tasks with ids and statuses, one line per other open epic " +
      "(id, title, done/total), and tasks with no epic.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "task_assign_human",
    description:
      "Assign the user a task only they can do: a go or an approval, a Touch ID or a password typed on " +
      "their machine, a gesture on hardware you cannot reach. The task is filed waiting, marked as the " +
      "user's, in the epic it unblocks (epic is required), and shows on their status line. Say in your " +
      "reply what you need from them. Once they have answered, close it with task_update(status=completed); " +
      "it never goes in_progress. At most 5 open at once. Main agent only: a subagent says what it needs in " +
      "its answer.",
    inputSchema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          maxLength: MAX_SUBJECT,
          description:
            'What the user must do, imperative, 40 characters at most ("Give the go for the NAS reboot").',
        },
        description: {
          type: "string",
          description: "Exactly what to do or decide, and where.",
        },
        epic: {
          type: "integer",
          minimum: 1,
          description: "Required. Id of the epic this unblocks.",
        },
      },
      required: ["subject", "epic"],
    },
  },
];
