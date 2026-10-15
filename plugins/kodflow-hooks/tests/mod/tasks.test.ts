// tasks.test.ts — the pure modules, under `claude plugin test`.
import { test, expect } from "claude-code/testing";
import { conformance } from "./conformance.ts";
import {
  TOOLS,
  codePoints,
  humanContext,
  humanOpen,
  parse,
  resolveWorkers,
  strip,
  upgrade,
} from "../../hooks/mod/tasks.ts";
import {
  configDir,
  safe,
  sessionDir,
  beatText,
} from "../../hooks/mod/paths.ts";
import {
  argsOf,
  attributionText,
  isOff,
  liftsTriage,
  taskTool,
  settleCauses,
  triageCauses,
} from "../../hooks/mod/calls.ts";

test("the port answers every call of the corpus as tasks.py did", () => {
  const { calls, failures } = conformance();
  expect(calls).toBeGreaterThan(150);
  expect(failures).toEqual([]);
});

test("tools: tasks.py's five in its order, then task_assign_human; epic required, worker offered", () => {
  expect(TOOLS.map((t) => t.name)).toEqual([
    "task_create",
    "task_update",
    "task_epic",
    "task_focus",
    "task_list",
    "task_assign_human",
  ]);
  const human = TOOLS[5]!;
  expect(human.inputSchema.required).toEqual(["subject", "epic"]);
  expect(human.inputSchema.properties.epic.minimum).toBe(1);
  expect(human.description).toContain("At most 5 open");
  const create = TOOLS[0]!;
  expect(create.inputSchema.required).toEqual(["subject", "epic"]);
  expect(create.description).toContain("REQUIRED");
  const update = TOOLS[1]!;
  expect(Object.keys(update.inputSchema.properties)).toContain("worker");
  expect(update.description).toContain("worker=");
  for (const t of TOOLS)
    expect(Object.keys(t.inputSchema.properties ?? {})).not.toContain(
      "_session",
    );
});

test("lengths count code points, strip is Python's", () => {
  expect(codePoints("😀".repeat(40))).toBe(40);
  expect(strip("\u001c x 　")).toBe("x");
  expect(strip("﻿x")).toBe("﻿x");
});

test("upgrade: v1 to v2, timestamps in seconds", () => {
  const data = upgrade(
    { epics: { main: { id: 3, title: "Old" } }, tasks: [{ id: 1 }] },
    1791900000,
  );
  expect(data.version).toBe(2);
  expect(data.epics).toEqual([
    {
      id: 3,
      agent: "main",
      title: "Old",
      created: 1791900000,
      touched: 1791900000,
    },
  ]);
  expect(data.active).toEqual({ main: 3 });
  expect(data.next_epic).toBe(4);
  expect(data.tasks).toEqual([
    { id: "1", agent: "main", status: "pending", subject: "", epic: 0 },
  ]);
  expect(parse("not json", 1).tasks).toEqual([]);
  expect(parse(undefined, 1).next_id).toBe(1);
});

test("workers: $.agent.list() decides who runs, agents.json only when each started", () => {
  const listed = [
    { id: "a1", type: "general-purpose", name: "fixer", status: "running" },
    { id: "a2", type: "Explore", status: "idle" },
    { id: "a3", type: "Explore", status: "waiting" },
    { id: "a4", type: "Explore", status: "completed" },
    { id: "a5", type: "Explore", status: "killed" },
  ];
  const agents = JSON.stringify({
    agents: { a1: { type: "x", started: 100, stopped: 200 } },
  });
  const w = resolveWorkers(listed, agents, 1000);
  expect(w.map((x) => x.alive)).toEqual([true, true, true, false, false]);
  expect(w[0]).toEqual({
    id: "a1",
    type: "general-purpose",
    name: "fixer",
    alive: true,
    started: 100,
  });
  // Without the list (it failed), agents.json decides as tasks.py did
  const fallback = resolveWorkers(
    undefined,
    JSON.stringify({
      agents: { b: { type: "T", started: 990, stopped: null } },
    }),
    1000,
  );
  expect(fallback).toEqual([{ id: "b", type: "T", alive: true, started: 990 }]);
  expect(resolveWorkers(undefined, "garbage", 1000)).toEqual([]);
});

test("paths: absolute only, safe ids", () => {
  expect(configDir("/c/", "/h")).toBe("/c");
  expect(configDir(undefined, "/h")).toBe("/h/.claude");
  expect(configDir("", "/h/")).toBe("/h/.claude");
  expect(configDir("rel", "/h")).toBeUndefined();
  expect(configDir(undefined, "~")).toBeUndefined();
  expect(configDir(undefined, undefined)).toBeUndefined();
  expect(safe("a/b c.d")).toBe("a-b-c-d");
  expect(safe("z".repeat(200)).length).toBe(128);
  expect(safe("")).toBe("default");
  expect(sessionDir("/c", "s/1")).toBe("/c/kodflow/sessions/s-1");
  expect(beatText(1791900000999)).toBe("1791900000");
});

test("calls: tool names, envelope, attribution, switch, triage", () => {
  expect(taskTool("mcp__kodflow-hooks__task_create")).toBe("task_create");
  expect(
    taskTool("mcp__plugin_kodflow-hooks_tasks__task_create"),
  ).toBeUndefined();
  expect(taskTool("mcp__kodflow-hooks__task_nope")).toBeUndefined();
  expect(
    argsOf({
      tool: "t",
      tool_use_id: "u",
      agentId: "a",
      subject: "s",
      epic: 0,
    }),
  ).toEqual({ subject: "s", epic: 0 });
  expect(attributionText("commit")).toBe("");
  expect(attributionText("pr")).toBe("");
  expect(attributionText("exemption")).toBeUndefined();
  expect(attributionText("remedy")).toBeUndefined();
  expect(isOff("off")).toBe(true);
  expect(isOff("OFF")).toBe(false);
  expect(isOff(undefined)).toBe(false);
  expect(triageCauses("")).toEqual(["prompt"]);
  expect(triageCauses("prompt 1\nresume\n\nprompt 2\n")).toEqual([
    "prompt 1",
    "resume",
    "prompt 2",
  ]);
  // One prompt line per message: one filing gesture settles one of them
  const two = ["prompt 1", "resume", "prompt 2"];
  expect(settleCauses(two, "task_create", {}, undefined)).toEqual(["resume", "prompt 2"]);
  expect(settleCauses(two, "task_list", {}, undefined)).toEqual(two);
  expect(
    settleCauses(two, "task_update", { id: "1", status: "completed", description: "d" }, undefined),
  ).toEqual(["prompt 2"]);
  expect(settleCauses(two, "task_create", {}, "a1")).toEqual(two);
  const lifts = (tool: string, args: object, agent: unknown, cause: string) =>
    liftsTriage(tool as any, args as any, agent, cause);
  expect(lifts("task_create", {}, undefined, "prompt")).toBe(true);
  expect(lifts("task_assign_human", {}, "", "prompt")).toBe(true);
  expect(lifts("task_update", { id: "1", description: "d" }, null, "prompt")).toBe(true);
  expect(lifts("task_update", { id: "1", status: "completed" }, undefined, "prompt")).toBe(false);
  expect(lifts("task_update", { id: "1" }, undefined, "prompt")).toBe(false);
  expect(lifts("task_list", {}, undefined, "prompt")).toBe(false);
  expect(lifts("task_epic", { title: "E" }, undefined, "prompt")).toBe(false);
  expect(lifts("task_focus", { epic: "1" }, undefined, "prompt")).toBe(false);
  expect(lifts("task_update", { id: "1", status: "waiting" }, undefined, "resume")).toBe(true);
  expect(lifts("task_create", {}, undefined, "resume")).toBe(false);
  expect(lifts("task_create", {}, undefined, "prompt 1792000000-42")).toBe(true);
  expect(lifts("task_create", {}, "a1", "prompt")).toBe(false);
  // A cause this version does not know is read as a prompt
  expect(lifts("task_create", {}, undefined, "other")).toBe(true);
});

test("the user's tasks: open ones, and the context a compaction gets back", () => {
  const data = parse(
    JSON.stringify({
      version: 2,
      next_id: 5,
      next_epic: 2,
      epics: [{ id: 1, agent: "main", title: "NAS", created: 1, touched: 1 }],
      active: { main: 1 },
      tasks: [
        { id: "1", agent: "main", epic: 1, subject: "Go for reboot", description: "Say go.", status: "waiting", assignee: "human" },
        { id: "2", agent: "main", epic: 1, subject: "Touch ID", description: "x".repeat(300), status: "waiting", assignee: "human" },
        { id: "3", agent: "main", epic: 1, subject: "Answered", status: "completed", assignee: "human" },
        { id: "4", agent: "main", epic: 1, subject: "Mine", status: "waiting" },
        { id: "5", agent: "a1", epic: 0, subject: "Foreign", status: "waiting", assignee: "human" },
      ],
    }),
    1,
  );
  expect(humanOpen(data).map((t) => t.id)).toEqual(["1", "2"]);
  const text = humanContext(data)!;
  expect(text.split("\n")[0]).toBe(
    "Tasks assigned to the user (task_assign_human), still waiting on them:",
  );
  expect(text).toContain("  - #1 Go for reboot (epic #1 NAS): Say go.");
  expect(text).toContain(`  - #2 Touch ID (epic #1 NAS): ${"x".repeat(200)}…`);
  expect(text).not.toContain("Answered");
  expect(text).toContain("task_update(id, status=completed)");
  expect(humanContext(parse(undefined, 1))).toBeUndefined();
});
