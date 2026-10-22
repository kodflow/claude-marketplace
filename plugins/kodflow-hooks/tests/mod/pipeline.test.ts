// pipeline.test.ts — the Bash pipeline's pure modules, under `claude plugin
// test`: the policies' order and failures, the output filter, the secret
// veil, the shell reader, and the invariants over the whole module. Credential shapes are assembled at run time: this file must not
// carry one itself (scripts/sanitize.py).
import { test, expect } from "claude-code/testing";
import { runBash, type Policies } from "../../hooks/mod/pipeline.ts";
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
    guards: async () => undefined,
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

test("policies run in order: guards, the call, the filter", async () => {
  const seen: string[] = [];
  const { p } = policies({
    guards: async () => (seen.push("guards"), undefined),
    filter: async (r) => (seen.push("filter"), r),
  });
  await runBash(async () => (seen.push("next"), R), p);
  expect(seen).toEqual(["guards", "next", "filter"]);
});

test("a failing guard policy is logged and the call goes on", async () => {
  const { out, ran, log } = await play({ guards: boom });
  expect(ran).toBe(1);
  expect(out).toBe(R);
  expect(log).toEqual(["guards:error"]);
});

test("a failing filter returns r untouched", async () => {
  const { out, ran, log } = await play({ filter: boom });
  expect(ran).toBe(1);
  expect(out).toBe(R);
  expect(log).toEqual(["filter:error"]);
});

test("a guard refusal stops the line, the call never runs", async () => {
  const deny = { deny: "no" };
  const { out, ran } = await play({ guards: async () => deny });
  expect(out).toBe(deny);
  expect(ran).toBe(0);
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
// reader details
// ---------------------------------------------------------------------------

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
    for (const fail of ["guards", "filter", "none"]) {
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
