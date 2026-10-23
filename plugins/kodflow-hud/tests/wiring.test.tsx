// wiring.test.tsx — the hooks module under `claude plugin test`: the
// engine's own `$` over the plugin, the host beneath it in memory (files,
// agents, commands, toasts) and the clock moved by the test.
import { test, expect } from "claude-code/testing";

import { NOW, PANE, PR, SEC, T, host, start, writeTasks } from "./host.ts";
import { capture, widths } from "./capture.ts";
import { colorOf } from "../hooks/mod/who.ts";

test("session start registers /hud, opens « Tâches » alone, in front, counted, and reads tasks.json", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "completed")], 1);
  await start($, clock);
  expect(h.commands).toEqual(["hud"]);
  // The main loop alone: no Agents tab, and « Tâches » is the view shown
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (1)" }]);
  expect(h.shown).toBe("hud-tasks");
  expect(h.opened).not.toContain("hud-agents");
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

test("a tool call goes back untouched", async ($, on) => {
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
});

test("a refused call goes back refused", async ($, on) => {
  on("tool.call", { tool: "Write" }, async () => ({ deny: "no" }));
  const { clock } = host(on);
  await start($, clock);
  const r: any = await $.tool.call({
    tool: "Write",
    file_path: "/w/repo/x",
    content: "",
  } as any);
  expect(r.deny ?? r.text).toContain("no");
});

test("one pane only: subagents open no tab, an Agents tab left by an earlier version is closed, « Tâches » counts and stays in front", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "pending")], 1);
  // An earlier version's Agents tab, still open when this one loads
  h.panes.push({ id: "hud-agents", title: "Agents (1)" });
  await start($, clock);
  h.agents = [
    { id: "a1", type: "general-purpose", name: "hud", status: "running" },
  ];
  await clock.advance(3_000);
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (2)" }]);
  expect(h.shown).toBe("hud-tasks");
  expect(h.closed).toContain("hud-agents");
  expect(h.opened).not.toContain("hud-agents");
  // A task done: the count follows
  writeTasks(h, [T("1", "completed"), T("2", "pending")], 2);
  await clock.advance(3_000);
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (1)" }]);
  // Nothing draws the old pane any more
  let drew = true;
  try {
    const ui = await $.ui.mount({
      plugin: "kodflow-hud",
      surface: "terminal",
      component: "Pane",
      requestId: "hud-agents",
      props: PANE(80),
    });
    drew = (await ui.find({ text: /principal/ })) !== undefined;
  } catch {
    drew = false;
  }
  expect(drew).toBe(false);
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

test("/hud opens « Tâches », whatever follows it, /hud off closes it", async ($, on) => {
  const { h, clock } = host(on);
  await start($, clock);
  await $.command.run({ command: "hud", args: "off" } as any);
  expect(h.closed).toEqual(["hud-tasks"]);
  expect(h.panes).toEqual([]);
  h.opened = [];
  h.agents = [{ id: "a1", type: "Explore", status: "running" }];
  let r: any = await $.command.run({ command: "hud", args: "" } as any);
  expect(h.opened).toEqual(["hud-tasks"]);
  expect(r.text).toContain("Tâches");
  // The old « /hud agents » opens the tasks too, never an Agents tab
  r = await $.command.run({ command: "hud", args: "agents" } as any);
  expect(h.opened).toEqual(["hud-tasks", "hud-tasks"]);
  await clock.advance(3_000);
  expect(h.panes.map((p) => p.id)).toEqual(["hud-tasks"]);
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

test("a tool call runs no process and looks at no folder: the loop is stamped alive, nothing more", async ($, on) => {
  const { h, clock } = host(on);
  on("fs.list", async () => {
    throw new Error("the mod must not list folders");
  });
  await start($, clock);
  h.looked = [];
  await $.tool.call({
    tool: "Write",
    file_path: "/w/repo/a.ts",
    content: "x",
  } as any);
  await $.tool.call({
    tool: "Bash",
    command: "git -C /w/repo commit -am x",
  } as any);
  expect(h.runs).toEqual([]);
  expect(h.looked).toEqual([]);
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
  console.log(first);
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches" }]);
  await clock.advance(20 * 60_000);
  expect(await drawn()).toContain("◆ #2     SDK status-line");
  // Past 30 minutes since the last one was done: today's board, the file untouched
  await clock.advance(11 * 60_000);
  expect(await drawn()).not.toContain("SDK status-line");
});
