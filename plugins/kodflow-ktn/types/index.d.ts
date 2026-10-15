// The values kodflow-ktn keeps in `$.state` for the session. `$.state` is
// the DISPLAY copy: every transition writes the module's own variable first
// (the fast source, lost on a reload) and then this snapshot (what the
// drawings subscribe to, kept across a hot reload). Any plugin may read any
// value here, so nothing secret is ever written: no token, no credential.

/**
 * Where the mod stands in this session:
 *   inert         nothing draws here (`-p`, the Agent SDK, Kepler's launch
 *                 mode): no probe, no daemon call, nothing opened;
 *   floor         Claude Code older than the version the mod was measured on;
 *   probing       the activation probe is under way;
 *   active        a Go project (or `activation: always`);
 *   inactive      not a Go project (or `activation: off`);
 *   undetermined  the probe ran out of budget: drawn as inactive.
 */
export type KtnActivation =
  | "inert"
  | "floor"
  | "probing"
  | "active"
  | "inactive"
  | "undetermined";

export type KtnSnap = {
  activation: KtnActivation;
  /** The session's project root the probe walked from. */
  root?: string;
  /** The root the daemon is asked about (the module root, else the git root). */
  workspace?: string;
};

declare module "claude-code" {
  interface PluginState {
    "kodflow-ktn": {
      snap: KtnSnap;
    };
  }
}
