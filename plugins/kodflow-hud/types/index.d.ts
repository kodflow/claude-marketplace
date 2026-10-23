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
  /** What the task is about in full: the tree's detail line. */
  description?: string;
  /** The task it is a subtask of (task_create parent=), by id. */
  parent?: string;
  /** The tasks it waits on (task_create blocked_by=), by id. */
  blockedBy?: string[];
  /** A short handle (T0, C6) the tree shows in place of the id. */
  ref?: string;
};

/** An open epic: one with a task left to do, or the active one still empty. */
export type HudEpic = {
  id: number;
  title: string;
  agent: string;
  /** Opened, in seconds. */
  created: number;
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
  /** Its name, else its type, its description or the head of its id. */
  label: string;
  status: string;
  /** What SendMessage addresses it by, when it has one. */
  name?: string;
  /** The agent type it was spawned as (`subagent_type`), when said. */
  type?: string;
};

/** When one loop last finished a tool call. */
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

/** Who worked a task while it was in progress, kept once it moves on. */
export type HudSeen = { worker?: string; workerId?: string };

export type HudCiState = "pass" | "fail" | "pending" | "none" | "error";

export type HudCi = { state: HudCiState; at: number };

declare module "claude-code" {
  interface PluginState {
    "kodflow-hud": {
      board: HudBoard;
      agents: HudAgent[];
      activity: Record<string, HudActivity>;
      ci: Record<string, HudCi>;
      /** By `<session>:<loop>` (loop "main" or a subagent's id): what it runs on. */
      models: Record<string, HudModel>;
      /** By `<agent>:<task id>`: the worker last seen on the task. */
      seen: Record<string, HudSeen>;
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
