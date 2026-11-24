// vitals.ts — the compact vitals rows under the task tree: the context gauge,
// the prompt-cache expiry countdown and the receipt of the last turn.
// Pure: no `$`, no file, no network. Everything comes from what the host
// hands the hooks (session.measure, turn.start, turn.complete, tool calls);
// a figure the host does not give is absent, never invented, and one worked
// out here carries « (inféré) ».

import type { HudReceipt, HudVitals } from "../../types";
import { AMBER, GREEN, RED, cell, dim, type Cell, type Span } from "./layout.tsx";
import { cells } from "./width.ts";

export const NO_VITALS: HudVitals = {};

/** Whether the host has given anything to draw: no data, no rows. */
export const hasVitals = (v: HudVitals): boolean =>
  v.tokens !== undefined || v.cacheAt !== undefined || v.receipt !== undefined;

/** The two prompt-cache lifetimes the API writes. */
export const TTL_5M = 5 * 60_000;
export const TTL_1H = 60 * 60_000;

/** The tools whose success is an edit of a file. */
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

/** What a turn's usage says of the cache, as `turn.complete` carries it. */
export type CacheUsage = {
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  ephemeral_5m_input_tokens?: number;
  ephemeral_1h_input_tokens?: number;
};

/**
 * The cache lifetime a turn's usage shows: one hour when it wrote 1 h
 * tokens, five minutes when it wrote only 5 m ones; else the last known
 * (`prev`), and failing that five minutes, the API's default, unconfirmed.
 */
export function ttlOf(
  usage: CacheUsage | undefined,
  prev?: { ttlMs: number; known: boolean },
): { ttlMs: number; known: boolean } {
  const h = usage?.ephemeral_1h_input_tokens ?? 0;
  const m = usage?.ephemeral_5m_input_tokens ?? 0;
  if (h > 0) return { ttlMs: TTL_1H, known: true };
  if (m > 0) return { ttlMs: TTL_5M, known: true };
  return prev ?? { ttlMs: TTL_5M, known: false };
}

/**
 * The turn that ended at `now` kept the cache warm if it read or wrote it:
 * the countdown restarts from then. A turn that touched no cache leaves it.
 */
export function afterTurn(
  v: HudVitals,
  usage: CacheUsage | undefined,
  now: number,
): HudVitals {
  const touched =
    (usage?.cache_read_input_tokens ?? 0) +
      (usage?.cache_creation_input_tokens ?? 0) >
    0;
  if (!touched) return v;
  const t = ttlOf(
    usage,
    v.cacheTtlMs ? { ttlMs: v.cacheTtlMs, known: !!v.cacheTtlKnown } : undefined,
  );
  return { ...v, cacheAt: now, cacheTtlMs: t.ttlMs, cacheTtlKnown: t.known };
}

export type CacheState = {
  leftMs: number;
  ttlMs: number;
  /** Under its warning mark: orange. */
  soon: boolean;
  expired: boolean;
  known: boolean;
};

/** The warning mark: a fifth of the lifetime, at most five minutes. */
export function warnMs(ttlMs: number): number {
  return Math.min(5 * 60_000, Math.round(ttlMs / 5));
}

/** Where the cache stands at `now`; undefined before any turn warmed it. */
export function cacheState(v: HudVitals, now: number): CacheState | undefined {
  if (v.cacheAt === undefined || !v.cacheTtlMs) return undefined;
  const leftMs = v.cacheAt + v.cacheTtlMs - now;
  return {
    leftMs: Math.max(0, leftMs),
    ttlMs: v.cacheTtlMs,
    soon: leftMs > 0 && leftMs <= warnMs(v.cacheTtlMs),
    expired: leftMs <= 0,
    known: !!v.cacheTtlKnown,
  };
}

/** « 3m », « 45s », « 1h05 ». The minute rounds up, so « 0m » never shows. */
export function left(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** « 612k », « 1M », « 1.5M ». */
export function tok(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

// --- the receipt ------------------------------------------------------------

/** A turn begins: the counters start over. `cost` is the session's, if given. */
export function startTurn(v: HudVitals, now: number, cost?: number): HudVitals {
  return {
    ...v,
    turn: { at: now, subagents: 0, edits: 0, errors: 0, cost0: cost },
  };
}

/** A tool call of the turn, as `tool.call` resolved it. */
export function noteTool(
  v: HudVitals,
  tool: string,
  isError: boolean,
): HudVitals {
  if (!v.turn) return v;
  const turn = { ...v.turn };
  if (isError) turn.errors++;
  else if (EDIT_TOOLS.has(tool)) turn.edits++;
  return { ...v, turn };
}

/** A subagent started during the turn. */
export function noteSpawn(v: HudVitals): HudVitals {
  return v.turn ? { ...v, turn: { ...v.turn, subagents: v.turn.subagents + 1 } } : v;
}

/**
 * The turn ends: its counters become the receipt. The duration is the
 * host's own when it gives one, else the clock's between start and end. The
 * cost delta exists only when the cost was given at both ends.
 */
export function finishTurn(
  v: HudVitals,
  now: number,
  durationMs: number | undefined,
  cost?: number,
): HudVitals {
  const t = v.turn;
  if (!t) return v;
  const receipt: HudReceipt = {
    durationMs: durationMs ?? Math.max(0, now - t.at),
    subagents: t.subagents,
    edits: t.edits,
    errors: t.errors,
    ...(cost !== undefined && t.cost0 !== undefined && cost >= t.cost0
      ? { costUsd: cost - t.cost0 }
      : {}),
  };
  const { turn: _turn, ...rest } = v;
  return { ...rest, receipt };
}

/** « 4m12 », « 38s », « 1.2s ». */
export function took(ms: number): string {
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

// --- drawing ----------------------------------------------------------------

const width = (spans: Span[]) => cells(spans.map((s) => s.text).join(""));
const fits = (spans: Span[], w: number) => width(spans) <= w;

/** Context percent: the host's own measure over the window shown. */
export function ctxPercent(v: HudVitals): number | undefined {
  const w = v.window;
  if (v.tokens === undefined || !w) return undefined;
  return Math.min(999, Math.round((v.tokens / w) * 100));
}

function ctxColor(pct: number): string | undefined {
  return pct >= 85 ? RED : pct >= 70 ? AMBER : undefined;
}

function bar(pct: number, n: number): string {
  const full = Math.max(0, Math.min(n, Math.round((Math.min(pct, 100) / 100) * n)));
  return "█".repeat(full) + "░".repeat(n - full);
}

/**
 * The context segment at three sizes, richest first. The window is the
 * compaction window when the host gave it (`compact`), else the model's own
 * and the figure says « (inféré) ».
 */
function ctxSegments(v: HudVitals): Span[][] {
  const pct = ctxPercent(v);
  if (pct === undefined || v.tokens === undefined || !v.window)
    return [[{ text: "ctx —", dim: true }]];
  const color = ctxColor(pct);
  const c = (text: string): Span => (color ? { text, color } : { text });
  const inferred = v.compact ? [] : [dim(" (inféré)")];
  return [
    [
      { text: `ctx ${tok(v.tokens)}/${tok(v.window)} ` },
      c(bar(pct, 10)),
      c(` ${pct}%`),
      ...inferred,
    ],
    [{ text: `ctx ${tok(v.tokens)}/${tok(v.window)} ` }, c(`${pct}%`), ...inferred],
    [{ text: `ctx ${tok(v.tokens)} ` }, c(`${pct}%`)],
    [{ text: "ctx " }, c(`${pct}%`)],
  ];
}

/** The cache segment at three sizes; none before a turn warmed it. */
function cacheSegments(v: HudVitals, now: number): Span[][] {
  const s = cacheState(v, now);
  if (!s) return [[]];
  const color = s.expired ? RED : s.soon ? AMBER : GREEN;
  const unsure = s.known ? [] : [dim(" (inféré)")];
  if (s.expired)
    return [
      [{ text: "cache expiré", color }],
      [{ text: "cache ✗", color }],
    ];
  const rest = left(s.leftMs);
  return [
    [{ text: `cache ↻ ${rest}`, color }, ...unsure],
    [{ text: `cache ↻ ${rest}`, color }],
    [{ text: `↻ ${rest}`, color }],
  ];
}

const SEP: Span = { text: " · ", dim: true };

/** The vitals row: the richest combination of the two segments that fits. */
export function vitalsRow(v: HudVitals, now: number, w: number): Span[] {
  const ctx = ctxSegments(v);
  const cache = cacheSegments(v, now);
  for (let i = 0; i < Math.max(ctx.length, cache.length); i++) {
    const a = ctx[Math.min(i, ctx.length - 1)]!;
    const b = cache[Math.min(i, cache.length - 1)]!;
    const row = b.length ? [...a, SEP, ...b] : a;
    if (fits(row, w)) return row;
  }
  return clipTo(ctx[ctx.length - 1]!, w);
}

/** The receipt line, as long as the width allows; nothing before a turn ended. */
export function receiptRow(v: HudVitals, w: number): Span[] {
  const r = v.receipt;
  if (!r) return [];
  const err: Span = {
    text: `${r.errors} err`,
    ...(r.errors ? { color: RED } : { dim: true }),
  };
  const cost = r.costUsd !== undefined ? [`Δ$${r.costUsd.toFixed(2)}`] : [];
  const full: Span[] = [
    dim("dernier tour "),
    { text: took(r.durationMs) },
    SEP,
    { text: `${r.subagents} agt` },
    SEP,
    { text: `${r.edits} éd.` },
    SEP,
    err,
    ...cost.flatMap((t) => [SEP, { text: t }]),
  ];
  const short: Span[] = [
    { text: took(r.durationMs) },
    SEP,
    { text: `${r.subagents}a ${r.edits}é ` },
    err,
  ];
  for (const row of [full, short]) if (fits(row, w)) return row;
  return clipTo(short, w);
}

function clipTo(spans: Span[], w: number): Span[] {
  const out: Span[] = [];
  let n = 0;
  for (const s of spans) {
    let text = "";
    for (const ch of s.text) {
      const c = cells(ch);
      if (n + c > w) break;
      text += ch;
      n += c;
    }
    if (text) out.push({ ...s, text });
    if (text !== s.text) break;
  }
  return out;
}

/**
 * The vitals lines of a pane `w` columns wide: the gauge and countdown row,
 * then the receipt when there is one. Each is one cell of width `w`.
 */
export function vitalsLines(v: HudVitals, now: number, w: number): Cell[][] {
  if (w < 1) return [];
  const lines: Cell[][] = [[cell(w, vitalsRow(v, now, w))]];
  const r = receiptRow(v, w);
  if (r.length) lines.push([cell(w, r)]);
  return lines;
}
