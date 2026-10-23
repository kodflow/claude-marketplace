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
  /** What each `bash` the mod ran read on stdin (on-mod.sh's payload). */
  stdins: string[];
  registered: any[];
  commands: any[];
  agents: { id: string; type: string; name?: string; status: string }[];
  failMv?: boolean;
  /** The engine version $.session.version() reports. */
  version: string;
};

// A file system and the five commands the mod runs, enough to hold it to
// its protocol: mkdir for the lock, mv for the swap, rm and rmdir after.
function host(on: any, env: Record<string, string>): Host {
  const h: Host = {
    files: new Map(),
    dirs: new Set(["/", CFG]),
    runs: [],
    stdins: [],
    registered: [],
    commands: [],
    agents: [],
    version: "2.1.296",
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
  on("session.cwd", async () => ({ value: "/repo" }));
  on("session.version", async () => ({
    value: { version: h.version, base: h.version },
  }));
  on("tool.register", async (_$: any, e: any) => {
    h.registered.push(e);
    return { value: { tool: T(e.name) } };
  });
  on("agent.list", async () => ({ value: h.agents }));
  on("command.register", async (_$: any, e: any) => {
    h.commands.push(e);
    return { value: { command: e.name } };
  });
  on("fs.exists", async (_$: any, e: any) => ({
    value: h.dirs.has(e.path) || h.files.has(e.path),
  }));
  on("clock.sleep", async () => ({ value: undefined }));
  on("fs.write", async (_$: any, e: any) => {
    mkdirs(parent(e.path));
    h.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.read", async (_$: any, e: any) => {
    // A key "*/a/b" stands for a file under the plugin root, wherever it is
    const text =
      h.files.get(e.path) ??
      [...h.files].find(([k]) => k.startsWith("*/") && e.path.endsWith(k.slice(1)))?.[1];
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
    const stdin = e.init?.stdin ?? e.stdin;
    if (argv[0] === "bash" && typeof stdin === "string") h.stdins.push(stdin);
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
      case "git":
        return done(1);
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

test("the six task tools are registered, in the prompt from the start", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  expect(h.registered.map((t) => t.name)).toEqual([
    "task_create",
    "task_update",
    "task_epic",
    "task_focus",
    "task_list",
    "task_assign_human",
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

// The triage gate the shell raises: one cause per line (on-user.sh writes
// prompt, on-session.sh resume)
const TP = `${DIR}/triage-pending`;

test("task_list, task_epic, task_focus and a bare task_update leave the triage gate up", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  await $.tool.call({ tool: T("task_create"), subject: "x", epic: 0 } as any);
  h.files.set(TP, "prompt\nresume\n");
  await $.tool.call({ tool: T("task_list") } as any);
  expect(h.files.get(TP)).toBe("prompt\nresume\n");
  await $.tool.call({ tool: T("task_epic"), title: "E" } as any);
  expect(h.files.get(TP)).toBe("prompt\nresume\n");
  await $.tool.call({ tool: T("task_focus"), epic: "1" } as any);
  expect(h.files.get(TP)).toBe("prompt\nresume\n");
  await $.tool.call({ tool: T("task_update"), id: "1" } as any);
  expect(h.files.get(TP)).toBe("prompt\nresume\n");
});

test("a message is filed by task_create, task_assign_human or task_update(description)", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  h.files.set(TP, "prompt\n");
  const r: any = await $.tool.call({ tool: T("task_create"), subject: "q", epic: 0 } as any);
  expect(r.result).toBe("Task #1 created: q");
  expect(h.files.has(TP)).toBe(false);
  await $.tool.call({ tool: T("task_epic"), title: "E" } as any);
  // The file before causes existed: empty, read as a prompt
  h.files.set(TP, "");
  const human: any = await $.tool.call({
    tool: T("task_assign_human"),
    subject: "Say go",
    epic: 1,
  } as any);
  expect(human.result).toContain("assigned to the user");
  expect(h.files.has(TP)).toBe(false);
  h.files.set(TP, "prompt\n");
  await $.tool.call({ tool: T("task_update"), id: "1", status: "in_progress" } as any);
  expect(h.files.get(TP)).toBe("prompt\n");
  await $.tool.call({ tool: T("task_update"), id: "1", description: "more context" } as any);
  expect(h.files.has(TP)).toBe(false);
});

test("a resumed session is settled by task_update(status), each cause on its own", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  await $.tool.call({ tool: T("task_create"), subject: "x", epic: 0 } as any);
  h.files.set(TP, "resume\n");
  await $.tool.call({ tool: T("task_update"), id: "1", description: "d" } as any);
  expect(h.files.get(TP)).toBe("resume\n");
  await $.tool.call({ tool: T("task_update"), id: "1", status: "completed" } as any);
  expect(h.files.has(TP)).toBe(false);
  h.files.set(TP, "prompt\nresume\n");
  await $.tool.call({ tool: T("task_update"), id: "1", status: "deleted" } as any);
  expect(h.files.get(TP)).toBe("prompt\n");
  await $.tool.call({ tool: T("task_create"), subject: "y", epic: 0 } as any);
  expect(h.files.has(TP)).toBe(false);
});

test("a refused task call leaves the gate; a failing store lifts it (fail open)", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  h.files.set(TP, "prompt\n");
  const noEpic: any = await $.tool.call({ tool: T("task_create"), subject: "x" } as any);
  expect(refusal(noEpic)).toBeDefined();
  expect(h.files.get(TP)).toBe("prompt\n");
  const unknown: any = await $.tool.call({
    tool: T("task_update"),
    id: "99",
    description: "d",
  } as any);
  expect(refusal(unknown)).toBeDefined();
  expect(h.files.get(TP)).toBe("prompt\n");
  h.failMv = true;
  const failed: any = await $.tool.call({ tool: T("task_create"), subject: "x", epic: 0 } as any);
  expect(refusal(failed)).toContain("kodflow task tools failed");
  expect(h.files.has(TP)).toBe(false);
});

test("one gesture per message: two prompts need two filing calls", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  h.files.set(TP, "prompt 1792000000-1\nprompt 1792000005-2\n");
  await $.tool.call({ tool: T("task_list") } as any);
  expect(h.files.get(TP)).toBe("prompt 1792000000-1\nprompt 1792000005-2\n");
  await $.tool.call({ tool: T("task_create"), subject: "first", epic: 0 } as any);
  expect(h.files.get(TP)).toBe("prompt 1792000005-2\n");
  await $.tool.call({ tool: T("task_list") } as any);
  expect(h.files.get(TP)).toBe("prompt 1792000005-2\n");
  await $.tool.call({ tool: T("task_update"), id: "1", description: "second" } as any);
  expect(h.files.has(TP)).toBe(false);
  // Under its own lock, released, nothing left beside it
  expect(h.dirs.has(`${DIR}/.triage.lock.d`)).toBe(false);
  expect([...h.files.keys()].filter((k) => k.endsWith(".tmp"))).toEqual([]);
});

test("a subagent's task call never touches the gate", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  h.files.set(TP, "prompt\n");
  await $.tool.call({ tool: T("task_create"), subject: "x", epic: 0, agentId: "a1" } as any);
  expect(h.files.get(TP)).toBe("prompt\n");
  h.failMv = true;
  await $.tool.call({ tool: T("task_create"), subject: "y", epic: 0, agentId: "a1" } as any);
  expect(h.files.get(TP)).toBe("prompt\n");
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

test("a task for the user: filed waiting, closed by task_update, main agent only", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await start($);
  await $.tool.call({ tool: T("task_epic"), title: "NAS" } as any);
  const r: any = await $.tool.call({
    tool: T("task_assign_human"),
    subject: "Give the go",
    epic: 1,
  } as any);
  expect(r.result).toContain("Task #1 assigned to the user, waiting: Give the go");
  const task = JSON.parse(h.files.get(`${DIR}/tasks.json`)!).tasks[0];
  expect(task).toEqual(
    expect.objectContaining({ status: "waiting", assignee: "human", epic: 1 }),
  );
  const sub: any = await $.tool.call({
    tool: T("task_assign_human"),
    subject: "Touch ID",
    epic: 1,
    agentId: "a1",
  } as any);
  expect(refusal(sub)).toContain("task_assign_human is the main agent's");
  const done: any = await $.tool.call({
    tool: T("task_update"),
    id: "1",
    status: "completed",
  } as any);
  expect(done.result).toBe("Task #1 updated: Give the go (completed)");
});

test("after a compaction the user's open tasks come back as context, and only then", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  on("classic.SessionStart", async () => ({ additionalContext: ["shell"] }));
  await start($);
  await $.tool.call({ tool: T("task_epic"), title: "NAS" } as any);
  await $.tool.call({
    tool: T("task_assign_human"),
    subject: "Give the go",
    epic: 1,
    description: "Reply go.",
  } as any);
  const compact: any = await $.classic.SessionStart({
    source: "compact",
    session_id: SID,
  } as any);
  expect(compact.additionalContext[0]).toBe("shell");
  expect(compact.additionalContext[1]).toContain(
    "  - #1 Give the go (epic #1 NAS): Reply go.",
  );
  const resumed: any = await $.classic.SessionStart({
    source: "resume",
    session_id: SID,
  } as any);
  expect(resumed.additionalContext).toEqual(["shell"]);
  h.files.delete(`${DIR}/tasks.json`);
  const none: any = await $.classic.SessionStart({
    source: "compact",
    session_id: SID,
  } as any);
  expect(none.additionalContext).toEqual(["shell"]);
});

test("/lint-setup is registered and answers outside a Go project without asking", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  h.dirs.add("/repo");
  await start($);
  expect(h.commands.map((c) => c.name)).toContain("lint-setup");
  const r: any = await $.command.run({ command: "lint-setup", args: "" } as any);
  expect(r.text).toContain("No go.mod at or above /repo inside /repo");
  expect(h.runs.some((a) => a[0] === "curl" || a[0] === "ktn-linter")).toBe(
    false,
  );
});

// ---------------------------------------------------------------------------
// The Bash pipeline and the veil, wired (pipeline.test.ts holds the logic)
// ---------------------------------------------------------------------------

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const STATUS =
  'On branch feat/x\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n\tmodified:   a.txt\n\nno changes added to commit (use "git add" and/or "git commit -a")\n';
const out = (stdout: string) => ({
  result: {
    stdout,
    stderr: "",
    interrupted: false,
    isImage: false,
    noOutputExpected: false,
  },
});
test("Bash: what comes back is the filtered output, every other key kept", async ($, on) => {
  host(on, { CLAUDE_CONFIG_DIR: CFG });
  on("tool.call", { tool: "Bash" }, async () => out(STATUS) as any);
  await start($);
  const r: any = await $.tool.call({ tool: "Bash", command: "git status" } as any);
  expect(r.result.stdout).not.toContain("(use ");
  expect(r.result.stdout).toContain("modified:   a.txt");
  expect(Object.keys(r.result).sort()).toEqual(
    ["interrupted", "isImage", "noOutputExpected", "stderr", "stdout"],
  );
  const raw: any = await $.tool.call({ tool: "Bash", command: "cat status.txt" } as any);
  expect(raw.result.stdout).toBe(STATUS);
});

test("Bash: an engine version CI has not validated gets the output whole", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  h.version = "2.1.297";
  on("tool.call", { tool: "Bash" }, async () => out(STATUS) as any);
  await start($);
  const r: any = await $.tool.call({ tool: "Bash", command: "git status" } as any);
  expect(r.result.stdout).toBe(STATUS);
});

test("veil: a credential in any tool's result is masked before the model reads it", async ($, on) => {
  host(on, { CLAUDE_CONFIG_DIR: CFG, GITHUB_TOKEN: "env-" + "value-0123456789" });
  const gh = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
  on("tool.call", { tool: "Bash" }, async () => out(`token ${gh}\nenv-value-0123456789\n`) as any);
  on("tool.call", { tool: "mcp__srv__read" }, async () => ({ result: `x ${gh}` }) as any);
  await start($);
  const r: any = await $.tool.call({ tool: "Bash", command: "printenv" } as any);
  expect(r.result.stdout).not.toContain(gh);
  expect(r.result.stdout).not.toContain("env-value-0123456789");
  expect(r.result.stdout).toContain("[masked:");
  const m: any = await $.tool.call({ tool: "mcp__srv__read" } as any);
  expect(JSON.stringify(m)).not.toContain(gh);
});

test("guards: the mod refuses what the shell refuses, with its motif", async ($, on) => {
  host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_ROOT: "off" });
  let reached = 0;
  on("tool.call", { tool: "Bash" }, async () => (reached++, out("")) as any);
  await start($);
  const r: any = await $.tool.call({
    tool: "Bash",
    command: "git commit -n -m x",
  } as any);
  expect(refusal(r)).toContain("[motif:no-verify]");
  expect(reached).toBe(0);
});

test("blocks: a refusal of the mod hands its motif and title to on-mod.sh", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_ROOT: "off" });
  on("tool.call", { tool: "Bash" }, async () => out("") as any);
  await start($);
  await $.tool.call({ tool: "Bash", command: "git commit -n -m x" } as any);
  await $.tool.call({ tool: "Bash", command: "git status" } as any);
  // journal() is fire-and-forget: let its process.run land
  for (let i = 0; i < 50 && !h.stdins.some((t) => t.includes('"block"')); i++)
    await new Promise((r) => setTimeout(r, 10));
  const sent = h.stdins.map((t) => JSON.parse(t));
  const denied = sent.filter((p) => p.reason === "guards:deny");
  expect(denied.length).toBe(1);
  expect(denied[0].block.motif).toBe("no-verify");
  expect(denied[0].block.title).toContain("skipping git hooks");
  expect(Object.keys(denied[0].block).sort()).toEqual(["motif", "title"]);
  expect(sent.filter((p) => p.block && p.reason !== "guards:deny")).toEqual([]);
});

// The vendored rules' shape (hooks/patterns), in miniature: a plugin test
// reads no file. The real files are replayed by tests/mod/run-node.ts.
const PATTERNS =
  "# @scope: commit,pr\nnoreply@anthropic\\.com\n# @scope: commit\n^[[:space:]]*plan:[[:space:]]\n";
const STRICT = "# @scope: commit\n\\bclaude\\b\n\\.claude/\n";

test("attribution: without hooks/patterns, a commit message is refused, never read as clean", async ($, on) => {
  host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_ROOT: "off" });
  let reached = 0;
  on("tool.call", { tool: "Bash" }, async () => (reached++, out("")) as any);
  await start($);
  const r: any = await $.tool.call({
    tool: "Bash",
    command: 'git commit -m "feat: plain"',
  } as any);
  expect(refusal(r)).toContain("hooks/patterns unreadable");
  expect(reached).toBe(0);
});

test("attribution: hooks/patterns read, scoped for commit and pr, leaks before keywords", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_ROOT: "off" });
  h.files.set("*/hooks/patterns/patterns.txt", PATTERNS);
  h.files.set("*/hooks/patterns/patterns-strict.txt", STRICT);
  let reached = 0;
  on("tool.call", { tool: "Bash" }, async () => (reached++, out("")) as any);
  await start($);
  const call = (command: string) =>
    $.tool.call({ tool: "Bash", command } as any) as any;
  expect(refusal(await call('git commit -m "feat: x" -m "Plan: y"'))).toContain(
    "[motif:leak]",
  );
  expect(refusal(await call('git commit -m "fix: see .claude/x"'))).toContain(
    "[motif:leak]",
  );
  expect(refusal(await call('git commit -m "fix: claude"'))).toContain(
    "[motif:attribution]",
  );
  await call('git commit -m "feat: plain"');
  await call(
    'gh pr create --title x --body "Plan: y, for claude, in .claude/x"',
  );
  expect(reached).toBe(2);
});

test("merge: the main thread merges with no question, Bash or forge tool; a subagent is refused", async ($, on) => {
  host(on, { CLAUDE_CONFIG_DIR: CFG });
  let asked = 0;
  let reached = 0;
  on("tool.call", { tool: "AskUserQuestion" }, async () => (asked++, { result: {} }) as any);
  on("tool.call", { tool: "Bash" }, async () => (reached++, out("merged")) as any);
  on("tool.call", { tool: "mcp__github__merge_pull_request" }, async () => (reached++, { result: "merged" }) as any);
  await start($);
  const r: any = await $.tool.call({ tool: "Bash", command: "gh pr merge 12 -R o/r --squash" } as any);
  expect(refusal(r)).toBeUndefined();
  const mcp: any = await $.tool.call({
    tool: "mcp__github__merge_pull_request",
    owner: "o",
    repo: "r",
    pullNumber: 12,
  } as any);
  expect(refusal(mcp)).toBeUndefined();
  expect([asked, reached]).toEqual([0, 2]);
  const sub: any = await $.tool.call({
    tool: "Bash",
    command: `gh pr merge 12 -R o/r --match-head-commit ${HEAD}`,
    agentId: "a1",
  } as any);
  expect(refusal(sub)).toContain("a subagent does not merge");
  expect(reached).toBe(2);
});

test("rm -rf, reset --hard: run with no question, the user at the prompt or not", async ($, on) => {
  host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_ROOT: "off" });
  let asked = 0;
  let reached = 0;
  on("tool.call", { tool: "AskUserQuestion" }, async () => (asked++, { result: {} }) as any);
  on("tool.call", { tool: "Bash" }, async () => (reached++, out("")) as any);
  await start($);
  await $.tool.call({ tool: "Bash", command: "rm -rf build" } as any);
  await $.prompt
    .submit({ text: "clean up", origin: { kind: "composer" } } as any)
    .catch(() => undefined);
  const r: any = await $.tool.call({ tool: "Bash", command: "rm -rf build" } as any);
  expect(refusal(r)).toBeUndefined();
  await $.tool.call({ tool: "Bash", command: "git reset --hard origin/main" } as any);
  expect([asked, reached]).toEqual([0, 3]);
});
