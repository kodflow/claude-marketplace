// pure.test.ts — the pure modules, under `claude plugin test`.
import { test, expect } from "claude-code/testing";
import {
  ago,
  judge,
  parseBoard,
  parseTasks,
  prsOf,
  type Ctx,
} from "../hooks/mod/board.ts";
import { alertsFor } from "../hooks/mod/alerts.ts";
import { ciState, prsToCheck } from "../hooks/mod/ci.ts";

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

test("the board keeps the open epics, the active empty one, and the loose tasks", () => {
  const b = parseBoard(file());
  expect(b.found).toBe(true);
  expect(b.epics.map((e) => [e.id, e.title, e.tasks.length])).toEqual([
    [3, "Empty", 0],
    [2, "SDK", 3],
    [0, "Hors épopée", 1],
  ]);
  expect(b.epics[1]!.tasks[1]!.prs).toEqual([
    "https://github.com/kodflow/claude-marketplace/pull/42",
  ]);
  expect(b.epics[1]!.tasks[2]!.assignee).toBe("human");
});

test("no file, or a broken one, is an empty board that says which", () => {
  expect(parseBoard(undefined)).toEqual({ found: false, epics: [] });
  expect(parseBoard("{nope")).toEqual({ found: true, epics: [] });
  expect(parseTasks(null)).toEqual([]);
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
  expect(prsToCheck(b.epics)).toEqual([
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

test("an epic with nothing left stays 30 minutes after its last task was done, after the epics with work", () => {
  const f = doneFile([
    { ...done("1", 1, 0), status: "pending" },
    done("2", 2, 20),
    done("3", 2, 40),
    done("4", 3, 31),
  ]);
  // 20 minutes: kept, behind the open epic though it was touched later
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
  // With work left it is where it was: after the open epics, before the kept ones
  const g = doneFile([
    done("1", 2, 5),
    { ...done("2", 0, 1), status: "pending" },
    { ...done("3", 1, 0), status: "pending" },
  ]);
  expect(parseBoard(g, NOW).epics.map((e) => e.id)).toEqual([1, 0, 2]);
});
