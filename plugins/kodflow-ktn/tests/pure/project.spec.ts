// project.spec.ts — the activation predicate against ktn-linter's own golden
// table (tests/fixtures/resolve-project.json), then the budget, the person's
// setting and the cases issue #775 names.
//
//   node --test tests/pure/*.spec.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveProject,
  searchTop,
  verdictOf,
  workspaceRoot,
  worthReprobing,
  type Resolution,
} from "../../hooks/mod/project.ts";
import { fakeFs } from "./fakefs.ts";

type Row = {
  name: string;
  tree: string[];
  start: string;
  wantGit: string;
  wantRoots: string[];
  wantModule: string;
  wantIsGo: boolean;
  wantTop: string;
};

const FIXTURE = fileURLToPath(
  new URL("../fixtures/resolve-project.json", import.meta.url),
);
const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  provenance: { sha: string; file: string };
  resolveProject: Row[];
  workspaceRoot: (Resolution & { name: string; want: string })[];
};

// Deep enough that a walk to "/" costs more than the budget
const BASE = "/tmp/t1/t2/tree";
const at = (rel: string) => (rel === "." ? BASE : `${BASE}/${rel}`);
const relOf = (abs: string) =>
  abs === "" ? "" : abs === BASE ? "." : abs.slice(BASE.length + 1);
const UNBOUNDED = { maxCalls: Infinity };

test("the golden table is pinned to a ktn-linter commit", () => {
  assert.match(golden.provenance.sha, /^[0-9a-f]{40}$/);
  assert.equal(
    golden.provenance.file,
    "pkg/daemonaddr/project_roots_external_test.go",
  );
  assert.equal(golden.resolveProject.length, 11);
});

for (const row of golden.resolveProject) {
  test(`golden: ${row.name}`, async () => {
    const fs = fakeFs(BASE, row.tree);
    const r = await resolveProject(at(row.start), fs.list, UNBOUNDED);
    assert.equal(r.complete, true);
    assert.equal(relOf(r.gitRoot), row.wantGit, "GitRoot");
    assert.deepEqual(r.moduleRoots.map(relOf), row.wantRoots, "ModuleRoots");
    assert.equal(relOf(r.moduleRoot), row.wantModule, "ModuleRoot");
    assert.equal(r.isGo, row.wantIsGo, "IsGo");
    assert.equal(relOf(searchTop(r)), row.wantTop, "SearchTop");
    assert.equal(verdictOf(r, "auto"), row.wantIsGo ? "active" : "inactive");
  });

  // The budget may cut a walk; it may never turn it into a wrong answer
  test(`golden under the 3-call budget: ${row.name}`, async () => {
    const fs = fakeFs(BASE, row.tree);
    const r = await resolveProject(at(row.start), fs.list, { maxCalls: 3 });
    assert.ok(r.calls <= 3);
    const verdict = verdictOf(r, "auto");
    if (r.complete) {
      assert.equal(verdict, row.wantIsGo ? "active" : "inactive");
      assert.equal(relOf(workspaceRoot(r)), relOf(workspaceRoot(
        await resolveProject(at(row.start), fakeFs(BASE, row.tree).list, UNBOUNDED),
      )));
    } else assert.equal(verdict, "undetermined");
  });
}

for (const row of golden.workspaceRoot) {
  test(`golden WorkspaceRoot: ${row.name}`, () => {
    assert.equal(workspaceRoot({ ...row, isGo: false, complete: true, calls: 0 }), row.want);
  });
}

test("a worktree whose .git is a file and which holds go.mod is active", async () => {
  // repo().root would name the MAIN working tree, elsewhere: never consulted
  const fs = fakeFs("/w/linked", [".git", "go.mod", "cmd/"]);
  const r = await resolveProject("/w/linked", fs.list, { maxCalls: 3 });
  assert.equal(verdictOf(r, "auto"), "active");
  assert.equal(workspaceRoot(r), "/w/linked");
  assert.equal(r.calls, 1);
});

test("go.mod only under vendor/x is inactive; under backend/ from the root too", async () => {
  const vendored = fakeFs("/r", [".git/", "vendor/x/go.mod"]);
  const v = await resolveProject("/r", vendored.list, { maxCalls: 3 });
  assert.equal(verdictOf(v, "auto"), "inactive");
  // The resolver's definition: modules only in subfolders are not Go from
  // the root. From inside backend/ the same tree is Go.
  const backend = fakeFs("/r", [".git/", "backend/go.mod", "backend/cmd/"]);
  const atRoot = await resolveProject("/r", backend.list, { maxCalls: 3 });
  assert.equal(verdictOf(atRoot, "auto"), "inactive");
  const inside = await resolveProject("/r/backend/cmd", backend.list, { maxCalls: 3 });
  assert.equal(verdictOf(inside, "auto"), "active");
  assert.equal(workspaceRoot(inside), "/r/backend");
});

test("a bazel-out link to a tree holding go.mod is never followed", async () => {
  const fs = fakeFs("/r", [".git/", "bazel-out -> /cache/out", "README"]);
  const r = await resolveProject("/r", fs.list, { maxCalls: 3 });
  assert.equal(verdictOf(r, "auto"), "inactive");
  assert.deepEqual(fs.listed, ["/r"]);
});

test("past the call budget the verdict is undetermined, drawn as inactive; always forces it", async () => {
  const fs = fakeFs("/a/b/c/d/e", ["x/"]);
  const r = await resolveProject("/a/b/c/d/e/x", fs.list, { maxCalls: 3 });
  assert.equal(r.calls, 3);
  assert.equal(r.complete, false);
  assert.equal(verdictOf(r, "auto"), "undetermined");
  assert.equal(verdictOf(r, "always"), "active");
  assert.equal(verdictOf(r, "off"), "inactive");
});

test("a spent time budget stops the walk before the next listing", async () => {
  const fs = fakeFs("/r", [".git/", "go.mod", "a/b/"]);
  let checks = 0;
  const r = await resolveProject("/r/a/b", fs.list, {
    maxCalls: 3,
    expired: async () => ++checks > 1,
  });
  assert.equal(r.calls, 1);
  assert.equal(verdictOf(r, "auto"), "undetermined");
});

test("an unreadable folder ends the walk undetermined, without a throw", async () => {
  const r = await resolveProject("/r", async () => {
    throw new Error("EACCES");
  }, { maxCalls: 3 });
  assert.equal(r.calls, 1);
  assert.equal(verdictOf(r, "auto"), "undetermined");
});

test("what is walked again at the next turn", async () => {
  const goRepo = await resolveProject("/r", fakeFs("/r", [".git/", "go.mod"]).list, UNBOUNDED);
  const plain = await resolveProject("/r", fakeFs("/r", [".git/"]).list, UNBOUNDED);
  assert.equal(worthReprobing(goRepo), false);
  assert.equal(worthReprobing(plain), true, "git without go.mod: go mod init may come");
  assert.equal(worthReprobing(undefined), true);
});
