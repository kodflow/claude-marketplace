// collision.ts — who else on this machine edited a file lately. Pure.
//
// Each session keeps <config>/kodflow/sessions/<session>/edits.tsv: one line
// per file it wrote, `<seconds>\t<absolute path>`, nothing else (never a
// prompt, never the content). Before Edit, Write or NotebookEdit the mod reads
// the other live sessions' files; a recent line on the same path is a
// collision the user is asked about.

/** How far back an edit counts, and how fresh a beat must be: 30 minutes. */
export const WINDOW_S = 30 * 60;

/** The tools that write a file, and the argument that names it. */
const WRITERS: Record<string, string> = {
  Edit: "file_path",
  Write: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

export const editsFile = (dir: string): string => `${dir}/edits.tsv`;

/** Whether a call of this tool writes a file. */
export const writes = (tool: unknown): boolean =>
  typeof tool === "string" && Object.hasOwn(WRITERS, tool);

/** The path a writing call targets, absolute; undefined for any other call. */
export function targetOf(
  tool: unknown,
  args: Record<string, unknown>,
  cwd: string,
): string | undefined {
  const key = writes(tool) ? WRITERS[tool as string] : undefined;
  const raw = key ? args[key] : undefined;
  if (typeof raw !== "string" || raw === "") return undefined;
  return normalize(raw.startsWith("/") ? raw : `${cwd}/${raw}`);
}

/** `a/./b/../c` to `a/c`, without touching the disk. */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

/** Claude's own transcripts and memory: written by every session, never a collision. */
export const excluded = (path: string, config: string): boolean =>
  path === `${config}/projects` || path.startsWith(`${config}/projects/`);

export type Edit = { at: number; path: string };

export function parse(text: string | undefined): Edit[] {
  const edits: Edit[] = [];
  for (const line of (text ?? "").split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 1) continue;
    const at = Number(line.slice(0, tab));
    const path = line.slice(tab + 1);
    if (Number.isFinite(at) && path.startsWith("/")) edits.push({ at, path });
  }
  return edits;
}

/**
 * The file after this session wrote `path`: the line added, every line older
 * than the window dropped, one line per path (its latest).
 */
export function record(
  text: string | undefined,
  path: string,
  nowSec: number,
): string {
  if (/[\t\n\r]/.test(path)) return text ?? "";
  const keep = new Map<string, number>();
  for (const e of parse(text))
    if (nowSec - e.at < WINDOW_S)
      keep.set(e.path, Math.max(e.at, keep.get(e.path) ?? 0));
  keep.delete(path);
  keep.set(path, nowSec);
  return [...keep].map(([p, at]) => `${at}\t${p}\n`).join("");
}

/** A beat file's content (seconds) is live when within the window. */
export function isLive(beat: string | undefined, nowSec: number): boolean {
  const at = Number((beat ?? "").trim());
  return (
    beat !== undefined &&
    Number.isFinite(at) &&
    at > 0 &&
    nowSec - at < WINDOW_S
  );
}

export type Collision = { session: string; at: number };

/** The newest recent edit of `path` among other sessions' edits. */
export function newest(
  path: string,
  others: readonly { session: string; text: string | undefined }[],
  nowSec: number,
): Collision | undefined {
  let found: Collision | undefined;
  for (const o of others)
    for (const e of parse(o.text))
      if (
        e.path === path &&
        nowSec - e.at < WINDOW_S &&
        (!found || e.at > found.at)
      )
        found = { session: o.session, at: e.at };
  return found;
}

export const CONTINUE = "Continue";
export const WORKTREE = "Move to a worktree";
export const CANCEL = "Cancel";

export function question(path: string, c: Collision, nowSec: number): string {
  const min = Math.max(0, Math.round((nowSec - c.at) / 60));
  return `Another session (${c.session.slice(0, 8)}) edited ${path} ${min} min ago. Edit it here anyway?`;
}

/** What the user's answer does: go on, or the deny text the model reads. */
export function answer(
  chosen: string,
  path: string,
): { go: true } | { deny: string } {
  if (chosen === CONTINUE) return { go: true };
  if (chosen === WORKTREE)
    return {
      deny: `collision-guard: another session edited ${path} in the last 30 minutes. The user chose to move this work to a worktree: call EnterWorktree, then make the change there.`,
    };
  if (chosen === CANCEL)
    return {
      deny: `collision-guard: another session edited ${path} in the last 30 minutes, and the user cancelled this edit. Do not retry it; ask the user how to proceed.`,
    };
  return {
    deny: `collision-guard: another session edited ${path} in the last 30 minutes. The user answered: ${chosen}`,
  };
}
