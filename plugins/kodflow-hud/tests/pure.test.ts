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
import { fold, observe, prune } from "../hooks/mod/activity.ts";
import { alertsFor } from "../hooks/mod/alerts.ts";
import { ciState, prsToCheck } from "../hooks/mod/ci.ts";
import { resolvePath, shortFile, tilde } from "../hooks/mod/paths.ts";

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
    activity: { a1: { agentId: "a1", files: [], last: NOW + 10 * 60_000 } },
  });
  expect(judge(task, busy).silent).toBe(false);
});

test("a task of the main loop follows the main loop's activity", () => {
  const loose = parseTasks(JSON.parse(file()))[3]!;
  const started = { ...loose, status: "in_progress" };
  expect(judge(started, ctx({ now: NOW + 20 * 60_000 })).silent).toBe(true);
  const busy = ctx({
    now: NOW + 20 * 60_000,
    activity: { main: { agentId: "main", files: [], last: NOW + 19 * 60_000 } },
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

test("activity: file tools name their file, shell commands their folder", () => {
  expect(observe("Read", { file_path: "src/a.ts" }, "/w/repo", HOME)).toEqual({
    dir: "/w/repo/src",
    files: [{ path: "/w/repo/src/a.ts", op: "read" }],
  });
  expect(observe("Edit", { file_path: "~/x/b.go" }, "/w", HOME).files).toEqual([
    { path: "/u/dev/x/b.go", op: "write" },
  ]);
  expect(
    observe("NotebookEdit", { notebook_path: "/n/c.ipynb" }, "/w", HOME)
      .files[0]!.op,
  ).toBe("write");
  expect(observe("Grep", { path: "/w/lib" }, "/w", HOME)).toEqual({
    dir: "/w/lib",
    files: [],
  });
  expect(
    observe("Bash", { command: "cd /w/other && make" }, "/w", HOME),
  ).toEqual({
    dir: "/w/other",
    files: [],
  });
  expect(
    observe("Bash", { command: 'git -C "/w/my repo" status' }, "/w", HOME).dir,
  ).toBe("/w/my repo");
  expect(observe("Bash", { command: "ls -la" }, "/w", HOME)).toEqual({
    files: [],
  });
  expect(observe("WebFetch", { url: "https://x" }, "/w", HOME)).toEqual({
    files: [],
  });
});

test("a commit is seen in every git spelling, in the folder git was pointed at", () => {
  for (const command of [
    'git commit -m "x"',
    "cd /w/r && git add . && git commit -m x",
    "git -C /w/r commit -m x",
    "git -c user.name=k --no-pager commit --amend",
  ])
    expect(observe("Bash", { command }, "/w/r", HOME).commit).toBe("/w/r");
  expect(
    observe("Bash", { command: "git log --grep=commit" }, "/w/r", HOME).commit,
  ).toBeUndefined();
  expect(
    observe("Bash", { command: "echo git commit" }, "/w/r", HOME).commit,
  ).toBeDefined(); // known gap: no shell parser
});

test("fold keeps the newest first, once each, and a commit turns writes green", () => {
  let a = fold(
    undefined,
    "main",
    observe("Read", { file_path: "/w/r/a.ts" }, "/", HOME),
    1,
    "/w/r",
    undefined,
  );
  a = fold(
    a,
    "main",
    observe("Write", { file_path: "/w/r/b.ts" }, "/", HOME),
    2,
    "/w/r",
    undefined,
  );
  a = fold(
    a,
    "main",
    observe("Edit", { file_path: "/w/r/a.ts" }, "/", HOME),
    3,
    "/w/r",
    undefined,
  );
  expect(a.files.map((f) => [f.path, f.op])).toEqual([
    ["/w/r/a.ts", "write"],
    ["/w/r/b.ts", "write"],
  ]);
  a = fold(
    a,
    "main",
    observe("Bash", { command: "git commit -m x" }, "/w/r", HOME),
    4,
    undefined,
    "/w/r",
  );
  expect(a.files.map((f) => f.op)).toEqual(["commit", "commit"]);
  expect(a).toMatchObject({ dir: "/w/r", last: 4 });
});

test("files leave after the TTL, and an unchanged record is not rewritten", () => {
  const act = {
    main: {
      agentId: "main",
      last: 0,
      files: [
        { path: "/a", op: "read" as const, at: 0 },
        { path: "/b", op: "write" as const, at: 40_000 },
      ],
    },
  };
  expect(prune(act, 30_000)).toBeUndefined();
  expect(prune(act, 50_000)!.main!.files.map((f) => f.path)).toEqual(["/b"]);
});

test("paths: ~ and relative paths placed, shown short", () => {
  expect(resolvePath("../x/./y", "/w/r", HOME)).toBe("/w/x/y");
  expect(resolvePath("rel", undefined, HOME)).toBeUndefined();
  expect(tilde("/u/dev/p", HOME)).toBe("~/p");
  expect(tilde("/u/devx/p", HOME)).toBe("/u/devx/p");
  expect(shortFile("/w/r/src/a.ts", "/w/r")).toBe("src/a.ts");
  expect(shortFile("/elsewhere/a.ts", "/w/r")).toBe("/elsewhere/a.ts");
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
