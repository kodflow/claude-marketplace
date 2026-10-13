// paths.ts — where the mod keeps a session's state. Pure.
//
// <config>/kodflow/sessions/<session>/ is shared with the shell hooks and the
// status line: tasks.json (the task list), agents.json (on-agent.sh),
// triage-pending (the triage gate) and mod-beat (the proof the mod is loaded).

/**
 * The Claude configuration directory: CLAUDE_CONFIG_DIR, else ~/.claude.
 * Always absolute: `$.fs` resolves a relative path against the session's
 * working directory and never expands `~`, so anything else is refused.
 */
export function configDir(
  claudeConfigDir: string | undefined,
  home: string | undefined,
): string | undefined {
  const pick =
    claudeConfigDir || (home ? `${home.replace(/\/+$/, "")}/.claude` : "");
  if (!pick.startsWith("/")) return undefined;
  return pick.length > 1 ? pick.replace(/\/+$/, "") : pick;
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
export const beatFile = (dir: string): string => `${dir}/mod-beat`;

/** The beat's content: the time in whole seconds, as the shell compares it. */
export const beatText = (nowMs: number): string =>
  String(Math.floor(nowMs / 1000));

/** The merge gate's token for one call (L5): the head SHA it was agreed on. */
export const mergeTokenFile = (dir: string, toolUseId: unknown): string =>
  `${dir}/merge-ok/${safe(toolUseId)}`;
