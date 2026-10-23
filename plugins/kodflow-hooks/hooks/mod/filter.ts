// filter.ts — Bash output, compressed after the command ran (L3, D3). Pure.
//
// The input is never rewritten: the command runs as the model wrote it, and
// what comes back is shortened for the model to read, in the shape the tool
// gave it (every other key of the result kept). Only a line that is exactly
// one simple command of a known kind is touched (git status, log and diff,
// ls -l, find, grep -rn), never a read whose bytes count (cat, head, tail,
// sed, diff, git show, git cat-file, …), never a failed, interrupted,
// persisted, image, background or structured result, and only when the result
// has the shape a Bash call gives (an object whose stdout is a string): the
// shape is checked on every call, on whatever engine version, since a
// version window goes stale with each release. Anything unexpected leaves
// the result as it came: the caller wraps it, and a throw returns `r`
// untouched.
import { argvOf, parse, type Command } from "./shell.ts";

/** Reads whose bytes count: their output is never touched. */
export const BYTE_READS = new Set([
  "cat",
  "head",
  "tail",
  "sed",
  "awk",
  "diff",
  "cmp",
  "od",
  "xxd",
  "hexdump",
  "base64",
  "less",
  "more",
  "tac",
  "nl",
  "jq",
  "yq",
  "sha256sum",
  "shasum",
  "md5sum",
  "cksum",
]);
const BYTE_GIT = new Set([
  "show",
  "cat-file",
  "blame",
  "format-patch",
  "archive",
  "ls-tree",
  "rev-parse",
]);

/** The command when the line is exactly one plain one, else undefined. */
function single(line: string): Command | undefined {
  const p = parse(line);
  if (p.nested || p.commands.length !== 1) return undefined;
  const c = p.commands[0]!;
  if (c.redirs.length || c.stdin || c.pipe) return undefined;
  return c;
}

/** git's subcommand and its arguments, past the global options. */
function gitSub(A: string[]): { sub: string; rest: string[] } {
  let y = 1;
  while (y < A.length && A[y]!.startsWith("-"))
    y += ["-C", "-c", "--git-dir", "--work-tree"].includes(A[y]!) ? 2 : 1;
  return { sub: A[y] ?? "", rest: A.slice(y + 1) };
}

/** True when anything on the line is a read whose bytes count. */
export function readsBytes(line: string): boolean {
  for (const c of parse(line).commands) {
    const { argv, name } = argvOf(c);
    if (BYTE_READS.has(name)) return true;
    if (name === "git" && BYTE_GIT.has(gitSub(argv).sub)) return true;
  }
  return false;
}

const has = (rest: string[], ...flags: string[]) =>
  rest.some((v) => flags.some((f) => v === f || v.startsWith(`${f}=`)));

function squeezeBlank(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines)
    if (l.trim() || (out.length && out[out.length - 1]!.trim())) out.push(l);
  while (out.length && !out[out.length - 1]!.trim()) out.pop();
  return out;
}

function gitStatus(rest: string[], text: string): string | undefined {
  if (has(rest, "--porcelain", "-s", "--short", "-z", "--null"))
    return undefined;
  const lines = text
    .split("\n")
    .filter(
      (l) =>
        !/^\s*\((use|commit or discard|create\/copy|fix conflicts|all conflicts|run)\b[^)]*\)\s*$/.test(
          l,
        ),
    );
  return (
    squeezeBlank(
      lines.map((l) =>
        l.replace(
          /^no changes added to commit \(use .*\)$/,
          "no changes added to commit",
        ),
      ),
    ).join("\n") + (text.endsWith("\n") ? "\n" : "")
  );
}

function gitLog(rest: string[], text: string): string | undefined {
  if (
    has(
      rest,
      "--oneline",
      "--format",
      "--pretty",
      "-p",
      "-u",
      "--patch",
      "--stat",
      "--shortstat",
      "--numstat",
      "--graph",
      "--name-only",
      "--name-status",
      "-L",
      "--raw",
      "-z",
      "--source",
      "--show-signature",
      "--decorate-refs",
    )
  )
    return undefined;
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const head = /^commit ([0-9a-f]{40})(.*)$/.exec(lines[i]!);
    if (!head) {
      if (!lines[i]!.trim()) {
        i++;
        continue;
      }
      return undefined; // not the shape this reads: leave it whole
    }
    i++;
    let author = "";
    let date = "";
    while (i < lines.length && lines[i]!.trim()) {
      const l = lines[i]!;
      const a = /^Author:\s+(.*?)(\s+<[^>]*>)?$/.exec(l);
      const d = /^Date:\s+(.*)$/.exec(l);
      if (a) author = a[1]!;
      else if (d) date = d[1]!;
      else if (!/^Merge:\s/.test(l)) return undefined;
      i++;
    }
    out.push(`${head[1]!.slice(0, 12)}${head[2]} · ${author} · ${date}`);
    while (i < lines.length && !/^commit [0-9a-f]{40}/.test(lines[i]!)) {
      const l = lines[i]!;
      if (l.trim()) out.push(`  ${l.replace(/^ {4}/, "")}`);
      i++;
    }
  }
  return out.length ? `${out.join("\n")}\n` : undefined;
}

export const DIFF_MAX_LINES = 3000;

function gitDiff(rest: string[], text: string): string | undefined {
  if (
    has(
      rest,
      "--stat",
      "--name-only",
      "--name-status",
      "--numstat",
      "--shortstat",
      "--raw",
      "-z",
      "--binary",
      "--output",
      "--patch-with-raw",
      "--summary",
      "--check",
    )
  )
    return undefined;
  const lines = text.split("\n");
  const kept: string[] = [];
  let inHeader = false;
  for (const l of lines) {
    if (l.startsWith("diff --git ")) inHeader = true;
    else if (l.startsWith("@@")) inHeader = false;
    if (inHeader && /^index [0-9a-f]+\.\.[0-9a-f]+/.test(l)) continue;
    kept.push(l);
  }
  if (kept.length > DIFF_MAX_LINES) {
    const more = kept.length - DIFF_MAX_LINES;
    return `${kept.slice(0, DIFF_MAX_LINES).join("\n")}\n… ${more} more lines (git diff --stat for the whole change, or a path to narrow it)\n`;
  }
  return kept.join("\n");
}

const LS_LONG =
  /^([dlcbps-][rwxsStT-]{9}[@+.]?)\s+\d+\s+\S+\s+\S+\s+(\S+)\s+(\w{3}\s+\d+\s+[\d:]+|\d+\s+\w{3}\s+[\d:]+)\s(.*)$/;

function ls(A: string[], text: string): string | undefined {
  const flags = A.slice(1)
    .filter((v) => /^-[^-]/.test(v))
    .join("");
  if (!flags.includes("l") || /[n@eO]/.test(flags)) return undefined;
  let changed = false;
  const out = text.split("\n").flatMap((l) => {
    if (/^total \d+/.test(l)) {
      changed = true;
      return [];
    }
    const m = LS_LONG.exec(l);
    if (!m) return [l];
    changed = true;
    return [`${m[1]} ${m[2]} ${m[3]!.replace(/\s+/g, " ")} ${m[4]}`];
  });
  return changed ? out.join("\n") : undefined;
}

export const GROUP_MIN_LINES = 20;

function find(A: string[], text: string): string | undefined {
  if (
    A.some((v) =>
      [
        "-print0",
        "-printf",
        "-fprintf",
        "-ls",
        "-fls",
        "-exec",
        "-execdir",
        "-ok",
        "-delete",
      ].includes(v),
    )
  )
    return undefined;
  const lines = text.split("\n").filter((l) => l !== "");
  if (lines.length < GROUP_MIN_LINES) return undefined;
  const byDir = new Map<string, string[]>();
  for (const l of lines) {
    const cut = l.lastIndexOf("/");
    const dir = cut < 0 ? "." : l.slice(0, cut) || "/";
    const name = cut < 0 ? l : l.slice(cut + 1);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(name);
  }
  const out: string[] = [];
  for (const [dir, names] of byDir) {
    out.push(`${dir}/`);
    for (const n of names) out.push(`  ${n}`);
  }
  return `${out.join("\n")}\n`;
}

export const GREP_LINE_MAX = 300;

function grep(A: string[], text: string): string | undefined {
  const flags = A.slice(1)
    .filter((v) => /^-[^-]/.test(v))
    .join("");
  const long = A.slice(1).filter((v) => v.startsWith("--"));
  const recursive =
    /[rR]/.test(flags) ||
    long.some((v) => /^--(recursive|dereference-recursive)$/.test(v));
  const numbered = flags.includes("n") || long.includes("--line-number");
  if (!recursive || !numbered) return undefined;
  if (
    /[clLoZzABCbqs]/.test(flags) ||
    long.some((v) =>
      /^--(count|files-with|files-without|only-matching|null|after|before|context|byte-offset|quiet|silent)/.test(
        v,
      ),
    )
  )
    return undefined;
  const lines = text.split("\n").filter((l) => l !== "");
  if (lines.length < GROUP_MIN_LINES) return undefined;
  const groups = new Map<string, string[]>();
  for (const l of lines) {
    const m = /^(.+?):(\d+):(.*)$/.exec(l);
    if (!m) return undefined;
    const t =
      m[3]!.length > GREP_LINE_MAX
        ? `${m[3]!.slice(0, GREP_LINE_MAX)}…`
        : m[3]!;
    if (!groups.has(m[1]!)) groups.set(m[1]!, []);
    groups.get(m[1]!)!.push(`  ${m[2]}: ${t}`);
  }
  const out: string[] = [];
  for (const [f, ls] of groups) out.push(f, ...ls);
  return `${out.join("\n")}\n`;
}

/** The compressed stdout for `line`, undefined to leave it as it is. */
export function compress(line: string, stdout: string): string | undefined {
  if (!stdout) return undefined;
  const c = single(line);
  if (!c) return undefined;
  const { argv: A, name } = argvOf(c);
  if (BYTE_READS.has(name)) return undefined;
  let out: string | undefined;
  if (name === "git") {
    const { sub, rest } = gitSub(A);
    if (sub === "status") out = gitStatus(rest, stdout);
    else if (sub === "log") out = gitLog(rest, stdout);
    else if (sub === "diff") out = gitDiff(rest, stdout);
  } else if (name === "ls") out = ls(A, stdout);
  else if (name === "find") out = find(A, stdout);
  else if (name === "grep") out = grep(A, stdout);
  return out !== undefined && out.length < stdout.length ? out : undefined;
}

type AnyResult = Record<string, any>;

/**
 * `r` with its stdout compressed, or `r` itself. `r` is what `next(e)`
 * resolved to for a Bash call; every key but `result.stdout` is kept.
 */
export function filterResult(line: string, r: AnyResult): AnyResult {
  if (!r || typeof r !== "object") return r;
  if (r.deny !== undefined || r.isError) return r;
  const res = r.result;
  if (!res || typeof res !== "object" || typeof res.stdout !== "string")
    return r;
  if (res.isImage || res.interrupted) return r;
  for (const k of ["persistedOutputPath", "backgroundTaskId", "structuredContent"])
    if (res[k] !== undefined && res[k] !== null) return r;
  if (readsBytes(line)) return r;
  const stdout = compress(line, res.stdout);
  if (stdout === undefined) return r;
  return { ...r, result: { ...res, stdout } };
}
