// project.ts — is the session in a Go project, and which workspace would the
// daemon serve for it. Pure: the file system is a lister handed in.
//
// It is ktn-linter's `daemonaddr.ResolveProject` (#743), walked the same way,
// and it is held to the SAME golden table (tests/fixtures/resolve-project.json,
// copied from the Go test at a pinned commit): a second predicate that
// drifted from the daemon's would light the mod up where the hooks see no
// project, or keep it dark where they serve one.
//
//   - git root: the nearest directory holding `.git`, a folder (main
//     checkout) or a FILE (linked worktree); none outside a repository.
//   - module roots: every directory from the start up to that boundary (or
//     the file system's root) holding a regular `go.mod` or `go.work`,
//     deepest first. Crossing a `vendor/` directory discards what was found
//     below it: vendored copies are other modules.
//   - module root: the nearest go.work among them, else the nearest go.mod.
//   - Go: at least one module root. A repository whose modules all sit in
//     subfolders is NOT Go from its root — the resolver's definition, which
//     `activation: always` overrides.
//
// One listing per level, walked upward only: nothing below the start is ever
// read, so a `bazel-out` link to a tree holding a go.mod is never followed.
// The walk stops at the boundary, or at the budget (#774: three listings,
// 250 ms), and then says so: an incomplete walk is UNDETERMINED, never a
// guess.

/** One directory entry, as `$.fs.list` gives it. */
export type Entry = {
  name: string;
  kind: "file" | "dir" | "other";
  isLink: boolean;
};

/** Lists a directory; rejects when it cannot be read. */
export type Lister = (dir: string) => Promise<readonly Entry[]>;

export type Resolution = {
  /** Where the walk started, as given (absolute). */
  dir: string;
  /** "" outside a repository, or when the walk stopped short of it. */
  gitRoot: string;
  /** Deepest first. */
  moduleRoots: string[];
  /** The nearest go.work, else the nearest go.mod; "" for none. */
  moduleRoot: string;
  isGo: boolean;
  /** False when the budget, a deadline or an unreadable folder cut the walk. */
  complete: boolean;
  /** Listings made. */
  calls: number;
};

export type Activation = "auto" | "always" | "off";
export type Verdict = "active" | "inactive" | "undetermined";

export type Budget = {
  /** At most this many listings; Infinity for none. */
  maxCalls: number;
  /** Answers true once the time is spent; checked before every listing. */
  expired?: () => Promise<boolean>;
};

const VENDOR = "vendor";

/** The parent of an absolute POSIX path; "/" is its own. */
export function parentOf(dir: string): string {
  const cut = dir.lastIndexOf("/");
  return cut <= 0 ? "/" : dir.slice(0, cut);
}

export function baseOf(dir: string): string {
  return dir.slice(dir.lastIndexOf("/") + 1);
}

/** Drops a trailing slash, keeping "/". */
export function clean(dir: string): string {
  let d = dir;
  while (d.length > 1 && d.endsWith("/")) d = d.slice(0, -1);
  return d;
}

// A go.mod or go.work counts when it is a regular file. A link is counted as
// the file it most likely leads to: the Go side stats through it, and telling
// a link to a folder from one to a file would cost a call per level.
const isMarkerFile = (e: Entry | undefined): boolean =>
  e !== undefined && (e.kind === "file" || e.isLink);

/**
 * Walks from `start` (absolute) up to the git root, the way
 * `daemonaddr.ResolveProject` does, within the budget.
 */
export async function resolveProject(
  start: string,
  list: Lister,
  budget: Budget,
): Promise<Resolution> {
  const dir = clean(start);
  const out: Resolution = {
    dir,
    gitRoot: "",
    moduleRoots: [],
    moduleRoot: "",
    isGo: false,
    complete: false,
    calls: 0,
  };
  // [dir, isWork], deepest first
  let markers: [string, boolean][] = [];
  let current = dir;
  for (;;) {
    if (out.calls >= budget.maxCalls) break;
    if (budget.expired && (await budget.expired())) break;
    let entries: readonly Entry[];
    try {
      out.calls++;
      entries = await list(current);
    } catch {
      break;
    }
    const byName = new Map<string, Entry>();
    for (const e of entries) byName.set(e.name, e);
    const isWork = isMarkerFile(byName.get("go.work"));
    if (isWork || isMarkerFile(byName.get("go.mod")))
      markers.push([current, isWork]);
    if (baseOf(current) === VENDOR) markers = [];
    // `.git` of any kind marks the boundary (Lstat on the Go side)
    if (byName.has(".git")) {
      out.gitRoot = current;
      out.complete = true;
      break;
    }
    const parent = parentOf(current);
    if (parent === current) {
      out.complete = true;
      break;
    }
    current = parent;
  }
  out.moduleRoots = markers.map(([d]) => d);
  out.moduleRoot =
    markers.find(([, w]) => w)?.[0] ?? markers[0]?.[0] ?? "";
  out.isGo = out.complete && markers.length > 0;
  return out;
}

/**
 * The root a session in this directory declares to the per-user daemon
 * (`ProjectRootsValue.WorkspaceRoot`, #758): the module root, else the git
 * root, else the start. On an incomplete walk, the best seen so far.
 */
export function workspaceRoot(r: Resolution): string {
  return r.moduleRoot || r.gitRoot || r.dir;
}

/**
 * The highest directory a search upward may reach (`SearchTop`): the git
 * root, else the highest module root, else the start.
 */
export function searchTop(r: Resolution): string {
  return r.gitRoot || r.moduleRoots[r.moduleRoots.length - 1] || r.dir;
}

/** What the mod does with a resolution, under the person's setting. */
export function verdictOf(r: Resolution, activation: Activation): Verdict {
  if (activation === "off") return "inactive";
  if (activation === "always") return "active";
  if (!r.complete) return "undetermined";
  return r.isGo ? "active" : "inactive";
}

export function parseActivation(v: unknown): Activation {
  return v === "always" || v === "off" ? v : "auto";
}

/**
 * Whether a resolution is worth walking again at the next turn: a folder may
 * have gained its go.mod (`go mod init`), and an undetermined walk may finish
 * on a quieter disk. A Go project stays one until the root moves.
 */
export function worthReprobing(r: Resolution | undefined): boolean {
  return r === undefined || !r.complete || !r.isGo;
}
