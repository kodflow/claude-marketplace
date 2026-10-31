// cleanup.ts — whose worktree goes when a task or an epic is completed. No `$`:
// the host is reached through store.ts's Port.
//
// A subagent works in its own worktree, <repo parent>/.worktrees/<repo>-<slug>
// (the rule on-agent.sh gives it, the path the delegation gate points to).
// Nothing in Claude Code says which directory a subagent worked in, so the
// mod notes it: every Bash, Edit, Write, MultiEdit or NotebookEdit call a
// subagent makes is read for absolute .worktrees/<name> paths, kept in
// <session>/worktrees.json under that subagent's id.
//
// When the main agent completes a task that was linked to a worker
// (task_update worker=...), that worker's worktrees are candidates; when the
// completion closes the task's epic, so are those of every worker of the
// epic and every subagent started on it (agents.json's `epic`). The
// candidates go to hooks/scripts/cleanup.sh, which removes nothing unless
// the PR is merged at the very commit the branch holds, the worktree is
// clean, and it is neither the main worktree nor the default branch.
import { lock, unique, unlock, type Port } from "./store.ts";
import { MAIN, type Data } from "./tasks.ts";

export const worktreesFile = (dir: string): string => `${dir}/worktrees.json`;
export const noticesFile = (dir: string): string => `${dir}/cleanup-notices`;

/** The tools whose arguments say where a subagent writes. */
export const WRITING_TOOLS: ReadonlySet<string> = new Set([
  "Bash",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

// An absolute path, or one from ~ or $HOME, at a word boundary, down to the
// first component under .worktrees/. A relative path is not read: it says
// nothing without the directory it was relative to.
const SEG = "[^\\s'\"`;|&()<>\\\\/]";
const PATH = new RegExp(
  `(?<=^|[\\s'"=(:;&|])(~|\\$\\{HOME\\}|\\$HOME)?((?:/${SEG}+)*)/\\.worktrees/(${SEG}+)`,
  "g",
);

/** The worktree roots a command or an argument names, each once. */
export function worktreePaths(
  text: string,
  home: string | undefined,
): string[] {
  if (!text.includes(".worktrees/")) return [];
  const out: string[] = [];
  for (const m of text.matchAll(PATH)) {
    const [, from, parent, name] = m;
    if (name === "." || name === "..") continue;
    if (parent!.split("/").some((s) => s === "." || s === "..")) continue;
    let base = parent!;
    if (from) {
      if (!home || !home.startsWith("/")) continue;
      base = home.replace(/\/+$/, "") + parent;
    }
    const p = `${base}/.worktrees/${name}`;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** What one completion closes: the workers to clean after, and the epic. */
export type Closing = { workers: string[]; epic: number; epicClosed: boolean };

type Obj = Record<string, any>;
const ofMain = (t: Obj): boolean => (t.agent ?? MAIN) === MAIN;
const epicOf = (t: Obj): number => Number(t.epic ?? 0) || 0;

/**
 * Compare the list before and after a main-agent task_update. Undefined
 * unless the update moved the task to completed. The worker link is read
 * from `before`: the update drops it.
 */
export function closingOf(
  before: Data,
  after: Data,
  taskArg: unknown,
): Closing | undefined {
  const id = String(taskArg ?? "")
    .trim()
    .replace(/^#+/, "");
  const find = (d: Data) => d.tasks.find((t) => t.id === id && ofMain(t));
  const was = find(before);
  const now = find(after);
  if (!was || !now || was.status === "completed" || now.status !== "completed")
    return undefined;
  const epic = epicOf(now);
  const inEpic = (d: Data) =>
    d.tasks.filter((t) => ofMain(t) && epicOf(t) === epic);
  const epicClosed =
    epic > 0 && inEpic(after).every((t) => t.status === "completed");
  const workers: string[] = [];
  const add = (w: unknown) => {
    if (typeof w === "string" && w && !workers.includes(w)) workers.push(w);
  };
  add(was.worker_id);
  if (epicClosed) for (const t of inEpic(before)) add(t.worker_id);
  return { workers, epic, epicClosed };
}

type Registry = { agents: Record<string, { paths: string[]; epic?: number }> };

function parseRegistry(text: string | undefined): Registry {
  try {
    const raw = JSON.parse(text ?? "");
    const agents = raw && typeof raw.agents === "object" ? raw.agents : {};
    const out: Registry = { agents: {} };
    for (const [id, e] of Object.entries<any>(agents)) {
      if (!e || !Array.isArray(e.paths)) continue;
      out.agents[id] = {
        paths: e.paths.filter((p: unknown) => typeof p === "string"),
      };
      if (typeof e.epic === "number") out.agents[id]!.epic = e.epic;
    }
    return out;
  } catch {
    return { agents: {} };
  }
}

// Read, change, replace through a temporary file and `mv`, under the lock;
// `change` answers whether anything changed. A lock not obtained in time is
// written through, as store.ts does.
async function withRegistry<T>(
  port: Port,
  dir: string,
  change: (r: Registry) => [boolean, T],
): Promise<T> {
  await port.run(["mkdir", "-p", dir]);
  const lockDir = `${dir}/.worktrees.lock.d`;
  const held = await lock(port, lockDir);
  try {
    const reg = parseRegistry(await port.read(worktreesFile(dir)));
    const [changed, out] = change(reg);
    if (changed) {
      const tmp = `${dir}/.worktrees.${unique()}.tmp`;
      await port.write(tmp, `${JSON.stringify(reg, null, 1)}\n`);
      if (
        (await port.run(["mv", "-f", tmp, worktreesFile(dir)])).exitCode !== 0
      )
        await port.run(["rm", "-f", tmp]);
    }
    return out;
  } finally {
    if (held) await unlock(port, lockDir);
  }
}

/** Note the worktrees a subagent wrote into. */
export async function note(
  port: Port,
  dir: string,
  agentId: string,
  paths: readonly string[],
): Promise<void> {
  if (!agentId || paths.length === 0) return;
  await withRegistry(port, dir, (reg) => {
    const entry = (reg.agents[agentId] ??= { paths: [] });
    const fresh = paths.filter((p) => !entry.paths.includes(p));
    entry.paths.push(...fresh);
    return [fresh.length > 0, undefined];
  });
}

/**
 * The worktrees a completion hands to cleanup.sh. A worker cleaned after
 * for a task is tied to that task's epic, so the epic's closing tries again
 * what a first attempt left (a PR merged after the task was completed).
 */
export async function claim(
  port: Port,
  dir: string,
  closing: Closing,
  agentsJson: string | undefined,
): Promise<string[]> {
  let started: string[] = [];
  if (closing.epicClosed) {
    try {
      const agents = JSON.parse(agentsJson ?? "").agents ?? {};
      started = Object.entries<any>(agents)
        .filter(([, e]) => e && e.epic === closing.epic)
        .map(([id]) => id);
    } catch {
      started = [];
    }
  }
  return withRegistry(port, dir, (reg) => {
    let changed = false;
    const ids = [...closing.workers];
    for (const w of closing.workers) {
      const e = reg.agents[w];
      if (e && e.epic === undefined && closing.epic > 0) {
        e.epic = closing.epic;
        changed = true;
      }
    }
    if (closing.epicClosed) {
      for (const [id, e] of Object.entries(reg.agents))
        if (e.epic === closing.epic) ids.push(id);
      ids.push(...started);
    }
    const paths: string[] = [];
    for (const id of ids)
      for (const p of reg.agents[id]?.paths ?? [])
        if (!paths.includes(p)) paths.push(p);
    return [changed, paths];
  });
}
