// wiring.test.tsx — the hooks module under `claude plugin test`: the
// engine's own `$` over the plugin, the host beneath it in memory (files,
// agents, commands, toasts) and the clock moved by the test.
import { test, expect } from "claude-code/testing";

import { NOW, PANE, PR, SEC, T, host, start, writeTasks } from "./host.ts";
import { capture, widths } from "./capture.ts";
import { colorOf } from "../hooks/mod/who.ts";
import { agentsTitle, tasksTitle } from "../hooks/mod/register.tsx";

test("session start registers /hud, opens « Tâches » alone, in front, counted, and reads tasks.json", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "completed")], 1);
  await start($, clock);
  expect(h.commands).toEqual(["hud"]);
  // The main loop alone: no Agents tab, and « Tâches » is the view shown
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (1)\u2007" }]);
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
  // The main loop is listed, with no folder and no file
  expect(await ui.find({ text: /principal/ })).toBeDefined();
  expect(await ui.find({ text: "/w/repo" })).toBeUndefined();
  expect(await ui.find({ text: "x" })).toBeUndefined();
});

test("the Agents tab: none for the main loop, opened and counted with the subagents, gone with the last; « Tâches » stays in front", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "pending")], 1);
  await start($, clock);
  expect(h.panes.map((p) => p.id)).toEqual(["hud-tasks"]);
  // A subagent starts: the tab opens, counted, and « Tâches » is shown again
  // (the host raises every pane it opens, the worst case)
  h.agents = [
    { id: "a1", type: "general-purpose", name: "hud", status: "running" },
    { id: "a2", type: "Explore", status: "completed" },
  ];
  await clock.advance(3_000);
  expect(h.panes).toEqual([
    { id: "hud-tasks", title: "Tâches (2)\u2007" },
    { id: "hud-agents", title: "Agents (1)\u2007" },
  ]);
  expect(h.shown).toBe("hud-tasks");
  // A second one: the count follows, still behind « Tâches »
  h.agents = [
    ...h.agents,
    {
      id: "a3",
      type: "kodflow-specialists:devops-specialist-hashicorp",
      status: "waiting",
    },
  ];
  await clock.advance(3_000);
  expect(h.panes[1]).toEqual({ id: "hud-agents", title: "Agents (2)\u2007" });
  expect(h.shown).toBe("hud-tasks");
  // A task done: the Tâches count follows too
  writeTasks(h, [T("1", "completed"), T("2", "pending")], 2);
  await clock.advance(3_000);
  expect(h.panes[0]).toEqual({ id: "hud-tasks", title: "Tâches (1)\u2007" });
  // The last subagent ends: the tab goes
  h.agents = h.agents.map((a) => ({ ...a, status: "completed" }));
  await clock.advance(3_000);
  expect(h.panes.map((p) => p.id)).toEqual(["hud-tasks"]);
  expect(h.shown).toBe("hud-tasks");
});

test("the keyboard switches the tabs: `a` in « Tâches » shows « Agents », `t` in « Agents » shows « Tâches »", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  h.agents = [{ id: "a1", type: "Explore", name: "e", status: "running" }];
  await start($, clock);
  await clock.advance(3_000);
  expect(h.panes.map((p) => p.id)).toEqual(["hud-tasks", "hud-agents"]);
  expect(h.shown).toBe("hud-tasks");
  const tasks = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(88, 20),
  });
  // The tree's own key listener: `a` posts, the hooks module opens Agents
  await tasks.key({ key: "a", in: "tree" });
  expect(h.shown).toBe("hud-agents");
  // A modified `a` is not the switch
  h.shown = "hud-tasks";
  await tasks.key({ key: "a", ctrl: true, in: "tree" });
  expect(h.shown).toBe("hud-tasks");
  await tasks.unmount();
  // The Agents pane's way back: a Button on its last row, hotkey `t`
  const agents = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-agents",
    props: { ...PANE(88, 12), title: "Agents (1)\u2007" },
  });
  const back = await agents.find({ type: "Button", key: "show-tasks" });
  expect(back?.props.hotkey).toBe("t");
  h.shown = "hud-agents";
  await agents.press({ key: "show-tasks" });
  expect(h.shown).toBe("hud-tasks");
  await agents.unmount();
  // No subagent: `a` opens nothing and says why
  h.agents = [];
  await clock.advance(3_000);
  expect(h.panes.map((p) => p.id)).toEqual(["hud-tasks"]);
  const again = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(88, 20),
  });
  h.opened = [];
  await again.key({ key: "a", in: "tree" });
  expect(h.opened).toEqual([]);
  expect(h.toasts.at(-1)).toContain("aucun sous-agent");
});

test("a session that starts with both tabs up, « Agents » in front, starts on « Tâches »", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [{ id: "a1", type: "Explore", status: "running" }];
  h.panes = [
    { id: "hud-tasks", title: "Tâches" },
    { id: "hud-agents", title: "Agents (1)\u2007" },
  ];
  h.shown = "hud-agents";
  await start($, clock);
  expect(h.shown).toBe("hud-tasks");
  await clock.advance(3_000);
  expect(h.shown).toBe("hud-tasks");
});

test("autoOpen off, a session start with « Tâches » still up brings it to the front", { options: { autoOpen: false } }, async ($, on) => {
  const { h, clock } = host(on);
  h.panes = [
    { id: "hud-tasks", title: "Tâches" },
    { id: "hud-agents", title: "Agents (1)\u2007" },
  ];
  h.shown = "hud-agents";
  h.agents = [{ id: "a1", type: "Explore", status: "running" }];
  await start($, clock);
  expect(h.shown).toBe("hud-tasks");
});

test("a click on a tab stands: a retitle running at that moment does not take the person back", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "pending")], 1);
  h.agents = [{ id: "a1", type: "Explore", status: "running" }];
  await start($, clock);
  await clock.advance(3_000);
  expect(h.shown).toBe("hud-tasks");
  // A task is done, so the poll retitles « Tâches »; while it does, the
  // person clicks the Agents tab
  writeTasks(h, [T("1", "completed"), T("2", "pending")], 2);
  h.afterOpen = (id) => {
    if (id !== "hud-tasks") return;
    h.shown = "hud-agents";
    h.afterOpen = undefined;
  };
  await clock.advance(3_000);
  h.afterOpen = undefined;
  expect(h.shown).toBe("hud-agents");
  // Still, an open of the module's own that raised its pane is undone
  h.shown = "hud-agents";
  writeTasks(h, [T("1", "completed"), T("2", "completed")], 3);
  await clock.advance(3_000);
  expect(h.shown).toBe("hud-agents");
});

test("the tabs keep their width as the counts move, so the tab beside does not shift", () => {
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
  const agents = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `a${i}`,
      label: "x",
      status: "running",
    }));
  const aw = [1, 9, 10, 99].map((n) => agentsTitle(agents(n) as any).length);
  expect(new Set(aw).size).toBe(1);
});

test("/hud off keeps the Agents tab shut while subagents run, until /hud agents", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [{ id: "a1", type: "Plan", name: "p", status: "running" }];
  await start($, clock);
  await clock.advance(3_000);
  expect(h.panes.map((p) => p.id)).toEqual(["hud-tasks", "hud-agents"]);
  expect(h.shown).toBe("hud-tasks");
  await $.command.run({ command: "hud", args: "off" } as any);
  await clock.advance(3_000);
  expect(h.panes).toEqual([]);
  const r: any = await $.command.run({ command: "hud", args: "agents" } as any);
  expect(r.text).toContain("Agents (1)");
  expect(h.panes.map((p) => p.id)).toEqual(["hud-agents"]);
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

test("/hud opens the panes asked, /hud off closes them", async ($, on) => {
  const { h, clock } = host(on);
  await start($, clock);
  h.opened = [];
  // No subagent: nothing to show in Agents, so no tab, and it says why
  let r: any = await $.command.run({ command: "hud", args: "agents" } as any);
  expect(h.opened).toEqual([]);
  expect(r.text).toContain("no subagent is running");
  h.agents = [{ id: "a1", type: "Explore", status: "running" }];
  await clock.advance(3_000);
  h.opened = [];
  r = await $.command.run({ command: "hud", args: "agents" } as any);
  expect(h.opened).toEqual(["hud-agents"]);
  expect(r.text).toContain("Agents (1)");
  await $.command.run({ command: "hud", args: "off" } as any);
  expect(h.closed.sort()).toEqual(["hud-agents", "hud-tasks"]);
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
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-agents",
    props: PANE(80),
  });
  const marks = await ui.findAll({ type: "Text", text: "C" });
  expect(marks.map((m: any) => m.props.color)).toContain("#5faf5f");
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
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (0)\u2007" }]);
  await clock.advance(20 * 60_000);
  expect(await drawn()).toContain("◆ #2     SDK status-line");
  // Past 30 minutes since the last one was done: today's board, the file untouched
  await clock.advance(11 * 60_000);
  expect(await drawn()).not.toContain("SDK status-line");
});
