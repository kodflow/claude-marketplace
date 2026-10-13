// paths.ts — where a session's files are, and how a path is spelled. Pure.
//
// configDir, safe and sessionDir are kodflow-hooks' own (hooks/mod/paths.ts),
// copied rather than imported: a plugin is installed alone, and a link into
// a sibling plugin is broken for every consumer. They must agree, since this
// mod reads the tasks.json that one writes.

/** CLAUDE_CONFIG_DIR, else ~/.claude; undefined unless absolute. */
export function configDir(
  claudeConfigDir: string | undefined,
  home: string | undefined,
): string | undefined {
  const pick =
    claudeConfigDir || (home ? `${home.replace(/\/+$/, "")}/.claude` : "");
  if (!pick.startsWith("/")) return undefined;
  return pick.length > 1 ? pick.replace(/\/+$/, "") : pick;
}

/** An identifier usable as a single path component (tasks.py's safe). */
export function safe(value: unknown): string {
  const chars = [...String(value)].map((c) =>
    /^[\p{L}\p{N}_-]$/u.test(c) ? c : "-",
  );
  return chars.slice(0, 128).join("") || "default";
}

export const sessionDir = (config: string, session: string): string =>
  `${config}/kodflow/sessions/${safe(session)}`;

export const tasksFile = (dir: string): string => `${dir}/tasks.json`;

/** Collapse `.`, `..` and repeated slashes of an absolute path. */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

/**
 * A path as written in a tool call, made absolute: `~` expanded against
 * `home`, a relative path joined to `base`. Undefined when neither can place
 * it (a relative path with no base, `~` with no home).
 */
export function resolvePath(
  raw: string,
  base: string | undefined,
  home: string | undefined,
): string | undefined {
  let path = raw.trim();
  if (!path) return undefined;
  if (path === "~" || path.startsWith("~/")) {
    if (!home) return undefined;
    path = home + path.slice(1);
  }
  if (!path.startsWith("/")) {
    if (!base || !base.startsWith("/")) return undefined;
    path = `${base}/${path}`;
  }
  return normalize(path);
}

export const dirname = (path: string): string =>
  path.lastIndexOf("/") > 0 ? path.slice(0, path.lastIndexOf("/")) : "/";

/** True when `path` is `dir` or lies under it. */
export const isUnder = (path: string, dir: string): boolean =>
  path === dir || path.startsWith(dir === "/" ? "/" : dir + "/");

/** `home` shown as `~`, the way a shell prompt spells it. */
export function tilde(path: string, home: string | undefined): string {
  if (!home || home === "/") return path;
  return isUnder(path, home) ? "~" + path.slice(home.length) : path;
}

/** A file shown relative to the agent's directory when it lies under it. */
export function shortFile(path: string, dir: string | undefined): string {
  if (dir && dir !== path && isUnder(path, dir))
    return path.slice(dir === "/" ? 1 : dir.length + 1);
  return path;
}
