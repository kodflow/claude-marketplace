// mcp-probe.ts — the shape and the size of what MCP tools return, never the
// content. Pure: register.ts hands in the result and the clock, and runs the
// append.
//
// After an MCP tool ran (and its result was veiled), one JSON line goes to
// <session dir>/mcp-shapes.jsonl: the tool's name, the form of the result,
// its keys, the types of its content blocks, its length in characters, the
// time. No value of the result is read into the line: key names and block
// types are kept only when they look like identifiers, anything else is
// written as "?". The file is 0600 and local to the session. It exists to
// say, after a few weeks, how large and how repeated MCP results are before
// anything is built on them. KODFLOW_MCP_PROBE=off turns it off.
import { safe } from "./paths.ts";

export const MCP_SHAPES = "mcp-shapes.jsonl";
const NAME_MAX = 32;
const LIST_MAX = 20;
const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** The probe's file in a session directory. */
export const shapesFile = (dir: string): string => `${dir}/${MCP_SHAPES}`;

/** One line of the journal: structure and sizes only. */
export type Shape = {
  at: number;
  tool: string;
  /** Keys of the answer (result, isError, deny, …). */
  keys: string[];
  /** What `result` is: string, array, object, null, number, … */
  form: string;
  /** Keys of `result` when it is an object. */
  resultKeys: string[];
  /** The `type` of each content block, in order. */
  blocks: string[];
  /** Length of the result serialised, in characters. */
  chars: number;
};

// A key or a type is structure when it reads like an identifier; anything
// else could be data and is not copied.
const label = (v: unknown): string =>
  typeof v === "string" && v.length <= NAME_MAX && NAME.test(v) ? v : "?";

const keysOf = (v: unknown): string[] =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.keys(v).slice(0, LIST_MAX).map(label)
    : [];

const formOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

// The content blocks of a result: the array itself, or its `content`
function blocksOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const c = (result as { content?: unknown } | null | undefined)?.content;
  return Array.isArray(c) ? c : [];
}

function sizeOf(v: unknown): number {
  try {
    if (typeof v === "string") return v.length;
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** The shape of `answer`, what a tool.call over an MCP tool resolved to. */
export function shapeOf(tool: string, answer: unknown, nowMs: number): Shape {
  const a = answer && typeof answer === "object" ? (answer as Record<string, unknown>) : {};
  const result = "result" in a ? a.result : answer;
  return {
    at: Math.floor(nowMs / 1000),
    tool: safe(tool),
    keys: keysOf(answer),
    form: formOf(result),
    resultKeys: keysOf(result),
    blocks: blocksOf(result)
      .slice(0, LIST_MAX)
      .map((b) => label((b as { type?: unknown } | null)?.type)),
    chars: sizeOf(result),
  };
}

/** The line to append, newline included. */
export const shapeLine = (s: Shape): string => `${JSON.stringify(s)}\n`;

/**
 * The command that appends a line read on stdin to `file`, 0600 whether or
 * not the file existed. argv, never a shell string built from data.
 */
export const appendArgv = (file: string): string[] => [
  "sh",
  "-c",
  'umask 077; cat >> "$1" && chmod 600 "$1"',
  "mcp-probe",
  file,
];
