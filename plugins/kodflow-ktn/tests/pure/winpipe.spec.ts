// winpipe.spec.ts — the Windows discovery of #143, run on any platform: the
// anchor under %LOCALAPPDATA%, the pipe name the daemon's IPC library
// derives from a socket path, the client dialling it, and POSIX left exactly
// as it was. Nothing here runs on Windows: the pipe itself, and whether the
// engine's `$.http.fetch` takes a pipe name as `socketPath`, are not tested.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client } from "../../hooks/mod/client.ts";
import { anchorPaths, parseEndpoint } from "../../hooks/mod/endpoint.ts";
import {
  isWindowsAbsolute,
  pipeNameOf,
  webDigest,
  windowsAnchors,
  windowsBase,
  windowsNormal,
} from "../../hooks/mod/winpipe.ts";
import { ANCHOR, HOME, SOCKET, WS, endpointJson, world } from "./harness.ts";

const WSOCK = "C:\\Users\\dev\\AppData\\Local\\ktn-linter\\user.sock";
const WEXE = "C:\\Program Files\\ktn\\ktn-linter.exe";
const LAD = "C:\\Users\\dev\\AppData\\Local";
const WANCHOR = `${LAD}\\ktn-linter\\endpoint.json`;

// The formula of proc/ipc `pipeName`, written out with node's own hash: the
// module under test uses WebCrypto, so the two implementations meet here.
const expected = (path: string) =>
  `\\\\.\\pipe\\ipc-${createHash("sha256").update(path.toLowerCase()).digest("hex").slice(0, 16)}-${path.slice(path.lastIndexOf("\\") + 1)}`;

test("drive paths are Windows absolute; POSIX, relative, UNC and NUL are not", () => {
  for (const p of [WSOCK, "c:/x", "Z:\\"])
    assert.equal(isWindowsAbsolute(p), true, p);
  for (const p of [
    "/run/x.sock",
    "C:",
    "C:x",
    "\\\\server\\share\\x",
    "x\\y",
    "",
    "C:\\a\0b",
    7,
  ])
    assert.equal(isWindowsAbsolute(p), false, String(p));
});

test("a clean path is kept; separators normalised; dot segments and non-ASCII refused", () => {
  assert.equal(windowsNormal(WSOCK), WSOCK);
  assert.equal(
    windowsNormal("C:/Data//dev\\x.sock\\"),
    "C:\\Data\\dev\\x.sock",
  );
  assert.equal(windowsNormal("C:\\a\\..\\b"), undefined);
  assert.equal(windowsNormal("C:\\a\\.\\b"), undefined);
  assert.equal(windowsNormal("C:\\Users\\dév\\x.sock"), undefined);
  assert.equal(windowsBase(WSOCK), "user.sock");
});

test("the pipe name is proc/ipc's formula, lower-cased path, eight bytes of hash", async () => {
  assert.equal(await pipeNameOf(WSOCK), expected(WSOCK));
  // Case folds into the hash, never into the base
  assert.equal(
    await pipeNameOf(WSOCK.toUpperCase()),
    expected(WSOCK).replace("user.sock", "USER.SOCK"),
  );
  assert.equal(
    await pipeNameOf(WSOCK.replaceAll("\\", "/")),
    expected(WSOCK),
  );
});

test("a path that cannot be derived safely, or a digest that fails, gives no pipe", async () => {
  assert.equal(await pipeNameOf("C:\\a\\..\\user.sock"), undefined);
  assert.equal(await pipeNameOf("C:\\"), undefined);
  assert.equal(await pipeNameOf("/run/user.sock"), undefined);
  assert.equal(
    await pipeNameOf(WSOCK, async () => {
      throw new Error("no crypto");
    }),
    undefined,
  );
  assert.equal(
    await pipeNameOf(WSOCK, async () => new Uint8Array(4)),
    undefined,
  );
  assert.equal((await webDigest(new Uint8Array())).length, 32);
});

test("the Windows anchor comes from a drive-path LOCALAPPDATA only", () => {
  assert.deepEqual(windowsAnchors(LAD), [WANCHOR]);
  assert.deepEqual(windowsAnchors(`${LAD}\\`), [WANCHOR]);
  assert.deepEqual(windowsAnchors("C:\\"), ["C:\\ktn-linter\\endpoint.json"]);
  for (const v of [undefined, "", "/srv/dev", "AppData"])
    assert.deepEqual(windowsAnchors(v), []);
});

test("POSIX unchanged: the HOME anchors alone, in their order, with or without LOCALAPPDATA unset", () => {
  const posix = [
    `${HOME}/.local/state/ktn-linter/endpoint.json`,
    `${HOME}/Library/Application Support/ktn-linter/endpoint.json`,
  ];
  assert.deepEqual(anchorPaths(HOME), posix);
  assert.deepEqual(anchorPaths(HOME, undefined), posix);
  assert.deepEqual(anchorPaths(HOME, "/not/a/drive"), posix);
  assert.deepEqual(anchorPaths(`${HOME}/`), posix);
  assert.deepEqual(anchorPaths(undefined, LAD), [WANCHOR]);
  assert.deepEqual(anchorPaths("C:\\Users\\dev", LAD), [WANCHOR]);
});

test("endpoint.json: a Windows socket and binary are absolute; a relative one is still refused", () => {
  const r = parseEndpoint(endpointJson({ socket: WSOCK, exe: WEXE }), { windows: true });
  assert.equal(r.ok, true);
  if (r.ok)
    assert.deepEqual([r.endpoint.socket, r.endpoint.exe], [WSOCK, WEXE]);
  assert.equal(
    parseEndpoint(endpointJson({ socket: "ktn\\user.sock" }), { windows: true }).ok,
    false,
  );
  const posix = parseEndpoint(endpointJson());
  assert.equal(posix.ok && posix.endpoint.socket, SOCKET);
});

function windowsWorld(over: Record<string, unknown> = {}) {
  const w = world();
  const pipe = expected(WSOCK);
  w.files.delete(ANCHOR);
  w.files.set(WANCHOR, endpointJson({ socket: WSOCK, exe: WEXE, ...over }));
  const seen: string[] = [];
  const fetch = w.port.fetch;
  w.port.home = async () => undefined;
  w.port.localAppData = async () => LAD;
  w.port.fetch = (url, init) => {
    seen.push(init.socketPath);
    return fetch(url, {
      ...init,
      socketPath: init.socketPath === pipe ? SOCKET : "wrong",
    });
  };
  return { w, seen, pipe };
}

test("on Windows the client reads the LOCALAPPDATA anchor and dials the pipe, never the path", async () => {
  const { w, seen, pipe } = windowsWorld();
  const c = new Client(w.port);
  c.setWorkspace(WS);
  await c.refresh();
  assert.equal(w.last().kind, "ready");
  assert.ok(seen.length >= 2);
  assert.ok(
    seen.every((s) => s === pipe),
    seen.join(","),
  );
});

test("on Windows the launch runs the drive path binary from the drive root", async () => {
  const { w } = windowsWorld();
  w.daemon = async () => {
    throw new Error("connect ENOENT");
  };
  const c = new Client(w.port);
  c.setWorkspace(WS);
  await c.refresh();
  assert.equal(w.last().launch, "button");
  const done = c.launch();
  await w.clock.advance(11_000);
  await done;
  assert.deepEqual(w.runs[0]?.argv, [WEXE, "daemon", "ensure"]);
  assert.equal(w.runs[0]?.init.cwd, "C:\\");
});

test("on Windows a socket whose pipe cannot be derived is unreachable, with no request", async () => {
  const { w, seen } = windowsWorld({ socket: "C:\\a\\..\\user.sock" });
  const c = new Client(w.port);
  c.setWorkspace(WS);
  await c.refresh();
  assert.equal(w.last().kind, "unreachable");
  assert.match(w.last().detail!, /tube nommé/);
  assert.equal(seen.length, 0);
});

test("POSIX dial unchanged: socketPath is endpoint.json's socket", async () => {
  const w = world();
  const seen: string[] = [];
  const fetch = w.port.fetch;
  w.port.fetch = (url, init) => {
    seen.push(init.socketPath);
    return fetch(url, init);
  };
  w.port.localAppData = async () => LAD; // set, but HOME's anchor answers first
  const c = new Client(w.port);
  c.setWorkspace(WS);
  await c.refresh();
  assert.equal(w.last().kind, "ready");
  assert.ok(
    seen.length >= 2 && seen.every((s) => s === SOCKET),
    seen.join(","),
  );
});

test("POSIX refuses a drive path as before; the Windows anchor refuses a POSIX one", () => {
  const drive = parseEndpoint(endpointJson({ socket: WSOCK }));
  assert.equal(drive.ok, false);
  if (!drive.ok) assert.match(drive.reason, /sans socket absolu/);
  const exe = parseEndpoint(endpointJson({ exe: WEXE }));
  assert.equal(exe.ok && exe.endpoint.exe, "");
  assert.equal(parseEndpoint(endpointJson(), { windows: true }).ok, false);
});

test("a drive-path socket under a HOME anchor stays unreachable, with no request", async () => {
  const w = world();
  w.files.set(ANCHOR, endpointJson({ socket: WSOCK }));
  const c = new Client(w.port);
  c.setWorkspace(WS);
  await c.refresh();
  assert.equal(w.last().kind, "unreachable");
  assert.equal(w.requests.length, 0);
});

test("a LOCALAPPDATA read that rejects or throws leaves POSIX as it was", async () => {
  for (const bad of [
    async () => {
      throw new Error("env refused");
    },
    () => {
      throw new Error("sync throw");
    },
  ]) {
    const w = world();
    (w.port as any).localAppData = bad;
    const c = new Client(w.port);
    c.setWorkspace(WS);
    await c.refresh();
    assert.equal(w.last().kind, "ready");
  }
});
