// fable.test.ts — the gated-model rule, under `claude plugin test`: agent.spawn
// and classic.PreModelSwitch through register.ts with the host in memory, the
// inputs shaped as tests/fixtures/agent-spawn.jsonl and agent-mod-events.jsonl
// recorded them, and the pure decisions of fable.ts beside them.
import { test, expect, mock } from "claude-code/testing";
import {
  candidate,
  definitionPaths,
  frontmatterModel,
  gateMode,
  isGated,
  judgeSwitch,
  parseGated,
} from "../../hooks/mod/fable.ts";

const CFG = "/cfg";
const SID = "sess-1";
const GATED = "# comment\n\nfable\n";
const INSTALLED = JSON.stringify({
  version: 2,
  plugins: {
    "kodflow-specialists@kodflow": [
      { scope: "user", installPath: `${CFG}/plugins/cache/kodflow/kodflow-specialists/abc123` },
    ],
  },
});
const AGENTS = `${CFG}/plugins/cache/kodflow/kodflow-specialists/abc123/agents`;

type Host = {
  files: Map<string, string>;
  store: Map<string, unknown>;
  asked: string[];
  answer: string | undefined;
  spawned: any[];
  toasts: string[];
};

function host(on: any, env: Record<string, string>): Host {
  const h: Host = { files: new Map(), store: new Map(), asked: [], answer: undefined, spawned: [], toasts: [] };
  h.files.set("*/hooks/gated-models.txt", GATED);
  h.files.set(`${CFG}/plugins/installed_plugins.json`, INSTALLED);
  mock.env(on, env);
  on("session.id", async () => ({ value: SID }));
  on("session.cwd", async () => ({ value: "/repo" }));
  on("session.root", async () => ({ value: "/repo" }));
  on("session.start", async (_$: any, e: any) => ({ cwd: e.cwd ?? "/repo" }));
  on("prompt.submit", async (_$: any, e: any) => ({ text: e.text }));
  on("tool.register", async (_$: any, e: any) => ({ value: { tool: `mcp__kodflow-hooks__${e.name}` } }));
  on("command.register", async (_$: any, e: any) => ({ value: { command: e.name } }));
  on("store.get", async (_$: any, e: any) => ({ value: h.store.get(e.key) }));
  on("store.set", async (_$: any, e: any) => {
    h.store.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("ui.toast", async (_$: any, e: any) => (h.toasts.push(e.text), { value: undefined }));
  on("ui.log", async () => ({ value: undefined }));
  on("fs.write", async (_$: any, e: any) => (h.files.set(e.path, e.text), { value: undefined }));
  on("fs.read", async (_$: any, e: any) => {
    const text =
      h.files.get(e.path) ??
      [...h.files].find(([k]) => k.startsWith("*/") && e.path.endsWith(k.slice(1)))?.[1];
    return text === undefined ? { deny: "ENOENT" } : { value: text };
  });
  on("fs.exists", async (_$: any, e: any) => ({ value: h.files.has(e.path) }));
  on("fs.list", async () => ({ deny: "ENOENT" }));
  on("process.run", async () => ({
    value: { exitCode: 0, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
  }));
  on("tool.call", { tool: "AskUserQuestion" }, async (_$: any, e: any) => {
    const q = e.questions?.[0]?.question ?? "";
    h.asked.push(q);
    if (h.answer === undefined) throw new Error("dismissed");
    return { result: { questions: e.questions, answers: { [q]: h.answer } } } as any;
  });
  on("classic.PreModelSwitch", async () => ({}));
  on("agent.spawn", async (_$: any, e: any) => {
    h.spawned.push(e);
    return { model: e.model ?? "claude-sonnet-5-5", agentId: `a${h.spawned.length}` };
  });
  return h;
}

// What the recorded spawns carry, less what the engine stamps
const spawn = (over: Record<string, unknown>) => ({
  prompt: "Reply ok.",
  description: "probe",
  subagentType: "kodflow-specialists:developer-specialist-go",
  parentModel: "claude-opus-5-5",
  background: true,
  fork: false,
  ...over,
});

const typed = async ($: any) => {
  await $.session.start({ source: "startup", cwd: "/repo" });
  await $.prompt.submit({ text: "go", origin: { kind: "composer" } } as any).catch(() => undefined);
};

test("an ungated spawn goes on untouched, its model never written", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  h.files.set(`${AGENTS}/developer-specialist-go.md`, "---\nname: developer-specialist-go\nmodel: sonnet\n---\n");
  const r: any = await $.agent.spawn(spawn({}) as any);
  expect(r.deny).toBeUndefined();
  expect(h.spawned.length).toBe(1);
  expect(h.spawned[0].model).toBeUndefined();
});

test("a per-call fable with nobody at the prompt is refused with the reason", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  const r: any = await $.agent.spawn(spawn({ model: "fable" }) as any);
  expect(r.deny).toContain("[motif:fable]");
  expect(r.deny).toContain("call model");
  expect(h.spawned.length).toBe(0);
  expect(h.asked.length).toBe(0);
});

test("a fable frontmatter, the user present: asked once, the yes holds for the session", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  h.files.set(`${AGENTS}/deep.md`, "---\r\nname: deep\r\nmodel: \"fable\" # pinned\r\n---\r\nbody\r\n");
  h.answer = "Allow it for this session";
  await typed($);
  const one: any = await $.agent.spawn(spawn({ subagentType: "kodflow-specialists:deep" }) as any);
  const two: any = await $.agent.spawn(spawn({ subagentType: "kodflow-specialists:deep" }) as any);
  expect([one.deny, two.deny]).toEqual([undefined, undefined]);
  expect(h.asked.length).toBe(1);
  expect(h.asked[0]).toContain("frontmatter model");
  expect(h.store.get(`fable:${SID}`)).toEqual(expect.objectContaining({ by: "asked at a spawn" }));
  expect(h.spawned.every((s) => s.model === undefined)).toBe(true);
});

test("a refused or dismissed question refuses the spawn", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await typed($);
  h.answer = "Refuse";
  const no: any = await $.agent.spawn(spawn({ model: "fable" }) as any);
  expect(no.deny).toContain("the user answered Refuse");
  h.answer = undefined;
  const gone: any = await $.agent.spawn(spawn({ model: "fable" }) as any);
  expect(gone.deny).toContain("dismissed");
  expect(h.spawned.length).toBe(0);
});

test("Explore and a workflow agent are judged on the parent and the environment only", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  const ok: any = await $.agent.spawn(spawn({ subagentType: "Explore", parentModel: "claude-sonnet-5-5" }) as any);
  expect(ok.deny).toBeUndefined();
  const wf: any = await $.agent.spawn(
    spawn({ subagentType: "workflow-subagent", parentModel: "claude-fable-5-1", workflow: { runId: "wf_1", agentIndex: 1 } }) as any,
  );
  expect(wf.deny).toContain("parent model");
  expect(h.spawned.map((s) => s.subagentType)).toEqual(["Explore"]);
});

test("CLAUDE_CODE_SUBAGENT_MODEL decides an agent with no model of its own", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG, CLAUDE_CODE_SUBAGENT_MODEL: "claude-fable-5-1" });
  h.files.set(`${AGENTS}/plain.md`, "---\nname: plain\nmodel: inherit\n---\n");
  const r: any = await $.agent.spawn(spawn({ subagentType: "kodflow-specialists:plain" }) as any);
  expect(r.deny).toContain("env model");
});

test("malformed frontmatter on a non-gated dispatch still spawns", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  h.files.set(`${AGENTS}/broken.md`, "no frontmatter at all\nmodel: fable\n");
  const r: any = await $.agent.spawn(spawn({ subagentType: "kodflow-specialists:broken", parentModel: "claude-sonnet-5-5" }) as any);
  expect(r.deny).toBeUndefined();
  expect(h.spawned.length).toBe(1);
});

for (const v of ["allow", "off"])
  test(`KODFLOW_FABLE=${v} lets a gated spawn through, unasked`, async ($, on) => {
    const h = host(on, { CLAUDE_CONFIG_DIR: CFG, KODFLOW_FABLE: v });
    const r: any = await $.agent.spawn(spawn({ model: "fable" }) as any);
    expect(r.deny).toBeUndefined();
    expect(h.asked.length).toBe(0);
  });

test("a /model the user typed grants the session; a later spawn is not asked", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  const r: any = await $.classic.PreModelSwitch({
    session_id: SID,
    from_model: "claude-opus-5-5",
    to_model: "claude-fable-5-1",
    requested_model: "fable",
    source: "command",
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: "1h",
  } as any);
  expect(r.permissionDecision).toBeUndefined();
  expect(h.store.get(`fable:${SID}`)).toBeTruthy();
  const s: any = await $.agent.spawn(spawn({ model: "fable" }) as any);
  expect(s.deny).toBeUndefined();
  expect(h.asked.length).toBe(0);
});

test("an SDK switch to a gated model with nobody at the prompt is refused", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  const r: any = await $.classic.PreModelSwitch({
    session_id: SID,
    from_model: "claude-opus-5-5",
    to_model: "claude-fable-5-1",
    requested_model: "claude-fable-5-1",
    source: "sdk",
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: "1h",
  } as any);
  expect(r.permissionDecision).toBe("deny");
  expect(r.permissionDecisionReason).toContain("[motif:fable]");
  expect(h.store.get(`fable:${SID}`)).toBeUndefined();
});

test("a composer prompt writes composer-at in seconds; another origin does not", async ($, on) => {
  const h = host(on, { CLAUDE_CONFIG_DIR: CFG });
  await $.session.start({ source: "startup", cwd: "/repo" });
  await $.prompt.submit({ text: "x", origin: { kind: "task-notification" } } as any).catch(() => undefined);
  expect(h.files.has(`${CFG}/kodflow/sessions/${SID}/composer-at`)).toBe(false);
  await $.prompt.submit({ text: "x", origin: { kind: "composer" } } as any).catch(() => undefined);
  expect(h.files.get(`${CFG}/kodflow/sessions/${SID}/composer-at`)).toMatch(/^\d{10}$/);
});

test("pure: the gated list, the match, the mode", () => {
  expect(parseGated(GATED)).toEqual(["fable"]);
  expect(parseGated(undefined)).toEqual([]);
  expect(isGated("claude-fable-5-1[1m]", ["fable"])).toBe(true);
  expect(isGated("claude-opus-5-5", ["fable"])).toBe(false);
  expect(isGated(undefined, ["fable"])).toBe(false);
  expect([gateMode("allow"), gateMode("OFF"), gateMode(undefined), gateMode("yes")]).toEqual(["pass", "off", "on", "on"]);
});

test("pure: frontmatter is bounded, quote- and CRLF-safe", () => {
  expect(frontmatterModel("---\nmodel: 'opus'\n---\n")).toBe("opus");
  expect(frontmatterModel("---\r\nmodel: fable # x\r\n---\r\n")).toBe("fable");
  expect(frontmatterModel("---\nname: a\n---\nmodel: fable\n")).toBeUndefined();
  expect(frontmatterModel("model: fable\n")).toBeUndefined();
  expect(frontmatterModel("---\n" + "x: y\n".repeat(70) + "model: fable\n---\n")).toBeUndefined();
});

test("pure: precedence call > frontmatter > env > parent, a fork inherits", () => {
  const fm = "---\nmodel: haiku\n---\n";
  expect(candidate({ model: "opus", parentModel: "p" }, fm, "e")).toEqual({ model: "opus", source: "call" });
  expect(candidate({ parentModel: "p" }, fm, "e")).toEqual({ model: "haiku", source: "frontmatter" });
  expect(candidate({ parentModel: "p" }, "---\nmodel: inherit\n---\n", "e")).toEqual({ model: "e", source: "env" });
  expect(candidate({ parentModel: "p" }, undefined, undefined)).toEqual({ model: "p", source: "parent" });
  expect(candidate({ model: "fable", fork: true, parentModel: "p" }, fm, "e")).toEqual({ model: "p", source: "parent" });
});

test("pure: definitions — namespaced in its plugin only, bare in project, user, then plugins", () => {
  expect(definitionPaths("kodflow-specialists:go", { config: CFG, installed: INSTALLED })).toEqual([`${AGENTS}/go.md`]);
  expect(definitionPaths("other:go", { config: CFG, installed: INSTALLED })).toEqual([]);
  expect(definitionPaths("go", { project: "/repo", config: CFG, installed: INSTALLED })).toEqual([
    "/repo/.claude/agents/go.md",
    `${CFG}/agents/go.md`,
    `${AGENTS}/go.md`,
  ]);
  expect(definitionPaths("../x", { config: CFG })).toEqual([]);
});

test("pure: a switch the user typed grants, the picker too, the SDK asks", () => {
  const t = ["fable"];
  expect(judgeSwitch({ to_model: "claude-fable-5-1", source: "command" }, t, "on").kind).toBe("grant");
  expect(judgeSwitch({ to_model: "claude-fable-5-1", source: "picker" }, t, "on").kind).toBe("grant");
  expect(judgeSwitch({ to_model: "claude-fable-5-1", source: "sdk" }, t, "on").kind).toBe("ask");
  expect(judgeSwitch({ to_model: "claude-haiku-5-5", source: "sdk" }, t, "on").kind).toBe("pass");
  expect(judgeSwitch({ to_model: "claude-fable-5-1", source: "sdk" }, t, "off").kind).toBe("pass");
});
