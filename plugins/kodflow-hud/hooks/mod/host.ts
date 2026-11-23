// host.ts — what differs between the hosts the mod runs on: macOS, Linux,
// WSL and Windows. Pure.
//
// The engine hands a Windows session its paths in the Windows spelling
// (HOME=C:\Profiles\dev, the session root C:\src\x), and resolves a `$.fs` path
// with the platform's own rules, so `C:/a`, `C:\a` and `\\server\share\a`
// are as absolute there as `/a` is everywhere. Every path the mod builds is
// kept in forward slashes, the one spelling node, Git for Windows' tools and
// POSIX all read.
//
// `$.process.run` takes no shell: on Windows `mv`, `mkdir`, `ln`, `rm`,
// `rmdir`, `sh` and `bash` are Git for Windows' and are on PATH only when
// the user put them there; `bash` alone may even be WSL's launcher in
// System32, which runs a Linux shell that cannot see C:\. They go through
// Git Bash, by its absolute path, the one Claude Code itself runs hooks with.

const DRIVE = /^[A-Za-z]:[\\/]/;
const UNC = /^\\\\[^\\]/;
// The same share once its separators are forward (`//srv/share`)
const UNC_FWD = /^\/\/[^/\\]+[/\\][^/\\]/;

/** A path spelled the Windows way: a drive, or a share in either slash. */
const windowsy = (p: string): boolean =>
  DRIVE.test(p) || UNC.test(p) || UNC_FWD.test(p);

/** Absolute on any host: `/a`, `C:\a`, `C:/a` or `\\server\share`. */
export const isAbsolutePath = (p: unknown): p is string =>
  typeof p === "string" &&
  (p.startsWith("/") || DRIVE.test(p) || UNC.test(p));

/**
 * A Windows path in forward slashes (`C:\a\b` to `C:/a/b`, `\\s\x` to
 * `//s/x`), its drive letter upper-cased (`c:\a` and `C:\a` are one file);
 * anything else unchanged, since a backslash is a legal character in a
 * POSIX file name.
 */
export const slashed = (p: string): string => {
  if (!windowsy(p)) return p;
  const s = p.replace(/\\/g, "/");
  return DRIVE.test(s) ? s[0]!.toUpperCase() + s.slice(1) : s;
};

/**
 * The root an absolute path starts from, in forward slashes: `/`, `C:/` or
 * `//server/share/`; undefined for a relative one.
 */
export function rootOf(p: string): string | undefined {
  const s = slashed(p);
  if (/^[A-Za-z]:\//.test(s)) return s.slice(0, 3);
  const unc = /^\/\/[^/]+\/[^/]+\/?/.exec(s);
  if (unc) return unc[0].endsWith("/") ? unc[0] : `${unc[0]}/`;
  return s.startsWith("/") ? "/" : undefined;
}

/** Trailing slashes off, the root itself kept (`/`, `C:/`). */
export function trimSlash(p: string): string {
  const s = slashed(p);
  const root = rootOf(s);
  const cut = s.replace(/\/+$/, "");
  return root && cut.length < root.length ? root : cut || s;
}

/**
 * `rel` under `base`, or `rel` itself when it is absolute. Under a Windows
 * base the relative part's backslashes are separators too.
 */
export const joinPath = (base: string, rel: string): string =>
  isAbsolutePath(rel)
    ? slashed(rel)
    : `${trimSlash(base).replace(/\/$/, "")}/${windowsy(base) ? rel.replace(/\\/g, "/") : rel}`;

/**
 * The user's home: HOME when it is absolute, else USERPROFILE (Windows
 * sets it always and HOME only when someone did), in forward slashes.
 */
export function homeOf(
  home: string | undefined,
  userProfile?: string,
): string | undefined {
  for (const h of [home, userProfile])
    if (isAbsolutePath(h)) return trimSlash(h);
  return undefined;
}

/** The variables the host is read from. */
export type HostVars = {
  /** `Windows_NT` on Windows, in a Git Bash started there too; unset elsewhere, WSL included. */
  OS?: string;
  /** Where Claude Code was told Git Bash is (its own setting). */
  CLAUDE_CODE_GIT_BASH_PATH?: string;
  ProgramFiles?: string;
  LOCALAPPDATA?: string;
};

export const isWindows = (v: HostVars): boolean => v.OS === "Windows_NT";

/**
 * Where Git Bash may be, in the order Claude Code itself looks: its own
 * setting, then the two places the Git for Windows installer writes to.
 * `bin\bash.exe`, not `usr\bin\bash.exe`: the former puts /usr/bin on PATH.
 */
export function bashCandidates(v: HostVars): string[] {
  if (!isWindows(v)) return [];
  const out: string[] = [];
  if (v.CLAUDE_CODE_GIT_BASH_PATH) out.push(v.CLAUDE_CODE_GIT_BASH_PATH);
  if (v.ProgramFiles) out.push(`${v.ProgramFiles}\\Git\\bin\\bash.exe`);
  if (v.LOCALAPPDATA) out.push(`${v.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`);
  return out;
}

/** What the lookup answers on Windows when no Git Bash exists: argv needing it is refused. */
export const NO_GIT_BASH = "";

/** The POSIX tools the mod runs by name: Git for Windows', not native, on Windows. */
const POSIX = new Set(["mv", "mkdir", "ln", "rm", "rmdir", "cat", "chmod"]);

/**
 * `argv` as the host can start it. `bash` undefined (macOS, Linux, WSL):
 * unchanged. On Windows, `bash` and `sh` become Git Bash by its path, and a
 * POSIX tool runs through it, with `ln -s` making the kind of link Cygwin
 * makes without privilege (a dangling one included: the lock's owner).
 */
export function hostArgv(argv: readonly string[], bash: string | undefined): string[] {
  const [cmd, ...rest] = argv;
  if (bash === NO_GIT_BASH && cmd !== undefined && (cmd === "bash" || cmd === "sh" || POSIX.has(cmd)))
    // Never a bare "bash": on Windows it may be WSL's, which cannot see C:\
    throw new Error(
      `${cmd}: Git Bash not found (set CLAUDE_CODE_GIT_BASH_PATH to its bin\\bash.exe)`,
    );
  if (!bash || cmd === undefined) return [...argv];
  if (cmd === "bash" || cmd === "sh") return [bash, ...rest];
  if (POSIX.has(cmd))
    return [
      bash,
      "-c",
      'export MSYS="${MSYS:+$MSYS }winsymlinks:sys"; exec "$@"',
      "kodflow",
      cmd,
      ...rest,
    ];
  return [...argv];
}
