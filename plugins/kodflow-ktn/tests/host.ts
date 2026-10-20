// host.ts — the world beneath kodflow-ktn under `claude plugin test`, in
// memory: a directory tree, the surfaces, the engine's version, and a record
// of what the mod asked for (commands, status lines, panes, fetches, runs).
// Every hook here stands for the engine, so what it answers reaches the mod
// as a session would hand it over.
import { mock } from "claude-code/testing";

export const NOW = 1_800_000_000_000;

export type Host = {
  /** Directory → entries; a missing directory rejects the listing. */
  dirs: Map<string, { name: string; kind: "file" | "dir" | "other"; isLink: boolean }[]>;
  files: Map<string, string>;
  root: string;
  surfaces: string[];
  version: string;
  commands: string[];
  statuses: (string | undefined)[];
  listed: string[];
  opened: string[];
  closed: string[];
  fetches: { url: string; socketPath?: string }[];
  runs: { argv: readonly string[]; init?: any }[];
  /** How the next fetches are answered, by URL path (`/status`, `/api/view`). */
  answer: (url: string, init: any) => Promise<{ status: number; text: string }>;
  placed: boolean;
  /** The last value the mod wrote under each of its `$.state` keys. */
  state: Record<string, unknown>;
  /** Every write of the snapshot, in order. */
  writes: unknown[];
  /** When set, `$.state.get` answers as a store that lost everything. */
  stateLost: boolean;
  /** Values `$.state.get` answers for these keys, whatever was written (#787). */
  plant: Record<string, unknown>;
  /** The engine window's offset each `ui.scroll` left it at, in order (#787). */
  scrolls: number[];
};

const entry = (name: string, kind: "file" | "dir" | "other" = "file") => ({
  name,
  kind,
  isLink: kind === "other",
});

/** A tree from entries relative to `base`; "x/" a folder, else a file. */
export function lay(h: Host, base: string, tree: string[]): void {
  const ensure = (dir: string) => {
    if (h.dirs.has(dir)) return;
    h.dirs.set(dir, []);
    if (dir === "/") return;
    const cut = dir.lastIndexOf("/");
    const parent = cut <= 0 ? "/" : dir.slice(0, cut);
    ensure(parent);
    h.dirs.get(parent)!.push(entry(dir.slice(cut + 1), "dir"));
  };
  ensure(base);
  for (const t of tree) {
    const path = `${base}/${t}`.replace(/\/$/, "");
    if (t.endsWith("/")) {
      ensure(path);
      continue;
    }
    const cut = path.lastIndexOf("/");
    ensure(path.slice(0, cut) || "/");
    h.dirs.get(path.slice(0, cut) || "/")!.push(entry(path.slice(cut + 1)));
  }
}

export function host(on: any, over: Partial<Host> = {}) {
  const h: Host = {
    dirs: new Map(),
    files: new Map(),
    root: "/w/repo",
    surfaces: ["terminal"],
    version: "2.1.301",
    commands: [],
    statuses: [],
    listed: [],
    opened: [],
    closed: [],
    fetches: [],
    runs: [],
    answer: async () => {
      throw new Error("ECONNREFUSED");
    },
    placed: true,
    state: {},
    writes: [],
    stateLost: false,
    plant: {},
    scrolls: [],
    ...over,
  };
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/u/dev" });
  // Read through, recorded on the way to the kit's own $.state
  on("state.set", async (_$: any, e: any, next: any) => {
    if (e.plugin === "kodflow-ktn") h.state[e.key] = e.value;
    if (e.plugin === "kodflow-ktn" && e.key === "snap") h.writes.push(e.value);
    if (h.stateLost) h.stateLost = false;
    return next(e);
  });
  on("state.get", async (_$: any, e: any, next: any) => {
    if (h.stateLost) return { value: { value: undefined, version: 0 } };
    if (e.plugin === "kodflow-ktn" && e.key in h.plant) return { value: { value: h.plant[e.key], version: 1 } };
    return next(e);
  });
  // The engine's window: where the chain left it
  on("ui.scroll", async (_$: any, e: any) => {
    h.scrolls.push(e.offset);
    return {};
  });
  on("turn.complete", async (_$: any, e: any) => ({ text: e.answer ?? "" }));
  on("classic.SessionStart", async () => ({}));
  on("session.surfaces", async () => ({ value: h.surfaces }));
  on("session.version", async () => ({
    value: { version: h.version, base: h.version },
  }));
  on("session.root", async () => ({ value: h.root }));
  on("session.cwd", async () => ({ value: h.root }));
  on("session.start", async (_$: any, e: any) => ({ cwd: e.cwd ?? h.root }));
  on("command.register", async (_$: any, e: any) => {
    if (e.name === "ktn") return { deny: "it is the plugin's /kodflow-devops:ktn" };
    h.commands.push(e.name);
    return { value: { command: e.name } };
  });
  on("ui.status", async (_$: any, e: any) => {
    h.statuses.push(e.text);
    return { value: undefined };
  });
  on("ui.log", async () => ({ value: undefined }));
  on("ui.open", async (_$: any, e: any) => {
    h.opened.push(e.id);
    return h.placed
      ? { value: { isPlaced: true } }
      : { value: { isPlaced: false, reason: "unasked below 144 columns (120 now)" } };
  });
  on("ui.close", async (_$: any, e: any) => {
    h.closed.push(e.id);
    return { value: undefined };
  });
  on("ui.panes", async () => ({
    value: h.opened
      .filter((id) => !h.closed.includes(id))
      .map((id) => ({ id, title: id, isShown: h.placed, isFocused: false, isPlaced: h.placed })),
  }));
  on("fs.list", async (_$: any, e: any) => {
    h.listed.push(e.path);
    const d = h.dirs.get(e.path);
    return d ? { value: d } : { deny: `ENOENT: ${e.path}` };
  });
  on("fs.read", async (_$: any, e: any) => {
    const f = h.files.get(e.path);
    return f === undefined ? { deny: `ENOENT: ${e.path}` } : { value: f };
  });
  on("fs.exists", async (_$: any, e: any) => ({
    value: h.files.has(e.path) || h.dirs.has(e.path),
  }));
  on("http.fetch", async (_$: any, e: any) => {
    h.fetches.push({ url: e.url, socketPath: e.init?.socketPath });
    try {
      const r = await h.answer(e.url, e.init);
      return {
        value: { status: r.status, ok: r.status >= 200 && r.status < 300, headers: {}, text: r.text },
      };
    } catch (err: any) {
      return { deny: String(err?.message ?? err) };
    }
  });
  on("process.run", async (_$: any, e: any) => {
    h.runs.push({ argv: e.argv, init: e.init });
    return {
      value: { exitCode: 0, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
    };
  });
  return { h, clock };
}

export const start = async ($: any, clock: any, cwd = "/w/repo") => {
  await $.session.start({ cwd, surface: "terminal", isInteractive: true });
  await clock.settle();
};
