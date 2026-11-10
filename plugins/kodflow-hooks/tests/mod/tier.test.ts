// tier.test.ts — the tier rule for a Workflow's agent(), under `claude plugin
// test`: tool.call {tool:"Workflow"} and agent.spawn through register.ts with
// the host in memory, the inputs shaped as tests/fixtures/tier-*.jsonl
// recorded them (T0-FINDINGS.md), and the shared vectors beside them.
import { test, expect, mock } from "claude-code/testing";
import { TIER_VECTORS_JSONL } from "./tier-vectors.ts";
import {
  definitionPins,
  judgeWorkflowScript,
  offCommand,
  parseTable,
  projectSlug,
  resolveMode,
} from "../../hooks/mod/tier.ts";
import { frontmatterModel } from "../../hooks/mod/fable.ts";

const CFG = "/cfg";
const SID = "sess-1";
const DIR = `${CFG}/kodflow/sessions/${SID}`;
const CWD = "/repo";
const WF = `${CFG}/projects/-repo/${SID}/workflows/scripts`;
const TABLE = [
  "# sha256 x",
  "role\tOrchestrator\t-\thigh",
  "role\tCode worker, well specified\tsonnet\tmedium",
  "role\tBulk / triage worker\thaiku\tlow",
  "exempt\tclaude-code-guide\thaiku\t-",
  "fork\tfork\t-\t-",
  "",
].join("\n");
const INSTALLED = JSON.stringify({
  version: 2,
  plugins: {
    "kodflow-specialists@kodflow": [
      { scope: "user", installPath: `${CFG}/plugins/cache/k/s/1` },
    ],
  },
});
const AGENTS = `${CFG}/plugins/cache/k/s/1/agents`;

const BARE =
  "export const meta = {name: 'bare', description: 'one bare agent'}\nreturn await agent('Do the thing.')";
const FULL =
  "export const meta = {name: 't0-probe', description: 'recorder probe'}\nconst r = await agent('Reply ok.', {model: 'haiku', effort: 'low', label: 'w1'})\nreturn r";
const LAUNCHED = {
  status: "async_launched",
  taskId: "t1",
  taskType: "local_workflow",
  runId: "wf_1",
};

type Host = {
  files: Map<string, string>;
  store: Map<string, unknown>;
  journal: any[];
  ran: number;
  spawned: any[];
};

function host(on: any, env: Record<string, string>, opts: { noRealPath?: boolean; cwd?: string } = {}): Host {
  const h: Host = {
    files: new Map(),
    store: new Map(),
    journal: [],
    ran: 0,
    spawned: [],
  };
  h.files.set("*/hooks/tier-table.tsv", TABLE);
  h.files.set("*/hooks/gated-models.txt", "fable\n");
  h.files.set(`${CFG}/plugins/installed_plugins.json`, INSTALLED);
  mock.env(on, env);
  on("session.id", async () => ({ value: SID }));
  on("session.cwd", async () => ({ value: opts.cwd ?? CWD }));
  on("session.root", async () => ({ value: opts.cwd ?? CWD }));
  on("store.get", async (_$: any, e: any) => ({ value: h.store.get(e.key) }));
  on(
    "store.set",
    async (_$: any, e: any) => (
      h.store.set(e.key, e.value),
      { value: undefined }
    ),
  );
  on("ui.toast", async () => ({ value: undefined }));
  on("ui.log", async () => ({ value: undefined }));
  on(
    "fs.write",
    async (_$: any, e: any) => (
      h.files.set(e.path, e.text),
      { value: undefined }
    ),
  );
  const find = (path: string) =>
    h.files.get(path) ??
    [...h.files].find(
      ([k]) => k.startsWith("*/") && path.endsWith(k.slice(1)),
    )?.[1];
  on("fs.read", async (_$: any, e: any) => {
    const text = find(e.path);
    return text === undefined ? { deny: "ENOENT" } : { value: text };
  });
  on("fs.exists", async (_$: any, e: any) => ({
    value: find(e.path) !== undefined,
  }));
  on("fs.stat", async (_$: any, e: any) => {
    // A key "link:<path>" is a symlink to its value
    const target = h.files.get(`link:${e.path}`);
    const real = target ?? e.path;
    const text = find(real);
    const dir = [...h.files.keys()].some((k) => k.startsWith(`${real}/`));
    if (text === undefined && !dir) return { deny: "ENOENT" };
    return {
      value: {
        kind: dir ? "directory" : "file",
        size: text?.length ?? 0,
        mtimeMs: 0,
        isLink: target !== undefined,
        ...(e.resolve && !opts.noRealPath ? { realPath: real } : {}),
      },
    };
  });
  on("process.run", async (_$: any, e: any) => {
    const argv: string[] = e.argv;
    const stdin = e.init?.stdin ?? e.stdin;
    if (argv[3] === "tier-journal" && typeof stdin === "string")
      for (const l of stdin.split("\n").filter(Boolean))
        h.journal.push(JSON.parse(l));
    return {
      value: {
        exitCode: 0,
        stdout: "",
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("tool.call", { tool: "Workflow" }, async () => {
    h.ran++;
    return { result: LAUNCHED } as any;
  });
  on("agent.spawn", async (_$: any, e: any) => {
    h.spawned.push(e);
    return {
      model: e.model ?? "claude-sonnet-5-5",
      agentId: `a${h.spawned.length}`,
    };
  });
  return h;
}

const wf = (input: Record<string, unknown>) =>
  ({ tool: "Workflow", tool_use_id: "toolu_1", ...input }) as any;

test("one bare agent(): warn by default, the run goes on, the advice in context", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  const r: any = await $.tool.call(wf({ script: BARE }));
  expect(h.ran).toBe(1);
  expect(r.result).toEqual(LAUNCHED);
  expect(Array.isArray(r.context)).toBe(true);
  expect(r.context.length).toBe(1);
  const text: string = r.context[0];
  expect(text).toContain("agent() #1 (line 2): missing model and effort");
  expect(text).toContain(
    "Code worker, well specified: model sonnet, effort medium",
  );
  expect(text).not.toContain("Orchestrator");
  expect(text).toContain("Mode warn (source: default)");
  expect(text).toContain(`printf off > '${DIR}/tier-mode'`);
  expect(h.journal.length).toBe(1);
  expect(h.journal[0].ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  expect(h.journal[0]).toEqual(
    expect.objectContaining({
      source: "mod",
      mode: "warn",
      mode_source: "default",
      action: "warn",
      reason: "tier",
      would_refuse: true,
      index: 1,
      has_model: false,
      has_effort: false,
      tool_use_id: "toolu_1",
      caller: "main",
    }),
  );
});

test("a script whose agent() passes both fields: untouched, one ok line", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  const r: any = await $.tool.call(wf({ script: FULL }));
  expect(r.context).toBeUndefined();
  expect(r.result).toEqual(LAUNCHED);
  expect(
    h.journal.map((l) => [l.reason, l.action, l.pinned_model, l.pinned_effort]),
  ).toEqual([["tier", "pass", "call:haiku", "call:low"]]);
});

test("enforce refuses before the run; the same script a second time passes (breaker)", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" });
  const one: any = await $.tool.call(wf({ script: BARE }));
  expect(one.deny).toContain("TIER CHECK REFUSED");
  expect(one.deny).toContain("[motif:tier]");
  expect(h.ran).toBe(0);
  const two: any = await $.tool.call(wf({ script: BARE }));
  expect(two.deny).toBeUndefined();
  expect(h.ran).toBe(1);
  expect(two.context[0]).toContain("agent() #1");
  expect(h.journal.map((l) => l.reason)).toEqual(["tier", "tier-breaker"]);
  expect(h.journal.map((l) => l.action)).toEqual(["refuse", "warn"]);
  // Another script is refused on its own
  const other: any = await $.tool.call(wf({ script: `${BARE}\n// v2` }));
  expect(other.deny).toContain("TIER CHECK REFUSED");
});

test("off from the session file wins over KODFLOW_TIER=enforce: nothing judged, nothing logged", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" });
  h.files.set(`${DIR}/tier-mode`, "off\n");
  const r: any = await $.tool.call(wf({ script: BARE }));
  expect(r.deny).toBeUndefined();
  expect(r.context).toBeUndefined();
  expect(h.journal.length).toBe(0);
});

test("tier-skew turns enforce into warn", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  h.files.set(`${CFG}/kodflow/tier-mode`, "enforce");
  h.files.set(`${DIR}/tier-skew`, "x\n");
  const r: any = await $.tool.call(wf({ script: BARE }));
  expect(r.deny).toBeUndefined();
  expect(r.context[0]).toContain("Mode warn (source: tier-skew)");
});

test("name only and resumeFromRunId: not judged, logged", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" });
  const named: any = await $.tool.call(wf({ name: "t0named" }));
  const resumed: any = await $.tool.call(
    wf({ scriptPath: `${WF}/bare-wf_1.js`, resumeFromRunId: "wf_1" }),
  );
  expect([named.deny, resumed.deny]).toEqual([undefined, undefined]);
  expect(h.ran).toBe(2);
  expect(h.journal.map((l) => l.reason)).toEqual([
    "tier-unjudged",
    "tier-resume",
  ]);
});

test("scriptPath: read inside the session directory, refused outside, and through a symlink by its real path", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" });
  h.files.set(`${WF}/bare-wf_1.js`, BARE);
  h.files.set("/etc/elsewhere/bare.js", BARE);
  h.files.set(`link:${CWD}/linked.js`, "/etc/elsewhere/bare.js");
  const inside: any = await $.tool.call(
    wf({ scriptPath: `${WF}/bare-wf_1.js` }),
  );
  expect(inside.deny).toContain("agent() #1");
  const outside: any = await $.tool.call(
    wf({ scriptPath: "/etc/elsewhere/bare.js" }),
  );
  expect(outside.deny).toBeUndefined();
  const linked: any = await $.tool.call(wf({ scriptPath: `${CWD}/linked.js` }));
  expect(linked.deny).toBeUndefined();
  expect(h.journal.map((l) => l.reason)).toEqual([
    "tier",
    "tier-unjudged",
    "tier-unjudged",
  ]);
  // The project's own tree is a root
  // another script: the same one would meet the breaker
  h.files.set(`${CWD}/.claude/workflows/named.js`, `${BARE}\n// project`);
  const project: any = await $.tool.call(
    wf({ scriptPath: `${CWD}/.claude/workflows/named.js` }),
  );
  expect(project.deny).toContain("agent() #1");
});

test("a script over 256 kB is not judged", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" });
  const r: any = await $.tool.call(
    wf({ script: `${BARE}\n//${"x".repeat(256 * 1024)}` }),
  );
  expect(r.deny).toBeUndefined();
  expect(h.journal[0].reason).toBe("tier-unjudged");
});

test("agentType: a definition pinning both fields needs neither; one pinning the model still needs the effort", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" });
  h.files.set(
    `${AGENTS}/both.md`,
    "---\nname: both\nmodel: sonnet\neffort: medium\n---\n",
  );
  h.files.set(
    `${AGENTS}/half.md`,
    '---\r\nname: half\r\nmodel: "opus" # pinned\r\neffort: ~\r\n---\r\n',
  );
  const ok: any = await $.tool.call(
    wf({ script: "await agent('x', {agentType: 'kodflow-specialists:both'})" }),
  );
  expect(ok.deny).toBeUndefined();
  const half: any = await $.tool.call(
    wf({ script: "await agent('x', {agentType: 'kodflow-specialists:half'})" }),
  );
  expect(half.deny).toContain(
    "agentType kodflow-specialists:half): missing effort",
  );
  const nodef: any = await $.tool.call(
    wf({ script: "await agent('x', {agentType: 'kodflow-specialists:none'})" }),
  );
  expect(nodef.deny).toBeUndefined();
  const exempt: any = await $.tool.call(
    wf({ script: "await agent('x', {agentType: 'claude-code-guide'})" }),
  );
  expect(exempt.deny).toBeUndefined();
  const builtIn: any = await $.tool.call(
    wf({
      script:
        "await agent('x', {agentType: 'general-purpose', model: 'sonnet'})",
    }),
  );
  expect(builtIn.deny).toContain("missing effort");
  expect(h.journal.map((l) => l.reason)).toEqual(["tier", "tier", "tier-nodef", "tier", "tier"]);
});

test("the environment pins: CLAUDE_CODE_SUBAGENT_MODEL and CLAUDE_CODE_EFFORT_LEVEL (auto pins nothing)", async ($, on) => {
  const h = host(on, {
    CLAUDE_CONFIG_DIR: CFG,
    KODFLOW_TIER: "enforce",
    CLAUDE_CODE_SUBAGENT_MODEL: "sonnet",
    CLAUDE_CODE_EFFORT_LEVEL: "high",
  });
  const r: any = await $.tool.call(wf({ script: BARE }));
  expect(r.deny).toBeUndefined();
  expect(h.journal[0]).toEqual(
    expect.objectContaining({
      reason: "tier", would_refuse: false, pinned_model: "env:sonnet", pinned_effort: "env:high",
    }),
  );
});

test("CLAUDE_CODE_EFFORT_LEVEL=auto leaves the effort to the call", async ($, on) => {
  const h = host(on, {
    CLAUDE_CONFIG_DIR: CFG,
    KODFLOW_TIER: "enforce",
    CLAUDE_CODE_EFFORT_LEVEL: "auto",
  });
  const r: any = await $.tool.call(
    wf({ script: "await agent('x', {model: 'haiku'})" }),
  );
  expect(r.deny).toContain("missing effort");
  expect(h.journal[0].pinned_model).toBe("call:haiku");
  expect(h.journal[0].pinned_effort).toBe("");
});

test("twenty agent() calls: one line each, the missing ones named by index", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  const calls = Array.from({ length: 20 }, (_, i) =>
    i % 4 === 3
      ? `agent('t${i}', {label: 'l${i}'})`
      : `agent('t${i}', {model: 'haiku', effort: 'low'})`,
  );
  const r: any = await $.tool.call(
    wf({ script: `await Promise.all([\n${calls.join(",\n")}\n])` }),
  );
  expect(h.journal.length).toBe(20);
  expect(
    h.journal.filter((l) => l.would_refuse).map((l) => l.index),
  ).toEqual([4, 8, 12, 16, 20]);
  expect(r.context[0]).toContain("5 agent() call(s)");
});

test("the KODFLOW_MOD=off switch leaves a Workflow untouched", async ($, on) => {
  const h = host(on, {
    CLAUDE_CONFIG_DIR: CFG,
    KODFLOW_MOD: "off",
    KODFLOW_TIER: "enforce",
  });
  const r: any = await $.tool.call(wf({ script: BARE }));
  expect(r.deny).toBeUndefined();
  expect(h.journal.length).toBe(0);
});

test("agent.spawn is never refused by tier: a Workflow agent, a resume, a named agent logged", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" });
  const base = {
    prompt: "Reply ok.",
    description: "w1",
    parentModel: "claude-sonnet-5-5",
    provider: { plugin: "engine", tier: "core" },
    fork: false,
  };
  const a: any = await $.agent.spawn({
    ...base,
    subagentType: "workflow-subagent",
    background: false,
    workflow: { runId: "wf_1", agentIndex: 1 },
  } as any);
  const b: any = await $.agent.spawn({
    ...base,
    subagentType: "general-purpose",
    background: true,
    resume: { agentId: "a4c" },
  } as any);
  const c: any = await $.agent.spawn({
    ...base,
    subagentType: "general-purpose",
    background: true,
    name: "mate1",
  } as any);
  const d: any = await $.agent.spawn({
    ...base,
    subagentType: "general-purpose",
    background: true,
  } as any);
  expect([a.deny, b.deny, c.deny, d.deny]).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  expect(h.spawned.length).toBe(4);
  // The journal lines are written without holding the spawn
  for (let i = 0; i < 20 && h.journal.length < 3; i++)
    await new Promise((r) => setTimeout(r, 5));
  expect(h.journal.map((l) => l.reason).sort()).toEqual([
    "tier-resume",
    "tier-teammate",
    "tier-workflow",
  ]);
});

test("tier before fable: a gated model is still refused by fable at the spawn", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  const r: any = await $.agent.spawn({
    prompt: "x",
    description: "w",
    subagentType: "workflow-subagent",
    parentModel: "claude-sonnet-5-5",
    model: "claude-fable-5-1",
    fork: false,
    background: false,
    workflow: { runId: "wf_2", agentIndex: 1 },
  } as any);
  expect(r.deny).toContain("[motif:fable]");
  expect(h.spawned.length).toBe(0);
});

test("the shared vectors, as the engine runs them", async () => {
  const table = parseTable(TABLE);
  for (const line of TIER_VECTORS_JSONL.split("\n").filter(Boolean)) {
    const v = JSON.parse(line);
    if (v.kind === "frontmatter")
      expect([v.name, definitionPins(v.text, v.key)]).toEqual([
        v.name,
        v.pinned,
      ]);
    else if (v.kind === "mode")
      expect([
        v.name,
        resolveMode({
          env: v.env ?? undefined,
          session: v.session ?? undefined,
          global: v.global ?? undefined,
          skew: v.skew,
        }),
      ]).toEqual([v.name, { mode: v.mode, source: v.source }]);
    else {
      const got = await judgeWorkflowScript(v.script, {
        definition: async () => undefined,
        table,
      });
      expect([v.name, got.kind === "judged" ? "judged" : got.reason]).toEqual([
        v.name,
        v.expect,
      ]);
      if (got.kind === "judged")
        expect([v.name, got.missing.map((c) => [c.index, c.missing])]).toEqual([
          v.name,
          v.missing,
        ]);
    }
  }
});

test("frontmatterModel is frontmatterField(model): inherit kept, null and ~ dropped", () => {
  expect(frontmatterModel("---\nmodel: inherit\n---\n")).toBe("inherit");
  expect(frontmatterModel("---\nmodel: null\n---\n")).toBeUndefined();
  expect(frontmatterModel("---\nmodel: ~ # none\n---\n")).toBeUndefined();
  expect(frontmatterModel("﻿---\r\nmodel: 'fable' # c\r\n---\r\n")).toBe(
    "fable",
  );
});

test("the module loads with tier and fable on agent.spawn: one handler, both rules", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  // A load failure throws on the first event; a spawn and a Workflow both answer
  const spawned: any = await $.agent.spawn({
    prompt: "x", description: "w", subagentType: "general-purpose", parentModel: "claude-sonnet-5-5", fork: false, background: true,
  } as any);
  expect(spawned.deny).toBeUndefined();
  const r: any = await $.tool.call(wf({ script: FULL }));
  expect(r.result).toEqual(LAUNCHED);
  expect(h.spawned.length).toBe(1);
});

test("mode_source names the file it came from, as the shell does", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  h.files.set(`${DIR}/tier-mode`, "enforce\n");
  const r: any = await $.tool.call(wf({ script: BARE }));
  expect(r.deny).toContain(`Mode enforce (source: ${DIR}/tier-mode)`);
  expect(h.journal[0].mode_source).toBe(`${DIR}/tier-mode`);
  expect(h.journal[0].action).toBe("refuse");
});

test("scriptPath with a . or .. segment, or outside the roots by its spelling, is not read", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" });
  h.files.set("/etc/x.js", BARE);
  const up: any = await $.tool.call(wf({ scriptPath: `${CWD}/../etc/x.js` }));
  const dot: any = await $.tool.call(wf({ scriptPath: `${CWD}/./a/../../etc/x.js` }));
  expect([up.deny, dot.deny]).toEqual([undefined, undefined]);
  expect(h.journal.map((l) => [l.reason, l.why])).toEqual([
    ["tier-unjudged", "scriptPath not absolute, or with a . or .. segment"],
    ["tier-unjudged", "scriptPath not absolute, or with a . or .. segment"],
  ]);
});

test("a host without realPath: the spelling decides, a link is not followed", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" }, { noRealPath: true });
  h.files.set(`${WF}/plain-wf_1.js`, BARE);
  h.files.set(`link:${WF}/linked-wf_1.js`, "/etc/x.js");
  const plain: any = await $.tool.call(wf({ scriptPath: `${WF}/plain-wf_1.js` }));
  expect(plain.deny).toContain("agent() #1");
  const linked: any = await $.tool.call(wf({ scriptPath: `${WF}/linked-wf_1.js` }));
  expect(linked.deny).toBeUndefined();
});

test("the context added is the recorded accepted shape: an array of strings next to the result", async ($, on) => {
  // tests/fixtures/tier-workflow-results.jsonl, last line: accepted
  // {context: ["<warning text>"], result: {...}}; a string context is rejected
  const accepted = { context: ["<warning text>"], ref: 1, result: { status: "async_launched" } };
  host(on, { CLAUDE_CONFIG_DIR: CFG });
  const r: any = await $.tool.call(wf({ script: BARE }));
  expect(Array.isArray(r.context) && r.context.every((c: unknown) => typeof c === "string")).toBe(true);
  expect(Object.keys(r).filter((k) => k in accepted).sort()).toEqual(["context", "result"]);
  expect(r.additionalContext).toBeUndefined();
});

test("the project slug is the engine's: every character outside [A-Za-z0-9] becomes -", async ($, on) => {
  // T0: /workspace/probe → -workspace-probe (tests/fixtures/tier-workflow-results.jsonl)
  expect(projectSlug("/workspace/probe")).toBe("-workspace-probe");
  expect(projectSlug("/workspace/a b/my_proj.v2@x")).toBe("-workspace-a-b-my-proj-v2-x");
  const cwd = "/workspace/a b/my_proj.v2";
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" }, { cwd });
  const persisted = `${CFG}/projects/-workspace-a-b-my-proj-v2/${SID}/workflows/scripts/bare-wf_9.js`;
  h.files.set(persisted, BARE);
  const r: any = await $.tool.call(wf({ scriptPath: persisted }));
  expect(r.deny).toContain("agent() #1");
  expect(h.journal[0].reason).toBe("tier");
});

test("a slug over 200 characters: cut, any base-36 suffix, this session only", async ($, on) => {
  const cwd = `/${"d".repeat(230)}`;
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_TIER: "enforce" }, { cwd });
  const dir = `${CFG}/projects/-${"d".repeat(199)}-1x9z`;
  h.files.set(`${dir}/${SID}/workflows/scripts/a-wf_1.js`, BARE);
  h.files.set(`${dir}/other-session/workflows/scripts/a-wf_1.js`, `${BARE}\n// other`);
  const mine: any = await $.tool.call(wf({ scriptPath: `${dir}/${SID}/workflows/scripts/a-wf_1.js` }));
  expect(mine.deny).toContain("agent() #1");
  const other: any = await $.tool.call(wf({ scriptPath: `${dir}/other-session/workflows/scripts/a-wf_1.js` }));
  expect(other.deny).toBeUndefined();
});

test("the off command is quoted: a space or a quote in the config path survives the copy", () => {
  expect(offCommand("/workspace/Jane Doe/.claude/kodflow/sessions/s")).toBe(
    "printf off > '/workspace/Jane Doe/.claude/kodflow/sessions/s/tier-mode'",
  );
  expect(offCommand("/x/it's")).toBe("printf off > '/x/it'\\''s/tier-mode'");
});
