// who.ts — how a loop is named and coloured in the « Tâches » tree. Pure.
//
// The main loop is « principal », drawn in the theme's own `claude` colour
// (the engine picks its shade for a light or a dark theme). Each subagent
// keeps one colour for the session, picked from its id, on every row it
// works. The
// palette stays clear of the colours the tree gives to states (amber under
// way, teal ready, mauve the person and the epics, green done, red blocked)
// and of the model's blue, and every shade is a mid tone, legible on a light
// ground as on a dark one.
//
// An agent's role is its type, `$.agent.list()`'s `type` (the Agent call's
// `subagent_type`), shown short: the plugin prefix dropped, a specialist's
// « <area>-specialist-<topic> » read « area · topic ». A type nobody gave is
// left empty, never guessed.

import { MAIN } from "./board.ts";
import { safe } from "./paths.ts";

/** The theme colour of the main loop. */
export const MAIN_COLOR = "claude";
export const MAIN_NAME = "principal";

/** One per subagent, stable for its id: mid tones, none a state's. */
export const AGENT_PALETTE = [
  "#5f87d7", // steel blue
  "#d75f87", // rose
  "#5faf87", // sea green
  "#af87d7", // lavender
  "#d7875f", // terracotta
  "#87af5f", // olive
  "#d75fd7", // orchid
  "#5fafd7", // sky
] as const;

/** A loop's colour: the theme's for the main one, the palette's otherwise. */
export function colorOf(loop: string): string {
  if (loop === MAIN) return MAIN_COLOR;
  let h = 0;
  for (const c of safe(loop)) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return AGENT_PALETTE[h % AGENT_PALETTE.length]!;
}

/**
 * « devops · hashicorp », « general-purpose », « Explore »: an agent type,
 * short. The plugin's prefix goes, a specialist or executor keeps its area
 * and its topic. "" when the type is unknown.
 */
export function roleOf(type: string | undefined): string {
  const bare = (type ?? "").trim().replace(/^[\w.-]+:/, "");
  const m = /^([a-z]+)-(?:specialist|executor)-(.+)$/.exec(bare);
  return m ? `${m[1]} · ${m[2]}` : bare;
}
