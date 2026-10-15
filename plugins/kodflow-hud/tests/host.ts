// host.ts — the host beneath the module under `claude plugin test`, in
// memory: files, agents, commands, toasts, processes, with the clock the
// test moves. Shared by the wiring and the tree tests.
import { mock } from "claude-code/testing";

export const CFG = "/cfg";
export const SID = "sess-1";
export const TASKS = `${CFG}/kodflow/sessions/${SID}/tasks.json`;
export const NOW = 1_800_000_000_000;
export const SEC = NOW / 1000;
export const PR = "https://github.com/kodflow/claude-marketplace/pull/42";

export type Host = {
  files: Map<string, { text: string; mtimeMs: number }>;
  dirs: Set<string>;
  agents: { id: string; type: string; name?: string; status: string }[];
  toasts: string[];
  opened: string[];
  commands: string[];
  runs: string[][];
  checks: { exitCode: number; stdout: string };
};

export function host(on: any): {
  h: Host;
  clock: ReturnType<typeof mock.clock>;
} {
  const h: Host = {
    files: new Map(),
    dirs: new Set(["/w/repo/.git"]),
    agents: [],
    toasts: [],
    opened: [],
    commands: [],
    runs: [],
    checks: { exitCode: 0, stdout: "build\tpass\t1m\turl" },
  };
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { CLAUDE_CONFIG_DIR: CFG, HOME: "/u/dev" });
  on("session.id", async () => ({ value: SID }));
  on("session.root", async () => ({ value: "/w/repo" }));
  on("session.model", async () => ({ value: "claude-opus-5-5" }));
  on("session.start", async (_$: any, e: any) => ({ cwd: e.cwd ?? "/w/repo" }));
  on("command.register", async (_$: any, e: any) => {
    h.commands.push(e.name);
    return { value: undefined };
  });
  on("ui.open", async (_$: any, e: any) => {
    h.opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on("ui.toast", async (_$: any, e: any) => {
    h.toasts.push(e.text);
    return { value: undefined };
  });
  on("agent.list", async () => ({ value: h.agents }));
  on("fs.exists", async (_$: any, e: any) => ({
    value: h.dirs.has(e.path) || h.files.has(e.path),
  }));
  on("fs.stat", async (_$: any, e: any) => {
    const f = h.files.get(e.path);
    if (!f) return { deny: "ENOENT" };
    return {
      value: {
        kind: "file",
        size: f.text.length,
        mtimeMs: f.mtimeMs,
        isLink: false,
      },
    };
  });
  on("fs.read", async (_$: any, e: any) => {
    const f = h.files.get(e.path);
    return f ? { value: f.text } : { deny: "ENOENT" };
  });
  on("process.run", async (_$: any, e: any) => {
    h.runs.push(e.argv);
    return {
      value: {
        exitCode: h.checks.exitCode,
        stdout: h.checks.stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  // The tools themselves: whatever they are asked, they answer this
  on("tool.call", async (_$: any, e: any) => ({
    result: { stdout: `ran ${e.tool}`, stderr: "", interrupted: false },
  }));
  return { h, clock };
}

export const tasksJson = (tasks: object[], extra: object = {}) =>
  JSON.stringify({
    version: 2,
    next_id: 9,
    next_epic: 3,
    epics: [
      {
        id: 2,
        agent: "main",
        title: "SDK status-line",
        created: SEC,
        touched: SEC,
      },
    ],
    active: { main: 2 },
    tasks,
    ...extra,
  });

export const T = (id: string, status: string, over: object = {}) => ({
  id,
  agent: "main",
  epic: 2,
  subject: `Task ${id}`,
  status,
  created: SEC,
  updated: SEC,
  ...over,
});

export const writeTasks = (h: Host, tasks: object[], mtimeMs: number) =>
  h.files.set(TASKS, { text: tasksJson(tasks), mtimeMs });

export const PANE = (bodyColumns: number, bodyRows = 30) => ({
  title: "Tâches",
  isFocused: false,
  bodyColumns,
  placement: "dock" as const,
  scroll: { offset: 0, bodyRows },
  view: {},
});

export const start = async ($: any, clock: any) => {
  await $.session.start({ source: "startup", cwd: "/w/repo" });
  await clock.settle();
};
