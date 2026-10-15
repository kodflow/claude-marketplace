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
//     empty — each is caught there and nowhere else.

import type { Register } from "claude-code";
import type { KtnActivation, KtnSnap } from "../../types";
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

const SNAP = { plugin: "kodflow-ktn", key: "snap" } as const;

// The module's own copy: the fast source. A reload starts it over, and the
// next reconciliation rebuilds it from the disk; `$.state` keeps what is drawn.
let snap: KtnSnap = { activation: "probing" };
let resolution: Resolution | undefined;
let probing = false;
let started = false;
let activation: Activation = "auto";

/** Writes a transition twice: the module's variable, then `$.state`. */
async function publish($: any, next: KtnSnap): Promise<void> {
  snap = next;
  await $.state.set(SNAP, next).catch(() => undefined);
}

const isLive = (a: KtnActivation) => a !== "inert" && a !== "floor";

/** Leaving a Go project: nothing of the mod stays on screen. */
function standDown($: any): void {
  $.ui.status(undefined);
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
    await publish($, {
      activation: verdict,
      root,
      workspace: verdict === "active" ? workspaceRoot(r) : undefined,
    });
    if (was === "active" && verdict !== "active") standDown($);
  } finally {
    probing = false;
  }
}

/**
 * The one reconciliation point. Walks again when the root moved or the last
 * walk could still change its mind, and puts the snapshot back in `$.state`
 * when it came back empty (a /clear, a worker that was replaced).
 */
async function reconcile($: any): Promise<void> {
  if (!started || !isLive(snap.activation)) return;
  const root: string | undefined = await $.session.root().catch(() => undefined);
  if (root !== undefined && (root !== snap.root || worthReprobing(resolution)))
    await probe($);
  const held = await $.state.get(SNAP).catch(() => undefined);
  if (held && held.value === undefined) await publish($, snap);
}

/** The session's start, or a surface attaching to a session that had none. */
async function start($: any): Promise<void> {
  started = true;
  const v = await $.session.version().catch(() => undefined);
  if (!atLeast(v?.base ?? v?.version, MIN_ENGINE)) {
    await publish($, { activation: "floor" });
    $.ui.status(`ktn: Claude Code ${MIN_ENGINE} ou plus requis`);
    return;
  }
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
      return `ktn: projet Go, workspace ${snap.workspace ?? "?"}`;
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
    await start($);
    return result;
  }).catch(($, e, next) => next(e));

  // A host that attaches its first surface after the start
  on("session.attach", async ($, e, next) => {
    const result = await next(e);
    if (!started && snap.activation === "inert")
      await start($).catch(() => undefined);
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
  // hold the prompt up to 30 s (#774)
  on("command.run", { command: "ktn-view" }, async () => ({ text: commandText() }));
};
