# T0 findings — real hook payloads for agent-tier-routing

Recorded with Claude Code 2.1.321, headless (`claude -p`), permission mode `auto`,
a throwaway plugin loaded with `--plugin-dir` (command hooks on SessionStart,
SessionEnd, PreToolUse, PostToolUse Workflow, SubagentStart, SubagentStop, and a
mod on `agent.spawn`, `tool.call`, `session.start`, `classic.SessionStart`).
Nothing was installed; the plugin lived outside the repository and is deleted.
Paths are rewritten (`/config`, `/workspace/probe`), tool_use_ids masked, prompts
are short synthetic strings. Fixtures: `tier-*.jsonl` in this directory, one line
per case with a `case` label.

| # | Question | Observed answer | Fixture |
|---|----------|-----------------|---------|
| 1 | `tool_name` of the Agent tool | Always `"Agent"`. `"Task"` never appeared (Agent, subagent and fork calls alike). Keep `Task` in the judge only as a defensive alias. | tier-pretooluse-agent |
| 2 | `tool_input` shape, no model/effort | `{description, prompt, subagent_type}` only; no key for the missing fields. | tier-pretooluse-agent |
| 3 | model only / effort only / both | `model` and `effort` are plain top-level keys of `tool_input` (`"haiku"`, `"low"`). The tool schema accepts both. | tier-pretooluse-agent |
| 4 | Session `effort` | Top-level `effort: {level}` is the **session** effort (medium, or low under `--effort low`), present with or without a per-call effort. It does not reflect `tool_input.effort`. | tier-pretooluse-agent |
| 5 | fork | `subagent_type: "fork"`; `agent.spawn` has `fork: true`. | tier-pretooluse-agent, tier-agent-spawn |
| 6 | plugin agent | `subagent_type: "kodflow-specialists:developer-executor-shell"`; `agent.spawn.provider.plugin = "kodflow-specialists@kodflow"`, `tier: "user"`. Built-ins have `provider {plugin:"engine", tier:"core"}`. | both |
| 7 | from inside a subagent | PreToolUse carries `agent_id` and `agent_type` (the caller). Main-thread calls have neither. `agent.spawn` carries `parentAgentId`. A general-purpose subagent can call Agent. | tier-pretooluse-agent, tier-agent-spawn |
| 8 | PreToolUse Workflow, inline | `tool_input: {script}`; no `name`/`scriptPath`. | tier-pretooluse-workflow |
| 9 | `scriptPath` | `tool_input: {scriptPath}` only. | same |
| 10 | `name` | `tool_input: {name}` only — **the script is not in the payload** (the registry resolves it later; the script is on disk at `<project>/.claude/workflows/<name>.js` for a project workflow). | same |
| 11 | `resumeFromRunId` | `tool_input: {scriptPath, resumeFromRunId}`. Resume needs the journal of the same session: from another session the tool answers an error ("journal ... not on disk") and nothing runs. A cached replay (script unchanged) runs **no** agent and emits **no** `agent.spawn`. | same |
| 12 | Persisted script path | `<config>/projects/<project-slug>/<session_id>/workflows/scripts/<workflow-name>-<runId>.js` (the project slug is the cwd with `/` and `.` as `-`); returned as `scriptPath` in the launch result. Journal and agent transcripts: `<config>/projects/<slug>/<session_id>/subagents/workflows/<runId>/`. A path whitelist: config project dir + session dir, the project's `.claude/workflows/`, and the scratchpad. | tier-workflow-results |
| 13 | Workflow is asynchronous | The result is `{status:"async_launched", taskId, taskType:"local_workflow", workflowName, runId, summary, transcriptDir, scriptPath}`; the PreToolUse of an inline script is **not** blocked on the run. A PostToolUse command hook exists for it (`tool_response` = same object). | tier-workflow-results |
| 14 | `agent.spawn` for an Agent call | Fields: `tool_use_id, prompt, description, subagentType, provider, model?, parentModel, parentAgentId?, permissionMode, background, fork, name?, resume?`. **No `effort`**, even when the call set `effort: "low"` (the `tool.call` envelope has it). `model` is present only when the call named one. | tier-agent-spawn |
| 15 | Workflow inner `agent()` spawn | `subagentType: "workflow-subagent"` (or the `opts.agentType` value, e.g. `general-purpose`), `model` = `opts.model`, **no effort**, plus `workflow: {runId, agentIndex}` and `background:false`. `opts.effort` is therefore invisible at spawn: it can only be judged from the script. | tier-agent-spawn |
| 16 | SendMessage resume | PreToolUse `SendMessage` (`tool_input: {to: <agentId>, message, summary, ...}`), then `agent.spawn` with `resume: {agentId}`, the original `subagentType`, `background:true`, no model, no effort; SubagentStart fires again with the same `agent_id`. | tier-agent-spawn, tier-pretooluse-agent |
| 17 | Teammate | Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) were not reachable: no TeamCreate tool, `team_name` accepted but ignored. A named agent (`name: "mate1"`) is the only teammate-like shape: `agent.spawn.name`, and `name`/`team_name` in `tool_input`. No `teammate` field exists. | tier-agent-spawn, tier-pretooluse-agent |
| 18 | SessionStart around `/clear` | `claude --resume <id> -p "/clear"`: SessionEnd `reason:"clear"` on the **old** session_id, then SessionStart `source:"clear"` with a **new** session_id. Values seen: `startup`, `resume` (same id as the resumed session, with `context_tokens` etc.), `clear`. `compact` not recorded. | tier-session |
| 19 | SubagentStart of a Workflow inner agent | `agent_type: "workflow-subagent"` (or `general-purpose` when `opts.agentType` was given); `agent_id` set; no model/effort in the payload. Agent-tool subagents carry their `subagent_type` as `agent_type`. | tier-subagent-start |
| 20 | Does a Workflow result `context` reach the model | The tool's own result has no `context` field. A mod `tool.call` handler returning `{...result, context: [text]}` after `next(e)` **does** reach the model (verified with a canary word the model repeated). `context` must be an **array of strings**; a string, and `additionalContext`, are rejected ("wrong shape") and the hook is skipped. Only verified on Workflow, not on Agent. | tier-workflow-results |

## Notes that affect the plan

- The judge for `effort` on an Agent call can read `tool_input.effort` in PreToolUse; the mod's `agent.spawn` can not (no effort), so T4b's `judgeSpawn` can only log `tier-workflow` / `tier-resume` / `tier-teammate` on model, name and `resume`/`workflow` fields. T4b's per-field rule for `agent()` must come from the script text.
- PreToolUse for `Workflow` with `name` or `resumeFromRunId` alone has no script to judge; `name` can be resolved from `.claude/workflows/` or the user registry, which the hook did not expose. This matches the plan's `tier-unjudged`.
- When a PreToolUse command hook denied a call (the recorder shared the session with another plugin's triage gate), the mod `tool.call` still ran and its `tool.result` was an error string; the retry produced a second PreToolUse with a new tool_use_id. Judge counters keyed by tool_use_id are unaffected; counters keyed by call count would double.
- The top-level `effort` of SubagentStart/SubagentStop/SubagentHandback reflects the subagent's resolved effort (low for a `effort:"low"` call), not the session's.

## Not recorded

- Real Agent teams (`TeamCreate`): tool absent in this CLI.
- The `compact` SessionStart source and a `/clear` in an interactive session (headless `/clear` via `--resume` only).
- A `Task` tool name: never emitted.
- Interactive and plan permission modes (all runs in `auto`).
- `context` returned from `tool.call` on an Agent call.
