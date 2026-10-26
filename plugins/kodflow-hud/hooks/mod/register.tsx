// register.tsx — kodflow-hud's function hooks: wiring only.
//
// One pane and a few toasts, beside the status line and never in its place
// (the context segment, the epics' pills and the rest stay there):
//   « Tâches »  the open epics of tasks.json as a tree (subtasks, what each
//               task waits on, the critical path) or as a graph by state,
//               who works each task, on what model, how long since it moved,
//               the silent ones and the ones waiting on the person; the
//               only pane, its tab counting the tasks left.
//               Two more views in its bar: « Refus », what kodflow-hooks
//               refused (blocks.jsonl), and « Documents », the project's
//               documents (docs.json), panels.ts; a third, « Chasse », while
//               /hunt lists a run (active.json, each status.json), hunt.ts.
// The subagents themselves are the engine's to show, under the prompt.
// And a few words of each reply in colour (colors.ts): the transcript draws
// `{{r:words}}` red, `{{o:…}}` orange, `{{v:…}}` green, `{{p:…}}` pink.
//
// Everything is read, nothing is decided: tasks.json is kodflow-hooks' file,
// re-read whenever its modification time moves; the agents come from
// `$.agent.list()`; each loop's last call from `tool.call`, observed after
// `next` and handed back untouched. No tool, no context line, no refusal: this mod
// can stop nothing, and adds one thing only to what the model reads, the
// colour convention's system prompt section (off with KODFLOW_COLORS=off,
// which also turns off the drawing). Every hook fails open.
//
// Three writes, each only on the person's own click or key in the pane
// (`ui.message`, posted by the surface module and checked again here), never
// on the model's word nor a hook's: a document ignored or brought back in
// the project's docs/manifest.json; a permission rule, shown first and then
// confirmed, added to the project's .claude/settings.local.json; the docs
// prompt, or `/hunt --resume <slug>`, drafted in an EMPTY prompt box, never
// sent.
//
// /hunt's files are read on their own, after everything else of a poll and
// inside their own try/catch: a hunt that cannot be read says « état
// illisible » in its view, and the « Tâches » pane goes on as before.
//
// The logic lives in the pure modules beside this file (board.ts, tree.ts,
// layout.tsx, models.ts, alerts.ts, ci.ts); the
// « Tâches » pane's selection and folding live in its surface module,
// client.tsx; what is here reads `$`.

import { atom, read, update } from "claude-code";
import type { Register } from "claude-code";
import type {
  HudActivity,
  HudAgent,
  HudBlock,
  HudBoard,
  HudDoc,
  HudDocs,
  HudCi,
  HudHunt,
  HudHuntCursor,
  HudModel,
  HudSeen,
  HudTask,
} from "../../types";
import { MAIN, parseBoard, parseTasks, type Ctx } from "./board.ts";
import { alertsFor, trimKeys } from "./alerts.ts";
import { CI_EVERY_MS, ciState, prsToCheck } from "./ci.ts";
import { configDir, sessionDir, tasksFile } from "./paths.ts";
import { buildTree } from "./tree.ts";
import { draw, initialUi } from "./layout.tsx";
import { SETTINGS_LOCAL, viewScreen, type Extra } from "./panels.ts";
import {
  MODES,
  NO_DOCS,
  createPrompt,
  manifestPath,
  parseDocs,
  toggleManifest,
  type DocMode,
} from "./docs.ts";
import { addRule, parseBlocks, safeRule } from "./refusals.ts";
import {
  NO_HUNT,
  UNREADABLE,
  activeFile,
  canResume,
  huntOff,
  huntRoot,
  huntToasts,
  readHunt,
  resumePrompt,
  slugsOf,
  statusFile,
} from "./hunt.ts";
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
const docsAtom = atom(
  { plugin: "kodflow-hud", key: "docs" } as const,
  NO_DOCS as HudDocs,
);
const blocksAtom = atom(
  { plugin: "kodflow-hud", key: "blocks" } as const,
  [] as HudBlock[],
);
const huntAtom = atom(
  { plugin: "kodflow-hud", key: "hunt" } as const,
  NO_HUNT as HudHunt,
);
const huntCursorAtom = atom(
  { plugin: "kodflow-hud", key: "huntCursor" } as const,
  {} as HudHuntCursor,
);
const primedAtom = atom({ plugin: "kodflow-hud", key: "primed" } as const, "");
const tickAtom = atom({ plugin: "kodflow-hud", key: "tick" } as const, 0);

export const TASKS_PANE = "hud-tasks";
/**
 * The pane an older version opened beside « Tâches »: the engine's own
 * list of subagents under the prompt says the same. Closed once when a
 * session starts, which leaves « Tâches » the tab shown.
 */
export const AGENTS_PANE = "hud-agents";

/**
 * « Tâches (2) »: a name and its count, always of one width up to 99 (a
 * figure space after a single digit, the count even at 0). A tab that grew
 * or shrank with its count would move the tab beside it from under the
 * pointer.
 */
export const tabTitle = (name: string, n: number): string =>
  `${name} (${n})${"\u2007".repeat(Math.max(0, 2 - String(n).length))}`;

/** « Tâches (2) »: the tasks left to do across the open epics. */
export const tasksTitle = (board: HudBoard): string =>
  tabTitle(
    "Tâches",
    board.epics.flatMap((e) => e.tasks).filter((t) => t.status !== "completed")
      .length,
  );

/** How often tasks.json's time and the agents are looked at. */
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
// docs.json and blocks.jsonl: re-read when their time or their size moves
const seenStat: Record<string, string | undefined> = {};
let home: string | undefined;
// /hunt's files as the last poll read them, side by side: a poll that reads
// the same text changes nothing (two whole rewrites in one tick can keep the
// time and the size, never the text)
let huntText = "";
let huntEnvOff = false;

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

/**
 * A file of the session's folder, when its time or its size moved: its text,
 * or null. The size too: a rewrite within the same millisecond keeps the time.
 */
async function changed(
  $: any,
  path: string,
): Promise<string | undefined | null> {
  const stat = await $.fs.stat(path).then(
    (s: { mtimeMs: number; size: number }) => `${s.mtimeMs}:${s.size}`,
    () => undefined,
  );
  if (path in seenStat && seenStat[path] === stat) return null;
  const text =
    stat === undefined ? undefined : await $.fs.read(path).catch(() => null);
  if (text === null) return null;
  seenStat[path] = stat;
  return text;
}

/**
 * /hunt's active.json, then the status.json of each hunt it lists: paths
 * from HOME and the slug made safe, the text compared with the last poll's.
 * Then the toasts past each hunt's cursor. Never the journal, never a scan.
 */
async function pollHunt($: any): Promise<void> {
  const root = settings.hunt && !huntEnvOff ? huntRoot(home) : undefined;
  let hunt: HudHunt = NO_HUNT;
  if (root) {
    const text = (path: string): Promise<string | undefined> =>
      $.fs.read(path).catch(() => undefined);
    const active = await text(activeFile(root));
    const status: Record<string, string | undefined> = {};
    for (const slug of slugsOf(active))
      status[slug] = await text(statusFile(root, slug));
    const now = JSON.stringify([active, status]);
    if (now === huntText) return;
    huntText = now;
    hunt = readHunt(active, (slug) => status[slug]);
  } else huntText = "";
  if (!same(await read($, huntAtom), hunt))
    await update($, huntAtom, () => hunt);
  const before = await read($, huntCursorAtom);
  const { toasts, cursor } = huntToasts(hunt, before);
  if (!same(before, cursor)) await update($, huntCursorAtom, () => cursor);
  for (const t of toasts) $.ui.toast(t);
}

/** A poll of /hunt's files that threw: the view says so, the rest is kept. */
async function huntFailed($: any): Promise<void> {
  huntText = "";
  const hunt: HudHunt = { found: true, problem: UNREADABLE, runs: [] };
  if (!same(await read($, huntAtom), hunt))
    await update($, huntAtom, () => hunt);
}

/** docs.json and blocks.jsonl, beside tasks.json, kodflow-hooks' too. */
async function pollSide($: any, tasks: string): Promise<void> {
  const dir = tasks.replace(/\/tasks\.json$/, "");
  const docs = await changed($, `${dir}/docs.json`);
  if (docs !== null) {
    const parsed = parseDocs(docs);
    if (!same(await read($, docsAtom), parsed))
      await update($, docsAtom, () => parsed);
  }
  const blocks = await changed($, `${dir}/blocks.jsonl`);
  if (blocks !== null) {
    const parsed = parseBlocks(blocks);
    if (!same(await read($, blocksAtom), parsed))
      await update($, blocksAtom, () => parsed);
  }
}

/**
 * Writes `text` to `path` whole or not at all: a file beside it, then `mv`
 * over it (a rename, atomic on one file system).
 */
async function writeWhole($: any, path: string, text: string): Promise<void> {
  const tmp = `${path}.kodflow-hud.tmp`;
  await $.fs.write(tmp, text);
  const r = await $.process.run(["mv", "-f", tmp, path], { timeoutMs: 5_000 });
  if (r.exitCode !== 0) throw new Error(r.stderr || `mv: ${r.exitCode}`);
}

/** Whether a document's path is there: a folder needs one .md in it. */
async function present($: any, root: string, path: string): Promise<boolean> {
  const abs = `${root.replace(/\/+$/, "")}/${path}`;
  if (!path.endsWith("/")) return $.fs.exists(abs).catch(() => false);
  const list: any[] = await $.fs.list(abs).catch(() => []);
  return list.some((f) => f.kind === "file" && /\.md$/i.test(f.name));
}

/** A document ignored or brought back, in the project's manifest. */
async function setIgnored($: any, id: string, ignore: boolean): Promise<void> {
  const docs = await read($, docsAtom);
  const doc = docs.docs.find((d) => d.id === id);
  const path = manifestPath(docs);
  if (!doc || !path) {
    $.ui.toast("kodflow-hud : pas de manifeste à réécrire pour ce document.");
    return;
  }
  const before: string | undefined = await $.fs
    .read(path)
    .catch(() => undefined);
  const after = toggleManifest(before, id, ignore);
  if (after === undefined) {
    $.ui.toast(
      `kodflow-hud : ${docs.manifest ?? "docs/manifest.json"} n'est pas un objet JSON, laissé tel quel.`,
    );
    return;
  }
  await writeWhole($, path, after);
  // kodflow-hooks recomputes docs.json on its own clock: the line changes now
  const state: HudDoc["state"] = ignore
    ? "ignored"
    : (await present($, docs.root!, doc.path))
      ? "ok"
      : "missing";
  await update($, docsAtom, (d) => ({
    ...d,
    docs: d.docs.map((x): HudDoc => {
      if (x.id !== id) return x;
      const { reason: _r, ...rest } = x;
      return ignore ? { ...rest, state, reason: "" } : { ...rest, state };
    }),
  }));
}

/** A prompt in the prompt box, as a draft: only where the box is empty. */
async function draft($: any, text: string): Promise<void> {
  const box = await $.prompt.read().catch(() => ({ text: "" }));
  if (box.text.trim()) {
    $.ui.toast(
      "kodflow-hud : la zone de saisie a déjà un brouillon, vide-la puis reclique.",
    );
    return;
  }
  const r = await $.prompt.fill({ text });
  $.ui.toast(
    r.isFilled
      ? "kodflow-hud : brouillon prêt dans la zone de saisie (Échap, relis, puis ⏎)."
      : "kodflow-hud : la zone de saisie n'a pas pris le brouillon.",
  );
}

/**
 * A rule the person confirmed, in the project's .claude/settings.local.json:
 * only one a refusal of this session carries, and only one `safeRule` lets
 * through.
 */
async function allowRule($: any, rule: string): Promise<void> {
  const blocks = await read($, blocksAtom);
  if (!safeRule(rule) || !blocks.some((b) => b.rule === rule)) {
    $.ui.toast(
      "kodflow-hud : règle refusée (trop large, ou d'aucun refus de la session).",
    );
    return;
  }
  const root = await $.session.root();
  const path = `${String(root).replace(/\/+$/, "")}/${SETTINGS_LOCAL}`;
  const before: string | undefined = await $.fs
    .read(path)
    .catch(() => undefined);
  const after = addRule(before, rule);
  if (after === undefined) {
    $.ui.toast(
      `kodflow-hud : ${SETTINGS_LOCAL} n'est pas un objet JSON, laissé tel quel.`,
    );
    return;
  }
  if (after !== before) await writeWhole($, path, after);
  $.ui.toast(`kodflow-hud : ${rule} autorisé dans ${SETTINGS_LOCAL}.`);
}

/** What the pane's surface module posted, checked as input from code. */
async function onMessage($: any, data: unknown): Promise<void> {
  const d = data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return;
  const ids = (await read($, docsAtom)).docs.map((x) => x.id);
  if (d.op === "ignore" && typeof d.id === "string" && ids.includes(d.id))
    return setIgnored($, d.id, d.ignore === true);
  if (d.op === "create" && Array.isArray(d.ids)) {
    const mode = (MODES as readonly unknown[]).includes(d.mode)
      ? (d.mode as DocMode)
      : "both";
    const missing = new Set(
      (await read($, docsAtom)).docs
        .filter((x) => x.state === "missing")
        .map((x) => x.id),
    );
    const asked = d.ids.filter(
      (x): x is string => typeof x === "string" && missing.has(x),
    );
    if (asked.length !== d.ids.length || (!asked.length && !missing.size))
      return;
    return draft($, createPrompt(asked, mode));
  }
  // « reprendre »: a hunt listed now, probably orphaned, its slug /hunt's shape
  if (d.op === "resume") {
    if (!canResume(await read($, huntAtom), d.slug, await $.clock.now()))
      return;
    return draft($, resumePrompt(d.slug as string));
  }
  if (d.op === "allow" && typeof d.rule === "string")
    return allowRule($, d.rule);
  if (d.op === "copy" && typeof d.rule === "string") {
    const r = await $.ui.copy({ text: d.rule });
    $.ui.toast(
      r.isCopied
        ? `kodflow-hud : ${d.rule} copié (/permissions, Ajouter une règle).`
        : `kodflow-hud : copie impossible, la règle est ${d.rule}.`,
    );
  }
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
      await pollSide($, path);
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
    // Last, and on its own: whatever /hunt's files hold, the rest is done
    try {
      await pollHunt($);
    } catch {
      await huntFailed($).catch(() => undefined);
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

/** A finished tool call: its loop is alive now, whatever the call did. */
async function record($: any, e: any): Promise<void> {
  const loop: string = e.agentId ?? MAIN;
  const now = await $.clock.now();
  await update($, activityAtom, (m) => ({
    ...m,
    [loop]: { agentId: loop, last: now },
  }));
}

/** « Tâches » retitled when its count moved: a retitle never moves a tab. */
async function syncPanes($: any): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const panes: any[] = await $.ui.panes().catch(() => []);
    if (!Array.isArray(panes)) return;
    const title = tasksTitle(await read($, boardAtom));
    const tasks = panes.find((p) => p.id === TASKS_PANE);
    if (tasks && tasks.title !== title)
      await $.ui.open({ id: TASKS_PANE, title });
  } finally {
    syncing = false;
  }
}

/**
 * Open « Tâches », or show it when it is up: `focus` is the engine's only
 * way to show a pane already open, granted while no pane holds the
 * keyboard (as after a command), and it hands the pane the keyboard.
 */
async function openTasks($: any): Promise<boolean> {
  const r = await $.ui.open({
    id: TASKS_PANE,
    title: tasksTitle(await read($, boardAtom)),
    focus: true,
  });
  return r.isPlaced;
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
const settings = { silentMs: 10 * 60_000, ci: true, hunt: true };

/** Poll now, in the background; a failure waits for the next period. */
function kick($: any): void {
  void poll($, settings.silentMs, settings.ci).catch(() => undefined);
}

export const register: Register = (on, options) => {
  settings.silentMs = Math.max(1, Number(options.silentMinutes ?? 10)) * 60_000;
  settings.ci = options.ci !== false;
  settings.hunt = options.hunt !== false;
  const autoOpen = options.autoOpen !== false;

  on("session.start", async ($, e, next) => {
    home = await $.env.get("HOME");
    huntEnvOff = huntOff(await $.env.get("KODFLOW_HUD_HUNT"));
    huntText = "";
    await $.command.register({
      name: "hud",
      description: "kodflow-hud: open the Tasks pane (/hud off closes it)",
    });
    // Unasked, the engine seats a pane only where it has room (144 columns);
    // below that it waits, and /hud seats it at any width. « Tâches » is the
    // only pane, so the first tab and the one shown. An Agents tab an older
    // version left up is closed: a close shows the pane left, never a new one
    const up: any[] = await $.ui.panes().catch(() => []);
    const has = (id: string) =>
      Array.isArray(up) && up.some((p) => p.id === id);
    if (has(AGENTS_PANE))
      await $.ui.close({ id: AGENTS_PANE }).catch(() => undefined);
    if (autoOpen || has(TASKS_PANE))
      await $.ui
        .open({ id: TASKS_PANE, title: tasksTitle(await read($, boardAtom)) })
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
    if (arg === "agents") {
      $.ui.toast(
        "kodflow-hud : l'onglet Agents est retiré, les sous-agents sont sous le prompt.",
      );
      return {
        text: "kodflow-hud: the Agents tab is gone; Claude Code lists the subagents under the prompt.",
      };
    }
    kick($);
    return {
      text: (await openTasks($))
        ? `kodflow-hud: ${tasksTitle(await read($, boardAtom)).trim()} open.`
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
      const extra: Extra = {
        docs: await read($, docsAtom),
        blocks: await read($, blocksAtom),
        now: await $.clock.now(),
        hunt: await read($, huntAtom),
      };
      // Where the surface runs modules (terminal, desktop) the tree takes
      // keys and clicks; elsewhere it is drawn still, at its first state
      // (the table may name Client where the surface then drops it)
      const { Client } = els;
      if (Client && (e.surface === "terminal" || e.surface === "desktop"))
        return (
          <Client
            key="tree"
            module="./client.tsx"
            props={{ model, width, rows, extra }}
            width={width}
            height={rows}
          />
        );
      return draw(
        els,
        viewScreen(model, initialUi(model), width, rows, extra),
        width,
      );
    },
  );

  // A click or a key in the pane: the only road to the writes and drafts
  on("ui.message", async ($, e, next) => {
    if (e.requestId === TASKS_PANE && e.module.endsWith("client.tsx"))
      await onMessage($, e.data).catch(() =>
        $.ui.toast("kodflow-hud : l'écriture a échoué, rien n'a changé."),
      );
    return next(e);
  }).catch(($, e, next) => next(e));

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
