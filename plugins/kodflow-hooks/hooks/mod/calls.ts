// calls.ts — the small decisions register.ts makes on an event. Pure.
import { TOOL_NAMES, type ToolName } from "./tasks.ts";

export const PLUGIN = "kodflow-hooks";
const PREFIX = `mcp__${PLUGIN}__`;

/** The task tool a `tool.call` names, undefined for any other tool. */
export function taskTool(tool: unknown): ToolName | undefined {
  if (typeof tool !== "string" || !tool.startsWith(PREFIX)) return undefined;
  const name = tool.slice(PREFIX.length);
  return (TOOL_NAMES as readonly string[]).includes(name)
    ? (name as ToolName)
    : undefined;
}

// What `tool.call` carries beside the tool's own arguments
const RESERVED = new Set([
  "tool",
  "tool_use_id",
  "agentId",
  "requestMeta",
  "consent",
]);

/** The arguments the model gave, without the envelope. */
export function argsOf(e: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) if (!RESERVED.has(k)) args[k] = v;
  return args;
}

/**
 * The text the engine asks the model to put in a commit or a pull request:
 * none. The other kinds (the exemption, the remedy) are the engine's own
 * sentences about its commit gate and are left as they are.
 */
export function attributionText(kind: unknown): string | undefined {
  return kind === "commit" || kind === "pr" ? "" : undefined;
}

/** KODFLOW_MOD=off: the mod hooks nothing and leaves no marker. */
export const isOff = (value: string | undefined): boolean => value === "off";

/** The main loop's call: no agent id. A subagent's carries its own. */
export const mainLoop = (agentId: unknown): boolean =>
  agentId === undefined || agentId === null || agentId === "";

/**
 * The causes a triage-pending file holds, one per line, in order: `prompt
 * <id>` for each user message not filed yet (on-user.sh, one line per
 * message) and `resume` (a session that came back with open tasks,
 * on-session.sh). An empty file is the format before causes: one prompt.
 */
export function triageCauses(text: string): string[] {
  const causes = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return causes.length ? causes : ["prompt"];
}

// A line's kind: its first word. Anything but resume is a message to file.
const kindOf = (cause: string): "prompt" | "resume" =>
  cause.split(/\s+/)[0] === "resume" ? "resume" : "prompt";

const given = (v: unknown): boolean =>
  typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null;

/**
 * Whether a task call that succeeded settles one cause of the triage gate
 * (alone; once a write was tried, settlesAny settles them all).
 * A user message is settled by a task of its own (task_create,
 * task_assign_human) or by context added to the task in progress
 * (task_update with a description); a resumed session by a status set
 * (task_update with a status). Reading or steering the list (task_list,
 * task_epic, task_focus) settles nothing. Only the main loop: a subagent
 * works for a task the main agent already filed. A cause this version does
 * not know is read as a prompt.
 */
export function liftsTriage(
  tool: ToolName,
  args: Record<string, unknown>,
  agentId: unknown,
  cause: string,
): boolean {
  if (!mainLoop(agentId)) return false;
  if (kindOf(cause) === "resume")
    return tool === "task_update" && given(args.status);
  return (
    tool === "task_create" ||
    tool === "task_assign_human" ||
    (tool === "task_update" && given(args.description))
  );
}

/**
 * The causes left once a call that succeeded is counted: one gesture files
 * one message, so it drops the oldest line of each kind it answers, never
 * two of the same kind. The other messages wait for their own gesture.
 */
export function settleCauses(
  causes: readonly string[],
  tool: ToolName,
  args: Record<string, unknown>,
  agentId: unknown,
): string[] {
  const left = [...causes];
  for (const kind of ["prompt", "resume"] as const) {
    if (!liftsTriage(tool, args, agentId, kind)) continue;
    const at = left.findIndex((c) => kindOf(c) === kind);
    if (at >= 0) left.splice(at, 1);
  }
  return left;
}

/**
 * The triage gate's read list (hooks/scripts/lib/read-tools.txt, the file
 * on-tool.sh reads too): one exact tool name per line, `#` comments, a line
 * ending in `*` a prefix. Unreadable text lists nothing.
 */
export function parseReadList(text: string | undefined): string[] {
  if (typeof text !== "string") return [];
  return text
    .split("\n")
    .map((l) => l.trim())
    // A bare `*` would list every tool: never a prefix (readlist.sh agrees)
    .filter((l) => l && l !== "*" && !l.startsWith("#"));
}

/** Whether a tool is on the read list: by its exact name, or under a `*` prefix. */
export function isReadTool(list: readonly string[], tool: unknown): boolean {
  if (typeof tool !== "string" || !tool) return false;
  return list.some((l) =>
    l.endsWith("*") ? tool.startsWith(l.slice(0, -1)) : l === tool,
  );
}

/**
 * Whether a main-loop call is an attempt to write while the gate is up: a
 * tool off the read list that is not Bash (Bash passes the gate on its own
 * checks and marks nothing). A subagent's never is.
 */
export function triesToWrite(
  list: readonly string[],
  tool: unknown,
  agentId: unknown,
): boolean {
  return mainLoop(agentId) && tool !== "Bash" && !isReadTool(list, tool);
}

/**
 * A task call that settles a cause of the gate, whichever it is: once a
 * write was tried (triage-wrote), the first one settles them all.
 */
export const settlesAny = (
  tool: ToolName,
  args: Record<string, unknown>,
  agentId: unknown,
): boolean =>
  liftsTriage(tool, args, agentId, "prompt") ||
  liftsTriage(tool, args, agentId, "resume");

/** The payload on-mod.sh logs for a task call, shaped like a PostToolUse. */
export function logPayload(
  session: string,
  cwd: string,
  e: Record<string, unknown>,
  answer: { result: string } | { deny: string },
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    hook_event_name: "deny" in answer ? "PostToolUseFailure" : "PostToolUse",
    session_id: session,
    cwd,
    tool_use_id: e.tool_use_id,
    tool_name: e.tool,
    tool_input: argsOf(e),
  };
  if (typeof e.agentId === "string" && e.agentId) base.agent_id = e.agentId;
  if ("deny" in answer) base.error = answer.deny;
  else base.tool_response = { ok: true };
  return base;
}

/** An MCP tool's call (mcp__<server>__<tool>): what the shape probe watches. */
export const isMcpTool = (tool: unknown): tool is string =>
  typeof tool === "string" && /^mcp__/.test(tool);
