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

/**
 * pkg/daemonaddr/socket.go `ProtocolVersion`: the daemon's wire version, the
 * `protocol_version` of /status and the `schema` of every /api/view answer.
 */
export const PROTOCOL_VERSION = "v1";

/** pkg/daemonctl/files.go `EndpointSchema`: endpoint.json's layout version. */
export const ENDPOINT_SCHEMA = 1;

/**
 * pkg/daemonctl/layout.go `CheckSocketPath`: the daemon refuses to bind a
 * socket path over 96 bytes (the engine itself reaches 107, the Linux
 * `sun_path` limit, measured by #774). A pointer naming a longer one was not
 * written by a daemon that could serve it.
 */
export const SOCKET_MAX_BYTES = 96;

/**
 * pkg/userdirs `Anchor()`: endpoint.json sits under HOME alone, whatever
 * XDG_STATE_HOME says, so a client finds it when the state is redirected.
 * base_xdg.go: `~/.local/state`; base_darwin.go: `~/Library/Application
 * Support`. Windows (LOCALAPPDATA) is out of the mod's support (#774).
 */
export const ANCHORS = [
  ".local/state/ktn-linter/endpoint.json",
  "Library/Application Support/ktn-linter/endpoint.json",
] as const;

/** pkg/view/wire.go `RoutePath`, mounted on the socket only. */
export const VIEW_ROUTE = "/api/view";

/** pkg/view/query.go `MaxWait`: the long-poll's wait while a pane is placed. */
export const MAX_WAIT_S = 20;

/**
 * pkg/serve/ui.go `uiBootPath`: the socket route that mints a bootstrap link
 * to the web UI, of class `view` (read-only, pkg/webui) — the only class it
 * grants, so a token that went through a mod never opens an admin session.
 */
export const UI_BOOT = "/ui/boot";

/**
 * A rendered tree draws its first 100 000 characters (the engine's limit):
 * the pane stops its rows at this budget and says how many it left out.
 */
export const RENDER_BUDGET = 90_000;

/**
 * The mod's own window over the tree (kodflow/ktn-linter#787), the
 * `scrolling: window` mode: the daemon serves WINDOW_ROWS nodes from an
 * offset (`offset=` / `limit=`, pkg/view), the snapshot kept in `$.state` is
 * cut at WINDOW_MAX_CHARS of text (re-read on every render, so on every
 * wheel tick), and a scroll that comes within WINDOW_EDGE rows of either end
 * of what is held asks for the next window, detached.
 */
export const WINDOW_ROWS = 180;
export const WINDOW_MAX_CHARS = 70_000;
export const WINDOW_EDGE = 20;

/**
 * pkg/view/query.go `paramSeverity`: the severity filter the pane sends
 * (`/ktn-view filtre error,warning`), each value one of these.
 */
export const SEVERITIES = ["error", "warning", "info"] as const;

/** pkg/view/wire.go `CodeWorkspaceNotServed`. */
export const NOT_SERVED = "workspace_not_served";

/**
 * pkg/view/build.go `MaxResponseBytes` is 1 MiB; the engine's fetch takes
 * 4 MiB. Past 1.5 MiB the answer is not one a daemon of this protocol sends,
 * and parsing it would hold the worker every mod shares: it is refused unread.
 */
export const MAX_BODY_CHARS = 1_572_864;

/** pkg/view/build.go `MaxLimit`: the most nodes one window holds. */
export const MAX_NODES = 1_000;

/**
 * `$.http.fetch` has one fixed deadline, 30 s, and no signal (#774). The mod
 * races its own: the request's wait plus 5 s.
 */
export const RACE_SLACK_MS = 5_000;

/** After this many failures in a row, the turn's refresh waits its backoff. */
export const BREAKER_AFTER = 5;
export const BACKOFF_MIN_MS = 3_000;
export const BACKOFF_MAX_MS = 60_000;

/** The launch button: `daemon ensure` gets 10 s, then a look every 500 ms for 10 s. */
export const LAUNCH_TIMEOUT_MS = 10_000;
export const LAUNCH_POLL_MS = 500;

/** What a daemon string may take in a drawing, and an error the button shows. */
export const MAX_TEXT = 300;

/** The plugin's name, which `$.state` keys and the pane id are scoped by. */
export const PLUGIN = "kodflow-ktn";
/** `/ktn` belongs to kodflow-devops (#774): the mod's command is this one. */
export const COMMAND = "ktn-view";
/** The pane's id, the same word. */
export const PANE_ID = "ktn-view";
