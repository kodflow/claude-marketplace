// tasks.test.ts — the pure modules, under `claude plugin test`.
import { test, expect } from "claude-code/testing";
import { conformance } from "./conformance.ts";
import {
  TOOLS,
  codePoints,
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
  lowersTriage,
  taskTool,
} from "../../hooks/mod/calls.ts";

test("the port answers every call of the corpus as tasks.py did", () => {
  const { calls, failures } = conformance();
  expect(calls).toBeGreaterThan(150);
  expect(failures).toEqual([]);
});

test("tools: five, in tasks.py's order, epic required, worker offered", () => {
  expect(TOOLS.map((t) => t.name)).toEqual([
    "task_create",
    "task_update",
    "task_epic",
    "task_focus",
    "task_list",
  ]);
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
  expect(lowersTriage(undefined)).toBe(true);
  expect(lowersTriage("a1")).toBe(false);
});
