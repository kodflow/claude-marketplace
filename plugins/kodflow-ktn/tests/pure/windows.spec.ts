// windows.spec.ts — the project walk from a Windows session root. Before,
// the parent of C:\src\x\svc was "/", so the walk skipped every folder
// between the start and the drive and never met the go.mod above it.
//
//   node --test tests/pure/*.spec.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseOf,
  clean,
  parentOf,
  resolveProject,
  type Entry,
} from "../../hooks/mod/project.ts";

const UNBOUNDED = { maxCalls: Infinity };
const file = (name: string): Entry => ({ name, kind: "file", isLink: false });
const dir = (name: string): Entry => ({ name, kind: "dir", isLink: false });

test("a drive path's parent, base and trailing separator, in either spelling", () => {
  assert.equal(parentOf("C:\\src\\x"), "C:\\src");
  assert.equal(parentOf("C:\\src"), "C:\\");
  assert.equal(parentOf("C:\\"), "C:\\");
  assert.equal(parentOf("C:/src/x"), "C:/src");
  assert.equal(parentOf("C:/"), "C:/");
  assert.equal(baseOf("C:\\src\\vendor"), "vendor");
  assert.equal(clean("C:\\src\\x\\"), "C:\\src\\x");
  assert.equal(clean("C:\\"), "C:\\");
  // POSIX unchanged, a backslash there a name character
  assert.equal(parentOf("/a/b"), "/a");
  assert.equal(parentOf("/"), "/");
  assert.equal(baseOf("/a/b\\c"), "b\\c");
  assert.equal(clean("/a/"), "/a");
});

test("the walk climbs a Windows tree folder by folder to the git root", async () => {
  const tree = new Map<string, Entry[]>([
    ["C:\\src\\repo\\svc\\cmd", [file("main.go")]],
    ["C:\\src\\repo\\svc", [dir("cmd"), file("go.mod")]],
    ["C:\\src\\repo", [dir("svc"), dir(".git")]],
  ]);
  const listed: string[] = [];
  const list = async (d: string) => {
    listed.push(d);
    const e = tree.get(d);
    if (!e) throw new Error(`ENOENT ${d}`);
    return e;
  };
  const r = await resolveProject("C:\\src\\repo\\svc\\cmd\\", list, UNBOUNDED);
  assert.deepEqual(listed, ["C:\\src\\repo\\svc\\cmd", "C:\\src\\repo\\svc", "C:\\src\\repo"]);
  assert.equal(r.gitRoot, "C:\\src\\repo");
  assert.equal(r.moduleRoot, "C:\\src\\repo\\svc");
  assert.equal(r.isGo, true);
  assert.equal(r.complete, true);
});
