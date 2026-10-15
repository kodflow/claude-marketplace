// fable.ts — the gated-model rule (model-policy.md §6), pure.
//
// A gated model (hooks/gated-models.txt: one token a line, matched as a
// substring of the lower-cased id) is reached only with the user's yes, once
// per session. register.ts wires it on two events, as recorded in
// tests/fixtures/agent-spawn.jsonl and agent-mod-events.jsonl:
//
//   agent.spawn            `model` is the per-call value only (undefined when
//                          the call names none), `parentModel` the parent's
//                          resolved id, `subagentType` the type as dispatched.
//                          The hook passes or refuses; it never writes a model.
//   classic.PreModelSwitch `to_model` the resolved target, `source` command
//                          (a typed /model), picker or sdk.
//
// The model a spawn would run on is not in its input when the call names
// none: the agent's frontmatter decides, then CLAUDE_CODE_SUBAGENT_MODEL,
// then the parent. So the candidate is resolved here, to judge only.

export type Gate = "on" | "pass" | "off";

/** KODFLOW_FABLE: allow lifts the gate (logged as passed), off removes it. */
export function gateMode(value: string | undefined): Gate {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "off") return "off";
  return /^allow$/.test(v) ? "pass" : "on";
}

/** The tokens of gated-models.txt, a trailing comment dropped; a missing or empty file gates nothing. */
export function parseGated(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").replace(/\s+/g, "").toLowerCase())
    .filter((l) => l !== "");
}

/**
 * What a check that threw still refuses on: the shipped list, or, when even
 * that could not be read, the one model the policy gates today. A throw must
 * not turn an unreadable list into "nothing is gated".
 */
export function failClosedTokens(text: string | undefined): string[] {
  const t = parseGated(text);
  return t.length ? t : ["fable"];
}

export function isGated(model: unknown, tokens: readonly string[]): boolean {
  if (typeof model !== "string" || !model) return false;
  const m = model.toLowerCase();
  return tokens.some((t) => m.includes(t));
}

/**
 * `model:` of an agent definition's frontmatter: the first block between
 * `---` lines, at most 60 lines read, quotes, a trailing comment and CRLF
 * stripped. Undefined when there is no frontmatter or no model key.
 */
export function frontmatterModel(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = text
    .replace(/^\uFEFF/, "")
    .split("\n", 62)
    .map((l) => l.replace(/\s+$/, ""));
  if (lines[0] !== "---") return undefined;
  for (const line of lines.slice(1, 61)) {
    if (line === "---") return undefined;
    const m = /^model:\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[1]!.replace(/\s+#.*$/, "").trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0]!)) v = v.slice(1, -1);
    return v || undefined;
  }
  return undefined;
}

/** installed_plugins.json → install paths of a plugin, any marketplace. */
export function installPaths(json: string | undefined, plugin: string): string[] {
  let data: any;
  try {
    data = JSON.parse(json ?? "");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const [key, entries] of Object.entries(data?.plugins ?? {})) {
    if (key.split("@")[0] !== plugin || !Array.isArray(entries)) continue;
    for (const e of entries as any[])
      if (typeof e?.installPath === "string" && !out.includes(e.installPath)) out.push(e.installPath);
  }
  return out;
}

/**
 * Where the definition of `subagentType` can live, in the order the engine
 * prefers: a namespaced `plugin:name` only in that plugin's installed copy
 * (the current cache version, as installed_plugins.json names it); a bare
 * name in the project, then the user's agents, then any installed plugin.
 */
/** Where a skill's SKILL.md can live, in the same order as an agent's definition. */
export function skillPaths(
  skill: string,
  where: { project?: string; config: string; installed?: string },
): string[] {
  const i = skill.indexOf(":");
  const name = i > 0 ? skill.slice(i + 1) : skill;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name)) return [];
  if (i > 0) return installPaths(where.installed, skill.slice(0, i)).map((p) => `${p}/skills/${name}/SKILL.md`);
  const paths: string[] = [];
  if (where.project) paths.push(`${where.project}/.claude/skills/${name}/SKILL.md`);
  paths.push(`${where.config}/skills/${name}/SKILL.md`);
  let data: any;
  try {
    data = JSON.parse(where.installed ?? "");
  } catch {
    data = undefined;
  }
  for (const entries of Object.values(data?.plugins ?? {}))
    for (const e of Array.isArray(entries) ? (entries as any[]) : [])
      if (typeof e?.installPath === "string") paths.push(`${e.installPath}/skills/${name}/SKILL.md`);
  return [...new Set(paths)];
}

export function definitionPaths(
  subagentType: string,
  where: { project?: string; config: string; installed?: string },
): string[] {
  const i = subagentType.indexOf(":");
  if (i > 0) {
    const plugin = subagentType.slice(0, i);
    const name = subagentType.slice(i + 1);
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) return [];
    return installPaths(where.installed, plugin).map((p) => `${p}/agents/${name}.md`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(subagentType)) return [];
  const paths: string[] = [];
  if (where.project) paths.push(`${where.project}/.claude/agents/${subagentType}.md`);
  paths.push(`${where.config}/agents/${subagentType}.md`);
  let data: any;
  try {
    data = JSON.parse(where.installed ?? "");
  } catch {
    data = undefined;
  }
  for (const entries of Object.values(data?.plugins ?? {}))
    for (const e of Array.isArray(entries) ? (entries as any[]) : [])
      if (typeof e?.installPath === "string") paths.push(`${e.installPath}/agents/${subagentType}.md`);
  return [...new Set(paths)];
}

export type Candidate = {
  model: string;
  source: "call" | "frontmatter" | "env" | "parent";
};

/**
 * What a spawn would run on, by the engine's precedence: a fork inherits the
 * parent's; CLAUDE_CODE_SUBAGENT_MODEL with CLAUDE_CODE_SUBAGENT_MODEL_FORCE
 * set overrides everything else; then the call's model, the definition's
 * (`inherit` meaning the parent's), CLAUDE_CODE_SUBAGENT_MODEL, the parent's.
 */
export function candidate(
  e: { model?: unknown; fork?: unknown; parentModel?: unknown },
  definition: string | undefined,
  envModel: string | undefined,
  force = false,
): Candidate {
  const parent: Candidate = { model: String(e.parentModel ?? ""), source: "parent" };
  if (e.fork) return parent;
  if (force && envModel) return { model: envModel, source: "env" };
  if (typeof e.model === "string" && e.model) return { model: e.model, source: "call" };
  const fm = frontmatterModel(definition);
  if (fm && fm.toLowerCase() === "inherit") return parent;
  if (fm) return { model: fm, source: "frontmatter" };
  if (envModel) return { model: envModel, source: "env" };
  return parent;
}

/** CLAUDE_CODE_SUBAGENT_MODEL_FORCE: set and not a "no". */
export const forced = (v: string | undefined): boolean =>
  !!v && !/^(0|false|no|off)$/i.test(v.trim());

/** Whether any raw input names a gated model: a throw then refuses. */
export function anyGated(raw: unknown[], tokens: readonly string[]): boolean {
  return raw.some((r) => typeof r === "string" && isGated(r, tokens));
}

export type Verdict =
  | { kind: "pass"; why: string; model?: string }
  | { kind: "refuse"; why: string; model: string };

export type SpawnPort = {
  /** gated-models.txt as the plugin ships it */
  gated: () => Promise<string | undefined>;
  mode: () => Promise<Gate>;
  /** the agent's definition text, undefined when there is no file */
  definition: (subagentType: string) => Promise<string | undefined>;
  envModel: () => Promise<string | undefined>;
  /** CLAUDE_CODE_SUBAGENT_MODEL_FORCE */
  envForce: () => Promise<boolean>;
  granted: () => Promise<boolean>;
  grant: () => Promise<void>;
  /** the user typed at the prompt in the last 10 minutes */
  present: () => boolean;
  /** resolves to the label chosen; rejects when dismissed or nobody can answer */
  ask: (question: string, options: string[]) => Promise<string>;
};

export const ASK_YES = "Allow it for this session";
export const ASK_NO = "Refuse";

export function refusal(model: string, why: string): string {
  return [
    `GATED MODEL REFUSED — ${model} (${why})`,
    "A gated model (kodflow-hooks/hooks/gated-models.txt) runs only after the user's yes, once per session.",
    "Dispatch without that model: drop the per-call model, or pick an agent pinned to an ungated one.",
    "The user can allow it: answer yes when asked, type /model themselves, or set KODFLOW_FABLE=allow.",
    "[motif:fable]",
  ].join("\n");
}

/**
 * The decision for one spawn. A throw inside it is the caller's: it refuses
 * when a gated id appears in any raw input, and passes otherwise.
 */
export async function judgeSpawn(
  e: { subagentType?: unknown; model?: unknown; fork?: unknown; parentModel?: unknown },
  port: SpawnPort,
): Promise<Verdict> {
  const mode = await port.mode();
  if (mode === "off") return { kind: "pass", why: "KODFLOW_FABLE=off" };
  const tokens = parseGated(await port.gated());
  if (!tokens.length) return { kind: "pass", why: "nothing gated" };
  const type = typeof e.subagentType === "string" ? e.subagentType : "";
  const def = type ? await port.definition(type) : undefined;
  const c = candidate(e, def, await port.envModel(), await port.envForce());
  if (!isGated(c.model, tokens)) return { kind: "pass", why: `ungated (${c.source})`, model: c.model };
  return consent(c.model, `${c.source} model of ${type || "the agent"}`, mode, port, "dispatch");
}

/**
 * A skill whose frontmatter names a model switches the main conversation to
 * it (no switch event was recorded for that): the same rule as a spawn, on
 * the SKILL.md's frontmatter alone.
 */
export async function judgeSkill(skill: string, port: SpawnPort & { skillFile: (s: string) => Promise<string | undefined> }): Promise<Verdict> {
  const mode = await port.mode();
  if (mode === "off") return { kind: "pass", why: "KODFLOW_FABLE=off" };
  const tokens = parseGated(await port.gated());
  if (!tokens.length) return { kind: "pass", why: "nothing gated" };
  const model = frontmatterModel(await port.skillFile(skill));
  if (!model || !isGated(model, tokens)) return { kind: "pass", why: "ungated skill", model };
  return consent(model, `frontmatter model of the skill ${skill}`, mode, port, "skill");
}

// A gated candidate: the mode, the session's grant, then the user's yes
async function consent(model: string, why: string, mode: Gate, port: SpawnPort, what: string): Promise<Verdict> {
  const c = { model };
  if (mode === "pass") return { kind: "pass", why: `KODFLOW_FABLE (${why})`, model: c.model };
  if (await port.granted()) return { kind: "pass", why: `session grant (${why})`, model: c.model };
  if (!port.present())
    return { kind: "refuse", why: `${why}; nobody at the prompt to agree`, model: c.model };
  let answer: string;
  try {
    answer = await port.ask(
      `This ${what} would run on ${c.model}, a gated model (${why}). Allow gated models for the rest of this session?`,
      [ASK_YES, ASK_NO],
    );
  } catch {
    answer = "dismissed";
  }
  if (answer !== ASK_YES) return { kind: "refuse", why: `${why}; the user answered ${answer}`, model: c.model };
  await port.grant();
  return { kind: "pass", why: `granted by the user (${why})`, model: c.model };
}

export type SwitchVerdict = { kind: "pass" | "grant" | "ask" | "refuse"; why: string };

/**
 * A model switch: a /model the user typed, or the picker, is the consent
 * (D5); a switch from the SDK is not, and needs the user's yes like a spawn.
 */
export function judgeSwitch(
  e: { to_model?: unknown; requested_model?: unknown; source?: unknown },
  tokens: readonly string[],
  mode: Gate,
): SwitchVerdict {
  if (mode === "off") return { kind: "pass", why: "KODFLOW_FABLE=off" };
  if (!isGated(e.to_model, tokens) && !isGated(e.requested_model, tokens))
    return { kind: "pass", why: "ungated" };
  if (mode === "pass") return { kind: "pass", why: "KODFLOW_FABLE" };
  if (e.source === "command" || e.source === "picker")
    return { kind: "grant", why: `the user switched with ${String(e.source)}` };
  return { kind: "ask", why: `switch from ${String(e.source ?? "an unknown source")}` };
}

export const grantKey = (session: string): string => `fable:${session}`;
