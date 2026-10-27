// panels.test.tsx — the « Refus » and « Documents » views: drawn from
// blocks.jsonl and docs.json as the contract writes them (fixtures.ts), and
// the three writes a click or a key may make: a rule confirmed into
// .claude/settings.local.json, a document ignored or brought back in
// docs/manifest.json, the docs prompt drafted in an empty prompt box.
import { test, expect } from "claude-code/testing";
import { NOW, PANE, T, host, start, writeTasks } from "./host.ts";
import { capture, widths } from "./capture.ts";
import {
  BLOCKS,
  DOCS,
  MANIFEST,
  SETTINGS,
  blocksJsonl,
  docsJson,
  iso,
  manifestJson,
} from "./fixtures.ts";
import {
  CATALOG,
  createPrompt,
  manifestPath,
  parseDocs,
  toggleManifest,
} from "../hooks/mod/docs.ts";
import {
  addRule,
  hhmm,
  parseBlocks,
  safeRule,
  tally,
} from "../hooks/mod/refusals.ts";
import { countsOf } from "../hooks/mod/panels.ts";

// --- pure ------------------------------------------------------------------------

test("docs.json is read as the contract writes it; a broken one is no docs", () => {
  const d = parseDocs(docsJson);
  expect(d.found).toBe(true);
  expect(d.root).toBe("/w/repo");
  expect(d.docs.map((x) => `${x.id}:${x.state}`)).toEqual([
    "prd:ok",
    "trd:missing",
    "flow:missing",
    "design:ignored",
    "readme:ok",
  ]);
  expect(d.docs[3]!.reason).toBe("aucune interface hors du site");
  expect(manifestPath(d)).toBe(MANIFEST);
  expect(manifestPath({ ...d, manifest: "../etc/x.json" })).toBeUndefined();
  expect(parseDocs("{").found).toBe(false);
  expect(parseDocs(undefined).found).toBe(false);
  expect(CATALOG.length).toBe(15);
});

test("the manifest rewritten: unknown keys kept, catalogue order, two spaces, a final newline", () => {
  const ignored = toggleManifest(manifestJson, "flow", true)!;
  expect(ignored).toBe(
    `${JSON.stringify(
      {
        version: 1,
        documents: {
          prd: { path: "docs/vision.md" },
          flow: { ignored: "" },
          design: { ignored: "aucune interface hors du site" },
        },
        owner: "équipe",
      },
      null,
      2,
    )}\n`,
  );
  // brought back: an entry left empty goes, one with a path keeps it
  const back = JSON.parse(toggleManifest(ignored, "design", false)!);
  expect(Object.keys(back.documents)).toEqual(["prd", "flow"]);
  const prd = JSON.parse(toggleManifest(manifestJson, "prd", true)!);
  expect(prd.documents.prd).toEqual({ path: "docs/vision.md", ignored: "" });
  // absent: version and documents; not an object: never overwritten
  expect(JSON.parse(toggleManifest(undefined, "adr", true)!)).toEqual({
    version: 1,
    documents: { adr: { ignored: "" } },
  });
  expect(toggleManifest("[1]", "adr", true)).toBeUndefined();
  expect(toggleManifest("{", "adr", true)).toBeUndefined();
});

test("the docs prompt: the ids given, else every missing one, and the mode", () => {
  expect(createPrompt(["trd"], "both")).toBe(
    "/kodflow-workflow:docs trd --mode both",
  );
  expect(createPrompt(["trd", "flow"], "ask")).toBe(
    "/kodflow-workflow:docs trd,flow --mode ask",
  );
  expect(createPrompt([], "context")).toBe(
    "/kodflow-workflow:docs --mode context",
  );
});

test("blocks.jsonl newest first, a broken line skipped; the hour and the session counted", () => {
  const b = parseBlocks(blocksJsonl);
  expect(b.map((x) => x.kind)).toEqual([
    "agent",
    "permission",
    "hook",
    "ci",
    "classifier",
    "hook",
  ]);
  expect(b[1]!.rule).toBe("Bash(git push:*)");
  const t = tally(b, NOW);
  expect(t.hourTotal).toBe(5);
  expect(t.total).toBe(6);
  expect(t.hour.hook).toBe(1);
  expect(t.all.hook).toBe(2);
  expect(t.top).toEqual({ what: "triage", n: 2 });
  expect(countsOf({ docs: parseDocs(docsJson), blocks: b, now: NOW })).toEqual({
    blocks: 5,
    docs: 2,
  });
});

test("a rule is offered only in settings.json's shape, and never a whole shell or every write", () => {
  for (const ok of [
    "Bash(git push:*)",
    "Bash(npm run test)",
    "Edit(docs/**)",
    "WebFetch(domain:example.com)",
    "mcp__github__create_pull_request",
    "Read",
  ])
    expect(safeRule(ok)).toBe(true);
  for (const bad of [
    "Bash",
    "Edit",
    "Write",
    "Bash(*)",
    "Bash(:*)",
    "Edit(**)",
    "Write(/)",
    "Bash(ls)\nBash",
    "Bash(git push:*) Bash",
    "",
    "x".repeat(201),
    42,
  ])
    expect(safeRule(bad)).toBe(false);
});

test("a rule added to settings.local.json: every key kept, once, nothing over a broken file", () => {
  const before = `${JSON.stringify(
    { model: "opus", permissions: { allow: ["Read"], deny: ["Bash(rm:*)"] } },
    null,
    2,
  )}\n`;
  const after = addRule(before, "Bash(git push:*)")!;
  expect(JSON.parse(after)).toEqual({
    model: "opus",
    permissions: { allow: ["Read", "Bash(git push:*)"], deny: ["Bash(rm:*)"] },
  });
  expect(after.endsWith("}\n")).toBe(true);
  expect(addRule(after, "Bash(git push:*)")).toBe(after);
  expect(JSON.parse(addRule(undefined, "Read")!)).toEqual({
    permissions: { allow: ["Read"] },
  });
  expect(addRule("{", "Read")).toBeUndefined();
  expect(addRule('{"permissions":{"allow":"Read"}}', "Read")).toBeUndefined();
});

// --- in the engine ------------------------------------------------------------------

type Seen = { fills: string[]; copies: string[]; box: string };

/** A session with the three files, the prompt box, the clipboard and `mv`. */
async function seeded($: any, on: any, box = "") {
  const seen: Seen = { fills: [], copies: [], box };
  on("prompt.read", async () => ({
    value: { text: seen.box, cursor: seen.box.length },
  }));
  on("prompt.fill", async (_$: any, e: any) => {
    seen.fills.push(e.text);
    seen.box = e.text;
    return { isFilled: true };
  });
  on("ui.copy", async (_$: any, e: any) => {
    seen.copies.push(e.text);
    return { value: { isCopied: true } };
  });
  on("fs.list", async () => ({ value: [] }));
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  h.files.set(DOCS, { text: docsJson, mtimeMs: 1 });
  h.files.set(BLOCKS, { text: blocksJsonl, mtimeMs: 1 });
  h.files.set(MANIFEST, { text: manifestJson, mtimeMs: 1 });
  await start($, clock);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(88, 20),
  });
  return { h, clock, ui, seen };
}

const screen = async (ui: any) =>
  capture(await ui.drawn({ in: "tree" })).split("\n");
const click = (ui: any, x: number, y: number) =>
  ui.pointer({ type: "down", x, y, button: "left" });

test("the bar: Arbre, Graphe, Refus counting the last hour, Documents counting the missing", async ($, on) => {
  const { ui } = await seeded($, on);
  const lines = await screen(ui);
  expect(lines[19]).toBe(
    "Arbre   Graphe   Refus (5)    Documents (2)               ↑↓ choisir · ⏎ plier · tab vue",
  );
  // a click on « Refus » and on « Documents » shows them, « Arbre » the tree
  await click(ui, 18, 19);
  expect((await screen(ui))[0]).toContain(
    "Refus · 5 dans la dernière heure, 6 depuis le début",
  );
  await click(ui, 32, 19);
  expect((await screen(ui))[0]).toContain(
    "Documents · 2 manquants · 1 ignoré · 2 présents",
  );
  await click(ui, 1, 19);
  expect((await screen(ui))[0]).toContain("SDK status-line");
});

test("150 refusals in the hour: the bar says 99, every tab where it was, every line at its width", async ($, on) => {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress")], 1);
  const many = Array.from({ length: 150 }, (_, i) =>
    JSON.stringify({
      ts: iso(NOW - (150 - i) * 10_000),
      kind: "hook",
      tool: "Bash",
      summary: "TRIAGE FIRST",
      motif: "triage",
      agent: "main",
    }),
  );
  h.files.set(BLOCKS, { text: `${many.join("\n")}\n`, mtimeMs: 1 });
  await start($, clock);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(88, 20),
  });
  const bar = (await screen(ui))[19]!;
  expect(bar).toMatch(/^Arbre {3}Graphe {3}Refus \(99\) {3}Documents \(0\)/);
  expect(bar.indexOf("Documents")).toBe(30);
  await click(ui, 18, 19);
  const refus = await ui.drawn({ in: "tree" });
  expect(capture(refus).split("\n")[0]).toContain("150 dans la dernière heure");
  expect(widths(refus)).toEqual(Array(20).fill(88));
});

test("Refus: newest first, what piled up, the rule shown; a click asks, only « ajouter » writes", async ($, on) => {
  const { h, ui, seen } = await seeded($, on);
  await click(ui, 18, 19);
  const lines = await screen(ui);
  const at = (ago: number) => hhmm(NOW - ago * 60_000);
  expect(lines.slice(1, 7)).toEqual([
    "dernière heure  agent 1 · permission 1 · hook 1 · ci 1 · classifier 1",
    "session         hook 2 · agent 1 · permission 1 · ci 1 · classifier 1",
    "motif le plus fréquent  triage ×2",
    "HEURE  TYPE        OUTIL       RÉSUMÉ                       RÈGLE",
    `${at(5)}  agent       —           tasks-flow-rules arrêté, t…`,
    `${at(10)}  permission  Bash        git push refusé              Bash(git push:*)`,
  ]);
  // a click on a refusal with no rule: its detail, nothing to confirm
  await click(ui, 20, 7);
  expect((await screen(ui))[17]).toContain(
    "Aucune règle de permission déduite",
  );
  // a click on the one with a rule: the exact rule, and where it would go
  await click(ui, 20, 6);
  const ask = await screen(ui);
  expect(ask[6]).toBe(lines[6]);
  expect(ask[16]).toContain(
    "Autoriser  Bash(git push:*)  dans .claude/settings.local.json ?",
  );
  expect(ask[17]).toContain("[ajouter]  [copier]  [annuler]");
  expect(h.files.has(SETTINGS)).toBe(false);
  // « copier » copies, « annuler » closes, nothing written
  await click(ui, 13, 17);
  expect(seen.copies).toEqual(["Bash(git push:*)"]);
  await click(ui, 23, 17);
  expect((await screen(ui))[16]).not.toContain("Autoriser");
  expect(h.files.has(SETTINGS)).toBe(false);
  // asked again, « ajouter »: the rule lands in the project's local settings
  await click(ui, 20, 6);
  await click(ui, 2, 17);
  expect(JSON.parse(h.files.get(SETTINGS)!.text)).toEqual({
    permissions: { allow: ["Bash(git push:*)"] },
  });
  expect(h.toasts.some((t) => t.includes("Bash(git push:*) autorisé"))).toBe(
    true,
  );
  expect((await screen(ui))[16]).not.toContain("Autoriser");
});

test("Refus by keys: ↑↓ choose, ⏎ shows the rule, a adds it", async ($, on) => {
  const { h, ui } = await seeded($, on);
  await ui.key({ key: "tab" });
  await ui.key({ key: "tab" });
  await ui.key({ key: "down" });
  await ui.key({ key: "down" });
  await ui.key({ key: "return" });
  expect((await screen(ui))[16]).toContain("Autoriser  Bash(git push:*)");
  await ui.key({ key: "a" });
  expect(JSON.parse(h.files.get(SETTINGS)!.text).permissions.allow).toEqual([
    "Bash(git push:*)",
  ]);
});

test("a rule no refusal carries, or one too wide, is never written, whoever posts it", async ($, on) => {
  const { h, ui, clock } = await seeded($, on);
  await ui.post({ op: "allow", rule: "Bash(curl:*)" });
  await ui.post({ op: "allow", rule: "Bash" });
  await ui.post({ op: "allow", rule: 42 });
  expect(h.files.has(SETTINGS)).toBe(false);
  // one too wide, even when a refusal carries it
  h.files.set(BLOCKS, {
    text: `${JSON.stringify({ ts: new Date(NOW).toISOString(), kind: "permission", tool: "Bash", summary: "x", rule: "Bash(*)" })}\n`,
    mtimeMs: 2,
  });
  await clock.advance(3_000);
  await clock.settle();
  await click(ui, 18, 19);
  expect((await screen(ui))[5]).toContain("Bash(*)");
  await ui.post({ op: "allow", rule: "Bash(*)" });
  expect(h.files.has(SETTINGS)).toBe(false);
});

test("Documents: one line each, a click ignores or brings back in the manifest", async ($, on) => {
  const { h, ui } = await seeded($, on);
  await click(ui, 32, 19);
  const lines = await screen(ui);
  expect(lines.slice(1, 7).map((l) => l.trimEnd())).toEqual([
    "  DOCUMENT                    CHEMIN",
    "● Exigences produit           docs/vision.md",
    "● Exigences techniques        docs/tech/requirements.md                          [créer]",
    "● Parcours                    docs/product/flow.md                               [créer]",
    "○ Brief de design             docs/design/brief.md  ignoré : aucune interface …",
    "● README et démarrage         README.md",
  ]);
  expect(lines[16]!.trimEnd()).toBe(
    "[Créer les manquants (2)]   mode  ask · context · both",
  );
  // flow ignored: the manifest rewritten in the catalogue's order, the line grey
  await click(ui, 5, 4);
  expect(h.files.get(MANIFEST)!.text).toBe(
    toggleManifest(manifestJson, "flow", true),
  );
  expect((await screen(ui))[4]).toMatch(/^○ Parcours/);
  // design brought back: absent from the disk, so missing, and its entry gone
  await click(ui, 5, 5);
  const m = JSON.parse(h.files.get(MANIFEST)!.text);
  expect(Object.keys(m.documents)).toEqual(["prd", "flow"]);
  expect(m.owner).toBe("équipe");
  expect((await screen(ui))[5]).toMatch(/^● Brief de design .*\[créer\]$/);
  expect([...h.files.keys()].some((k) => k.endsWith(".tmp"))).toBe(false);
});

test("Documents: « créer » and « Créer les manquants » draft the prompt, never send it", async ($, on) => {
  const { ui, seen, h } = await seeded($, on);
  await click(ui, 32, 19);
  await click(ui, 83, 3);
  expect(seen.fills).toEqual(["/kodflow-workflow:docs trd --mode both"]);
  // a draft in the box is never overwritten
  await click(ui, 2, 16);
  expect(seen.fills.length).toBe(1);
  expect(h.toasts.some((t) => t.includes("déjà un brouillon"))).toBe(true);
  seen.box = "";
  // the mode chosen, then every missing one
  await click(ui, 35, 16);
  expect((await screen(ui))[16]).toContain("mode  ask · context · both");
  await click(ui, 2, 16);
  expect(seen.fills[1]).toBe("/kodflow-workflow:docs --mode ask");
  // by keys: m turns the mode, c the chosen one, t all of them
  seen.box = "";
  await ui.key({ key: "down" });
  await ui.key({ key: "down" });
  await ui.key({ key: "m" });
  await ui.key({ key: "c" });
  expect(seen.fills[2]).toBe("/kodflow-workflow:docs trd --mode context");
  // an id that is not missing is never drafted
  seen.box = "";
  await ui.post({ op: "create", ids: ["prd"], mode: "both" });
  expect(seen.fills.length).toBe(3);
});

test("no tasks.json: the message, and the bar, so Refus and Documents stay reachable", async ($, on) => {
  const { h, clock } = host(on);
  h.files.set(BLOCKS, { text: blocksJsonl, mtimeMs: 1 });
  await start($, clock);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(88, 20),
  });
  const lines = await screen(ui);
  expect(lines[0]).toContain("Aucune liste de tâches");
  expect(lines[19]).toContain("Refus (5)");
});
