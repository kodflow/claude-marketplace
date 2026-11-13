// register.ts — kodflow-hooks' function hooks: wiring only.
//
// One `on` per event, each a few lines that read `$` and hand the work to the
// pure modules beside this file (tasks.ts, store.ts, calls.ts, paths.ts).
// The shell scripts keep every hard guard; this module serves the session
// task list as six tools, blanks the attribution text, and beats: it writes
// <config>/kodflow/sessions/<session>/mod-beat before each event it sees, so
// the shell hooks know the task tools exist before they gate on them. After a
// compaction it tells the model again which tasks wait on the user, and it
// serves /lint-setup (lint.ts).
//
// Bash goes through one ordered pipeline (pipeline.ts): the shell's guards
// doubled (guards.ts), the call, then its output compressed (filter.ts).
// Every tool's result then has its secrets masked (veil.ts) before the model
// reads it, and an MCP tool's leaves one line of shape and size, no value, in
// the session directory (mcp-probe.ts).
//
// Tier (tier.ts), before fable on the same events: a Workflow's agent()
// calls must pass the model and the effort their definition does not pin.
// Judged at the tool.call from the script; warn (the default) appends the
// advice to the result's context, enforce refuses before the run, once per
// script. agent.spawn is only logged. Lines go to the session's tier.jsonl.
//
// Gated models (fable.ts): an agent.spawn that would run on one passes only
// with the session's grant in $.store, asked once while the user is at the
// prompt; a /model the user types grants it (classic.PreModelSwitch). The
// hook never writes the model it judged.
//
// Every hook fails open: a throw is caught and the event goes on, except a
// task tool's own call, which answers the failure as text, and a spawn whose
// raw input names a gated model. KODFLOW_MOD=off turns the whole module into
// pass-through, with no marker written.
//
// Cleanup on close (cleanup.ts): the worktrees a subagent writes into are
// noted; a task_update that completes a worker's task or the last task of
// an epic, and a task_focus(close=true), hand them to
// hooks/scripts/cleanup.sh, started without waiting for it.
//
// Triage (calls.ts): the first tool.call hook, the outermost, notes a write
// tried by the main loop while the gate is up (<session>/triage-wrote),
// before the call runs, so a refusal, an error or a cancel counts; the
// Stop reminder waits for that mark, and the first task call that settles
// a cause after it settles them all.
import type { Register } from "claude-code";
import {
  TOOLS,
  MAIN,
  humanContext,
  isTaskError,
  plan,
  resolveWorkers,
  type ToolName,
} from "./tasks.ts";
import { load, lock, mutate, unique, unlock, type Port } from "./store.ts";
import { LINT_SETUP, lintSetup, type LintPort } from "./lint.ts";
import {
  argsOf,
  attributionText,
  isMcpTool,
  isOff,
  logPayload,
  mainLoop,
  parseReadList,
  settleCauses,
  settlesAny,
  taskTool,
  triageCauses,
  triesToWrite,
} from "./calls.ts";
import {
  agentsFile,
  beatFile,
  beatText,
  composerFile,
  configDir,
  safe,
  sessionDir,
  triageFile,
  wroteFile,
} from "./paths.ts";
import {
  admit,
  endGuards,
  guardWrite,
  lastComposerAt,
  notePrompt,
  modsReport,
  startGuards,
  type GuardPort,
} from "./machine-guards.ts";
import {
  forgeMcpJson,
  inspect,
  refusalText,
  verdict,
  type GuardCtx,
} from "./guards.ts";
import { loadRules, type Rules } from "./patterns.ts";
import { filterResult } from "./filter.ts";
import { veilResult } from "./veil.ts";
import { appendArgv, shapeLine, shapeOf, shapesFile } from "./mcp-probe.ts";
import { runBash } from "./pipeline.ts";
import {
  WRITING_TOOLS,
  claim,
  closingOf,
  closingOfEpic,
  note,
  worktreePaths,
  type Closing,
} from "./cleanup.ts";
import {
  anyGated,
  gateMode,
  grantKey,
  failClosedTokens,
  forced,
  judgeSkill,
  judgeSpawn,
  skillPaths,
  judgeSwitch,
  isGated,
  parseGated,
  refusal as fableRefusal,
  definitionPaths,
  type SpawnPort,
} from "./fable.ts";
import {
  advice,
  breakerKey,
  journalArgv,
  journalFile,
  journalText,
  isoNow,
  sourceText,
  judgeSpawn as tierSpawn,
  judgeWorkflowScript,
  parseTable,
  resolveMode,
  scriptRoots,
  workflowSource,
  type JournalLine,
  type ModeSource,
  type SourcePort,
  type TierMode,
} from "./tier.ts";

// Set once every tool registered; the beat is a promise that they did.
let toolsReady = false;

// The gated-model question is only put to someone who is there: a message
// typed at the prompt in the last 10 minutes, as machine-guards.ts records it
// (notePrompt, in prompt.submit).
const PRESENCE_MS = 10 * 60_000;
const present = () => {
  const at = lastComposerAt();
  return at !== undefined && Date.now() - at <= PRESENCE_MS;
};

// Read once a session: the credential variables' values.
let secrets: Promise<string[]> | undefined;
// The vendored §5 rules; a failed read stays undefined and is tried again.
let rules: Rules | undefined;

const off = async ($: any): Promise<boolean> =>
  isOff(await $.env.get("KODFLOW_MOD"));

async function config($: any): Promise<string | undefined> {
  return configDir(
    await $.env.get("CLAUDE_CONFIG_DIR"),
    await $.env.get("HOME"),
  );
}

async function ensureTools($: any): Promise<void> {
  if (toolsReady) return;
  for (const tool of TOOLS)
    await $.tool.register({ ...tool, isDeferred: false });
  toolsReady = true;
}

// `early`: the settings hooks' SessionStart runs before the session binds,
// when `$.tool.register` still rejects; session.start registers the tools
// before the first prompt. The beat there says the mod is loaded. Should the
// registration then fail, no beat follows, and the first prompt finds it
// stale and lifts whatever the SessionStart hook raised.
async function beat($: any, session?: string, early = false): Promise<void> {
  if (!toolsReady && !early) return;
  const cfg = await config($);
  if (!cfg) return;
  const dir = sessionDir(cfg, session || (await $.session.id()));
  await $.fs.write(beatFile(dir), beatText(Date.now()));
}

// The user's open tasks, read fresh, for the context a compaction lost
async function humanAfterCompact(
  $: any,
  session: string,
): Promise<string | undefined> {
  const cfg = await config($);
  if (!cfg) return undefined;
  return humanContext(
    await load(port($), sessionDir(cfg, session), Math.floor(Date.now() / 1000)),
  );
}

async function lintPort($: any): Promise<LintPort> {
  return {
    exists: (path) => $.fs.exists(path).catch(() => false),
    isDir: (path) =>
      $.fs.stat(path).then(
        (s: { kind: string }) => s.kind === "directory",
        () => false,
      ),
    read: (path) =>
      $.fs.read(path).then(
        (t: string) => t,
        () => undefined,
      ),
    run: (argv, timeoutMs) =>
      $.process.run(argv, { timeoutMs }).catch(() => undefined),
    ask: (question, options) =>
      $.ui.ask(question, options).catch(() => undefined),
    vars: {
      KTN_USER_DAEMON: await $.env.get("KTN_USER_DAEMON"),
    },
    sleep: (ms) => $.clock.sleep(ms),
    root: await $.session.root(),
  };
}

function port($: any): Port {
  return {
    read: (path) =>
      $.fs.read(path).then(
        (t: string) => t,
        () => undefined,
      ),
    write: (path, text) => $.fs.write(path, text),
    run: (argv) => $.process.run(argv, { timeoutMs: 5000 }),
    mtime: (path) =>
      $.fs.stat(path).then(
        (s: { mtimeMs: number }) => s.mtimeMs,
        () => undefined,
      ),
    sleep: (ms) => $.clock.sleep(ms),
    now: () => Date.now(),
  };
}

async function serve(
  $: any,
  tool: ToolName,
  e: any,
): Promise<{ result: string } | { deny: string }> {
  const cfg = await config($);
  if (!cfg)
    return {
      deny: "kodflow task tools: no absolute CLAUDE_CONFIG_DIR or HOME to keep the list in",
    };
  const session = await $.session.id();
  const dir = sessionDir(cfg, session);
  const io = port($);
  const agent = e.agentId ? safe(e.agentId) : MAIN;
  const nowSec = () => Math.floor(Date.now() / 1000);
  let answer: { result: string } | { deny: string };
  let closing: Closing | undefined;
  try {
    const step = plan(tool, agent, argsOf(e));
    // The main agent completing a task or closing an epic: the list before
    // the change is kept, since the update drops the task's worker link
    const closingEpic = tool === "task_focus" && agent === MAIN;
    const completing =
      (tool === "task_update" &&
        agent === MAIN &&
        argsOf(e).status === "completed") ||
      closingEpic;
    let workers: ReturnType<typeof resolveWorkers> = [];
    if (tool === "task_update" || tool === "task_focus") {
      const listed = await $.agent.list().catch(() => undefined);
      workers = resolveWorkers(
        listed,
        await io.read(agentsFile(dir)),
        nowSec(),
      );
    }
    const text = step.mutates
      ? await mutate(io, dir, (data) => {
          const before = completing ? JSON.parse(JSON.stringify(data)) : undefined;
          const out = step.run(data, { now: nowSec(), workers });
          if (before)
            closing = closingEpic
              ? closingOfEpic(before, data)
              : closingOf(before, data, argsOf(e).id);
          return out;
        })
      : step.run(await load(io, dir, nowSec()), { now: nowSec(), workers });
    answer = { result: text };
  } catch (err) {
    if (!isTaskError(err)) {
      // Fail open: the store or the host failed, and a gate the task tools
      // cannot settle would stop the session
      if (mainLoop(e.agentId))
        await io
          .run(["rm", "-f", triageFile(dir), wroteFile(dir)])
          .catch(() => undefined);
      throw err;
    }
    answer = { deny: err.message };
  }
  // A refusal leaves the gate as it was; a call that succeeded settles the
  // causes it answers. Never at the cost of the answer of an applied change.
  if ("result" in answer)
    await settleTriage(io, dir, tool, argsOf(e), e.agentId).catch(
      () => undefined,
    );
  // Started, never awaited: gh and git push reach the network, and the
  // answer to the task call does not wait on them
  if ("result" in answer && closing) void cleanupAfter($, dir, closing);
  // One line in .claude/logs/<branch>/session.jsonl, through lib/event.jq
  const payload = logPayload(session, await $.session.root(), e, answer);
  await $.process
    .run(["bash", `${$.plugin.root}/hooks/scripts/on-mod.sh`], {
      stdin: JSON.stringify(payload),
      timeoutMs: 3000,
    })
    .catch(() => undefined);
  return answer;
}

// One line of structure and size for an MCP tool's result, in the session's
// mcp-shapes.jsonl (mcp-probe.ts); KODFLOW_MCP_PROBE=off: nothing. The line
// is built from the answer's shape only, and every failure is swallowed:
// the result goes to the model as it is.
async function probeMcp($: any, tool: string, answer: unknown): Promise<void> {
  try {
    if (isOff(await $.env.get("KODFLOW_MCP_PROBE"))) return;
    const cfg = await config($);
    if (!cfg) return;
    const dir = sessionDir(cfg, await $.session.id());
    await $.process.run(appendArgv(shapesFile(dir)), {
      stdin: shapeLine(shapeOf(tool, answer, Date.now())),
      timeoutMs: 3000,
    });
  } catch {
    // fail open
  }
}

// The worktrees of the workers a completion closes, to cleanup.sh, which
// removes only what is merged, published and clean (KODFLOW_CLEANUP=off:
// nothing). Every failure is swallowed: the task call has already answered.
async function cleanupAfter($: any, dir: string, closing: Closing): Promise<void> {
  try {
    if (isOff(await $.env.get("KODFLOW_CLEANUP"))) return;
    const io = port($);
    const paths = await claim(io, dir, closing, await io.read(agentsFile(dir)));
    if (!paths.length) return;
    await $.process.run(
      ["bash", `${$.plugin.root}/hooks/scripts/cleanup.sh`, dir, ...paths],
      { timeoutMs: 300_000 },
    );
  } catch {
    // fail open
  }
}

// The worktrees a subagent writes into, noted once per path and session
const noted = new Set<string>();
async function noteWorktrees($: any, e: any): Promise<void> {
  try {
    const text =
      typeof e.command === "string" ? e.command : JSON.stringify(argsOf(e));
    const paths = worktreePaths(text.slice(0, 20_000), await $.env.get("HOME"));
    if (!paths.length) return;
    const cfg = await config($);
    if (!cfg) return;
    const dir = sessionDir(cfg, await $.session.id());
    const fresh = paths.filter((p) => !noted.has(`${dir}\t${e.agentId}\t${p}`));
    if (!fresh.length) return;
    await note(port($), dir, String(e.agentId), fresh);
    for (const p of fresh) noted.add(`${dir}\t${e.agentId}\t${p}`);
  } catch {
    // fail open
  }
}

// Drop from triage-pending the causes this call settled: the file goes with
// the last one, the others stay for their own gesture; once a write was
// tried (triage-wrote), a call that settles any cause settles them all and
// the mark goes with them. Under the lock the
// shell takes to append a cause (on-user.sh, on-session.sh), so a message
// that arrives meanwhile is never lost; replaced through a temporary file
// and `mv`, so the gate never reads half a list. A lock not obtained in time
// is written through, as lib/lock.sh's callers do.
async function settleTriage(
  io: Port,
  dir: string,
  tool: ToolName,
  args: Record<string, unknown>,
  agentId: unknown,
): Promise<void> {
  if (!mainLoop(agentId)) return;
  const file = triageFile(dir);
  // Most calls find no gate, or answer none of its causes: no lock for them
  const seen = await io.read(file);
  if (seen === undefined) return;
  const before = triageCauses(seen);
  const wrote = await io.read(wroteFile(dir));
  const all = wrote !== undefined && settlesAny(tool, args, agentId);
  if (!all && settleCauses(before, tool, args, agentId).length === before.length) return;
  const lockDir = `${dir}/.triage.lock.d`;
  const held = await lock(io, lockDir);
  try {
    const text = await io.read(file);
    if (text === undefined) return;
    const causes = triageCauses(text);
    const left = all ? [] : settleCauses(causes, tool, args, agentId);
    if (left.length === causes.length) return;
    if (left.length === 0) {
      await io.run(["rm", "-f", file, wroteFile(dir)]);
      return;
    }
    const tmp = `${dir}/.triage.${unique()}.tmp`;
    await io.write(tmp, `${left.join("\n")}\n`);
    if ((await io.run(["mv", "-f", tmp, file])).exitCode !== 0)
      await io.run(["rm", "-f", tmp]);
  } finally {
    if (held) await unlock(io, lockDir);
  }
}

// The read list, as the shell reads it; read again after a failed read
let readList: string[] | undefined;

// A write tried by the main loop while the triage gate is up: mark it before
// the call runs (on-stop.sh says the reminder only then). Fails open.
async function markWrite($: any, e: any): Promise<void> {
  if (!mainLoop(e.agentId) || e.tool === "Bash" || taskTool(e.tool)) return;
  if (await off($)) return;
  // KODFLOW_TRIAGE=off: no gate, no reminder, nothing to mark
  if (isOff(await $.env.get("KODFLOW_TRIAGE"))) return;
  if (!readList) {
    const text = await $.fs
      .read(`${$.plugin.root}/hooks/scripts/lib/read-tools.txt`)
      .catch(() => undefined);
    if (text !== undefined) readList = parseReadList(text);
  }
  if (!triesToWrite(readList ?? [], e.tool, e.agentId)) return;
  const cfg = await config($);
  if (!cfg) return;
  const dir = sessionDir(cfg, await $.session.id());
  if (!(await $.fs.exists(triageFile(dir)).catch(() => false))) return;
  await $.fs.write(wroteFile(dir), beatText(Date.now()));
}

// modwall, collision-guard and zsh-safe (machine-guards.ts) reach `$` through this
function guardPort($: any): GuardPort {
  return {
    off: () => off($),
    config: () => config($),
    read: (path) =>
      $.fs.read(path).then(
        (t: string) => t,
        () => undefined,
      ),
    write: (path, text) => $.fs.write(path, text),
    list: (path) => $.fs.list(path),
    session: () => $.session.id(),
    cwd: () => $.session.cwd(),
    ask: (question, options) =>
      $.ui.ask(question, { options, header: "Collision" }),
    storeGet: (key) => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    log: (text) => $.ui.log(text, { to: "debug" }),
    toast: (text) => $.ui.toast(text, { timeoutMs: 8000 }),
    registerMods: (description) =>
      $.command.register({ name: "kodflow-mods", description }),
    zdotdir: () => $.env.get("ZDOTDIR"),
    userZdotdir: () => $.env.get("KODFLOW_USER_ZDOTDIR"),
    setZdotdir: (value) => $.env.set("ZDOTDIR", value),
    setUserZdotdir: (value) => $.env.set("KODFLOW_USER_ZDOTDIR", value),
    pluginRoot: $.plugin.root,
    now: () => Date.now(),
  };
}

// One line in .claude/logs/<branch>/session.jsonl for a policy's decision.
function journal(
  $: any,
  e: any,
  policy: string,
  decision: string,
  error?: unknown,
): void {
  void (async () => {
    const payload: Record<string, unknown> = {
      hook_event_name: "ModPolicy",
      session_id: await $.session.id(),
      cwd: await $.session.cwd(),
      tool_use_id: e.tool_use_id,
      tool_name: e.tool,
      tool_input: typeof e.command === "string" ? { command: e.command } : {},
      reason: `${policy}:${decision}`,
    };
    if (e.agentId) payload.agent_id = e.agentId;
    if (error !== undefined)
      payload.error = String((error as Error)?.message ?? error);
    await $.process.run(
      ["bash", `${$.plugin.root}/hooks/scripts/on-mod.sh`],
      { stdin: JSON.stringify(payload), timeoutMs: 3000 },
    );
  })().catch(() => undefined);
}

// The credential variables' values. $.env.get takes literal names only (the
// engine lists what a module reads), so veil.ts's SECRET_VARS is spelled out
// here, and tests/mod/pipeline.test.ts holds the two lists equal.
async function secretValues($: any): Promise<string[]> {
  const values: (string | undefined)[] = await Promise.all([
    $.env.get("ANTHROPIC_API_KEY"),
    $.env.get("ANTHROPIC_AUTH_TOKEN"),
    $.env.get("CLAUDE_CODE_OAUTH_TOKEN"),
    $.env.get("OPENAI_API_KEY"),
    $.env.get("GITHUB_TOKEN"),
    $.env.get("GH_TOKEN"),
    $.env.get("GH_ENTERPRISE_TOKEN"),
    $.env.get("GITLAB_TOKEN"),
    $.env.get("GL_TOKEN"),
    $.env.get("CI_JOB_TOKEN"),
    $.env.get("NPM_TOKEN"),
    $.env.get("NODE_AUTH_TOKEN"),
    $.env.get("AWS_SECRET_ACCESS_KEY"),
    $.env.get("AWS_SESSION_TOKEN"),
    $.env.get("OP_SERVICE_ACCOUNT_TOKEN"),
    $.env.get("OP_CONNECT_TOKEN"),
    $.env.get("VAULT_TOKEN"),
    $.env.get("NOMAD_TOKEN"),
    $.env.get("CONSUL_HTTP_TOKEN"),
    $.env.get("CLOUDFLARE_API_TOKEN"),
    $.env.get("CF_API_TOKEN"),
    $.env.get("SLACK_TOKEN"),
    $.env.get("SLACK_BOT_TOKEN"),
    $.env.get("DOCKER_PASSWORD"),
    $.env.get("HF_TOKEN"),
    $.env.get("GOOGLE_API_KEY"),
    $.env.get("SENTRY_AUTH_TOKEN"),
    $.env.get("DATABASE_URL"),
  ]);
  return values.filter((v): v is string => !!v);
}

async function projectDir($: any): Promise<string> {
  return (await $.env.get("CLAUDE_PROJECT_DIR")) || (await $.session.cwd());
}

async function guardCtx(
  $: any,
  e: any,
  patterns: () => Promise<Rules | undefined>,
): Promise<GuardCtx> {
  const dir = await projectDir($);
  const cfg = await config($);
  const agentId = e.agentId || undefined;
  return {
    agentId,
    rootMain: !agentId && (await $.env.get("KODFLOW_ROOT")) !== "off",
    projectDir: dir,
    home: await $.env.get("HOME"),
    configDir: cfg,
    read: (path) =>
      $.fs
        .read(path.startsWith("/") ? path : `${dir}/${path}`)
        .catch(() => undefined),
    git: async (gdir, args) => {
      const r = await $.process
        .run(["git", "-C", gdir, ...args], { timeoutMs: 5000 })
        .catch(() => undefined);
      return r && r.exitCode === 0 ? r.stdout : undefined;
    },
    patterns,
  };
}

// The gated list as this copy of the plugin ships it (hooks/gated-models.txt)
const gatedText = ($: any): Promise<string | undefined> =>
  $.fs.read(`${$.plugin.root}/hooks/gated-models.txt`).catch(() => undefined);

// Who gave the session its grant, and when; the key is the session's. Only
// $.store holds it: a file under the session directory could be written by
// any tool call, so the shell never reads a grant and refuses without the mod.
async function grantSession($: any, session: string, by: string): Promise<void> {
  await $.store.set(grantKey(session), { at: Math.floor(Date.now() / 1000), by });
}

// One spawn judged at a time: two parallel dispatches on a gated model put
// one question to the user, and the second reads the grant the first wrote.
let judging: Promise<unknown> = Promise.resolve();

// What agent.spawn's judge reaches; every raw value it reads is kept in `raw`
// so that a throw can still refuse a spawn naming a gated model.
async function spawnPort($: any, raw: unknown[]): Promise<SpawnPort & { skillFile: (s: string) => Promise<string | undefined> }> {
  const session = await $.session.id();
  return {
    gated: () => gatedText($),
    mode: async () => gateMode(await $.env.get("KODFLOW_FABLE")),
    // The same lookup as the tier rule's: both judge one file per agentType
    definition: async (type) => {
      const text = await definitionText($, type);
      if (text !== undefined) raw.push(text.slice(0, 4000));
      return text;
    },
    envModel: async () => {
      const v = await $.env.get("CLAUDE_CODE_SUBAGENT_MODEL");
      raw.push(v);
      return v || undefined;
    },
    envForce: async () => forced(await $.env.get("CLAUDE_CODE_SUBAGENT_MODEL_FORCE")),
    granted: async () => !!(await $.store.get(grantKey(session))),
    skillFile: async (skill: string) => {
      const cfg = await config($);
      if (!cfg) return undefined;
      const installed = await $.fs
        .read(`${cfg}/plugins/installed_plugins.json`)
        .catch(() => undefined);
      for (const path of skillPaths(skill, { project: await projectDir($).catch(() => undefined), config: cfg, installed })) {
        const text = await $.fs.read(path).catch(() => undefined);
        if (text !== undefined) {
          raw.push(text.slice(0, 4000));
          return text;
        }
      }
      return undefined;
    },
    grant: () => grantSession($, session, "asked at a spawn"),
    present,
    ask: (question, options) => $.ui.ask(question, { options, header: "Gated model" }),
  };
}

// The text of an agent definition, by fable's resolution order
async function definitionText($: any, type: string): Promise<string | undefined> {
  const cfg = await config($);
  if (!cfg) return undefined;
  const installed = await $.fs.read(`${cfg}/plugins/installed_plugins.json`).catch(() => undefined);
  for (const path of definitionPaths(type, {
    project: await projectDir($).catch(() => undefined),
    config: cfg,
    installed,
  })) {
    const text = await $.fs.read(path).catch(() => undefined);
    if (text !== undefined) return text;
  }
  return undefined;
}

type TierCtx = {
  cfg: string;
  session: string;
  dir: string;
  /** the source as the shell journals it: a file by its path */
  mode: { mode: TierMode; source: string };
};

// The tier mode, as the shell reads it (tier.ts resolveMode)
async function tierCtx($: any): Promise<TierCtx | undefined> {
  const cfg = await config($);
  if (!cfg) return undefined;
  const session = String(await $.session.id());
  const dir = sessionDir(cfg, session);
  const read = (path: string) => $.fs.read(path).catch(() => undefined);
  const mode = resolveMode({
    env: await $.env.get("KODFLOW_TIER"),
    session: await read(`${dir}/tier-mode`),
    global: await read(`${cfg}/kodflow/tier-mode`),
    skew: await $.fs.exists(`${dir}/tier-skew`).catch(() => false),
  });
  return { cfg, session, dir, mode: { mode: mode.mode, source: sourceText(mode.source as ModeSource, dir, cfg) } };
}

// Appended, never rewritten: $.fs.write would overwrite the shell's lines
async function tierJournal($: any, dir: string, lines: JournalLine[]): Promise<void> {
  if (!lines.length) return;
  await $.process
    .run(journalArgv(dir, journalFile(dir)), { stdin: journalText(lines), timeoutMs: 3000 })
    .catch(() => undefined);
}

// Where a scriptPath may be read: its real path, inside the session's
// projects/ directory, the project, or the scratchpad
async function tierSources($: any, ctx: TierCtx): Promise<SourcePort> {
  const cwd = String(await $.session.cwd());
  const project = await projectDir($).catch(() => undefined);
  const stat = async (path: string) => {
    // `resolve` is not in the reference: realPath, when the host gives it,
    // is checked too; without it the spelling of the path alone decides
    const s = await $.fs.stat(path, { resolve: true }).catch(() => undefined);
    if (!s) return undefined;
    if (s.isLink && typeof s.realPath !== "string") return undefined;
    return {
      real: typeof s.realPath === "string" ? s.realPath : undefined,
      size: Number(s.size ?? 0),
      file: s.kind === "file",
    };
  };
  const roots = scriptRoots({ config: ctx.cfg, cwd, project, session: ctx.session });
  // A root behind a symlink (/tmp, a linked config) is compared by its real path
  for (const r of [...roots]) {
    if (typeof r !== "string") continue;
    const real = (await stat(r.replace(/\/$/, "")))?.real;
    if (real && !roots.includes(`${real}/`)) roots.push(`${real}/`);
  }
  return {
    stat,
    read: (path: string) => $.fs.read(path).catch(() => undefined),
    roots,
    session: ctx.session,
  };
}

// Tier at a spawn: never a refusal; a Workflow agent, a resume, a named
// agent leave one line. Started, not awaited, and every failure swallowed.
function noteTierSpawn($: any, e: any): void {
  void (async () => {
    if (await off($)) return;
    const note = tierSpawn(e);
    if (!note) return;
    const ctx = await tierCtx($);
    if (!ctx || ctx.mode.mode === "off") return;
    await tierJournal($, ctx.dir, [
      {
        ts: isoNow(Date.now()),
        source: "mod",
        mode: ctx.mode.mode,
        mode_source: ctx.mode.source,
        would_refuse: false,
        action: "pass",
        reason: note.reason,
        subagent_type: note.subagent_type,
        caller: e.parentAgentId ? String(e.parentAgentId) : "main",
        has_model: note.has_model,
        has_effort: false,
        pinned_model: note.model ? `call:${note.model}` : "",
        pinned_effort: "",
        tool_use_id: String(e.tool_use_id ?? ""),
      },
    ]);
  })().catch(() => undefined);
}

export const register: Register = (on) => {
  // The one tool.call without a matcher, registered first so it is the
  // outermost: the triage mark is written before any inner hook (tier,
  // fable, the guards) or the shell's PreToolUse can refuse, fail or cancel
  // the call
  on("tool.call", async ($, e, next) => {
    if (await off($)) return next(e);
    await markWrite($, e).catch(() => undefined);
    const tool = taskTool(e.tool);
    // Before next: the shell's PreToolUse runs inside it and reads the beat
    await beat($).catch(() => undefined);
    if (tool) return serve($, tool, e);
    if (e.agentId && WRITING_TOOLS.has(e.tool)) void noteWorktrees($, e);
    // A forge tool writing an mcp.json: refused for every caller, as the
    // shell does; doubled, so a failure lets the call on to the shell
    if (/^mcp__(github|gitlab|GitKraken)__/.test(e.tool)) {
      try {
        const mj = await forgeMcpJson(
          e.tool,
          argsOf(e as any) ?? {},
          await guardCtx($, e, async () => rules),
        );
        if (mj) {
          journal($, e, "mcp-json", "deny");
          return { deny: refusalText(mj) };
        }
      } catch (err) {
        journal($, e, "mcp-json", "error", err);
      }
    }
    const r: any = await next(e);
    let out = r;
    try {
      secrets ??= secretValues($);
      const veiled = veilResult(r, { envValues: await secrets, now: Date.now });
      if (veiled !== r) journal($, e, "veil", "masked");
      out = veiled;
    } catch (err) {
      journal($, e, "veil", "error", err);
    }
    if (isMcpTool(e.tool)) await probeMcp($, e.tool, out);
    return out;
  }).catch(($, e, next) => {
    if (next.called) return next(e);
    if (taskTool(e.tool))
      return {
        deny: `kodflow task tools failed: ${next.error.message ?? next.error.kind}`,
      };
    return next(e);
  });

  on("session.start", async ($, e, next) => {
    if (!(await off($))) {
      await ensureTools($);
      await $.command.register({
        name: "lint-setup",
        description: LINT_SETUP.description,
        argumentHint: LINT_SETUP.argumentHint,
      });
    }
    await startGuards(guardPort($)).catch(() => undefined);
    return next(e);
  });

  on("classic.SessionStart", async ($, e, next) => {
    if (await off($)) return next(e);
    await ensureTools($).catch(() => undefined);
    await beat($, e.session_id, true);
    const r = await next(e);
    if (e.source !== "compact") return r;
    const text = await humanAfterCompact($, e.session_id).catch(() => undefined);
    return text
      ? { ...r, additionalContext: [...(r.additionalContext ?? []), text] }
      : r;
  }).catch(($, e, next) => next(e));

  on("prompt.submit", async ($, e, next) => {
    notePrompt(e.origin, Date.now());
    if (!(await off($))) {
      await ensureTools($);
      await beat($);
      if ((e.origin as { kind?: unknown } | undefined)?.kind === "composer") {
        const cfg = await config($);
        if (cfg)
          await $.fs
            .write(composerFile(sessionDir(cfg, await $.session.id())), beatText(Date.now()))
            .catch(() => undefined);
      }
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  // Tier: a Workflow's agent() judged from the script, before the run
  on("tool.call", { tool: "Workflow" }, async ($, e, next) => {
    if (await off($)) return next(e);
    const ctx = await tierCtx($);
    if (!ctx || ctx.mode.mode === "off") return next(e);
    const base = {
      ts: isoNow(Date.now()),
      source: "mod" as const,
      mode: ctx.mode.mode,
      mode_source: ctx.mode.source,
      subagent_type: "workflow",
      caller: e.agentId ? String(e.agentId) : "main",
      tool_use_id: String(e.tool_use_id ?? ""),
    };
    const unjudged = (reason: string, why: string): JournalLine => ({
      ...base,
      would_refuse: false,
      action: "pass",
      reason,
      why,
      has_model: false,
      has_effort: false,
      pinned_model: "",
      pinned_effort: "",
    });
    const src = await workflowSource(argsOf(e as any), await tierSources($, ctx));
    if (src.kind === "pass") {
      await tierJournal($, ctx.dir, [unjudged(src.reason, src.why)]);
      return next(e);
    }
    const table = parseTable(await $.fs.read(`${$.plugin.root}/hooks/tier-table.tsv`).catch(() => undefined));
    const v = await judgeWorkflowScript(src.text, {
      definition: (type) => definitionText($, type),
      envModel: await $.env.get("CLAUDE_CODE_SUBAGENT_MODEL"),
      envForce: forced(await $.env.get("CLAUDE_CODE_SUBAGENT_MODEL_FORCE")),
      envEffort: await $.env.get("CLAUDE_CODE_EFFORT_LEVEL"),
      table,
    });
    if (v.kind === "pass") {
      await tierJournal($, ctx.dir, [unjudged(v.reason, v.why)]);
      return next(e);
    }
    let action: JournalLine["action"] = v.missing.length ? (ctx.mode.mode === "enforce" ? "refuse" : "warn") : "pass";
    let breaker = false;
    const key = await breakerKey(ctx.session, src.text);
    if (action === "refuse" && (await $.store.get(key))) {
      action = "warn";
      breaker = true;
    }
    const lines: JournalLine[] = v.calls.map((c) => ({
      ...base,
      subagent_type: c.agentType ?? "workflow-subagent",
      index: c.index,
      would_refuse: c.missing.length > 0,
      action: c.missing.length ? action : "pass",
      reason: c.missing.length && breaker ? "tier-breaker" : c.reason,
      has_model: c.has_model,
      has_effort: c.has_effort,
      pinned_model: c.pinned_model,
      pinned_effort: c.pinned_effort,
    }));
    await tierJournal($, ctx.dir, lines);
    if (!v.missing.length) return next(e);
    const text = advice(v.missing, table, ctx.mode, ctx.dir);
    if (action === "refuse") {
      await $.store.set(key, { at: base.ts });
      journal($, e, "tier", "deny");
      return { deny: text };
    }
    const r: any = await next(e);
    const context = Array.isArray(r?.context) ? r.context : [];
    return { ...r, context: [...context, text] };
  }).catch(($, e, next) => next(e));

  // One handler a spawn (the engine takes one per event without a matcher):
  // tier first, logged only, then the gated-model rule, which passes or
  // refuses and never writes a model
  on("agent.spawn", async ($, e, next) => {
    try {
      noteTierSpawn($, e);
    } catch {
      // tier fails open
    }
    const raw: unknown[] = [e.model, e.parentModel];
    const at = { tool: "Agent", tool_use_id: e.tool_use_id, agentId: e.parentAgentId };
    let verdict;
    try {
      if (await off($)) return next(e);
      // Read before anything that can fail: a throw later still knows a
      // gated CLAUDE_CODE_SUBAGENT_MODEL was there
      raw.push(await $.env.get("CLAUDE_CODE_SUBAGENT_MODEL"));
      const run = judging.then(async () => judgeSpawn(e, await spawnPort($, raw)));
      judging = run.catch(() => undefined);
      verdict = await run;
    } catch (err) {
      const tokens = failClosedTokens(await gatedText($));
      const named = raw.find((r) => typeof r === "string" && isGated(r, tokens));
      if (anyGated(raw, tokens)) {
        const deny = fableRefusal(String(named), "the check failed");
        journal($, at, "fable", "error-refused", err);
        return { deny };
      }
      journal($, at, "fable", "error-passed", err);
      await $.ui
        .toast("kodflow-hooks: the gated-model check failed on a spawn naming no gated model; it went on", {
          timeoutMs: 8000,
        })
        .catch(() => undefined);
      return next(e);
    }
    const denied =
      verdict.kind === "refuse" ? fableRefusal(verdict.model, verdict.why) : undefined;
    journal($, at, "fable", `${verdict.kind}: ${verdict.why}`);
    if (denied) return { deny: denied };
    return next(e);
  }).catch(($, e, next) => next(e));

  // A skill pinned to a gated model would switch the main conversation to it
  on("tool.call", { tool: "Skill" }, async ($, e, next) => {
    const raw: unknown[] = [];
    const skill = String((argsOf(e as any) as any)?.skill ?? "").replace(/^\//, "");
    const at = { tool: "Skill", tool_use_id: e.tool_use_id, agentId: e.agentId };
    let verdict;
    try {
      if (await off($) || !skill) return next(e);
      const run = judging.then(async () => judgeSkill(skill, await spawnPort($, raw)));
      judging = run.catch(() => undefined);
      verdict = await run;
    } catch (err) {
      if (anyGated(raw, failClosedTokens(await gatedText($)))) {
        const deny = fableRefusal(skill, "the check failed");
        journal($, at, "fable", "error-refused", err);
        return { deny };
      }
      journal($, at, "fable", "error-passed", err);
      return next(e);
    }
    if (verdict.kind === "refuse") {
      const deny = fableRefusal(verdict.model, verdict.why);
      journal($, at, "fable", `refuse: ${verdict.why}`);
      return { deny };
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  // A /model the user types, or the picker, is the consent (D5); a switch from
  // the SDK asks like a spawn, and is refused with nobody at the prompt
  on("classic.PreModelSwitch", async ($, e, next) => {
    const r = await next(e);
    try {
      if (await off($) || r.permissionDecision === "deny") return r;
      const session = await $.session.id();
      const v = judgeSwitch(e, parseGated(await gatedText($)), gateMode(await $.env.get("KODFLOW_FABLE")));
      const at = { tool: "PreModelSwitch", tool_use_id: e.prompt_id };
      if (v.kind === "grant") await grantSession($, session, v.why);
      let deny: string | undefined;
      if (v.kind === "ask" && !(await $.store.get(grantKey(session)))) {
        let answer = "nobody at the prompt";
        if (present()) {
          answer = await $.ui
            .ask(`Switch this session to ${e.to_model}, a gated model (${v.why})?`, {
              options: ["Switch", "Stay"],
              header: "Gated model",
            })
            .catch(() => "dismissed");
        }
        if (answer === "Switch") await grantSession($, session, `asked at a ${v.why}`);
        else deny = fableRefusal(String(e.to_model), `${v.why}; ${answer}`);
      }
      journal($, at, "fable", deny ? `refuse: ${v.why}` : `${v.kind}: ${v.why}`);
      return deny ? { ...r, permissionDecision: "deny", permissionDecisionReason: deny } : r;
    } catch (err) {
      // After next(e): answer from r, never call next again. A gated target
      // from anywhere but the user's own /model is refused.
      const gated = isGated(e.to_model, failClosedTokens(await gatedText($)));
      if (!gated || e.source === "command" || e.source === "picker") return r;
      return { ...r, permissionDecision: "deny", permissionDecisionReason: fableRefusal(String(e.to_model), `the check failed: ${String((err as Error)?.message ?? err)}`) };
    }
  }).catch(($, e, next) => next(e));

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (await off($)) return next(e);
    const line = typeof e.command === "string" ? e.command : "";
    return runBash(() => next(e), {
      guards: async () => {
        rules ??= await loadRules(
          (path) => $.fs.read(path),
          `${$.plugin.root}/hooks/patterns`,
        );
        const ctx = await guardCtx($, e, async () => rules);
        const found = await inspect(line, ctx);
        const refusal = found && (await verdict(line, found, ctx));
        if (!refusal) return undefined;
        return { deny: refusalText(refusal) };
      },
      filter: async (r) => filterResult(line, r),
      log: (policy, decision, error) => journal($, e, policy, decision, error),
    });
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "lint-setup" }, async ($, e) => {
    try {
      return { text: await lintSetup(await lintPort($), e.args ?? "") };
    } catch (err: any) {
      return { text: `/lint-setup failed: ${err?.message ?? String(err)}` };
    }
  });

  on("attribution.text", async ($, e, next) => {
    const text = attributionText(e.kind);
    return text === undefined || (await off($)) ? next(e) : { text };
  });

  // modwall: refuses a user-tier module from outside the kodflow marketplace
  on("plugin.register", async ($, e, next) => {
    const refused = await admit(guardPort($), e);
    return refused ?? next(e);
  }).catch(($, e, next) => next(e));

  on("command.run", { command: "kodflow-mods" }, async ($) => ({
    text: await modsReport(guardPort($)),
  }));

  on("session.end", async ($, e, next) => {
    await endGuards(guardPort($)).catch(() => undefined);
    return next(e);
  });

  // collision-guard: a file another live session wrote in the last 30 min
  on("tool.call", { tool: ["Edit", "Write", "MultiEdit", "NotebookEdit"] }, async ($, e, next) =>
    guardWrite(guardPort($), e as any, () => next(e)),
  ).catch(($, e, next) => next(e));
};
