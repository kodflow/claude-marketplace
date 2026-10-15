// harness.ts — a port for client.ts with a clock the test moves, a disk and
// a daemon in memory, and a record of every request, run and drawing.
import type { Answer, Port, Timer } from "../../hooks/mod/client.ts";
import type { KtnDaemon, KtnModel } from "../../types/index.d.ts";

export const HOME = "/u/dev";
export const ANCHOR = `${HOME}/.local/state/ktn-linter/endpoint.json`;
export const SOCKET = "/run/user/1000/ktn-linter/user.sock";
export const EXE = "/opt/ktn/bin/ktn-linter";
export const WS = "/w/repo";

export const endpointJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, socket: SOCKET, state_json: "/run/user/1000/ktn-linter/state.json", exe: EXE, version: "1.46.0", ...over });

export const statusJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ protocol_version: "v1", state: "watching", ...over });

export const counts = (error: number, warning: number, info: number) => ({
  findings: error + warning + info,
  severity: { error, warning, info },
  phase: { "2": error, "6": warning, "7": info },
});

export const modelJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: "v1",
    rev: 1760000000001,
    workspace: WS,
    state: "watching",
    totals: counts(1, 2, 3),
    tree: {
      nodes: [
        { id: "dir:.", kind: "dir", name: ".", depth: 0, expanded: true, counts: counts(1, 2, 3) },
        { id: "dir:pkg", kind: "dir", name: "pkg", parent: "dir:.", depth: 1, expanded: false, counts: counts(1, 2, 3) },
      ],
    },
    window: { offset: 0, limit: 200, returned: 2, total: 2 },
    truncated: false,
    activity: [],
    ...over,
  });

type Pending = { due: number; fn: () => void; done: boolean };

export class Clock {
  t = 1_800_000_000_000;
  timers: Pending[] = [];
  /** When set, every new timer is accepted and never fires (a refused hook). */
  refuse = false;
  after(ms: number, fn: () => void): Timer {
    const p: Pending = { due: this.t + ms, fn, done: this.refuse };
    if (!this.refuse) this.timers.push(p);
    return { cancel: () => void (p.done = true) };
  }
  /** Timers armed and neither fired nor cancelled. */
  armed(): number {
    return this.timers.filter((p) => !p.done).length;
  }
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      await flush();
      const next = this.timers
        .filter((p) => !p.done && p.due <= target)
        .sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      this.t = next.due;
      next.done = true;
      next.fn();
    }
    this.t = target;
    await flush();
  }
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

/** A promise the test settles by hand: the daemon that takes its time. */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type World = {
  clock: Clock;
  files: Map<string, string>;
  /** Answers each request by its path; throw to reject as the transport would. */
  daemon: (path: string, url: string) => Promise<Answer>;
  requests: string[];
  runs: { argv: string[]; init: any }[];
  runResult: () => Promise<{ exitCode: number; stderr: string }>;
  emitted: { daemon: KtnDaemon; model?: KtnModel }[];
  last: () => KtnDaemon;
  port: Port;
};

export function world(opts: { canRun?: boolean } = {}): World {
  const w: any = {
    clock: new Clock(),
    files: new Map<string, string>([[ANCHOR, endpointJson()]]),
    daemon: async (path: string) => {
      if (path.startsWith("/status")) return { status: 200, text: statusJson() };
      return { status: 200, text: modelJson() };
    },
    requests: [],
    runs: [],
    runResult: async () => ({ exitCode: 0, stderr: "" }),
    emitted: [],
  };
  w.last = () => w.emitted.at(-1)?.daemon;
  w.port = {
    now: async () => w.clock.t,
    after: (ms: number, fn: () => void) => w.clock.after(ms, fn),
    read: async (path: string) => {
      const f = w.files.get(path);
      if (f === undefined) throw new Error(`ENOENT: ${path}`);
      return f;
    },
    home: async () => HOME,
    fetch: (url: string, init: { socketPath: string }) => {
      if (init.socketPath !== SOCKET) throw new Error("wrong socket");
      const path = url.slice("http://ktn".length);
      w.requests.push(path);
      return w.daemon(path, url);
    },
    run:
      opts.canRun === false
        ? undefined
        : async (argv: string[], init: any) => {
            w.runs.push({ argv, init });
            return w.runResult();
          },
    emit: (daemon: KtnDaemon, model?: KtnModel) => w.emitted.push({ daemon, model }),
  } as Port;
  return w as World;
}
