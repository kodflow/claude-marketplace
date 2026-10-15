// activation.test.ts — the hooks module under `claude plugin test`: the
// engine's own `$` over the plugin, the disk and the surfaces beneath it in
// memory (host.ts). Issue kodflow/ktn-linter#775.
import { test, expect } from "claude-code/testing";
import { host, lay, start } from "./host.ts";

test("a Go project: the command is registered, the probe walks once", async ($, on) => {
  const { h, clock } = host(on);
  lay(h, "/w/repo", [".git/", "go.mod", "pkg/"]);
  await start($, clock);
  expect(h.commands).toEqual(["ktn-view"]);
  expect(h.listed).toEqual(["/w/repo"]);
  const { text } = await $.command.run({ command: "ktn-view", args: "" } as any);
  expect(text).toContain("(workspace /w/repo)");
  expect((h.state.snap as any).activation).toBe("active");
  expect((h.state.snap as any).workspace).toBe("/w/repo");
});

test("outside a Go project: no pane, no status line, no daemon call; the command says so", async ($, on) => {
  const { h, clock } = host(on);
  lay(h, "/w/repo", [".git/", "package.json", "src/"]);
  await start($, clock);
  const { text } = await $.command.run({ command: "ktn-view", args: "" } as any);
  expect(text).toBe("ktn: pas un projet Go");
  expect(h.opened).toEqual([]);
  expect(h.statuses.filter((s) => s !== undefined)).toEqual([]);
  expect(h.fetches).toEqual([]);
  await clock.advance(120_000);
  expect(h.fetches).toEqual([]);
});

test("nothing draws (-p, the SDK, Kepler): inert, no probe, no command", async ($, on) => {
  const { h, clock } = host(on, { surfaces: [] });
  lay(h, "/w/repo", [".git/", "go.mod"]);
  await $.session.start({ cwd: "/w/repo", surface: null, isInteractive: false } as any);
  await clock.settle();
  expect(h.listed).toEqual([]);
  expect(h.commands).toEqual([]);
  expect(h.state.snap).toEqual({ activation: "inert" });
});

test("under the version floor: one status line, nothing else", async ($, on) => {
  const { h, clock } = host(on, { version: "2.1.296" });
  lay(h, "/w/repo", [".git/", "go.mod"]);
  await start($, clock);
  expect(h.statuses).toEqual(["Claude Code 2.1.299 ou plus requis"]);
  expect(h.listed).toEqual([]);
  expect(h.commands).toEqual([]);
});

test("a linked worktree whose .git is a file is active from its own root", async ($, on) => {
  const { h, clock } = host(on, { root: "/wt/feature" });
  // The main working tree (what repo().root would name) is NOT Go: never read
  lay(h, "/main", [".git/", "README"]);
  lay(h, "/wt/feature", [".git", "go.mod", "cmd/"]);
  await start($, clock, "/wt/feature");
  expect(h.listed).toEqual(["/wt/feature"]);
  expect((h.state.snap as any)?.activation).toBe("active");
});

test("past three listings the verdict is undetermined, and the command says so", async ($, on) => {
  const { h, clock } = host(on, { root: "/a/b/c/d" });
  lay(h, "/a/b/c/d", ["x"]);
  await start($, clock, "/a/b/c/d");
  expect(h.listed.length).toBe(3);
  const { text } = await $.command.run({ command: "ktn-view", args: "" } as any);
  expect(text).toContain("indéterminé");
});

test("activation: always forces a project the probe cannot settle", { options: { activation: "always" } }, async ($, on) => {
  const { h, clock } = host(on, { root: "/a/b/c/d" });
  lay(h, "/a/b/c/d", ["x"]);
  await start($, clock, "/a/b/c/d");
  expect((h.state.snap as any)?.activation).toBe("active");
});

test("turn.complete after the root moved to a non-Go folder: the mod stands down", async ($, on) => {
  const { h, clock } = host(on);
  lay(h, "/w/repo", [".git/", "go.mod"]);
  lay(h, "/w/docs", [".git/", "index.html"]);
  await start($, clock);
  expect((h.state.snap as any)?.activation).toBe("active");
  h.root = "/w/docs";
  await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" } as any);
  await clock.settle();
  expect((h.state.snap as any)?.activation).toBe("inactive");
  expect(h.statuses.at(-1)).toBeUndefined();
  const { text } = await $.command.run({ command: "ktn-view", args: "" } as any);
  expect(text).toBe("ktn: pas un projet Go");
});

test("go mod init between two turns turns the mod on at the next one", async ($, on) => {
  const { h, clock } = host(on);
  lay(h, "/w/repo", [".git/"]);
  await start($, clock);
  expect((h.state.snap as any)?.activation).toBe("inactive");
  h.dirs.get("/w/repo")!.push({ name: "go.mod", kind: "file", isLink: false });
  await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t1", reason: "answer" } as any);
  await clock.settle();
  expect((h.state.snap as any)?.activation).toBe("active");
});

test("a subagent's turn reconciles nothing", async ($, on) => {
  const { h, clock } = host(on);
  lay(h, "/w/repo", [".git/"]);
  await start($, clock);
  const before = h.listed.length;
  await $.turn.complete({ answer: "", durationMs: 1, isAborted: false, turnId: "t2", agentId: "a1", reason: "answer" } as any);
  await clock.settle();
  expect(h.listed.length).toBe(before);
});

test("after a /clear that emptied $.state, the snapshot is written back from the module", async ($, on) => {
  const { h, clock } = host(on);
  lay(h, "/w/repo", [".git/", "go.mod"]);
  await start($, clock);
  const before = h.writes.length;
  h.stateLost = true;
  await $.classic.SessionStart({ source: "clear" } as any);
  await clock.settle();
  expect(h.writes.length).toBe(before + 1);
  expect(h.writes.at(-1)).toEqual(h.state.snap);
  expect((h.writes.at(-1) as any).workspace).toBe("/w/repo");
});
