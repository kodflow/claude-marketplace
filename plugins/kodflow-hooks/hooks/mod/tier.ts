// tier.ts — the tier rule for a Workflow's agent() calls (model-policy.md §2,
// tier-table.tsv), pure. register.ts wires it before fable.ts.
//
// The Agent tool is judged by the shell (on-tool.sh); a Workflow script is
// not, since the shell does not read JavaScript. agent.spawn carries no
// effort (tests/fixtures/T0-FINDINGS.md #14, #15), so a Workflow is judged
// once, at its tool.call, from the script text: every agent() must pass the
// model and the effort that its definition (opts.agentType) or the
// environment does not pin.
//
//   tool.call {tool:"Workflow"}  scriptPath before script; name only or
//                                resumeFromRunId: not judged. warn (the
//                                default) appends the advice to the result's
//                                `context`, an array of strings (T0 #20);
//                                enforce refuses before the run, once per
//                                script (the breaker passes the 2nd refusal).
//   agent.spawn                  never refused: a Workflow inner agent, a
//                                resume and a named agent are only logged.
//
// The grammar is deliberately small: the top-level keys of an object literal
// given as the 2nd argument of agent(). Anything it cannot read for sure — a
// computed key, a spread, a non-literal argument, a lexer state that does not
// come back to neutral — passes, logged under its reason.

import { frontmatterField } from "./fable.ts";

export type TierMode = "off" | "warn" | "enforce";
export type ModeSource =
  "KODFLOW_TIER" | "session" | "global" | "default" | "tier-skew";

const MODES = new Set(["off", "warn", "enforce"]);
const modeOf = (v: string | undefined): TierMode | undefined => {
  const m = (v ?? "").trim().toLowerCase();
  return MODES.has(m) ? (m as TierMode) : undefined;
};

/**
 * The mode, as the shell resolves it: `off` from any source wins; else
 * KODFLOW_TIER, the session's tier-mode file, the global one, then warn. A
 * skew between the hooks' table and the policy's (tier-skew) turns enforce
 * into warn. Values other than off, warn, enforce are ignored.
 */
export function resolveMode(src: {
  env?: string;
  session?: string;
  global?: string;
  skew?: boolean;
}): { mode: TierMode; source: ModeSource } {
  const ordered: [ModeSource, TierMode | undefined][] = [
    ["KODFLOW_TIER", modeOf(src.env)],
    ["session", modeOf(src.session)],
    ["global", modeOf(src.global)],
  ];
  const off = ordered.find(([, m]) => m === "off");
  if (off) return { mode: "off", source: off[0] };
  const first = ordered.find(([, m]) => m !== undefined);
  const picked = first
    ? { mode: first[1]!, source: first[0] }
    : { mode: "warn" as TierMode, source: "default" as ModeSource };
  if (picked.mode === "enforce" && src.skew)
    return { mode: "warn", source: "tier-skew" };
  return picked;
}

/** A frontmatter value that pins its field: present, not null or ~, and for model not inherit. */
export function pinned(value: string | undefined, key: string): boolean {
  if (value === undefined) return false;
  return !(key === "model" && value.toLowerCase() === "inherit");
}

/** Whether an agent definition pins `key` (model or effort). */
export const definitionPins = (
  text: string | undefined,
  key: string,
): boolean => pinned(frontmatterField(text, key), key);

/** CLAUDE_CODE_EFFORT_LEVEL pins the effort unless empty, auto or unset. */
export const envEffortPins = (v: string | undefined): boolean => {
  const s = (v ?? "").trim().toLowerCase();
  return s !== "" && s !== "auto" && s !== "unset";
};

// ---------------------------------------------------------------- lexer

type Tok =
  | { t: "id"; v: string; at: number; inTpl: boolean }
  | { t: "p"; v: string; at: number }
  | { t: "str"; v: string; at: number }
  | { t: "tpl"; v: string; at: number }
  | { t: "re"; at: number }
  | { t: "num"; at: number };

// After these words a `/` opens a regular expression, not a division
const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const isIdStart = (c: string) => /[A-Za-z_$\u0080-\uffff]/.test(c);
const isId = (c: string) => /[A-Za-z0-9_$\u0080-\uffff]/.test(c);

type Lexed = { toks: Tok[]; neutral: boolean; why?: string };

/**
 * Tokens of a script, comments dropped, strings, templates and regular
 * expressions as one token each. `neutral` is false when the text ends inside
 * a comment, a string, a template or a regex, or with brackets unbalanced.
 */
export function lex(src: string): Lexed {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0;
  // Brackets, with `${` of a template as its own opener
  const stack: string[] = [];
  const fail = (why: string): Lexed => ({ toks, neutral: false, why });
  const regexAllowed = (): boolean => {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.t === "id") return REGEX_AFTER_WORD.has(p.v);
    if (p.t === "p") return !(p.v === ")" || p.v === "]");
    return false;
  };
  // A quoted string from i (the quote), its raw body; -1 when unterminated
  const quoted = (q: string, from: number): number => {
    let j = from + 1;
    while (j < n) {
      const c = src[j]!;
      if (c === "\\") j += 2;
      else if (c === q) return j;
      else if (c === "\n" || c === "\r") return -1;
      else j++;
    }
    return -1;
  };
  // The text of each template open, innermost last
  const tplTexts: string[] = [];
  const inTpl = () => stack.includes("${");
  while (i < n) {
    const c = src[i]!;
    // Inside a template's text: up to its end or to the next ${
    if (stack[stack.length - 1] === "`") {
      if (c === "\\") {
        tplTexts[tplTexts.length - 1] += src.slice(i, i + 2);
        i += 2;
      } else if (c === "`") {
        stack.pop();
        toks.push({ t: "tpl", v: tplTexts.pop() ?? "", at: i });
        i++;
      } else if (c === "$" && src[i + 1] === "{") {
        stack.push("${");
        i += 2;
      } else {
        tplTexts[tplTexts.length - 1] += c;
        i++;
      }
      continue;
    }
    if (
      c === " " ||
      c === "\t" ||
      c === "\n" ||
      c === "\r" ||
      c === "\uFEFF" ||
      c === "\u00a0"
    ) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) return fail("unterminated comment");
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = quoted(c, i);
      if (end < 0) return fail("unterminated string");
      const raw = src.slice(i + 1, end);
      toks.push({ t: "str", v: raw, at: i });
      i = end + 1;
      continue;
    }
    if (c === "`") {
      stack.push("`");
      tplTexts.push("");
      i++;
      continue;
    }
    if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      for (; j < n; j++) {
        const d = src[j]!;
        if (d === "\n" || d === "\r") return fail("unterminated regex");
        if (d === "\\") j++;
        else if (d === "[") cls = true;
        else if (d === "]") cls = false;
        else if (d === "/" && !cls) break;
      }
      if (j >= n) return fail("unterminated regex");
      j++;
      while (j < n && isId(src[j]!)) j++;
      toks.push({ t: "re", at: i });
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isId(src[j]!)) j++;
      toks.push({ t: "id", v: src.slice(i, j), at: i, inTpl: inTpl() });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(src[j]!)) j++;
      toks.push({ t: "num", at: i });
      i = j;
      continue;
    }
    if (src.startsWith("...", i)) {
      toks.push({ t: "p", v: "...", at: i });
      i += 3;
      continue;
    }
    if (c === "?" && src[i + 1] === "." && !/[0-9]/.test(src[i + 2] ?? "")) {
      toks.push({ t: "p", v: "?.", at: i });
      i += 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c === ")" || c === "]" || c === "}") {
      const open = stack.pop();
      const want = c === ")" ? "(" : c === "]" ? "[" : "{";
      if (c === "}" && open === "${") {
        // Back into the template's text: its "`" is on top again
        tplTexts[tplTexts.length - 1] += "\u0000";
        i++;
        continue;
      }
      if (open !== want) return fail(`unbalanced ${c}`);
    }
    toks.push({ t: "p", v: c, at: i });
    i++;
  }
  if (stack.length)
    return fail(
      stack[stack.length - 1] === "`"
        ? "unterminated template"
        : "unbalanced brackets",
    );
  return { toks, neutral: true };
}

// An agent( not preceded by `.`, a word character or `$`
const AGENT_CALL_G = /(?<![.\w$])agent\s*\(/g;

/**
 * The independent count: agent( over the text with comments, quoted strings
 * and templates blanked by one regular expression. When it differs from what
 * the lexer found, one of the two misread the script.
 */
export function regexCount(src: string): number {
  const blanked = src.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\[\s\S])*`/g,
    " ",
  );
  return (blanked.match(AGENT_CALL_G) ?? []).length;
}

// ---------------------------------------------------------------- grammar

export type CallKeys = {
  /** 1-based, in the order of the text */
  index: number;
  line: number;
  /** the keys present with a value that is not empty, null or undefined */
  keys: string[];
  /** string-literal values of the keys that have one */
  values: Record<string, string>;
  /** why the call cannot be read; the keys are then meaningless */
  nonliteral?: string;
};

export type Parsed =
  { kind: "ok"; calls: CallKeys[] } | { kind: "unparsed"; why: string };

const EMPTY_VALUE = (toks: Tok[]): boolean => {
  if (toks.length !== 1) return false;
  const t = toks[0]!;
  if (t.t === "id") return t.v === "undefined" || t.v === "null";
  if (t.t === "str" || t.t === "tpl") return t.v === "";
  return false;
};

const lineAt = (src: string, at: number): number => {
  let l = 1;
  for (let k = 0; k < at && k < src.length; k++) if (src[k] === "\n") l++;
  return l;
};

/** The agent() calls of a script and the top-level keys of their options. */
export function parseScript(src: string): Parsed {
  const lx = lex(src);
  if (!lx.neutral) return { kind: "unparsed", why: lx.why ?? "lexer" };
  const toks = lx.toks;
  const calls: CallKeys[] = [];
  const P = (k: number, v: string) =>
    toks[k]?.t === "p" && (toks[k] as { v: string }).v === v;
  // From k (just past an opener), the index of the first `stop` at depth 0
  const skip = (k: number, stops: string[]): number => {
    let depth = 0;
    for (; k < toks.length; k++) {
      const t = toks[k]!;
      if (t.t !== "p") continue;
      if (depth === 0 && stops.includes(t.v)) return k;
      if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
      else if (t.v === ")" || t.v === "]" || t.v === "}") depth--;
      if (depth < 0) return -1;
    }
    return -1;
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    if (t.t !== "id" || t.v !== "agent" || t.inTpl || !P(k + 1, "(")) continue;
    const prev = toks[k - 1];
    if (prev && prev.t === "p" && (prev.v === "." || prev.v === "?.")) continue;
    const call: CallKeys = {
      index: calls.length + 1,
      line: lineAt(src, t.at),
      keys: [],
      values: {},
    };
    calls.push(call);
    const firstEnd = skip(k + 2, [",", ")"]);
    if (firstEnd < 0)
      return { kind: "unparsed", why: `agent() #${call.index}: arguments` };
    if (P(firstEnd, ")")) continue;
    let o = firstEnd + 1;
    if (P(o, ")")) continue; // a trailing comma, no options
    if (!P(o, "{")) {
      call.nonliteral = "options not an object literal";
      continue;
    }
    o++;
    while (o < toks.length && !P(o, "}")) {
      const key = toks[o]!;
      let name: string | undefined;
      if (key.t === "id") name = key.v;
      else if (key.t === "str") name = key.v;
      else if (key.t === "num") name = "#num";
      else if (key.t === "p" && key.v === "[") {
        call.nonliteral = "computed key";
        break;
      } else if (key.t === "p" && key.v === "...") {
        call.nonliteral = "spread";
        break;
      } else {
        call.nonliteral = "unexpected token in options";
        break;
      }
      o++;
      if (P(o, ",") || P(o, "}")) {
        // Shorthand: the key names a variable
        if (key.t !== "id") {
          call.nonliteral = "unexpected token in options";
          break;
        }
        call.keys.push(name);
        if (P(o, ",")) o++;
        continue;
      }
      if (!P(o, ":")) {
        call.nonliteral = "method or accessor in options";
        break;
      }
      const end = skip(o + 1, [",", "}"]);
      if (end < 0)
        return { kind: "unparsed", why: `agent() #${call.index}: options` };
      const value = toks.slice(o + 1, end);
      if (!EMPTY_VALUE(value)) {
        call.keys.push(name);
        if (value.length === 1 && value[0]!.t === "str")
          call.values[name] = (value[0] as { v: string }).v;
      }
      o = P(end, ",") ? end + 1 : end;
    }
    if (call.nonliteral) continue;
    // The literal must be the whole argument
    if (!(P(o + 1, ",") || P(o + 1, ")")))
      call.nonliteral = "options not an object literal";
  }
  const want = regexCount(src);
  if (want !== calls.length)
    return {
      kind: "unparsed",
      why: `${calls.length} agent() read, ${want} counted`,
    };
  return { kind: "ok", calls };
}

// ---------------------------------------------------------------- judge

export type TableRow = {
  kind: string;
  name: string;
  model: string;
  effort: string;
};

/** tier-table.tsv's rows: `#` lines skipped, four tab-separated fields. */
export function parseTable(text: string | undefined): TableRow[] {
  const rows: TableRow[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [kind, name, model, effort] = line.split("\t");
    if (kind && name && model && effort)
      rows.push({ kind, name, model, effort });
  }
  return rows;
}

/**
 * Where a field's value comes from, as the shell journals it:
 * "call:<v>", "frontmatter:<v>", "env:<v>", "env-forced:<v>", or "" when
 * nothing pins it. A call value that is not a string literal is "?".
 */
export type Pin = string;

export type CallVerdict = {
  index: number;
  line: number;
  agentType?: string;
  /** tier: judged (missing or not); tier-nodef: no definition, passed */
  reason: "tier" | "tier-nodef";
  exempt?: boolean;
  /** the call itself carries the field */
  has_model: boolean;
  has_effort: boolean;
  missing: string[];
  pinned_model: Pin;
  pinned_effort: Pin;
};

export type ScriptVerdict =
  | { kind: "judged"; calls: CallVerdict[]; missing: CallVerdict[] }
  | {
      kind: "pass";
      reason: "tier-unparsed" | "tier-nonliteral";
      why: string;
      calls?: number;
    };

export type ScriptPort = {
  /** an agent definition's text; undefined when there is no file */
  definition: (agentType: string) => Promise<string | undefined>;
  envModel?: string;
  envForce?: boolean;
  envEffort?: string;
  table: TableRow[];
};

// The names an agent() may give that have no definition file and pin nothing
const BUILT_IN = new Set([
  "general-purpose",
  "claude",
  "workflow-subagent",
  "Explore",
  "Plan",
]);

/** Every agent() of a script, field by field. */
export async function judgeWorkflowScript(
  src: string,
  port: ScriptPort,
): Promise<ScriptVerdict> {
  const parsed = parseScript(src);
  if (parsed.kind === "unparsed")
    return { kind: "pass", reason: "tier-unparsed", why: parsed.why };
  const odd = parsed.calls.find((c) => c.nonliteral);
  if (odd)
    return {
      kind: "pass",
      reason: "tier-nonliteral",
      why: `agent() #${odd.index} (line ${odd.line}): ${odd.nonliteral}`,
      calls: parsed.calls.length,
    };
  const exempt = new Set(
    port.table.filter((r) => r.kind === "exempt").map((r) => r.name),
  );
  const envModel = !!(port.envModel && port.envModel.trim());
  const envEffort = envEffortPins(port.envEffort);
  const calls: CallVerdict[] = [];
  for (const c of parsed.calls) {
    const has = (k: string) => c.keys.includes(k);
    if (has("agentType") && c.values.agentType === undefined)
      return {
        kind: "pass",
        reason: "tier-nonliteral",
        why: `agent() #${c.index} (line ${c.line}): agentType not a string`,
        calls: parsed.calls.length,
      };
    const type = c.values.agentType;
    const v: CallVerdict = {
      index: c.index,
      line: c.line,
      agentType: type,
      reason: "tier",
      has_model: has("model"),
      has_effort: has("effort"),
      missing: [],
      pinned_model: "",
      pinned_effort: "",
    };
    calls.push(v);
    if (type && exempt.has(type)) {
      v.exempt = true;
      continue;
    }
    let def: string | undefined;
    if (type && !BUILT_IN.has(type)) {
      def = await port.definition(type);
      if (def === undefined) {
        v.reason = "tier-nodef";
        continue;
      }
    }
    const call = (k: string) => `call:${c.values[k] ?? "?"}`;
    const fmModel = frontmatterField(def, "model");
    const fmEffort = frontmatterField(def, "effort");
    // FORCE: the environment's model replaces the call's
    if (envModel && port.envForce) v.pinned_model = `env-forced:${port.envModel!.trim()}`;
    else if (has("model")) v.pinned_model = call("model");
    else if (pinned(fmModel, "model")) v.pinned_model = `frontmatter:${fmModel}`;
    else if (envModel) v.pinned_model = `env:${port.envModel!.trim()}`;
    if (has("effort")) v.pinned_effort = call("effort");
    else if (pinned(fmEffort, "effort")) v.pinned_effort = `frontmatter:${fmEffort}`;
    else if (envEffort) v.pinned_effort = `env:${port.envEffort!.trim()}`;
    if (!v.pinned_model) v.missing.push("model");
    if (!v.pinned_effort) v.missing.push("effort");
  }
  return {
    kind: "judged",
    calls,
    missing: calls.filter((c) => c.missing.length),
  };
}

/** The command that turns the check off for one session. */
export const offCommand = (sessionDir: string): string =>
  `printf off > '${`${sessionDir}/tier-mode`.replace(/'/g, `'\\''`)}'`;

/**
 * The one message for a script with missing fields: each agent() by index,
 * the table's role rows, the mode and its source, the way to turn it off.
 */
export function advice(
  missing: CallVerdict[],
  table: TableRow[],
  mode: { mode: TierMode; source: string },
  sessionDir: string,
): string {
  const head =
    mode.mode === "enforce"
      ? "TIER CHECK REFUSED this Workflow before it ran:"
      : "TIER CHECK (warn): this Workflow runs, but";
  const lines = [
    `${head} ${missing.length} agent() call(s) leave the model or the effort to inheritance.`,
    ...missing.map(
      (c) =>
        `  agent() #${c.index} (line ${c.line}${c.agentType ? `, agentType ${c.agentType}` : ""}): missing ${c.missing.join(" and ")}`,
    ),
    "Pass on each agent() the model and the effort of the row that matches its role (tier-table.tsv); for agent() this replaces the built-in guidance to omit them:",
    ...table
      .filter((r) => r.kind === "role" && r.model !== "-")
      .map((r) => `  ${r.name}: model ${r.model}, effort ${r.effort}`),
    `Mode ${mode.mode} (source: ${mode.source}). To turn the check off for this session: ${offCommand(sessionDir)}`,
    "[motif:tier]",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------- the call

export type WorkflowInput = {
  script?: unknown;
  scriptPath?: unknown;
  name?: unknown;
  resumeFromRunId?: unknown;
};

export type Source =
  | {
      kind: "script";
      text: string;
      from: "script" | "scriptPath";
      path?: string;
    }
  | { kind: "pass"; reason: "tier-unjudged" | "tier-resume"; why: string };

export const MAX_SCRIPT = 256 * 1024;

/**
 * The project slug of the config's projects/ directory, as the engine makes
 * it (2.1.321): every character outside [A-Za-z0-9] becomes "-"; a slug over
 * 200 characters is cut at 200 and given "-<hash in base 36>", a hash this
 * module does not reproduce (scriptRoots then matches any such suffix).
 */
export const SLUG_MAX = 200;
export const projectSlug = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, "-");

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Where a scriptPath may be read from, real paths only (T0 #12): the
 * session's directory under <config>/projects, the project's tree, and the
 * session's scratchpad.
 */
export function scriptRoots(where: {
  config: string;
  cwd: string;
  project?: string;
  session: string;
}): Root[] {
  const slug = projectSlug(where.cwd);
  const roots: Root[] =
    slug.length <= SLUG_MAX
      ? [`${where.config}/projects/${slug}/${where.session}/`]
      : [
          new RegExp(
            `^${escapeRe(`${where.config}/projects/${slug.slice(0, SLUG_MAX)}-`)}[0-9a-z]+/${escapeRe(where.session)}/`,
          ),
        ];
  if (where.project) roots.push(`${where.project.replace(/\/+$/, "")}/`);
  if (where.cwd !== where.project)
    roots.push(`${where.cwd.replace(/\/+$/, "")}/`);
  return roots;
}

/** The scratchpad of a session: <tmp>/claude-<uid>/<slug>/<session>/scratchpad/ */
export const isScratchpad = (real: string, session: string): boolean =>
  new RegExp(
    `^(/private)?/tmp/claude-[0-9]+/[^/]+/${session.replace(/[^A-Za-z0-9-]/g, "\\$&")}/scratchpad/`,
  ).test(real);

/** A directory prefix, or a pattern for a session directory under a long slug */
export type Root = string | RegExp;

export const insideRoots = (
  real: string,
  roots: Root[],
  session: string,
): boolean =>
  roots.some((r) => (typeof r === "string" ? real.startsWith(r) : r.test(real))) ||
  isScratchpad(real, session);

/**
 * A path judged by its spelling alone: absolute, no `.` or `..` segment, no
 * empty segment. Symlinks are not resolved here; the caller also checks the
 * real path when the host gives one.
 */
export const plainPath = (path: string): boolean =>
  path.startsWith("/") && !path.slice(1).split("/").some((seg) => seg === "" || seg === "." || seg === "..");

export type SourcePort = {
  /** the real path and size of a file; undefined when it cannot be stat'd */
  /** size and kind of a file, and its real path when the host gives one */
  stat: (
    path: string,
  ) => Promise<{ real?: string; size: number; file: boolean } | undefined>;
  read: (path: string) => Promise<string | undefined>;
  roots: Root[];
  /** realpath of each root, for a root that is itself a symlink (/tmp on macOS) */
  session: string;
};

/** The script a Workflow call would run, or why it is not judged. */
export async function workflowSource(
  e: WorkflowInput,
  port: SourcePort,
): Promise<Source> {
  if (typeof e.resumeFromRunId === "string" && e.resumeFromRunId)
    return {
      kind: "pass",
      reason: "tier-resume",
      why: `resume of ${e.resumeFromRunId}`,
    };
  if (typeof e.scriptPath === "string" && e.scriptPath) {
    const path = e.scriptPath;
    if (!plainPath(path))
      return {
        kind: "pass",
        reason: "tier-unjudged",
        why: "scriptPath not absolute, or with a . or .. segment",
      };
    if (!insideRoots(path, port.roots, port.session))
      return {
        kind: "pass",
        reason: "tier-unjudged",
        why: "scriptPath outside the session, project and scratchpad",
      };
    const st = await port.stat(path);
    if (!st || !st.file)
      return {
        kind: "pass",
        reason: "tier-unjudged",
        why: "scriptPath not a readable file",
      };
    // A link out of the roots, when the host says where it leads
    if (st.real !== undefined && !insideRoots(st.real, port.roots, port.session))
      return {
        kind: "pass",
        reason: "tier-unjudged",
        why: "scriptPath outside the session, project and scratchpad",
      };
    if (st.size > MAX_SCRIPT)
      return {
        kind: "pass",
        reason: "tier-unjudged",
        why: "script over 256 kB",
      };
    const text = await port.read(path);
    if (text === undefined)
      return {
        kind: "pass",
        reason: "tier-unjudged",
        why: "scriptPath unreadable",
      };
    return { kind: "script", text, from: "scriptPath", path };
  }
  if (typeof e.script === "string" && e.script) {
    if (e.script.length > MAX_SCRIPT)
      return {
        kind: "pass",
        reason: "tier-unjudged",
        why: "script over 256 kB",
      };
    return { kind: "script", text: e.script, from: "script" };
  }
  if (typeof e.name === "string" && e.name)
    return {
      kind: "pass",
      reason: "tier-unjudged",
      why: `named workflow ${e.name}: no script in the call`,
    };
  return {
    kind: "pass",
    reason: "tier-unjudged",
    why: "no script, scriptPath or name",
  };
}

/**
 * SHA-256 of a script, hex (crypto.subtle: mods have no node:crypto). The
 * breaker's key is the session and this digest, whatever $.store's scope.
 */
export async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const breakerKey = async (session: string, script: string): Promise<string> =>
  `tier-breaker:${session}:${await digest(script)}`;

// ---------------------------------------------------------------- spawn

export type SpawnNote = {
  reason: "tier-workflow" | "tier-resume" | "tier-teammate";
  subagent_type: string;
  has_model: boolean;
  /** the per-call model, when the spawn names one */
  model?: string;
};

/** What agent.spawn leaves in the journal: never a refusal, often nothing. */
export function judgeSpawn(e: {
  workflow?: unknown;
  resume?: unknown;
  name?: unknown;
  subagentType?: unknown;
  model?: unknown;
}): SpawnNote | undefined {
  const type = typeof e.subagentType === "string" ? e.subagentType : "";
  const has_model = typeof e.model === "string" && e.model !== "";
  const model = has_model ? (e.model as string) : undefined;
  if (e.workflow && typeof e.workflow === "object")
    return { reason: "tier-workflow", subagent_type: type, has_model, model };
  if (e.resume && typeof e.resume === "object")
    return { reason: "tier-resume", subagent_type: type, has_model, model };
  if (typeof e.name === "string" && e.name)
    return { reason: "tier-teammate", subagent_type: type, has_model, model };
  return undefined;
}

// ---------------------------------------------------------------- journal

export type JournalLine = {
  /** ISO UTC, seconds (date -u +%FT%TZ) */
  ts: string;
  source: "mod";
  mode: TierMode;
  /** KODFLOW_TIER, the path of the tier-mode file read, default or tier-skew */
  mode_source: string;
  would_refuse: boolean;
  action: "pass" | "warn" | "refuse";
  reason: string;
  subagent_type: string;
  caller: string;
  has_model: boolean;
  has_effort: boolean;
  pinned_model: Pin;
  pinned_effort: Pin;
  tool_use_id: string;
  index?: number;
  why?: string;
};

/** The shell's timestamp: ISO UTC to the second. */
export const isoNow = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The mode's source as the shell names it: a file by its path. */
export const sourceText = (source: ModeSource, sessionDir: string, config: string): string =>
  source === "session" ? `${sessionDir}/tier-mode` : source === "global" ? `${config}/kodflow/tier-mode` : source;

export const journalFile = (sessionDir: string): string =>
  `${sessionDir}/tier.jsonl`;

/** Appends stdin to $2, creating $1 first; the file stays 0600. */
export const journalArgv = (dir: string, file: string): string[] => [
  "sh",
  "-c",
  'umask 077; mkdir -p "$1" && cat >> "$2"',
  "tier-journal",
  dir,
  file,
];

export const journalText = (lines: JournalLine[]): string =>
  lines.map((l) => JSON.stringify(l)).join("\n") + (lines.length ? "\n" : "");
