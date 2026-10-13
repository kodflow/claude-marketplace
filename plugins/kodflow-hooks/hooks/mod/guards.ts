// guards.ts — modwall, collision-guard and zsh-safe, over a port.
//
// The engine follows `$` and `on` only inside register.ts, so register.ts
// builds a GuardPort from `$` and hooks the events; what each hook does is
// here, and the decisions themselves in modwall.ts, collision.ts and zsh.ts.
//
// Every guard fails open, as every kodflow hook does: a judge that throws
// lets the module load, a collision check that throws lets the edit through,
// a zsh setup that throws leaves the shell as it was.
import { safe, sessionDir, beatFile } from "./paths.ts";
import { decision, remember, report, type Decision } from "./modwall.ts";
import {
  CANCEL,
  CONTINUE,
  WORKTREE,
  answer,
  editsFile,
  excluded,
  isLive,
  newest,
  question,
  record,
  targetOf,
} from "./collision.ts";
import { zdotdirOf, zdotdirPlan } from "./zsh.ts";

const STORE_KEY = "modwall";

export type GuardPort = {
  /** KODFLOW_MOD=off */
  off: () => Promise<boolean>;
  /** The absolute Claude configuration directory, when there is one. */
  config: () => Promise<string | undefined>;
  read: (path: string) => Promise<string | undefined>;
  write: (path: string, text: string) => Promise<void>;
  list: (path: string) => Promise<{ name: string; kind: string }[]>;
  session: () => Promise<string>;
  cwd: () => Promise<string>;
  ask: (question: string, options: string[]) => Promise<string>;
  storeGet: (key: string) => Promise<unknown>;
  storeSet: (key: string, value: unknown) => Promise<void>;
  log: (text: string) => void;
  toast: (text: string) => void;
  /** Declares /kodflow-mods. */
  registerMods: (description: string) => Promise<unknown>;
  zdotdir: () => Promise<string | undefined>;
  userZdotdir: () => Promise<string | undefined>;
  setZdotdir: (value: string) => Promise<void>;
  setUserZdotdir: (value: string) => Promise<void>;
  pluginRoot: string;
  now: () => number;
};

const sec = (p: GuardPort) => Math.floor(p.now() / 1000);

// The modules judged since this one loaded, for /kodflow-mods
const judged: Decision[] = [];

// Refusals made before the session bound (a toast then is dropped), shown
// at session.start
const unshown: string[] = [];

// A collision the user chose to go past: path -> the foreign edit's time.
// A newer edit by the other session asks again.
const acknowledged = new Map<string, number>();

// One write of edits.tsv at a time: the main loop and its subagents share
// this process and this session's file.
let writing: Promise<unknown> = Promise.resolve();

/**
 * modwall, on plugin.register: every module that joins after this one
 * passes here; only the user tier is judged, and only *@kodflow admitted.
 */
export async function admit(
  p: GuardPort,
  e: { name: string; tier: string; provenance: string },
): Promise<{ refuse: string } | undefined> {
  if (await p.off()) return undefined;
  const d = decision(e, sec(p));
  judged.push(d);
  try {
    if (d.reason) {
      p.log(d.reason);
      unshown.push(`modwall refused ${d.provenance}`);
    }
    await p.storeSet(STORE_KEY, remember(await p.storeGet(STORE_KEY), d));
  } catch {
    // the journal is best effort; the verdict stands
  }
  return d.reason ? { refuse: d.reason } : undefined;
}

/** What /kodflow-mods prints. */
export async function modsReport(p: GuardPort): Promise<string> {
  const history = await p.storeGet(STORE_KEY).catch(() => undefined);
  return report(judged, Array.isArray(history) ? history : []);
}

/** session.start's share: /kodflow-mods, and zsh-safe's ZDOTDIR. */
export async function startGuards(p: GuardPort): Promise<void> {
  if (await p.off()) return;
  for (const text of unshown.splice(0)) p.toast(text);
  await p
    .registerMods(
      "kodflow: the mods judged at load and the ones modwall refused",
    )
    .catch(() => undefined);
  try {
    const plan = zdotdirPlan(
      await p.zdotdir(),
      await p.userZdotdir(),
      zdotdirOf(p.pluginRoot),
    );
    if (plan) {
      await p.setUserZdotdir(plan.user);
      await p.setZdotdir(plan.zdotdir);
    }
  } catch {
    // the shell stays as the user has it
  }
}

async function others(
  p: GuardPort,
  cfg: string,
  self: string,
): Promise<{ session: string; text: string | undefined }[]> {
  const root = `${cfg}/kodflow/sessions`;
  const entries = await p.list(root).catch(() => []);
  const now = sec(p);
  const found = await Promise.all(
    entries
      .filter((d) => d.kind === "dir" && d.name !== self)
      .map(async (d) => {
        const dir = `${root}/${d.name}`;
        const text = await p.read(editsFile(dir));
        if (!text) return undefined;
        return isLive(await p.read(beatFile(dir)), now)
          ? { session: d.name, text }
          : undefined;
      }),
  );
  return found.filter((x) => x !== undefined);
}

async function noteEdit(p: GuardPort, dir: string, path: string) {
  const step = writing.then(async () => {
    const file = editsFile(dir);
    await p.write(file, record(await p.read(file), path, sec(p)));
  });
  writing = step.catch(() => undefined);
  await step;
}

/**
 * collision-guard, on tool.call of a writing tool: has another live session
 * of this machine written this file in the last 30 minutes? Ask; then, once
 * the write went through, note it in this session's edits.tsv.
 */
export async function guardWrite<R>(
  p: GuardPort,
  e: Record<string, unknown>,
  next: () => Promise<R>,
): Promise<R | { deny: string }> {
  if (await p.off()) return next();
  const path = targetOf(e.tool, e, await p.cwd());
  const cfg = await p.config();
  if (path === undefined || !cfg || excluded(path, cfg)) return next();
  const self = safe(await p.session());
  const now = sec(p);
  const hit = await others(p, cfg, self).then(
    (o) => newest(path, o, now),
    () => undefined,
  );
  if (hit && hit.at > (acknowledged.get(path) ?? 0)) {
    // No one to ask (-p), or the dialog dismissed: the edit goes on
    const chosen = await p
      .ask(question(path, hit, now), [CONTINUE, WORKTREE, CANCEL])
      .catch(() => undefined);
    p.log(
      `collision-guard: ${path} edited by session ${hit.session} at ${hit.at}; answer: ${chosen ?? "none, the edit goes on"}`,
    );
    if (chosen !== undefined) {
      const verdict = answer(chosen, path);
      if ("deny" in verdict) return verdict;
      acknowledged.set(path, hit.at);
    }
  }
  const r: any = await next();
  if (!r?.deny && !r?.isError)
    await noteEdit(p, sessionDir(cfg, self), path).catch(() => undefined);
  return r;
}

/**
 * session.end: this session's edits stop counting at once, rather than when
 * its beat ages out of the window.
 */
export async function endGuards(p: GuardPort): Promise<void> {
  const cfg = await p.config();
  if (!cfg) return;
  const file = editsFile(sessionDir(cfg, safe(await p.session())));
  if ((await p.read(file)) !== undefined) await p.write(file, "");
}
