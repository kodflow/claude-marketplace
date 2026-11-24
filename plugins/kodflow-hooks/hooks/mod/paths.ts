// paths.ts — where the mod keeps a session's state. Pure.
//
// <config>/kodflow/sessions/<session>/ is shared with the shell hooks,
// /recap and kodflow-hud: tasks.json (the task list), agents.json (on-agent.sh),
// triage-pending (the triage gate), triage-wrote (a write tried while it
// was up) and mod-beat (the proof the mod is loaded).

import { isAbsolutePath, joinPath, trimSlash } from "./host.ts";

/**
 * The Claude configuration directory: CLAUDE_CONFIG_DIR, else ~/.claude.
 * Always absolute: `$.fs` resolves a relative path against the session's
 * working directory and never expands `~`, so anything else is refused.
 * Absolute on any host (`/x`, `C:\x`, `C:/x`, `\\server\share`), and
 * returned in forward slashes: a Windows session's HOME is `C:\Profiles\dev`.
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

/** Keep an identifier usable as a single path component (tasks.py's safe). */
export function safe(value: unknown): string {
  const chars = [...String(value)].map((c) =>
    /^[\p{L}\p{N}_-]$/u.test(c) ? c : "-",
  );
  return chars.slice(0, 128).join("") || "default";
}

export const sessionDir = (config: string, session: string): string =>
  `${config}/kodflow/sessions/${safe(session)}`;

export const tasksFile = (dir: string): string => `${dir}/tasks.json`;
export const agentsFile = (dir: string): string => `${dir}/agents.json`;
export const triageFile = (dir: string): string => `${dir}/triage-pending`;
/** Written by the mod when the main loop tries a tool off the read list while the gate is up. */
export const wroteFile = (dir: string): string => `${dir}/triage-wrote`;
export const beatFile = (dir: string): string => `${dir}/mod-beat`;

/** The beat's content: the time in whole seconds, as the shell compares it. */
export const beatText = (nowMs: number): string =>
  String(Math.floor(nowMs / 1000));

/**
 * When the user last typed at the prompt, in whole seconds: written on every
 * composer prompt, read by on-stop.sh before it proposes agent feedback.
 */
export const composerFile = (dir: string): string => `${dir}/composer-at`;

