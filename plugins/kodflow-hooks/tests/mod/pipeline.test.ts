// pipeline.test.ts — the Bash pipeline's pure modules, under `claude plugin
// test`: the policies' order and failures, the output filter, the secret
// veil, the merge gate, the blast radius, and the invariants over the whole
// module. Credential shapes are assembled at run time: this file must not
// carry one itself (scripts/sanitize.py).
import { test, expect } from "claude-code/testing";
import {
  runBash,
  mergeFailure,
  mayMerge,
  type Policies,
} from "../../hooks/mod/pipeline.ts";
import {
  BYTE_READS,
  FILTER_VERSIONS,
  compress,
  filterResult,
  readsBytes,
  versionOk,
} from "../../hooks/mod/filter.ts";
import {
  entropy,
  exempt,
  veil,
  veilResult,
} from "../../hooks/mod/veil.ts";
import {
  classifyBash,
  classifyMcp,
  gate,
  githubCi,
  isExempt,
  remoteRepo,
  resetApprovals,
  YES,
  NO,
  type MergePort,
} from "../../hooks/mod/merge.ts";
import { blastRadius } from "../../hooks/mod/blast.ts";
import { parse, argvOf, ansiC } from "../../hooks/mod/shell.ts";
import { withLease } from "../../hooks/mod/guards.ts";

// ---------------------------------------------------------------------------
// The pipeline: order and fault injection, one policy at a time
// ---------------------------------------------------------------------------

const R = {
  ref: 1,
  result: {
    stdout: "out",
    stderr: "",
    interrupted: false,
    isImage: false,
    noOutputExpected: false,
  },
  text: "out",
};

function policies(over: Partial<Policies> = {}) {
  const log: string[] = [];
  const p: Policies = {
    merge: async () => undefined,
    guards: async () => undefined,
    blast: async () => undefined,
    filter: async (r) => r,
    log: (policy, decision) => log.push(`${policy}:${decision}`),
    ...over,
  };
  return { p, log };
}

async function play(over: Partial<Policies>) {
  let ran = 0;
  const { p, log } = policies(over);
  const out = await runBash(async () => {
    ran++;
    return R;
  }, p);
  return { out, ran, log };
}

const boom = async (): Promise<never> => {
  throw new Error("injected");
};

test("policies run in order: merge, guards, blast, the call, the filter", async () => {
  const seen: string[] = [];
  const { p } = policies({
    merge: async () => (seen.push("merge"), undefined),
    guards: async () => (seen.push("guards"), undefined),
    blast: async () => (seen.push("blast"), undefined),
    filter: async (r) => (seen.push("filter"), r),
  });
  await runBash(async () => (seen.push("next"), R), p);
  expect(seen).toEqual(["merge", "guards", "blast", "next", "filter"]);
});

test("a failing merge policy refuses, and the call never runs", async () => {
  const { out, ran, log } = await play({ merge: boom });
  expect(ran).toBe(0);
  expect((out as any).deny).toContain("[motif:merge]");
  expect(log).toEqual(["merge:deny"]);
});

test("a failing guard policy is logged and the call goes on", async () => {
  const { out, ran, log } = await play({ guards: boom });
  expect(ran).toBe(1);
  expect(out).toBe(R);
  expect(log).toEqual(["guards:error"]);
});

test("a failing blast policy is logged and the call goes on", async () => {
  const { out, ran, log } = await play({ blast: boom });
  expect(ran).toBe(1);
  expect(out).toBe(R);
  expect(log).toEqual(["blast:error"]);
});

test("a failing filter returns r untouched", async () => {
  const { out, ran, log } = await play({ filter: boom });
  expect(ran).toBe(1);
  expect(out).toBe(R);
  expect(log).toEqual(["filter:error"]);
});

test("a refusal stops the line where it is raised", async () => {
  const deny = { deny: "no" };
  for (const k of ["merge", "guards", "blast"] as const) {
    const { out, ran } = await play({ [k]: async () => deny });
    expect(out).toBe(deny);
    expect(ran).toBe(0);
  }
});

test("the hook's last resort refuses a line that may merge, nothing else", () => {
  expect(mayMerge("gh pr merge 3")).toBe(true);
  expect(mayMerge("curl -X PUT https://x/repos/o/r/pulls/3/merge")).toBe(true);
  expect(mayMerge("git status")).toBe(false);
  expect(mergeFailure(new Error("x")).deny).toContain("[motif:merge]");
});

// ---------------------------------------------------------------------------
// L3 · the output filter
// ---------------------------------------------------------------------------

const STATUS = [
  "On branch feat/x",
  "Changes not staged for commit:",
  '  (use "git add <file>..." to update what will be committed)',
  '  (use "git restore <file>..." to discard changes in working directory)',
  "\tmodified:   a.txt",
  "",
  "",
  "Untracked files:",
  '  (use "git add <file>..." to include in what will be committed)',
  "\tb.txt",
  "",
  'no changes added to commit (use "git add" and/or "git commit -a")',
  "",
].join("\n");

const bash = (stdout: string, extra: Record<string, unknown> = {}) => ({
  ref: 7,
  text: stdout,
  isReadOnly: true,
  result: {
    stdout,
    stderr: "",
    interrupted: false,
    isImage: false,
    noOutputExpected: false,
    ...extra,
  },
});

test("git status: the hints go, every path stays, every other key is kept", () => {
  const r = bash(STATUS);
  const out: any = filterResult("git status", r, true);
  expect(out).not.toBe(r);
  expect(out.result.stdout).not.toContain("(use ");
  expect(out.result.stdout).toContain("modified:   a.txt");
  expect(out.result.stdout).toContain("b.txt");
  expect(out.result.stdout).toContain("no changes added to commit");
  expect(Object.keys(out).sort()).toEqual(Object.keys(r).sort());
  expect(Object.keys(out.result).sort()).toEqual(Object.keys(r.result).sort());
  expect(out.ref).toBe(7);
  expect(out.result.stderr).toBe("");
});

test("git log: one header line a commit, the message kept", () => {
  const sha = "a".repeat(40);
  const log = `commit ${sha} (HEAD -> main)\nAuthor: Ann <ann@example.invalid>\nDate:   Mon Oct 13 21:50:00 2026 +0200\n\n    feat: one\n\n    body line\n\ncommit ${"b".repeat(40)}\nMerge: 1 2\nAuthor: Bob <b@example.invalid>\nDate:   Sun Oct 12 10:00:00 2026 +0200\n\n    fix: two\n`;
  const out = compress("git log", log)!;
  expect(out).toContain(`${"a".repeat(12)} (HEAD -> main) · Ann · Mon Oct 13`);
  expect(out).toContain("  feat: one");
  expect(out).toContain("  body line");
  expect(out).toContain("fix: two");
  expect(out.length).toBeLessThan(log.length);
  expect(compress("git log --oneline", log)).toBeUndefined();
  expect(compress("git log -p", log)).toBeUndefined();
});

test("git diff: index lines go, the hunks stay", () => {
  const d =
    "diff --git a/x b/x\nindex 0123abc..4567def 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
  const out = compress("git diff", d)!;
  expect(out).not.toContain("index 0123abc");
  expect(out).toContain("+b");
  expect(compress("git diff --stat", d)).toBeUndefined();
});

test("ls -l, find and grep -rn are compressed; plain forms are left alone", () => {
  const ls =
    "total 8\n-rw-r--r--  1 ann  staff  1272 Oct 13 21:50 beat.sh\ndrwxr-xr-x  8 ann  staff   256 Oct 13 21:50 lib\n";
  expect(compress("ls -la", ls)).toBe(
    "-rw-r--r-- 1272 Oct 13 21:50 beat.sh\ndrwxr-xr-x 256 Oct 13 21:50 lib\n",
  );
  expect(compress("ls", "a\nb\n")).toBeUndefined();
  const files =
    Array.from({ length: 30 }, (_, i) => `./src/deep/dir/f${i}.ts`).join("\n") +
    "\n";
  const f = compress("find . -name '*.ts'", files)!;
  expect(f.startsWith("./src/deep/dir/\n  f0.ts\n")).toBe(true);
  expect(compress("find . -name x -exec rm {} ;", files)).toBeUndefined();
  const hits =
    Array.from(
      { length: 25 },
      (_, i) => `src/a.ts:${i + 1}:const x${i} = 1`,
    ).join("\n") + "\n";
  const g = compress("grep -rn x src", hits)!;
  expect(g.startsWith("src/a.ts\n  1: const x0 = 1\n")).toBe(true);
  expect(compress("grep -rn -A2 x src", hits)).toBeUndefined();
  expect(compress("grep -n x a.ts", hits)).toBeUndefined();
});

// The "bytes" corpus: reads whose every byte counts are returned as they
// came, whatever their output looks like.
const BYTES_CORPUS = [
  "cat a.txt",
  "head -n 5 a.txt",
  "tail -f log",
  "sed -n 1,5p a.txt",
  "diff a b",
  "git show HEAD:a.txt",
  "git cat-file -p HEAD",
  "git -C x show HEAD",
  "git status && cat a.txt",
  "rtk proxy cat a.txt",
  "sudo cat /etc/hosts",
  "awk '{print}' f",
  "jq . f.json",
  "base64 -d f",
  "xxd f",
];

test("the bytes corpus: a read whose bytes count is never touched", () => {
  for (const line of BYTES_CORPUS) {
    expect(readsBytes(line)).toBe(true);
    for (const stdout of [STATUS, "x\n".repeat(50)]) {
      const r = bash(stdout);
      expect(filterResult(line, r, true)).toBe(r);
    }
  }
  for (const name of ["cat", "head", "tail", "sed", "diff"])
    expect(BYTE_READS.has(name)).toBe(true);
});

test("the filter's conditions: string stdout, success, plain result, one command, a validated engine", () => {
  const r = bash(STATUS);
  expect(filterResult("git status", r, false)).toBe(r);
  for (const extra of [
    { persistedOutputPath: "/tmp/out.txt" },
    { isImage: true },
    { backgroundTaskId: "b1" },
    { structuredContent: {} },
    { interrupted: true },
  ]) {
    const x = bash(STATUS, extra);
    expect(filterResult("git status", x, true)).toBe(x);
  }
  const err = { isError: true, result: STATUS, text: STATUS };
  expect(filterResult("git status", err, true)).toBe(err);
  const deny = { deny: "no" };
  expect(filterResult("git status", deny, true)).toBe(deny);
  const notString = { result: { stdout: 3 } };
  expect(filterResult("git status", notString, true)).toBe(notString);
  const blocks = { result: [{ type: "text", text: STATUS }] };
  expect(filterResult("git status", blocks, true)).toBe(blocks);
  // Mixed output: more than one command, a pipe, a redirection
  for (const line of [
    "git status && git log",
    "git status | head",
    "git status > f",
    "git status; ls -l",
  ])
    expect(filterResult(line, r, true)).toBe(r);
});

test("the engine versions: inside the validated range only", () => {
  expect(versionOk(FILTER_VERSIONS.min)).toBe(true);
  expect(versionOk(FILTER_VERSIONS.max)).toBe(true);
  expect(versionOk("2.1.292")).toBe(false);
  expect(versionOk("2.1.297")).toBe(false);
  expect(versionOk("2.1.296-dev")).toBe(false);
  expect(versionOk(undefined)).toBe(false);
});

// ---------------------------------------------------------------------------
// secrets-veil
// ---------------------------------------------------------------------------

const GH = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const AWS = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const JWT =
  "ey" + "JhbGciOiJIUzI1NiJ9.ey" + "JzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVl";
const PEM =
  "-----BEGIN RSA PRIV" +
  "ATE KEY-----\nMIIEow\nIBAAKC\n-----END RSA PRIV" +
  "ATE KEY-----";
const RANDOM = "q8Zr2Lw9Xv4Tn7Kp3Hs6Jd1Fm5Gb0Yc"; // 32 characters, letters and digits
const ctx = (env: string[] = []) => ({ envValues: env, now: () => Date.now() });

test("veil: an environment credential, every shape, a high-entropy token", () => {
  const envVal = "s3cr3t-" + "value-of-the-env";
  const text = `token: ${envVal}\n${GH}\nkey ${AWS}\n${JWT}\nAuthorization: ${"Bea" + "rer"} abcdefghijklmnop1234\n${PEM}\nhttps:/${"/"}ann:hunter2pass@example.invalid/x\npass${"word"}=correcthorse\nrandom ${RANDOM}\n`;
  const v = veil(text, ctx([envVal]))!;
  const out = String(v.value);
  for (const s of [
    envVal,
    GH,
    AWS,
    JWT,
    "abcdefghijklmnop1234",
    "MIIEow",
    "hunter2pass",
    "correcthorse",
    RANDOM,
  ])
    expect(out).not.toContain(s);
  expect(out).toContain("[masked:");
  expect(v.masked).toBeGreaterThan(8);
});

test("veil: false positives stay (git hash, sha256, UUID, path, integrity, base64 of text)", () => {
  const sha1 = "8e70f9611b4c3d760d5c6c959630ac99069dd078";
  const sha256 =
    "a1133bc924beb6b2b055830ae7847671969a6252f5f341b15aa7491b292fe0ee";
  const uuid = "188cde69-56f4-4dc1-b030-0119217a6d78";
  const path = "plugins/kodflow-hooks/hooks/mod/register.ts";
  const integrity =
    "sha512-Q0NqZ2l3c2VjcmV0aGFzaGJhc2U2NHBhZGRpbmc0NTY3ODkwYWJj";
  const b64text = btoa(
    "The quick brown fox jumps over the lazy dog 1234567890",
  );
  const words = "ProcessRunResultIsStdoutTruncated";
  const text = [sha1, sha256, uuid, path, integrity, b64text, words].join("\n");
  const v = veil(text, ctx())!;
  expect(v.masked).toBe(0);
  expect(exempt(sha1)).toBe("hex");
  expect(exempt(uuid)).toBe("uuid");
  expect(exempt(b64text)).toBe("base64 text");
  expect(entropy("aaaa")).toBe(0);
});

test("veil: a Bash result keeps its shape; an errored one is withheld masked; nothing found is r itself", () => {
  const r = bash(`deploying with ${GH}\n`);
  const out: any = veilResult(r, ctx());
  expect(out.result.stdout).not.toContain(GH);
  expect(Object.keys(out.result).sort()).toEqual(Object.keys(r.result).sort());
  expect(out.ref).toBe(7);
  const clean = bash("nothing here\n");
  expect(veilResult(clean, ctx())).toBe(clean);
  const err = {
    isError: true,
    result: `Exit code 1\n${GH}`,
    text: `Exit code 1\n${GH}`,
  };
  const d: any = veilResult(err, ctx());
  expect(d.deny).toContain("Exit code 1");
  expect(d.deny).not.toContain(GH);
  const blocks = { result: [{ type: "text", text: `x ${AWS}` }] };
  expect(JSON.stringify(veilResult(blocks, ctx()))).not.toContain(AWS);
});

test("veil: past the size budget the result comes back as it was (fail open)", () => {
  const big = bash(`${GH}\n${"x".repeat(2_000_001)}`);
  expect(veilResult(big, ctx())).toBe(big);
  let t = 0;
  const slow = { envValues: [], now: () => (t += 1000) };
  const r = bash(`${GH}\n`);
  expect(veilResult(r, slow)).toBe(r);
});

// ---------------------------------------------------------------------------
// L5 · the merge gate
// ---------------------------------------------------------------------------

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";
const env = (origin?: string) => ({
  ghRepo: undefined,
  origin: async () => origin,
});

test("classify: the target from -R, GH_REPO, a URL, an API path, owner/repo, project_id", async () => {
  const t = async (line: string, o?: string) => {
    const c = await classifyBash(line, env(o));
    return c.kind === "merge"
      ? c.target
        ? `${c.target.host}:${c.target.repo}#${c.target.number}@${c.target.pinned ?? ""}`
        : `?${c.ambiguous}`
      : "none";
  };
  expect(await t("gh pr merge 12 -R o/r --squash")).toBe("github:o/r#12@");
  expect(await t(`gh pr merge 12 --repo=o/r --match-head-commit ${HEAD}`)).toBe(
    `github:o/r#12@${HEAD}`,
  );
  expect(await t("GH_REPO=o/r gh pr merge 12")).toBe("github:o/r#12@");
  expect(await t("gh pr merge https://github.com/o/r/pull/9")).toBe(
    "github:o/r#9@",
  );
  expect(await t("gh pr merge 3", "git@github.com:o/r.git")).toBe(
    "github:o/r#3@",
  );
  expect(await t(`gh api -X PUT repos/o/r/pulls/4/merge -f sha=${HEAD}`)).toBe(
    `github:o/r#4@${HEAD}`,
  );
  expect(await t(`glab mr merge 5 -R g/sub/p --sha ${HEAD}`)).toBe(
    `gitlab:g/sub/p#5@${HEAD}`,
  );
  expect(await t("glab api -X PUT projects/g%2Fp/merge_requests/6/merge")).toBe(
    "gitlab:g/p#6@",
  );
  expect(await t("git status")).toBe("none");
  expect(await t("git merge-base a b")).toBe("none");
  expect(await t("gh pr view 3")).toBe("none");
  // Ambiguous: refused
  expect((await t("gh pr merge")).startsWith("?")).toBe(true);
  expect((await t("gh pr merge feat/x -R o/r")).startsWith("?")).toBe(true);
  expect((await t("gh pr merge 3")).startsWith("?")).toBe(true); // no repo anywhere
  expect(
    (
      await t("cd ../other && gh pr merge 3", "git@github.com:o/r.git")
    ).startsWith("?"),
  ).toBe(true);
  expect(
    (await t("gh pr merge 1 -R o/r && gh pr merge 2 -R o/r")).startsWith("?"),
  ).toBe(true);
  expect(
    (
      await t(
        "gh api graphql -f query='mutation { mergePullRequest(input:{}) { x } }'",
      )
    ).startsWith("?"),
  ).toBe(true);
  expect(
    (
      await t("curl -X PUT https://api.github.com/repos/o/r/pulls/1/merge")
    ).startsWith("?"),
  ).toBe(true);
  const m = classifyMcp("mcp__github__merge_pull_request", {
    owner: "o",
    repo: "r",
    pullNumber: 3,
    sha: HEAD,
  });
  expect(
    m.kind === "merge" && m.target?.repo === "o/r" && m.target.pinned === HEAD,
  ).toBe(true);
  const g = classifyMcp("mcp__gitlab__merge_merge_request", {
    project_id: "7",
    merge_request_iid: "2",
  });
  expect(g.kind === "merge" && g.target?.repo === "7").toBe(true);
  const auto = classifyMcp("mcp__gitlab__update_merge_request", {
    merge_when_pipeline_succeeds: true,
  });
  expect(auto.kind === "merge" && !!auto.ambiguous).toBe(true);
  expect(classifyMcp("mcp__github__get_me", {}).kind).toBe("none");
  expect(remoteRepo("https://gitlab.com/g/sub/p.git")).toEqual({
    host: "gitlab",
    repo: "g/sub/p",
  });
});

type Fake = MergePort & {
  asked: string[];
  tokens: string[];
  runs: string[][];
  notes: string[];
};

function fake(
  over: Partial<{
    head: string;
    rollup: unknown;
    ask: () => Promise<string>;
    present: boolean;
    run: MergePort["run"];
    exemptions: string;
    now: number;
  }> = {},
): Fake {
  const f: Fake = {
    asked: [],
    tokens: [],
    runs: [],
    notes: [],
    run:
      over.run ??
      (async (argv) => {
        f.runs.push(argv);
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            headRefOid: over.head ?? HEAD,
            state: "OPEN",
            statusCheckRollup: over.rollup ?? [
              {
                __typename: "CheckRun",
                name: "ci",
                status: "COMPLETED",
                conclusion: "SUCCESS",
              },
            ],
          }),
        };
      }),
    ask: async (q) => {
      f.asked.push(q);
      return over.ask ? over.ask() : YES;
    },
    writeToken: async (t) => void f.tokens.push(t),
    now: () => over.now ?? 1_000_000_000_000,
    lastComposerAt: () =>
      over.present === false
        ? undefined
        : (over.now ?? 1_000_000_000_000) - 60_000,
    exemptions: async () => over.exemptions,
    note: (t) => void f.notes.push(t),
  };
  return f;
}

const merge = (line: string) => classifyBash(line, env());
const denied = (g: any) => (g && "deny" in g ? (g.deny as string) : "");

test("gate: a subagent is refused without condition", async () => {
  resetApprovals();
  const f = fake();
  const g = await gate(
    await merge(`gh pr merge 1 -R o/r --match-head-commit ${HEAD}`),
    { agentId: "a1" },
    f,
  );
  expect(denied(g)).toContain("a subagent does not merge");
  expect(f.runs.length + f.asked.length + f.tokens.length).toBe(0);
});

test("gate: an unpinned merge is refused with the exact command, nothing asked", async () => {
  resetApprovals();
  const f = fake();
  const g = await gate(await merge("gh pr merge 12 -R o/r --squash"), {}, f);
  expect(denied(g)).toContain(
    `gh pr merge 12 -R o/r --squash --match-head-commit ${HEAD}`,
  );
  expect(denied(g)).toContain("[motif:merge]");
  expect(f.runs[0]).toEqual([
    "gh",
    "pr",
    "view",
    "12",
    "-R",
    "o/r",
    "--json",
    "headRefOid,state,statusCheckRollup",
  ]);
  expect(f.asked).toEqual([]);
  const viaEnv = await gate(
    await merge("GH_REPO=o/r gh pr merge 12"),
    {},
    fake(),
  );
  expect(denied(viaEnv)).toContain(
    `gh pr merge 12 -R o/r --match-head-commit ${HEAD}`,
  );
  const api = await gate(
    await merge("gh api -X PUT repos/o/r/pulls/4/merge"),
    {},
    fake(),
  );
  expect(denied(api)).toContain(
    `gh api -X PUT repos/o/r/pulls/4/merge -f sha=${HEAD}`,
  );
  const mcp = await gate(
    classifyMcp("mcp__github__merge_pull_request", {
      owner: "o",
      repo: "r",
      pullNumber: 3,
    }),
    {},
    fake(),
  );
  expect(denied(mcp)).toContain(`"sha": "${HEAD}"`);
});

test("gate: pinned to another head, refused with the new head", async () => {
  resetApprovals();
  const g = await gate(
    await merge(`gh pr merge 12 -R o/r --match-head-commit ${OTHER}`),
    {},
    fake(),
  );
  expect(denied(g)).toContain("the head moved");
  expect(denied(g)).toContain(`--match-head-commit ${HEAD}`);
});

test("gate: CI not green, refused before any question", async () => {
  resetApprovals();
  for (const [rollup, word] of [
    [
      [{ __typename: "CheckRun", name: "ci", status: "IN_PROGRESS" }],
      "pending",
    ],
    [
      [
        {
          __typename: "CheckRun",
          name: "ci",
          status: "COMPLETED",
          conclusion: "FAILURE",
        },
      ],
      "failing",
    ],
    [[], "none"],
  ] as const) {
    const f = fake({ rollup });
    const g = await gate(
      await merge(`gh pr merge 12 -R o/r --match-head-commit ${HEAD}`),
      {},
      f,
    );
    expect(denied(g)).toContain(`(${word})`);
    expect(f.asked).toEqual([]);
  }
  expect(
    githubCi([{ __typename: "StatusContext", context: "x", state: "SUCCESS" }])
      .ci,
  ).toBe("green");
});

test("gate: no one at the prompt in 10 minutes, refused (waiting for the user)", async () => {
  resetApprovals();
  const f = fake({ present: false });
  const g = await gate(
    await merge(`gh pr merge 12 -R o/r --match-head-commit ${HEAD}`),
    {},
    f,
  );
  expect(denied(g)).toContain("waiting for the user's OK");
  expect(f.asked).toEqual([]);
});

test("gate: yes writes the token bound to the SHA, then the approval holds a few minutes", async () => {
  resetApprovals();
  const f = fake();
  const line = `gh pr merge 12 -R o/r --match-head-commit ${HEAD}`;
  const g: any = await gate(await merge(line), {}, f);
  expect(g).toEqual({ allow: false, sha: HEAD });
  expect(f.asked.length).toBe(1);
  expect(f.asked[0]).toContain("o/r#12");
  expect(f.tokens[0]!.split("\n")[0]).toBe(HEAD);
  // Same (repo, PR, SHA) within the window: no second question
  const again = fake();
  expect(await gate(await merge(line), {}, again)).toEqual({
    allow: false,
    sha: HEAD,
  });
  expect(again.asked).toEqual([]);
  expect(again.tokens.length).toBe(1);
  // Past the window: asked again
  const later = fake({ now: 1_000_000_000_000 + 6 * 60_000 });
  await gate(await merge(line), {}, later);
  expect(later.asked.length).toBe(1);
});

test("gate: no, a dismissed question, a forge that fails or times out: refused", async () => {
  resetApprovals();
  const line = `gh pr merge 12 -R o/r --match-head-commit ${HEAD}`;
  const no = fake({ ask: async () => NO });
  expect(denied(await gate(await merge(line), {}, no))).toContain(
    "the user said no",
  );
  expect(no.tokens).toEqual([]);
  const gone = fake({
    ask: async () => Promise.reject(new Error("dismissed")),
  });
  expect(denied(await gate(await merge(line), {}, gone))).toContain(
    "dismissed",
  );
  const timeout = fake({
    run: async () => Promise.reject(new Error("timed out after 15000 ms")),
  });
  expect(denied(await gate(await merge(line), {}, timeout))).toContain(
    "timed out",
  );
  const fails = fake({
    run: async () => ({ exitCode: 1, stdout: "", stderr: "HTTP 401" }),
  });
  expect(denied(await gate(await merge(line), {}, fails))).toContain(
    "HTTP 401",
  );
  const garbage = fake({
    run: async () => ({ exitCode: 0, stdout: "not json", stderr: "" }),
  });
  expect(denied(await gate(await merge(line), {}, garbage))).toContain(
    "[motif:merge]",
  );
});

test("gate: an exempt repository passes, journaled; kodflow/claude-marketplace never is", async () => {
  resetApprovals();
  const f = fake({ exemptions: "# x\no/r\nkodflow/claude-marketplace\n" });
  expect(await gate(await merge("gh pr merge 1 -R o/r"), {}, f)).toEqual({
    allow: false,
    sha: "",
  });
  expect(f.notes.length).toBe(1);
  const k = fake({ exemptions: "kodflow/claude-marketplace\n" });
  expect(
    denied(
      await gate(
        await merge("gh pr merge 1 -R kodflow/claude-marketplace"),
        {},
        k,
      ),
    ),
  ).toContain("not pinned");
  expect(isExempt("O/R # c\n", "o/r")).toBe(true); // a comment ends the line
  expect(isExempt("o/r # c\n", "O/R")).toBe(true);
  expect(
    isExempt("kodflow/claude-marketplace\n", "kodflow/claude-marketplace"),
  ).toBe(false);
});

// ---------------------------------------------------------------------------
// blast radius, reader details
// ---------------------------------------------------------------------------

test("blast radius: rm -rf in its spellings, reset --hard, a forced push", () => {
  const b = (l: string) => blastRadius(parse(l)).length;
  for (const l of [
    "rm -rf build",
    "rm -fr x",
    "rm -r -f x",
    "rm --recursive --force x",
    "sudo rm -Rf /opt/x",
    "cd x && rm -rf y",
    "git reset --hard origin/main",
    "git push --force origin feat",
    "git push origin +feat",
    "bash -c 'rm -rf x'",
  ])
    expect(b(l)).toBe(1);
  for (const l of [
    "rm -r x",
    "rm -f x",
    "rm x",
    "git reset HEAD~1",
    "git push --force-with-lease origin feat",
    "echo 'rm -rf x'",
    "ls",
  ])
    expect(b(l)).toBe(0);
});

test("reader: argv past wrappers, ANSI-C strings, the forced-push fix", () => {
  expect(
    argvOf(parse("sudo -u root env A=1 git status").commands[0]!).argv,
  ).toEqual(["git", "status"]);
  expect(
    argvOf(parse("GH_REPO=o/r gh pr merge 1").commands[0]!).assigns,
  ).toEqual({ GH_REPO: "o/r" });
  expect(ansiC("\\x67it")).toBe("git");
  expect(withLease("git push -f origin feat")).toBe(
    "git push --force-with-lease origin feat",
  );
});

// ---------------------------------------------------------------------------
// Invariants over the whole module (the source scans are in invariants.ts,
// under node: a plugin test reads no file)
// ---------------------------------------------------------------------------

test("invariant: whatever the policies, the pipeline answers r, a filtered r with the same keys, or { deny }", async () => {
  const lines = ["git status", "gh pr merge 1", "rm -rf x", "ls -la", "cat a"];
  for (const line of lines)
    for (const fail of ["merge", "guards", "blast", "filter", "none"]) {
      const { p } = policies({
        [fail]: fail === "none" ? undefined : boom,
        filter:
          fail === "filter"
            ? boom
            : async (r: any) => filterResult(line, r, true),
      } as any);
      const r = bash(STATUS);
      const out: any = await runBash(async () => r, p);
      const ok =
        out === r ||
        (typeof out.deny === "string" && Object.keys(out).length === 1) ||
        (JSON.stringify(Object.keys(out).sort()) ===
          JSON.stringify(Object.keys(r).sort()) &&
          JSON.stringify(Object.keys(out.result).sort()) ===
            JSON.stringify(Object.keys(r.result).sort()));
      expect(ok).toBe(true);
      expect("allow" in out && out.allow === true).toBe(false);
    }
});
