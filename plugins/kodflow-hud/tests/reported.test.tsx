// reported.test.tsx — the case that was reported: a session with one epic
// and one loose task, the main loop alone, then with subagents, in the
// « Tâches » pane. Drawn by the engine through the plugin, read back as the
// terminal lays it out (capture.ts).
import { test, expect } from "claude-code/testing";
import { SEC, host, start, PANE, TASKS } from "./host.ts";
import { capture, widths } from "./capture.ts";
import { colorOf } from "../hooks/mod/who.ts";

const TASKS_OF = [
  {
    id: "1",
    agent: "main",
    epic: 1,
    subject: "Jouer la recette",
    status: "waiting",
    created: SEC - 60,
    updated: SEC - 60,
  },
  {
    id: "2",
    agent: "main",
    epic: 1,
    subject: "Rendu des agents",
    status: "in_progress",
    worker: "hud-agents",
    worker_id: "a1",
    created: SEC - 300,
    updated: SEC - 30,
  },
  {
    id: "3",
    agent: "main",
    epic: 0,
    subject: "Onglet agents",
    status: "pending",
    created: SEC - 13,
    updated: SEC - 13,
  },
];
const fileOf = (tasks: object[]) =>
  JSON.stringify({
    version: 2,
    next_id: 4,
    next_epic: 2,
    epics: [
      {
        id: 1,
        agent: "main",
        title: "Recette kodflow",
        created: SEC - 60,
        touched: SEC,
      },
    ],
    active: { main: 1 },
    tasks,
  });

const mount = ($: any, id: string, title: string, rows = 10) =>
  $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: id,
    props: { ...PANE(88, rows), title },
  });

async function seeded($: any, on: any, withSubs: boolean) {
  const { h, clock } = host(on);
  if (withSubs)
    h.agents = [
      {
        id: "a1",
        type: "general-purpose",
        name: "hud-agents",
        status: "running",
      },
      {
        id: "a2",
        type: "kodflow-specialists:devops-specialist-hashicorp",
        name: "vault-audit",
        status: "running",
      },
      { id: "a3", type: "", name: "sans-type", status: "waiting" },
    ];
  const tasks = withSubs ? TASKS_OF : TASKS_OF.filter((t) => t.id !== "2");
  h.files.set(TASKS, { text: fileOf(tasks), mtimeMs: 1 });
  await start($, clock);
  if (withSubs) {
    // a2 went quiet eleven minutes ago: frozen. a1 is busy right now
    await $.tool.call({
      tool: "Read",
      file_path: "/w/repo/policies/vault.hcl",
      agentId: "a2",
    } as any);
    await clock.advance(11 * 60_000);
    await $.tool.call({
      tool: "Edit",
      file_path: "/w/repo/src/view.tsx",
      agentId: "a1",
      old_string: "a",
      new_string: "b",
    } as any);
  }
  await $.tool.call({ tool: "Read", file_path: "/w/repo/src/a.ts" } as any);
  await clock.advance(15_000);
  return { h, clock };
}

const TASKS_MAIN_ONLY = [
  "─ 1 épopée ouverte · 1 tâche hors épopée ───────────────────────────────────────────────",
  "  TÂCHE                           AGENT                   MODÈLE         ÂGE  LIENS",
  "  ◆ #1     Recette kodflow  0/1                                        1 min",
  "  └─ ◇ #1     Jouer la recette    ◉ principal             opus         1 min",
  "  ◌        Hors épopée",
  "  └─ ▶ #3     Onglet agents       prête",
  "┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄",
  "┃ chemin critique  aucun lien",
  "────────────────────────────────────────────────────────────────────────────────────────",
  "Arbre   Graphe                         ↑↓ choisir · ⏎ plier/déplier · tab changer de vue",
].join("\n");

test("the reported case, the main loop alone: « Tâches » the only tab, no word said three times", async ($, on) => {
  const { h } = await seeded($, on, false);
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (2)\u2007" }]);
  expect(h.shown).toBe("hud-tasks");
  const ui = await mount($, "hud-tasks", "Tâches (2)");
  const tree = await ui.drawn({ in: "tree" });
  const text = capture(tree);
  expect(text).toBe(TASKS_MAIN_ONLY);
  expect(widths(tree)).toEqual(Array(10).fill(88));
  // « Tâches » is the tab's word alone, « epic » is said « épopée »
  expect(text).not.toContain("Tâches");
  expect(text).not.toMatch(/\bepics?\b/);
});

const TASKS_WITH_SUBS = [
  "─ 1 épopée ouverte · 1 tâche hors épopée ───────────────────────────────────────────────",
  "  TÂCHE                           AGENT                   MODÈLE         ÂGE  LIENS",
  "  ◆ #1     Recette kodflow  0/2                                       12 min",
  "  ├─ ◇ #1     Jouer la recette    ◉ principal             opus        12 min",
  "  └─ ● #2     Rendu des agents    ↳ hud-agents · general                15 s",
  "  ◌        Hors épopée",
  "  └─ ▶ #3     Onglet agents       prête",
].join("\n");

test("the reported case with subagents: each worker named in the tree, « Tâches » the only tab", async ($, on) => {
  const { h } = await seeded($, on, true);
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (3)\u2007" }]);
  expect(h.shown).toBe("hud-tasks");
  const tasks = await mount($, "hud-tasks", "Tâches (3)", 12);
  const drawn = await tasks.drawn({ in: "tree" });
  expect(capture(drawn).split("\n").slice(0, 7).join("\n")).toBe(
    TASKS_WITH_SUBS,
  );
  expect(JSON.stringify(drawn)).not.toContain("backgroundColor");
});
