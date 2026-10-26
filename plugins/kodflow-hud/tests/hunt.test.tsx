// hunt.test.tsx — the « Chasse » view: status.json read as /hunt v1 writes
// it (the shared fixtures, hunt-fixtures.ts), a torn file and an unknown
// version said so, « figée » and « orpheline probable » only in an active
// state, the toast cursor, the tab only while a hunt is listed, and
// « reprendre » drafting `/hunt --resume`, never sending it.
import { test, expect } from "claude-code/testing";
import { NOW, PANE, T, host, start, writeTasks } from "./host.ts";
import type { Host } from "./host.ts";
import { capture, widths } from "./capture.ts";
import { STATUS_TORN, STATUS_V1, STATUS_V99 } from "./hunt-fixtures.ts";
import {
  ORPHAN_MS,
  STALL_MS,
  activeFile,
  canResume,
  flagsOf,
  huntRoot,
  huntTab,
  huntToasts,
  parseActive,
  parseStatus,
  readHunt,
  statusFile,
} from "../hooks/mod/hunt.ts";
import { tabsLines } from "../hooks/mod/layout.tsx";
import type { HudHuntRun } from "../types";

const ROOT = "/u/dev/.local/state/hunt";
const ACTIVE = `${ROOT}/active.json`;
const SLUG = "payments-ledger";
const STATUS = `${ROOT}/${SLUG}/status.json`;
const MIN = 60_000;

/** The v1 fixture with some fields replaced. */
const statusText = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ ...JSON.parse(STATUS_V1), ...over });
const entry = (over: Record<string, unknown> = {}) => ({
  slug: SLUG,
  created: NOW - 3_600_000,
  owner: { session: "s", proc: { pid: 1, starttime: 1, boot_id: "b" } },
  beat: NOW - MIN,
  watch: null,
  state: "hunting",
  ...over,
});
const activeText = (...hunts: object[]) =>
  JSON.stringify({ v: 1, hunts: hunts.length ? hunts : [entry()] });

const runOf = (over: Record<string, unknown> = {}, e = {}): HudHuntRun => {
  const h = readHunt(activeText(entry(e)), () => statusText(over));
  return h.runs[0]!;
};

// --- pure ----------------------------------------------------------------------------

test("status-v1: the fixture /hunt writes, unknown fields left aside", () => {
  const r = parseStatus(STATUS_V1);
  if (!("status" in r)) throw new Error(r.problem);
  const s = r.status;
  expect(s.seq).toBe(412);
  expect(s.state).toBe("hunting");
  expect(s.counter).toEqual({ open: 7, cap: 10, resumeAt: 7 });
  expect(s.pass).toEqual({ n: 2, sha: "3f9c2e1a7b4d", done: 3, total: 8 });
  expect(s.queue.tokens).toBe(2);
  expect(s.queue.holders.map((h) => h.slug)).toEqual([SLUG, ""]);
  expect(s.queue.waiting[0]!.label).toBe("vet tags=integration");
  expect(s.codex).toEqual({ pending: 1, done: 3, skipped: 1, abandoned: 0 });
  expect(s.decisions).toEqual([
    {
      repo: "core",
      issue: "111",
      title: "Reject or queue postings after the settlement cut-off?",
    },
  ]);
  expect(s.busy).toEqual({ since: 1793019600000, deadline: 1793021400000 });
  expect(s.notifyFailed).toBe(false);
  expect(s.events.map((e) => e.seq)).toEqual([380, 388, 395, 401, 405, 410]);
  // counter.issues, pass.cells, codex.by_issue: not part of the view's model
  expect(JSON.stringify(s)).not.toContain("core#101");
});

test("a torn status.json is « état illisible », an unknown version is said, nothing guessed", () => {
  expect(parseStatus(STATUS_TORN)).toEqual({ problem: "état illisible" });
  expect(parseStatus(STATUS_V99)).toEqual({
    problem: "format v99 non lu, mettre à jour kodflow-hud",
  });
  expect(parseStatus(undefined)).toEqual({ problem: "état illisible" });
  expect(parseActive('{"v":2,"hunts":[]}')).toEqual({
    problem: "format v2 non lu, mettre à jour kodflow-hud",
  });
  expect(parseActive(undefined)).toEqual({ entries: [] });
  const h = readHunt(activeText(), () => STATUS_V99);
  expect(h.runs[0]!.status).toBeUndefined();
  expect(h.runs[0]!.problem).toContain("format v99");
});

test("paths from HOME and the slug made safe, never from a field", () => {
  expect(huntRoot("/u/dev/")).toBe(ROOT);
  expect(huntRoot(undefined)).toBeUndefined();
  expect(huntRoot("rel")).toBeUndefined();
  expect(activeFile(ROOT)).toBe(ACTIVE);
  expect(statusFile(ROOT, SLUG)).toBe(STATUS);
  expect(statusFile(ROOT, "../../etc")).toBe(`${ROOT}/------etc/status.json`);
});

test("« figée » and « orpheline probable » only in an active state, a live job keeps it awake", () => {
  const old = NOW - STALL_MS - MIN;
  // beat old, no job: stalled
  expect(flagsOf(runOf({ beat: old, busy: null }, { beat: old }), NOW)).toEqual(
    {
      stalled: true,
      orphan: false,
      busy: false,
    },
  );
  // a job of the hunt running, before its deadline: not stalled
  const busy = { since: old, deadline: NOW + MIN };
  expect(flagsOf(runOf({ beat: old, busy }, { beat: old }), NOW).stalled).toBe(
    false,
  );
  // past its deadline, the job counts as none
  const late = { since: old, deadline: NOW - 1 };
  expect(
    flagsOf(runOf({ beat: old, busy: late }, { beat: old }), NOW).stalled,
  ).toBe(true);
  // paused or waiting on its merge: never judged
  for (const state of ["paused", "awaiting-merge", "done"])
    expect(
      flagsOf(runOf({ beat: 0, busy: null, state }, { beat: 0, state }), NOW),
    ).toEqual({ stalled: false, orphan: false, busy: false });
  // very old: orphan; or the watchdog said the owner is gone
  const gone = NOW - ORPHAN_MS - MIN;
  expect(
    flagsOf(runOf({ beat: gone, busy: null }, { beat: gone }), NOW).orphan,
  ).toBe(true);
  const events = [
    {
      seq: 413,
      kind: "stall",
      text: `propriétaire mort : /hunt --resume ${SLUG}`,
    },
  ];
  const fresh = runOf(
    { beat: NOW - MIN, busy: null, events },
    { beat: NOW - MIN },
  );
  expect(flagsOf(fresh, NOW).orphan).toBe(true);
  expect(canResume({ found: true, runs: [fresh] }, SLUG, NOW)).toBe(true);
  expect(canResume({ found: true, runs: [fresh] }, "other", NOW)).toBe(false);
  expect(
    canResume({ found: true, runs: [runOf({ beat: NOW })] }, SLUG, NOW),
  ).toBe(false);
});

test("toasts: silent reference, ≤3 then « +N autres », lower seq ignored, a reused slug starts over", () => {
  const ev = (seq: number, kind = "confirmed") => ({
    seq,
    kind,
    text: `e${seq}`,
  });
  const hunt = (seq: number, events: object[], created = 1) =>
    readHunt(activeText(entry({ created })), () => statusText({ seq, events }));
  // first read: the reference, nothing toasted
  let r = huntToasts(hunt(10, [ev(9), ev(10)]), {});
  expect(r.toasts).toEqual([]);
  expect(r.cursor).toEqual({ [SLUG]: { created: 1, seq: 10 } });
  // five new, one of them a decision (/hunt's own notification): 3 then +1
  r = huntToasts(
    hunt(15, [ev(10), ev(11), ev(12, "decision"), ev(13), ev(14), ev(15)]),
    r.cursor,
  );
  expect(r.toasts).toEqual([
    `Chasse ${SLUG} · confirmée : e11`,
    `Chasse ${SLUG} · confirmée : e13`,
    `Chasse ${SLUG} · confirmée : e14`,
    "Chasse : +1 autres",
  ]);
  expect(r.cursor[SLUG]!.seq).toBe(15);
  // an older snapshot: ignored, the cursor kept
  const older = huntToasts(hunt(12, [ev(11), ev(12)]), r.cursor);
  expect(older.toasts).toEqual([]);
  expect(older.cursor[SLUG]!.seq).toBe(15);
  // the slug reused (a new `created`): from zero
  const reused = huntToasts(hunt(2, [ev(1), ev(2)], 2), r.cursor);
  expect(reused.toasts).toHaveLength(2);
  expect(reused.cursor).toEqual({ [SLUG]: { created: 2, seq: 2 } });
});

test("the tab's label keeps one width; several hunts show the busiest and ×N", () => {
  const one = readHunt(activeText(), () => STATUS_V1);
  expect(huntTab(one)).toBe(`Chasse 7/10${" ".repeat(4)}`);
  const two = readHunt(activeText(entry(), entry({ slug: "other" })), (slug) =>
    slug === "other"
      ? statusText({ counter: { open: 9, cap: 12 } })
      : STATUS_V1,
  );
  expect(huntTab(two)).toBe(`Chasse 9/12 ×2${" "}`);
  expect(huntTab(one)!.length).toBe(huntTab(two)!.length);
  expect(huntTab(readHunt(activeText(), () => STATUS_TORN))!.trim()).toBe(
    "Chasse ?",
  );
  expect(huntTab({ found: false, runs: [] })).toBeUndefined();
  expect(huntTab(one, true)).toBe("Chasse");
});

test("the bar: « Chasse » last, its counter from 64 cells, alone below, and nothing without a hunt", () => {
  const text = (w: number, hunt?: string) =>
    tabsLines("tree", w, { blocks: 0, docs: 0, ...(hunt && { hunt }) })
      .lines[1]!.map((c) =>
        (c.spans ?? [])
          .map((s) => s.text)
          .join("")
          .padEnd(c.w),
      )
      .join("")
      .replace(/\u2007/g, " ");
  const label = huntTab(readHunt(activeText(), () => STATUS_V1))!;
  expect(text(88)).toBe(
    "Arbre   Graphe   Refus (0)    Documents (0)               ↑↓ choisir · ⏎ plier · tab vue",
  );
  expect(text(88, label)).toMatch(
    /^Arbre   Graphe   Refus \(0\)    Documents \(0\)    Chasse 7\/10 +↑↓ ⏎ tab$/,
  );
  expect(text(88, label)).toHaveLength(88);
  expect(text(60, label).trimEnd()).toBe(
    "Arbre   Graphe   Refus (0)    Documents (0)    Chasse",
  );
  expect(text(40, label).trimEnd()).toBe(
    "Arbre Graphe Refus Docs Chasse  ↑↓ ⏎ tab",
  );
  // too narrow even for « Chasse »: the tab key still reaches it
  const t = tabsLines("tree", 26, { blocks: 0, docs: 0, hunt: label });
  expect(t.tabs.map((x) => x.view)).toEqual([
    "tree",
    "graph",
    "blocks",
    "docs",
  ]);
});

// --- in the engine ------------------------------------------------------------------------

const mount = ($: any, w = 88, rows = 30) =>
  $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(w, rows),
  });
const lines = async (ui: any) =>
  capture(await ui.drawn({ in: "tree" })).split("\n");
const click = (ui: any, x: number, y: number) =>
  ui.pointer({ type: "down", x, y, button: "left" });

/** A session with one hunt, its beat fresh unless `over` says otherwise. */
async function hunting($: any, on: any, over: Record<string, unknown> = {}) {
  const seen = { fills: [] as string[], box: "" };
  on("prompt.read", async () => ({ value: { text: seen.box, cursor: 0 } }));
  on("prompt.fill", async (_$: any, e: any) => {
    seen.fills.push(e.text);
    seen.box = e.text;
    return { isFilled: true };
  });
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  setHunt(h, { beat: NOW - MIN, ...over });
  await start($, clock);
  return { h, clock, seen };
}
const setHunt = (h: Host, over: Record<string, unknown>) => {
  // active.json mirrors the status' beat, as hunt-ledger writes it
  h.files.set(ACTIVE, {
    text: activeText(entry({ beat: over.beat ?? NOW - MIN })),
    mtimeMs: 1,
  });
  h.files.set(STATUS, { text: statusText(over), mtimeMs: 1 });
};

test("no hunt: no « Chasse » tab, and tab goes round the four views", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  await start($, clock);
  const ui = await mount($, 88, 20);
  expect((await lines(ui))[19]).not.toContain("Chasse");
  for (let i = 0; i < 4; i++) await ui.key({ key: "tab" });
  expect((await lines(ui))[0]).toContain("SDK status-line");
});

test("a hunt listed: « Chasse » last in the bar, tab reaches it, every line at its width", async ($, on) => {
  await hunting($, on);
  const ui = await mount($, 88, 30);
  const bar = (await lines(ui))[29]!;
  expect(bar).toMatch(/Documents \(0\)\s+Chasse 7\/10/);
  for (let i = 0; i < 4; i++) await ui.key({ key: "tab" });
  const tree = await ui.drawn({ in: "tree" });
  expect(widths(tree)).toEqual(Array(30).fill(88));
  const view = capture(tree);
  expect(view.split("\n")[0]).toMatch(/^─ Chasse · 1 chasse listée ─/);
  expect(view).toContain(`● ${SLUG} · chasse`);
  expect(view).toMatch(/compteur +7\/10 ouvertes · reprise à 7/);
  expect(view).toMatch(/passe +n°2 · 3f9c2e1a7b4d · 3\/8 cases/);
  expect(view).toContain(
    `2 jetons · ${SLUG} « witness post-retry-idempotent x20 », hors c…`,
  );
  expect(view).toMatch(
    /en attente +payments-ledger « vet tags=integration » · depuis/,
  );
  expect(view).toMatch(/bout +8a1d0c4e9f2b/);
  expect(view).toMatch(
    /Codex +1 en attente · 3 faites · 1 sautée · 0 abandonnée/,
  );
  expect(view).toContain("core#111 Reject or queue postings");
  expect(view).toMatch(/battement +il y a 1 min/);
  // the digest, on a first visit: the last events
  expect(view).toMatch(/nouveau +#380 confirmée core k=4\/20 p=0\.2/);
  expect(view).not.toContain("figée ·");
  expect(view).not.toContain("[reprendre]");
  // tab again: back to the tree
  await ui.key({ key: "tab" });
  expect((await lines(ui))[0]).toContain("SDK status-line");
});

test("the digest: what came after the view was last left", async ($, on) => {
  const { h, clock } = await hunting($, on);
  const ui = await mount($, 88, 30);
  await click(ui, 50, 29); // « Chasse »
  await click(ui, 1, 29); // back to « Arbre »: the view left at seq 412
  const events = [
    ...JSON.parse(STATUS_V1).events,
    { seq: 413, kind: "integrate-fail", text: "core #112 build" },
  ];
  setHunt(h, { beat: NOW - MIN, seq: 413, events });
  await clock.advance(3_000);
  await ui.redraw();
  await click(ui, 50, 29);
  const view = (await lines(ui)).join("\n");
  expect(view).toMatch(/nouveau +#413 intégration rejetée core #112 build/);
  expect(view).not.toContain("#380");
});

test("an unreadable status.json or an unknown version is said in the view", async ($, on) => {
  const { h, clock } = await hunting($, on);
  h.files.set(STATUS, { text: STATUS_V99, mtimeMs: 1 });
  await clock.advance(3_000);
  const ui = await mount($, 88, 30);
  await click(ui, 50, 29);
  const view = (await lines(ui)).join("\n");
  expect(view).toMatch(/état +format v99 non lu, mettre à jour kodflow-hud/);
  expect(view).not.toContain("7/10");
  expect((await lines(ui))[29]).toContain("Chasse ?");
});

test("a rewrite of the same size at the same time is seen: the text is compared, not the stat", async ($, on) => {
  const { h, clock } = await hunting($, on);
  const before = statusText({ beat: NOW - MIN });
  const after = before.replace('"open":7', '"open":8');
  expect(after.length).toBe(before.length);
  h.files.set(STATUS, { text: after, mtimeMs: 1 });
  await clock.advance(3_000);
  const ui = await mount($, 88, 30);
  expect((await lines(ui))[29]).toContain("Chasse 8/10");
});

test("the hunt gone while shown: the tree, and tab no longer stops on « Chasse »", async ($, on) => {
  const { h, clock } = await hunting($, on);
  const ui = await mount($, 88, 30);
  await click(ui, 50, 29);
  expect((await lines(ui))[0]).toContain("Chasse");
  h.files.delete(ACTIVE);
  await clock.advance(3_000);
  await ui.redraw();
  expect((await lines(ui))[0]).toContain("SDK status-line");
  expect((await lines(ui))[29]).not.toContain("Chasse");
  for (let i = 0; i < 4; i++) await ui.key({ key: "tab" });
  expect((await lines(ui))[0]).toContain("SDK status-line");
});

test("« figée » shown on an old beat, « orpheline probable » with « reprendre »", async ($, on) => {
  const old = NOW - ORPHAN_MS - MIN;
  const { seen } = await hunting($, on, { beat: old, busy: null });
  const ui = await mount($, 88, 30);
  await click(ui, 50, 29);
  const view = await lines(ui);
  expect(view[1]).toMatch(
    new RegExp(`^◆ ${SLUG} · chasse · orpheline probable +\\[reprendre\\]$`),
  );
  // « reprendre »: the draft in the box, never sent
  await click(ui, 80, 1);
  expect(seen.fills).toEqual([`/hunt --resume ${SLUG}`]);
  // a slug not listed, or not orphaned, is never drafted
  seen.box = "";
  await ui.post({ op: "resume", slug: "other" });
  await ui.post({ op: "resume", slug: "../x" });
  expect(seen.fills).toHaveLength(1);
});

test("a hunt paused for hours is neither « figée » nor orphaned", async ($, on) => {
  const { seen } = await hunting($, on, {
    beat: NOW - ORPHAN_MS * 2,
    busy: null,
    state: "paused",
    pause: { reason: "décision attendue", since: NOW - ORPHAN_MS * 2 },
  });
  const ui = await mount($, 88, 30);
  await click(ui, 50, 29);
  const view = (await lines(ui)).join("\n");
  expect(view).toContain(`● ${SLUG} · pause`);
  expect(view).toMatch(/pause +décision attendue depuis/);
  expect(view).not.toContain("figée ·");
  expect(view).not.toContain("[reprendre]");
  await ui.post({ op: "resume", slug: SLUG });
  expect(seen.fills).toEqual([]);
});

test("notify_failed is said", async ($, on) => {
  await hunting($, on, { notify_failed: true });
  const ui = await mount($, 88, 30);
  await click(ui, 50, 29);
  expect((await lines(ui)).join("\n")).toMatch(
    /notification +en échec · le watchdog réessaie/,
  );
});
