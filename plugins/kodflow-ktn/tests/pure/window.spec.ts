// window.spec.ts — the windowed pane's pure part (kodflow/ktn-linter#787):
// the offset's clamp and its re-clamp per render, the next window near an
// edge, the snapshot's cap, a 100 000-finding tree under the engine's
// 100 000 characters, pathological inputs, and the time each callback takes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Client } from "../../hooks/mod/client.ts";
import { WINDOW_EDGE, WINDOW_MAX_CHARS, WINDOW_ROWS } from "../../hooks/mod/contract.ts";
import { parseModel } from "../../hooks/mod/daemon.ts";
import { capWindow, clampOffset, maxOffset, nextWindow, pane, safe, scrolled } from "../../hooks/mod/view.ts";
import type { KtnNode, KtnSnap, KtnTree } from "../../types/index.d.ts";
import { WS, deferred, modelJson, statusJson, world } from "./harness.ts";
import { ELS, all, installH, textSize, texts } from "./render.ts";

installH();

const TOTAL = 100_000;
const finding = (i: number, message = `message ${i}`): KtnNode => ({
  id: `finding:${i}`, kind: "finding", name: "", parent: `file:pkg/f${i % 97}.go`, depth: 1, expanded: false,
  line: i + 1, rule: "KTN-FUNC-MAXPARAM", severity: "warning", phase: 2, message,
});
/** The window a daemon serves over a tree of 100 000 findings. */
const window100k = (from: number): KtnTree => ({
  workspace: WS, truncated: false, hidden: TOTAL - WINDOW_ROWS, from, total: TOTAL,
  nodes: Array.from({ length: WINDOW_ROWS }, (_, k) => finding(from + k)),
});
const snap: KtnSnap = {
  activation: "active", workspace: WS,
  daemon: { kind: "ready", launch: "none", totals: { findings: TOTAL, severity: { error: 0, warning: TOTAL, info: 0 }, phase: { "2": TOTAL } }, at: 0 },
};
/** The position line's numbers and the rows the render gave the tree. */
function drawn(tree: KtnTree, offset: number, bodyRows: number) {
  let rows = -1;
  const out = pane(ELS, { snap, tree, now: 0, window: { offset, bodyRows }, onLayout: (r) => (rows = r) }, { inspect: () => undefined });
  const line = texts(out).find((t) => /^lignes \d+–\d+ sur \d+$/.test(t)) ?? "";
  const [, first, last] = /^lignes (\d+)–(\d+)/.exec(line) ?? [];
  return { out, rows, first: Number(first), last: Number(last) };
}

test("clampOffset and scrolled: inside [0, total − rows], whatever they are handed", () => {
  assert.equal(maxOffset(100, 10), 90);
  assert.equal(maxOffset(5, 10), 0);
  assert.equal(maxOffset(100, 0), 99);
  assert.equal(clampOffset(-3, 100, 10), 0);
  assert.equal(clampOffset(1e9, 100, 10), 90);
  assert.equal(clampOffset(Number.NaN, 100, 10), 0);
  assert.equal(scrolled(85, 10, 100, 10), 90);
  assert.equal(scrolled(5, -10, 100, 10), 0);
  assert.equal(scrolled(5, Number.POSITIVE_INFINITY, 100, 10), 5);
  assert.equal(scrolled(5, 3, 0, 10), 0);
});

test("one offset, two mounts of different heights: each render re-clamps it to its own rows", () => {
  // The short surface scrolled to its end: the shared offset is total − ITS rows
  const tree: KtnTree = { ...window100k(TOTAL - WINDOW_ROWS) };
  const short = drawn(tree, 1e9, 12);
  const tall = drawn(tree, TOTAL - short.rows, 40);
  for (const m of [short, tall]) {
    assert.ok(m.rows > 0);
    assert.ok(m.first - 1 <= TOTAL - m.rows, `offset ${m.first - 1} past ${TOTAL} − ${m.rows}`);
    assert.equal(m.last, TOTAL);
  }
  assert.ok(tall.rows > short.rows);
});

test("the next window: nothing inside, centred near either edge, never the one held", () => {
  const t = window100k(1_000);
  assert.equal(nextWindow(t, 1_050, 30), undefined);
  const down = nextWindow(t, 1_000 + WINDOW_ROWS - WINDOW_EDGE, 30)!;
  assert.ok(down > 1_000 && down <= 1_000 + WINDOW_ROWS - WINDOW_EDGE, String(down));
  const up = nextWindow(t, 1_000 + WINDOW_EDGE - 1, 30)!;
  assert.ok(up < 1_000, String(up));
  assert.equal(nextWindow(window100k(0), 0, 30), undefined);
  assert.equal(nextWindow(undefined, 10, 30), undefined);
  const end = nextWindow(window100k(TOTAL - WINDOW_ROWS - 10), TOTAL - 5, 30)!;
  assert.equal(end, TOTAL - WINDOW_ROWS);
});

test("a window capWindow cut short still advances: the next one starts past what it asked before", () => {
  // 180 nodes in all, the window from 0 cut to 100 by the cap: centring on
  // WINDOW_ROWS asked for 0 again, and rows 100-179 stayed "…" for good
  const cut: KtnTree = { ...window100k(0), total: WINDOW_ROWS, nodes: window100k(0).nodes.slice(0, 100) };
  const offset = 90;
  const rows = 20;
  const next = nextWindow(cut, offset, rows);
  assert.ok(next !== undefined && next > 0, String(next));
  assert.ok(next! <= offset && offset + rows <= next! + 100, `${next} does not hold [${offset}, ${offset + rows})`);
  // Uncut, the same view asks nothing: the end of the tree is held
  assert.equal(nextWindow({ ...window100k(0), total: WINDOW_ROWS }, offset, rows), undefined);
});

test("an answer to a query that no longer stands is dropped: its revision never goes out with the new window", async () => {
  const w = world();
  const c = new Client(w.port);
  c.windowed = true;
  c.setWorkspace(WS);
  const slow = deferred<{ status: number; text: string }>();
  w.daemon = async (p) => (p.startsWith("/status") ? { status: 200, text: statusJson() } : slow.promise);
  const pending = c.refresh();
  await new Promise((r) => setImmediate(r));
  // The pane scrolled while the old window's request was in flight
  assert.equal(c.setWindow(360), true);
  slow.resolve({ status: 200, text: modelJson({ rev: 42 }) });
  await pending;
  assert.equal(c.rev, 0);
  assert.equal(c.model, undefined);
  w.daemon = async (p) => (p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 204, text: "" });
  await c.refresh();
  const sent = new URLSearchParams(w.requests.at(-1)!.split("?")[1]);
  assert.equal(sent.get("since"), null);
  assert.equal(sent.get("offset"), "360");
});

test("the snapshot is cut at WINDOW_MAX_CHARS of text", () => {
  const heavy = Array.from({ length: WINDOW_ROWS }, (_, k) => finding(k, "m".repeat(500)));
  const kept = capWindow(heavy);
  assert.ok(kept.length < heavy.length && kept.length > 0);
  assert.ok(JSON.stringify(kept).length < WINDOW_MAX_CHARS * 1.5);
  const light = heavy.slice(0, 3);
  assert.equal(capWindow(light), light);
});

test("a tree of 100 000 findings draws under 100 000 characters, windowed and native", () => {
  for (const offset of [0, 50_000, 1e9]) {
    const { out } = drawn(window100k(clampOffset(offset, TOTAL, WINDOW_ROWS)), offset, 60);
    assert.ok(textSize(out) < 100_000, String(textSize(out)));
  }
  // Native: the daemon's largest window, 1 000 nodes of the longest message it sends
  const r = parseModel(JSON.stringify({
    schema: "v1", rev: 1, workspace: WS, state: "watching", totals: snap.daemon!.totals,
    tree: { nodes: Array.from({ length: 1_000 }, (_, k) => finding(k, "w".repeat(200))) },
    window: { offset: 0, limit: 1_000, returned: 1_000, total: TOTAL }, truncated: true, activity: [],
  }));
  assert.ok(r.ok);
  if (!r.ok) return;
  const native = pane(ELS, { snap, tree: r.model, now: 0 }, {});
  assert.ok(textSize(native) < 100_000, String(textSize(native)));
});

test("pathological inputs draw a valid tree without a throw", () => {
  const long = { ...window100k(0), total: 3, nodes: [finding(0, "z".repeat(10_000)), finding(1), finding(2)] };
  for (const [offset, bodyRows] of [[0, 0], [1e9, 0], [1e9, 1], [-5, 3], [Number.NaN, Number.NaN], [2, 1e9]] as const) {
    let threw = false;
    const out = safe(ELS, () => {
      try {
        return pane(ELS, { snap, tree: long, now: 0, window: { offset, bodyRows } }, { inspect: () => undefined });
      } catch (err) {
        threw = true;
        throw err;
      }
    });
    assert.equal(threw, false, `${offset}/${bodyRows}`);
    assert.equal(out.type, "Box");
    assert.ok(texts(out).some((t) => /^lignes \d+–\d+ sur 3$/.test(t)), `${offset}/${bodyRows}`);
  }
});

test("the detail of a pressed finding: rule, severity, phase, file:line, message", () => {
  const t = window100k(0);
  const pressed: string[] = [];
  const out = pane(ELS, { snap, tree: t, now: 0, window: { offset: 0, bodyRows: 30 }, detail: "finding:4" }, { inspect: (id) => pressed.push(id) });
  assert.equal(all(out, "Code")[0]!.props.source, "pkg/f4.go:5");
  assert.ok(texts(out).includes("KTN-FUNC-MAXPARAM · warning · phase 2"));
  all(out, "Button").find((b) => b.props.key === "finding:7")!.props.onPress();
  assert.deepEqual(pressed, ["finding:7"]);
});

test("the windowed client names its window and its filter; the native one does not", async () => {
  const w = world();
  const c = new Client(w.port);
  c.setWorkspace(WS);
  w.daemon = async (p) => (p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 204, text: "" });
  await c.refresh();
  let sent = new URLSearchParams(w.requests.at(-1)!.split("?")[1]);
  assert.equal(sent.get("offset"), null);
  c.windowed = true;
  assert.equal(c.setWindow(360), true);
  assert.equal(c.setWindow(360), false);
  c.setFilter(["error", "warning"]);
  assert.equal(c.from, 0);
  c.setWindow(360);
  await c.refresh();
  sent = new URLSearchParams(w.requests.at(-1)!.split("?")[1]);
  assert.equal(sent.get("offset"), "360");
  assert.equal(sent.get("limit"), String(WINDOW_ROWS));
  assert.equal(sent.get("severity"), "error,warning");
});

test("no callback of the windowed pane takes more than 20 ms on 100 000 findings", () => {
  const t = window100k(50_000);
  const bodyRows = 60;
  // The scroll's work, then the render's, from one offset to the next
  const run = (from: number) => {
    const offset = scrolled(from, 3, TOTAL, bodyRows - 6);
    nextWindow(t, offset, bodyRows - 6);
    capWindow(t.nodes);
    pane(ELS, { snap, tree: t, now: 0, window: { offset, bodyRows } }, { inspect: () => undefined });
  };
  const offsets = Array.from({ length: 200 }, (_, i) => 50_010 + 3 * i);
  for (const o of offsets.slice(0, 50)) run(o);
  // A callback's cost is the least of five runs of it: a preempted run or a
  // collection on a shared runner only adds time, never takes it away, so
  // the bound is held on what the code costs and not on the machine's noise.
  let worst = 0;
  for (const o of offsets) {
    let least = Infinity;
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      run(o);
      least = Math.min(least, performance.now() - t0);
    }
    worst = Math.max(worst, least);
  }
  assert.ok(worst < 20, `${worst.toFixed(2)} ms`);
});
