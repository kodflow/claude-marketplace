// paths.ts — where a session's files are. Pure.
//
// configDir, safe and sessionDir are kodflow-hooks' own (hooks/mod/paths.ts),
// copied rather than imported: a plugin is installed alone, and a link into
// a sibling plugin is broken for every consumer. They must agree, since this
// mod reads the tasks.json that one writes.

import { isAbsolutePath, joinPath, trimSlash } from "./host.ts";

/**
 * CLAUDE_CONFIG_DIR, else ~/.claude; undefined unless absolute, on any host
 * (`C:\Profiles\dev` included), in forward slashes.
 */
export function configDir(
  claudeConfigDir: string | undefined,
  home: string | undefined,
): string | undefined {
  const pick =
    claudeConfigDir || (isAbsolutePath(home) ? joinPath(home, ".claude") : "");
  if (!isAbsolutePath(pick)) return undefined;
  return trimSlash(pick);
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
