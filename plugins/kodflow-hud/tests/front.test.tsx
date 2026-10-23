// front.test.tsx — « Tâches » stays the tab shown: « Agents » comes in front
// only when the person asks for it (a click on its tab, /hud agents). The
// host holds the engine's own rules for the tab shown (host.ts): a retitle
// never moves it, a new pane takes it unless a pane holds the keyboard.
import { test, expect } from "claude-code/testing";

import { PANE, T, host, start, writeTasks } from "./host.ts";

const at = (id: string, status = "running") => ({
  id,
  type: "Explore",
  status,
});
const ids = (h: { panes: { id: string }[] }) => h.panes.map((p) => p.id);

test("a subagent that starts while « Tâches » is shown leaves it in front", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  await start($, clock);
  expect(h.shown).toBe("hud-tasks");
  h.agents = [at("a1")];
  await clock.advance(3_000);
  expect(h.panes).toContainEqual({ id: "hud-agents", title: "Agents (1) " });
  expect(h.shown).toBe("hud-tasks");
});

test("the count moves, the last subagent ends, a new one starts: « Tâches » stays in front, the tab stays up", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "pending")], 1);
  await start($, clock);
  h.agents = [at("a1")];
  await clock.advance(3_000);
  h.agents = [at("a1"), at("a2"), at("a3", "waiting")];
  await clock.advance(3_000);
  expect(h.panes[0]).toEqual({ id: "hud-agents", title: "Agents (3) " });
  expect(h.shown).toBe("hud-tasks");
  // A task done: « Tâches » is retitled, still in front
  writeTasks(h, [T("1", "completed"), T("2", "pending")], 2);
  await clock.advance(3_000);
  expect(h.panes[1]).toEqual({ id: "hud-tasks", title: "Tâches (1) " });
  expect(h.shown).toBe("hud-tasks");
  // The last one ends: the tab says 0 and stays, never closed then reopened
  h.agents = h.agents.map((a) => ({ ...a, status: "completed" }));
  await clock.advance(3_000);
  expect(h.panes[0]).toEqual({ id: "hud-agents", title: "Agents (0) " });
  expect(h.closed).toEqual([]);
  expect(h.shown).toBe("hud-tasks");
  // A new one starts: counted, behind
  h.agents = [...h.agents, at("a4")];
  await clock.advance(3_000);
  expect(h.panes[0]).toEqual({ id: "hud-agents", title: "Agents (1) " });
  expect(h.shown).toBe("hud-tasks");
});

test("the person on « Agents » by a click stays there through the polls, until they click back", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "pending")], 1);
  h.agents = [at("a1")];
  await start($, clock);
  await clock.advance(3_000);
  // The click on the tab: the engine shows it, the keyboard stays where it was
  h.shown = "hud-agents";
  h.agents = [at("a1"), at("a2")];
  writeTasks(h, [T("1", "completed"), T("2", "pending")], 2);
  await clock.advance(3_000);
  await clock.advance(3_000);
  expect(h.titles).toContain("hud-agents=Agents (2) ");
  expect(h.titles).toContain("hud-tasks=Tâches (1) ");
  expect(h.shown).toBe("hud-agents");
  // A click landing while a retitle runs stands too
  writeTasks(h, [T("1", "completed"), T("2", "completed")], 3);
  h.shown = "hud-tasks";
  h.afterOpen = (id) => {
    if (id === "hud-tasks") h.shown = "hud-agents";
  };
  await clock.advance(3_000);
  h.afterOpen = undefined;
  expect(h.shown).toBe("hud-agents");
  // Back on « Tâches » by a click: it stays
  h.shown = "hud-tasks";
  h.agents = [at("a1")];
  await clock.advance(3_000);
  expect(h.shown).toBe("hud-tasks");
});

test("`a` then `t` ask the engine to show the tab, with focus; holding the keyboard in a pane, it declines and nothing moves", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  h.agents = [at("a1")];
  await start($, clock);
  await clock.advance(3_000);
  const tasks = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(88, 20),
  });
  // A key reaches the pane only while it holds the keyboard
  h.focused = "hud-tasks";
  await tasks.key({ key: "a", in: "tree" });
  expect(h.focusAsked).toEqual(["hud-agents"]);
  expect(h.shown).toBe("hud-tasks");
  // A modified `a` is not the switch
  await tasks.key({ key: "a", ctrl: true, in: "tree" });
  expect(h.focusAsked).toEqual(["hud-agents"]);
  await tasks.unmount();
  // On « Agents » (a click on its tab), `t` asks for « Tâches » the same way
  h.shown = h.focused = "hud-agents";
  const agents = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-agents",
    props: { ...PANE(88, 12), title: "Agents (1) " },
  });
  const back = await agents.find({ type: "Button", key: "show-tasks" });
  expect(back?.props.hotkey).toBe("t");
  await agents.press({ key: "show-tasks" });
  expect(h.focusAsked).toEqual(["hud-agents", "hud-tasks"]);
  expect(h.shown).toBe("hud-agents");
  await agents.unmount();
  // The polls leave the person where they are
  await clock.advance(3_000);
  expect(h.shown).toBe("hud-agents");
});

test("a session that starts with both tabs up keeps the tab the person was on", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [at("a1")];
  h.panes = [
    { id: "hud-tasks", title: "Tâches" },
    { id: "hud-agents", title: "Agents (1) " },
  ];
  h.shown = "hud-agents";
  await start($, clock);
  await clock.advance(3_000);
  expect(ids(h)).toEqual(["hud-tasks", "hud-agents"]);
  expect(h.panes[0]!.title).toBe("Tâches (0) ");
  expect(h.shown).toBe("hud-agents");
});

test("« Tâches » up without « Agents »: the tab is added only while a pane holds the keyboard, which keeps it in front", { options: { autoOpen: false } }, async ($, on) => {
  const { h, clock } = host(on);
  h.panes = [{ id: "hud-tasks", title: "Tâches" }];
  h.shown = "hud-tasks";
  await start($, clock);
  // /hud asks for both: none running, so « Tâches » alone, in front, with
  // the keyboard; back at the prompt (Esc)
  await $.command.run({ command: "hud", args: "" } as any);
  expect(ids(h)).toEqual(["hud-tasks"]);
  h.focused = undefined;
  expect(ids(h)).toEqual(["hud-tasks"]);
  // A subagent starts while the prompt has the keys: adding the tab now
  // would show it, so it waits
  h.agents = [at("a1")];
  await clock.advance(3_000);
  expect(ids(h)).toEqual(["hud-tasks"]);
  // The person in « Tâches »: the tab is added behind
  h.focused = "hud-tasks";
  await clock.advance(3_000);
  expect(ids(h)).toEqual(["hud-tasks", "hud-agents"]);
  expect(h.shown).toBe("hud-tasks");
});

test("/hud off keeps « Agents » shut, /hud tasks too; /hud brings it back behind « Tâches », /hud agents in front", async ($, on) => {
  const { h, clock } = host(on);
  h.agents = [at("a1")];
  await start($, clock);
  await clock.advance(3_000);
  await $.command.run({ command: "hud", args: "off" } as any);
  h.agents = [at("a1"), at("a2")];
  await clock.advance(3_000);
  expect(h.panes).toEqual([]);
  // /hud tasks: « Tâches » alone, and the Agents tab does not come back by
  // itself, even with the person in the pane
  await $.command.run({ command: "hud", args: "tasks" } as any);
  expect(h.focused).toBe("hud-tasks");
  await clock.advance(3_000);
  await clock.advance(3_000);
  expect(ids(h)).toEqual(["hud-tasks"]);
  // /hud: both, « Agents » first, « Tâches » shown
  h.focused = undefined;
  await $.command.run({ command: "hud", args: "" } as any);
  expect(ids(h)).toEqual(["hud-tasks", "hud-agents"]);
  expect(h.shown).toBe("hud-tasks");
  await clock.advance(3_000);
  expect(h.shown).toBe("hud-tasks");
  // /hud agents: the person asks for it, it is shown
  h.focused = undefined;
  const r: any = await $.command.run({ command: "hud", args: "agents" } as any);
  expect(r.text).toContain("Agents (2)");
  expect(h.shown).toBe("hud-agents");
  await clock.advance(3_000);
  expect(h.shown).toBe("hud-agents");
});
