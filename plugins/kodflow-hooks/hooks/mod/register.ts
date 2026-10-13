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
// Bash goes through one ordered pipeline (pipeline.ts): the merge gate
// (merge.ts), the shell's guards doubled (guards.ts), the blast radius
// (blast.ts), the call, then its output compressed (filter.ts). Every tool's
// result then has its secrets masked (veil.ts) before the model reads it.
//
// Every hook fails open: a throw is caught and the event goes on, except a
// task tool's own call, which answers the failure as text, and a merge,
// which a failure refuses. KODFLOW_MOD=off turns the whole module into
// pass-through, with no marker written.
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
import { load, mutate, type Port } from "./store.ts";
import { LINT_SETUP, lintSetup, type LintPort } from "./lint.ts";
import {
  argsOf,
  attributionText,
  isOff,
  logPayload,
  lowersTriage,
  taskTool,
} from "./calls.ts";
import {
  agentsFile,
  beatFile,
  beatText,
  configDir,
  mergeTokenFile,
  safe,
  sessionDir,
  triageFile,
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
import { parse } from "./shell.ts";
import { inspect, refusalText, verdict, type GuardCtx } from "./guards.ts";
import {
  classifyBash,
  classifyMcp,
  gate,
  type MergePort,
} from "./merge.ts";
import { blastRadius } from "./blast.ts";
import { filterResult, versionOk } from "./filter.ts";
import { veilResult } from "./veil.ts";
import { mayMerge, mergeFailure, runBash } from "./pipeline.ts";

// Set once every tool registered; the beat is a promise that they did.
let toolsReady = false;

// The merge question and the blast-radius question are only put to someone
// who is there: a message typed at the prompt in the last 10 minutes, as
// machine-guards.ts records it (notePrompt, in prompt.submit).
const PRESENCE_MS = 10 * 60_000;
const present = () => {
  const at = lastComposerAt();
  return at !== undefined && Date.now() - at <= PRESENCE_MS;
};

// Read once a session: the engine's version, the credential variables' values.
let validated: Promise<boolean> | undefined;
let secrets: Promise<string[]> | undefined;

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
      KTN_LINTER_PORT: await $.env.get("KTN_LINTER_PORT"),
      KTN_PRE_PHASES: await $.env.get("KTN_PRE_PHASES"),
      KTN_STOP_PHASES: await $.env.get("KTN_STOP_PHASES"),
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
  if (lowersTriage(e.agentId)) await io.run(["rm", "-f", triageFile(dir)]);
  const agent = e.agentId ? safe(e.agentId) : MAIN;
  const nowSec = () => Math.floor(Date.now() / 1000);
  let answer: { result: string } | { deny: string };
  try {
    const step = plan(tool, agent, argsOf(e));
    let workers: ReturnType<typeof resolveWorkers> = [];
    if (tool === "task_update") {
      const listed = await $.agent.list().catch(() => undefined);
      workers = resolveWorkers(
        listed,
        await io.read(agentsFile(dir)),
        nowSec(),
      );
    }
    const text = step.mutates
      ? await mutate(io, dir, (data) =>
          step.run(data, { now: nowSec(), workers }),
        )
      : step.run(await load(io, dir, nowSec()), { now: nowSec(), workers });
    answer = { result: text };
  } catch (err) {
    if (!isTaskError(err)) throw err;
    answer = { deny: err.message };
  }
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

function mergePort($: any, e: any): MergePort {
  return {
    run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
    ask: (question, options) =>
      $.ui.ask(question, { options, header: "Merge" }),
    writeToken: async (text) => {
      const cfg = await config($);
      if (!cfg) throw new Error("no absolute CLAUDE_CONFIG_DIR or HOME");
      const dir = sessionDir(cfg, await $.session.id());
      await $.fs.write(mergeTokenFile(dir, e.tool_use_id), text);
    },
    now: () => Date.now(),
    lastComposerAt: () => lastComposerAt(),
    exemptions: () => $.fs.read(`${$.plugin.root}/merge-exemptions.txt`),
    note: (text) => journal($, e, "merge", `exempt: ${text}`),
  };
}

// The session directory's GitHub or GitLab remote, when there is exactly one.
async function origin($: any): Promise<string | undefined> {
  const dir = await projectDir($);
  const remotes = await $.process.run(["git", "-C", dir, "remote"], {
    timeoutMs: 5000,
  });
  const names = remotes.stdout.split("\n").filter(Boolean);
  if (remotes.exitCode !== 0 || names.length !== 1) return undefined;
  const url = await $.process.run(
    ["git", "-C", dir, "remote", "get-url", names[0]],
    { timeoutMs: 5000 },
  );
  return url.exitCode === 0 ? url.stdout.trim() : undefined;
}

async function guardCtx($: any, e: any): Promise<GuardCtx> {
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
    // The merge gate ran first and wrote the token for this very call
    mergeAllowed: async () => {
      if (!cfg) return false;
      const token = await $.fs
        .read(mergeTokenFile(sessionDir(cfg, await $.session.id()), e.tool_use_id))
        .catch(() => undefined);
      const sha = token?.split("\n")[0] ?? "";
      return /^[0-9a-f]{40}$/.test(sha) && String(e.command).includes(sha);
    },
  };
}

async function blast($: any, line: string): Promise<{ deny: string } | undefined> {
  const labels = blastRadius(parse(line));
  if (!labels.length || !present()) return undefined;
  const q = `Run this? ${labels.join(" ; ").slice(0, 300)}`;
  let answer: string;
  try {
    answer = await $.ui.ask(q, { options: ["Run it", "Do not run it"], header: "Irreversible" });
  } catch {
    answer = "dismissed";
  }
  if (answer === "Run it") return undefined;
  return {
    deny: refusalText({
      motif: "blast",
      title: "COMMAND NOT RUN — the user did not confirm it",
      lines: [labels.join(" ; ").slice(0, 300), `Answer: ${answer}`],
    }),
  };
}

export const register: Register = (on) => {
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
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  on("tool.call", async ($, e, next) => {
    if (await off($)) return next(e);
    const tool = taskTool(e.tool);
    // Before next: the shell's PreToolUse runs inside it and reads the beat
    await beat($).catch(() => undefined);
    if (tool) return serve($, tool, e);
    // A forge merge tool: the same gate as a Bash merge, a failure refuses
    const merge = classifyMcp(e.tool, argsOf(e as any));
    if (merge.kind === "merge") {
      const g = await gate(merge, { agentId: e.agentId }, mergePort($, e)).catch(
        (err) => mergeFailure(err),
      );
      if (g && "deny" in g) {
        journal($, e, "merge", "deny");
        return g;
      }
    }
    const r: any = await next(e);
    try {
      secrets ??= secretValues($);
      const veiled = veilResult(r, { envValues: await secrets, now: Date.now });
      if (veiled !== r) journal($, e, "veil", "masked");
      return veiled;
    } catch (err) {
      journal($, e, "veil", "error", err);
      return r;
    }
  }).catch(($, e, next) => {
    if (next.called) return next(e);
    if (taskTool(e.tool))
      return {
        deny: `kodflow task tools failed: ${next.error.message ?? next.error.kind}`,
      };
    if (classifyMcp(e.tool, argsOf(e as any)).kind === "merge")
      return mergeFailure(next.error.message ?? next.error.kind);
    return next(e);
  });

  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (await off($)) return next(e);
    const line = typeof e.command === "string" ? e.command : "";
    return runBash(() => next(e), {
      merge: async () => {
        const c = await classifyBash(line, {
          ghRepo: await $.env.get("GH_REPO"),
          origin: () => origin($),
        });
        const g = await gate(c, { agentId: e.agentId }, mergePort($, e));
        return g && "deny" in g ? g : undefined;
      },
      guards: async () => {
        const ctx = await guardCtx($, e);
        const found = await inspect(line, ctx);
        const refusal = found && (await verdict(line, found, ctx));
        return refusal ? { deny: refusalText(refusal) } : undefined;
      },
      blast: () => blast($, line),
      filter: async (r) => {
        validated ??= $.session.version().then(
          (v: any) => versionOk(v?.base),
          () => false,
        );
        return filterResult(line, r, await validated!);
      },
      log: (policy, decision, error) => journal($, e, policy, decision, error),
    });
  }).catch(($, e, next) => {
    if (next.called) return next(e);
    if (mayMerge(e.command))
      return mergeFailure(next.error.message ?? next.error.kind);
    return next(e);
  });

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
