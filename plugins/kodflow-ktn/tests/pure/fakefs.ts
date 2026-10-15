// fakefs.ts — a directory tree in memory, listed the way `$.fs.list` lists:
// one call per directory, entries as they stand (a link is `other` with
// `isLink`, never followed). What the pure tests walk instead of a disk.
import type { Entry, Lister } from "../../hooks/mod/project.ts";

export type FakeFs = {
  list: Lister;
  /** Every directory listed, in order. */
  listed: string[];
};

/**
 * Lays `tree` under `base`: a name ending in "/" is a directory, any other a
 * file created with its parents, and `name -> target` a symbolic link.
 * Everything above `base` exists and is empty, as the Go test's temp dir.
 */
export function fakeFs(base: string, tree: readonly string[]): FakeFs {
  const dirs = new Map<string, Map<string, Entry>>();
  const ensureDir = (path: string) => {
    if (dirs.has(path)) return;
    dirs.set(path, new Map());
    if (path === "/") return;
    const cut = path.lastIndexOf("/");
    const parent = cut <= 0 ? "/" : path.slice(0, cut);
    ensureDir(parent);
    dirs
      .get(parent)!
      .set(path.slice(cut + 1), { name: path.slice(cut + 1), kind: "dir", isLink: false });
  };
  ensureDir(base);
  for (const raw of tree) {
    const isLink = raw.includes(" -> ");
    const entry = isLink ? raw.split(" -> ")[0]! : raw;
    const path = `${base}/${entry}`.replace(/\/+$/, "").replace(/\/\.$/, "");
    if (raw.endsWith("/") && !isLink) {
      ensureDir(path);
      continue;
    }
    const cut = path.lastIndexOf("/");
    const parent = path.slice(0, cut) || "/";
    ensureDir(parent);
    const name = path.slice(cut + 1);
    dirs.get(parent)!.set(name, {
      name,
      kind: isLink ? "other" : "file",
      isLink,
    });
  }
  const listed: string[] = [];
  return {
    listed,
    list: async (dir: string) => {
      listed.push(dir);
      const d = dirs.get(dir);
      if (!d) throw new Error(`ENOENT: ${dir}`);
      return [...d.values()];
    },
  };
}
