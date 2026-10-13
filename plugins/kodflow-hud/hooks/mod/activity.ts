// activity.ts — where each agent works, from the tool calls it makes. Pure.
//
// Nothing here touches the disk: a location is what the call names, never
// what a scan finds. The file tools name their file; Grep, Glob and LS their
// folder; a shell command its folder the two ways the status line reads
// (internal/adapter/activity/dir.go): a leading `cd X`, or `git -C X`. A
// commit turns the agent's recent writes under that repository from write
// to commit, since the files it took are not named anywhere without asking
// git, and asking git on every call is the cost this mod refuses.

import type { HudActivity, HudFile, HudOp } from "../../types";
import { dirname, isUnder, resolvePath } from "./paths.ts";

/** How long a touched file stays listed. */
export const FILE_TTL_MS = 45_000;
/** How many files a loop keeps; the view shows fewer when room is short. */
export const MAX_FILES = 8;

const WORD = `("[^"]+"|'[^']+'|[^\\s;&|]+)`;
const CD = new RegExp(`^\\s*cd\\s+${WORD}`);
const GIT_DIR = new RegExp(`(?:^|[\\s;&|(])git\\s+-C\\s+${WORD}`);
// git, then any of its global options, then the commit verb
const GIT_COMMIT =
  /(?:^|[\s;&|(])git\s+(?:(?:-C|-c)\s+(?:"[^"]+"|'[^']+'|\S+)\s+|--no-pager\s+|--git-dir=\S+\s+|--work-tree=\S+\s+)*commit\b/;

const unquote = (s: string): string =>
  s.length >= 2 && (s[0] === '"' || s[0] === "'") && s.at(-1) === s[0]
    ? s.slice(1, -1)
    : s;

const FILE_TOOLS: Record<string, { key: string; op: HudOp }> = {
  Read: { key: "file_path", op: "read" },
  Write: { key: "file_path", op: "write" },
  Edit: { key: "file_path", op: "write" },
  MultiEdit: { key: "file_path", op: "write" },
  NotebookEdit: { key: "notebook_path", op: "write" },
};
const DIR_TOOLS = new Set(["Grep", "Glob", "LS"]);

/** What one call says about where its loop works. */
export type Observation = {
  /** The folder it points at, absolute (a file's folder for a file tool). */
  dir?: string;
  files: { path: string; op: HudOp }[];
  /** A commit was made in this folder (still to be taken to its root). */
  commit?: string;
};

/**
 * Read one tool call. `base` is where a relative path lands (the loop's
 * current folder, else the session's root), `home` what `~` expands to.
 */
export function observe(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  base: string | undefined,
  home: string | undefined,
): Observation {
  const at = (raw: unknown): string | undefined =>
    typeof raw === "string" ? resolvePath(raw, base, home) : undefined;
  const file = FILE_TOOLS[tool];
  if (file) {
    const path = at(input[file.key]);
    return path
      ? { dir: dirname(path), files: [{ path, op: file.op }] }
      : { files: [] };
  }
  if (DIR_TOOLS.has(tool)) {
    const dir = at(input.path);
    return dir ? { dir, files: [] } : { files: [] };
  }
  if (tool === "Bash" && typeof input.command === "string") {
    const command = input.command;
    const git = GIT_DIR.exec(command);
    const cd = CD.exec(command);
    // git -C names the tree git works on; cd the folder the rest runs in
    const dir = at(unquote((git ?? cd)?.[1] ?? "")) ?? undefined;
    const obs: Observation = { files: [] };
    if (dir) obs.dir = dir;
    if (GIT_COMMIT.test(command)) {
      const where = dir ?? base;
      if (where) obs.commit = where;
    }
    return obs;
  }
  return { files: [] };
}

/**
 * Fold one observation into a loop's record. `dir` is the folder to show
 * (already taken to its repository's root by the caller), `commitRoot` the
 * root a commit was made in.
 */
export function fold(
  prev: HudActivity | undefined,
  agentId: string,
  obs: Observation,
  now: number,
  dir: string | undefined,
  commitRoot: string | undefined,
): HudActivity {
  let files: HudFile[] = prev ? [...prev.files] : [];
  for (const f of obs.files) {
    files = files.filter((x) => x.path !== f.path);
    files.unshift({ path: f.path, op: f.op, at: now });
  }
  if (commitRoot)
    files = files.map((f) =>
      f.op === "write" && isUnder(f.path, commitRoot)
        ? { ...f, op: "commit", at: now }
        : f,
    );
  const next: HudActivity = {
    agentId,
    files: files.slice(0, MAX_FILES),
    last: now,
  };
  const where = dir ?? commitRoot ?? prev?.dir;
  if (where) next.dir = where;
  return next;
}

/** Drop the files older than the TTL; undefined when nothing changed. */
export function prune(
  activity: Readonly<Record<string, HudActivity>>,
  now: number,
  ttl = FILE_TTL_MS,
): Record<string, HudActivity> | undefined {
  let changed = false;
  const out: Record<string, HudActivity> = {};
  for (const [id, a] of Object.entries(activity)) {
    const files = a.files.filter((f) => now - f.at < ttl);
    if (files.length !== a.files.length) changed = true;
    out[id] = files.length === a.files.length ? a : { ...a, files };
  }
  return changed ? out : undefined;
}
