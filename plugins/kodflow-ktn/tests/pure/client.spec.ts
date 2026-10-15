// client.spec.ts — every failure issue kodflow/ktn-linter#776 names, injected
// beneath the client, each ending on an assertion on the state that would be
// DRAWN (the status line's text, the band's tree), and none of them throwing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client, TICK_MS } from "../../hooks/mod/client.ts";
import { band, statusText } from "../../hooks/mod/view.ts";
import {
  ANCHOR,
  EXE,
  WS,
  counts,
  deferred,
  endpointJson,
  flush,
  modelJson,
  statusJson,
  world,
} from "./harness.ts";
import { ELS, installH, texts } from "./render.ts";

installH();

const drawn = (daemon: any) => statusText({ activation: "active", workspace: WS, daemon });
const bandOf = (daemon: any, launch?: () => void) =>
  band(ELS, { activation: "active", workspace: WS, daemon }, { launch });

async function fresh(opts: { canRun?: boolean } = {}) {
  const w = world(opts);
  const c = new Client(w.port);
  c.setWorkspace(WS);
  return { w, c };
}

test("a served workspace: one /status, then the view; the counts on the status line", async () => {
  const { w, c } = await fresh();
  await c.refresh();
  assert.deepEqual(w.requests.map((r) => r.split("?")[0]), ["/status", "/api/view"]);
  assert.match(w.requests[1]!, /workspace=%2Fw%2Frepo&wait=0$/);
  assert.equal(w.last().kind, "ready");
  assert.equal(drawn(w.last()), "ktn: 6 constats · 1 E · 2 W · 3 I");
  assert.equal(bandOf(w.last()), undefined, "nothing to act on: no band");
  // The next look sends the revision and gets a 204: nothing redrawn
  w.daemon = async () => ({ status: 204, text: "" });
  const before = w.emitted.length;
  await c.refresh();
  assert.match(w.requests.at(-1)!, /since=1760000000001/);
  assert.equal(w.emitted.length, before);
});

test("clean: zero findings is drawn as clean, and only then", async () => {
  const { w, c } = await fresh();
  w.daemon = async (p) =>
    p.startsWith("/status")
      ? { status: 200, text: statusJson() }
      : { status: 200, text: modelJson({ totals: counts(0, 0, 0), tree: { nodes: [] } }) };
  await c.refresh();
  assert.equal(drawn(w.last()), "ktn: ✓ aucun constat");
});

test("endpoint.json absent: unreachable, the command to run, and not one request", async () => {
  const { w, c } = await fresh();
  w.files.delete(ANCHOR);
  await c.refresh();
  assert.deepEqual(w.requests, []);
  assert.equal(w.last().kind, "unreachable");
  assert.equal(w.last().launch, "command");
  assert.equal(drawn(w.last()), "ktn: daemon injoignable");
  assert.ok(texts(bandOf(w.last())).includes("KTN_USER_DAEMON=1 ktn-linter daemon ensure"));
});

test("endpoint.json of invalid JSON: unreachable, no request", async () => {
  const { w, c } = await fresh();
  w.files.set(ANCHOR, "{not json");
  await c.refresh();
  assert.deepEqual(w.requests, []);
  assert.match(w.last().detail!, /JSON invalide/);
});

test("a socket path over the daemon's 96 bytes: unreachable, no request", async () => {
  const { w, c } = await fresh();
  w.files.set(ANCHOR, endpointJson({ socket: "/" + "s".repeat(96) }));
  await c.refresh();
  assert.deepEqual(w.requests, []);
  assert.match(w.last().detail!, /socket trop long \(97 octets/);
});

test("nothing on the socket (ENOENT): unreachable with the launch button", async () => {
  const { w, c } = await fresh();
  w.daemon = async () => {
    throw new Error("$.http.fetch(...) failed: ENOENT");
  };
  await c.refresh();
  assert.equal(w.last().kind, "unreachable");
  assert.equal(w.last().launch, "button");
  const tree = bandOf(w.last(), () => undefined);
  assert.ok(texts(tree).includes("Lancer le daemon"));
});

test("HTTP 500: unreachable naming it, no launch offered (a daemon answers)", async () => {
  const { w, c } = await fresh();
  w.daemon = async (p) =>
    p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 500, text: "boom" };
  await c.refresh();
  assert.equal(w.last().kind, "unreachable");
  assert.equal(w.last().detail, "HTTP 500");
  assert.equal(w.last().launch, "none");
});

test("invalid JSON from the daemon: a drawn state, not a throw", async () => {
  const { w, c } = await fresh();
  w.daemon = async (p) =>
    p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 200, text: '{"schema": "v1", tru' };
  await c.refresh();
  assert.equal(w.last().kind, "unreachable");
  assert.match(w.last().detail!, /illisible/);
});

test("another protocol: incompatible, then no request at all until endpoint.json moves", async () => {
  const { w, c } = await fresh();
  w.daemon = async () => ({ status: 200, text: statusJson({ protocol_version: "v2" }) });
  await c.refresh();
  assert.equal(w.last().kind, "incompatible");
  assert.match(w.last().detail!, /ktn-linter 1\.46\.0 parle v2, ce mod attend v1/);
  const n = w.requests.length;
  await c.refresh({ force: true });
  await c.refresh();
  assert.equal(w.requests.length, n);
  w.files.set(ANCHOR, endpointJson({ version: "1.47.0" }));
  w.daemon = async (p) =>
    p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 200, text: modelJson() };
  await c.refresh();
  assert.equal(w.last().kind, "ready");
});

test("a 4 MiB answer: refused by the engine, drawn as such", async () => {
  const { w, c } = await fresh();
  w.daemon = async (p) => {
    if (p.startsWith("/status")) return { status: 200, text: statusJson() };
    throw new Error("body of 4194305 bytes is over the 4194304-byte limit");
  };
  await c.refresh();
  assert.equal(w.last().kind, "unreachable");
  assert.equal(w.last().detail, "réponse trop grosse");
});

test("an answer under 4 MiB but past what the protocol sends: refused unread", async () => {
  const { w, c } = await fresh();
  const huge = modelJson({ pad: "x".repeat(2 * 1024 * 1024) });
  w.daemon = async (p) =>
    p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 200, text: huge };
  await c.refresh();
  assert.equal(w.last().detail, "réponse trop grosse");
});

test("100 000 findings: the totals say so, the window is capped, the drawing stays small", async () => {
  const { w, c } = await fresh();
  const nodes = [{ id: "dir:.", kind: "dir", name: ".", depth: 0, expanded: true, counts: counts(100_000, 0, 0) }];
  for (let i = 0; i < 4_000; i++)
    nodes.push({ id: `file:f${i}.go`, kind: "file", name: `f${i}.go`, parent: "dir:.", depth: 1, expanded: false, counts: counts(25, 0, 0) } as any);
  const text = modelJson({
    totals: counts(100_000, 0, 0),
    tree: { nodes },
    window: { offset: 0, limit: 1000, returned: 4001, total: 100_001 },
    truncated: true,
  });
  w.daemon = async (p) =>
    p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 200, text };
  await c.refresh();
  assert.equal(w.last().kind, "ready");
  assert.equal(drawn(w.last()), "ktn: 100000 constats · 100000 E · 0 W · 0 I");
  const model = w.emitted.at(-1)!.model!;
  assert.equal(model.nodes.length, 1_000);
  assert.equal(model.truncated, true);
});

test("a silent daemon: unreachable at wait + 5 s, no second request in flight, the late answer ignored", async () => {
  const { w, c } = await fresh();
  const late = deferred<{ status: number; text: string }>();
  let calls = 0;
  w.daemon = (p) => {
    calls++;
    return p.startsWith("/status") ? Promise.resolve({ status: 200, text: statusJson() }) : late.promise;
  };
  const first = c.refresh({ waitS: 0 });
  await flush();
  await w.clock.advance(4_999);
  assert.notEqual(w.last()?.kind, "unreachable");
  await w.clock.advance(1);
  await first;
  assert.equal(w.last().kind, "unreachable");
  assert.equal(w.last().detail, "le daemon ne répond pas");
  // Still in flight beneath: nothing else leaves
  const n = calls;
  await c.refresh({ force: true });
  await c.refresh();
  assert.equal(calls, n);
  // The answer comes at last, 60 s later: dropped
  await w.clock.advance(55_000);
  late.resolve({ status: 200, text: modelJson() });
  await flush();
  assert.equal(w.last().kind, "unreachable");
  // And the next look goes out again
  w.daemon = async (p) =>
    p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 200, text: modelJson() };
  await c.refresh({ force: true });
  assert.equal(w.last().kind, "ready");
});

test("a refusal by a policy or a hook is not 'unreachable', and offers no launch", async () => {
  const { w, c } = await fresh();
  w.daemon = async () => {
    throw new Error("http.fetch refused: the organization's web-fetch policy");
  };
  await c.refresh();
  assert.equal(w.last().kind, "policy");
  assert.equal(w.last().launch, "none");
  assert.equal(drawn(w.last()), "ktn: requête refusée (politique)");
  assert.ok(!texts(bandOf(w.last(), () => undefined)).includes("Lancer le daemon"));
});

test("waiting for approval: the daemon's own command, exactly", async () => {
  const { w, c } = await fresh();
  const command = `ktn-linter admin workspace approve "${WS}"`;
  w.daemon = async (p) => {
    if (p.startsWith("/status"))
      return { status: 200, text: statusJson({ pending_workspaces: [{ root: WS, reason: "repository not approved", command }] }) };
    return { status: 403, text: `workspace ${WS} is not served: declare it first (POST /workspace/declare)\n` };
  };
  await c.refresh();
  assert.equal(w.last().kind, "pending");
  assert.equal(w.last().command, command);
  assert.ok(texts(bandOf(w.last())).includes(command));
});

test("not served and not pending: refused, with the daemon's reason", async () => {
  const { w, c } = await fresh();
  w.daemon = async (p) => {
    if (p.startsWith("/status")) return { status: 200, text: statusJson() };
    return {
      status: 404,
      text: JSON.stringify({ schema: "v1", error: { code: "workspace_not_served", message: `workspace ${WS} is not served by this daemon` } }),
    };
  };
  await c.refresh();
  assert.equal(w.last().kind, "refused");
  assert.equal(w.last().detail, `workspace ${WS} is not served by this daemon`);
});

test("a message with control characters is drawn without them", async () => {
  const { w, c } = await fresh();
  w.daemon = async (p) => {
    if (p.startsWith("/status")) return { status: 200, text: statusJson() };
    return { status: 400, text: JSON.stringify({ schema: "v1", error: { code: "bad_request", message: "bad\u001b[31m red\u0007\nline" } }) };
  };
  await c.refresh();
  const all = texts(bandOf(w.last()));
  assert.ok(all.some((t) => t.endsWith("bad [31m red  line")), all.join("|"));
  for (const t of all)
    for (const ch of t) assert.ok(ch.charCodeAt(0) >= 0x20, "no control character drawn");
});

test("two presses on the launch button run one command, the absolute binary, from /", async () => {
  const { w, c } = await fresh();
  const run = deferred<{ exitCode: number; stderr: string }>();
  w.runResult = () => run.promise;
  w.daemon = async () => {
    throw new Error("ENOENT");
  };
  await c.refresh();
  const a = c.launch();
  const b = c.launch();
  await flush();
  assert.equal(w.runs.length, 1);
  assert.deepEqual(w.runs[0]!.argv, [EXE, "daemon", "ensure"]);
  assert.equal(w.runs[0]!.init.cwd, "/");
  assert.deepEqual(w.runs[0]!.init.env, { KTN_USER_DAEMON: "1" });
  // Starting: the button gives way to a text nothing can press twice
  assert.equal(w.last().launching, "starting");
  assert.ok(!texts(bandOf(w.last(), () => undefined)).includes("Lancer le daemon"));
  // The daemon comes up
  w.daemon = async (p) =>
    p.startsWith("/status") ? { status: 200, text: statusJson() } : { status: 200, text: modelJson() };
  run.resolve({ exitCode: 5, stderr: "" });
  await Promise.all([a, b]);
  assert.equal(w.runs.length, 1);
  assert.equal(w.last().kind, "ready");
  assert.equal(w.last().launching, undefined);
});

test("a launch that brings nothing up: failed, with the exit code and stderr, cut and clean", async () => {
  const { w, c } = await fresh();
  w.daemon = async () => {
    throw new Error("ECONNREFUSED");
  };
  w.runResult = async () => ({ exitCode: 61, stderr: "port taken\u001b[0m " + "x".repeat(500) });
  await c.refresh();
  const done = c.launch();
  await w.clock.advance(11_000);
  await done;
  assert.equal(w.last().launching, "failed");
  assert.match(w.last().launchError!, /^code 61 : port taken \[0m x+…$/);
  assert.ok(w.last().launchError!.length < 320);
});

test("no host commands on this surface: the command is drawn, no run is tried", async () => {
  const { w, c } = await fresh({ canRun: false });
  w.daemon = async () => {
    throw new Error("ENOENT");
  };
  await c.refresh();
  assert.equal(w.last().launch, "command");
  await c.launch();
  assert.equal(w.runs.length, 0);
  assert.ok(texts(bandOf(w.last())).includes(`KTN_USER_DAEMON=1 ${EXE} daemon ensure`));
});

test("no timer is armed while no pane is placed", async () => {
  const { w, c } = await fresh();
  await c.refresh();
  await c.refresh({ waitS: 0 });
  await c.reconcile();
  assert.equal(w.clock.armed(), 0);
  await w.clock.advance(120_000);
  assert.equal(w.clock.armed(), 0);
});

test("a placed pane: exactly one timer, a chain re-armed in finally; none once it closes", async () => {
  const { w, c } = await fresh();
  c.setTicking(true);
  assert.equal(w.clock.armed(), 1);
  await w.clock.advance(0);
  assert.equal(w.clock.armed(), 1);
  await w.clock.advance(TICK_MS);
  assert.equal(w.clock.armed(), 1);
  assert.ok(w.requests.length >= 3);
  c.setTicking(false);
  assert.equal(w.clock.armed(), 0);
});

test("a timer a hook refused never fires; the next reconciliation arms it again", async () => {
  const { w, c } = await fresh();
  w.clock.refuse = true;
  c.setTicking(true);
  await w.clock.advance(4 * TICK_MS);
  assert.equal(w.requests.length, 0, "the refused timer never ran");
  w.clock.refuse = false;
  await c.reconcile();
  await w.clock.advance(0);
  assert.ok(w.requests.length > 0);
  assert.equal(w.clock.armed(), 1);
});

test("the breaker: after five failures the turn's refresh waits; a person's act passes it", async () => {
  const { w, c } = await fresh();
  w.daemon = async () => {
    throw new Error("ECONNREFUSED");
  };
  for (let i = 0; i < 5; i++) await c.refresh();
  const n = w.requests.length;
  await c.refresh();
  assert.equal(w.requests.length, n);
  c.userAction();
  await c.refresh();
  assert.equal(w.requests.length, n + 1);
});
