// window.test.ts — the windowed pane in the engine (`claude plugin test`):
// one offset shared by every surface and re-clamped by each render to its
// own rows, `ui.scroll` answered by the mod with the snapshot's total, the
// next window asked for near an edge, the filter and the detail.
// Issue kodflow/ktn-linter#787.
import { test, expect } from "claude-code/testing";
import { host, lay, start } from "./host.ts";

const ANCHOR = "/u/dev/.local/state/ktn-linter/endpoint.json";
const SOCKET = "/run/user/1000/ktn-linter/user.sock";
const endpoint = () =>
  JSON.stringify({ schema: 1, socket: SOCKET, state_json: "/x/state.json", exe: "/opt/ktn/bin/ktn-linter", version: "1.46.0" });
const c = (e: number, w: number, i: number) => ({ findings: e + w + i, severity: { error: e, warning: w, info: i }, phase: { "2": e } });

/** A flat tree of `total` findings; the daemon serves [offset, offset + limit) of it. */
function daemon(total: number, name = (i: number) => `rule ${i}`) {
  return async (url: string) => {
    if (url.includes("/status")) return { status: 200, text: JSON.stringify({ protocol_version: "v1" }) };
    const q = new URL(url).searchParams;
    const offset = Number(q.get("offset") ?? 0);
    const limit = Number(q.get("limit") ?? 200);
    const nodes = [];
    for (let i = offset; i < Math.min(total, offset + limit); i++)
      nodes.push({ id: `finding:${i}`, kind: "finding", name: "", parent: `file:pkg/f${i % 7}.go`, depth: 1, expanded: false, line: i + 1, rule: "KTN-X", severity: "warning", phase: 2, message: name(i) });
    return {
      status: 200,
      text: JSON.stringify({ schema: "v1", rev: 3, workspace: "/w/repo", state: "watching", totals: c(0, total, 0), tree: { nodes }, window: { offset, limit, returned: nodes.length, total }, truncated: false, activity: [] }),
    };
  };
}

const PANE = (bodyRows: number, bodyColumns = 80) => ({
  title: "ktn",
  isFocused: false,
  bodyColumns,
  placement: "dock" as const,
  scroll: { offset: 0, bodyRows },
  view: {},
});

async function boot($: any, on: any, total: number, name?: (i: number) => string) {
  const { h, clock } = host(on);
  lay(h, "/w/repo", [".git/", "go.mod", "pkg/"]);
  h.files.set(ANCHOR, endpoint());
  h.answer = daemon(total, name);
  await start($, clock);
  await $.command.run({ command: "ktn-view", args: "" } as any);
  await clock.settle();
  return { h, clock };
}

const mount = ($: any, surface: "terminal" | "desktop", rows: number, cols?: number) =>
  $.ui.mount({ plugin: "kodflow-ktn", surface, component: "Pane", requestId: "ktn-view", props: PANE(rows, cols) });

/** The position line "lignes a–b sur t" and the rows drawn under the head. */
async function seen(ui: any) {
  const line = await ui.find({ text: /^lignes \d+–\d+ sur \d+$/ });
  const m = /^lignes (\d+)–(\d+) sur (\d+)$/.exec(line?.text ?? "");
  const finding = (await ui.findAll({ type: "Button" })).filter((b: any) => String(b.key).startsWith("finding:"));
  const waiting = await ui.findAll({ text: /^…$/ });
  return { first: Number(m?.[1]), last: Number(m?.[2]), total: Number(m?.[3]), rows: finding.length + waiting.length };
}

const scroll = ($: any, by: number, bodyRows: number) =>
  $.ui.scroll({ component: "Pane", requestId: "ktn-view", offset: 0, by, bodyRows, contentRows: bodyRows + 1, origin: { kind: "person" } } as any);

test("one pane mounted at two heights: no offset passes total − rows of its own mount", async ($, on) => {
  const { clock } = await boot($, on, 1_000);
  const heights = [["terminal", 12], ["desktop", 40]] as const;
  // At the top, each mount draws its rows plus the one spare row
  const top: Record<string, number> = {};
  for (const [surface, rows] of heights) {
    const ui = await mount($, surface, rows);
    top[surface] = (await seen(ui)).rows;
    await ui.unmount();
  }
  expect(top.desktop! > top.terminal!).toBe(true);
  // The SHORT surface scrolls to the end: the shared offset is its own
  await scroll($, 100_000, 12);
  await clock.settle();
  for (const [surface] of heights) {
    const ui = await mount($, surface, heights.find((x) => x[0] === surface)![1]);
    const s = await seen(ui);
    expect(s.total).toBe(1_000);
    expect(s.last).toBe(1_000);
    // At the end the spare row is gone: the window is exactly the mount's rows,
    // so its first row is total − rows (re-clamped), never past it
    expect(s.rows).toBe(top[surface]! - 1);
    expect(s.first - 1).toBe(1_000 - s.rows);
    await ui.unmount();
  }
});

test("a scroll near the edge of what is held asks for the next window, detached", async ($, on) => {
  const { h, clock } = await boot($, on, 1_000);
  const first = h.fetches.filter((f) => f.url.includes("/api/view")).at(-1)!;
  expect(new URL(first.url).searchParams.get("offset")).toBe("0");
  expect(new URL(first.url).searchParams.get("limit")).toBe("180");
  const before = h.fetches.length;
  // Inside the window: nothing asked
  await scroll($, 10, 20);
  await clock.settle();
  expect(h.fetches.length).toBe(before);
  // Near its end: the next window, centred on what is looked at
  await scroll($, 150, 20);
  await clock.settle();
  const next = h.fetches.filter((f) => f.url.includes("/api/view")).at(-1)!;
  const from = Number(new URL(next.url).searchParams.get("offset"));
  expect(from > 0).toBe(true);
  expect(from <= 160).toBe(true);
  expect((h.state.tree as any).from).toBe(from);
  const ui = await mount($, "terminal", 20);
  expect(await ui.find({ text: /^…$/ })).toBeUndefined();
});

test("pathological inputs: zero rows, one column, a 10 000-character message, an offset past the total", async ($, on) => {
  const { h, clock } = await boot($, on, 50, (i) => (i === 0 ? "z".repeat(10_000) : `m${i}`));
  h.plant.offset = 1_000_000;
  for (const surface of ["terminal", "desktop"] as const) {
    for (const [rows, cols] of [[0, 1], [1, 1], [3, 80]] as const) {
      const ui = await mount($, surface, rows, cols);
      const s = await seen(ui);
      expect(s.total).toBe(50);
      expect(s.first - 1 <= 50 - Math.max(1, s.rows - 1)).toBe(true);
      await ui.unmount();
    }
  }
  // The value stays as planted: each render clamps, none writes back
  expect(h.plant.offset).toBe(1_000_000);
});

test("/ktn-view filtre: the severities travel as severity=, a word it does not know is said", async ($, on) => {
  const { h, clock } = await boot($, on, 30);
  const r = await $.command.run({ command: "ktn-view", args: "filtre error,bogus" } as any);
  expect(r.text).toContain("ktn: filtre error");
  expect(r.text).toContain("bogus");
  await clock.settle();
  const asked = h.fetches.filter((f) => f.url.includes("/api/view")).at(-1)!;
  expect(new URL(asked.url).searchParams.get("severity")).toBe("error");
  expect(h.state.filter).toEqual(["error"]);
  const ui = await mount($, "terminal", 20);
  expect(await ui.find({ text: /filtre : error/ })).toBeDefined();
  await ui.unmount();
  const off = await $.command.run({ command: "ktn-view", args: "filtre" } as any);
  expect(off.text).toBe("ktn: filtre retiré");
  await clock.settle();
  const again = h.fetches.filter((f) => f.url.includes("/api/view")).at(-1)!;
  expect(new URL(again.url).searchParams.get("severity")).toBe(null);
});

test("a press on a finding shows its detail above the tree; pressed again, it goes", async ($, on) => {
  await boot($, on, 30);
  const ui = await mount($, "terminal", 30);
  await ui.press({ key: "finding:4" });
  const code = await ui.find({ type: "Code" });
  expect(code?.props.source).toBe("pkg/f4.go:5");
  expect(await ui.find({ text: /KTN-X · warning · phase 2/ })).toBeDefined();
  await ui.press({ key: "ktn-detail-close" });
  expect(await ui.find({ type: "Code" })).toBeUndefined();
});

test("scrolling: native, the way back: no window asked, the engine scrolls", { options: { scrolling: "native" } }, async ($, on) => {
  const { h, clock } = await boot($, on, 30);
  const asked = h.fetches.filter((f) => f.url.includes("/api/view")).at(-1)!;
  expect(new URL(asked.url).searchParams.get("offset")).toBe(null);
  await scroll($, 5, 10);
  await clock.settle();
  // The engine's own move, untouched
  expect(h.scrolls).toEqual([0]);
  expect(h.state.offset).toBe(0);
  const ui = await mount($, "terminal", 10);
  expect(await ui.find({ text: /^lignes / })).toBeUndefined();
});
