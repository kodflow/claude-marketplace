// wiring.test.tsx — the hooks module under `claude plugin test`: the
// engine's own `$` over the plugin, the host beneath it in memory (files,
// agents, commands, toasts) and the clock moved by the test.
import { test, expect } from "claude-code/testing";

import { NOW, PANE, PR, SEC, T, TASKS, host, start, writeTasks } from "./host.ts";
import { capture, widths } from "./capture.ts";
import { colorOf } from "../hooks/mod/who.ts";
import { tasksTitle } from "../hooks/mod/register.tsx";
import { STATUS_TORN, STATUS_V1 } from "./hunt-fixtures.ts";

// Hundreds of polls on the mocked clock: past the kit's 5 s on a slow machine
// running every test file at once
const SLOW = { timeoutMs: 20_000 };

test("session start registers /hud, opens « Tâches » alone, in front, counted, and reads tasks.json", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "completed")], 1);
  await start($, clock);
  expect(h.commands).toEqual(["hud"]);
  // The only pane: the first tab and the one shown
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (1)\u2007" }]);
  expect(h.shown).toBe("hud-tasks");
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(100),
  });
  const text = capture(await ui.drawn({ in: "tree" }));
  expect(text).toContain("◆ #2     SDK status-line");
  expect(text).toContain("├─ ● #1     Task 1");
  // The section names the epic, not the tab again; its progress by the title
  expect(text.split("\n")[0]).toMatch(/^─ #2 SDK status-line ─/);
  expect(text).toContain("◆ #2     SDK status-line  1/2");
  await ui.unmount();
});

// What the module recorded, as KODFLOW_HUD_TRACE writes it at the end
const TRACE = "/tmp/hud-trace.json";
const lastOf = async ($: any, h: any) => {
  await $.session.end({ reason: "other" } as any);
  return JSON.parse(h.files.get(TRACE)!.text).activity;
};

test("a tool call goes back untouched, and dates its loop's last call", async ($, on) => {
  const { h, clock } = host(on, { env: { KODFLOW_HUD_TRACE: TRACE } });
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
  await clock.advance(5_000);
  await $.tool.call({ tool: "Read", file_path: "x", agentId: "a1" } as any);
  expect(await lastOf($, h)).toEqual({
    main: { agentId: "main", last: NOW },
    a1: { agentId: "a1", last: NOW + 5_000 },
  });
});

test("a refused call is not recorded", async ($, on) => {
  on("tool.call", { tool: "Write" }, async () => ({ deny: "no" }));
  const { h, clock } = host(on, { env: { KODFLOW_HUD_TRACE: TRACE } });
  await start($, clock);
  const r: any = await $.tool.call({
    tool: "Write",
    file_path: "/w/repo/x",
    content: "",
  } as any);
  expect(r.deny ?? r.text).toContain("no");
  expect(await lastOf($, h)).toEqual({});
});

test("the tab keeps its width as the count moves, so the tabs beside do not shift", () => {
  const board = (n: number) => ({
    found: true,
    epics: [
      {
        id: 1,
        title: "e",
        tasks: Array.from({ length: n }, (_, i) => ({
          id: String(i + 1),
          subject: "t",
          status: "pending",
        })),
      },
    ],
  });
  const widths = [0, 1, 9, 10, 42, 99].map(
    (n) => tasksTitle(board(n) as any).length,
  );
  expect(new Set(widths).size).toBe(1);
});

test("the worker, the age, the silent flag, the person's task and CI, in the tree", async ($, on) => {
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
    props: PANE(88, 20),
  });
  const lines = capture(await ui.drawn({ in: "tree" })).split("\n");
  // A subagent: « ↳ name · role », in its own colour
  expect(lines.find((l) => l.includes("Task 2"))).toMatch(
    /● #2 +Task 2 +↳ hud · general +2 min/,
  );
  const colorOfText = async (text: string) =>
    (await ui.findAll({ in: "tree", type: "Text", text }))
      .map((t: any) => t.props.color)
      .find(Boolean);
  expect(await colorOfText("hud")).toBe(colorOf("a1"));
  // #3 belongs to the main loop, quiet for an hour: silent, its age in red
  expect(lines.find((l) => l.includes("Task 3"))).toMatch(
    /◉ principal +opus +1 h$/,
  );
  expect(await colorOfText("principal")).toBe("claude");
  const ages = await ui.findAll({ in: "tree", type: "Text", text: "1 h" });
  expect(ages.some((a: any) => a.props.color === "error" && a.props.bold)).toBe(
    true,
  );
  // The person's task is theirs: « toi »
  expect(lines.find((l) => l.includes("Task 4"))).toMatch(/◇ #4 +Task 4 +toi/);
  // CI of the cited pull request, asked once, on the selected task's detail
  expect(h.runs).toEqual([["gh", "pr", "checks", PR]]);
  await ui.redraw();
  expect(capture(await ui.drawn({ in: "tree" }))).toContain("CI ✓");
});

test("a narrow, short pane still draws every line at its width", async ($, on) => {
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
  for (const [columns, rows] of [
    [40, 8],
    [30, 3],
  ] as const) {
    const ui = await $.ui.mount({
      plugin: "kodflow-hud",
      surface: "terminal",
      component: "Pane",
      requestId: "hud-tasks",
      props: PANE(columns, rows),
    });
    const tree = await ui.drawn({ in: "tree" });
    expect(widths(tree)).toEqual(Array(rows).fill(columns));
    expect(capture(tree)).toContain("Task 3");
    await ui.unmount();
  }
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

test(
  "a silent task is toasted once, when it turns silent",
  SLOW,
  async ($, on) => {
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
  },
);

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
  expect(
    await ui.find({ in: "tree", text: /Aucune liste de tâches/ }),
  ).toBeDefined();
});

test("an epic whose last task was just done stays 20 minutes, in the tree, then goes with no change to tasks.json", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "completed"), T("2", "completed")], 1);
  await start($, clock);
  const drawn = async () => {
    const ui = await $.ui.mount({
      plugin: "kodflow-hud",
      surface: "terminal",
      component: "Pane",
      requestId: "hud-tasks",
      props: PANE(100),
    });
    const text = capture(await ui.drawn({ in: "tree" }));
    await ui.unmount();
    return text;
  };
  const first = await drawn();
  expect(first).toContain("◆ #2     SDK status-line");
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (0)\u2007" }]);
  await clock.advance(20 * 60_000);
  expect(await drawn()).toContain("◆ #2     SDK status-line");
  // Past 30 minutes since the last one was done: today's board, the file untouched
  await clock.advance(11 * 60_000);
  expect(await drawn()).not.toContain("SDK status-line");
});

// --- « Chasse »: /hunt's files, read on their own -------------------------------

const HUNT = "/u/dev/.local/state/hunt";
const ACTIVE = `${HUNT}/active.json`;
const STATUS = `${HUNT}/payments-ledger/status.json`;
const activeJson = (created = NOW - 3_600_000) =>
  JSON.stringify({
    v: 1,
    hunts: [{ slug: "payments-ledger", created, beat: NOW, state: "hunting" }],
  });
const statusJson = (seq: number, events: object[]) =>
  JSON.stringify({ ...JSON.parse(STATUS_V1), beat: NOW, seq, events });
const ev = (seq: number, kind = "confirmed") => ({
  seq,
  kind,
  text: `core #${seq}`,
});
const barOf = async ($: any) => {
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(88, 20),
  });
  const lines = capture(await ui.drawn({ in: "tree" })).split("\n");
  await ui.unmount();
  return lines;
};

test("a corrupt status.json says « état illisible » in « Chasse », and the Tasks pane keeps updating", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  h.files.set(ACTIVE, { text: activeJson(), mtimeMs: 1 });
  h.files.set(STATUS, { text: STATUS_TORN, mtimeMs: 1 });
  await start($, clock);
  expect((await barOf($))[19]).toContain("Chasse ?");
  // the tasks move on: the tab's count and the tree follow, whatever /hunt holds
  writeTasks(
    h,
    [T("1", "completed"), T("2", "in_progress"), T("3", "pending")],
    2,
  );
  await clock.advance(3_000);
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (2) " }]);
  expect(h.toasts).toEqual(["#1 Task 1 : terminée"]);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(88, 20),
  });
  expect(capture(await ui.drawn({ in: "tree" }))).toContain("Task 3");
  await ui.pointer({ type: "down", x: 10, y: 19, button: "left" });
  expect(capture(await ui.drawn({ in: "tree" }))).toMatch(
    /état +état illisible/,
  );
});

test("a hunt's events toasted in the session: none at the first read, then ≤3 and « +N autres »", async ($, on) => {
  const { h, clock } = host(on);
  h.files.set(ACTIVE, { text: activeJson(), mtimeMs: 1 });
  h.files.set(STATUS, { text: statusJson(10, [ev(9), ev(10)]), mtimeMs: 1 });
  await start($, clock);
  expect(h.toasts).toEqual([]);
  h.files.set(STATUS, {
    text: statusJson(15, [
      ev(10),
      ev(11),
      ev(12, "pause"),
      ev(13),
      ev(14),
      ev(15),
    ]),
    mtimeMs: 1,
  });
  await clock.advance(3_000);
  expect(h.toasts).toEqual([
    "Chasse payments-ledger · confirmée : core #11",
    "Chasse payments-ledger · confirmée : core #13",
    "Chasse payments-ledger · confirmée : core #14",
    "Chasse : +1 autres",
  ]);
  // the same file again: nothing more; a reused slug starts over
  await clock.advance(3_000);
  expect(h.toasts).toHaveLength(4);
  h.files.set(ACTIVE, { text: activeJson(NOW), mtimeMs: 2 });
  h.files.set(STATUS, { text: statusJson(1, [ev(1)]), mtimeMs: 2 });
  await clock.advance(3_000);
  expect(h.toasts.slice(4)).toEqual([
    "Chasse payments-ledger · confirmée : core #1",
  ]);
});

test(
  "the option hunt off: no « Chasse », no toast",
  { options: { hunt: false } },
  async ($, on) => {
    const { h, clock } = host(on);
    h.files.set(ACTIVE, { text: activeJson(), mtimeMs: 1 });
    h.files.set(STATUS, { text: statusJson(10, [ev(10)]), mtimeMs: 1 });
    await start($, clock);
    h.files.set(STATUS, { text: statusJson(11, [ev(11)]), mtimeMs: 1 });
    await clock.advance(3_000);
    expect((await barOf($))[19]).not.toContain("Chasse");
    expect(h.toasts).toEqual([]);
  },
);

test("KODFLOW_HUD_HUNT=off: no « Chasse », no toast", async ($, on) => {
  const { h, clock } = host(on, { env: { KODFLOW_HUD_HUNT: "off" } });
  h.files.set(ACTIVE, { text: activeJson(), mtimeMs: 1 });
  h.files.set(STATUS, { text: statusJson(10, [ev(10)]), mtimeMs: 1 });
  await start($, clock);
  h.files.set(STATUS, { text: statusJson(11, [ev(11)]), mtimeMs: 1 });
  await clock.advance(3_000);
  expect((await barOf($))[19]).not.toContain("Chasse");
  expect(h.toasts).toEqual([]);
});

// --- the epics' lifecycle, the subagents' own tasks, who stands ------------------

const mountTree = async ($: any, w = 100, rows = 30) =>
  $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(w, rows),
  });
const shownText = async ($: any, w = 100, rows = 30) => {
  const ui = await mountTree($, w, rows);
  const text = capture(await ui.drawn({ in: "tree" }));
  await ui.unmount();
  return text;
};
/** A subagent's own task, filed under no epic as kodflow-hooks keeps it. */
const S = (id: string, agent: string, status: string, over: object = {}) => ({
  ...T(id, status, over),
  agent,
  epic: 0,
});
const writeFile = (h: any, file: object, mtimeMs: number) =>
  h.files.set(TASKS, { text: JSON.stringify(file), mtimeMs });

const epicsFile = (tasks: object[], epics?: object[]) => ({
  version: 2,
  active: { main: 2 },
  epics: epics ?? [
    { id: 2, agent: "main", title: "SDK status-line", created: SEC, touched: SEC },
  ],
  tasks,
});

test("a subagent's tasks hang on the task it was handed: one summary line, no row of their own", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [{ id: "a1", type: "general-purpose", name: "impl", status: "running" }];
  writeFile(
    h,
    epicsFile([
      T("1", "in_progress", { worker: "impl", worker_id: "a1", workers: ["a1"] }),
      S("7", "a1", "in_progress", { subject: "Wire probe" }),
      S("8", "a1", "completed", { subject: "Read spec" }),
    ]),
    1,
  );
  await start($, clock);
  const text = await shownText($);
  expect(text).toContain("↳ sous-agents : 2 tâches (1 faite) · en cours #7 Wire probe");
  expect(text).not.toContain("Read spec");
  // Counted in the tab with the main tasks, never as an epic of their own
  expect(h.panes[0]!.title).toBe("Tâches (2) ");
  expect(text).not.toContain("Sous-agents");
});

test("an orphan: one toast, no row; the summary counts it stopped", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [{ id: "a1", type: "general-purpose", status: "running" }];
  writeFile(
    h,
    epicsFile([
      T("1", "in_progress", { worker_id: "a1", workers: ["a2", "a1"] }),
      S("7", "a1", "pending", { subject: "Next step" }),
    ]),
    1,
  );
  await start($, clock);
  expect(h.toasts).toEqual([]);
  // a2 left a task in progress, and is no longer listed
  writeFile(
    h,
    epicsFile([
      T("1", "in_progress", { worker_id: "a1", workers: ["a2", "a1"] }),
      S("7", "a1", "pending", { subject: "Next step" }),
      S("9", "a2", "in_progress", { subject: "Left behind" }),
    ]),
    2,
  );
  await clock.advance(3_000);
  expect(h.toasts).toEqual(["#9 Left behind : silencieuse, son worker est arrêté"]);
  await clock.advance(30_000);
  expect(h.toasts).toHaveLength(1);
  const text = await shownText($);
  expect(text).not.toContain("Left behind");
  expect(text).toContain("1 arrêtée");
  expect(h.panes[0]!.title).toBe("Tâches (2) ");
});

test("no task names the subagent: its tasks form « Sous-agents », which counts the stopped ones", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [{ id: "a1", type: "Explore", status: "running" }];
  writeFile(
    h,
    epicsFile([
      T("1", "pending"),
      S("7", "a1", "in_progress", { subject: "Looking around" }),
      S("8", "a3", "pending", { subject: "Lost one" }),
    ]),
    1,
  );
  await start($, clock);
  const text = await shownText($);
  expect(text).toMatch(/Sous-agents.*1 arrêtée/);
  expect(text).toContain("Looking around");
  expect(text).not.toContain("Lost one");
});

test("the anchor done while its helper still runs: the summary stays under it", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [{ id: "a1", type: "general-purpose", status: "running" }];
  writeFile(
    h,
    epicsFile([
      T("1", "completed", { workers: ["a1"] }),
      T("2", "pending"),
      S("7", "a1", "in_progress", { subject: "Still going" }),
    ]),
    1,
  );
  await start($, clock);
  const lines = (await shownText($)).split("\n");
  const at = lines.findIndex((l) => l.includes("Task 1"));
  expect(lines[at + 1]).toContain("↳ sous-agents : 1 tâche · en cours #7 Still going");
});

test("$.agent.list() failing: no toast, no key written, the agents kept, nobody stopped", async ($, on) => {
  const { h, clock } = host(on, { env: { KODFLOW_HUD_TRACE: "/tmp/hud-trace.json" } });
  h.agents = [{ id: "a1", type: "general-purpose", name: "impl", status: "running" }];
  writeFile(
    h,
    epicsFile([
      T("1", "in_progress", { worker: "impl", worker_id: "a1", workers: ["a1"] }),
      T("2", "pending"),
      S("7", "a1", "in_progress", { subject: "Helper work" }),
    ]),
    1,
  );
  await start($, clock);
  h.agentsFail = true;
  writeFile(
    h,
    epicsFile([
      T("1", "in_progress", { worker: "impl", worker_id: "a1", workers: ["a1"] }),
      T("2", "completed"),
      S("7", "a1", "in_progress", { subject: "Helper work" }),
    ]),
    2,
  );
  await clock.advance(30 * 60_000);
  expect(h.toasts).toEqual([]);
  const text = await shownText($);
  // The worker is still named from the list kept, and is not « figé »
  expect(text).toContain("↳ impl");
  expect(text).toContain("état inconnu");
  await $.session.end({ reason: "other" } as any);
  const trace = JSON.parse(h.files.get("/tmp/hud-trace.json")!.text);
  expect(trace.agents.map((a: any) => a.id)).toEqual(["a1"]);
  // The list back: that poll is the reference, what ended meanwhile is not toasted
  h.agentsFail = false;
  await clock.advance(3_000);
  expect(h.toasts).toEqual([]);
});

test("a reload after a failed poll: the outage read from $.state, its completions not toasted", async ($, on) => {
  // What a failed poll leaves in $.state, as a fresh copy of the module
  // finds it after a reload: its own variables start over, the state does
  // not. The kit's state stands beneath this hook: it answers « unknown »
  // for the liveness until the module writes it again
  let reloaded = false;
  on("state.get", async (_$: any, e: any, next: any) => {
    const r = await next(e);
    return reloaded && e.plugin === "kodflow-hud" && e.key === "liveness"
      ? { ...r, value: { ...r.value, value: "unknown" } }
      : r;
  });
  on("state.set", async (_$: any, e: any, next: any) => {
    if (e.plugin === "kodflow-hud" && e.key === "liveness") reloaded = false;
    return next(e);
  });
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "pending"), T("2", "pending")], 1);
  await start($, clock);
  reloaded = true;
  writeTasks(h, [T("1", "completed"), T("2", "pending")], 2);
  await clock.advance(3_000);
  expect(h.toasts).toEqual([]);
  // Back to normal: the next change is news again
  writeTasks(h, [T("1", "completed"), T("2", "completed")], 3);
  await clock.advance(3_000);
  expect(h.toasts).toEqual(["#2 Task 2 : terminée"]);
});

test("the first poll after a session change cannot read the agents: the board shows, no toast, the next poll is the reference", async ($, on) => {
  let session = "sess-1";
  const { h, clock } = host(on, { session: () => session });
  writeTasks(h, [T("1", "in_progress")], 1);
  await start($, clock);
  session = "sess-2";
  h.agentsFail = true;
  h.files.set("/cfg/kodflow/sessions/sess-2/tasks.json", {
    text: JSON.stringify(epicsFile([T("1", "completed"), T("2", "pending")])),
    mtimeMs: 1,
  });
  await clock.advance(3_000);
  expect(h.toasts).toEqual([]);
  expect(await shownText($)).toContain("Task 2");
  h.agentsFail = false;
  await clock.advance(3_000);
  // The baseline of the new session: what stood is recorded, not toasted
  expect(h.toasts).toEqual([]);
});

test("a closed epic: no row, no toast, no CI, no count", async ($, on) => {
  const { h, clock } = host(on);
  writeFile(
    h,
    epicsFile(
      [T("1", "pending"), T("3", "pending", { epic: 4, description: PR })],
      [
        { id: 2, agent: "main", title: "SDK status-line", created: SEC, touched: SEC },
        { id: 4, agent: "main", title: "Shut", created: SEC, touched: SEC, closed_at: SEC },
      ],
    ),
    1,
  );
  await start($, clock);
  writeFile(
    h,
    epicsFile(
      [T("1", "pending"), T("3", "completed", { epic: 4, description: PR })],
      [
        { id: 2, agent: "main", title: "SDK status-line", created: SEC, touched: SEC },
        { id: 4, agent: "main", title: "Shut", created: SEC, touched: SEC, closed_at: SEC },
      ],
    ),
    2,
  );
  await clock.advance(6 * 60_000);
  expect(h.toasts).toEqual([]);
  expect(h.runs).toEqual([]);
  expect(h.panes[0]!.title).toBe("Tâches (1) ");
  expect(await shownText($)).not.toContain("Shut");
});

test("an idle epic is one line; ⏎ or a click opens it", async ($, on) => {
  const { h, clock } = host(on);
  const old = SEC - 2 * 86_400;
  writeFile(
    h,
    epicsFile(
      [
        T("1", "pending", { updated: old }),
        T("2", "pending", { epic: 5, subject: "Fresh" }),
      ],
      [
        { id: 2, agent: "main", title: "SDK status-line", created: old, touched: old },
        { id: 5, agent: "main", title: "Today", created: SEC, touched: SEC },
      ],
    ),
    1,
  );
  await start($, clock);
  const ui = await mountTree($);
  let text = capture(await ui.drawn({ in: "tree" }));
  expect(text).toMatch(/◆ #2 +SDK status-line +0\/1 · actif · inactive ▸/);
  expect(text).not.toContain("Task 1");
  const y = text.split("\n").findIndex((l) => l.includes("inactive ▸"));
  await ui.pointer({ type: "down", x: 12, y, button: "left" });
  text = capture(await ui.drawn({ in: "tree" }));
  expect(text).toContain("inactive ▾");
  expect(text).toContain("Task 1");
  await ui.key({ key: "return", in: "tree" });
  expect(capture(await ui.drawn({ in: "tree" }))).not.toContain("Task 1");
});

test("a selection the tree no longer shows moves to the active epic's first task", async ($, on) => {
  const { h, clock } = host(on);
  const epics = (closedAt?: number) => [
    { id: 2, agent: "main", title: "SDK status-line", created: SEC, touched: SEC },
    { id: 4, agent: "main", title: "Other", created: SEC + 1, touched: SEC, ...(closedAt && { closed_at: closedAt }) },
  ];
  writeFile(h, epicsFile([T("1", "pending"), T("3", "pending", { epic: 4, subject: "Elsewhere" })], epics()), 1);
  await start($, clock);
  const ui = await mountTree($);
  const lines = capture(await ui.drawn({ in: "tree" })).split("\n");
  await ui.pointer({ type: "down", x: 12, y: lines.findIndex((l) => l.includes("Elsewhere")), button: "left" });
  expect(capture(await ui.drawn({ in: "tree" }))).toMatch(/▶ #3 +Elsewhere +prête/);
  writeFile(h, epicsFile([T("1", "pending"), T("3", "pending", { epic: 4, subject: "Elsewhere" })], epics(SEC)), 2);
  await clock.advance(3_000);
  await ui.redraw();
  const now = capture(await ui.drawn({ in: "tree" }));
  expect(now).not.toContain("Elsewhere");
  // The detail line speaks of the active epic's first task
  expect(now).toMatch(/▶ #1  Task 1/);
});

test("an empty board drawn once, then the full one: the first task is chosen", async ($, on) => {
  const { h, clock } = host(on);
  await start($, clock);
  const ui = await mountTree($);
  expect(await ui.find({ in: "tree", text: /Aucune liste de tâches/ })).toBeDefined();
  await ui.key({ key: "down", in: "tree" });
  writeTasks(h, [T("1", "in_progress"), T("2", "pending")], 1);
  await clock.advance(3_000);
  await ui.redraw();
  const text = capture(await ui.drawn({ in: "tree" }));
  expect(text).toMatch(/● #1  Task 1/);
});
