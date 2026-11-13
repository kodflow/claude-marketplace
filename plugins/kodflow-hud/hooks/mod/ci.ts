// ci.ts — the CI state of the pull requests the tasks cite. Pure.
//
// Read by `gh pr checks <url>`, whose exit code says it: 0 every check
// passed, 8 some still pending, 1 one failed (or gh itself failed, which its
// output tells apart). Only the pull requests an open task cites are asked,
// and no more often than every CI_EVERY_MS.

import type { HudCiState, HudTask } from "../../types";

export const CI_EVERY_MS = 5 * 60_000;

/**
 * The pull requests to ask about: cited by a task shown and not completed
 * (board.ts visibleTasks: nothing of a closed epic, no orphan).
 */
export function prsToCheck(tasks: readonly HudTask[]): string[] {
  const seen = new Set<string>();
  for (const t of tasks)
    if (t.status !== "completed") for (const pr of t.prs) seen.add(pr);
  return [...seen];
}

/** What `gh pr checks` answered, as one state. */
export function ciState(
  exitCode: number,
  stdout: string,
  stderr: string,
): HudCiState {
  if (/no checks reported/i.test(stderr + stdout)) return "none";
  if (exitCode === 0) return "pass";
  if (exitCode === 8) return "pending";
  // 1 is a failed check when gh printed the checks, an error otherwise
  if (exitCode === 1 && /\bfail/i.test(stdout)) return "fail";
  return "error";
}
