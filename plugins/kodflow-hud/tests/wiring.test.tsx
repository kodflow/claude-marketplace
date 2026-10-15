// wiring.test.tsx — the hooks module under `claude plugin test`: the
// engine's own `$` over the plugin, the host beneath it in memory (files,
// agents, commands, toasts) and the clock moved by the test.
import { test, expect } from "claude-code/testing";

import {
  NOW,
  PANE,
  PR,
  SEC,
  T,
  host,
  start,
  writeTasks,
} from "./host.ts";
import { capture, widths } from "./capture.ts";

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
  const text = capture(await ui.drawn({ in: "tree" }));
  expect(text).toContain("◆ #2     SDK status-line");
  expect(text).toContain("└─ ● #1     Task 1");
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
  expect(lines.find((l) => l.includes("Task 2"))).toMatch(/● #2 +Task 2 +hud +2 min/);
  // #3 belongs to the main loop, quiet for an hour: silent, its age in red
  expect(lines.find((l) => l.includes("Task 3"))).toMatch(/main +opus +1 h$/);
  const ages = await ui.findAll({ in: "tree", type: "Text", text: "1 h" });
  expect(ages.some((a: any) => a.props.color === "error" && a.props.bold)).toBe(true);
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
  for (const [columns, rows] of [[40, 8], [30, 3]] as const) {
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
  expect(
    await ui.find({ in: "tree", text: /Aucune liste de tâches/ }),
  ).toBeDefined();
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
