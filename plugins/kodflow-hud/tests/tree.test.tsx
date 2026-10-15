// tree.test.tsx — the « Tâches » pane's tree and graph, drawn by the engine
// through the plugin, read back as the terminal lays them out (capture.ts).
import { test, expect } from "claude-code/testing";
import { SEC, host, start, tasksJson, PANE, TASKS } from "./host.ts";
import { capture, widths } from "./capture.ts";
import { buildTree, linkCell, modelCell, span } from "../hooks/mod/tree.ts";
import { parseBoard, type Ctx } from "../hooks/mod/board.ts";
import { cells, fit } from "../hooks/mod/width.ts";

const MIN = 60;
const task = (
  id: string,
  subject: string,
  status: string,
  over: object = {},
) => ({
  id,
  agent: "main",
  epic: 1,
  subject,
  status,
  created: SEC - 7200,
  updated: SEC,
  ...over,
});

// The maquette's list: the epic « Routage model/effort », five top-level
// tasks and their subtasks, links between them
const MAQUETTE = [
  task("1", "Événements réels", "completed", {
    ref: "T0",
    updated: SEC - 120 * MIN,
    description: "Payloads réels enregistrés sur la CLI, modes default et auto",
  }),
  task("2", "Fixtures commitées", "completed", {
    parent: "1",
    updated: SEC - 120 * MIN,
  }),
  task("3", "Policy et routage", "completed", {
    ref: "C1–C5",
    updated: SEC - 80 * MIN,
  }),
  task("4", "model-policy ×3", "completed", { parent: "3" }),
  task("5", "Pins 34 agents", "completed", { parent: "3" }),
  task("6", "Porte Fable", "in_progress", {
    ref: "C6",
    blockedBy: ["1"],
    worker: "mkt-routing-pr",
    worker_id: "a1",
    updated: SEC - 12 * MIN,
    description: "Le mod juge, il ne réécrit jamais e.model",
  }),
  task("7", "agent.spawn", "completed", {
    parent: "6",
    updated: SEC - 20 * MIN,
  }),
  task("8", "Grant de session", "in_progress", {
    parent: "6",
    worker: "mkt-routing-pr",
    worker_id: "a1",
    updated: SEC - 3 * MIN,
  }),
  task("9", "Test resume", "completed", {
    parent: "8",
    updated: SEC - 8 * MIN,
  }),
  task("10", "Test parallèle", "pending", { parent: "8", blockedBy: ["8"] }),
  task("11", "Repli shell", "pending", { parent: "6" }),
  task("12", "Feedback agents", "waiting", {
    ref: "C7",
    assignee: "human",
    blockedBy: ["1"],
    updated: SEC - 6 * MIN,
  }),
  task("13", "Spécialistes ×5", "pending", { ref: "C8" }),
  task("14", "ansible", "pending", { parent: "13" }),
  task("15", "CI et PR", "pending", {
    ref: "C9",
    blockedBy: ["6", "12", "13", "3"],
    description: "Livrable : la PR, CI verte sans contournement",
  }),
];

const EPIC = {
  epics: [
    {
      id: 1,
      agent: "main",
      title: "Routage model/effort",
      created: SEC - 112 * MIN,
      touched: SEC,
    },
  ],
  active: { main: 1 },
};

const mount = ($: any, columns: number, rows: number, surface = "terminal") =>
  $.ui.mount({
    plugin: "kodflow-hud",
    surface,
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(columns, rows),
  });

async function seeded($: any, on: any, tasks = MAQUETTE) {
  // The Agent call that started a1: the result says its model, the call its effort
  on("tool.call", { tool: "Agent" }, async () => ({
    result: {
      agentId: "a1",
      resolvedModel: "claude-opus-5-5",
      content: [],
      totalTokens: 1,
    },
  }));
  const { h, clock } = host(on);
  h.agents = [
    {
      id: "a1",
      type: "general-purpose",
      name: "mkt-routing-pr",
      status: "running",
    },
  ];
  h.files.set(TASKS, { text: tasksJson(tasks, EPIC), mtimeMs: 1 });
  await start($, clock);
  await $.tool.call({
    tool: "Agent",
    subagent_type: "general-purpose",
    effort: "xhigh",
    prompt: "p",
    description: "d",
  } as any);
  return { h, clock };
}

// What the pane draws at its minimum, 90 columns with the frame (88 of body)
// by 20 rows: every column a Box of its width, so each line is 88 cells
const R12 = [
  "─ Tâches · #1 Routage model/effort ─────────────────────────────────────────────────────",
  "  TÂCHE                            AGENT              MODÈLE         ÂGE  LIENS",
  "  ◆ #1     Routage model/effort    7 / 15             ━━━━━─────  1 h 52",
  "  ├▸ ✓ T0     Événements réels     main               opus           2 h  ⇢ C6 C7",
  "  ├▸ ✓ C1–C5  Policy et routage    main               opus        1 h 20  ⇢ C9",
  "┃ ├▾ ● C6     Porte Fable          mkt-routing-pr     opus·xhigh  12 min  ⇢ C9",
  "  │  ├─ ✓ agent.spawn              main               opus        20 min",
  "┃ │  ├▾ ● Grant de session         mkt-routing-pr     opus·xhigh   3 min  ⇢ #10",
  "  │  │  ├─ ✓ Test resume           main               opus         8 min",
  "┃ │  │  └─ ⊘ Test parallèle                                               ⇠ #8",
  "  │  └─ ○ Repli shell",
  "┃ ├─ ◇ C7     Feedback agents      toi                             6 min  ⇢ C9",
  "┃ ├▸ ▶ C8     Spécialistes ×5      prête                                  ⇢ C9",
  "┃ └─ ⊘ C9     CI et PR                                                    ⇠ C6 C7 C8",
  "┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄",
  "┃ chemin critique  C6 → C9  ·  C7 → C9  ·  C8 → C9  ·  #8 → #10      bloqué par toi (C7)",
  "● C6  Porte Fable   mkt-routing-pr · opus·xhigh · 12 min · ⇢ C9 · silencieux",
  "  Le mod juge, il ne réécrit jamais e.model",
  "────────────────────────────────────────────────────────────────────────────────────────",
  "Arbre   Graphe                         ↑↓ choisir · ⏎ plier/déplier · tab changer de vue",
].join("\n");

const R4 = [
  "─ Tâches · #1 Routage model/effort ─────────────────────────────────────────────────────",
  "FAIT · PRÊT                    EN COURS · ATTENTE             BLOQUÉ",
  "✓ T0    Événements réels ──┬─▶ ● C6    Porte Fable ───────┐",
  "  main · opus · 2 h        │     mkt-routing-pr · 12 min  │",
  "                           └─▶ ◇ C7    Feedback agents ───┤",
  "                                 attend toi · 6 min       │",
  "✓ C1–C5 Policy et routage ────────────────────────────────┼─▶ ⊘ C9    CI et PR",
  "  main · opus · 1 h 20                                    │     attend C6 C7 C8",
  "▶ C8    Spécialistes ×5 ──────────────────────────────────┘",
  "  prête · personne dessus",
  "",
  "",
  "",
  "",
  "┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄",
  "prochaine action  ▶ C8 prête, personne dessus                     t'attend  ◇ C7 · 6 min",
  "┃ chemin critique  C6 → C9  ·  C7 → C9  ·  C8 → C9  ·  #8 → #10",
  "livrable  ⊘ C9 CI et PR · attend C6 C7 C8",
  "────────────────────────────────────────────────────────────────────────────────────────",
  "Arbre   Graphe                         ↑↓ choisir · ⏎ plier/déplier · tab changer de vue",
].join("\n");

const drawnIn = async (ui: any) => ui.drawn({ in: "tree" });

test("R12 at 90 by 20: the tree, column by column, as the maquette lays it out", async ($, on) => {
  await seeded($, on);
  const ui = await mount($, 88, 20);
  const tree = await drawnIn(ui);
  expect(capture(tree)).toBe(R12);
  expect(widths(tree)).toEqual(Array(20).fill(88));
  // No cell paints a background: the colour is the text's alone
  expect(JSON.stringify(tree)).not.toContain("backgroundColor");
});

test("R4 at 90 by 20: the graph by state, junctions and no crossing", async ($, on) => {
  await seeded($, on);
  const ui = await mount($, 88, 20);
  await ui.key({ key: "tab" });
  const graph = await drawnIn(ui);
  expect(capture(graph)).toBe(R4);
  expect(widths(graph)).toEqual(Array(20).fill(88));
  expect(JSON.stringify(graph)).not.toContain("backgroundColor");
  // tab again, or a click on « Arbre », is the tree
  await ui.key({ key: "tab" });
  expect(capture(await drawnIn(ui))).toBe(R12);
  await ui.key({ key: "tab" });
  await ui.pointer({ type: "down", x: 2, y: 19, button: "left" });
  expect(capture(await drawnIn(ui))).toBe(R12);
  await ui.pointer({ type: "down", x: 9, y: 19, button: "left" });
  expect(capture(await drawnIn(ui))).toBe(R4);
});

const header = (text: string) => text.split("\n")[1];

test("narrower: the links go first, then the model, then the agent; at 60 the tree and the age", async ($, on) => {
  await seeded($, on);
  const at = async (columns: number) => {
    const ui = await mount($, columns, 20);
    const tree = await drawnIn(ui);
    await ui.unmount();
    expect(widths(tree)).toEqual(Array(20).fill(columns));
    return capture(tree);
  };
  expect(header(await at(86))).toBe(
    "  TÂCHE                            AGENT              MODÈLE         ÂGE",
  );
  expect(header(await at(70))).toBe(
    "  TÂCHE                            AGENT                 ÂGE",
  );
  const sixty = await at(58);
  expect(header(sixty)).toBe("  TÂCHE                               ÂGE");
  expect(sixty.split("\n")[5]).toBe(
    "┃ ├▾ ● C6     Porte Fable          12 min",
  );
});

test("shorter than 20 rows: the finished branches fold, then the detail drops to one line, then none", async ($, on) => {
  await seeded($, on);
  const at = async (rows: number) => {
    const ui = await mount($, 88, rows);
    const text = capture(await drawnIn(ui));
    await ui.unmount();
    expect(text.split("\n")).toHaveLength(rows);
    return text;
  };
  const r19 = await at(19);
  expect(r19).toContain("  └─ ✓ fait (2)");
  expect(r19).not.toContain("Événements réels");
  expect(r19).toContain("  Le mod juge, il ne réécrit jamais e.model");
  const r18 = await at(18);
  expect(r18).toContain("● C6  Porte Fable");
  expect(r18).not.toContain("Le mod juge");
  const r17 = await at(17);
  expect(r17).not.toContain("● C6  Porte Fable");
  expect(r17).toContain("┃ └─ ⊘ C9     CI et PR");
  // Shorter still, the list scrolls with the selection
  const r12 = await at(12);
  expect(r12).toContain("┃ ├▾ ● C6     Porte Fable");
  expect(r12).toContain("chemin critique");
});

test("keys: ↑↓ choose, ⏎ folds, one top-level branch open at a time; a click chooses and folds", async ($, on) => {
  await seeded($, on);
  const ui = await mount($, 88, 20);
  const line = async (n: number) => capture(await drawnIn(ui)).split("\n")[n];
  // C6 starts selected and open: ⏎ folds it
  await ui.key({ key: "return" });
  expect(await line(5)).toBe(
    "┃ ├▸ ● C6     Porte Fable          mkt-routing-pr     opus·xhigh  12 min  ⇢ C9",
  );
  expect(capture(await drawnIn(ui))).not.toContain("agent.spawn");
  // ↓ twice: C7, then C8; ⏎ opens C8
  await ui.key({ key: "down" });
  await ui.key({ key: "down" });
  expect(await line(16)).toContain("▶ C8  Spécialistes ×5");
  await ui.key({ key: "return" });
  expect(capture(await drawnIn(ui))).toContain("│  └─ ○ ansible");
  // Opening C6 again closes C8: a click on C6's row chooses it and, as it has
  // subtasks, unfolds it
  await ui.pointer({ type: "down", x: 10, y: 5, button: "left" });
  const text = capture(await drawnIn(ui));
  expect(text).toContain("agent.spawn");
  expect(text).not.toContain("ansible");
  expect(text.split("\n")[16]).toContain("● C6  Porte Fable");
  // ↑ at the top stays at the top
  for (let i = 0; i < 10; i++) await ui.key({ key: "up" });
  expect(await line(16)).toContain("✓ T0  Événements réels");
});

test("a surface with no Client draws the same tree, still", async ($, on) => {
  await seeded($, on);
  for (const surface of ["vscode", "mobile"] as const) {
    const ui = await mount($, 88, 20, surface);
    expect(capture(await ui.drawn())).toBe(R12);
    await ui.unmount();
  }
  const desk = await mount($, 88, 20, "desktop");
  expect(capture(await drawnIn(desk))).toBe(R12);
});

// --- pure: the states, the path, the cells -------------------------------------------

const NOWMS = SEC * 1000;
const ctx: Ctx = {
  now: NOWMS,
  agents: [],
  activity: {},
  silentMs: 10 * 60_000,
};
const treeOf = (tasks: object[]) =>
  buildTree({
    board: parseBoard(tasksJson(tasks, EPIC)),
    ctx,
    ci: {},
    models: {},
    seen: {},
  }).epics[0]!;

test("derived states: ready when every blocker is done, blocked otherwise, todo under an open parent", () => {
  const e = treeOf([
    task("1", "A", "completed"),
    task("2", "B", "pending", { blockedBy: ["1"] }),
    task("3", "C", "pending", { blockedBy: ["1", "2"] }),
    task("4", "D", "pending", { parent: "3" }),
    task("5", "E", "pending", { parent: "1" }),
    task("6", "F", "waiting", { assignee: "human" }),
    task("7", "G", "waiting"),
  ]);
  const by = Object.fromEntries(
    [...e.nodes, ...e.nodes.flatMap((n) => n.kids)].map((n) => [n.title, n]),
  );
  expect(by.B!.state).toBe("ready");
  expect(by.B!.agent).toBe("prête");
  expect(by.C!.state).toBe("blocked");
  expect(by.C!.links).toBe("⇠ #2");
  expect(by.D!.state).toBe("todo");
  expect(by.E!.state).toBe("ready");
  expect(by.F!.state).toBe("you");
  expect(by.F!.agent).toBe("toi");
  expect(by.G!.state).toBe("wait");
  expect(by.A!.links).toBe("⇢ #2 #3");
});

test("critical path: the longest chain of unfinished tasks, every task on one of that length", () => {
  const e = treeOf([
    task("1", "A", "completed"),
    task("2", "B", "in_progress", { blockedBy: ["1"] }),
    task("3", "C", "pending", { blockedBy: ["2"] }),
    task("4", "D", "pending", { blockedBy: ["3"], ref: "D" }),
    task("5", "E", "pending", { blockedBy: ["2"] }),
    task("6", "F", "waiting", { assignee: "human", ref: "F" }),
    task("7", "G", "pending", { blockedBy: ["6"] }),
  ]);
  const crit = e.nodes.filter((n) => n.crit).map((n) => n.title);
  expect(crit).toEqual(["B", "C", "D"]);
  expect(e.chains.map((c) => c.map((t) => t.label))).toEqual([
    ["#2", "#3", "D"],
  ]);
  // The person's task is off the path: « t'attend », not « bloqué par toi »
  expect(e.you).toEqual({ label: "F", age: "0 s", crit: false });
  expect(e.goal).toMatchObject({
    label: "D",
    state: "blocked",
    note: "attend #3",
  });
  // No link at all: no path
  expect(
    treeOf([task("1", "A", "pending"), task("2", "B", "pending")]).chains,
  ).toEqual([]);
});

test("cells: model·effort in ten, agent in seventeen, links three then +n, ages in six", () => {
  expect(modelCell({ model: "claude-opus-5-5", effort: "xhigh" })).toBe(
    "opus·xhigh",
  );
  expect(modelCell({ model: "claude-sonnet-5-5", effort: "medium" })).toBe(
    "sonnet·med",
  );
  expect(modelCell({ model: "claude-sonnet-5-5", effort: "xhigh" })).toBe(
    "sonnet·xhi",
  );
  expect(modelCell({ model: "claude-haiku-5-5" })).toBe("haiku");
  expect(modelCell({ effort: "high" })).toBe("");
  expect(modelCell(undefined)).toBe("");
  expect(linkCell("⇠", ["C6", "C7", "C8", "C9"])).toBe("⇠ C6 C7 C8 +1");
  expect(linkCell("⇢", [])).toBe("");
  for (const ms of [
    0,
    59_000,
    12 * 60_000,
    80 * 60_000,
    9 * 3600_000 + 59 * 60_000,
    23 * 3600_000,
    5 * 86400_000,
  ])
    expect(cells(span(ms))).toBeLessThanOrEqual(6);
  expect(span(80 * 60_000)).toBe("1 h 20");
  expect(span(120 * 60_000)).toBe("2 h");
  // Wide glyphs count two cells, ambiguous ones one
  expect(cells("✓●◆▶⊘┃⇢⇠")).toBe(8);
  expect(cells("😀")).toBe(2);
  expect(fit("Spécialistes ×5 en plus", 18)).toBe("Spécialistes ×5 e…");
  expect(cells(fit("日本語のタスク名です", 7))).toBeLessThanOrEqual(7);
});

test("the model column comes from what the session said, never a guess", async ($, on) => {
  // No Agent result naming a1: its tasks have no model
  const { h, clock } = host(on);
  h.agents = [
    { id: "a1", type: "general-purpose", name: "w", status: "running" },
  ];
  h.files.set(TASKS, {
    text: tasksJson(
      [task("1", "Work", "in_progress", { worker: "w", worker_id: "a1" })],
      EPIC,
    ),
    mtimeMs: 1,
  });
  await start($, clock);
  const ui = await mount($, 88, 20);
  const row = capture(await drawnIn(ui)).split("\n")[3]!;
  expect(row).toContain("w  ");
  expect(row).not.toMatch(/opus|sonnet|haiku|fable/);
  // kodflow-hooks' agent-models.tsv names it: the cell fills
  h.files.set(TASKS.replace("tasks.json", "agent-models.tsv"), {
    text: "a1\tclaude-sonnet-5-5\tmedium\tgeneral-purpose\n",
    mtimeMs: 2,
  });
  await clock.advance(3_000);
  await ui.redraw();
  expect(capture(await drawnIn(ui)).split("\n")[3]).toContain("sonnet·med");
});

test("R4: links that share no lane get their own stretch; one crossing a column is a solid line", async ($, on) => {
  await seeded($, on, [
    task("1", "Base", "completed", { ref: "T0" }),
    task("2", "Work", "in_progress", { ref: "C6", blockedBy: ["1"] }),
    task("5", "Other", "waiting", { ref: "C7" }),
    task("3", "Ship", "pending", { ref: "C9", blockedBy: ["1", "2"] }),
    task("4", "Prep", "pending", { ref: "P1" }),
    task("6", "Late", "pending", { ref: "C10", blockedBy: ["4"] }),
  ]);
  const ui = await mount($, 88, 20);
  await ui.key({ key: "tab" });
  const lines = capture(await drawnIn(ui)).split("\n");
  expect(lines.slice(1, 10)).toEqual([
    "FAIT · PRÊT                    EN COURS · ATTENTE             BLOQUÉ",
    "                           ┌─▶ ● C6    Work ──────────────┐",
    "                           │     main · 0 s               │",
    "                           │   ◇ C7    Other              │",
    "                           │     main · 0 s               │",
    "✓ T0    Base ──────────────┴──────────────────────────────┴─▶ ⊘ C9    Ship",
    "  main · opus · 0 s                                             attend C6",
    "▶ P1    Prep ───────────────────────────────────────────────▶ ⊘ C10   Late",
    "  prête · personne dessus                                       attend P1",
  ]);
  expect(lines.join("\n")).not.toContain("┼");
});
