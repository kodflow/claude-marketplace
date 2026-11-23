// host.test.ts — host.ts and the pure modules that read paths through it:
// the same answers for a POSIX path and its Windows spelling.
import { test, expect } from "claude-code/testing";
import {
  bashCandidates,
  homeOf,
  hostArgv,
  isAbsolutePath,
  joinPath,
  rootOf,
  slashed,
  trimSlash,
} from "../../hooks/mod/host.ts";
import { normalize, targetOf, parse } from "../../hooks/mod/collision.ts";
import { worktreePaths } from "../../hooks/mod/cleanup.ts";
import { goModuleOf } from "../../hooks/mod/lint.ts";
import { modPath } from "../../hooks/mod/guards.ts";
import { insideRoots, isScratchpad, plainPath, scriptRoots } from "../../hooks/mod/tier.ts";

test("absolute on every host: /, a drive, a UNC share", () => {
  for (const p of ["/", "/a", "C:\\", "C:\\Profiles\\dev", "c:/x", "\\\\srv\\share"])
    expect(isAbsolutePath(p)).toBe(true);
  for (const p of ["", "a", "./a", "~", "~/x", "C:", "C:x", "\\x", undefined, 3])
    expect(isAbsolutePath(p)).toBe(false);
});

test("slashes, roots, trims and joins", () => {
  expect(slashed("C:\\a\\b")).toBe("C:/a/b");
  expect(slashed("\\\\srv\\share\\a")).toBe("//srv/share/a");
  // A backslash is a file name character on POSIX
  expect(slashed("/a\\b")).toBe("/a\\b");
  expect(rootOf("/a/b")).toBe("/");
  expect(rootOf("C:\\a")).toBe("C:/");
  expect(rootOf("\\\\srv\\share\\a")).toBe("//srv/share/");
  expect(rootOf("a/b")).toBeUndefined();
  expect(trimSlash("/a/b//")).toBe("/a/b");
  expect(trimSlash("/")).toBe("/");
  expect(trimSlash("C:\\")).toBe("C:/");
  expect(trimSlash("C:\\a\\")).toBe("C:/a");
  expect(joinPath("C:\\repo", "x/y")).toBe("C:/repo/x/y");
  expect(joinPath("/repo/", "x")).toBe("/repo/x");
  expect(joinPath("/", "x")).toBe("/x");
  expect(joinPath("C:/", "x")).toBe("C:/x");
  expect(joinPath("/repo", "D:\\abs")).toBe("D:/abs");
});

test("home: HOME when absolute, else USERPROFILE", () => {
  expect(homeOf("/srv/me", "C:\\Profiles\\dev")).toBe("/srv/me");
  expect(homeOf("C:\\Profiles\\dev", undefined)).toBe("C:/Profiles/dev");
  expect(homeOf(undefined, "C:\\Profiles\\dev\\")).toBe("C:/Profiles/dev");
  expect(homeOf("", "C:\\Profiles\\dev")).toBe("C:/Profiles/dev");
  expect(homeOf("~", undefined)).toBeUndefined();
  expect(homeOf(undefined, undefined)).toBeUndefined();
});

test("Git Bash is looked for on Windows only, Claude Code's own setting first", () => {
  expect(bashCandidates({ ProgramFiles: "C:\\Program Files" })).toEqual([]);
  expect(
    bashCandidates({
      OS: "Windows_NT",
      CLAUDE_CODE_GIT_BASH_PATH: "D:\\git\\bin\\bash.exe",
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Profiles\\dev\\AppData\\Local",
    }),
  ).toEqual([
    "D:\\git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Profiles\\dev\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
  ]);
});

test("argv: unchanged off Windows, through Git Bash on it", () => {
  expect(hostArgv(["mv", "-f", "a", "b"], undefined)).toEqual(["mv", "-f", "a", "b"]);
  const B = "C:\\Git\\bin\\bash.exe";
  expect(hostArgv(["bash", "x.sh"], B)).toEqual([B, "x.sh"]);
  expect(hostArgv(["sh", "-c", "s", "n", "f"], B)).toEqual([B, "-c", "s", "n", "f"]);
  expect(hostArgv(["mv", "-f", "a", "b"], B).slice(3)).toEqual(["kodflow", "mv", "-f", "a", "b"]);
  // A native program is started as it is
  expect(hostArgv(["git", "status"], B)).toEqual(["git", "status"]);
  expect(hostArgv([], B)).toEqual([]);
});

test("collision: a Windows target is absolute, normalised under its drive", () => {
  expect(normalize("/a/./b/../c")).toBe("/a/c");
  expect(normalize("c:\\a\\.\\b\\..\\c")).toBe("C:/a/c");
  expect(normalize("C:/..")).toBe("C:/");
  expect(targetOf("Write", { file_path: "C:\\repo\\x.ts" }, "C:\\other")).toBe("C:/repo/x.ts");
  expect(targetOf("Edit", { file_path: "src\\..\\x.ts" }, "C:\\repo")).toBe("C:/repo/x.ts");
  expect(targetOf("Edit", { file_path: "x.ts" }, "/repo")).toBe("/repo/x.ts");
  expect(parse("1\tC:/repo/x.ts\n2\trel\n3\t/a")).toEqual([
    { at: 1, path: "C:/repo/x.ts" },
    { at: 3, path: "/a" },
  ]);
});

test("cleanup: a worktree named by a drive path", () => {
  expect(worktreePaths("cd C:/src/x/.worktrees/w1 && ls", undefined)).toEqual([
    "C:/src/x/.worktrees/w1",
  ]);
  expect(
    worktreePaths(JSON.stringify({ file_path: "C:\\src\\x\\.worktrees\\w2\\a.ts" }), undefined),
  ).toEqual(["C:/src/x/.worktrees/w2"]);
  expect(worktreePaths("cd ~/x/.worktrees/w3", "C:\\Profiles\\dev")).toEqual([
    "C:/Profiles/dev/x/.worktrees/w3",
  ]);
  expect(worktreePaths("cd /r/.worktrees/w4", undefined)).toEqual(["/r/.worktrees/w4"]);
});

test("lint: the go.mod is found under a drive root", async () => {
  const files = new Set(["C:/repo/svc/go.mod"]);
  const exists = async (p: string) => files.has(p);
  expect(await goModuleOf("C:\\repo\\svc\\cmd\\main.go", "C:\\repo", exists)).toBe("C:/repo/svc");
  expect(await goModuleOf("C:\\repo\\other\\x.go", "C:\\repo", exists)).toBeUndefined();
  expect(await goModuleOf("D:\\elsewhere\\x.go", "C:\\repo", exists)).toBeUndefined();
  expect(await goModuleOf("/r/x.go", "/r", async (p) => p === "/r/go.mod")).toBe("/r");
});

test("guards: plugin machinery under a Windows config directory", () => {
  expect(
    modPath("C:\\Profiles\\dev\\.claude\\skills\\s\\.claude-plugin\\plugin.json", "C:/Profiles/dev", "C:/Profiles/dev/.claude"),
  ).toBe(true);
  expect(modPath("C:\\Profiles\\dev\\.claude\\skills\\s\\SKILL.md", "C:/Profiles/dev", undefined)).toBe(false);
  expect(modPath("/h/.claude/skills/s/hooks/hooks.json", "/h", undefined)).toBe(true);
});

test("tier: a Windows scriptPath is judged, not passed over", () => {
  expect(plainPath("C:\\Profiles\\dev\\wf.js")).toBe(true);
  expect(plainPath("C:\\Profiles\\dev\\..\\wf.js")).toBe(false);
  expect(plainPath("/a/b.js")).toBe(true);
  expect(plainPath("/a/../b.js")).toBe(false);
  expect(plainPath("rel.js")).toBe(false);
  const roots = scriptRoots({ config: "C:/Profiles/dev/.claude", cwd: "C:\\src\\x", session: "s1" });
  expect(roots).toContain("C:/Profiles/dev/.claude/projects/C--src-x/s1/");
  expect(roots).toContain("C:/src/x/");
  expect(insideRoots("C:\\src\\x\\wf.js", roots, "s1")).toBe(true);
  expect(insideRoots("C:\\src\\y\\wf.js", roots, "s1")).toBe(false);
  expect(
    isScratchpad("C:\\Profiles\\dev\\AppData\\Local\\Temp\\claude\\abc123\\s1\\scratchpad\\wf.js", "s1"),
  ).toBe(true);
  expect(isScratchpad("/tmp/claude-501/slug/s1/scratchpad/wf.js", "s1")).toBe(true);
  expect(isScratchpad("C:\\Temp\\claude\\abc\\s2\\scratchpad\\wf.js", "s1")).toBe(false);
});
