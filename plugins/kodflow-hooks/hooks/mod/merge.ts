// merge.ts — the merge gate (L5, D4). No `$`: the host is a MergePort.
//
// A merge leaves the main thread only pinned to the head it was shown, with
// its CI green and the user's yes to `$.ui.ask`; a subagent never merges.
// Nothing is rewritten: an unpinned merge is refused with the exact command
// to run instead, and the second call, pinned, is the one asked about. A yes
// writes a token, <config>/kodflow/sessions/<sid>/merge-ok/<tool_use_id>,
// holding the SHA; on-tool.sh refuses a main-thread merge without one.
//
// Every failure refuses: an error, a timeout or a rejection reading the
// forge, a dismissed question.
import { argvOf, parse, type Parsed } from "./shell.ts";
import { MERGE_RE, MERGE_WORDS } from "./guards.ts";

export type Host = "github" | "gitlab";

export type Target = {
  host: Host;
  /** owner/repo, or the GitLab project path or id. */
  repo: string;
  number: string;
  /** The SHA the call pins, when it pins one. */
  pinned?: string;
  /** The exact call to make instead, pinned to `sha`. */
  fix(sha: string): string;
  /** How the call is shown in the question. */
  label: string;
};

export type Classified =
  | { kind: "none" }
  | { kind: "merge"; label: string; target?: Target; ambiguous?: string };

const NONE: Classified = { kind: "none" };

/** POSIX single quotes, only where a word needs them. */
export const quote = (w: string): string =>
  /^[A-Za-z0-9_./:@%+,=-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`;
const show = (argv: string[]) => argv.map(quote).join(" ");

/** owner/repo of a remote URL (https, ssh, scp form), and its host. */
export function remoteRepo(
  url: string,
): { host: Host | undefined; repo: string } | undefined {
  const m =
    /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/.exec(
      url.trim(),
    );
  if (!m) return undefined;
  const hostName = m[1]!.toLowerCase();
  const host: Host | undefined = hostName.includes("github")
    ? "github"
    : hostName.includes("gitlab")
      ? "gitlab"
      : undefined;
  return { host, repo: m[2]!.replace(/^\/+/, "") };
}

/** OWNER/REPO, HOST/OWNER/REPO or a URL → the repository path. */
function repoArg(v: string, host: Host): string {
  if (/^https?:\/\//.test(v)) return remoteRepo(v)?.repo ?? v;
  const parts = v.split("/").filter(Boolean);
  if (host === "github" && parts.length > 2) return parts.slice(-2).join("/");
  return parts.join("/");
}

function optValue(A: string[], names: string[]): string | undefined {
  for (let y = 0; y < A.length; y++) {
    const v = A[y]!;
    for (const n of names) {
      if (v === n) return A[y + 1];
      if (n.startsWith("--") && v.startsWith(`${n}=`))
        return v.slice(n.length + 1);
    }
  }
  return undefined;
}

/** `-f sha=…`, `-F sha=…`, `--field sha=…`, `--raw-field sha=…`. */
function fieldValue(A: string[], key: string): string | undefined {
  for (let y = 0; y < A.length; y++)
    if (["-f", "-F", "--field", "--raw-field"].includes(A[y]!)) {
      const f = A[y + 1] ?? "";
      if (f.startsWith(`${key}=`)) return f.slice(key.length + 1);
    }
  return undefined;
}

/** argv without `name value` and `name=value`. */
function dropOpt(A: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < A.length; i++) {
    if (A[i] === name) {
      i++;
      continue;
    }
    if (!A[i]!.startsWith(`${name}=`)) out.push(A[i]!);
  }
  return out;
}

/** argv without the API field `key` (`-f key=…` and its kin). */
function dropField(A: string[], key: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < A.length; i++) {
    if (
      ["-f", "-F", "--field", "--raw-field"].includes(A[i]!) &&
      (A[i + 1] ?? "").startsWith(`${key}=`)
    ) {
      i++;
      continue;
    }
    out.push(A[i]!);
  }
  return out;
}

type Found = { label: string; target?: Target; ambiguous?: string };

export type BashEnv = {
  /** GH_REPO of the session's environment. */
  ghRepo?: string;
  /** The session directory's origin remote, read on demand. */
  origin(): Promise<string | undefined>;
};

const GH_PR_MERGE_VALUED = [
  "-b",
  "--body",
  "-F",
  "--body-file",
  "-t",
  "--subject",
  "-A",
  "--author-email",
  "-R",
  "--repo",
  "--match-head-commit",
];

async function ghPrMerge(
  A: string[],
  assigns: Record<string, string>,
  env: BashEnv,
  movesDir: boolean,
): Promise<Found> {
  const label = "gh pr merge";
  // A after "gh … pr merge"
  const at = A.indexOf("merge");
  const args = A.slice(at + 1);
  let positional: string | undefined;
  for (let y = 0; y < args.length; y++) {
    const v = args[y]!;
    if (GH_PR_MERGE_VALUED.includes(v)) {
      y++;
      continue;
    }
    if (!v.startsWith("-")) {
      positional = v;
      break;
    }
  }
  let repo = optValue(A, ["-R", "--repo"]);
  let number: string | undefined;
  if (positional && /^https?:\/\//.test(positional)) {
    const m = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(positional);
    if (!m)
      return { label, ambiguous: `${positional} is not a pull request URL` };
    repo = repo ?? m[1];
    number = m[2];
  } else if (positional && /^#?\d+$/.test(positional))
    number = positional.replace(/^#/, "");
  if (!number)
    return {
      label,
      ambiguous: positional
        ? `the pull request is named by a branch (${positional}), not a number`
        : "no pull request number: gh would pick the current branch's",
    };
  const explicitRepo = repo !== undefined;
  repo = repo ?? assigns.GH_REPO ?? env.ghRepo;
  if (!repo) {
    if (movesDir)
      return { label, ambiguous: "no -R and the line changes directory" };
    const o = await env.origin();
    const r = o ? remoteRepo(o) : undefined;
    if (!r || r.host === "gitlab")
      return { label, ambiguous: "no -R, no GH_REPO and no GitHub origin" };
    repo = r.repo;
  }
  const full = repoArg(repo, "github");
  const pinned = optValue(A, ["--match-head-commit"]);
  return {
    label,
    target: {
      host: "github",
      repo: full,
      number,
      pinned,
      label: `${full}#${number}`,
      fix: (sha) =>
        `${show(dropOpt(A, "--match-head-commit"))}${explicitRepo ? "" : ` -R ${full}`} --match-head-commit ${sha}`,
    },
  };
}

async function glabMrMerge(
  A: string[],
  env: BashEnv,
  movesDir: boolean,
): Promise<Found> {
  const label = "glab mr merge";
  const at = A.indexOf("merge");
  const args = A.slice(at + 1);
  let positional: string | undefined;
  for (let y = 0; y < args.length; y++) {
    const v = args[y]!;
    if (
      ["-R", "--repo", "--sha", "-m", "--message", "--squash-message"].includes(
        v,
      )
    ) {
      y++;
      continue;
    }
    if (!v.startsWith("-")) {
      positional = v;
      break;
    }
  }
  let repo = optValue(A, ["-R", "--repo"]);
  let number: string | undefined;
  if (positional && /^https?:\/\//.test(positional)) {
    const m = /^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)/.exec(
      positional,
    );
    if (!m)
      return { label, ambiguous: `${positional} is not a merge request URL` };
    repo = repo ?? m[1];
    number = m[2];
  } else if (positional && /^!?\d+$/.test(positional))
    number = positional.replace(/^!/, "");
  if (!number) return { label, ambiguous: "no merge request number" };
  const explicitRepo = repo !== undefined;
  if (!repo) {
    if (movesDir)
      return { label, ambiguous: "no -R and the line changes directory" };
    const o = await env.origin();
    const r = o ? remoteRepo(o) : undefined;
    if (!r || r.host === "github")
      return { label, ambiguous: "no -R and no GitLab origin" };
    repo = r.repo;
  }
  const full = repoArg(repo, "gitlab");
  const pinned = optValue(A, ["--sha"]);
  return {
    label,
    target: {
      host: "gitlab",
      repo: full,
      number,
      pinned,
      label: `${full}!${number}`,
      fix: (sha) =>
        `${show(dropOpt(A, "--sha"))}${explicitRepo ? "" : ` -R ${full}`} --sha ${sha}`,
    },
  };
}

function apiMerge(tool: "gh" | "glab", A: string[], ep: string): Found {
  const label = `${tool} api ${ep}`;
  const pinned = fieldValue(A, "sha");
  const fix = (sha: string) => `${show(dropField(A, "sha"))} -f sha=${sha}`;
  if (tool === "gh") {
    const m = /^\/?repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/merge\/?$/.exec(ep);
    if (!m)
      return {
        label,
        ambiguous: `${ep} does not name owner/repo and a number`,
      };
    return {
      label,
      target: {
        host: "github",
        repo: m[1]!,
        number: m[2]!,
        pinned,
        label: `${m[1]}#${m[2]}`,
        fix,
      },
    };
  }
  const m = /^\/?projects\/([^/]+)\/merge_requests\/(\d+)\/merge\/?$/.exec(ep);
  if (!m)
    return { label, ambiguous: `${ep} does not name a project and a number` };
  const repo = decodeURIComponent(m[1]!);
  return {
    label,
    target: {
      host: "gitlab",
      repo,
      number: m[2]!,
      pinned,
      label: `${repo}!${m[2]}`,
      fix,
    },
  };
}

function apiEndpoint(A: string[]): string {
  for (let y = 2; y < A.length; y++) {
    const v = A[y]!;
    if (
      [
        "-X",
        "--method",
        "-H",
        "--header",
        "-q",
        "--jq",
        "-t",
        "--template",
        "-p",
        "--preview",
        "--hostname",
        "--cache",
        "-f",
        "--raw-field",
        "-F",
        "--field",
        "--input",
      ].includes(v)
    ) {
      y++;
      continue;
    }
    if (!v.startsWith("-")) return v;
  }
  return "";
}

/** The merges a Bash line makes, and which one, when it can be told. */
export async function classifyBash(
  line: string,
  env: BashEnv,
  parsed?: Parsed,
): Promise<Classified> {
  if (!/merge|Merge/.test(line)) return NONE;
  const p = parsed ?? parse(line);
  const found: Found[] = [];
  let movesDir = false;
  for (const cmd of p.commands) {
    const { argv: A, name, assigns } = argvOf(cmd);
    if (name === "cd" || name === "pushd") movesDir = true;
    if (name === "gh") {
      let y = 1;
      while (y < A.length) {
        const v = A[y]!;
        if (v === "-R" || v === "--repo" || v === "--hostname") y += 2;
        else if (v.startsWith("-")) y++;
        else break;
      }
      const sub = A[y];
      const act = A[y + 1];
      if (sub === "pr" && act === "merge")
        found.push(await ghPrMerge(A, assigns, env, movesDir));
      else if (sub === "api") {
        const ep = apiEndpoint(A);
        const joined = A.join(" ");
        if (MERGE_RE.test(ep)) found.push(apiMerge("gh", A, ep));
        else if (ep === "graphql" && MERGE_WORDS.test(joined))
          found.push({
            label: "gh api graphql",
            ambiguous:
              "a GraphQL merge names the pull request by node id; use gh pr merge <number> -R owner/repo",
          });
      }
    } else if (name === "glab") {
      let y = 1;
      while (y < A.length) {
        const v = A[y]!;
        if (v === "-R" || v === "--repo") y += 2;
        else if (v.startsWith("-")) y++;
        else break;
      }
      const sub = A[y];
      const act = A[y + 1];
      const ep = sub === "api" ? apiEndpoint(A) : "";
      if (sub === "mr" && act === "merge")
        found.push(await glabMrMerge(A, env, movesDir));
      else if (sub === "api" && MERGE_RE.test(ep))
        found.push(apiMerge("glab", A, ep));
      else if (MERGE_WORDS.test(A.join(" ")))
        found.push({
          label: "glab merge_when_pipeline_succeeds",
          ambiguous:
            "an automatic merge is not pinned to a head; use glab mr merge <number> -R <project> --sha <sha>",
        });
    } else if (["curl", "wget", "http", "https", "xh"].includes(name)) {
      if (
        A.slice(1).some(
          (v) =>
            MERGE_RE.test(v) ||
            MERGE_WORDS.test(v) ||
            /\/pulls\/[^/\s]+\/merge([/?\s]|$)/.test(v),
        )
      )
        found.push({
          label: `${name} merge`,
          ambiguous:
            "a raw HTTP merge is not read; use gh pr merge or glab mr merge",
        });
    }
  }
  if (!found.length) return NONE;
  if (found.length > 1)
    return {
      kind: "merge",
      label: found.map((f) => f.label).join(", "),
      ambiguous: "several merges on one line",
    };
  return { kind: "merge", ...found[0]! };
}

const MCP_MERGE =
  /^mcp__(github__merge_pull_request|gitlab__merge_merge_request)$/;

/** The merge an MCP forge call makes, if it makes one. */
export function classifyMcp(
  tool: string,
  input: Record<string, unknown>,
): Classified {
  const auto =
    input.merge_when_pipeline_succeeds === true || input.auto_merge === true;
  if (!MCP_MERGE.test(tool)) {
    if (auto && /^mcp__(github|gitlab|GitKraken)__/.test(tool))
      return {
        kind: "merge",
        label: tool,
        ambiguous:
          "an automatic merge is not pinned to a head; merge with merge_merge_request and sha once CI is green",
      };
    return NONE;
  }
  const str = (v: unknown) =>
    typeof v === "string" || typeof v === "number" ? String(v) : undefined;
  const pinned = str(input.sha);
  const fix = (sha: string) => `call ${tool} again with "sha": "${sha}"`;
  if (tool === "mcp__github__merge_pull_request") {
    const owner = str(input.owner);
    const repo = str(input.repo);
    const number = str(input.pullNumber);
    if (!owner || !repo || !number)
      return {
        kind: "merge",
        label: tool,
        ambiguous: "owner, repo and pullNumber are required",
      };
    return {
      kind: "merge",
      label: tool,
      target: {
        host: "github",
        repo: `${owner}/${repo}`,
        number,
        pinned,
        label: `${owner}/${repo}#${number}`,
        fix,
      },
    };
  }
  const project = str(input.project_id);
  const number = str(input.merge_request_iid);
  if (!project || !number)
    return {
      kind: "merge",
      label: tool,
      ambiguous: "project_id and merge_request_iid are required",
    };
  return {
    kind: "merge",
    label: tool,
    target: {
      host: "gitlab",
      repo: project,
      number,
      pinned,
      label: `${project}!${number}`,
      fix,
    },
  };
}

export type RunResult = { exitCode: number; stdout: string; stderr: string };

export type MergePort = {
  /** Runs argv; rejects on a timeout. */
  run(argv: string[], timeoutMs: number): Promise<RunResult>;
  /** $.ui.ask; rejects when dismissed or with no one to ask. */
  ask(question: string, options: string[]): Promise<string>;
  /** Writes the token file (directories created). */
  writeToken(text: string): Promise<void>;
  now(): number;
  /** When the user last pressed Enter at the prompt (ms), if ever. */
  lastComposerAt(): number | undefined;
  /** The versioned exemptions (merge-exemptions.txt), one repository a line. */
  exemptions(): Promise<string | undefined>;
  /** Journal an exemption or a written consent used. */
  note(text: string): void;
  /** The last prompt typed at the terminal, until a merge consumed it. */
  lastPrompt(): string | undefined;
  /** That prompt served one merge: it serves no other. */
  consume(): void;
  /** KODFLOW_MERGE_CONSENT=off: the question every time. */
  consentOff(): Promise<boolean>;
};

/** Never exempt, whatever the file says: the guards' own repository. */
export const NEVER_EXEMPT = ["kodflow/claude-marketplace"];

/** Whether `repo` is listed in the exemptions text (comments and blanks skipped). */
export function isExempt(text: string | undefined, repo: string): boolean {
  const want = repo.toLowerCase().replace(/\.git$/, "");
  if (NEVER_EXEMPT.includes(want)) return false;
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/#.*/, "").trim().toLowerCase();
    if (line && line === want) return true;
  }
  return false;
}

export type Head = {
  sha: string;
  ci: "green" | "pending" | "failing" | "none";
  detail: string;
};

export const FORGE_TIMEOUT_MS = 15_000;
export const PRESENCE_MS = 10 * 60_000;
export const APPROVAL_MS = 5 * 60_000;
export const YES = "Merge";
export const NO = "Do not merge";

/** The rollup of `gh pr view --json statusCheckRollup`. */
export function githubCi(rollup: unknown): Pick<Head, "ci" | "detail"> {
  if (!Array.isArray(rollup) || rollup.length === 0)
    return { ci: "none", detail: "no check reported" };
  const bad: string[] = [];
  const waiting: string[] = [];
  for (const c of rollup as Record<string, unknown>[]) {
    const name = String(c.name ?? c.context ?? "?");
    if (c.__typename === "StatusContext" || "state" in c) {
      const s = String(c.state ?? "");
      if (s === "SUCCESS") continue;
      if (s === "PENDING" || s === "EXPECTED") waiting.push(name);
      else bad.push(`${name} ${s.toLowerCase()}`);
      continue;
    }
    if (c.status !== "COMPLETED") {
      waiting.push(name);
      continue;
    }
    const k = String(c.conclusion ?? "");
    if (!["SUCCESS", "SKIPPED", "NEUTRAL"].includes(k))
      bad.push(`${name} ${k.toLowerCase()}`);
  }
  if (bad.length) return { ci: "failing", detail: bad.join(", ") };
  if (waiting.length) return { ci: "pending", detail: waiting.join(", ") };
  return { ci: "green", detail: `${rollup.length} checks green` };
}

/** The head SHA and the CI state, from gh or glab. */
export async function readHead(port: MergePort, t: Target): Promise<Head> {
  if (t.host === "github") {
    const r = await port.run(
      [
        "gh",
        "pr",
        "view",
        t.number,
        "-R",
        t.repo,
        "--json",
        "headRefOid,state,statusCheckRollup",
      ],
      FORGE_TIMEOUT_MS,
    );
    if (r.exitCode !== 0)
      throw new Error(`gh pr view failed: ${r.stderr.trim().slice(0, 200)}`);
    const j = JSON.parse(r.stdout);
    if (
      typeof j.headRefOid !== "string" ||
      !/^[0-9a-f]{40}$/.test(j.headRefOid)
    )
      throw new Error("gh pr view returned no head SHA");
    if (j.state && j.state !== "OPEN")
      throw new Error(`the pull request is ${String(j.state).toLowerCase()}`);
    return { sha: j.headRefOid, ...githubCi(j.statusCheckRollup) };
  }
  const r = await port.run(
    ["glab", "mr", "view", t.number, "-R", t.repo, "-F", "json"],
    FORGE_TIMEOUT_MS,
  );
  if (r.exitCode !== 0)
    throw new Error(`glab mr view failed: ${r.stderr.trim().slice(0, 200)}`);
  const j = JSON.parse(r.stdout);
  const sha = j.sha ?? j.diff_refs?.head_sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha))
    throw new Error("glab mr view returned no head SHA");
  const status = j.head_pipeline?.status ?? j.pipeline?.status;
  const ci: Head["ci"] =
    status === "success"
      ? "green"
      : status === undefined || status === null
        ? "none"
        : [
              "running",
              "pending",
              "created",
              "preparing",
              "waiting_for_resource",
              "scheduled",
            ].includes(status)
          ? "pending"
          : "failing";
  return { sha, ci, detail: status ? `pipeline ${status}` : "no pipeline" };
}

// A word that merges, standing alone (not "mergé", "mergeable", "merge-ok")
const CONSENT_WORD =
  /(?<![\p{L}\p{N}_-])(merge|merger|fusionne|fusionner|fusionnes)(?![\p{L}\p{N}_]|-(?!(?:la|le|les)(?![\p{L}\p{N}_])))/iu;
// Anything that holds the merge back: a negation, a wait, a later
const HOLD_WORD =
  /(?<![\p{L}\p{N}_])(ne|n'|n’|pas|jamais|sans|aucun|aucune|plus tard|tard|attends|attendez|attendre|attend|don't|don’t|dont|do not|not|never|no|wait|hold|stop|later|before|avant|after|après|tomorrow|demain)(?![\p{L}\p{N}_])/iu;
const CONSENT_EXCERPT = 80;

/**
 * The user's written consent in their last prompt, as the journal shows it,
 * or undefined. Only the words they typed count: a pasted block, a paste
 * placeholder or a `code span` is dropped first. A question, a negation or a
 * wait anywhere is no consent; when in doubt, the gate asks.
 */
export function writtenConsent(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const own = text
    .replace(/<pasted_content\b[^>]*>[\s\S]*?<\/pasted_content>/gi, " ")
    .replace(/\[Pasted text[^\]]*\]/gi, " ")
    .replace(/`[^`]*`/g, " ");
  if (/[?¿]/.test(own) || HOLD_WORD.test(own) || !CONSENT_WORD.test(own))
    return undefined;
  return own.replace(/\s+/g, " ").trim().slice(0, CONSENT_EXCERPT);
}

const approvals = new Map<string, number>();
const approvalKey = (t: Target, sha: string) =>
  `${t.host}:${t.repo}#${t.number}@${sha}`;

/** Forget every remembered approval (tests). */
export const resetApprovals = (): void => approvals.clear();

export type Gate = { deny: string } | { allow: false; sha: string };

const refuse = (title: string, ...lines: string[]): { deny: string } => ({
  deny: [
    "═══════════════════════════════════════════════",
    `  ❌ MERGE BLOCKED — ${title}`,
    "═══════════════════════════════════════════════",
    ...lines.map((l) => `  ${l}`),
    "  [motif:merge]",
  ].join("\n"),
});

/**
 * The gate's decision on a classified call: `{ deny }`, or the go-ahead
 * (`allow: false`: the mod never allows; it lets the call go on to the
 * guards and the shell, with the token written).
 */
export async function gate(
  c: Classified,
  who: { agentId?: string },
  port: MergePort,
): Promise<Gate | undefined> {
  if (c.kind === "none") return undefined;
  if (who.agentId)
    return refuse(
      `a subagent does not merge (${c.label})`,
      "Merging is the main thread's decision, after the user's explicit OK.",
      "Report the PR and its CI state; stop there.",
    );
  if (c.ambiguous || !c.target)
    return refuse(
      `ambiguous target (${c.label})`,
      c.ambiguous ?? "the repository and the number cannot be told",
      "Name the repository and the number explicitly, then pin the head.",
    );
  const t = c.target;
  if (isExempt(await port.exemptions().catch(() => undefined), t.repo)) {
    port.note(`exempt: merge exemption used for ${t.label}`);
    return { allow: false, sha: t.pinned ?? "" };
  }
  let head: Head;
  try {
    head = await readHead(port, t);
  } catch (err) {
    return refuse(
      `cannot read ${t.label}`,
      String((err as Error)?.message ?? err),
      "Nothing is merged without its head and its CI.",
    );
  }
  if (!t.pinned)
    return refuse(
      `not pinned to a head (${t.label})`,
      `The head of ${t.label} is ${head.sha}. Run instead:`,
      t.fix(head.sha),
    );
  if (t.pinned.toLowerCase() !== head.sha)
    return refuse(
      `the head moved (${t.label})`,
      `Pinned ${t.pinned}, head now ${head.sha}. Review the new commits, then:`,
      t.fix(head.sha),
    );
  const key = approvalKey(t, head.sha);
  const held = approvals.get(key);
  const now = port.now();
  if (held !== undefined && now - held < APPROVAL_MS) {
    await port.writeToken(tokenText(t, head.sha, now));
    return { allow: false, sha: head.sha };
  }
  if (head.ci !== "green")
    return refuse(
      `CI is not green on ${t.label} (${head.ci})`,
      head.detail,
      "Wait for the checks, fix them, then ask again.",
    );
  const last = port.lastComposerAt();
  if (last === undefined || now - last > PRESENCE_MS)
    return refuse(
      `merge waiting for the user's OK (${t.label})`,
      "No message typed at the prompt in the last 10 minutes: no one is there to answer.",
      "Report the PR, its head and its green CI, and wait for the user.",
    );
  // The user already wrote it, in the prompt that is still the last one:
  // no question. A failed switch read keeps the question.
  const consent = (await port.consentOff().catch(() => true))
    ? undefined
    : writtenConsent(port.lastPrompt());
  if (consent !== undefined) {
    await port.writeToken(tokenText(t, head.sha, now));
    port.consume();
    approvals.set(key, now);
    port.note(`written consent: ${consent}`);
    return { allow: false, sha: head.sha };
  }
  let answer: string;
  try {
    answer = await port.ask(
      `Merge ${t.label} at ${head.sha.slice(0, 12)}? CI: ${head.detail}.`,
      [YES, NO],
    );
  } catch {
    return refuse(
      `the question was dismissed (${t.label})`,
      "No answer, no merge.",
    );
  }
  if (answer !== YES)
    return refuse(`the user said no (${t.label})`, `Answer: ${answer}`);
  approvals.set(key, now);
  await port.writeToken(tokenText(t, head.sha, now));
  return { allow: false, sha: head.sha };
}

/** The token on-tool.sh reads: the SHA first, then what it was for. */
export const tokenText = (t: Target, sha: string, now: number): string =>
  `${sha}\n${t.host}:${t.repo}#${t.number}\n${Math.floor(now / 1000)}\n`;
