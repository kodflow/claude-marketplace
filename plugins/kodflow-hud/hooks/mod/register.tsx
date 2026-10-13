// register.tsx — kodflow-hud's function hooks: wiring only.
//
// Two panes and a few toasts, beside the status line and never in its place
// (the context segment, the epics' pills and the rest stay there):
//   « Tâches »  the open epics of tasks.json, who works each task, how that
//               worker stands, how long since it moved, the silent ones, and
//               the tasks waiting on the person in a column of their own;
//   « Agents »  per loop (the main one and each subagent), the folder it
//               works in, its last files by operation, its last call.
//
// Everything is read, nothing is decided: tasks.json is kodflow-hooks' file,
// re-read whenever its modification time moves; the agents come from
// `$.agent.list()`; the activity from `tool.call`, observed after `next`
// and handed back untouched. No tool, no context line, no refusal: this mod
// adds nothing to what the model reads and can stop nothing. Every hook
// fails open.
//
// The logic lives in the pure modules beside this file (board.ts,
// activity.ts, alerts.ts, ci.ts, view.tsx); what is here reads `$`.

import { atom, read, update } from "claude-code";
import type { Register } from "claude-code";
import type {
  HudActivity,
  HudAgent,
  HudBoard,
  HudCi,
  HudTask,
} from "../../types";
import { MAIN, parseBoard, parseTasks, type Ctx } from "./board.ts";
import { fold, observe, prune } from "./activity.ts";
import { alertsFor, trimKeys } from "./alerts.ts";
import { CI_EVERY_MS, ciState, prsToCheck } from "./ci.ts";
import { configDir, dirname, sessionDir, tasksFile } from "./paths.ts";
import { agentsView, tasksView } from "./view.tsx";

const boardAtom = atom(
  { plugin: "kodflow-hud", key: "board" } as const,
  {
    found: false,
    epics: [],
  } as HudBoard,
);
const agentsAtom = atom(
  { plugin: "kodflow-hud", key: "agents" } as const,
  [] as HudAgent[],
);
const activityAtom = atom(
  { plugin: "kodflow-hud", key: "activity" } as const,
  {} as Record<string, HudActivity>,
);
const ciAtom = atom(
  { plugin: "kodflow-hud", key: "ci" } as const,
  {} as Record<string, HudCi>,
);
const toastedAtom = atom(
  { plugin: "kodflow-hud", key: "toasted" } as const,
  [] as string[],
);
const primedAtom = atom({ plugin: "kodflow-hud", key: "primed" } as const, "");
const tickAtom = atom({ plugin: "kodflow-hud", key: "tick" } as const, 0);

export const TASKS_PANE = "hud-tasks";
export const AGENTS_PANE = "hud-agents";
const PANES = [
  { id: TASKS_PANE, title: "Tâches" },
  { id: AGENTS_PANE, title: "Agents" },
] as const;

/** How often tasks.json's time, the agents and the TTLs are looked at. */
export const POLL_MS = 3_000;
/** The elapsed times redraw on this step, not on every poll. */
const TICK_MS = 10_000;
const TASK_TOOL = /^mcp__kodflow-hooks__task_(create|update|epic|focus)$/;

// What the module keeps between polls. A reload starts these over, which
// costs one re-read of tasks.json; everything drawn is in `$.state`.
let polling = false;
let checking = false;
let lastSession = "";
let lastMtime: number | undefined = -1;
let allTasks: HudTask[] = [];
let lastCi = 0;
let root: string | undefined;
let home: string | undefined;
const gitRoots = new Map<string, string>();

// Atoms are written only when their value changed: every write redraws
const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The root of the git work tree a folder lies in, else the folder: so the
 * view does not jump between the sub-folders of one project. One stat per
 * level the first time a folder is seen, none after.
 */
async function gitRoot($: any, dir: string): Promise<string> {
  const known = gitRoots.get(dir);
  if (known) return known;
  let found = dir;
  for (let d = dir, i = 0; i < 40; d = dirname(d), i++) {
    if (await $.fs.exists(`${d}/.git`).catch(() => false)) {
      found = d;
      break;
    }
    if (d === "/") break;
  }
  gitRoots.set(dir, found);
  return found;
}

async function tasksPath($: any, session: string): Promise<string | undefined> {
  const cfg = configDir(await $.env.get("CLAUDE_CONFIG_DIR"), home);
  return cfg ? tasksFile(sessionDir(cfg, session)) : undefined;
}

function ctxOf(
  now: number,
  agents: HudAgent[],
  activity: Record<string, HudActivity>,
  silentMs: number,
): Ctx {
  return { now, agents, activity, silentMs };
}

/** One look at the world: tasks.json, the agents, the TTLs, the toasts. */
async function poll($: any, silentMs: number, ci: boolean): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const now = await $.clock.now();
    const session = await $.session.id();
    const path = await tasksPath($, session);
    if (path) {
      const mtime = await $.fs.stat(path).then(
        (s: { mtimeMs: number }) => s.mtimeMs,
        () => undefined,
      );
      if (session !== lastSession || mtime !== lastMtime) {
        const text =
          mtime === undefined
            ? undefined
            : await $.fs.read(path).catch(() => undefined);
        let raw: unknown = undefined;
        try {
          raw = text === undefined ? undefined : JSON.parse(text);
        } catch {
          raw = undefined;
        }
        allTasks = parseTasks(raw);
        const board = parseBoard(text);
        if (!same(await read($, boardAtom), board))
          await update($, boardAtom, () => board);
        lastSession = session;
        lastMtime = mtime;
      }
    }
    const listed = await $.agent.list().catch(() => []);
    const agents: HudAgent[] = listed.map((a: any) => ({
      id: a.id,
      label: a.name || a.type || a.description || a.id.slice(0, 8),
      status: a.status,
    }));
    if (!same(await read($, agentsAtom), agents))
      await update($, agentsAtom, () => agents);
    const pruned = prune(await read($, activityAtom), now);
    if (pruned) await update($, activityAtom, () => pruned);

    const ctx = ctxOf(now, agents, await read($, activityAtom), silentMs);
    const baseline = (await read($, primedAtom)) !== session;
    const toasted = await read($, toastedAtom);
    const { alerts, keys } = alertsFor(
      session,
      allTasks,
      ctx,
      new Set(toasted),
      baseline,
    );
    if (keys.length)
      await update($, toastedAtom, (k) => trimKeys([...k, ...keys]));
    if (baseline) await update($, primedAtom, () => session);
    for (const a of alerts) $.ui.toast(a.text);

    const tick = Math.floor(now / TICK_MS);
    if ((await read($, tickAtom)) !== tick) await update($, tickAtom, () => tick);
    if (ci && now - lastCi >= CI_EVERY_MS) {
      lastCi = now;
      void checkCi($);
    }
  } finally {
    polling = false;
  }
}

/** `gh pr checks` for each pull request an open task cites, one at a time. */
async function checkCi($: any): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const prs = prsToCheck((await read($, boardAtom)).epics);
    for (const pr of prs) {
      const r = await $.process
        .run(["gh", "pr", "checks", pr], { timeoutMs: 20_000 })
        .catch(() => undefined);
      const state = r ? ciState(r.exitCode, r.stdout, r.stderr) : "error";
      const at = await $.clock.now();
      await update($, ciAtom, (m) => ({ ...m, [pr]: { state, at } }));
    }
  } finally {
    checking = false;
  }
}

/** Fold one finished tool call into its loop's activity. */
async function record($: any, e: any, r: any): Promise<void> {
  const loop: string = e.agentId ?? MAIN;
  const obs = observe(String(e.tool), e, root, home);
  // A call that failed still says the loop is alive, not that it touched files
  if (r?.isError) {
    obs.files = [];
    delete obs.commit;
  }
  const dir = obs.dir ? await gitRoot($, obs.dir) : undefined;
  const commit = obs.commit ? await gitRoot($, obs.commit) : undefined;
  const now = await $.clock.now();
  await update($, activityAtom, (m) => ({
    ...m,
    [loop]: fold(m[loop], loop, obs, now, dir, commit),
  }));
}

async function openPanes(
  $: any,
  which: readonly { id: string; title: string }[],
) {
  const placed: string[] = [];
  for (const p of which) {
    const r = await $.ui.open({ id: p.id, title: p.title });
    if (r.isPlaced) placed.push(p.title);
  }
  return placed;
}

/** Write what the panes would draw to KODFLOW_HUD_TRACE, when it is set. */
async function trace($: any): Promise<void> {
  const path = await $.env.get("KODFLOW_HUD_TRACE");
  if (!path || !path.startsWith("/")) return;
  await poll($, settings.silentMs, false);
  const dump = {
    board: await read($, boardAtom),
    agents: await read($, agentsAtom),
    activity: await read($, activityAtom),
  };
  await $.fs.write(path, JSON.stringify(dump, null, 1));
}

// The options, as register received them
const settings = { silentMs: 10 * 60_000, ci: true };

/** Poll now, in the background; a failure waits for the next period. */
function kick($: any): void {
  void poll($, settings.silentMs, settings.ci).catch(() => undefined);
}

export const register: Register = (on, options) => {
  settings.silentMs =
    Math.max(1, Number(options.silentMinutes ?? 10)) * 60_000;
  settings.ci = options.ci !== false;
  const autoOpen = options.autoOpen !== false;

  on("session.start", async ($, e, next) => {
    root = await $.session.root().catch(() => undefined);
    home = await $.env.get("HOME");
    await $.command.register({
      name: "hud",
      description:
        "kodflow-hud: open the Tasks and Agents panes (/hud tasks, /hud agents, /hud off)",
    });
    $.clock.every(POLL_MS, () => kick($));
    kick($);
    // Unasked, the engine seats a pane only where it has room (144 columns);
    // below that it waits, and /hud seats it at any width
    if (autoOpen)
      for (const p of PANES) void $.ui.open(p).catch(() => undefined);
    return next(e);
  }).catch(($, e, next) => next(e));

  // A run with no pane (`claude -p`, a bench) can still show what was
  // collected: KODFLOW_HUD_TRACE names a file, written at the session's end
  on("session.end", async ($, e, next) => {
    await trace($);
    return next(e);
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "hud" }, async ($, e) => {
    const arg = e.args.trim().toLowerCase();
    if (arg === "off" || arg === "close") {
      for (const p of PANES)
        await $.ui.close({ id: p.id }).catch(() => undefined);
      return { text: "kodflow-hud: panes closed." };
    }
    const which =
      arg === "tasks" || arg === "tâches" || arg === "taches"
        ? PANES.filter((p) => p.id === TASKS_PANE)
        : arg === "agents"
          ? PANES.filter((p) => p.id === AGENTS_PANE)
          : PANES;
    kick($);
    const placed = await openPanes($, which);
    return {
      text: placed.length
        ? `kodflow-hud: ${placed.join(", ")} open.`
        : "kodflow-hud: no room to seat a pane here (a -p run or a host without panes).",
    };
  });

  // Observation only: the call runs first, its result goes back as it came
  on("tool.call", async ($, e, next) => {
    const r: any = await next(e);
    if (r?.deny === undefined) {
      await record($, e, r).catch(() => undefined);
      if (TASK_TOOL.test(String(e.tool))) kick($);
    }
    return r;
  }).catch(($, e, next) => next(e));

  on(
    "ui.render",
    { component: "Pane", requestId: TASKS_PANE },
    async ($, e) => {
      const els = $.ui.resolve(e);
      await read($, tickAtom);
      const [board, agents, activity, ciMap] = await Promise.all([
        read($, boardAtom),
        read($, agentsAtom),
        read($, activityAtom),
        read($, ciAtom),
      ]);
      return tasksView(
        els,
        {
          board,
          ctx: ctxOf(await $.clock.now(), agents, activity, settings.silentMs),
          ci: ciMap,
        },
        e.props.bodyColumns,
        e.props.scroll.bodyRows,
      );
    },
  );

  on(
    "ui.render",
    { component: "Pane", requestId: AGENTS_PANE },
    async ($, e) => {
      const els = $.ui.resolve(e);
      await read($, tickAtom);
      const [agents, activity] = await Promise.all([
        read($, agentsAtom),
        read($, activityAtom),
      ]);
      return agentsView(
        els,
        { agents, activity, now: await $.clock.now(), home },
        e.props.bodyColumns,
        e.props.scroll.bodyRows,
      );
    },
  );
};
