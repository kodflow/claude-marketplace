// zsh.ts — where zsh reads its startup files from. Pure.
//
// zsh fails a command on an unmatched glob (`no matches found`) and expands a
// leading `=`. The mod points ZDOTDIR at hooks/zsh, whose .zshenv sources the
// user's own .zshenv, puts ZDOTDIR back, then sets `nonomatch noequals`.
// KODFLOW_USER_ZDOTDIR carries the user's ZDOTDIR ("" when it was unset).

/** The directory the plugin ships the .zshenv in. */
export const zdotdirOf = (pluginRoot: string): string =>
  `${pluginRoot.replace(/\/+$/, "")}/hooks/zsh`;

/**
 * What to set, or undefined when it is already in place. `current` is
 * ZDOTDIR now, `saved` KODFLOW_USER_ZDOTDIR now, `ours` zdotdirOf(root).
 *
 * A ZDOTDIR that is another copy of ours (the plugin updated under a running
 * process) keeps the saved value; any other is the user's and is saved.
 */
export function zdotdirPlan(
  current: string | undefined,
  saved: string | undefined,
  ours: string,
): { zdotdir: string; user: string } | undefined {
  if (current === ours) return undefined;
  const stale =
    saved !== undefined &&
    current !== undefined &&
    current.endsWith("/hooks/zsh");
  return { zdotdir: ours, user: stale ? saved : (current ?? "") };
}
