// pure.test.ts — the pure modules, under `claude plugin test`.
import { test, expect } from "claude-code/testing";
import {
  ago,
  closed,
  idle,
  judge,
  orphan,
  parseBoard,
  parseTasks,
  prsOf,
  visibleTasks,
  type Ctx,
} from "../hooks/mod/board.ts";
import { EPIC_PREDICATES_JSON } from "./epic-predicates.ts";
import { alertsFor } from "../hooks/mod/alerts.ts";
import { ciState, prsToCheck } from "../hooks/mod/ci.ts";

const HOME = "/u/dev";
const NOW = 1_800_000_000_000; // ms
const SEC = NOW / 1000;

const file = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 2,
    next_id: 6,
    next_epic: 4,
    epics: [
      {
        id: 1,
        agent: "main",
        title: "Done epic",
        created: SEC,
        touched: SEC - 50,
      },
      { id: 2, agent: "main", title: "SDK", created: SEC, touched: SEC - 10 },
      { id: 3, agent: "main", title: "Empty", created: SEC, touched: SEC - 5 },
    ],
    active: { main: 3 },
    tasks: [
      {
        id: "1",
        agent: "main",
        epic: 1,
        subject: "Old",
        status: "completed",
        updated: SEC - 100,
      },
      {
        id: "2",
        agent: "main",
        epic: 2,
        subject: "Ship it",
        status: "completed",
        updated: SEC - 90,
      },
      {
        id: "3",
        agent: "main",
        epic: 2,
        subject: "Wire the pane",
        description:
          "see https://github.com/kodflow/claude-marketplace/pull/42",
        status: "in_progress",
        worker: "hud",
        worker_id: "a1",
        updated: SEC - 60,
      },
      {
        id: "4",
        agent: "main",
        epic: 0,
        subject: "Loose",
        status: "waiting",
        updated: SEC - 30,
      },
      {
        id: "5",
        agent: "main",
        epic: 2,
        subject: "Say yes",
        status: "pending",
        assignee: "human",
        updated: SEC,
      },
    ],
    ...over,
  });

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  now: NOW,
  agents: [{ id: "a1", label: "hud", status: "running" }],
  activity: {},
  silentMs: 10 * 60_000,
  ...over,
});

test("the board keeps the open epics in the order they were opened, the active one marked, and the loose tasks", () => {
  const b = parseBoard(file());
  expect(b.found).toBe(true);
  expect(b.epics.map((e) => [e.id, e.title, e.tasks.length])).toEqual([
    [2, "SDK", 3],
    [3, "Empty", 0],
    [0, "Hors épopée", 1],
  ]);
  expect(b.epics.map((e) => !!e.active)).toEqual([false, true, false]);
  expect(b.epics[0]!.tasks[1]!.prs).toEqual([
    "https://github.com/kodflow/claude-marketplace/pull/42",
  ]);
  expect(b.epics[0]!.tasks[2]!.assignee).toBe("human");
});

test("no file, or a broken one, is an empty board that says which", () => {
  expect(parseBoard(undefined)).toEqual({ found: false, epics: [], helpers: [] });
  expect(parseBoard("{nope")).toEqual({ found: true, epics: [], helpers: [] });
  expect(parseTasks(null)).toEqual([]);
});

test("predicates: closed, idle and orphan hold kodflow-hooks' fixture", () => {
  const fx = JSON.parse(EPIC_PREDICATES_JSON);
  expect(fx.data.epics[0].closed_at).toBe(Infinity); // 1e999, open
  const ids = (pick: (e: any) => boolean) =>
    fx.data.epics.filter(pick).map((e: any) => e.id);
  expect(ids((e) => closed(e))).toEqual(fx.expect.closed);
  expect(ids((e) => idle(e, fx.data.tasks, fx.now, fx.live))).toEqual(fx.expect.idle);
  expect(
    fx.data.tasks.filter((t: any) => orphan(t, fx.live)).map((t: any) => t.id),
  ).toEqual(fx.expect.orphans);
  // Liveness unknown: nobody is an orphan
  expect(fx.data.tasks.filter((t: any) => orphan(t, undefined))).toEqual([]);
});

/** A main task handed to two subagents, one live, one stopped, and a closed epic. */
const helpersFile = () =>
  JSON.stringify({
    version: 2,
    active: { main: 1 },
    epics: [
      { id: 1, agent: "main", title: "Open", created: SEC - 10, touched: SEC },
      { id: 2, agent: "main", title: "Shut", created: SEC - 20, touched: SEC, closed_at: SEC - 5 },
      { id: 3, agent: "main", title: "Older", created: SEC - 30, touched: SEC },
      { id: 9, agent: "w-live", title: "Sub epic", created: SEC, touched: SEC },
    ],
    tasks: [
      { id: "1", agent: "main", epic: 1, subject: "Build", status: "in_progress", worker: "impl", worker_id: "w-live", workers: ["w-dead", "w-live", "w-live"], updated: SEC },
      { id: "2", agent: "main", epic: 2, subject: "Old", status: "completed", workers: ["w-gone"], updated: SEC - 6,
        description: "https://github.com/a/b/pull/7" },
      { id: "3", agent: "main", epic: 3, subject: "Next", status: "pending", updated: SEC },
      { id: "4", agent: "w-live", epic: 0, subject: "Step one", status: "in_progress", updated: SEC },
      { id: "5", agent: "w-dead", epic: 0, subject: "Left over", status: "in_progress", updated: SEC },
      { id: "6", agent: "w-gone", epic: 0, subject: "Hidden", status: "pending", updated: SEC,
        description: "https://github.com/a/b/pull/8" },
      { id: "7", agent: "w-free", epic: 0, subject: "Nobody's", status: "pending", updated: SEC },
    ],
  });

test("a closed epic is gone with its helpers; the subagents' tasks are helpers, the stopped ones marked", () => {
  const b = parseBoard(helpersFile(), NOW, ["w-live", "w-free"]);
  // Main epics only, by created, the closed one and the subagent's epic gone
  expect(b.epics.map((e) => e.id)).toEqual([3, 1]);
  expect(b.epics[1]!.tasks[0]!.workers).toEqual(["w-dead", "w-live"]);
  expect(b.helpers!.map((h) => [h.id, !!h.stopped])).toEqual([
    ["4", false],
    ["5", true],
    ["7", false],
  ]);
  // Shown and counted: no closed epic, no orphan; CI from those only
  expect(visibleTasks(b).map((t) => t.id)).toEqual(["3", "1", "4", "7"]);
  expect(prsToCheck(visibleTasks(b))).toEqual([]);
  // The list not read: nobody is an orphan
  expect(parseBoard(helpersFile(), NOW).helpers!.some((h) => h.stopped)).toBe(false);
});

test("liveness unknown: a subagent's task is neither silent nor stopped", () => {
  const task = parseTasks(JSON.parse(file()))[2]!;
  const gone = ctx({ agents: [], now: NOW + 3600_000 });
  expect(judge(task, gone).silent).toBe(true);
  expect(judge(task, { ...gone, liveness: "unknown" })).toEqual(
    expect.objectContaining({ state: "unknown", silent: false }),
  );
  // A teammate the list cannot judge is « unknown » too
  const mate = ctx({ agents: [{ id: "a1", label: "hud", status: "unknown" }], now: NOW + 3600_000 });
  expect(judge(task, mate)).toEqual(expect.objectContaining({ state: "unknown", silent: false }));
});

test("an epic idle for 24 h is marked, one with a live worker on it is not", () => {
  const f = JSON.stringify({
    version: 2,
    active: {},
    epics: [
      { id: 1, agent: "main", title: "Quiet", created: SEC - 200_000, touched: SEC - 100_000 },
      { id: 2, agent: "main", title: "Held", created: SEC - 200_000, touched: SEC - 100_000 },
    ],
    tasks: [
      { id: "1", agent: "main", epic: 1, subject: "a", status: "pending", updated: SEC - 100_000 },
      { id: "2", agent: "main", epic: 2, subject: "b", status: "in_progress", worker_id: "w1", updated: SEC - 100_000 },
    ],
  });
  const b = parseBoard(f, NOW, ["w1"]);
  expect(b.epics.map((e) => [e.id, !!e.idle])).toEqual([
    [1, true],
    [2, false],
  ]);
});

test("an in-progress task is silent when its worker stopped, or after the quiet time", () => {
  const task = parseTasks(JSON.parse(file()))[2]!;
  // Running worker, last change a minute ago: not silent
  expect(judge(task, ctx()).silent).toBe(false);
  expect(judge(task, ctx()).state).toBe("running");
  // Worker stopped
  const stopped = judge(
    task,
    ctx({ agents: [{ id: "a1", label: "hud", status: "completed" }] }),
  );
  expect(stopped).toMatchObject({
    silent: true,
    why: "stopped",
    state: "completed",
  });
  // Worker gone from the list
  expect(judge(task, ctx({ agents: [] }))).toMatchObject({
    silent: true,
    state: "absent",
  });
  // Quiet for longer than the threshold
  const later = ctx({ now: NOW + 11 * 60_000 });
  expect(judge(task, later)).toMatchObject({ silent: true, why: "quiet" });
  // ... unless the worker's tool calls say it is busy
  const busy = ctx({
    now: NOW + 11 * 60_000,
    activity: { a1: { agentId: "a1", last: NOW + 10 * 60_000 } },
  });
  expect(judge(task, busy).silent).toBe(false);
});

test("a task of the main loop follows the main loop's activity", () => {
  const loose = parseTasks(JSON.parse(file()))[3]!;
  const started = { ...loose, status: "in_progress" };
  expect(judge(started, ctx({ now: NOW + 20 * 60_000 })).silent).toBe(true);
  const busy = ctx({
    now: NOW + 20 * 60_000,
    activity: { main: { agentId: "main", last: NOW + 19 * 60_000 } },
  });
  expect(judge(started, busy)).toMatchObject({ silent: false, state: "main" });
});

test("toasts: once per task and state, none for what stood at the first read", () => {
  const tasks = parseTasks(JSON.parse(file()));
  const first = alertsFor("s", tasks, ctx(), new Set(), true);
  expect(first.alerts).toEqual([]);
  expect(first.keys.sort()).toEqual(["s:1:done", "s:2:done", "s:4:waiting"]);
  const seen = new Set(first.keys);
  // #3 completes, #5 goes waiting
  tasks[2]!.status = "completed";
  tasks[4]!.status = "waiting";
  const next = alertsFor("s", tasks, ctx(), seen, false);
  expect(next.alerts.map((a) => a.text)).toEqual([
    "#3 Wire the pane : terminée",
    "#5 Say yes : bloquée, en attente",
  ]);
  for (const k of next.keys) seen.add(k);
  expect(alertsFor("s", tasks, ctx(), seen, false).alerts).toEqual([]);
});

test("a silent task is toasted once, with its reason", () => {
  const tasks = parseTasks(JSON.parse(file()));
  const out = alertsFor(
    "s",
    tasks,
    ctx({ agents: [] }),
    new Set(["s:1:done", "s:2:done", "s:4:waiting"]),
    false,
  );
  expect(out.alerts.map((a) => a.text)).toEqual([
    "#3 Wire the pane : silencieuse, son worker est arrêté",
  ]);
});

test("ages in the fewest cells", () => {
  expect([
    ago(5_000),
    ago(180_000),
    ago(3_720_000),
    ago(2 * 86_400_000),
  ]).toEqual(["5s", "3m", "1h02", "2j"]);
});

test("CI: cited pull requests of open tasks only, and gh's exit codes read", () => {
  const b = parseBoard(file());
  expect(prsToCheck(visibleTasks(b))).toEqual([
    "https://github.com/kodflow/claude-marketplace/pull/42",
  ]);
  expect(
    prsOf("x https://github.com/a/b/pull/1 y https://github.com/a/b/pull/1"),
  ).toEqual(["https://github.com/a/b/pull/1"]);
  expect(ciState(0, "build\tpass\t1m\turl", "")).toBe("pass");
  expect(ciState(8, "build\tpending\t0\turl", "")).toBe("pending");
  expect(ciState(1, "build\tfail\t1m\turl", "")).toBe("fail");
  expect(ciState(1, "", "HTTP 401")).toBe("error");
  expect(ciState(1, "", "no checks reported on the 'x' branch")).toBe("none");
});

// --- tasks done stay on the board for 30 minutes ------------------------------------

const MINS = 60;
const done = (id: string, epic: number, ago: number, over: object = {}) => ({
  id,
  agent: "main",
  epic,
  subject: `Done ${id}`,
  status: "completed",
  created: SEC - 7200,
  updated: SEC - ago * MINS,
  ...over,
});
const doneFile = (tasks: object[]) =>
  JSON.stringify({
    version: 2,
    next_id: 9,
    next_epic: 4,
    epics: [
      { id: 1, agent: "main", title: "Open", created: SEC, touched: SEC - 100 },
      { id: 2, agent: "main", title: "Just done", created: SEC, touched: SEC - 5 },
      { id: 3, agent: "main", title: "Long done", created: SEC, touched: SEC - 1 },
    ],
    active: {},
    tasks,
  });

test("an epic with nothing left stays 30 minutes after its last task was done, in its place", () => {
  const f = doneFile([
    { ...done("1", 1, 0), status: "pending" },
    done("2", 2, 20),
    done("3", 2, 40),
    done("4", 3, 31),
  ]);
  // 20 minutes: kept, in the order the epics were opened
  expect(parseBoard(f, NOW).epics.map((e) => e.id)).toEqual([1, 2]);
  // The last task of the epic decides, not the first
  expect(parseBoard(f, NOW).epics[1]!.tasks).toHaveLength(2);
  // Without a clock, or 30 minutes on, today's board
  expect(parseBoard(f).epics.map((e) => e.id)).toEqual([1]);
  expect(parseBoard(f, NOW + 10 * MINS * 1000).epics.map((e) => e.id)).toEqual([1]);
  expect(parseBoard(f, NOW + 9 * MINS * 1000).epics.map((e) => e.id)).toEqual([1, 2]);
});

test("the group under no epic is kept the same 30 minutes, last, work left or not", () => {
  const f = doneFile([
    done("1", 2, 5),
    done("2", 0, 2, { subject: "Quelle heure ?" }),
  ]);
  const kept = parseBoard(f, NOW);
  expect(kept.epics.map((e) => e.id)).toEqual([2, 0]);
  expect(kept.epics[1]!.title).toBe("Hors épopée");
  expect(parseBoard(f).epics).toEqual([]);
  expect(parseBoard(f, NOW + 29 * MINS * 1000).epics.map((e) => e.id)).toEqual([]);
  // Last, work left or not
  const g = doneFile([
    done("1", 2, 5),
    { ...done("2", 0, 1), status: "pending" },
    { ...done("3", 1, 0), status: "pending" },
  ]);
  expect(parseBoard(g, NOW).epics.map((e) => e.id)).toEqual([1, 2, 0]);
});
