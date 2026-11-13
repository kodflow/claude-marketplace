// tasks.test.ts — the pure modules, under `claude plugin test`.
import { test, expect } from "claude-code/testing";
import { call, conformance } from "./conformance.ts";
import { EPIC_PREDICATES_JSON } from "./epic-predicates.ts";
import {
  FLOW_NOTE_AT,
  MAIN,
  MAX_REF,
  MAX_SUBJECT,
  TOOLS,
  closed,
  codePoints,
  idle,
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
  isReadTool,
  liftsTriage,
  parseReadList,
  taskTool,
  settleCauses,
  settlesAny,
  triageCauses,
  triesToWrite,
} from "../../hooks/mod/calls.ts";

test("the port answers every call of the corpus as tasks.py did", () => {
  const { calls, failures, stats } = conformance();
  expect(calls).toBeGreaterThan(150);
  expect(failures).toEqual([]);
  // The amendments, counted: workers carried forward from 9 accepted
  // worker= starts in 6 scenarios over 16 steps (26 states), the subagent
  // refusals of 3 scenarios reworded, 1 scenario retired
  expect(stats).toEqual({ accepted: 9, steps: 16, states: 26, scenarios: 6, subagent: 3, retired: 1 });
});

test("predicates: closed and idle hold the shared fixture", () => {
  const fx = JSON.parse(EPIC_PREDICATES_JSON);
  expect(fx.data.epics[0].closed_at).toBe(Infinity); // 1e999 kept as written
  const ids = (pick: (e: any) => boolean) =>
    fx.data.epics.filter(pick).map((e: any) => e.id);
  expect(ids((e) => closed(e))).toEqual(fx.expect.closed);
  expect(ids((e) => idle(fx.data, e, fx.now, fx.live))).toEqual(fx.expect.idle);
  expect(closed(undefined)).toBe(false);
});

// One call through the port on an in-memory file, as conformance.ts plays them
function scratch(workers: any[] = []) {
  let file: string | undefined;
  let now = 1800000000;
  return {
    run(tool: string, args: Record<string, unknown>, agent = MAIN) {
      const got = call(file, tool as any, agent, args, now++, workers);
      file = got.file;
      return got.answer;
    },
    data: () => JSON.parse(file!),
    workers,
  };
}

test("lifecycle: close, what a closed epic refuses, reopen", () => {
  const s = scratch([{ id: "w1", type: "impl", alive: true }]);
  s.run("task_epic", { title: "Ship" });
  s.run("task_create", { subject: "Build", epic: 1 });
  s.run("task_create", { subject: "Later", epic: 1 });
  expect(s.run("task_focus", { epic: "1", close: true, reopen: true }).text).toContain(
    "close and reopen together",
  );
  s.run("task_update", { id: "1", status: "in_progress" });
  const busy = s.run("task_focus", { epic: "1", close: true });
  expect(busy.error).toBe(true);
  expect(busy.text).toContain("in progress: #1 Build");
  s.run("task_update", { id: "1", status: "completed" });
  const shut = s.run("task_focus", { epic: "Ship", close: true });
  expect(shut).toEqual({
    error: false,
    text: 'Epic #1 Ship closed (1/2): no task can be filed in it until task_focus(epic="1", reopen=true).',
  });
  const data = s.data();
  expect(typeof data.epics[0].closed_at).toBe("number");
  expect(data.active.main).toBeUndefined();
  expect(s.run("task_focus", { epic: "1", close: true }).text).toBe("epic #1 Ship is already closed.");
  expect(s.run("task_create", { subject: "x", epic: 1 }).text).toContain(
    'epic #1 Ship is closed: reopen it first with task_focus(epic="1", reopen=true)',
  );
  expect(s.run("task_assign_human", { subject: "go", epic: 1 }).error).toBe(true);
  expect(s.run("task_focus", { epic: "1" }).text).toContain("is closed: reopen it first");
  expect(s.run("task_update", { id: "2", status: "in_progress" }).text).toContain(
    "until then its tasks take only status completed or deleted",
  );
  expect(s.run("task_update", { id: "2", subject: "Renamed" }).error).toBe(true);
  expect(s.run("task_update", { id: "2", status: "completed" }).error).toBe(false);
  expect(s.run("task_list", {}).text).toBe("No tasks and no epic.");
  expect(s.run("task_focus", { epic: "1", reopen: true }).text).toBe(
    "Epic #1 Ship reopened and active (2/2): file its tasks with task_create(epic=1).",
  );
  expect(s.data().epics[0].closed_at).toBeUndefined();
  expect(s.data().active.main).toBe(1);
  expect(s.run("task_focus", { epic: "1", reopen: true }).error).toBe(true);
  // Another agent's epic is not found
  expect(s.run("task_focus", { epic: "1", close: true }, "a1").text).toContain("no epic 1");
});

test("lifecycle: a waiting user task and a live worker's own tasks hold the close", () => {
  const s = scratch([{ id: "w1", type: "impl", alive: true }]);
  s.run("task_epic", { title: "Ship" });
  s.run("task_assign_human", { subject: "Say go", epic: 1 });
  expect(s.run("task_focus", { epic: "1", close: true }).text).toContain("waiting on the user: #1 Say go");
  s.run("task_update", { id: "1", status: "completed" });
  s.run("task_create", { subject: "Build", epic: 1 });
  s.run("task_update", { id: "2", status: "in_progress", worker: "impl" });
  s.run("task_create", { subject: "Helper step", epic: 0 }, "w1");
  s.run("task_update", { id: "2", status: "completed" });
  const held = s.run("task_focus", { epic: "1", close: true });
  expect(held.text).toContain("worker w1 still has #3 Helper step");
  s.run("task_update", { id: "3", status: "completed" }, "w1");
  expect(s.run("task_focus", { epic: "1", close: true }).error).toBe(false);
  // A stopped worker holds nothing
  const t = scratch([{ id: "w2", type: "impl", alive: true }]);
  t.run("task_epic", { title: "Other" });
  t.run("task_create", { subject: "Build", epic: 1 });
  t.run("task_update", { id: "1", status: "in_progress", worker: "w2" });
  t.run("task_create", { subject: "Left", epic: 0 }, "w2");
  t.run("task_update", { id: "1", status: "pending" });
  t.workers[0].alive = false;
  expect(t.run("task_focus", { epic: "1", close: true }).error).toBe(false);
});

test("workers: every accepted worker= once, in order; a completed with worker= adds nothing", () => {
  const s = scratch([
    { id: "w1", type: "impl", alive: true },
    { id: "w2", type: "rev", alive: true },
  ]);
  s.run("task_create", { subject: "Build", epic: 0 });
  s.run("task_update", { id: "1", status: "in_progress", worker: "impl" });
  s.run("task_update", { id: "1", status: "pending" });
  s.run("task_update", { id: "1", status: "in_progress", worker: "rev" });
  s.run("task_update", { id: "1", status: "pending" });
  s.run("task_update", { id: "1", status: "in_progress", worker: "w1" });
  expect(s.data().tasks[0].workers).toEqual(["w1", "w2"]);
  s.run("task_update", { id: "1", status: "completed", worker: "w2" });
  expect(s.data().tasks[0].workers).toEqual(["w1", "w2"]);
  expect(s.data().tasks[0].worker_id).toBeUndefined();
  // A refused start adds nothing
  s.run("task_create", { subject: "Other", epic: 0 });
  s.workers[1].alive = false;
  expect(s.run("task_update", { id: "2", status: "in_progress", worker: "rev" }).error).toBe(true);
  expect(s.data().tasks[1].workers).toBeUndefined();
});

test("subagents: task_epic refused, and refusals send them to epic=0", () => {
  const s = scratch();
  s.run("task_epic", { title: "Main work" });
  const opened = s.run("task_epic", { title: "Mine" }, "a1");
  expect(opened).toEqual({
    error: true,
    text: "task_epic is the main agent's: a subagent has no epic of its own and files its tasks with task_create(subject, epic=0).",
  });
  const create = s.run("task_create", { subject: "Step", epic: 1 }, "a1");
  expect(create.text).toBe(
    "no epic 1 for this agent; no epic is open. Epics are the main agent's: a subagent files its tasks with task_create(subject, epic=0).",
  );
  const focus = s.run("task_focus", { epic: "1" }, "a1");
  expect(focus.text).toBe(
    "no open epic 1; no epic is open. Epics are the main agent's: a subagent files its tasks with task_create(subject, epic=0).",
  );
  expect(s.run("task_create", { subject: "Step", epic: 0 }, "a1").error).toBe(false);
});

test("texts: no tool and no refusal promises the status line", () => {
  for (const tool of TOOLS) {
    const text = JSON.stringify(tool).replace(/SDK status-line/g, "");
    expect(text).not.toMatch(/status line|status-line/);
  }
  const s = scratch();
  expect(s.run("task_create", { subject: "x".repeat(31), epic: 0 }).text).not.toContain("status line");
  expect(s.run("task_epic", { title: "x".repeat(21) }).text).not.toContain("status line");
  // A question needs no task; work that writes does
  expect(TOOLS[0]!.description).toContain("A question needs no task");
  expect(TOOLS[0]!.description).not.toContain("a question included");
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

test("triage: the read list, the write mark, one gesture settling all", () => {
  const list = parseReadList(
    "# comment\nRead\nWebFetch\nmcp__kodflow-hooks__task_*\nmcp__github__get_me\n\n",
  );
  expect(list).toEqual(["Read", "WebFetch", "mcp__kodflow-hooks__task_*", "mcp__github__get_me"]);
  expect(isReadTool(list, "Read")).toBe(true);
  expect(isReadTool(list, "mcp__kodflow-hooks__task_list")).toBe(true);
  expect(isReadTool(list, "mcp__github__get_me")).toBe(true);
  // Exact names only: a forge write ending in _read is a write
  expect(isReadTool(list, "mcp__github__mark_all_notifications_read")).toBe(false);
  expect(isReadTool(parseReadList(undefined), "Read")).toBe(false);
  expect(triesToWrite(list, "Edit", undefined)).toBe(true);
  expect(triesToWrite(list, "Skill", undefined)).toBe(true);
  expect(triesToWrite(list, "Bash", undefined)).toBe(false);
  expect(triesToWrite(list, "Read", undefined)).toBe(false);
  expect(triesToWrite(list, "Edit", "a1")).toBe(false);
  expect(settlesAny("task_create", {}, undefined)).toBe(true);
  expect(settlesAny("task_update", { id: "1", status: "completed" }, undefined)).toBe(true);
  expect(settlesAny("task_update", { id: "1", description: "d" }, undefined)).toBe(true);
  expect(settlesAny("task_update", { id: "1" }, undefined)).toBe(false);
  expect(settlesAny("task_list", {}, undefined)).toBe(false);
  expect(settlesAny("task_create", {}, "a1")).toBe(false);
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

// --- the task tree: parent, blocked_by, ref ------------------------------------

const NOW = 1791900000;

/** A list of one epic (#1) and the calls made on it, step by step. */
function session() {
  let file: string | undefined = JSON.stringify({
    version: 2,
    next_id: 1,
    next_epic: 3,
    epics: [
      { id: 1, agent: "main", title: "Tree", created: NOW, touched: NOW },
      { id: 2, agent: "main", title: "Other", created: NOW, touched: NOW },
    ],
    active: { main: 1 },
    tasks: [],
  });
  const run = (tool: any, args: Record<string, unknown>) => {
    const got = call(file, tool, MAIN, args, NOW, []);
    file = got.file;
    return got.answer;
  };
  const task = (id: string) =>
    JSON.parse(file!).tasks.find((t: any) => t.id === id);
  return { run, task, file: () => JSON.parse(file!) };
}

test("subject: 30 characters at most, the limit and where the detail goes in the refusal", () => {
  const s = session();
  expect(MAX_SUBJECT).toBe(30);
  expect(s.run("task_create", { subject: "x".repeat(30), epic: 1 }).error).toBe(false);
  const long = s.run("task_create", { subject: "x".repeat(31), epic: 1 });
  expect(long.error).toBe(true);
  expect(long.text).toContain("subject is 31 characters, the limit is 30");
  expect(long.text).toContain("move the detail to description");
  const update = s.run("task_update", { id: "1", subject: "y".repeat(31) });
  expect(update.error).toBe(true);
  expect(update.text).toContain("the limit is 30");
});

test("a longer subject already in the file is kept as written, never rewritten", () => {
  const before = JSON.stringify({
    version: 2,
    next_id: 2,
    next_epic: 1,
    epics: [],
    active: {},
    tasks: [{ id: "1", agent: "main", epic: 0, subject: "A subject written before the limit", status: "pending", created: 1, updated: 1 }],
  });
  const got = call(before, "task_update", MAIN, { id: "1", status: "completed" }, NOW, []);
  expect(got.answer.error).toBe(false);
  expect(JSON.parse(got.file!).tasks[0].subject).toBe("A subject written before the limit");
});

test("parent: a subtask in its parent's epic, three levels at most, no cycle", () => {
  const s = session();
  s.run("task_create", { subject: "Top", epic: 1, ref: "C6" });
  expect(s.run("task_create", { subject: "Mid", epic: 1, parent: "1" }).error).toBe(false);
  expect(s.run("task_create", { subject: "Leaf", epic: 1, parent: "#2" }).error).toBe(false);
  expect(s.task("2").parent).toBe("1");
  expect(s.task("3").parent).toBe("2");
  // A fourth level is refused, with the limit
  const deep = s.run("task_create", { subject: "Too deep", epic: 1, parent: "3" });
  expect(deep.error).toBe(true);
  expect(deep.text).toContain("would reach 4 levels, the limit is 3");
  // A parent that does not exist, or in another epic
  const missing = s.run("task_create", { subject: "Orphan", epic: 1, parent: "99" });
  expect(missing.text).toBe("parent: no task #99 in this agent's list to file #4 under");
  const other = s.run("task_create", { subject: "Elsewhere", epic: 2, parent: "1" });
  expect(other.text).toContain("a subtask is filed in its parent's epic");
  // A task under its own subtask is a cycle
  const cycle = s.run("task_update", { id: "1", parent: "3" });
  expect(cycle.error).toBe(true);
  expect(cycle.text).toContain("that would be a cycle");
  expect(s.run("task_update", { id: "2", parent: "2" }).text).toContain("cycle");
  // Moving a task with children counts their levels too
  s.run("task_create", { subject: "Second", epic: 1 });
  s.run("task_create", { subject: "Under 2nd", epic: 1, parent: "4" });
  const moved = s.run("task_update", { id: "2", parent: "5" });
  expect(moved.text).toContain("would reach 4 levels");
  // "" takes it out of any
  expect(s.run("task_update", { id: "3", parent: "" }).error).toBe(false);
  expect(Object.hasOwn(s.task("3"), "parent")).toBe(false);
  // A refusal changes nothing: the file is as it was
  expect(s.task("2").parent).toBe("1");
});

test("blocked_by: existing tasks, not itself, no cycle however long; [] clears", () => {
  const s = session();
  s.run("task_create", { subject: "A", epic: 1 });
  s.run("task_create", { subject: "B", epic: 1, blocked_by: ["1"] });
  s.run("task_create", { subject: "C", epic: 1, blocked_by: "2, #1, 2" });
  expect(s.task("2").blockedBy).toEqual(["1"]);
  expect(s.task("3").blockedBy).toEqual(["2", "1"]);
  expect(s.run("task_create", { subject: "D", epic: 1, blocked_by: ["9"] }).text).toBe(
    "blocked_by: no task #9 in this agent's list",
  );
  expect(s.run("task_update", { id: "1", blocked_by: ["1"] }).text).toBe(
    "blocked_by: #1 cannot wait on itself",
  );
  const cycle = s.run("task_update", { id: "1", blocked_by: ["3"] });
  expect(cycle.error).toBe(true);
  expect(cycle.text).toBe(
    "blocked_by: #1 waiting on #3 would be a cycle, #3 already waits on #1 (#3 → #2 → #1)",
  );
  expect(Object.hasOwn(s.task("1"), "blockedBy")).toBe(false);
  expect(s.run("task_update", { id: "3", blocked_by: [] }).error).toBe(false);
  expect(Object.hasOwn(s.task("3"), "blockedBy")).toBe(false);
});

test("flow note: said once at three pending tasks with no blocked_by, never a refusal, nothing written", () => {
  const s = session();
  const NOTE = "no blocked_by between them";
  expect(FLOW_NOTE_AT).toBe(3);
  expect(s.run("task_create", { subject: "A", epic: 1 }).text).not.toContain(NOTE);
  expect(s.run("task_create", { subject: "B", epic: 1 }).text).not.toContain(NOTE);
  const before = s.file();
  const third = s.run("task_create", { subject: "C", epic: 1 });
  expect(third.error).toBe(false);
  expect(third.text).toContain("Task #3 created: C in epic #1 Tree. Note: epic #1 has 3 pending tasks");
  expect(third.text).toContain("task_update(id, blocked_by=[...])");
  expect(third.text).toContain("run in parallel");
  // only the task is added: no flag on the epic, no other field
  expect(s.file().epics).toEqual(before.epics);
  expect(s.run("task_create", { subject: "D", epic: 1 }).text).not.toContain(NOTE);
  // epic 0 and an epic with one dependency declared stay silent
  const q = session();
  for (const x of ["A", "B", "C"])
    expect(q.run("task_create", { subject: x, epic: 0 }).text).not.toContain(NOTE);
  const d = session();
  d.run("task_create", { subject: "A", epic: 1 });
  d.run("task_create", { subject: "B", epic: 1, blocked_by: ["1"] });
  expect(d.run("task_create", { subject: "C", epic: 1 }).text).not.toContain(NOTE);
});

test("task_create's description asks for blocked_by on a plan and says ready tasks run in parallel", () => {
  const create = TOOLS[0]!;
  expect(create.description).toContain("each one declares blocked_by");
  expect(create.description).toContain("one subagent each in its own worktree");
  expect(create.description).toContain("rebased onto the default branch");
  expect(create.description).not.toMatch(/\bmain\b branch|onto main/);
  expect(create.inputSchema.properties.blocked_by.description).toContain("run in parallel");
});

test("ref: 5 characters at most, \"\" clears it", () => {
  const s = session();
  expect(s.run("task_create", { subject: "Policy", epic: 1, ref: "C1–C5" }).error).toBe(false);
  expect(s.task("1").ref).toBe("C1–C5");
  const long = s.run("task_update", { id: "1", ref: "C1-C55" });
  expect(long.error).toBe(true);
  expect(long.text).toContain("ref is 6 characters, the limit is 5");
  expect(s.run("task_update", { id: "1", ref: "" }).error).toBe(false);
  expect(Object.hasOwn(s.task("1"), "ref")).toBe(false);
});

test("a deleted task leaves no dangling link: subtasks go up, waiting stops", () => {
  const s = session();
  s.run("task_create", { subject: "Root", epic: 1 });
  s.run("task_create", { subject: "Mid", epic: 1, parent: "1" });
  s.run("task_create", { subject: "Leaf", epic: 1, parent: "2", blocked_by: ["2"] });
  s.run("task_create", { subject: "After", epic: 1, blocked_by: ["2", "1"] });
  expect(s.run("task_update", { id: "2", status: "deleted" }).error).toBe(false);
  expect(s.task("3").parent).toBe("1");
  expect(Object.hasOwn(s.task("3"), "blockedBy")).toBe(false);
  expect(s.task("4").blockedBy).toEqual(["1"]);
});

test("the file stays version 2, the new fields only on the tasks that set them", () => {
  const s = session();
  s.run("task_create", { subject: "Plain", epic: 1 });
  s.run("task_create", { subject: "Linked", epic: 1, parent: "1", blocked_by: ["1"], ref: "T0" });
  const data = s.file();
  expect(data.version).toBe(2);
  expect(Object.keys(data.tasks[0]).sort()).toEqual(
    ["agent", "created", "description", "epic", "id", "status", "subject", "updated"],
  );
  expect(data.tasks[1]).toMatchObject({ parent: "1", blockedBy: ["1"], ref: "T0" });
});

test("tools: subject at 30, parent, blocked_by and ref offered on create and update", () => {
  for (const tool of [TOOLS[0]!, TOOLS[1]!]) {
    const props = tool.inputSchema.properties;
    expect(props.subject.maxLength).toBe(30);
    expect(props.parent.type).toBe("string");
    expect(props.blocked_by).toMatchObject({ type: "array", items: { type: "string" } });
    expect(props.ref.maxLength).toBe(MAX_REF);
    expect(tool.description).toContain("30 characters");
  }
  expect(TOOLS[5]!.inputSchema.properties.subject.maxLength).toBe(30);
});
