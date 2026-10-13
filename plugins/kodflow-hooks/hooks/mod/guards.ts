// guards.ts — the shell's Bash guards, doubled in the mod (L4). No `$`.
//
// on-tool.sh stays the authority (D1); this is a second copy that only ever
// refuses, for a session where the shell hook is missing, edited or slow.
// Same reader (shell.ts), same order of blocks, same motifs, so the
// bash-guard corpus decides both the same way (tests/mod/guards.corpus.ts).
//
// Not doubled: the staged-secret scan (BLOCK 3), which reads the index blob
// by blob and stays the shell's alone.
import { argvOf, fileText, parse, type Parsed } from "./shell.ts";
import { scan, type Hit } from "./patterns.ts";

export type GuardCtx = {
  /** Set when a subagent makes the call. */
  agentId?: string;
  /** The delegation gate applies: main thread, KODFLOW_ROOT not off. */
  rootMain: boolean;
  /** The session's directory, against which relative paths resolve. */
  projectDir: string;
  home?: string;
  /** <config> (CLAUDE_CONFIG_DIR, else ~/.claude). */
  configDir?: string;
  /** A file's text, undefined when absent; relative to projectDir. */
  read(path: string): Promise<string | undefined>;
  /** `git -C dir …`'s stdout, undefined on failure. */
  git(dir: string, args: string[]): Promise<string | undefined>;
  /** Main thread only: the merge holds a token (L5) or an exemption. */
  mergeAllowed(): Promise<boolean>;
};

export type Findings = {
  root?: string;
  noVerify?: string;
  attr?: Hit;
  commit: boolean;
  force: boolean;
  merge?: string;
  defaultPush?: string;
  modWrite?: string;
  plugin?: string;
};

export type Refusal = { motif: string; title: string; lines: string[] };

const isNoVerify = (v: string) =>
  v === "--no-veri" || v === "--no-verif" || v === "--no-verify";

export const MERGE_RE =
  /(^|\/)pulls\/[^/\s]+\/merge\/?$|merge_requests\/[^/\s]+\/merge\/?$/;
export const MERGE_WORDS =
  /mergePullRequest|enablePullRequestAutoMerge|merge_when_pipeline_succeeds/;

/** A path a skills directory must never receive (plugin machinery). */
export function modPath(
  path: string,
  home: string | undefined,
  configDir: string | undefined,
): boolean {
  let f = path;
  const cfg = (configDir || `${home ?? ""}/.claude`).replace(/\/+$/, "");
  if (f.startsWith("~/")) f = `${home ?? ""}/${f.slice(2)}`;
  f = `/${f.replace(/^\//, "")}`;
  if (!(f.includes("/.claude/skills/") || f.startsWith(`${cfg}/skills/`)))
    return false;
  return (
    f.includes("/.claude-plugin/") ||
    f.endsWith("/.claude-plugin") ||
    f.endsWith("/hooks/hooks.json")
  );
}

type State = {
  f: Findings;
  gdir: string;
  hooks: boolean;
  amend: boolean;
};

function hit(st: State, h: Hit | undefined): void {
  if (!st.f.attr && h) st.f.attr = h;
}

async function defaults(ctx: GuardCtx, dir: string): Promise<Set<string>> {
  const set = new Set(["main", "master"]);
  const h = await ctx.git(dir, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (h) set.add(h.trim().replace(/^origin\//, ""));
  return set;
}

async function guardPush(
  ctx: GuardCtx,
  st: State,
  A: string[],
  y0: number,
  gdir: string,
): Promise<void> {
  let pos = 0;
  const refs: string[] = [];
  let force = false;
  let all = false;
  for (let y = y0; y < A.length; y++) {
    const v = A[y]!;
    if (
      v.startsWith("--force-with-lease") ||
      v === "--force-if-includes" ||
      v.startsWith("--no-force-")
    ) {
      /* safe */
    } else if (v === "--force") force = true;
    else if (v === "--mirror" || v === "--all" || v === "--branches")
      all = true;
    else if (
      ["--repo", "--receive-pack", "--exec", "--push-option", "-o"].includes(v)
    )
      y++;
    else if (v.startsWith("--")) {
      if (isNoVerify(v)) st.f.noVerify = "--no-verify on git push";
    } else if (v.startsWith("-")) {
      if (v.includes("f")) force = true;
    } else {
      pos++;
      if (pos >= 2) refs.push(v);
      if (v.startsWith("+") && pos >= 2) force = true;
    }
  }
  if (force) st.f.force = true;
  if (!ctx.agentId) return;
  const defs = await defaults(ctx, gdir);
  if (all) {
    st.f.defaultPush = "git push --all/--mirror includes the default branch";
    return;
  }
  const current = async () =>
    (await ctx.git(gdir, ["symbolic-ref", "--short", "HEAD"]))?.trim() ?? "";
  if (!refs.length) {
    const cur = await current();
    if (cur && defs.has(cur))
      st.f.defaultPush = `git push from ${cur}, the default branch`;
    return;
  }
  for (let r of refs) {
    r = r.replace(/^\+/, "");
    let dst = r.includes(":") ? r.slice(r.indexOf(":") + 1) : r;
    if (dst === "HEAD" || r === "HEAD") dst = await current();
    dst = dst.replace(/^refs\/heads\//, "");
    if (dst && defs.has(dst))
      st.f.defaultPush = `git push to ${dst}, the default branch`;
  }
}

async function guardGit(
  ctx: GuardCtx,
  st: State,
  p: Parsed,
  k: number,
  A: string[],
): Promise<void> {
  let y = 1;
  let gdir = st.gdir;
  st.hooks = false;
  while (y < A.length) {
    const v = A[y]!;
    if (v === "-C") {
      gdir = A[y + 1] ?? "";
      y += 2;
      continue;
    }
    if (v === "-c" || v === "--config-env") {
      if ((A[y + 1] ?? "").toLowerCase().startsWith("core.hookspath="))
        st.hooks = true;
      y += 2;
      continue;
    }
    if (v.startsWith("--config-env=")) {
      if (v.toLowerCase().includes("=core.hookspath=")) st.hooks = true;
    } else if (
      ["--git-dir", "--work-tree", "--namespace", "--super-prefix"].includes(v)
    ) {
      y += 2;
      continue;
    } else if (!v.startsWith("-")) break;
    y++;
  }
  if (!gdir) gdir = ctx.projectDir;
  else if (!gdir.startsWith("/")) gdir = `${ctx.projectDir}/${gdir}`;
  const sub = A[y] ?? "";
  y++;
  const rest = A.slice(y);
  if (
    [
      "commit",
      "push",
      "rebase",
      "cherry-pick",
      "merge",
      "am",
      "apply",
      "revert",
    ].includes(sub)
  )
    st.f.root = `git ${sub} from the main thread produces into a repository.`;
  else if (sub === "worktree" && A[y] === "add")
    st.f.root = "git worktree from the main thread produces into a repository.";
  else if (sub === "reset" && rest.includes("--hard"))
    st.f.root = "git reset from the main thread produces into a repository.";
  if (
    st.hooks &&
    [
      "commit",
      "push",
      "merge",
      "am",
      "rebase",
      "cherry-pick",
      "revert",
      "pull",
    ].includes(sub)
  )
    st.f.noVerify = `git -c core.hooksPath on git ${sub}`;

  if (sub === "commit") {
    st.f.commit = true;
    let msg = "";
    let farg = "";
    let given = false;
    while (y < A.length) {
      const v = A[y]!;
      if (v === "--") break;
      if (v === "-m" || v === "--message" || v === "--trailer") {
        msg += `\n${A[y + 1] ?? ""}`;
        given = true;
        y += 2;
        continue;
      }
      if (v.startsWith("--message=") || v.startsWith("--trailer=")) {
        msg += `\n${v.slice(v.indexOf("=") + 1)}`;
        given = true;
      } else if (v === "-F" || v === "--file") {
        farg = A[y + 1] ?? "";
        y += 2;
        continue;
      } else if (v.startsWith("--file=")) farg = v.slice(7);
      else if (
        [
          "-C",
          "-c",
          "-t",
          "--reuse-message",
          "--reedit-message",
          "--author",
          "--date",
          "--cleanup",
          "--template",
          "--fixup",
          "--squash",
          "--pathspec-from-file",
        ].includes(v)
      ) {
        y += 2;
        continue;
      } else if (v === "--amend") st.amend = true;
      else if (v.startsWith("--")) {
        if (isNoVerify(v)) st.f.noVerify = "--no-verify on git commit";
      } else if (v.startsWith("-")) {
        let cl = v.slice(1);
        while (cl) {
          const ch = cl[0]!;
          let r = cl.slice(1);
          if (ch === "n") st.f.noVerify = "-n (--no-verify) on git commit";
          else if (ch === "u" || ch === "S") break;
          else if ("mFCct".includes(ch)) {
            if (!r) {
              r = A[y + 1] ?? "";
              y++;
            }
            if (ch === "m") {
              msg += `\n${r}`;
              given = true;
            } else if (ch === "F") farg = r;
            break;
          }
          cl = r;
        }
      }
      y++;
    }
    let hay = msg;
    if (farg) hay += `\n${await fileText(p, k, farg, ctx.read)}`;
    if (st.amend && !given && !farg)
      hay += `\n${(await ctx.git(gdir, ["log", "-1", "--pretty=%B"])) ?? ""}`;
    hit(st, scan("commit", hay));
  } else if (sub === "merge") {
    while (y < A.length) {
      const v = A[y]!;
      if (v === "-m") {
        hit(st, scan("commit", A[y + 1] ?? ""));
        y += 2;
        continue;
      }
      if (v === "-F" || v === "--file") {
        hit(st, scan("commit", await fileText(p, k, A[y + 1] ?? "", ctx.read)));
        y += 2;
        continue;
      }
      if (v.startsWith("--") && isNoVerify(v))
        st.f.noVerify = "--no-verify on git merge";
      y++;
    }
  } else if (sub === "rebase" || sub === "cherry-pick") {
    for (const v of rest)
      if (isNoVerify(v)) st.f.noVerify = `--no-verify on git ${sub}`;
    hit(
      st,
      scan("commit", (await ctx.git(gdir, ["log", "-5", "--pretty=%B"])) ?? ""),
    );
  } else if (sub === "am" || sub === "revert" || sub === "pull") {
    for (const v of rest)
      if (isNoVerify(v)) st.f.noVerify = `--no-verify on git ${sub}`;
  } else if (sub === "push") await guardPush(ctx, st, A, y, gdir);
}

async function guardGh(
  ctx: GuardCtx,
  st: State,
  p: Parsed,
  k: number,
  A: string[],
): Promise<void> {
  let y = 1;
  while (y < A.length) {
    const v = A[y]!;
    if (v === "-R" || v === "--repo" || v === "--hostname") y += 2;
    else if (v.startsWith("-")) y++;
    else break;
  }
  const sub = A[y] ?? "";
  const act = A[y + 1] ?? "";
  let hay = "";
  if (sub === "pr" && (act === "create" || act === "edit")) {
    if (act === "create")
      st.f.root =
        "gh pr create from the main thread: opening the PR is the subagent's delivery.";
    y += 2;
    while (y < A.length) {
      const v = A[y]!;
      if (["-t", "--title", "-b", "--body"].includes(v)) {
        hay += `\n${A[y + 1] ?? ""}`;
        y += 2;
        continue;
      }
      if (v.startsWith("--title=") || v.startsWith("--body="))
        hay += `\n${v.slice(v.indexOf("=") + 1)}`;
      else if (v === "-F" || v === "--body-file") {
        hay += `\n${await fileText(p, k, A[y + 1] ?? "", ctx.read)}`;
        y += 2;
        continue;
      } else if (v.startsWith("--body-file="))
        hay += `\n${await fileText(p, k, v.slice(12), ctx.read)}`;
      else if (
        [
          "-R",
          "--repo",
          "-B",
          "--base",
          "-H",
          "--head",
          "-a",
          "--assignee",
          "-l",
          "--label",
          "-m",
          "--milestone",
          "-p",
          "--project",
          "-r",
          "--reviewer",
          "-T",
          "--template",
        ].includes(v) ||
        v.startsWith("--add-") ||
        v.startsWith("--remove-")
      ) {
        y += 2;
        continue;
      }
      y++;
    }
    hit(st, scan("pr", hay));
  } else if (sub === "pr" && act === "merge") st.f.merge = "gh pr merge";
  else if (sub === "api") {
    let ep = "";
    y++;
    while (y < A.length) {
      const v = A[y]!;
      if (["-f", "--raw-field", "-F", "--field"].includes(v)) {
        const f = A[y + 1] ?? "";
        const at = f.indexOf("=@");
        hay +=
          at >= 0
            ? `\n${await fileText(p, k, f.slice(at + 2), ctx.read)}`
            : `\n${f.includes("=") ? f.slice(f.indexOf("=") + 1) : f}`;
        y += 2;
        continue;
      }
      if (v === "--input") {
        hay += `\n${await fileText(p, k, A[y + 1] ?? "", ctx.read)}`;
        y += 2;
        continue;
      }
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
        ].includes(v)
      ) {
        y += 2;
        continue;
      }
      if (!v.startsWith("-") && !ep) ep = v;
      y++;
    }
    if (MERGE_RE.test(ep)) st.f.merge = `gh api ${ep}`;
    else if (ep === "graphql") {
      const m = MERGE_WORDS.exec(hay);
      if (m) st.f.merge = `gh api graphql ${m[0]}`;
      if (/(create|update)PullRequest/.test(hay)) hit(st, scan("pr", hay));
    } else if (/(^|\/)pulls(\/[^/]+)?\/?$/.test(ep)) hit(st, scan("pr", hay));
  }
}

function guardGlab(st: State, A: string[]): void {
  let y = 1;
  while (y < A.length) {
    const v = A[y]!;
    if (v === "-R" || v === "--repo") y += 2;
    else if (v.startsWith("-")) y++;
    else break;
  }
  const sub = A[y] ?? "";
  const act = A[y + 1] ?? "";
  const words = MERGE_WORDS.exec(A.join(" "));
  if (words) st.f.merge = `glab ${words[0]}`;
  if (sub === "mr" && (act === "create" || act === "update")) {
    if (act === "create")
      st.f.root =
        "glab mr create from the main thread: opening the PR is the subagent's delivery.";
    let hay = "";
    y += 2;
    while (y < A.length) {
      const v = A[y]!;
      if (["-t", "--title", "-d", "--description"].includes(v)) {
        hay += `\n${A[y + 1] ?? ""}`;
        y += 2;
        continue;
      }
      if (v.startsWith("--title=") || v.startsWith("--description="))
        hay += `\n${v.slice(v.indexOf("=") + 1)}`;
      y++;
    }
    hit(st, scan("pr", hay));
  } else if (sub === "mr" && act === "merge") st.f.merge = "glab mr merge";
  else if (sub === "api") {
    y++;
    while (y < A.length) {
      const v = A[y]!;
      if (
        [
          "-X",
          "--method",
          "-H",
          "--header",
          "-f",
          "--raw-field",
          "-F",
          "--field",
          "--hostname",
          "--input",
        ].includes(v)
      ) {
        y += 2;
        continue;
      }
      if (!v.startsWith("-")) {
        if (MERGE_RE.test(v)) st.f.merge = `glab api ${v}`;
        break;
      }
      y++;
    }
  }
}

function guardHttp(st: State, name: string, A: string[]): void {
  for (const v of A.slice(1)) {
    const m = MERGE_RE.exec(v) ?? MERGE_WORDS.exec(v);
    if (m) {
      st.f.merge = `${name} ${m[0]}`;
      return;
    }
    if (/\/pulls\/[^/\s]+\/merge([/?\s]|$)/.test(v)) {
      st.f.merge = `${name} …/merge`;
      return;
    }
  }
}

function guardClaude(st: State, A: string[]): void {
  if (A[1] !== "plugin" && A[1] !== "plugins") return;
  let y: number;
  if (A[2] === "install" || A[2] === "i") y = 3;
  else if (A[2] === "marketplace" && A[3] === "add") y = 4;
  else return;
  let spec = "";
  while (y < A.length) {
    const v = A[y]!;
    if (v === "-s" || v === "--scope") {
      y += 2;
      continue;
    }
    if (!v.startsWith("-")) {
      spec = v;
      break;
    }
    y++;
  }
  if (!spec) return;
  const ok =
    A[2] === "marketplace"
      ? /kodflow\/claude-marketplace(\.git|\/)?$/.test(spec)
      : spec.endsWith("@kodflow");
  if (!ok)
    st.f.plugin = `claude plugin ${A[2]}${A[2] === "marketplace" ? ` ${A[3]}` : ""} ${spec}`;
}

/** The cheap gate of pre_bash: a line naming no verb we know leaves at once. */
export function gate(line: string): boolean {
  const t = /["'\\]/.test(line) ? line.replace(/["'\\]/g, "") : line;
  return (
    /git|gh|glab|curl|wget|http|skills|claude/.test(t) || line.includes("$'")
  );
}

/** What a Bash line does that a guard looks at. */
export async function inspect(
  line: string,
  ctx: GuardCtx,
): Promise<Findings | undefined> {
  if (!line || !gate(line)) return undefined;
  const p = parse(line);
  const st: State = {
    f: { commit: false, force: false },
    gdir: "",
    hooks: false,
    amend: false,
  };
  for (let k = 0; k < p.commands.length; k++) {
    const cmd = p.commands[k]!;
    for (const r of cmd.redirs)
      if (modPath(r, ctx.home, ctx.configDir)) st.f.modWrite = r;
    const { argv: A, name } = argvOf(cmd);
    st.hooks = false;
    if (name === "claude") guardClaude(st, A);
    else if (name === "git") await guardGit(ctx, st, p, k, A);
    else if (name === "gh") await guardGh(ctx, st, p, k, A);
    else if (name === "glab") guardGlab(st, A);
    else if (["curl", "wget", "http", "https", "xh"].includes(name))
      guardHttp(st, name, A);
    else if (name === "cd") st.gdir = A[1] ?? "";
  }
  return st.f;
}

const ROOT_OK =
  /^([A-Za-z_][A-Za-z0-9_]*=[^ \t\n\r\f\v]*[ \t\n\r\f\v]+)*ROOT_OK=1([ \t\n\r\f\v]|$)/;

/** The command to run instead of a forced push (BLOCK 4). */
export function withLease(line: string): string {
  let fixed = line
    .replace(/(^|\s)(--force|-f)(?=\s|$)/g, "$1--force-with-lease")
    .replace(/(\s)\+(\S+)/g, "$1$2");
  if (!fixed.includes("--force-with-lease")) fixed += " --force-with-lease";
  return fixed;
}

/** The first block on-tool.sh's pre_bash would raise, in its order. */
export async function verdict(
  line: string,
  f: Findings,
  ctx: GuardCtx,
): Promise<Refusal | undefined> {
  if (f.root && ctx.rootMain && !ROOT_OK.test(line))
    return {
      motif: "root",
      title: "BLOCKED — code production in a repository is delegated",
      lines: [
        f.root,
        "Dispatch the epic's subagent (task_focus the epic first), or SendMessage it if it is running;",
        "it works in its own worktree and delivers through a PR.",
        "A genuine exception: prefix the Bash line with ROOT_OK=1 (KODFLOW_ROOT=off turns the gate off).",
      ],
    };
  if (f.noVerify)
    return {
      motif: "no-verify",
      title: `COMMAND BLOCKED — skipping git hooks is forbidden (${f.noVerify})`,
      lines: [
        "Local git hooks are the second layer of the attribution and secret guards.",
        "If a hook is wrong, fix the hook; do not skip it.",
      ],
    };
  if (f.attr)
    return {
      motif: f.attr.motif,
      title: `${f.attr.kind === "pr" ? "PULL REQUEST" : "COMMIT"} BLOCKED — AI reference detected`,
      lines: [
        `Forbidden pattern: ${f.attr.pattern}`,
        "Remove AI attribution (co-authored-by, generated by, the robot emoji) and, in a commit, workflow leaks (.claude/ paths, Plan: footers).",
      ],
    };
  if (f.modWrite)
    return {
      motif: "mod-write",
      title: `COMMAND BLOCKED — plugin machinery written under a skills directory (${f.modWrite})`,
      lines: ["Ship it as a plugin of the kodflow marketplace instead."],
    };
  if (f.plugin)
    return {
      motif: "plugin-source",
      title: `COMMAND BLOCKED — plugin from outside the kodflow marketplace (${f.plugin})`,
      lines: ["Ask the user to install it themselves if it is wanted."],
    };
  if (f.force)
    return {
      motif: "force",
      title: "COMMAND BLOCKED — forced push",
      lines: [
        "--force, -f and a +refspec overwrite the remote without checking what is there.",
        `Run instead: ${withLease(line)}`,
      ],
    };
  if (ctx.agentId) {
    if (f.merge)
      return {
        motif: "merge",
        title: `COMMAND BLOCKED — a subagent does not merge (${f.merge})`,
        lines: [
          "Merging is the main thread's decision, after the user's explicit OK.",
          "Report the PR and its CI state; stop there.",
        ],
      };
    if (f.defaultPush)
      return {
        motif: "push-default",
        title: `COMMAND BLOCKED — a subagent does not push to the default branch (${f.defaultPush})`,
        lines: ["Push your feature branch and open a PR."],
      };
  } else if (f.merge && !(await ctx.mergeAllowed()))
    return {
      motif: "merge",
      title: `COMMAND BLOCKED — merge without the user's OK (${f.merge})`,
      lines: [
        "A merge from the main thread needs green CI and the user's answer to the kodflow merge question.",
      ],
    };
  return undefined;
}

/** A refusal as the model reads it, laid out like the shell's _block. */
export function refusalText(r: Refusal): string {
  const bar = "═══════════════════════════════════════════════";
  return [
    bar,
    `  ❌ ${r.title}`,
    bar,
    ...r.lines.map((l) => `  ${l}`),
    `  [motif:${r.motif}]`,
  ].join("\n");
}
