// front.test.tsx — « Tâches » is the only pane: the first tab and the one
// shown, whatever the subagents do. The host holds the engine's own rules
// for the tab shown (host.ts): a retitle never moves it, a new pane takes it
// unless a pane holds the keyboard, a close shows the last pane left.
import { test, expect } from "claude-code/testing";

import { PANE, T, host, start, writeTasks } from "./host.ts";

const at = (id: string, status = "running") => ({
  id,
  type: "Explore",
  status,
});
const ids = (h: { panes: { id: string }[] }) => h.panes.map((p) => p.id);

test("subagents start, grow in number, end and start again: « Tâches » stays the only tab, shown", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "pending")], 1);
  await start($, clock);
  expect(ids(h)).toEqual(["hud-tasks"]);
  expect(h.shown).toBe("hud-tasks");
  h.agents = [at("a1")];
  await clock.advance(3_000);
  h.agents = [at("a1"), at("a2"), at("a3", "waiting")];
  await clock.advance(3_000);
  h.agents = h.agents.map((a) => ({ ...a, status: "completed" }));
  await clock.advance(3_000);
  h.agents = [...h.agents, at("a4")];
  await clock.advance(3_000);
  expect(h.opened.every((id) => id === "hud-tasks")).toBe(true);
  expect(ids(h)).toEqual(["hud-tasks"]);
  expect(h.shown).toBe("hud-tasks");
  // A task done: the tab is retitled where it stands
  writeTasks(h, [T("1", "completed"), T("2", "pending")], 2);
  await clock.advance(3_000);
  expect(h.panes).toEqual([{ id: "hud-tasks", title: "Tâches (1) " }]);
  expect(h.shown).toBe("hud-tasks");
});

test("an Agents tab an older version left up on the right is closed at start, and « Tâches » is shown", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [at("a1")];
  h.panes = ["hud-tasks", "hud-agents"].map((id) => ({ id, title: id }));
  h.shown = "hud-agents";
  await start($, clock);
  await clock.advance(3_000);
  expect(h.closed).toEqual(["hud-agents"]);
  expect(ids(h)).toEqual(["hud-tasks"]);
  expect(h.shown).toBe("hud-tasks");
});

test("an Agents tab an older version left up on the left is closed at start, and « Tâches » is shown", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [at("a1")];
  h.panes = ["hud-agents", "hud-tasks"].map((id) => ({ id, title: id }));
  h.shown = "hud-agents";
  await start($, clock);
  await clock.advance(3_000);
  expect(h.closed).toEqual(["hud-agents"]);
  expect(ids(h)).toEqual(["hud-tasks"]);
  expect(h.shown).toBe("hud-tasks");
});

test("a retitle leaves the person on the pane they picked", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "pending")], 1);
  await start($, clock);
  // Another plugin's pane, picked by a click on its tab
  h.panes.push({ id: "other", title: "Autre" });
  h.shown = "other";
  writeTasks(h, [T("1", "completed"), T("2", "pending")], 2);
  await clock.advance(3_000);
  expect(h.panes[0]).toEqual({ id: "hud-tasks", title: "Tâches (1) " });
  expect(h.shown).toBe("other");
});

test("/hud opens or shows « Tâches », /hud off closes it, /hud agents says the tab is gone", async ($, on) => {
  const { h, clock } = host(on);
  await start($, clock);
  h.panes.push({ id: "other", title: "Autre" });
  h.shown = "other";
  // Up already: shown with the keyboard, the engine's only way
  let r: any = await $.command.run({ command: "hud", args: "" } as any);
  expect(h.focusAsked).toEqual(["hud-tasks"]);
  expect(h.shown).toBe("hud-tasks");
  expect(r.text).toContain("Tâches (0)");
  r = await $.command.run({ command: "hud", args: "off" } as any);
  expect(ids(h)).toEqual(["other"]);
  h.focused = undefined;
  r = await $.command.run({ command: "hud", args: "tasks" } as any);
  expect(ids(h)).toEqual(["other", "hud-tasks"]);
  expect(h.shown).toBe("hud-tasks");
  h.opened = [];
  r = await $.command.run({ command: "hud", args: "agents" } as any);
  expect(h.opened).toEqual([]);
  expect(r.text).toContain("Agents tab is gone");
  expect(h.toasts.at(-1)).toContain("onglet Agents est retiré");
});

test("`a` in the tree is no key of the mod's any more", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  h.agents = [at("a1")];
  await start($, clock);
  const tasks = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(88, 20),
  });
  h.focused = "hud-tasks";
  h.opened = [];
  await tasks.key({ key: "a", in: "tree" });
  expect(h.opened).toEqual([]);
  expect(h.toasts).toEqual([]);
  expect(ids(h)).toEqual(["hud-tasks"]);
});
