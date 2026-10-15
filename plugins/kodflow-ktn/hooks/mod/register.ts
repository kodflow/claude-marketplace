// register.ts — kodflow-ktn's function hooks: the one module that touches `$`.
//
// The mod COMPLETES ktn-linter's hooks and replaces none (decision of
// 2026-10-14, kodflow/ktn-linter#774): the command hooks keep delivering the
// findings to the model through the daemon's socket, everywhere, Kepler
// included. So nothing here hooks a tool call (no `tool.call`, no
// `classic.PreToolUse` / `PostToolUse`): CI asserts it on the validator's
// report.
//
// Every hook is registered unconditionally and is inert until the session
// proves to be a Go project:
//   - nothing draws in a `-p` run, the Agent SDK or Kepler's launch mode
//     (`$.session.surfaces()` empty, #774): the mod stays inert there;
//   - under the version floor it says so once and does nothing else;
//   - `session.start` registers the command and hands the probe to the
//     background: it never waits on it, and it never calls the daemon;
//   - the ONE reconciliation point is `turn.complete` of the main loop and
//     `classic.SessionStart` after a /clear, /resume or fork: the root moved
//     (`/cd`, a worktree), a folder gained its go.mod, `$.state` came back
//     empty, a timer a hook refused — each is caught there and nowhere else.
//
// The daemon is reached through client.ts (pure, port-injected) and drawn by
// view.ts (pure): what is here is the port and the wiring.

import type { Register } from "claude-code";
import type { KtnActivation, KtnDaemon, KtnSnap } from "../../types";
import { Client, type Port } from "./client.ts";
import {
  COMMAND,
  MIN_ENGINE,
  PROBE_MAX_CALLS,
  PROBE_MAX_MS,
} from "./contract.ts";
import { atLeast } from "./engine.ts";
import {
  parseActivation,
  resolveProject,
  verdictOf,
  workspaceRoot,
  worthReprobing,
  type Activation,
  type Resolution,
} from "./project.ts";
import { band, safe, stateLine, statusText } from "./view.ts";

const SNAP = { plugin: "kodflow-ktn", key: "snap" } as const;

// The module's own copy: the fast source. A reload starts it over, and the
// next reconciliation rebuilds it from the disk; `$.state` keeps what is drawn.
let snap: KtnSnap = { activation: "probing" };
let resolution: Resolution | undefined;
let probing = false;
let started = false;
let activation: Activation = "auto";
let client: Client | undefined;
let lastStatus: string | undefined;

// $.state takes JSON data: no undefined anywhere in it
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Writes a transition twice: the module's variable, then `$.state`. */
async function publish($: any, next: KtnSnap): Promise<void> {
  snap = plain(next);
  await $.state.set(SNAP, snap).catch(() => undefined);
}

/** The status line, written only when its text changes. */
function status($: any): void {
  const text = statusText(snap);
  if (text === lastStatus) return;
  lastStatus = text;
  $.ui.status(text);
}

const isLive = (a: KtnActivation) => a !== "inert" && a !== "floor";

/** Leaving a Go project: no timer, no request, nothing on screen. */
function standDown($: any): void {
  client?.stop();
  lastStatus = undefined;
  $.ui.status(undefined);
}

/** The engine, as client.ts sees it. */
function portOf($: any, canRun: boolean): Port {
  return {
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    read: (path) => $.fs.read(path),
    home: () => $.env.get("HOME"),
    fetch: (url, init) => $.http.fetch(url, init),
    run: canRun ? (argv, init) => $.process.run(argv, init) : undefined,
    emit: (daemon: KtnDaemon) => {
      if (snap.activation !== "active") return;
      void publish($, { ...snap, daemon }).then(() => status($));
    },
  };
}

/**
 * The activation probe: at most three listings and 250 ms, walked up from
 * the session's root (never `repo().root`, which names the MAIN working tree
 * of a linked worktree and would turn every Kepler worktree off).
 */
async function probe($: any): Promise<void> {
  if (probing) return;
  probing = true;
  try {
    const root: string = await $.session.root();
    const t0: number = await $.clock.now();
    const r = await resolveProject(root, (dir) => $.fs.list(dir), {
      maxCalls: PROBE_MAX_CALLS,
      expired: async () => (await $.clock.now()) - t0 > PROBE_MAX_MS,
    });
    resolution = r;
    const verdict = verdictOf(r, activation);
    const was = snap.activation;
    if (verdict !== "active") {
      await publish($, { activation: verdict, root });
      if (was === "active") standDown($);
      return;
    }
    const workspace = workspaceRoot(r);
    const same = was === "active" && snap.workspace === workspace;
    await publish($, {
      activation: "active",
      root,
      workspace,
      daemon: same ? snap.daemon : { kind: "loading", launch: "none" },
    });
    client?.setWorkspace(workspace);
    status($);
    // Off the start's path: the hook that probed has returned long ago
    if (!same) void client?.refresh();
  } finally {
    probing = false;
  }
}

/**
 * The one reconciliation point. Walks again when the root moved or the last
 * walk could still change its mind, puts the snapshot back in `$.state` when
 * it came back empty (a /clear, a worker that was replaced), re-arms a timer
 * that never fired, and refreshes the status line with a request that waits
 * on nothing (`wait=0`).
 */
async function reconcile($: any): Promise<void> {
  if (!started || !isLive(snap.activation)) return;
  const root: string | undefined = await $.session.root().catch(() => undefined);
  if (root !== undefined && (root !== snap.root || worthReprobing(resolution)))
    await probe($);
  const held = await $.state.get(SNAP).catch(() => undefined);
  if (held && held.value === undefined) await publish($, snap);
  if (snap.activation !== "active" || !client) return;
  await client.reconcile();
  void client.refresh({ waitS: 0 });
}

/** The session's start, or a surface attaching to a session that had none. */
async function start($: any, surfaces: readonly string[]): Promise<void> {
  started = true;
  const v = await $.session.version().catch(() => undefined);
  if (!atLeast(v?.base ?? v?.version, MIN_ENGINE)) {
    await publish($, { activation: "floor" });
    $.ui.status(`ktn: Claude Code ${MIN_ENGINE} ou plus requis`);
    return;
  }
  // Host commands are the CLI's (`$.process` is "CLI only"): on a session
  // the terminal does not draw, the button becomes a command to copy
  const canRun = surfaces.includes("terminal");
  client = new Client(portOf($, canRun));
  await $.command
    .register({
      name: "ktn-view",
      description: "ktn-linter : état du daemon et constats du projet Go",
    })
    .catch((err: unknown) =>
      $.ui.log(`kodflow-ktn: /${COMMAND} refusé : ${String(err)}`, {
        to: "debug",
      }),
    );
  await publish($, { activation: "probing" });
  // Detached: the probe's listings are not the start's to wait on
  void probe($).catch(() => undefined);
}

function commandText(): string {
  switch (snap.activation) {
    case "active":
      return `${stateLine(snap).text} (workspace ${snap.workspace ?? "?"})`;
    case "undetermined":
      return "ktn: projet indéterminé (sonde interrompue) ; activation: always pour forcer";
    case "probing":
      return "ktn: sonde du projet en cours";
    case "floor":
      return `ktn: Claude Code ${MIN_ENGINE} ou plus requis`;
    default:
      return "ktn: pas un projet Go";
  }
}

/** The launch button's action: a person's act, so the breaker gives way. */
function launch(): void {
  if (!client) return;
  client.userAction();
  void client.launch();
}

export const register: Register = (on, options) => {
  activation = parseActivation(options.activation);

  // ONE session.start: two without a matcher keep the module from loading
  on("session.start", async ($, e, next) => {
    const surfaces = await $.session.surfaces().catch(() => []);
    if (surfaces.length === 0) {
      await publish($, { activation: "inert" });
      return next(e);
    }
    const result = next(e);
    await start($, surfaces);
    return result;
  }).catch(($, e, next) => next(e));

  // A host that attaches its first surface after the start
  on("session.attach", async ($, e, next) => {
    const result = await next(e);
    if (!started && snap.activation === "inert")
      await start($, await $.session.surfaces().catch(() => [e.surface])).catch(
        () => undefined,
      );
    return result;
  }).catch(($, e, next) => next(e));

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined) void reconcile($).catch(() => undefined);
    return result;
  }).catch(($, e, next) => next(e));

  on("classic.SessionStart", async ($, e, next) => {
    const result = await next(e);
    void reconcile($).catch(() => undefined);
    return result;
  }).catch(($, e, next) => next(e));

  // The name is spelled out (COMMAND) so the validator reads the matcher.
  // Answers from what the module holds: never a daemon call, which would
  // hold the prompt up to 30 s (#774). A person's act: the breaker gives way
  // and a refresh leaves in the background.
  on("command.run", { command: "ktn-view" }, async () => {
    if (snap.activation === "active" && client) {
      client.userAction();
      void client.refresh({ waitS: 0, force: true });
    }
    return { text: commandText() };
  });

  // The band above the prompt, while there is something to act on
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const els: any = $.ui.resolve(e);
    const held = (await $.state.get(SNAP).catch(() => undefined))?.value ?? snap;
    const tree = safe(els, () => band(els, held, { launch }));
    return tree ?? next(e);
  });
};
