// lint.ts — ktn-linter, for Go projects only, and the /lint-setup command.
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
// /lint-setup checks what ktn-linter needs in a session (the binary, its own
// command hooks, the per-user daemon when KTN_USER_DAEMON=1, the module's
// configuration) and proposes each correction through `$.ui.ask`. The hooks
// and the daemon are ktn-linter's to manage — `hook install`, `hook doctor`,
// `daemon ensure` — never this plugin's: nothing here speaks to a port
// (kodflow/ktn-linter#771). Nothing is installed or started unasked; the
// configuration belongs to the user and is never written.
//
// The binary is `ktn-linter`. `project-linter`, its old name, is only a
// fallback when ktn-linter is not on PATH.

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
    KTN_USER_DAEMON?: string;
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

// --- configuration ---------------------------------------------------------------

/** What is wrong with a .ktn-linter.yaml, read line by line: empty when nothing. */
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
    "Check ktn-linter for this Go project: binary, hooks, daemon, configuration. Proposes each fix.",
  argumentHint: "[path in a Go module]",
} as const;

// The public mirror: kodflow/ktn-linter, the source, is private.
const RELEASES = "https://github.com/kodflow/ktn/releases";

/** The binary's name, then the old one, looked up only when the first is absent. */
const BINARIES = ["ktn-linter", "project-linter"] as const;

/** A subcommand the binary does not know: an older release than `hook install`. */
const UNKNOWN_COMMAND = 40;

// The latest release's archive for this machine, checked against the
// release's checksums.txt, then ktn-linter and ktn-hook (the client its
// command hooks run) into ~/.local/bin, each through a temporary file renamed
// over the old one. Asked for before it runs.
const INSTALL = [
  "set -eu",
  `tag=$(curl -fsSL --max-time 20 https://api.github.com/repos/kodflow/ktn/releases/latest | sed -n 's/.*"tag_name": *"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
  '[ -n "$tag" ]',
  "os=$(uname -s | tr '[:upper:]' '[:lower:]')",
  'case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) arch=$(uname -m) ;; esac',
  'asset="ktn-linter_${os}_${arch}.tar.gz"',
  'work=$(mktemp -d); trap \'rm -rf "$work"\' EXIT',
  `curl -fsSL --max-time 120 "${RELEASES}/download/$tag/$asset" -o "$work/$asset"`,
  `curl -fsSL --max-time 20 "${RELEASES}/download/$tag/checksums.txt" -o "$work/checksums.txt"`,
  'want=$(awk -v a="$asset" \'$2 == a { print $1 }\' "$work/checksums.txt")',
  'if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$work/$asset"); else got=$(shasum -a 256 "$work/$asset"); fi',
  '[ -n "$want" ] && [ "${got%% *}" = "$want" ] || { echo "checksum mismatch for $asset" >&2; exit 1; }',
  'tar -xzf "$work/$asset" -C "$work" ktn-linter ktn-hook',
  'dir=$HOME/.local/bin; mkdir -p "$dir"',
  'for b in ktn-linter ktn-hook; do tmp=$(mktemp "$dir/.$b.XXXXXX"); cp "$work/$b" "$tmp"; chmod 755 "$tmp"; mv -f "$tmp" "$dir/$b"; done',
  'printf "%s %s\\n" "$tag" "$dir/ktn-linter"',
].join("\n");

const YES_INSTALL = "Install";
const YES_HOOKS = "Install the hooks";
const YES_DAEMON = "Start it";
const NOT_NOW = "Not now";

async function binary(io: LintPort, bin: string): Promise<string | undefined> {
  const r = await io.run([bin, "version"], 5000);
  if (!r || r.exitCode !== 0) return undefined;
  return r.stdout.trim().split("\n")[0] || "unknown version";
}

type Doctor =
  | { kind: "ok" }
  | { kind: "defects"; defects: string[] }
  | { kind: "unsupported" }
  | { kind: "failed"; detail: string };

/** `hook doctor --json`, read: the installation of ktn-linter's own hooks. */
async function doctor(io: LintPort, bin: string): Promise<Doctor> {
  const r = await io.run([bin, "hook", "doctor", "--json"], 30_000);
  if (!r) return { kind: "failed", detail: `${bin} hook doctor could not run` };
  if (r.exitCode === UNKNOWN_COMMAND) return { kind: "unsupported" };
  let report: { ok?: unknown; defects?: unknown } | undefined;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    report = undefined;
  }
  if (!report || typeof report !== "object")
    return {
      kind: "failed",
      detail: (r.stderr.trim() || r.stdout.trim() || `exit ${r.exitCode}`).slice(0, 300),
    };
  if (report.ok === true && r.exitCode === 0) return { kind: "ok" };
  const defects = Array.isArray(report.defects)
    ? report.defects.map((d: any) =>
        `${d?.code ?? "defect"}${d?.host ? ` (${d.host})` : ""}: ${d?.message ?? ""}`.trim(),
      )
    : [];
  return { kind: "defects", defects: defects.length ? defects : [`exit ${r.exitCode}`] };
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
      `No go.mod at or above ${target} inside ${root}: not a Go project, so the hooks do not run`,
      "ktn-linter here, and there is nothing to set up.",
      "Name a file or a directory of a Go module to check it: /lint-setup <path>.",
    ].join("\n");
  }
  const lines = [`Go module: ${module}`];

  // --- binary
  let bin: string = BINARIES[0];
  let version: string | undefined;
  for (const name of BINARIES) {
    version = await binary(io, name);
    if (version) {
      bin = name;
      break;
    }
  }
  lines.push(
    !version
      ? "binary   missing: ktn-linter is not on PATH"
      : bin === BINARIES[0]
        ? `binary   ok, ${version}`
        : `binary   ok, ${version} (found as ${bin}, the old name: ktn-linter is the one to install)`,
  );
  if (!version) {
    const yes = await io.ask(
      `ktn-linter is not installed. Install its latest release from ${RELEASES} (ktn-linter and ktn-hook, checksum verified) into ~/.local/bin?`,
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
      lines.push(`         not installed: download it from ${RELEASES}`);
    }
  }

  // --- hooks: ktn-linter's own command hooks, installed and judged by it
  if (!version) {
    lines.push("hooks    needs the binary first");
  } else {
    let d = await doctor(io, bin);
    if (d.kind === "ok") {
      lines.push("hooks    ok, ktn-linter hook doctor reports a sound installation");
    } else if (d.kind === "unsupported") {
      lines.push(
        `hooks    unavailable: ${bin} predates \`hook install\` (ktn-linter v1.46.0); install the latest release from ${RELEASES}`,
      );
    } else if (d.kind === "failed") {
      lines.push(`hooks    unknown: ${d.detail}`);
    } else {
      lines.push(`hooks    ${d.defects.length} defect(s) reported by hook doctor:`);
      for (const x of d.defects) lines.push(`         - ${x}`);
      const yes = await io.ask(
        "ktn-linter's command hooks are not sound. Run `ktn-linter hook install`? It rewrites its own entries in your user settings, and nothing else.",
        [YES_HOOKS, NOT_NOW],
      );
      if (yes === YES_HOOKS) {
        const r = await io.run([bin, "hook", "install"], 120_000);
        d = await doctor(io, bin);
        lines.push(
          d.kind === "ok"
            ? "         installed; hook doctor now reports ok (restart the session to load them)"
            : `         hook install did not leave a sound installation: ${(r?.stderr.trim() || (d.kind === "defects" ? d.defects.join("; ") : "see ktn-linter hook doctor")).slice(0, 300)}`,
        );
      } else {
        lines.push(
          "         not installed: ktn-linter hook install, then ktn-linter hook doctor",
        );
      }
    }
  }

  // --- daemon: the per-user one when opted in, else the MCP server's own
  if (io.vars.KTN_USER_DAEMON !== "1") {
    lines.push(
      "daemon   per project, started by the MCP server (ktn-linter mcp install; make hooks-install in ktn-linter's own repository)",
    );
  } else if (!version) {
    lines.push("daemon   needs the binary first");
  } else {
    const ok = async () => (await io.run([bin, "daemon", "status"], 10_000))?.exitCode === 0;
    let alive = await ok();
    lines.push(
      alive
        ? "daemon   ok, ktn-linter daemon status reports the per-user daemon healthy"
        : "daemon   down: ktn-linter daemon status does not report a healthy per-user daemon",
    );
    if (!alive) {
      const yes = await io.ask(
        "The per-user ktn-linter daemon is not running. Start it with `ktn-linter daemon ensure`?",
        [YES_DAEMON, NOT_NOW],
      );
      if (yes === YES_DAEMON) {
        await io.run([bin, "daemon", "ensure"], 30_000);
        alive = await ok();
        lines.push(
          alive
            ? "         started (ktn-linter daemon ensure)"
            : "         did not come up: see ktn-linter daemon status",
        );
      } else {
        lines.push("         not started: ktn-linter daemon ensure");
      }
    }
  }

  // --- configuration: .ktn-linter.yaml, .project-linter.yaml as a fallback
  let name = ".ktn-linter.yaml";
  let yaml = await io.read(`${module}/${name}`);
  if (yaml === undefined) {
    const old = await io.read(`${module}/.project-linter.yaml`);
    if (old !== undefined) {
      name = ".project-linter.yaml";
      yaml = old;
    }
  }
  const problems =
    yaml === undefined ? [] : yamlProblems(yaml).map((p) => `${name}: ${p}`);
  lines.push(
    problems.length
      ? `config   ${problems.length} problem(s), to fix by hand (this command never writes them):`
      : `config   ok (${yaml === undefined ? "ktn-linter's defaults" : name})`,
  );
  for (const p of problems) lines.push(`         - ${p}`);
  return lines.join("\n");
}
