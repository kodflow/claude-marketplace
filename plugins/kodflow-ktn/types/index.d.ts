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

/** Findings counted in total, by effective severity and by phase. */
export type KtnCounts = {
  findings: number;
  severity: { error: number; warning: number; info: number };
  /** By phase number, as the daemon keys it ("1" to "9"). */
  phase: Record<string, number>;
};

/** One node of the view model (pkg/view): a directory, a file or a finding. */
export type KtnNode = {
  /** Stable: dir:<path>, file:<path>, finding:<fingerprint>. */
  id: string;
  kind: "dir" | "file" | "finding";
  name: string;
  parent?: string;
  depth: number;
  expanded: boolean;
  counts?: KtnCounts;
  line?: number;
  rule?: string;
  severity?: string;
  phase?: number;
  message?: string;
};

/** What one /api/view answer said, cut to what the mod draws. */
export type KtnModel = {
  rev: number;
  workspace: string;
  /** The engine's lifecycle state, "idle" before any engine serves it. */
  state: string;
  totals: KtnCounts;
  nodes: KtnNode[];
  /** The server's window stopped short, or the mod cut it. */
  truncated: boolean;
  /** Visible nodes not in this window: the web UI's to show. */
  hidden: number;
};

/**
 * The daemon, as the mod sees it — the seven drawn states of #776 are
 * `activation` not active (out of a Go project) and these:
 *   loading       no answer yet;
 *   unreachable   no endpoint.json, nothing on the socket, a silent or
 *                 broken daemon;
 *   incompatible  another protocol: no further call until endpoint.json moves;
 *   pending       the workspace waits for the person's approval (the command);
 *   refused       the daemon does not serve it (its reason);
 *   policy        the request was refused before it left (an organization's
 *                 policy, a hook): distinct from unreachable, no launch offered;
 *   ready         served: clean when `totals.findings` is 0.
 */
export type KtnDaemonKind =
  | "loading"
  | "unreachable"
  | "incompatible"
  | "pending"
  | "refused"
  | "policy"
  | "ready";

export type KtnDaemon = {
  kind: KtnDaemonKind;
  /** Why, in the daemon's or the transport's words, sanitised. */
  detail?: string;
  /** A command for the person to run: the approval, or the launch. */
  command?: string;
  /** What is offered to start the daemon: a button, a command, or nothing. */
  launch: "button" | "command" | "none";
  launching?: "starting" | "failed";
  launchError?: string;
  /** The ktn-linter version endpoint.json names. */
  version?: string;
  totals?: KtnCounts;
  /** The engine's lifecycle state. */
  engine?: string;
  /** When the last answer came, milliseconds since the epoch. */
  at?: number;
};

export type KtnSnap = {
  activation: KtnActivation;
  /** The session's project root the probe walked from. */
  root?: string;
  /** The root the daemon is asked about (the module root, else the git root). */
  workspace?: string;
  daemon?: KtnDaemon;
};

/** The pane's tree: the window of the view model the last answer served. */
export type KtnTree = {
  workspace: string;
  nodes: KtnNode[];
  truncated: boolean;
  hidden: number;
};

declare module "claude-code" {
  interface PluginState {
    "kodflow-ktn": {
      snap: KtnSnap;
      /** The pane's tree; absent until a model was served. */
      tree: KtnTree;
      /** The dir: and file: ids the person opened in the pane. No secret. */
      expanded: string[];
    };
  }
}
