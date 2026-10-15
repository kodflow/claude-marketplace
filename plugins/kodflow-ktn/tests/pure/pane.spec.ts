// pane.spec.ts — the pane against ktn-linter's own view-model fixtures
// (tests/fixtures/view, copied byte for byte at a pinned commit): every
// golden model reads back whole, the query the mod sends names the same
// expansions, the tree folds and opens by stable ids, and the drawing stays
// under the engine's 100 000 characters whatever the daemon sends.
// Issue kodflow/ktn-linter#777.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "../../hooks/mod/client.ts";
import { parseModel } from "../../hooks/mod/daemon.ts";
import { pane, safe } from "../../hooks/mod/view.ts";
import type { KtnModel, KtnSnap } from "../../types/index.d.ts";
import { WS, flush, statusJson, world } from "./harness.ts";
import { ELS, all, installH, textSize, texts } from "./render.ts";

installH();

const DIR = fileURLToPath(new URL("../fixtures/view/", import.meta.url));
const goldens = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(DIR + f, "utf8")) }));

const served = (m: KtnModel): KtnSnap => ({
  activation: "active",
  workspace: m.workspace,
  daemon: { kind: "ready", launch: "none", totals: m.totals, engine: m.state, at: 0 },
});
const draw = (m: KtnModel, actions = {}) =>
  pane(ELS, { snap: served(m), tree: { workspace: m.workspace, nodes: m.nodes, truncated: m.truncated, hidden: m.hidden }, now: 0 }, { openUi: () => undefined, ...actions });

test("the fixtures are ktn-linter's, all eight, pinned", () => {
  const source = readFileSync(DIR + "SOURCE", "utf8");
  assert.match(source, /^sha=[0-9a-f]{40}$/m);
  assert.deepEqual(goldens.map((g) => g.file).sort(), [
    "activity.json", "collapsed.json", "empty.json", "expanded.json",
    "filtered.json", "sanitised.json", "searched.json", "window.json",
  ]);
});

for (const g of goldens) {
  test(`golden ${g.name}: read back whole, drawn without a throw`, () => {
    const r = parseModel(JSON.stringify(g.model));
    assert.ok(r.ok, g.file);
    if (!r.ok) return;
    assert.equal(r.model.nodes.length, g.model.tree.nodes.length);
    assert.deepEqual(r.model.nodes.map((n) => n.id), g.model.tree.nodes.map((n: any) => n.id));
    assert.deepEqual(r.model.totals, g.model.totals);
    const tree = draw(r.model);
    assert.ok(textSize(tree) < 100_000);
  });
}

test("the expansions the mod sends are the golden query's own", async () => {
  for (const g of goldens.filter((x) => x.query.includes("expand="))) {
    const want = new URLSearchParams(g.query);
    const w = world();
    const c = new Client(w.port);
    c.setWorkspace(want.get("workspace")!);
    c.setExpand(want.getAll("expand"));
    w.daemon = async (p) => (p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 200, text: JSON.stringify(g.model) });
    await c.refresh();
    const sent = new URLSearchParams(w.requests.at(-1)!.split("?")[1]);
    assert.equal(sent.get("workspace"), want.get("workspace"));
    assert.deepEqual(sent.getAll("expand"), want.getAll("expand"), g.file);
  }
});

test("a folded directory draws its counts and none of its children; a press asks to open it", () => {
  const g = goldens.find((x) => x.name === "collapsed")!;
  const m = (parseModel(JSON.stringify(g.model)) as any).model as KtnModel;
  const pressed: string[] = [];
  const tree = draw(m, { toggle: (id: string) => pressed.push(id) });
  const pkg = all(tree, "Button").find((b) => b.props.key === "dir:pkg")!;
  assert.ok(pkg, "the folded directory is a Button keyed by its id");
  assert.ok(texts(pkg).join("").includes("▸ pkg/"));
  assert.ok(texts(pkg).join("").includes("6 · 1E 4W 1I"));
  assert.equal(all(tree, "Button").filter((b) => String(b.props.key).startsWith("file:pkg/")).length, 0);
  pkg.props.onPress();
  assert.deepEqual(pressed, ["dir:pkg"]);
});

test("the Buttons are keyed by the model's ids: a finding moved by a line keeps every key", () => {
  const g = goldens.find((x) => x.name === "expanded")!;
  const m = (parseModel(JSON.stringify(g.model)) as any).model as KtnModel;
  const moved = { ...m, nodes: m.nodes.map((n) => (n.kind === "finding" ? { ...n, line: (n.line ?? 0) + 1 } : n)) };
  const keys = (t: any) => all(t, "Button").map((b) => b.props.key).filter((k) => k !== "ktn-open-ui");
  assert.deepEqual(keys(draw(moved)), keys(draw(m)));
  assert.ok(keys(draw(m)).every((k: string) => k.startsWith("dir:") || k.startsWith("file:")));
});

test("a truncated window says so and points to the web UI, under 100 000 characters", () => {
  const nodes = [{ id: "dir:.", kind: "dir", name: ".", depth: 0, expanded: true, counts: { findings: 1, severity: { error: 1, warning: 0, info: 0 }, phase: {} } }];
  for (let i = 0; i < 999; i++)
    nodes.push({ id: `file:${"n".repeat(180)}${i}.go`, kind: "file", name: "n".repeat(180) + `${i}.go`, depth: 1, expanded: false, counts: nodes[0]!.counts } as any);
  const r = parseModel(JSON.stringify({
    schema: "v1", rev: 1, workspace: WS, state: "watching", totals: nodes[0]!.counts,
    tree: { nodes }, window: { offset: 0, limit: 1000, returned: 1000, total: 5000 }, truncated: true, activity: [],
  }));
  assert.ok(r.ok);
  if (!r.ok) return;
  const tree = draw(r.model);
  const all_ = texts(tree);
  assert.ok(all_.some((t) => t.includes("voir l'UI web")));
  assert.ok(all_.some((t) => t.includes("de plus")));
  assert.ok(textSize(tree) < 100_000, String(textSize(tree)));
});

test("a 10 000-character file name and a degenerate pane still draw a valid tree", () => {
  const long = "x".repeat(10_000) + ".go";
  const r = parseModel(JSON.stringify({
    schema: "v1", rev: 1, workspace: WS, state: "watching",
    totals: { findings: 1, severity: { error: 0, warning: 1, info: 0 }, phase: { "6": 1 } },
    tree: { nodes: [
      { id: "dir:.", kind: "dir", name: ".", depth: 0, expanded: true, counts: { findings: 1, severity: { error: 0, warning: 1, info: 0 }, phase: {} } },
      { id: `file:${long}`, kind: "file", name: long, parent: "dir:.", depth: 1, expanded: false, counts: { findings: 1, severity: { error: 0, warning: 1, info: 0 }, phase: {} } },
    ] },
    window: { offset: 0, limit: 200, returned: 2, total: 2 }, truncated: false, activity: [],
  }));
  assert.ok(r.ok);
  if (!r.ok) return;
  const tree = safe(ELS, () => draw(r.model));
  assert.equal(tree.type, "Box");
  assert.ok(texts(tree).every((t) => t.length < 400));
});

test("a drawing that throws gives the fallback tree, not a closed pane", () => {
  const tree = safe(ELS, () => {
    throw new Error("boom\u001b[2J");
  });
  assert.equal(tree.type, "Box");
  assert.deepEqual(texts(tree), ["ktn · rendu impossible", "boom [2J"]);
});

test("the seven states each draw in the pane", async () => {
  const states: [string, KtnSnap][] = [
    ["hors projet Go", { activation: "inactive" }],
    ["chargement", { activation: "active", workspace: WS, daemon: { kind: "loading", launch: "none" } }],
    ["daemon injoignable", { activation: "active", workspace: WS, daemon: { kind: "unreachable", launch: "button" } }],
    ["API incompatible", { activation: "active", workspace: WS, daemon: { kind: "incompatible", launch: "none", detail: "v2" } }],
    ["en attente d'approbation", { activation: "active", workspace: WS, daemon: { kind: "pending", launch: "none", command: "ktn-linter admin workspace approve /w/repo" } }],
    ["non servi", { activation: "active", workspace: WS, daemon: { kind: "refused", launch: "none", detail: "not served" } }],
    ["propre", { activation: "active", workspace: WS, daemon: { kind: "ready", launch: "none", totals: { findings: 0, severity: { error: 0, warning: 0, info: 0 }, phase: {} } } }],
  ];
  for (const [word, snap] of states) {
    const tree = pane(ELS, { snap, now: 0 }, { launch: () => undefined, openUi: () => undefined });
    assert.ok(texts(tree)[0]!.includes(word), `${word}: ${texts(tree)[0]}`);
  }
  await flush();
});
