// lint.test.ts — lint.ts under `claude plugin test`: the Go-project rule on
// a file system in memory, and /lint-setup over a fake host. The rule on a
// real disk, against tests/fixtures/gomod.json, is run-node.ts's.
import { test, expect } from "claude-code/testing";
import {
  goModuleOf,
  lintSetup,
  yamlProblems,
  type LintPort,
  type RunResult,
} from "../../hooks/mod/lint.ts";

const MOD = "/repo/projects/making.codes";

type Fake = LintPort & {
  files: Map<string, string>;
  dirs: Set<string>;
  runs: string[][];
  asked: string[];
};

const SOUND = JSON.stringify({ ok: true, hosts: [], defects: [] });
const UNSOUND = JSON.stringify({
  ok: false,
  hosts: [],
  defects: [
    {
      code: "legacy_http",
      host: "claude",
      message: "an HTTP hook to a daemon route",
    },
  ],
});

function fake(o: {
  answers?: (string | undefined)[];
  /** Which binary answers `version`: ktn-linter, the old name, or none. */
  bin?: "ktn-linter" | "project-linter" | false;
  /** Successive `hook doctor --json` answers; the last one repeats. */
  doctor?: RunResult[];
  /** Successive `daemon status` exit codes; the last one repeats. */
  status?: number[];
  install?: RunResult;
  vars?: LintPort["vars"];
}): Fake {
  const answers = [...(o.answers ?? [])];
  const doctor = [...(o.doctor ?? [{ exitCode: 0, stdout: SOUND, stderr: "" }])];
  const status = [...(o.status ?? [0])];
  const next = <T,>(xs: T[]): T => (xs.length > 1 ? xs.shift()! : xs[0]!);
  const bin = o.bin ?? "ktn-linter";
  const installed = "/h/.local/bin/ktn-linter";
  const f: Fake = {
    files: new Map([[`${MOD}/go.mod`, "module x\n"]]),
    dirs: new Set(["/repo", "/repo/projects", MOD, `${MOD}/cmd`]),
    runs: [],
    asked: [],
    root: "/repo",
    vars: o.vars ?? {},
    exists: async (p) => f.files.has(p) || f.dirs.has(p),
    isDir: async (p) => f.dirs.has(p),
    read: async (p) => f.files.get(p),
    sleep: async () => undefined,
    ask: async (q) => (f.asked.push(q), answers.shift()),
    run: async (argv) => {
      f.runs.push([...argv]);
      const ok = (stdout = ""): RunResult => ({
        exitCode: 0,
        stdout,
        stderr: "",
      });
      if (argv[0] === "bash" && argv[2]?.includes("api.github.com"))
        return o.install ?? ok(`v1.46.0 ${installed}\n`);
      if (argv[0] === "bash") return ok();
      const known = argv[0] === bin || argv[0] === installed;
      if (!known) return undefined;
      if (argv[1] === "version") return ok(`${argv[0]} version 1.46.0\n`);
      if (argv[1] === "hook" && argv[2] === "doctor") return next(doctor);
      if (argv[1] === "hook" && argv[2] === "install") return ok("installed\n");
      if (argv[1] === "daemon" && argv[2] === "status")
        return { exitCode: next(status), stdout: "", stderr: "" };
      if (argv[1] === "daemon") return ok();
      return { exitCode: 40, stdout: "", stderr: "unknown command" };
    },
  };
  return f;
}

test("the Go project is the nearest go.mod, never above the root", async () => {
  const files = new Set([`${MOD}/go.mod`, "/go.mod", "/repo/x/go.mod"]);
  const exists = async (p: string) => files.has(p);
  expect(await goModuleOf(`${MOD}/cmd/app/main.go`, "/repo", exists)).toBe(MOD);
  expect(await goModuleOf("/repo/README.md", "/repo", exists)).toBeUndefined();
  expect(await goModuleOf("/repo/x", "/repo", exists, true)).toBe("/repo/x");
  expect(await goModuleOf("/repo2/a.go", "/repo", exists)).toBeUndefined();
  expect(await goModuleOf("rel/a.go", "/repo", exists)).toBeUndefined();
  expect(await goModuleOf("/a/b.go", "/", exists)).toBe("/");
});

test("configuration: yaml mistakes", () => {
  expect(yamlProblems("version: 1\nphases:\n  enabled: [1,2]\n")).toEqual([]);
  expect(
    yamlProblems(
      "phases:\n  enabled: [1]\n  disabled: [2]\nreview_scope: difff\nmax_phase: 3\n",
    ),
  ).toEqual([
    'review_scope is "difff": it must be diff or full',
    "max_phase is no longer read: list phases.enabled instead",
    "phases.enabled and phases.disabled are both set: keep one",
  ]);
  // enabled under another key is not the phases block's
  expect(
    yamlProblems("phases:\n  enabled: [1]\nother:\n  disabled: x\n"),
  ).toEqual([]);
});

test("/lint-setup outside a Go project: nothing checked, nothing asked", async () => {
  const f = fake({});
  const text = await lintSetup(f, "");
  expect(text).toContain("No go.mod at or above /repo inside /repo");
  expect(f.runs).toEqual([]);
  expect(f.asked).toEqual([]);
});

test("/lint-setup on a healthy module: ok lines, nothing asked, no port", async () => {
  const f = fake({});
  const text = await lintSetup(f, "projects/making.codes/cmd");
  expect(text).toContain(`Go module: ${MOD}`);
  expect(text).toContain("binary   ok, ktn-linter version 1.46.0");
  expect(text).toContain("hooks    ok, ktn-linter hook doctor");
  expect(text).toContain("daemon   per project, started by the MCP server");
  expect(text).toContain("config   ok (ktn-linter's defaults)");
  expect(f.asked).toEqual([]);
  expect(f.runs.some((a) => a[0] === "bash" || a[0] === "curl")).toBe(false);
  expect(f.runs).toContainEqual(["ktn-linter", "hook", "doctor", "--json"]);
  // the daemon is not probed without KTN_USER_DAEMON=1
  expect(f.runs.some((a) => a[1] === "daemon")).toBe(false);
  expect(text).not.toContain("7717");
});

test("/lint-setup falls back on project-linter only when ktn-linter is absent", async () => {
  const f = fake({ bin: "project-linter" });
  const text = await lintSetup(f, MOD);
  expect(f.runs[0]).toEqual(["ktn-linter", "version"]);
  expect(text).toContain("found as project-linter, the old name");
  expect(f.runs).toContainEqual(["project-linter", "hook", "doctor", "--json"]);
  // an old binary without `hook`: said, never asked
  const g = fake({
    bin: "project-linter",
    doctor: [{ exitCode: 40, stdout: "", stderr: "unknown command" }],
  });
  const t = await lintSetup(g, MOD);
  expect(t).toContain("hooks    unavailable: project-linter predates `hook install`");
  expect(g.asked).toEqual([]);
});

test("/lint-setup installs and starts nothing it was not allowed to", async () => {
  // Declined, then nobody to ask (a -p run): no bash at all
  for (const answers of [["Not now"], [undefined]]) {
    const f = fake({ bin: false, answers, vars: { KTN_USER_DAEMON: "1" } });
    const text = await lintSetup(f, MOD);
    expect(f.asked.length).toBe(1);
    expect(f.asked[0]).toContain("Install its latest release");
    expect(f.runs.some((a) => a[0] === "bash")).toBe(false);
    expect(text).toContain("binary   missing");
    expect(text).toContain("hooks    needs the binary first");
    expect(text).toContain("daemon   needs the binary first");
  }
  const g = fake({
    doctor: [{ exitCode: 1, stdout: UNSOUND, stderr: "" }],
    status: [1],
    answers: ["Not now", "Not now"],
    vars: { KTN_USER_DAEMON: "1" },
  });
  const t = await lintSetup(g, MOD);
  expect(g.asked[0]).toContain("Run `ktn-linter hook install`?");
  expect(g.asked[1]).toContain("`ktn-linter daemon ensure`?");
  expect(g.runs.some((a) => a[1] === "hook" && a[2] === "install")).toBe(false);
  expect(g.runs.some((a) => a[1] === "daemon" && a[2] === "ensure")).toBe(false);
  expect(t).toContain("legacy_http (claude): an HTTP hook to a daemon route");
  expect(t).toContain("not installed: ktn-linter hook install, then ktn-linter hook doctor");
  expect(t).toContain("not started: ktn-linter daemon ensure");
});

test("/lint-setup, every fix accepted: install, hook install, daemon ensure", async () => {
  const f = fake({
    bin: false,
    doctor: [
      { exitCode: 1, stdout: UNSOUND, stderr: "" },
      { exitCode: 0, stdout: SOUND, stderr: "" },
    ],
    status: [1, 0],
    answers: ["Install", "Install the hooks", "Start it"],
    vars: { KTN_USER_DAEMON: "1" },
  });
  const text = await lintSetup(f, MOD);
  const bash = f.runs.filter((a) => a[0] === "bash");
  expect(bash.length).toBe(1);
  expect(bash[0]![2]).toContain("repos/kodflow/ktn/releases/latest");
  expect(bash[0]![2]).toContain("checksums.txt");
  expect(bash[0]![2]).toContain("ktn-hook");
  expect(bash[0]![2]).toContain("mv -f");
  expect(text).toContain("installed v1.46.0 at /h/.local/bin/ktn-linter");
  const bin = "/h/.local/bin/ktn-linter";
  expect(f.runs).toContainEqual([bin, "hook", "install"]);
  expect(f.runs).toContainEqual([bin, "daemon", "ensure"]);
  expect(text).toContain("installed; hook doctor now reports ok");
  expect(text).toContain("started (ktn-linter daemon ensure)");
  expect(f.runs.some((a) => a[0] === "curl")).toBe(false);
});

test("/lint-setup reports configuration problems and never writes them", async () => {
  const f = fake({});
  f.files.set(
    `${MOD}/.ktn-linter.yaml`,
    "phases:\n  enabled: [1]\n  disabled: [2]\n",
  );
  const text = await lintSetup(f, MOD);
  expect(text).toContain("config   1 problem(s), to fix by hand");
  expect(text).toContain(
    ".ktn-linter.yaml: phases.enabled and phases.disabled are both set",
  );
  expect(f.asked).toEqual([]);
  // the old name is read only when the new one is absent
  const g = fake({});
  g.files.set(`${MOD}/.project-linter.yaml`, "max_phase: 3\n");
  expect(await lintSetup(g, MOD)).toContain(
    ".project-linter.yaml: max_phase is no longer read",
  );
  g.files.set(`${MOD}/.ktn-linter.yaml`, "version: 1\n");
  expect(await lintSetup(g, MOD)).toContain("config   ok (.ktn-linter.yaml)");
});
