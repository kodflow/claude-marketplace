// lint.test.ts — lint.ts under `claude plugin test`: the Go-project rule on
// a file system in memory, and /lint-setup over a fake host. The rule on a
// real disk, against tests/fixtures/gomod.json, is run-node.ts's.
import { test, expect } from "claude-code/testing";
import {
  goModuleOf,
  lintSetup,
  unknownPhases,
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

function fake(o: {
  answers?: (string | undefined)[];
  bin?: boolean;
  healthy?: boolean[];
  install?: RunResult;
  vars?: LintPort["vars"];
}): Fake {
  const answers = [...(o.answers ?? [])];
  const healthy = [...(o.healthy ?? [false])];
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
      if (
        argv[0] === "project-linter" ||
        argv[0] === "/h/.local/bin/project-linter"
      )
        return o.bin || argv[0] !== "project-linter"
          ? ok("project-linter version 1.2.3\n")
          : undefined;
      if (argv[0] === "curl")
        return ok(
          healthy.length > 1
            ? healthy.shift()
              ? "200"
              : "000"
            : healthy[0]
              ? "200"
              : "000",
        );
      if (argv[0] === "bash" && argv[2]?.includes("api.github.com"))
        return o.install ?? ok("v1.2.3 /h/.local/bin/project-linter\n");
      if (argv[0] === "bash") return ok();
      return undefined;
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

test("phases: names and numbers project-linter accepts, yaml mistakes", () => {
  expect(unknownPhases("structural, signature,LOGIC,4,perf,9")).toEqual([]);
  expect(unknownPhases("styles,0,10,,tests")).toEqual(["styles", "0", "10"]);
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
  const f = fake({ bin: true, healthy: [true] });
  const text = await lintSetup(f, "");
  expect(text).toContain("No go.mod at or above /repo inside /repo");
  expect(f.runs).toEqual([]);
  expect(f.asked).toEqual([]);
});

test("/lint-setup on a healthy module: three ok lines, nothing asked", async () => {
  const f = fake({
    bin: true,
    healthy: [true],
    vars: { KTN_STOP_PHASES: "logic,style" },
  });
  const text = await lintSetup(f, "projects/making.codes/cmd");
  expect(text).toContain(`Go module: ${MOD}`);
  expect(text).toContain("binary   ok, project-linter version 1.2.3");
  expect(text).toContain("daemon   ok, :7717 answers /health");
  expect(text).toContain("phases   ok (project-linter's defaults");
  expect(f.asked).toEqual([]);
  expect(f.runs.some((a) => a[0] === "bash")).toBe(false);
});

test("/lint-setup installs and starts nothing it was not allowed to", async () => {
  // Declined, then nobody to ask (a -p run): no bash at all
  for (const answers of [["Not now"], [undefined]]) {
    const f = fake({ bin: false, answers });
    const text = await lintSetup(f, MOD);
    expect(f.asked.length).toBe(1);
    expect(f.asked[0]).toContain("Install its latest release");
    expect(f.runs.some((a) => a[0] === "bash")).toBe(false);
    expect(text).toContain("binary   missing");
    expect(text).toContain("needs the binary first");
  }
  const g = fake({ bin: true, healthy: [false], answers: ["Not now"] });
  const t = await lintSetup(g, MOD);
  expect(g.asked[0]).toContain("Start it on :7717?");
  expect(g.runs.some((a) => a[0] === "bash")).toBe(false);
  expect(t).toContain("not started: project-linter serve --port=7717");
});

test("/lint-setup, both fixes accepted: install, then serve on the configured port", async () => {
  const f = fake({
    bin: false,
    healthy: [false, false, true],
    answers: ["Install", "Start it"],
    vars: { KTN_LINTER_PORT: "7799" },
  });
  const text = await lintSetup(f, MOD);
  const bash = f.runs.filter((a) => a[0] === "bash");
  expect(bash.length).toBe(2);
  expect(bash[0]![2]).toContain("releases/latest");
  expect(bash[0]![2]).toContain("mv -f");
  expect(bash[1]!.slice(3)).toEqual(["/h/.local/bin/project-linter", "7799"]);
  expect(text).toContain("installed v1.2.3 at /h/.local/bin/project-linter");
  expect(text).toContain("started on :7799");
  expect(
    f.runs
      .filter((a) => a[0] === "curl")
      .every((a) => a.at(-1) === "http://127.0.0.1:7799/health"),
  ).toBe(true);
});

test("/lint-setup reports phase problems and never writes them", async () => {
  const f = fake({
    bin: true,
    healthy: [true],
    vars: { KTN_PRE_PHASES: "structural,bogus" },
  });
  f.files.set(
    `${MOD}/.project-linter.yaml`,
    "phases:\n  enabled: [1]\n  disabled: [2]\n",
  );
  const text = await lintSetup(f, MOD);
  expect(text).toContain("phases   2 problem(s), to fix by hand");
  expect(text).toContain("KTN_PRE_PHASES names unknown phases: bogus");
  expect(text).toContain(
    ".project-linter.yaml: phases.enabled and phases.disabled are both set",
  );
  expect(f.asked).toEqual([]);
});
