// guards.test.ts — modwall, collision-guard and zsh-safe, under `claude
// plugin test`: the wiring through register.ts with the host in memory, and
// the pure decisions beside it.
import { test, expect, mock } from "claude-code/testing";
import {
  decision,
  judge,
  marketplaceOf,
  remember,
  report,
} from "../../hooks/mod/modwall.ts";
import {
  WINDOW_S,
  answer,
  excluded,
  isLive,
  newest,
  normalize,
  parse,
  record,
  targetOf,
} from "../../hooks/mod/collision.ts";
import { zdotdirOf, zdotdirPlan } from "../../hooks/mod/zsh.ts";

const CFG = "/cfg";
const SID = "sess-1";
const OTHER = "sess-2";
const SESSIONS = `${CFG}/kodflow/sessions`;
const ROOT = "/plugins/kodflow-hooks";

type Host = {
  files: Map<string, string>;
  env: Map<string, string | undefined>;
  store: Map<string, unknown>;
  asked: string[];
  toasts: string[];
  commands: string[];
  answer?: string;
  writes: number;
};

function host(on: any, env: Record<string, string>): Host {
  const h: Host = {
    files: new Map(),
    env: new Map(Object.entries(env)),
    store: new Map(),
    asked: [],
    toasts: [],
    commands: [],
    writes: 0,
  };
  on("env.get", async (_$: any, e: any) => ({ value: h.env.get(e.name) }));
  on("env.set", async (_$: any, e: any) => {
    h.env.set(e.name, e.value);
    return { value: undefined };
  });
  on("store.get", async (_$: any, e: any) => ({ value: h.store.get(e.key) }));
  on("store.set", async (_$: any, e: any) => {
    h.store.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("session.id", async () => ({ value: SID }));
  on("session.cwd", async () => ({ value: "/repo" }));
  on("session.root", async () => ({ value: "/repo" }));
  on("session.start", async (_$: any, e: any) => ({ cwd: e.cwd ?? "/repo" }));
  on("tool.register", async (_$: any, e: any) => ({
    value: { tool: `mcp__kodflow-hooks__${e.name}` },
  }));
  on("command.register", async (_$: any, e: any) => {
    h.commands.push(e.name);
    return { value: { command: e.name } };
  });
  on("ui.toast", async (_$: any, e: any) => {
    h.toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.log", async () => ({ value: undefined }));
  on("fs.write", async (_$: any, e: any) => {
    h.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.read", async (_$: any, e: any) => {
    const text = h.files.get(e.path);
    return text === undefined ? { deny: "ENOENT" } : { value: text };
  });
  on("fs.list", async (_$: any, e: any) => {
    const prefix = `${e.path}/`;
    const names = new Set<string>();
    for (const k of h.files.keys())
      if (k.startsWith(prefix))
        names.add(k.slice(prefix.length).split("/")[0]!);
    if (names.size === 0) return { deny: "ENOENT" };
    return {
      value: [...names].map((name) => ({
        name,
        kind: "dir",
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("process.run", async () => ({
    value: {
      exitCode: 0,
      stdout: "",
      stderr: "",
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }));
  on("tool.call", { tool: "AskUserQuestion" }, async (_$: any, e: any) => {
    const q = e.questions?.[0]?.question ?? "";
    h.asked.push(q);
    if (h.answer === undefined) return { deny: "dismissed" };
    return { result: { questions: e.questions, answers: { [q]: h.answer } } };
  });
  on("tool.call", { tool: ["Write", "Edit"] }, async () => {
    h.writes++;
    return { result: { type: "update", filePath: "x", content: "" } } as any;
  });
  return h;
}

const now = () => Math.floor(Date.now() / 1000);

// Another live session that wrote `path` `ago` seconds back
function otherSession(h: Host, path: string, ago: number, beatAgo = 1) {
  h.files.set(`${SESSIONS}/${OTHER}/edits.tsv`, `${now() - ago}\t${path}\n`);
  h.files.set(`${SESSIONS}/${OTHER}/mod-beat`, String(now() - beatAgo));
}

const write = ($: any, file_path: string) =>
  $.tool.call({ tool: "Write", file_path, content: "x" } as any);

// --- collision-guard, through the engine ---

test("collision-guard: a write is noted in this session's edits.tsv, path and time only", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await write($, "src/a.ts");
  const line = h.files.get(`${SESSIONS}/${SID}/edits.tsv`)!;
  expect(line).toMatch(/^\d{10}\t\/repo\/src\/a\.ts\n$/);
  expect(h.asked).toEqual([]);
});

test("collision-guard: a recent edit by another live session asks; Cancel denies", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  otherSession(h, "/repo/src/a.ts", 120);
  h.answer = "Cancel";
  const r: any = await write($, "/repo/src/a.ts");
  expect(h.asked.length).toBe(1);
  expect(h.asked[0]).toContain("/repo/src/a.ts");
  expect(r.deny ?? r.text).toContain("cancelled");
  expect(h.writes).toBe(0);
  expect(h.files.has(`${SESSIONS}/${SID}/edits.tsv`)).toBe(false);
});

test("collision-guard: Move to a worktree denies with EnterWorktree", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  otherSession(h, "/repo/src/a.ts", 60);
  h.answer = "Move to a worktree";
  const r: any = await write($, "/repo/src/a.ts");
  expect(r.deny ?? r.text).toContain("EnterWorktree");
  expect(h.writes).toBe(0);
});

test("collision-guard: Continue writes, and is not asked again for the same edit", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  otherSession(h, "/repo/src/b.ts", 60);
  h.answer = "Continue";
  await write($, "/repo/src/b.ts");
  await write($, "/repo/src/b.ts");
  expect(h.writes).toBe(2);
  expect(h.asked.length).toBe(1);
});

test("collision-guard: no answer (dismissed, or -p) lets the write through", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  otherSession(h, "/repo/src/c.ts", 60);
  await write($, "/repo/src/c.ts");
  expect(h.asked.length).toBe(1);
  expect(h.writes).toBe(1);
});

test("collision-guard: an old edit, a stale beat or Claude's projects dir ask nothing", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  h.answer = "Cancel";
  otherSession(h, "/repo/old.ts", WINDOW_S + 5);
  await write($, "/repo/old.ts");
  otherSession(h, "/repo/gone.ts", 10, WINDOW_S + 5);
  await write($, "/repo/gone.ts");
  otherSession(h, `${CFG}/projects/x/memory/a.md`, 10);
  await write($, `${CFG}/projects/x/memory/a.md`);
  expect(h.asked).toEqual([]);
  expect(h.writes).toBe(3);
});

test("collision-guard: KODFLOW_MOD=off asks nothing and notes nothing", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_MOD: "off" });
  otherSession(h, "/repo/src/a.ts", 60);
  h.answer = "Cancel";
  await write($, "/repo/src/a.ts");
  expect(h.asked).toEqual([]);
  expect(h.writes).toBe(1);
  expect(h.files.has(`${SESSIONS}/${SID}/edits.tsv`)).toBe(false);
});

// --- modwall and zsh-safe, through the engine ---

test(
  "modwall: a user-tier module from elsewhere never joins, and the refusal is journaled",
  {
    plugins: [
      {
        name: "rogue",
        register(on) {
          on("session.start", async ($, e, next) => {
            $.ui.toast("rogue loaded");
            return next(e);
          });
        },
      },
    ],
  },
  async ($, on) => {
    const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
    // The kit fails a load an inline plugin was refused at: the refusal is
    // the engine's own, naming kodflow-hooks and its reason
    const failed = await $.session.start({ source: "startup", cwd: "/repo" } as any).then(
      () => undefined,
      (err: Error) => err.message,
    );
    expect(failed).toContain("rogue: refused by kodflow-hooks: modwall: rogue@");
    expect(failed).toContain("only *@kodflow mods load in the user tier");
    expect(h.toasts).not.toContain("rogue loaded");
    const journal = h.store.get("modwall") as any[];
    expect(journal.at(-1)).toEqual(expect.objectContaining({ name: "rogue", tier: "user", verdict: "refused" }));
  },
);

test(
  "modwall: KODFLOW_MOD=off judges nothing",
  {
    plugins: [
      {
        name: "rogue",
        register(on) {
          on("session.start", async ($, e, next) => {
            $.ui.toast("rogue loaded");
            return next(e);
          });
        },
      },
    ],
  },
  async ($, on) => {
    const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_MOD: "off" });
    await $.session.start({ source: "startup", cwd: "/repo" } as any);
    expect(h.toasts).toContain("rogue loaded");
  },
);

test("zsh-safe: session.start points ZDOTDIR at hooks/zsh and keeps the user's", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, ZDOTDIR: "/u/.config/zsh" });
  await $.session.start({ source: "startup", cwd: "/repo" } as any);
  expect(h.env.get("ZDOTDIR")).toMatch(/\/hooks\/zsh$/);
  expect(h.env.get("KODFLOW_USER_ZDOTDIR")).toBe("/u/.config/zsh");
  // Again (a /clear): unchanged
  await $.session.start({ source: "clear", cwd: "/repo" } as any);
  expect(h.env.get("KODFLOW_USER_ZDOTDIR")).toBe("/u/.config/zsh");
});

// --- the pure decisions ---

test("modwall: judged by provenance, the user tier only", () => {
  expect(marketplaceOf("a@b@kodflow")).toBe("kodflow");
  expect(marketplaceOf("nothing")).toBe("");
  expect(
    judge({
      name: "kodflow-hooks",
      tier: "user",
      provenance: "kodflow-hooks@evil",
    }),
  ).toHaveProperty("refuse");
  expect(judge({ name: "x", tier: "user", provenance: "x@kodflow" })).toEqual({
    allow: true,
  });
  expect(judge({ name: "x", tier: "append", provenance: "x@corp" })).toEqual({
    skip: true,
  });
  expect(
    judge({ name: "x", tier: "user", provenance: "x@kodflow-fork" }),
  ).toHaveProperty("refuse");
  const d = decision({ name: "x", tier: "user", provenance: "x@inline" }, 100);
  expect(remember("garbage", d)).toEqual([d]);
  expect(remember(Array(150).fill(d), d).length).toBe(100);
  expect(report([], [])).toContain("none");
  const listed = report([d], [d]);
  expect(listed).toContain("refused    x@inline (user)");
  expect(listed).toMatch(/1970-01-01 00:01:40 {2}x@inline \(user\)/);
});

test("collision: paths, the window, one line per path", () => {
  expect(normalize("/a/./b/../c//d")).toBe("/a/c/d");
  expect(targetOf("Edit", { file_path: "x/y.ts" }, "/repo")).toBe(
    "/repo/x/y.ts",
  );
  expect(targetOf("NotebookEdit", { notebook_path: "/n.ipynb" }, "/r")).toBe(
    "/n.ipynb",
  );
  expect(targetOf("Read", { file_path: "/a" }, "/r")).toBeUndefined();
  expect(excluded("/cfg/projects/p/x.jsonl", "/cfg")).toBe(true);
  expect(excluded("/cfg/projectsX/a", "/cfg")).toBe(false);
  const t = 10_000;
  let text = record(undefined, "/a", t - WINDOW_S - 1);
  text = record(text, "/b", t - 10);
  text = record(text, "/b", t);
  text = record(text, "/c", t);
  expect(parse(text)).toEqual([
    { at: t, path: "/b" },
    { at: t, path: "/c" },
  ]);
  expect(record("", "/tab\there", t)).toBe("");
  expect(isLive(String(t - 5), t)).toBe(true);
  expect(isLive(String(t - WINDOW_S), t)).toBe(false);
  expect(isLive(undefined, t)).toBe(false);
  expect(newest("/b", [{ session: "s", text }], t)).toEqual({
    session: "s",
    at: t,
  });
  expect(answer("Continue", "/b")).toEqual({ go: true });
  expect(answer("something else", "/b")).toHaveProperty("deny");
});

test("zsh: ZDOTDIR plan", () => {
  const ours = zdotdirOf("/p/kodflow-hooks/");
  expect(ours).toBe("/p/kodflow-hooks/hooks/zsh");
  expect(zdotdirPlan(ours, "", ours)).toBeUndefined();
  expect(zdotdirPlan(undefined, undefined, ours)).toEqual({
    zdotdir: ours,
    user: "",
  });
  expect(zdotdirPlan("/u/zsh", undefined, ours)).toEqual({
    zdotdir: ours,
    user: "/u/zsh",
  });
  // The plugin moved under a running process: the saved value stays
  expect(zdotdirPlan("/old/kodflow-hooks/hooks/zsh", "/u/zsh", ours)).toEqual({
    zdotdir: ours,
    user: "/u/zsh",
  });
  // A nested claude: its ZDOTDIR is the user's again, saved anew
  expect(zdotdirPlan("/u/zsh", "/u/zsh", ours)).toEqual({
    zdotdir: ours,
    user: "/u/zsh",
  });
});
