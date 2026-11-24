// vitals.test.ts — the vitals reducers and rows (vitals.ts), then the hooks
// that feed them under `claude plugin test`.
import { test, expect } from "claude-code/testing";
import {
  NO_VITALS,
  TTL_1H,
  TTL_5M,
  afterTurn,
  cacheState,
  ctxPercent,
  finishTurn,
  hasVitals,
  left,
  noteSpawn,
  noteTool,
  startTurn,
  tok,
  took,
  ttlOf,
  vitalsLines,
  vitalsRow,
  warnMs,
} from "../hooks/mod/vitals.ts";
import { AMBER, RED } from "../hooks/mod/layout.tsx";
import { cells } from "../hooks/mod/width.ts";
import { NOW, PANE, host, start, writeTasks, T } from "./host.ts";
import { capture } from "./capture.ts";

const text = (spans: { text: string }[]) => spans.map((s) => s.text).join("");

test("ttlOf reads the lifetime the usage names, else keeps the last, else assumes five minutes unconfirmed", () => {
  expect(ttlOf({ ephemeral_1h_input_tokens: 9, ephemeral_5m_input_tokens: 0 })).toEqual({ ttlMs: TTL_1H, known: true });
  expect(ttlOf({ ephemeral_5m_input_tokens: 9, ephemeral_1h_input_tokens: 0 })).toEqual({ ttlMs: TTL_5M, known: true });
  expect(ttlOf({ cache_read_input_tokens: 5 }, { ttlMs: TTL_1H, known: true })).toEqual({ ttlMs: TTL_1H, known: true });
  expect(ttlOf(undefined)).toEqual({ ttlMs: TTL_5M, known: false });
});

test("the countdown runs for both lifetimes, warns before expiry and expires", () => {
  const five = afterTurn(NO_VITALS, { cache_read_input_tokens: 1, ephemeral_5m_input_tokens: 1 }, NOW);
  expect(cacheState(five, NOW + 2 * 60_000)).toMatchObject({ leftMs: 3 * 60_000, soon: false, expired: false, known: true });
  expect(cacheState(five, NOW + 4 * 60_000 + 1_000)).toMatchObject({ soon: true, expired: false });
  expect(cacheState(five, NOW + TTL_5M)).toMatchObject({ leftMs: 0, expired: true, soon: false });

  const hour = afterTurn(NO_VITALS, { cache_creation_input_tokens: 1, ephemeral_1h_input_tokens: 1, ephemeral_5m_input_tokens: 0 }, NOW);
  expect(cacheState(hour, NOW + 30 * 60_000)).toMatchObject({ leftMs: 30 * 60_000, soon: false });
  expect(cacheState(hour, NOW + 56 * 60_000)).toMatchObject({ soon: true });
  expect(warnMs(TTL_5M)).toBe(60_000);
  expect(warnMs(TTL_1H)).toBe(5 * 60_000);
  expect(cacheState(NO_VITALS, NOW)).toBeUndefined();
});

test("a turn that touched no cache leaves the countdown alone", () => {
  const v = afterTurn(NO_VITALS, { cache_read_input_tokens: 4, ephemeral_5m_input_tokens: 1 }, NOW);
  expect(afterTurn(v, { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, NOW + 9)).toBe(v);
  expect(afterTurn(v, undefined, NOW + 9)).toBe(v);
});

test("figures format", () => {
  expect([left(45_000), left(180_000), left(60_001), left(3_900_000)]).toEqual(["45s", "3m", "2m", "1h05"]);
  expect([tok(812), tok(612_345), tok(1_000_000), tok(1_500_000)]).toEqual(["812", "612k", "1M", "1.5M"]);
  expect([took(1_240), took(38_000), took(252_000)]).toEqual(["1.2s", "38s", "4m12"]);
});

test("the receipt aggregates edits, errors, subagents and a cost delta only when given", () => {
  let v = startTurn(NO_VITALS, NOW, 1.0);
  v = noteTool(v, "Edit", false);
  v = noteTool(v, "Write", false);
  v = noteTool(v, "Read", false);
  v = noteTool(v, "Bash", true);
  v = noteTool(v, "Edit", true); // a failed edit is an error, not an edit
  v = noteSpawn(noteSpawn(v));
  const done = finishTurn(v, NOW + 9_000, 8_500, 1.25);
  expect(done.turn).toBeUndefined();
  expect(done.receipt).toEqual({ durationMs: 8_500, subagents: 2, edits: 2, errors: 2, costUsd: 0.25 });
  // no cost at the start: never invented
  const noCost = finishTurn(startTurn(NO_VITALS, NOW), NOW + 3_000, undefined, 2);
  expect(noCost.receipt).toEqual({ durationMs: 3_000, subagents: 0, edits: 0, errors: 0 });
  // counting outside a turn changes nothing
  expect(noteTool(NO_VITALS, "Edit", false)).toBe(NO_VITALS);
  expect(noteSpawn(NO_VITALS)).toBe(NO_VITALS);
  expect(finishTurn(NO_VITALS, NOW, 1)).toBe(NO_VITALS);
});

const FULL = {
  tokens: 612_000,
  window: 1_000_000,
  compact: true,
  cacheAt: NOW,
  cacheTtlMs: TTL_5M,
  cacheTtlKnown: true,
  receipt: { durationMs: 252_000, subagents: 3, edits: 12, errors: 1, costUsd: 0.4 },
};

test("rows fit every width from 24 to 120 columns, with and without data", () => {
  for (const v of [FULL, { ...FULL, compact: false, cacheTtlKnown: false }, NO_VITALS, { tokens: 900_000, window: 1_000_000, cacheAt: NOW, cacheTtlMs: TTL_1H }]) {
    for (let w = 24; w <= 120; w++) {
      for (const at of [NOW + 60_000, NOW + TTL_5M + 1, NOW + 4.5 * 60_000]) {
        const lines = vitalsLines(v, at, w);
        for (const line of lines) {
          const n = line.reduce((a, c) => a + c.w, 0);
          expect(n).toBeLessThanOrEqual(w);
          for (const c of line) expect(cells(text(c.spans ?? []))).toBeLessThanOrEqual(c.w);
        }
      }
    }
  }
});

test("the gauge labels what it infers, and the countdown goes orange then red", () => {
  expect(ctxPercent(FULL)).toBe(61);
  expect(text(vitalsRow(FULL, NOW + 2 * 60_000, 80))).toBe("ctx 612k/1M ██████░░░░ 61% · cache ↻ 3m");
  expect(text(vitalsRow({ ...FULL, compact: false }, NOW, 120))).toContain("(inféré)");
  expect(text(vitalsRow({ ...FULL, cacheTtlKnown: false }, NOW, 120))).toContain("cache ↻ 5m (inféré)");
  const soon = vitalsRow(FULL, NOW + 4.5 * 60_000, 80);
  expect(soon.find((s) => s.text.startsWith("cache"))?.color).toBe(AMBER);
  const out = vitalsRow(FULL, NOW + TTL_5M, 80);
  expect(text(out)).toContain("cache expiré");
  expect(out.find((s) => s.text.startsWith("cache"))?.color).toBe(RED);
  expect(text(vitalsRow(NO_VITALS, NOW, 24))).toBe("ctx —");
  expect(text(vitalsRow(FULL, NOW, 24)).length).toBeLessThanOrEqual(24);
});

test("the receipt line shows duration, subagents, edits, errors and the cost delta only when known", () => {
  const [, r] = vitalsLines(FULL, NOW, 100);
  expect(text(r![0]!.spans!)).toContain("dernier tour 4m12 · 3 agt · 12 éd. · 1 err · Δ$0.40");
  const [, r2] = vitalsLines({ ...FULL, receipt: { ...FULL.receipt, costUsd: undefined } }, NOW, 100);
  expect(text(r2![0]!.spans!)).not.toContain("Δ$");
  expect(vitalsLines(NO_VITALS, NOW, 40)).toHaveLength(1);
  expect(hasVitals(NO_VITALS)).toBe(false);
  expect(hasVitals(FULL)).toBe(true);
});

test("hooks feed the pane: gauge, countdown and receipt drawn, nothing written, nothing run", async ($, on) => {
  const { h, clock } = host(on);
  on("session.measure", async (_$: any, e: any) => ({ changed: e.changed }));
  on("turn.start", async (_$: any, e: any) => ({ turnId: e.turnId }));
  on("turn.complete", async (_$: any, e: any) => ({ text: e.answer }));
  on("session.usage", async () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: { tokens: 612_000, window: 1_000_000, percent: 61, breakdown: { rawMaxTokens: 1_000_000 } },
    },
  }));
  writeTasks(h, [T("1", "in_progress")], 1);
  await start($, clock);
  const files = new Set(h.files.keys());
  const runs = h.runs.length;
  await $.session.measure({
    context: { tokens: 612_000, window: 1_000_000, percent: 61 },
    rateLimits: [],
    changed: ["context"],
  } as any);
  await $.turn.start({ text: "go", turnId: "t1" } as any);
  await $.tool.call({ tool: "Edit", file_path: "/w/repo/a.ts" } as any);
  await clock.advance(10_000);
  await $.turn.complete({
    answer: "ok",
    durationMs: 10_000,
    isAborted: false,
    turnId: "t1",
    reason: "answer",
    usage: { cache_read_input_tokens: 5, ephemeral_5m_input_tokens: 1 },
  } as any);
  await clock.advance(2 * 60_000);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(100),
  });
  const out = capture(await ui.drawn({ in: "tree" }));
  expect(out).toContain("ctx 612k/1M");
  expect(out).toContain("cache ↻ 3m");
  expect(out).toContain("dernier tour 10s · 0 agt · 1 éd. · 0 err");
  await ui.unmount();
  expect(new Set(h.files.keys())).toEqual(files);
  expect(h.runs.length).toBe(runs);
});
