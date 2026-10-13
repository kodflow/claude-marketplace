// register.test.ts — the wiring, under `claude plugin test`: the engine's own
// `$` over the plugin, with the host (files, commands, agents) in memory
// beneath it.
import { test, expect, mock } from "claude-code/testing";

const CFG = "/cfg";
const SID = "sess-1";
const DIR = `${CFG}/kodflow/sessions/${SID}`;
const T = (name: string) => `mcp__kodflow-hooks__${name}`;

type Host = {
  files: Map<string, string>;
  dirs: Set<string>;
  runs: string[][];
  registered: any[];
  agents: { id: string; type: string; name?: string; status: string }[];
  failMv?: boolean;
};

// A file system and the five commands the mod runs, enough to hold it to
// its protocol: mkdir for the lock, mv for the swap, rm and rmdir after.
function host(on: any, env: Record<string, string>): Host {
  const h: Host = {
    files: new Map(),
    dirs: new Set(["/", CFG]),
    runs: [],
    registered: [],
    agents: [],
  };
  const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
  const mkdirs = (p: string) => {
    for (let d = p; d !== "/" && !h.dirs.has(d); d = parent(d)) h.dirs.add(d);
  };
  mock.env(on, env);
  on("session.id", async () => ({ value: SID }));
  on("session.start", async (_$: any, e: any) => ({ cwd: e.cwd ?? "/repo" }));
  on("prompt.submit", async (_$: any, e: any) => ({ text: e.text }));
  on("session.root", async () => ({ value: "/repo" }));
  on("tool.register", async (_$: any, e: any) => {
    h.registered.push(e);
    return { value: { tool: T(e.name) } };
  });
  on("agent.list", async () => ({ value: h.agents }));
  on("clock.sleep", async () => ({ value: undefined }));
  on("fs.write", async (_$: any, e: any) => {
    mkdirs(parent(e.path));
    h.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.read", async (_$: any, e: any) => {
    const text = h.files.get(e.path);
    if (text === undefined) return { deny: "ENOENT" };
    return { value: text };
  });
  on("fs.stat", async (_$: any, e: any) => {
    if (!h.dirs.has(e.path) && !h.files.has(e.path)) return { deny: "ENOENT" };
    return {
      value: {
        kind: h.dirs.has(e.path) ? "directory" : "file",
        size: 0,
        mtimeMs: Date.now(),
        isLink: false,
      },
    };
  });
  on("process.run", async (_$: any, e: any) => {
    const argv: string[] = e.argv;
    h.runs.push(argv);
    const done = (exitCode: number) => ({
      value: {
        exitCode,
        stdout: "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    });
    switch (argv[0]) {
      case "mkdir":
        if (argv[1] === "-p") return (mkdirs(argv[2]!), done(0));
        if (h.dirs.has(argv[1]!) || !h.dirs.has(parent(argv[1]!)))
          return done(1);
        h.dirs.add(argv[1]!);
        return done(0);
      case "rmdir":
        return done(h.dirs.delete(argv[1]!) ? 0 : 1);
      case "rm":
        h.files.delete(argv[2]!);
        return done(0);
      case "mv": {
        const [from, to] =
          argv[1] === "-f" ? [argv[2]!, argv[3]!] : [argv[1]!, argv[2]!];
        const text = h.files.get(from);
        if (text === undefined || h.failMv) return done(1);
        h.files.delete(from);
        h.files.set(to, text);
        return done(0);
      }
      case "bash":
        return done(0);
    }
    return done(127);
  });
  return h;
}

// What a refused call answers: `{ deny }` to the test's own $.tool.call
const refusal = (r: any): string | undefined => r.deny ?? (r.isError ? r.text : undefined);

const start = async ($: any) => {
  await $.session.start({ source: "startup", cwd: "/repo" });
};

test("the five task tools are registered, in the prompt from the start", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  expect(h.registered.map((t) => t.name)).toEqual([
    "task_create",
    "task_update",
    "task_epic",
    "task_focus",
    "task_list",
  ]);
  expect(h.registered.every((t) => t.isDeferred === false)).toBe(true);
});

test("a task call writes tasks.json through a temporary file and mv, under the lock", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  const r: any = await $.tool.call({
    tool: T("task_create"),
    subject: "Add the gauge",
    epic: 0,
  } as any);
  expect(r.result).toBe("Task #1 created: Add the gauge");
  const data = JSON.parse(h.files.get(`${DIR}/tasks.json`)!);
  expect(data.tasks[0]).toEqual(
    expect.objectContaining({
      id: "1",
      agent: "main",
      subject: "Add the gauge",
      status: "pending",
    }),
  );
  expect(typeof data.tasks[0].created).toBe("number");
  expect(data.tasks[0].created).toBeLessThan(1e11); // seconds, not milliseconds
  const verbs = h.runs.map((a) => a[0]);
  expect(verbs.slice(verbs.indexOf("mkdir"))).toEqual([
    "mkdir",
    "mkdir",
    "mv",
    "rmdir",
    "bash",
  ]);
  expect(h.runs.find((a) => a[0] === "mv")![2]).toMatch(
    new RegExp(`^${DIR}/\\.tasks\\..+\\.tmp$`),
  );
  expect(h.dirs.has(`${DIR}/.lock.d`)).toBe(false);
  expect([...h.files.keys()].filter((k) => k.endsWith(".tmp"))).toEqual([]);
});

test("a refusal is a deny with tasks.py's text, and writes nothing", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  const r: any = await $.tool.call({
    tool: T("task_create"),
    subject: "Where does it go",
  } as any);
  expect(refusal(r)).toBeDefined();
  expect(refusal(r)).toContain(
    "epic is required: name the epic this task belongs to; no epic is open.",
  );
  expect(h.files.has(`${DIR}/tasks.json`)).toBe(false);
});

test("task_list reads and writes nothing", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  const r: any = await $.tool.call({ tool: T("task_list") } as any);
  expect(r.result).toBe("No tasks and no epic.");
  expect(h.files.has(`${DIR}/tasks.json`)).toBe(false);
  expect(h.runs.some((a) => a[0] === "mv")).toBe(false);
});

test("the in-progress cap counts running, waiting and idle agents of $.agent.list()", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  for (const subject of ["One", "Two", "Three"])
    await $.tool.call({ tool: T("task_create"), subject, epic: 0 } as any);
  await $.tool.call({
    tool: T("task_update"),
    id: "1",
    status: "in_progress",
  } as any);
  h.agents = [
    { id: "a1", type: "general-purpose", name: "fixer", status: "idle" },
    { id: "a2", type: "Explore", status: "completed" },
  ];
  const second: any = await $.tool.call({
    tool: T("task_update"),
    id: "2",
    status: "in_progress",
  } as any);
  expect(second.result).toBe("Task #2 updated: Two (in_progress)");
  const third: any = await $.tool.call({
    tool: T("task_update"),
    id: "3",
    status: "in_progress",
  } as any);
  expect(refusal(third)).toBeDefined();
  expect(refusal(third)).toContain("Running subagents: general-purpose (id a1)");
  // By its SendMessage name
  await $.tool.call({
    tool: T("task_update"),
    id: "2",
    status: "pending",
  } as any);
  const named: any = await $.tool.call({
    tool: T("task_update"),
    id: "3",
    status: "in_progress",
    worker: "fixer",
  } as any);
  expect(named.result).toBe(
    "Task #3 updated: Three (in_progress on worker fixer)",
  );
  expect(JSON.parse(h.files.get(`${DIR}/tasks.json`)!).tasks[2].worker_id).toBe(
    "a1",
  );
  const stopped: any = await $.tool.call({
    tool: T("task_update"),
    id: "2",
    status: "in_progress",
    worker: "a2",
  } as any);
  expect(refusal(stopped)).toContain(
    "cannot start #2 on worker a2: it is stopped.",
  );
});

test("the main loop's task call lowers the triage gate", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  h.files.set(`${DIR}/triage-pending`, "");
  await $.tool.call({ tool: T("task_list") } as any);
  expect(h.files.has(`${DIR}/triage-pending`)).toBe(false);
});

test("the beat is written before the call goes on, in seconds", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  let seen: string | undefined;
  on("tool.call", { tool: "Bash" }, async () => {
    seen = h.files.get(`${DIR}/mod-beat`);
    return { result: { stdout: "", stderr: "", interrupted: false } } as any;
  });
  await start($);
  await $.tool.call({ tool: "Bash", command: "true" } as any);
  expect(seen).toMatch(/^\d{10}$/);
  expect(Math.abs(Number(seen) - Date.now() / 1000)).toBeLessThan(5);
  h.files.delete(`${DIR}/mod-beat`);
  await $.prompt.submit({ text: "hello" } as any).catch(() => undefined);
  expect(h.files.get(`${DIR}/mod-beat`)).toMatch(/^\d{10}$/);
});

test("the paths follow HOME when CLAUDE_CONFIG_DIR is unset", async ($, on) => {
  const h = host(on, { HOME: "/u" });
  h.dirs.add("/u");
  await start($);
  await $.tool.call({ tool: T("task_create"), subject: "x", epic: 0 } as any);
  expect(
    h.files.has(`/u/.claude/kodflow/sessions/${SID}/tasks.json`),
  ).toBe(true);
});

test("KODFLOW_MOD=off: no tool, no beat, attribution left alone", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_MOD: "off" });
  on(
    "tool.call",
    { tool: "Bash" },
    async () =>
      ({ result: { stdout: "", stderr: "", interrupted: false } }) as any,
  );
  on("attribution.text", async (_$: any, e: any) => ({ text: e.text }));
  await start($);
  await $.tool.call({ tool: "Bash", command: "true" } as any);
  await $.prompt.submit({ text: "hello" } as any).catch(() => undefined);
  expect(h.registered).toEqual([]);
  expect(h.files.size).toBe(0);
  expect(
    (await $.attribution.text({ kind: "commit", text: "Co-authored" })).text,
  ).toBe("Co-authored");
});

test("attribution: blank for commit and pr, the rest untouched", async ($, on) => {
  host(on, { CLAUDE_CONFIG_DIR: CFG });
  on("attribution.text", async (_$: any, e: any) => ({ text: e.text }));
  expect(
    (await $.attribution.text({ kind: "commit", text: "trailer" })).text,
  ).toBe("");
  expect((await $.attribution.text({ kind: "pr", text: "footer" })).text).toBe(
    "",
  );
  expect(
    (await $.attribution.text({ kind: "exemption", text: "keep" })).text,
  ).toBe("keep");
  expect(
    (await $.attribution.text({ kind: "remedy", text: "keep too" })).text,
  ).toBe("keep too");
});

test("a failure inside a task tool answers as text, never as a crash", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  h.failMv = true;
  const r: any = await $.tool.call({
    tool: T("task_create"),
    subject: "x",
    epic: 0,
  } as any);
  expect(refusal(r)).toBeDefined();
  expect(refusal(r)).toContain("kodflow task tools failed");
});
