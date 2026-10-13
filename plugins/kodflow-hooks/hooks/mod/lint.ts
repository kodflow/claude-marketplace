// lint.ts — project-linter, for Go projects only, and the /lint-setup command.
// No `$`: register.ts hands the flow a LintPort built on `$`, the tests one
// in memory.
//
// A Go project is the go.mod nearest a changed file (for /lint-setup, the
// path it is given), never above the session's root: making.codes has none
// at its root, only projects/making.codes/go.mod. The rule is written twice,
// once per side, and both are held to the same fixtures
// (tests/fixtures/gomod.json): here with `$.fs.exists`, in
// hooks/scripts/lib/gomod.sh with `[ -f ]`.
//
// /lint-setup checks what the hooks need (the binary, the daemon on
// KTN_LINTER_PORT or 7717, the phase configuration) and proposes each
// correction through `$.ui.ask`. Nothing is installed or started unasked; the
// phase configuration belongs to the user and is never written.

export type RunResult = { exitCode: number; stdout: string; stderr: string };

export type LintPort = {
  exists(path: string): Promise<boolean>;
  /** Whether the path is a directory; false when missing. */
  isDir(path: string): Promise<boolean>;
  /** The file's text, undefined when missing or unreadable. */
  read(path: string): Promise<string | undefined>;
  /** Run by argv; undefined when the command could not be started at all. */
  run(
    argv: readonly string[],
    timeoutMs: number,
  ): Promise<RunResult | undefined>;
  /** The label chosen; undefined when nobody can answer (a -p run, a dismissal). */
  ask(
    question: string,
    options: readonly string[],
  ): Promise<string | undefined>;
  /** The variables the check reads, as the session has them. */
  vars: {
    KTN_LINTER_PORT?: string;
    KTN_PRE_PHASES?: string;
    KTN_STOP_PHASES?: string;
  };
  sleep(ms: number): Promise<void>;
  /** The session's root directory, absolute. */
  root: string;
};

const parent = (p: string): string => {
  const cut = p.lastIndexOf("/");
  return cut <= 0 ? "/" : p.slice(0, cut);
};

const trimSlash = (p: string): string =>
  p.length > 1 ? p.replace(/\/+$/, "") : p;

/**
 * The directory of the go.mod nearest `path` (a file, or a directory when
 * `isDir`), at or below `root`; undefined when there is none or `path` is
 * outside `root`. Both absolute.
 */
export async function goModuleOf(
  path: string,
  root: string,
  exists: (p: string) => Promise<boolean>,
  isDir = false,
): Promise<string | undefined> {
  const top = trimSlash(root);
  const p = trimSlash(path);
  if (!top.startsWith("/") || !p.startsWith("/")) return undefined;
  if (p !== top && !p.startsWith(top === "/" ? "/" : `${top}/`))
    return undefined;
  let d = isDir ? p : parent(p);
  for (;;) {
    if (await exists(`${d === "/" ? "" : d}/go.mod`)) return d;
    if (d === top || d === "/") return undefined;
    d = parent(d);
  }
}

// --- phases --------------------------------------------------------------------

/** project-linter's phases, by number, and the names it accepts for each. */
const PHASES: readonly (readonly string[])[] = [
  ["structural"],
  ["signatures", "signature"],
  ["logic"],
  ["performance", "perf"],
  ["modern"],
  ["style"],
  ["comment", "comments"],
  ["tests", "test"],
  ["health"],
];

/** The tokens of a phase list (KTN_PRE_PHASES, KTN_STOP_PHASES) it would refuse. */
export function unknownPhases(spec: string): string[] {
  return spec
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .filter((t) => {
      const n = Number(t);
      if (/^[0-9]+$/.test(t)) return !(n >= 1 && n <= PHASES.length);
      return !PHASES.some((names) => names.includes(t.toLowerCase()));
    });
}

/** What is wrong with a .project-linter.yaml, read line by line: empty when nothing. */
export function yamlProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = text.split("\n");
  let inPhases = false;
  let enabled = false;
  let disabled = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inPhases = /^phases:\s*(#.*)?$/.test(line);
    if (/^max_phase:/.test(line))
      problems.push("max_phase is no longer read: list phases.enabled instead");
    const scope = /^review_scope:\s*([^\s#]*)/.exec(line);
    if (scope && !["diff", "full"].includes(scope[1]!.replace(/["']/g, "")))
      problems.push(`review_scope is "${scope[1]}": it must be diff or full`);
    if (inPhases && /^\s+enabled:/.test(line)) enabled = true;
    if (inPhases && /^\s+disabled:/.test(line)) disabled = true;
  }
  if (enabled && disabled)
    problems.push("phases.enabled and phases.disabled are both set: keep one");
  return problems;
}

// --- /lint-setup -----------------------------------------------------------------

export const LINT_SETUP = {
  name: "lint-setup",
  description:
    "Check project-linter for this Go project: binary, daemon, phases. Proposes each fix.",
  argumentHint: "[path in a Go module]",
} as const;

const RELEASES = "https://github.com/kodflow/project-linter/releases";

// The latest release's binary for this machine, into ~/.local/bin, through a
// temporary file renamed over the old one. Asked for before it runs.
const INSTALL = [
  "set -eu",
  `tag=$(curl -fsSL --max-time 20 https://api.github.com/repos/kodflow/project-linter/releases/latest | sed -n 's/.*"tag_name": *"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
  '[ -n "$tag" ]',
  "os=$(uname -s | tr '[:upper:]' '[:lower:]')",
  'case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) arch=$(uname -m) ;; esac',
  'dir=$HOME/.local/bin; mkdir -p "$dir"',
  'tmp=$(mktemp "$dir/.project-linter.XXXXXX")',
  `curl -fsSL --max-time 120 "${RELEASES}/download/$tag/project-linter-$os-$arch" -o "$tmp" || { rm -f "$tmp"; exit 1; }`,
  'chmod +x "$tmp"; mv -f "$tmp" "$dir/project-linter"',
  'printf "%s %s\\n" "$tag" "$dir/project-linter"',
].join("\n");

// Detached, its output in a log, so the command returns at once
const SERVE =
  'nohup "$0" serve --port="$1" >"${TMPDIR:-/tmp}/project-linter-mcp.log" 2>&1 </dev/null & disown';

const YES_INSTALL = "Install";
const YES_START = "Start it";
const NOT_NOW = "Not now";

async function health(io: LintPort, port: string): Promise<boolean> {
  const r = await io.run(
    [
      "curl",
      "-sS",
      "--max-time",
      "2",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      `http://127.0.0.1:${port}/health`,
    ],
    5000,
  );
  return r !== undefined && r.stdout.trim() === "200";
}

async function binary(io: LintPort, bin: string): Promise<string | undefined> {
  const r = await io.run([bin, "version"], 5000);
  if (!r || r.exitCode !== 0) return undefined;
  return r.stdout.trim().split("\n")[0] || "unknown version";
}

/** The whole check, as the text the command prints. */
export async function lintSetup(io: LintPort, args: string): Promise<string> {
  const root = trimSlash(io.root);
  const wanted = args.trim();
  const target = !wanted
    ? root
    : wanted.startsWith("/")
      ? trimSlash(wanted)
      : `${root === "/" ? "" : root}/${wanted.replace(/^\.\/+/, "")}`;
  const dir = await io.isDir(target);
  const module = await goModuleOf(target, root, (p) => io.exists(p), dir);
  if (!module) {
    return [
      `No go.mod at or above ${target} inside ${root}: not a Go project, so the hooks neither probe the`,
      "linter daemon nor run project-linter here, and there is nothing to set up.",
      "Name a file or a directory of a Go module to check it: /lint-setup <path>.",
    ].join("\n");
  }
  const lines = [`Go module: ${module}`];
  const port = io.vars.KTN_LINTER_PORT || "7717";

  let bin = "project-linter";
  let version = await binary(io, bin);
  lines.push(
    version
      ? `binary   ok, ${version}`
      : "binary   missing: project-linter is not on PATH",
  );
  if (!version) {
    const yes = await io.ask(
      `project-linter is not installed. Install its latest release from ${RELEASES} into ~/.local/bin?`,
      [YES_INSTALL, NOT_NOW],
    );
    if (yes === YES_INSTALL) {
      const r = await io.run(["bash", "-c", INSTALL], 180_000);
      const [tag, path] = (r?.stdout.trim() ?? "").split(" ");
      if (r && r.exitCode === 0 && path) {
        bin = path;
        version = (await binary(io, bin)) ?? tag;
        lines.push(
          `         installed ${tag} at ${path} (add ~/.local/bin to PATH for the hooks)`,
        );
      } else {
        lines.push(
          `         install failed: ${(r?.stderr.trim() || "could not run bash").slice(0, 300)}`,
        );
      }
    } else {
      lines.push(
        `         not installed. /ktn installs it, or download it from ${RELEASES}`,
      );
    }
  }

  let alive = await health(io, port);
  lines.push(
    alive
      ? `daemon   ok, :${port} answers /health`
      : `daemon   down: nothing answers http://127.0.0.1:${port}/health`,
  );
  if (!alive && version) {
    const yes = await io.ask(
      `The project-linter daemon is not running. Start it on :${port}?`,
      [YES_START, NOT_NOW],
    );
    if (yes === YES_START) {
      await io.run(["bash", "-c", SERVE, bin, port], 5000);
      for (let i = 0; i < 5 && !alive; i++) {
        await io.sleep(1000);
        alive = await health(io, port);
      }
      lines.push(
        alive
          ? `         started on :${port}`
          : "         did not answer within 5 s: see ${TMPDIR:-/tmp}/project-linter-mcp.log",
      );
    } else {
      lines.push(`         not started: project-linter serve --port=${port}`);
    }
  } else if (!alive) {
    lines.push("         needs the binary first");
  }

  const problems: string[] = [];
  for (const name of ["KTN_PRE_PHASES", "KTN_STOP_PHASES"] as const) {
    const spec = io.vars[name];
    if (spec === undefined || spec === "") continue;
    const bad = unknownPhases(spec);
    if (bad.length)
      problems.push(`${name} names unknown phases: ${bad.join(", ")}`);
  }
  const yaml = await io.read(`${module}/.project-linter.yaml`);
  if (yaml !== undefined)
    problems.push(
      ...yamlProblems(yaml).map((p) => `.project-linter.yaml: ${p}`),
    );
  lines.push(
    problems.length
      ? `phases   ${problems.length} problem(s), to fix by hand (this command never writes them):`
      : `phases   ok (${yaml === undefined ? "project-linter's defaults" : ".project-linter.yaml"}, hook phase lists valid)`,
  );
  for (const p of problems) lines.push(`         - ${p}`);
  return lines.join("\n");
}
