// contract.ts — the constants this mod shares with ktn-linter and with the
// engine, each with where it was measured or where the other side writes it.
//
// Nothing here is computed: a value that the daemon owns is read from the
// daemon (endpoint.json, /status, /api/view), and the few constants a client
// must know beforehand are pinned below with their source, so a change on
// the other side is a diff someone reads, not a silent drift.

/** The ktn-linter commit the constants and the fixtures were taken from. */
export const KTN_LINTER_SHA = "bb5c349d2009ef79df8df1b9a5e2ba7758cb1827";

/**
 * The oldest Claude Code the spike of kodflow/ktn-linter#774 measured
 * (2.1.299 and 2.1.301 only, no bisection below): the mod stays inert under
 * it, with one status line saying why.
 */
export const MIN_ENGINE = "2.1.299";

/**
 * The activation probe's budget, fixed by the same spike: one `$.fs` call
 * costs 1 to 9 ms, `session.start` is awaited before the first prompt, so the
 * probe stops after three listings or 250 ms and answers "undetermined".
 */
export const PROBE_MAX_CALLS = 3;
export const PROBE_MAX_MS = 250;

/** The plugin's name, which `$.state` keys and the pane id are scoped by. */
export const PLUGIN = "kodflow-ktn";
/** `/ktn` belongs to kodflow-devops (#774): the mod's command is this one. */
export const COMMAND = "ktn-view";
