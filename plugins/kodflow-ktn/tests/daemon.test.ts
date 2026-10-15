// daemon.test.ts — discovery, the drawn states and the launch button, in the
// engine (`claude plugin test`): the trees go through each surface's own
// validation, the fetches and runs through the engine's `$`. Issue
// kodflow/ktn-linter#776.
import { test, expect } from "claude-code/testing";
import { host, lay, start } from "./host.ts";

const ANCHOR = "/u/dev/.local/state/ktn-linter/endpoint.json";
const SOCKET = "/run/user/1000/ktn-linter/user.sock";
const EXE = "/opt/ktn/bin/ktn-linter";
const SURFACES = ["terminal", "desktop"] as const;

const endpoint = (over: object = {}) =>
  JSON.stringify({ schema: 1, socket: SOCKET, state_json: "/x/state.json", exe: EXE, version: "1.46.0", ...over });
const status = (over: object = {}) => JSON.stringify({ protocol_version: "v1", ...over });
const counts = (e: number, w: number, i: number) => ({
  findings: e + w + i,
  severity: { error: e, warning: w, info: i },
  phase: {},
});
const model = (c = counts(1, 2, 3)) =>
  JSON.stringify({
    schema: "v1",
    rev: 7,
    workspace: "/w/repo",
    state: "watching",
    totals: c,
    tree: { nodes: [{ id: "dir:.", kind: "dir", name: ".", depth: 0, expanded: true, counts: c }] },
    window: { offset: 0, limit: 200, returned: 1, total: 1 },
    truncated: false,
    activity: [],
  });

const BAND = (bodyColumns = 100) => ({
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
});

function goProject(on: any, over: object = {}) {
  const { h, clock } = host(on, over);
  lay(h, "/w/repo", [".git/", "go.mod"]);
  h.files.set(ANCHOR, endpoint());
  return { h, clock };
}

async function mountBand($: any, surface: "terminal" | "desktop") {
  return $.ui.mount({
    plugin: "kodflow-ktn",
    surface,
    component: "AbovePrompt",
    requestId: "band",
    props: BAND(),
  });
}

test("served: the counts on the status line, nothing in the band", async ($, on) => {
  const { h, clock } = goProject(on);
  h.answer = async (url) => ({ status: 200, text: url.includes("/status") ? status() : model() });
  await start($, clock);
  expect(h.fetches.map((f) => f.socketPath)).toEqual([SOCKET, SOCKET]);
  expect(h.statuses.at(-1)).toBe("ktn: 6 constats · 1 E · 2 W · 3 I");
});

test("clean: drawn as clean", async ($, on) => {
  const { h, clock } = goProject(on);
  h.answer = async (url) => ({ status: 200, text: url.includes("/status") ? status() : model(counts(0, 0, 0)) });
  await start($, clock);
  expect(h.statuses.at(-1)).toBe("ktn: ✓ aucun constat");
});

test("no endpoint.json: unreachable, the command in the band, no request at all", async ($, on) => {
  const { h, clock } = goProject(on);
  h.files.clear();
  await start($, clock);
  expect(h.fetches).toEqual([]);
  expect(h.statuses.at(-1)).toBe("ktn: daemon injoignable");
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface);
    expect(await ui.find({ text: /daemon injoignable/ })).toBeDefined();
    expect(await ui.find({ type: "Code", text: "KTN_USER_DAEMON=1 ktn-linter daemon ensure" })).toBeDefined();
    await ui.unmount();
  }
});

test("nothing on the socket: the launch button; two presses run one absolute command", async ($, on) => {
  const { h, clock } = goProject(on);
  h.answer = async () => {
    throw new Error("$.http.fetch(...) failed: ENOENT");
  };
  await start($, clock);
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface);
    expect(await ui.find({ type: "Button", key: "ktn-launch" })).toBeDefined();
    await ui.unmount();
  }
  const ui = await mountBand($, "terminal");
  // The daemon comes up once ensure has run
  h.answer = async (url) => ({ status: 200, text: url.includes("/status") ? status() : model() });
  await Promise.all([ui.press({ key: "ktn-launch" }), ui.press({ key: "ktn-launch" }).catch(() => undefined)]);
  await clock.advance(1_000);
  expect(h.runs.length).toBe(1);
  expect(h.runs[0]!.argv).toEqual([EXE, "daemon", "ensure"]);
  expect(h.runs[0]!.init?.cwd).toBe("/");
  expect(h.statuses.at(-1)).toBe("ktn: 6 constats · 1 E · 2 W · 3 I");
});

test("another protocol: incompatible in the band, then silence", async ($, on) => {
  const { h, clock } = goProject(on);
  h.answer = async () => ({ status: 200, text: status({ protocol_version: "v9" }) });
  await start($, clock);
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface);
    expect(await ui.find({ text: /API incompatible — ktn-linter 1\.46\.0 parle v9/ })).toBeDefined();
    await ui.unmount();
  }
  const n = h.fetches.length;
  await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t", reason: "answer" } as any);
  await clock.advance(10_000);
  expect(h.fetches.length).toBe(n);
});

test("pending approval: the daemon's command in the band", async ($, on) => {
  const { h, clock } = goProject(on);
  const command = 'ktn-linter admin workspace approve "/w/repo"';
  h.answer = async (url) =>
    url.includes("/status")
      ? { status: 200, text: status({ pending_workspaces: [{ root: "/w/repo", reason: "repository not approved", command }] }) }
      : { status: 403, text: "workspace /w/repo is not served: declare it first (POST /workspace/declare)\n" };
  await start($, clock);
  expect(h.statuses.at(-1)).toBe("ktn: workspace en attente d'approbation");
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface);
    expect(await ui.find({ type: "Code", text: command })).toBeDefined();
    await ui.unmount();
  }
});

test("refused by the daemon: its reason in the band", async ($, on) => {
  const { h, clock } = goProject(on);
  h.answer = async (url) =>
    url.includes("/status")
      ? { status: 200, text: status() }
      : { status: 404, text: JSON.stringify({ schema: "v1", error: { code: "workspace_not_served", message: "workspace /w/repo is not served by this daemon" } }) };
  await start($, clock);
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface);
    expect(await ui.find({ text: /non servi — workspace \/w\/repo is not served by this daemon/ })).toBeDefined();
    await ui.unmount();
  }
});

test("a refusal by a policy is its own state, and offers no launch", async ($, on) => {
  const { h, clock } = goProject(on);
  // The host answers a thrown error with `{ deny }`: a refusal in its own words
  h.answer = async () => {
    throw new Error("blocked by the organization's web-fetch policy");
  };
  await start($, clock);
  expect(h.statuses.at(-1)).toBe("ktn: requête refusée (politique)");
  const ui = await mountBand($, "terminal");
  expect(await ui.find({ type: "Button", key: "ktn-launch" })).toBeUndefined();
});

test("a silent daemon: unreachable at wait + 5 s, one request in flight, the late answer dropped", async ($, on) => {
  const { h, clock } = goProject(on);
  let gate: (() => void) | undefined;
  h.answer = async (url) => {
    if (url.includes("/status")) return { status: 200, text: status() };
    await new Promise<void>((resolve) => (gate = resolve));
    return { status: 200, text: model() };
  };
  await start($, clock);
  await clock.advance(5_000);
  expect(h.statuses.at(-1)).toBe("ktn: daemon injoignable");
  const n = h.fetches.length;
  await $.command.run({ command: "ktn-view", args: "" } as any);
  await clock.advance(1_000);
  expect(h.fetches.length).toBe(n);
  gate?.();
  await clock.advance(60_000);
  expect(h.statuses.at(-1)).toBe("ktn: daemon injoignable");
});

test("the command answers at once while a request hangs", async ($, on) => {
  const { h, clock } = goProject(on);
  h.answer = () => new Promise(() => undefined);
  await start($, clock);
  const { text } = await $.command.run({ command: "ktn-view", args: "" } as any);
  expect(text).toContain("ktn ·");
});
