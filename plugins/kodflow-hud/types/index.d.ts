// The values kodflow-hud keeps in `$.state` for the session: what its two
// panes draw from. Every one is derived — the task board from tasks.json
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
  /** "human" for a task waiting on the person, when the field exists. */
  assignee?: string;
  /** Last change, in seconds (tasks.json's own unit). */
  updated: number;
  /** Pull request URLs the subject or description cites. */
  prs: string[];
};

/** An open epic: one with a task left to do, or the active one still empty. */
export type HudEpic = {
  id: number;
  title: string;
  agent: string;
  touched: number;
  tasks: HudTask[];
};

export type HudBoard = {
  /** Whether tasks.json exists for this session. */
  found: boolean;
  epics: HudEpic[];
};

/** An agent of the session as `$.agent.list()` reports it. */
export type HudAgent = {
  id: string;
  label: string;
  status: string;
};

export type HudOp = "read" | "write" | "commit";

export type HudFile = { path: string; op: HudOp; at: number };

/** Where one loop works: its directory, its recent files, its last call. */
export type HudActivity = {
  /** "main", or the subagent's agent id. */
  agentId: string;
  dir?: string;
  /** Newest first. */
  files: HudFile[];
  /** Milliseconds since the epoch. */
  last: number;
};

export type HudCiState = "pass" | "fail" | "pending" | "none" | "error";

export type HudCi = { state: HudCiState; at: number };

declare module "claude-code" {
  interface PluginState {
    "kodflow-hud": {
      board: HudBoard;
      agents: HudAgent[];
      activity: Record<string, HudActivity>;
      ci: Record<string, HudCi>;
      /** `<session>:<task>:<state>` already toasted, so each is toasted once. */
      toasted: string[];
      /**
       * The session whose first board was read: what stood then is no news,
       * so it is recorded as toasted without a toast.
       */
      primed: string;
      /** Advances every few seconds, so the elapsed times redraw. */
      tick: number;
    };
  }
}
