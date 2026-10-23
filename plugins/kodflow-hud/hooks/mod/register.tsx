// register.tsx — kodflow-hud's function hooks: wiring only.
//
// One pane and a few toasts, beside the status line and never in its place
// (the context segment, the epics' pills and the rest stay there): « Tâches »,
// the open epics of tasks.json as a tree (subtasks, what each task waits on,
// the critical path) or as a graph by state, who works each task, on what
// model, how long since it moved, the silent ones and the ones waiting on the
// person, its title counting the tasks left. No pane for the subagents: the
// engine lists them under the prompt already.
// And a few words of each reply in colour (colors.ts): the transcript draws
// `{{r:words}}` red, `{{o:…}}` orange, `{{v:…}}` green, `{{p:…}}` pink.
//
// Everything is read, nothing is decided: tasks.json is kodflow-hooks' file,
// re-read whenever its modification time moves; the agents come from
// `$.agent.list()`; when each loop last called a tool from `tool.call`,
// observed after `next` and handed back untouched. No tool, no context line, no refusal: this mod
// can stop nothing, and adds one thing only to what the model reads, the
// colour convention's system prompt section (off with KODFLOW_COLORS=off,
// which also turns off the drawing). Every hook fails open.
//
// The logic lives in the pure modules beside this file (board.ts, tree.ts,
// layout.tsx, models.ts, alerts.ts, ci.ts); the « Tâches » pane's
// selection and folding live in its surface module, client.tsx; what is
// here reads `$`.

import { atom, read, update } from "claude-code";
import type { Register } from "claude-code";
import type {
  HudActivity,
  HudAgent,
  HudBoard,
  HudCi,
  HudModel,
  HudSeen,
  HudTask,
} from "../../types";
import { MAIN, parseBoard, parseTasks, type Ctx } from "./board.ts";
import { alertsFor, trimKeys } from "./alerts.ts";
import { CI_EVERY_MS, ciState, prsToCheck } from "./ci.ts";
import { configDir, sessionDir, tasksFile } from "./paths.ts";
import { buildTree } from "./tree.ts";
import { draw, initialUi, screenOf } from "./layout.tsx";
import {
  PROMPT_SECTION,
  SECTION_ID,
  blocks,
  colorsOff,
  drawn,
  marked,
} from "./colors.ts";
import {
  fromAgentCall,
  keepSession,
  merge,
  modelKey,
  parseModels,
  seenFrom,
} from "./models.ts";

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
const modelsAtom = atom(
  { plugin: "kodflow-hud", key: "models" } as const,
  {} as Record<string, HudModel>,
);
const seenAtom = atom(
  { plugin: "kodflow-hud", key: "seen" } as const,
  {} as Record<string, HudSeen>,
);
const primedAtom = atom({ plugin: "kodflow-hud", key: "primed" } as const, "");
const tickAtom = atom({ plugin: "kodflow-hud", key: "tick" } as const, 0);

export const TASKS_PANE = "hud-tasks";
/** The Agents tab of earlier versions: closed where a reload finds it open. */
export const OLD_AGENTS_PANE = "hud-agents";

/** « Tâches (2) »: the tasks left to do across the open epics. */
export const tasksTitle = (board: HudBoard): string => {
  const n = board.epics
    .flatMap((e) => e.tasks)
    .filter((t) => t.status !== "completed").length;
  return n ? `Tâches (${n})` : "Tâches";
};

/** How often tasks.json's time, the agents and the TTLs are looked at. */
export const POLL_MS = 3_000;
/** The elapsed times redraw on this step, not on every poll. */
const TICK_MS = 10_000;
const TASK_TOOL = /^mcp__kodflow-hooks__task_(create|update|epic|focus)$/;

// What the module keeps between polls. A reload starts these over, which
// costs one re-read of tasks.json; everything drawn is in `$.state`.
let polling = false;
let checking = false;
let syncing = false;
let lastSession = "";
let lastMtime: number | undefined = -1;
let modelsMtime: number | undefined = -1;
let modelsPath = "";
let allTasks: HudTask[] = [];
// tasks.json as last read: the board is judged again on every poll, since an
// epic done 30 minutes ago leaves it without the file changing
let lastText: string | undefined;
let lastCi = 0;
let home: string | undefined;

// Atoms are written only when their value changed: every write redraws
const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

async function tasksPath($: any, session: string): Promise<string | undefined> {
  const cfg = configDir(await $.env.get("CLAUDE_CONFIG_DIR"), home);
  return cfg ? tasksFile(sessionDir(cfg, session)) : undefined;
}

/** Fold what a source says of some loops into the models kept. */
async function noteModels(
  $: any,
  said: Record<string, HudModel>,
): Promise<void> {
  const session = await $.session.id();
  const fold = (before: Record<string, HudModel>) => {
    const after = keepSession(before, session);
    for (const [id, m] of Object.entries(said)) {
      const key = modelKey(session, id);
      after[key] = merge(after[key], m);
    }
    return after;
  };
  // Folded inside the update, on the latest record: two Agent results
  // arriving together each keep the other's entry
  const now = await read($, modelsAtom);
  if (!same(now, fold(now))) await update($, modelsAtom, fold);
}

/**
 * kodflow-hooks' agent-models.tsv, when its time moved, and the main loop's
 * model: what the tree's model column reads beside the calls seen live.
 */
async function pollModels($: any, tasks: string): Promise<void> {
  const path = tasks.replace(/tasks\.json$/, "agent-models.tsv");
  const mtime = await $.fs.stat(path).then(
    (s: { mtimeMs: number }) => s.mtimeMs,
    () => undefined,
  );
  const said: Record<string, HudModel> = {};
  // Another session's file is read afresh whatever its time says; a read
  // that failed is not remembered as done, so the next poll tries again
  if (mtime !== undefined && (path !== modelsPath || mtime !== modelsMtime)) {
    const text: string | undefined = await $.fs
      .read(path)
      .catch(() => undefined);
    if (text !== undefined) {
      Object.assign(said, parseModels(text));
      modelsMtime = mtime;
      modelsPath = path;
    }
  } else if (mtime === undefined) {
    modelsMtime = undefined;
    modelsPath = path;
  }
  const main = await $.session.model().catch(() => undefined);
  if (typeof main === "string" && main) said[MAIN] = { model: main };
  if (Object.keys(said).length) await noteModels($, said);
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
        lastText = text;
        const seen = seenFrom(allTasks, await read($, seenAtom), session);
        if (seen) await update($, seenAtom, () => seen);
        lastSession = session;
        lastMtime = mtime;
      }
      const board = parseBoard(lastText, now);
      if (!same(await read($, boardAtom), board))
        await update($, boardAtom, () => board);
      await pollModels($, path);
    }
    const listed = await $.agent.list().catch(() => []);
    const agents: HudAgent[] = listed.map((a: any) => ({
      id: a.id,
      // Its name, else the few words of its task: its type is its role,
      // shown beside the name, so it does not stand in for one
      label: a.name || a.description || a.type || a.id.slice(0, 8),
      status: a.status,
      ...(a.name && { name: String(a.name) }),
      ...(a.type && { type: String(a.type) }),
    }));
    if (!same(await read($, agentsAtom), agents))
      await update($, agentsAtom, () => agents);
    await syncPanes($).catch(() => undefined);

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
    if ((await read($, tickAtom)) !== tick)
      await update($, tickAtom, () => tick);
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

/** One finished tool call: its loop is alive now. */
async function record($: any, e: any): Promise<void> {
  const loop: string = e.agentId ?? MAIN;
  const now = await $.clock.now();
  await update($, activityAtom, (m) => ({
    ...m,
    [loop]: { agentId: loop, last: now },
  }));
}

/**
 * The pane as the count wants it, every poll: « Tâches » carries the tasks
 * left, retitled only when the count moved. The Agents tab an earlier
 * version opened is closed. A retitle may raise the pane: the pane shown
 * before is shown again after.
 */
async function syncPanes($: any): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const panes: any[] = await $.ui.panes().catch(() => []);
    if (!Array.isArray(panes)) return;
    const find = (id: string) => panes.find((p) => p.id === id);
    const shown = panes.find((p) => p.isShown);
    const tTitle = tasksTitle(await read($, boardAtom));
    if (find(OLD_AGENTS_PANE)) await $.ui.close({ id: OLD_AGENTS_PANE });
    const tasks = find(TASKS_PANE);
    if (!tasks || tasks.title === tTitle) return;
    await $.ui.open({ id: TASKS_PANE, title: tTitle });
    if (!shown || shown.id === TASKS_PANE || shown.id === OLD_AGENTS_PANE)
      return;
    const after: any[] = await $.ui.panes().catch(() => []);
    const front = after.find((p) => p.isShown);
    const back = after.find((p) => p.id === shown.id);
    if (back && front?.id !== shown.id)
      await $.ui.open({ id: back.id, title: back.title });
  } finally {
    syncing = false;
  }
}

async function openTasks($: any): Promise<boolean> {
  const title = tasksTitle(await read($, boardAtom));
  const r = await $.ui.open({ id: TASKS_PANE, title });
  return !!r?.isPlaced;
}

/** Write what the pane would draw to KODFLOW_HUD_TRACE, when it is set. */
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
  settings.silentMs = Math.max(1, Number(options.silentMinutes ?? 10)) * 60_000;
  settings.ci = options.ci !== false;
  const autoOpen = options.autoOpen !== false;

  on("session.start", async ($, e, next) => {
    home = await $.env.get("HOME");
    await $.command.register({
      name: "hud",
      description:
        "kodflow-hud: open the Tasks pane (/hud off closes it)",
    });
    // Unasked, the engine seats a pane only where it has room (144 columns);
    // below that it waits, and /hud seats it at any width
    if (autoOpen)
      await $.ui
        .open({ id: TASKS_PANE, title: "Tâches" })
        .catch(() => undefined);
    $.clock.every(POLL_MS, () => kick($));
    kick($);
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
      await $.ui.close({ id: TASKS_PANE }).catch(() => undefined);
      return { text: "kodflow-hud: pane closed." };
    }
    kick($);
    return {
      text: (await openTasks($))
        ? `kodflow-hud: ${tasksTitle(await read($, boardAtom))} open.`
        : "kodflow-hud: no room to seat a pane here (a -p run or a host without panes).",
    };
  });

  // Observation only: the call runs first, its result goes back as it came
  on("tool.call", async ($, e, next) => {
    const r: any = await next(e);
    if (r?.deny === undefined) {
      await record($, e).catch(() => undefined);
      if (TASK_TOOL.test(String(e.tool))) kick($);
      if (e.tool === "Agent" && !r?.isError) {
        const said = fromAgentCall(e as { effort?: unknown }, r?.result);
        if (said)
          await noteModels($, { [said.id]: said.model }).catch(() => undefined);
      }
    }
    return r;
  }).catch(($, e, next) => next(e));

  // The model core resolved for a subagent it started, whoever asked
  on("agent.spawn", async ($, e, next) => {
    const r: any = await next(e);
    if (r?.deny === undefined && typeof r?.agentId === "string" && r.model)
      await noteModels($, { [r.agentId]: { model: String(r.model) } }).catch(
        () => undefined,
      );
    return r;
  }).catch(($, e, next) => next(e));

  on(
    "ui.render",
    { component: "Pane", requestId: TASKS_PANE },
    async ($, e) => {
      const els: any = $.ui.resolve(e);
      await read($, tickAtom);
      const [board, agents, activity, ciMap, models, seen] = await Promise.all([
        read($, boardAtom),
        read($, agentsAtom),
        read($, activityAtom),
        read($, ciAtom),
        read($, modelsAtom),
        read($, seenAtom),
      ]);
      const model = buildTree({
        board,
        ctx: ctxOf(await $.clock.now(), agents, activity, settings.silentMs),
        ci: ciMap,
        models,
        seen,
        session: await $.session.id(),
      });
      const width = e.props.bodyColumns;
      const rows = e.props.scroll.bodyRows;
      // Where the surface runs modules (terminal, desktop) the tree takes
      // keys and clicks; elsewhere it is drawn still, at its first state
      // (the table may name Client where the surface then drops it)
      const { Client } = els;
      if (Client && (e.surface === "terminal" || e.surface === "desktop"))
        return (
          <Client
            key="tree"
            module="./client.tsx"
            props={{ model, width, rows }}
            width={width}
            height={rows}
          />
        );
      return draw(els, screenOf(model, initialUi(model), width, rows), width);
    },
  );

  // The colour convention, on the session's side of the cache boundary: a
  // section composed afresh for every prompt, so a compaction keeps it. Only
  // where a transcript will draw the reply (no -p run, no --bare)
  on("prompt.compose", async ($, e, next) => {
    const r = await next(e);
    if (colorsOff(await $.env.get("KODFLOW_COLORS")) || !drawn(e)) return r;
    const sections = r.sections.filter((s) => s.id !== SECTION_ID);
    return {
      ...r,
      sections: [
        ...sections,
        { id: SECTION_ID, text: PROMPT_SECTION, scope: "session" as const },
      ],
    };
  }).catch(($, e, next) => next(e));

  // A reply with a mark is redrawn paragraph by paragraph: a marked one as
  // coloured runs, any other as the engine's markdown. No mark: the engine's
  // own drawing. Any failure draws the engine's
  on("ui.render", { component: "AssistantMessage" }, async ($, e, next) => {
    if (colorsOff(await $.env.get("KODFLOW_COLORS"))) return next(e);
    const parts = blocks(e.props.text);
    if (!marked(parts)) return next(e);
    const { Box, Text, Markdown }: any = $.ui.resolve(e);
    return (
      <Box flexDirection="column" gap={1}>
        {parts.map((p, i) =>
          "runs" in p ? (
            <Text key={`t${i}`}>
              {p.runs.map((r, j) => (
                <Text key={`r${i}-${j}`} color={r.color} bold={r.bold}>
                  {r.text}
                </Text>
              ))}
            </Text>
          ) : (
            <Markdown key={`m${i}`} text={p.markdown} />
          ),
        )}
      </Box>
    );
  }).catch(($, e, next) => next(e));
};
