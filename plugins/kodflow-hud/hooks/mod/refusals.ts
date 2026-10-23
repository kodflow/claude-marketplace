// refusals.ts — the « Refus » view's data: blocks.jsonl as kodflow-hooks
// appends it (one blocking per line, 500 kept), what has piled up, and the
// one write this mod may make for a refusal: a permission rule the person
// confirmed, added to the project's .claude/settings.local.json. Pure.

import type { HudBlock } from "../../types";

export const KINDS = [
  "hook",
  "classifier",
  "permission",
  "ci",
  "agent",
] as const;
export const HOUR_MS = 3_600_000;
/** What the view is handed: the newest, enough to fill any pane. */
export const KEEP = 200;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

/** blocks.jsonl's text, newest first; a line that is not one is skipped. */
export function parseBlocks(text: string | undefined): HudBlock[] {
  if (!text) return [];
  const out: HudBlock[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let raw: any;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = str(raw?.ts);
    const at = ts ? Date.parse(ts) : NaN;
    if (
      !ts ||
      !Number.isFinite(at) ||
      !(KINDS as readonly string[]).includes(raw.kind)
    )
      continue;
    out.push({
      ts,
      at,
      kind: raw.kind,
      summary: str(raw.summary) ?? "",
      ...(str(raw.tool) && { tool: raw.tool }),
      ...(str(raw.motif) && { motif: raw.motif }),
      ...(str(raw.agent) && { agent: raw.agent }),
      ...(str(raw.ref) && { ref: raw.ref }),
      ...(str(raw.rule) && { rule: raw.rule }),
    });
  }
  // A stable sort: two at the same second keep the file's order, reversed
  return out
    .map((b, i) => ({ b, i }))
    .sort((x, y) => y.b.at - x.b.at || y.i - x.i)
    .map((x) => x.b)
    .slice(0, KEEP);
}

export type Tally = {
  hour: Record<string, number>;
  all: Record<string, number>;
  hourTotal: number;
  total: number;
  /** The reason seen most often: a hook's motif, else the summary. */
  top?: { what: string; n: number };
};

/** How many of each kind in the last hour and since the session began. */
export function tally(blocks: readonly HudBlock[], now: number): Tally {
  const hour: Record<string, number> = {};
  const all: Record<string, number> = {};
  const why = new Map<string, number>();
  let hourTotal = 0;
  for (const b of blocks) {
    all[b.kind] = (all[b.kind] ?? 0) + 1;
    if (now - b.at < HOUR_MS) {
      hour[b.kind] = (hour[b.kind] ?? 0) + 1;
      hourTotal++;
    }
    const what = b.motif ?? b.summary;
    if (what) why.set(what, (why.get(what) ?? 0) + 1);
  }
  let top: Tally["top"];
  for (const [what, n] of why) if (!top || n > top.n) top = { what, n };
  return { hour, all, hourTotal, total: blocks.length, ...(top && { top }) };
}

/** "11:41", local time, of an ISO stamp. */
export function hhmm(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Tools a bare rule would hand over whole: a rule for one of them must say
// what it allows, inside parentheses
const WIDE = new Set([
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "PowerShell",
]);

/**
 * Whether `rule` may be offered: settings.json's shape (`Tool` or
 * `Tool(content)`), one line, at most 200 characters, and never a rule that
 * allows a whole shell or every write (`Bash`, `Bash(*)`, `Edit(**)`).
 */
export function safeRule(rule: unknown): rule is string {
  if (typeof rule !== "string" || !rule || rule.length > 200) return false;
  if (/[\u0000-\u001f\u007f]/.test(rule)) return false;
  const m = /^([A-Za-z][A-Za-z0-9_-]*)(?:\((.+)\))?$/.exec(rule);
  if (!m) return false;
  const [, tool, content] = m;
  if (content === undefined) return !WIDE.has(tool!);
  return !/^[\s*:/.~]*$/.test(content);
}

/**
 * settings.local.json with `rule` in permissions.allow. `text` is the file as
 * it stands (undefined: absent). Every other key stays where it was; a rule
 * already there changes nothing. Undefined when the file is not a JSON
 * object: it is never overwritten.
 */
export function addRule(
  text: string | undefined,
  rule: string,
): string | undefined {
  let raw: any = {};
  if (text !== undefined && text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return undefined;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  }
  const perms =
    raw.permissions &&
    typeof raw.permissions === "object" &&
    !Array.isArray(raw.permissions)
      ? raw.permissions
      : undefined;
  if (raw.permissions !== undefined && !perms) return undefined;
  if (perms && perms.allow !== undefined && !Array.isArray(perms.allow))
    return undefined;
  const allow: unknown[] = perms?.allow ?? [];
  if (allow.includes(rule)) return text;
  const permissions = { ...(perms ?? {}), allow: [...allow, rule] };
  return `${JSON.stringify({ ...raw, permissions }, null, 2)}\n`;
}
