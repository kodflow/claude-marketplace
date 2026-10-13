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

/**
 * Only the main loop's own task calls acknowledge a user message: a
 * subagent works for a task the main agent already filed.
 */
export const lowersTriage = (agentId: unknown): boolean =>
  agentId === undefined || agentId === null || agentId === "";

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
