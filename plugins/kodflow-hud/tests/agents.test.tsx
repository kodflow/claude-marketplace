// agents.test.tsx — the « Agents » pane, and the case that was reported: a
// session with one epic and one loose task, the main loop alone, then with
// subagents. Drawn by the engine through the plugin, read back as the
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

test("the reported case, the main loop alone: « Tâches » in front, « Agents (0) » behind, no word said three times", async ($, on) => {
  const { h } = await seeded($, on, false);
  expect(h.panes).toEqual([
    { id: "hud-agents", title: "Agents (0)\u2007" },
    { id: "hud-tasks", title: "Tâches (2)\u2007" },
  ]);
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

const AGENTS_WITH_SUBS = [
  "─ 3 sous-agents en cours ───────────────────────────────────────────────────────────────",
  "  AGENT               RÔLE                    MODÈLE      ÉTAT",
  "◉ principal           fil principal           opus        ● actif · 15 s",
  "    /w/repo",
  "↳ hud-agents          general-purpose                     ● actif · 15 s",
  "    ● #2 Rendu des agents  ·  /w/repo",
  "↳ vault-audit         devops · hashicorp                  ⏸ figé · 11 min",
  "    /w/repo",
  "↳ sans-type           type inconnu                        ◇ attend",
].join("\n");

test("the reported case with subagents: each named, its role, its colour, the frozen one in red", async ($, on) => {
  const { h } = await seeded($, on, true);
  // Three at work, counted on the tab; « Tâches » stays the one shown
  expect(h.panes).toEqual([
    { id: "hud-agents", title: "Agents (3)\u2007" },
    { id: "hud-tasks", title: "Tâches (3)\u2007" },
  ]);
  expect(h.shown).toBe("hud-tasks");

  const tasks = await mount($, "hud-tasks", "Tâches (3)", 12);
  const tree = capture(await tasks.drawn({ in: "tree" }));
  expect(tree.split("\n").slice(0, 7).join("\n")).toBe(TASKS_WITH_SUBS);
  await tasks.unmount();

  const ui = await mount($, "hud-agents", "Agents (3)");
  const drawn = await ui.drawn();
  expect(capture(drawn)).toBe(AGENTS_WITH_SUBS);
  expect(widths(drawn).every((w) => w === 88)).toBe(true);
  const colors = async (text: string) =>
    (await ui.findAll({ type: "Text", text }))
      .map((t: any) => t.props)
      .filter((p: any) => p.color);
  // The main loop in the theme's colour, each subagent in its own
  expect((await colors("principal"))[0]?.color).toBe("claude");
  expect((await colors("hud-agents"))[0]?.color).toBe(colorOf("a1"));
  expect((await colors("vault-audit"))[0]?.color).toBe(colorOf("a2"));
  // Frozen: red and bold; at work: green
  const frozen = (await colors("⏸ figé · 11 min"))[0];
  expect(frozen).toMatchObject({ color: "error", bold: true });
  expect((await colors("● actif · 15 s"))[0]?.color).toBe("success");
  // No cell paints a background
  expect(JSON.stringify(drawn)).not.toContain("backgroundColor");
  await ui.unmount();
  // Taller, each loop shows its last files (the frozen one's have expired)
  const tall = await mount($, "hud-agents", "Agents (3)", 16);
  expect(capture(await tall.drawn())).toContain(
    "↳ hud-agents          general-purpose                     ● actif · 15 s\n    ● #2 Rendu des agents  ·  /w/repo\n    W src/view.tsx",
  );
});

test("narrow, the Agents pane drops the role column and says it under the name", async ($, on) => {
  await seeded($, on, true);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-agents",
    props: { ...PANE(60, 12), title: "Agents (3)\u2007" },
  });
  const drawn = await ui.drawn();
  const text = capture(drawn);
  expect(text.split("\n")[1]).toBe("  AGENT               MODÈLE      ÉTAT");
  expect(text).toContain("    devops · hashicorp  ·  /w/repo");
  expect(widths(drawn).every((w) => w === 60)).toBe(true);
});
