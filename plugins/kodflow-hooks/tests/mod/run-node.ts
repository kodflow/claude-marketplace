// run-node.ts — what `claude plugin test` cannot reach: a real file system,
// real `mkdir`/`mv`, and several processes writing one tasks.json at once.
//
//   node run-node.ts            the conformance corpus, the store on disk,
//                               the Go-project rule on disk, then the
//                               bash-guard corpus against the mod's guards
//   node run-node.ts --worker DIR N   (internal) N task_create in DIR
//
// Node 22.18 or later runs the TypeScript as it is (type stripping).
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { conformance } from "./conformance.ts";
import { lock, mutate, type Port } from "../../hooks/mod/store.ts";
import { plan } from "../../hooks/mod/tasks.ts";
import { goModuleOf } from "../../hooks/mod/lint.ts";
import { replay } from "./corpus.ts";
import { invariants } from "./invariants.ts";

const run = promisify(execFile);
const HERE = fileURLToPath(import.meta.url);

const disk: Port = {
  read: async (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  },
  write: async (p, text) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  },
  run: async (argv) => {
    try {
      const { stdout, stderr } = await run(argv[0]!, argv.slice(1));
      return { exitCode: 0, stdout, stderr };
    } catch (err: any) {
      return {
        exitCode: typeof err.code === "number" ? err.code : 1,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      };
    }
  },
  mtime: async (p) => {
    try {
      return statSync(p).mtimeMs;
    } catch {
      return undefined;
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

async function create(dir: string, subject: string): Promise<string> {
  const step = plan("task_create", "main", { subject, epic: 0 });
  return mutate(disk, dir, (data) =>
    step.run(data, { now: Math.floor(Date.now() / 1000), workers: [] }),
  );
}

if (process.argv[2] === "--worker") {
  const dir = process.argv[3]!;
  const n = Number(process.argv[4]);
  // Unawaited on purpose: the in-process queue must serialise them
  await Promise.all(
    Array.from({ length: n }, (_, i) => create(dir, `p${process.pid} t${i}`)),
  );
  process.exit(0);
}

let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (ok) console.log(`  ok   ${what}`);
  else {
    failed++;
    console.log(`  FAIL ${what}${detail ? `\n       ${detail}` : ""}`);
  }
};

console.log("== conformance corpus (recorded from tasks.py, then the user's tasks)");
const c = conformance();
check(
  c.failures.length === 0,
  `${c.calls} calls answered and written as tasks.py did`,
  c.failures.slice(0, 5).join("\n       "),
);

console.log("== store on a real file system");
const root = mkdtempSync(join(tmpdir(), "kf-mod-"));
try {
  const dir = join(root, "kodflow", "sessions", "s1");
  check(
    (await create(dir, "First")) === "Task #1 created: First",
    "a first mutation creates the directory and the file",
  );
  check(
    !readdirSync(dir).some((f) => f.startsWith(".tasks.") || f === ".lock.d"),
    "no temporary file and no lock left behind",
  );
  check(
    readFileSync(join(dir, "tasks.json"), "utf8").startsWith(
      '{\n "version": 2',
    ),
    "the file is written as tasks.py wrote it (indent 1)",
  );

  // A lock left by a killed process is broken once stale, and only then
  mkdirSync(join(dir, ".lock.d"));
  const old = (Date.now() - 60_000) / 1000;
  utimesSync(join(dir, ".lock.d"), old, old);
  check(
    (await create(dir, "Second")) === "Task #2 created: Second",
    "a stale lock is broken",
  );
  check(
    !readdirSync(dir).some((f) => f.startsWith(".lock.d")),
    "the broken lock is gone",
  );
  mkdirSync(join(dir, ".lock.d"));
  const t0 = Date.now();
  check(!(await lock(disk, join(dir, ".lock.d"))), "a live lock is not taken");
  check(
    Date.now() - t0 >= 1900,
    "the wait lasts the whole budget before writing through",
  );
  rmSync(join(dir, ".lock.d"), { recursive: true });

  // A refusal writes nothing
  const before = readFileSync(join(dir, "tasks.json"), "utf8");
  const step = plan("task_create", "main", { subject: "x" });
  let refused = "";
  await mutate(disk, dir, (data) =>
    step.run(data, { now: 1, workers: [] }),
  ).catch((e) => (refused = e.message));
  check(
    refused.startsWith("epic is required") &&
      readFileSync(join(dir, "tasks.json"), "utf8") === before,
    "a refusal leaves the file as it was",
  );

  console.log("== several processes, one tasks.json");
  const shared = join(root, "kodflow", "sessions", "race");
  const PROCS = 6;
  const EACH = 8;
  await Promise.all(
    Array.from({ length: PROCS }, () =>
      run(process.execPath, [HERE, "--worker", shared, String(EACH)]),
    ),
  );
  const data = JSON.parse(readFileSync(join(shared, "tasks.json"), "utf8"));
  const ids = data.tasks
    .map((t: any) => Number(t.id))
    .sort((a: number, b: number) => a - b);
  check(
    data.tasks.length === PROCS * EACH,
    `${PROCS} processes x ${EACH} calls: every task kept`,
    `${data.tasks.length} tasks`,
  );
  check(
    ids.every((id: number, i: number) => id === i + 1) &&
      data.next_id === PROCS * EACH + 1,
    "ids unique, consecutive, never reused",
  );
  check(
    !readdirSync(shared).some((f) => f !== "tasks.json"),
    "nothing left beside tasks.json",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("== the Go-project rule, on the fixtures lib/gomod.sh is held to");
const fx = JSON.parse(
  readFileSync(join(dirname(HERE), "..", "fixtures", "gomod.json"), "utf8"),
);
const tree = mkdtempSync(join(tmpdir(), "kf-gomod-"));
try {
  for (const f of fx.tree as string[]) {
    mkdirSync(dirname(join(tree, f)), { recursive: true });
    writeFileSync(join(tree, f), "");
  }
  for (const c of fx.cases as any[]) {
    const got = await goModuleOf(
      join(tree, c.file),
      join(tree, c.root),
      async (p) => existsSync(p),
      c.dir === true,
    );
    const rel = got === undefined ? null : got.slice(tree.length + 1);
    check(rel === c.module, c.name, `want ${c.module}, got ${rel}`);
  }
} finally {
  rmSync(tree, { recursive: true, force: true });
}

console.log("== bash-guard corpus, the mod's guards (a real git repository)");
// The same stage as scripts/tests/test_hooks.sh: a repository on feat/test,
// KODFLOW_ROOT off but for the rows marked root, no merge token.
const lab = mkdtempSync(join(tmpdir(), "kf-guard-"));
try {
  const repo = join(lab, "repo");
  mkdirSync(repo);
  await run("git", ["-C", repo, "init", "-q", "-b", "feat/test"]);
  await run("git", ["-C", repo, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "chore: seed"]);
  const corpus = readFileSync(
    join(dirname(HERE), "..", "fixtures", "bash-guard.jsonl"),
    "utf8",
  );
  const r = await replay(corpus, {
    projectDir: repo,
    home: join(lab, "home"),
    configDir: join(lab, "home", ".claude"),
    read: async (p) => {
      try {
        return readFileSync(p.startsWith("/") ? p : join(repo, p), "utf8");
      } catch {
        return undefined;
      }
    },
    git: async (dir, args) => {
      try {
        return (await run("git", ["-C", dir, ...args])).stdout;
      } catch {
        return undefined;
      }
    },
    mergeAllowed: async () => false,
  });
  for (const g of r.gaps) console.log(`  gap  ${g}`);
  check(
    r.failures.length === 0 && r.rows > 200,
    `${r.rows} Bash rows decided as on-tool.sh decides them (${r.passed} passed, ${r.gaps.length} known gaps, ${r.otherTools} rows of other tools left to the shell)`,
    r.failures.slice(0, 10).join("\n       "),
  );
} finally {
  rmSync(lab, { recursive: true, force: true });
}

console.log("== invariants over the hooks module");
{
  const bad = invariants(join(dirname(HERE), "..", "..", "hooks", "mod"));
  check(
    bad.length === 0,
    "never allow; { result } only from the task tools, the filter and the veil; the secret variables read are SECRET_VARS",
    bad.join("\n       "),
  );
}

console.log(failed ? `${failed} failure(s)` : "all passed");
process.exit(failed ? 1 : 0);
