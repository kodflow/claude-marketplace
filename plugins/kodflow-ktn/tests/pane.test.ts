// pane.test.ts — the pane in the engine (`claude plugin test`): every tree
// validated by the terminal's and the desktop's own element tables, the
// presses raised as a surface raises them. Issue kodflow/ktn-linter#777.
import { test, expect } from "claude-code/testing";
import { host, lay, start } from "./host.ts";

const ANCHOR = "/u/dev/.local/state/ktn-linter/endpoint.json";
const SOCKET = "/run/user/1000/ktn-linter/user.sock";
const SURFACES = ["terminal", "desktop"] as const;
// A planted value no daemon would mint (low entropy on purpose: no scanner
// mistakes it for a credential); what matters is that it travels nowhere.
const TOKEN = "ab".repeat(32);

const endpoint = () =>
  JSON.stringify({ schema: 1, socket: SOCKET, state_json: "/x/state.json", exe: "/opt/ktn/bin/ktn-linter", version: "1.46.0" });
const c = (e: number, w: number, i: number) => ({ findings: e + w + i, severity: { error: e, warning: w, info: i }, phase: { "2": e, "6": w, "7": i } });
const model = (nodes?: object[], totals = c(1, 4, 2)) =>
  JSON.stringify({
    schema: "v1",
    rev: 11,
    workspace: "/w/repo",
    state: "watching",
    totals,
    tree: {
      nodes: nodes ?? [
        { id: "dir:.", kind: "dir", name: ".", depth: 0, expanded: true, counts: totals },
        { id: "dir:pkg", kind: "dir", name: "pkg", parent: "dir:.", depth: 1, expanded: false, counts: c(1, 4, 1) },
        { id: "file:main.go", kind: "file", name: "main.go", parent: "dir:.", depth: 1, expanded: false, counts: c(0, 0, 1) },
      ],
    },
    window: { offset: 0, limit: 200, returned: 3, total: 3 },
    truncated: false,
    activity: [],
  });

const PANE = (bodyColumns = 60, bodyRows = 30) => ({
  title: "ktn",
  isFocused: false,
  bodyColumns,
  placement: "dock" as const,
  scroll: { offset: 0, bodyRows },
  view: {},
});

function served(on: any, answer?: (url: string, init: any) => Promise<{ status: number; text: string }>) {
  const { h, clock } = host(on);
  lay(h, "/w/repo", [".git/", "go.mod", "pkg/"]);
  h.files.set(ANCHOR, endpoint());
  h.answer =
    answer ??
    (async (url, init) => {
      if (url.includes("/status")) return { status: 200, text: JSON.stringify({ protocol_version: "v1" }) };
      if (url.includes("/ui/boot") && init?.method === "POST")
        return { status: 200, text: JSON.stringify({ url: `http://127.0.0.1:8080/#${TOKEN}`, expires_at: "2099-01-01T00:00:00Z" }) };
      return { status: 200, text: model() };
    });
  return { h, clock };
}

const mount = ($: any, surface: "terminal" | "desktop", props = PANE()) =>
  $.ui.mount({ plugin: "kodflow-ktn", surface, component: "Pane", requestId: "ktn-view", props });

test("/ktn-view opens the pane in a Go project; out of one it answers and opens nothing", async ($, on) => {
  const { h, clock } = served(on);
  await start($, clock);
  await $.command.run({ command: "ktn-view", args: "" } as any);
  expect(h.opened).toEqual(["ktn-view"]);
  await $.command.run({ command: "ktn-view", args: "off" } as any);
  expect(h.closed).toEqual(["ktn-view"]);
});

test("out of a Go project the command opens no pane", async ($, on) => {
  const { h, clock } = host(on);
  lay(h, "/w/repo", [".git/", "README"]);
  await start($, clock);
  const { text } = await $.command.run({ command: "ktn-view", args: "" } as any);
  expect(text).toBe("ktn: pas un projet Go");
  expect(h.opened).toEqual([]);
});

test("the synthesis and the folded tree, on the terminal and the desktop", async ($, on) => {
  const { clock } = served(on);
  await start($, clock);
  for (const surface of SURFACES) {
    const ui = await mount($, surface);
    expect(await ui.find({ text: /ktn · 7 constats · 1 E · 4 W · 2 I/ })).toBeDefined();
    expect(await ui.find({ text: /phases 2:1 6:4 7:2/ })).toBeDefined();
    const pkg = await ui.find({ type: "Button", key: "dir:pkg" });
    expect(pkg?.text).toContain("▸ pkg/");
    expect(pkg?.text).toContain("6 · 1E 4W 1I");
    // Folded: none of its children is drawn
    expect(await ui.find({ text: /handler\.go/ })).toBeUndefined();
    await ui.unmount();
  }
});

test("a press on a folded directory asks for it: the next request carries its id in expand", async ($, on) => {
  const { h, clock } = served(on);
  await start($, clock);
  const ui = await mount($, "terminal");
  await ui.press({ key: "dir:pkg" });
  const last = h.fetches.filter((f) => f.url.includes("/api/view")).at(-1)!;
  expect(new URL(last.url).searchParams.getAll("expand")).toEqual(["dir:pkg"]);
  expect(h.state.expanded).toEqual(["dir:pkg"]);
  // Pressed again: folded, and asked without it
  await ui.press({ key: "dir:pkg" });
  const again = h.fetches.filter((f) => f.url.includes("/api/view")).at(-1)!;
  expect(new URL(again.url).searchParams.getAll("expand")).toEqual([]);
});

test("Open the web UI: the link is drawn in the pane, the token is in no $.state value and not in the command's text", async ($, on) => {
  const { h, clock } = served(on);
  await start($, clock);
  const ui = await mount($, "terminal");
  await ui.press({ key: "ktn-open-ui" });
  const link = await ui.find({ type: "Link" });
  expect(link?.props.href).toBe(`http://127.0.0.1:8080/#${TOKEN}`);
  expect(link?.props.label).toBe("http://127.0.0.1:8080/");
  expect(h.fetches.some((f) => f.url.endsWith("/ui/boot"))).toBe(true);
  expect(JSON.stringify(h.state)).not.toContain(TOKEN);
  const { text } = await $.command.run({ command: "ktn-view", args: "" } as any);
  expect(text).not.toContain(TOKEN);
});

test("each of the seven states draws in the pane, on the terminal and the desktop", async ($, on) => {
  // One session walked through the states by what the daemon answers
  let answer: (url: string) => { status: number; text: string } = () => ({ status: 200, text: model() });
  const { h, clock } = served(on, async (url) => {
    const r = answer(url);
    if (r.status < 0) throw new Error("ENOENT");
    return r;
  });
  const status = (over = {}) => ({ status: 200, text: JSON.stringify({ protocol_version: "v1", ...over }) });
  const steps: [RegExp, (url: string) => { status: number; text: string }, string?][] = [
    [/daemon injoignable/, () => ({ status: -1, text: "" })],
    [/API incompatible/, () => status({ protocol_version: "v7" })],
    [/en attente d'approbation/, (u) => (u.includes("/status") ? status({ pending_workspaces: [{ root: "/w/repo", reason: "repository not approved", command: "ktn-linter admin workspace approve /w/repo" }] }) : { status: 403, text: "workspace /w/repo is not served: declare it first" })],
    [/refusé \/ non servi/, (u) => (u.includes("/status") ? status() : { status: 403, text: "workspace /w/repo is not served: declare it first" })],
    [/propre : aucun constat/, (u) => (u.includes("/status") ? status() : { status: 200, text: model([], c(0, 0, 0)) })],
  ];
  await start($, clock);
  for (const [want, a] of steps) {
    answer = a;
    // A new pointer each time: the incompatible state waits for one
    h.files.set(ANCHOR, endpoint().replace("1.46.0", String(Math.random())));
    await $.command.run({ command: "ktn-view", args: "" } as any);
    await clock.settle();
    for (const surface of SURFACES) {
      const ui = await mount($, surface);
      const found = await ui.find({ text: want });
      expect(found, `${want} on ${surface}`).toBeDefined();
      await ui.unmount();
    }
  }
  // Loading, then out of the project
  h.root = "/w/docs";
  lay(h, "/w/docs", [".git/", "index.html"]);
  await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t", reason: "answer" } as any);
  await clock.settle();
  for (const surface of SURFACES) {
    const ui = await mount($, surface);
    expect(await ui.find({ text: /hors projet Go/ })).toBeDefined();
    await ui.unmount();
  }
});

test("loading draws as loading before the first answer", async ($, on) => {
  const { clock } = served(on, () => new Promise(() => undefined));
  await start($, clock);
  for (const surface of SURFACES) {
    const ui = await mount($, surface);
    expect(await ui.find({ text: /chargement/ })).toBeDefined();
    await ui.unmount();
  }
});

test("after a /clear that emptied $.state the pane draws the rewritten snapshot, not 'loading'", async ($, on) => {
  const { h, clock } = served(on);
  await start($, clock);
  h.stateLost = true;
  await $.classic.SessionStart({ source: "clear" } as any);
  await clock.settle();
  const ui = await mount($, "terminal");
  expect(await ui.find({ text: /chargement/ })).toBeUndefined();
  expect(await ui.find({ text: /7 constats/ })).toBeDefined();
});

test("a 10 000-character file name, zero rows and one column: still a valid tree", async ($, on) => {
  const long = "y".repeat(10_000) + ".go";
  const { clock } = served(on, async (url) =>
    url.includes("/status")
      ? { status: 200, text: JSON.stringify({ protocol_version: "v1" }) }
      : {
          status: 200,
          text: model([
            { id: "dir:.", kind: "dir", name: ".", depth: 0, expanded: true, counts: c(0, 1, 0) },
            // The daemon cuts an id's path past 1 000 runes (pkg/view Sanitize); the name is cut here
            { id: `file:${"y".repeat(1_000)}…`, kind: "file", name: long, parent: "dir:.", depth: 1, expanded: false, counts: c(0, 1, 0) },
          ], c(0, 1, 0)),
        },
  );
  await start($, clock);
  for (const surface of SURFACES) {
    const ui = await mount($, surface, PANE(1, 0));
    const row = await ui.find({ type: "Button", key: `file:${"y".repeat(1_000)}…` });
    expect(row).toBeDefined();
    expect(row!.text.length < 400).toBe(true);
    await ui.unmount();
  }
});
