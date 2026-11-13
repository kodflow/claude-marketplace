// The values kodflow-hud keeps in `$.state` for the session: what its pane
// draws from. Every one is derived — the task board from tasks.json
// (kodflow-hooks writes it, this mod only reads it), the agents from
// `$.agent.list()`, the activity from the tool calls it watches — so none is a
// second source of truth: a reload re-reads them all.

/** One task as the board shows it, cut down from a tasks.json v2 entry. */
export type HudTask = {
  id: string;
  subject: string;
  /** pending, in_progress, waiting or completed. */
  status: string;
  /** The epic it is filed under; 0 for none. */
  epic: number;
  /** The loop that owns it: "main", or a subagent's id made path-safe. */
  agent: string;
  /** The worker it was handed to (task_update worker=), by the name given. */
  worker?: string;
  /** That worker's agent id, as `$.agent.list()` names it. */
  workerId?: string;
  /**
   * Every agent id the task was ever handed to (kodflow-hooks writes it on
   * each accepted worker=, never removes one), in order: the subagents
   * whose own tasks hang under this one.
   */
  workers?: string[];
  /** "human" for a task waiting on the person, when the field exists. */
  assignee?: string;
  /** Last change, in seconds (tasks.json's own unit). */
  updated: number;
  /** Pull request URLs the subject or description cites. */
  prs: string[];
  /** What the task is about in full: the tree's detail line. */
  description?: string;
  /** The task it is a subtask of (task_create parent=), by id. */
  parent?: string;
  /** The tasks it waits on (task_create blocked_by=), by id. */
  blockedBy?: string[];
  /** A short handle (T0, C6) the tree shows in place of the id. */
  ref?: string;
};

/**
 * An open epic of the main agent: not closed, with a task left to do, or
 * the active one still empty, or one whose last task was done in the last
 * 30 minutes. The tasks filed under no epic are one more, id 0.
 */
export type HudEpic = {
  id: number;
  title: string;
  agent: string;
  /** Opened, in seconds. */
  created: number;
  touched: number;
  /** The main agent's active epic. */
  active?: boolean;
  /** Nothing moved for 24 h and nobody on it: drawn on one line until opened. */
  idle?: boolean;
  tasks: HudTask[];
};

export type HudBoard = {
  /** Whether tasks.json exists for this session. */
  found: boolean;
  epics: HudEpic[];
  /**
   * The subagents' own tasks (agent not "main"), those anchored on a task
   * of a closed epic left out; `stopped` on one whose agent is not live
   * (counted, never drawn). Absent from an older board.
   */
  helpers?: (HudTask & { stopped?: boolean })[];
};

/** An agent of the session as `$.agent.list()` reports it. */
export type HudAgent = {
  id: string;
  /** Its name, else its type, its description or the head of its id. */
  label: string;
  status: string;
  /** What SendMessage addresses it by, when it has one. */
  name?: string;
  /** The agent type it was spawned as (`subagent_type`), when said. */
  type?: string;
};

/**
 * When a loop last called a tool, which says it is alive. A session kept
 * from an older version may still hold `dir` and `files`: nothing reads them.
 */
export type HudActivity = {
  /** "main", or the subagent's agent id. */
  agentId: string;
  /** Milliseconds since the epoch. */
  last: number;
};

/**
 * What a loop runs on, as the session said it: the model the Agent call or
 * the spawn resolved, the effort the call asked for. A field nobody gave
 * stays absent: the tree then leaves its cell empty.
 */
export type HudModel = { model?: string; effort?: string };

export type HudCiState = "pass" | "fail" | "pending" | "none" | "error";

export type HudCi = { state: HudCiState; at: number };

/** One notable event of a hunt, as status.json keeps the last 20. */
export type HudHuntEvent = { seq: number; kind: string; text: string };

/**
 * A hunt's status.json (/hunt v1), cut down to what the « Chasse » view
 * shows. Fields the reader does not know are dropped, never guessed.
 */
export type HudHuntStatus = {
  seq: number;
  /** hunting, frozen, final-pass, pushing, awaiting-merge, paused, done. */
  state: string;
  pause?: { reason: string; since?: number };
  counter: { open: number; cap: number; resumeAt?: number };
  pass: { n: number; sha?: string; done: number; total: number };
  queue: {
    tokens: number;
    holders: {
      slug: string;
      label: string;
      since?: number;
      exclusive: boolean;
    }[];
    waiting: { slug: string; label: string; since?: number }[];
  };
  tip: { sha?: string; bundleAt?: number };
  codex: { pending: number; done: number; skipped: number; abandoned: number };
  decisions: { repo: string; issue: string; title: string }[];
  /** Last progress event, in milliseconds since the epoch. */
  beat?: number;
  /** A queued job of this hunt runs; past `deadline` it counts as none. */
  busy?: { since?: number; deadline?: number };
  notifyFailed: boolean;
  events: HudHuntEvent[];
};

/** One hunt of active.json, with its status.json when it could be read. */
export type HudHuntRun = {
  slug: string;
  /** When the hunt was registered: a slug reused gets a new one. */
  created: number;
  /** active.json's own mirror of the state and the beat. */
  state: string;
  beat?: number;
  status?: HudHuntStatus;
  /** Why `status` is missing: « état illisible », « format vN non lu… ». */
  problem?: string;
};

/** What the « Chasse » view draws: `found` false when no hunt is listed. */
export type HudHunt = {
  found: boolean;
  /** The whole read failed, or active.json is of another format. */
  problem?: string;
  runs: HudHuntRun[];
};

/** By slug: the hunt it was (its `created`) and the last event seq toasted. */
export type HudHuntCursor = Record<string, { created: number; seq: number }>;

/**
 * The « Tâches » Client's faults (fault.ts): the generation its key carries,
 * the recent faults in milliseconds, and until when it rests drawn still.
 */
export type HudFault = { gen: number; at: number[]; until: number };

declare module "claude-code" {
  interface PluginState {
    "kodflow-hud": {
      board: HudBoard;
      agents: HudAgent[];
      activity: Record<string, HudActivity>;
      ci: Record<string, HudCi>;
      /** By `<session>:<loop>` (loop "main" or a subagent's id): what it runs on. */
      models: Record<string, HudModel>;
      /** `<session>:<task>:<state>` already toasted, so each is toasted once. */
      toasted: string[];
      /**
       * The session whose first board was read: what stood then is no news,
       * so it is recorded as toasted without a toast.
       */
      primed: string;
      /** "unknown" while `$.agent.list()` could not be read at the last poll. */
      liveness: string;
      /** Advances every few seconds, so the elapsed times redraw. */
      tick: number;
      /** active.json and each hunt's status.json, for the « Chasse » view. */
      hunt: HudHunt;
      /** Per hunt, the last event toasted in this session. */
      huntCursor: HudHuntCursor;
      /** The « Tâches » Client's faults, and its key's generation. */
      fault: HudFault;
    };
  }
}
