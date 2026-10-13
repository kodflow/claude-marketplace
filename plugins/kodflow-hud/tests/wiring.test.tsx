// wiring.test.tsx — the hooks module under `claude plugin test`: the
// engine's own `$` over the plugin, the host beneath it in memory (files,
// agents, commands, toasts) and the clock moved by the test.
import { test, expect, mock } from "claude-code/testing";

const CFG = "/cfg";
const SID = "sess-1";
const TASKS = `${CFG}/kodflow/sessions/${SID}/tasks.json`;
const NOW = 1_800_000_000_000;
const SEC = NOW / 1000;
const PR = "https://github.com/kodflow/claude-marketplace/pull/42";

type Host = {
  files: Map<string, { text: string; mtimeMs: number }>;
  dirs: Set<string>;
  agents: { id: string; type: string; name?: string; status: string }[];
  toasts: string[];
  opened: string[];
  commands: string[];
  runs: string[][];
  checks: { exitCode: number; stdout: string };
};

function host(on: any): { h: Host; clock: ReturnType<typeof mock.clock> } {
  const h: Host = {
    files: new Map(),
    dirs: new Set(["/w/repo/.git"]),
    agents: [],
    toasts: [],
    opened: [],
    commands: [],
    runs: [],
    checks: { exitCode: 0, stdout: "build\tpass\t1m\turl" },
  };
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { CLAUDE_CONFIG_DIR: CFG, HOME: "/u/dev" });
  on("session.id", async () => ({ value: SID }));
  on("session.root", async () => ({ value: "/w/repo" }));
  on("session.start", async (_$: any, e: any) => ({ cwd: e.cwd ?? "/w/repo" }));
  on("command.register", async (_$: any, e: any) => {
    h.commands.push(e.name);
    return { value: undefined };
  });
  on("ui.open", async (_$: any, e: any) => {
    h.opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.toast", async (_$: any, e: any) => {
    h.toasts.push(e.text);
    return { value: undefined };
  });
  on("agent.list", async () => ({ value: h.agents }));
  on("fs.exists", async (_$: any, e: any) => ({
    value: h.dirs.has(e.path) || h.files.has(e.path),
  }));
  on("fs.stat", async (_$: any, e: any) => {
    const f = h.files.get(e.path);
    if (!f) return { deny: "ENOENT" };
    return {
      value: {
        kind: "file",
        size: f.text.length,
        mtimeMs: f.mtimeMs,
        isLink: false,
      },
    };
  });
  on("fs.read", async (_$: any, e: any) => {
    const f = h.files.get(e.path);
    return f ? { value: f.text } : { deny: "ENOENT" };
  });
  on("process.run", async (_$: any, e: any) => {
    h.runs.push(e.argv);
    return {
      value: {
        exitCode: h.checks.exitCode,
        stdout: h.checks.stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  // The tools themselves: whatever they are asked, they answer this
  on("tool.call", async (_$: any, e: any) => ({
    result: { stdout: `ran ${e.tool}`, stderr: "", interrupted: false },
  }));
  return { h, clock };
}

const tasksJson = (tasks: object[], extra: object = {}) =>
  JSON.stringify({
    version: 2,
    next_id: 9,
    next_epic: 3,
    epics: [
      {
        id: 2,
        agent: "main",
        title: "SDK status-line",
        created: SEC,
        touched: SEC,
      },
    ],
    active: { main: 2 },
    tasks,
    ...extra,
  });

const T = (id: string, status: string, over: object = {}) => ({
  id,
  agent: "main",
  epic: 2,
  subject: `Task ${id}`,
  status,
  created: SEC,
  updated: SEC,
  ...over,
});

const writeTasks = (h: Host, tasks: object[], mtimeMs: number) =>
  h.files.set(TASKS, { text: tasksJson(tasks), mtimeMs });

const PANE = (bodyColumns: number, bodyRows = 30) => ({
  title: "Tâches",
  isFocused: false,
  bodyColumns,
  placement: "dock" as const,
  scroll: { offset: 0, bodyRows },
  view: {},
});

const start = async ($: any, clock: any) => {
  await $.session.start({ source: "startup", cwd: "/w/repo" });
  await clock.settle();
};

test("session start registers /hud, opens both panes and reads tasks.json", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  await start($, clock);
  expect(h.commands).toEqual(["hud"]);
  expect(h.opened.sort()).toEqual(["hud-agents", "hud-tasks"]);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(100),
  });
  expect(await ui.find({ text: /SDK status-line 0\/1/ })).toBeDefined();
  expect(await ui.find({ text: /#1 Task 1/ })).toBeDefined();
  await ui.unmount();
});

test("a tool call goes back untouched, and is filed under its loop", async ($, on) => {
  const { clock } = host(on);
  await start($, clock);
  const r: any = await $.tool.call({
    tool: "Read",
    file_path: "/w/repo/src/a.ts",
  } as any);
  expect(r.result).toEqual({
    stdout: "ran Read",
    stderr: "",
    interrupted: false,
  });
  expect(r.context).toBeUndefined();
  await $.tool.call({
    tool: "Edit",
    file_path: "src/b.ts",
    old_string: "a",
    new_string: "b",
  } as any);
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({
      plugin: "kodflow-hud",
      surface,
      component: "Pane",
      requestId: "hud-agents",
      props: { ...PANE(80), title: "Agents" },
    });
    // The folder is the work tree's root, the files relative to it
    expect(await ui.find({ text: /principal/ })).toBeDefined();
    expect(await ui.find({ text: "/w/repo" })).toBeDefined();
    expect(await ui.find({ text: "src/b.ts" })).toBeDefined();
    expect(await ui.find({ text: "src/a.ts" })).toBeDefined();
    await ui.unmount();
  }
  // Past the TTL the files go, the folder stays
  await clock.advance(48_000);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-agents",
    props: { ...PANE(80), title: "Agents" },
  });
  expect(await ui.find({ text: "src/a.ts" })).toBeUndefined();
  expect(await ui.find({ text: "/w/repo" })).toBeDefined();
});

test("a refused call is not recorded", async ($, on) => {
  on("tool.call", { tool: "Write" }, async () => ({ deny: "no" }));
  const { clock } = host(on);
  await start($, clock);
  const r: any = await $.tool.call({
    tool: "Write",
    file_path: "/w/repo/x",
    content: "",
  } as any);
  expect(r.deny ?? r.text).toContain("no");
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-agents",
    props: PANE(80),
  });
  expect(await ui.find({ text: /Aucune activité/ })).toBeDefined();
});

test("the worker, its state, the age and the silent flag, at full width", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [
    { id: "a1", type: "general-purpose", name: "hud", status: "running" },
  ];
  writeTasks(
    h,
    [
      T("1", "completed"),
      T("2", "in_progress", {
        worker: "hud",
        worker_id: "a1",
        updated: SEC - 120,
        description: PR,
      }),
      T("3", "in_progress", { updated: SEC - 3600 }),
      T("4", "pending", { assignee: "human" }),
    ],
    1,
  );
  await start($, clock);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(120),
  });
  expect(await ui.find({ text: /hud running/ })).toBeDefined();
  expect(await ui.find({ text: "2m" })).toBeDefined();
  // #3 belongs to the main loop, quiet for an hour: silent
  const silent = await ui.findAll({ type: "Text", text: / silencieux/ });
  expect(silent).toHaveLength(1);
  // The person's task in its own column
  expect(await ui.find({ text: /Pour toi \(1\)/ })).toBeDefined();
  expect(
    (await ui.findAll({ type: "Text", text: /#4 Task 4/ })).length,
  ).toBe(2);
  // CI of the cited pull request, asked once
  expect(h.runs).toEqual([["gh", "pr", "checks", PR]]);
  await ui.redraw();
  expect(await ui.find({ text: / CI ✓/ })).toBeDefined();
});

test("narrow panes drop columns, short ones fold the completed tasks", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(
    h,
    [
      T("1", "completed"),
      T("2", "completed"),
      T("3", "in_progress", { updated: SEC - 3600 }),
      T("4", "pending"),
    ],
    1,
  );
  await start($, clock);
  const narrow = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(30, 3),
  });
  expect(await narrow.find({ text: " !" })).toBeDefined();
  expect(await narrow.find({ text: /silencieux/ })).toBeUndefined();
  expect(await narrow.find({ text: "1h00" })).toBeUndefined();
  expect(await narrow.find({ text: /■ 2 terminées/ })).toBeDefined();
  expect(await narrow.find({ text: /#1 Task 1/ })).toBeUndefined();
  await narrow.unmount();
  const mid = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(60, 30),
  });
  expect(await mid.find({ text: "1h00" })).toBeDefined();
  expect(await mid.find({ text: /#1 Task 1/ })).toBeDefined();
});

test("toasts: none for what stood at start, then one per task and state", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "completed"), T("2", "pending"), T("3", "pending")], 1);
  await start($, clock);
  expect(h.toasts).toEqual([]);
  writeTasks(
    h,
    [T("1", "completed"), T("2", "completed"), T("3", "waiting")],
    2,
  );
  await clock.advance(3_000);
  expect(h.toasts).toEqual([
    "#2 Task 2 : terminée",
    "#3 Task 3 : bloquée, en attente",
  ]);
  writeTasks(
    h,
    [
      T("1", "completed"),
      T("2", "completed"),
      T("3", "waiting", { subject: "x" }),
    ],
    3,
  );
  await clock.advance(3_000);
  expect(h.toasts).toHaveLength(2);
});

test("a silent task is toasted once, when it turns silent", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  await start($, clock);
  await clock.advance(9 * 60_000);
  expect(h.toasts).toEqual([]);
  await clock.advance(2 * 60_000);
  expect(h.toasts).toEqual([
    "#1 Task 1 : silencieuse, aucune activité depuis 10 min",
  ]);
  await clock.advance(10 * 60_000);
  expect(h.toasts).toHaveLength(1);
});

test("CI is asked at most every five minutes, and only for cited pull requests", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(
    h,
    [
      T("1", "in_progress", { description: PR }),
      T("2", "completed", { subject: "https://github.com/a/b/pull/9" }),
    ],
    1,
  );
  await start($, clock);
  expect(h.runs).toHaveLength(1);
  await clock.advance(4 * 60_000);
  expect(h.runs).toHaveLength(1);
  await clock.advance(60_000 + 3_000);
  expect(h.runs).toHaveLength(2);
  expect(h.runs.every((a) => a.join(" ") === `gh pr checks ${PR}`)).toBe(true);
});

test("/hud opens the panes asked, /hud off closes them", async ($, on) => {
  const { h, clock } = host(on);
  const closed: string[] = [];
  on("ui.close", async (_$: any, e: any) => {
    closed.push(e.id);
    return { value: undefined };
  });
  await start($, clock);
  h.opened = [];
  const r: any = await $.command.run({ command: "hud", args: "agents" } as any);
  expect(h.opened).toEqual(["hud-agents"]);
  expect(r.text).toContain("Agents");
  await $.command.run({ command: "hud", args: "off" } as any);
  expect(closed.sort()).toEqual(["hud-agents", "hud-tasks"]);
});

test("no tasks.json: the board says so", async ($, on) => {
  const { clock } = host(on);
  await start($, clock);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(80),
  });
  expect(await ui.find({ text: /Aucune liste de tâches/ })).toBeDefined();
});

test("a commit turns the loop's writes green, with no process run and no scan", async ($, on) => {
  const { h, clock } = host(on);
  on("fs.list", async () => {
    throw new Error("the mod must not list folders");
  });
  await start($, clock);
  await $.tool.call({ tool: "Write", file_path: "/w/repo/a.ts", content: "x" } as any);
  await $.tool.call({ tool: "Bash", command: "git -C /w/repo commit -am x" } as any);
  expect(h.runs).toEqual([]);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-agents",
    props: PANE(80),
  });
  const mark = await ui.find({ type: "Text", text: "C " });
  expect(mark?.props.color).toBe("#5faf5f");
});
