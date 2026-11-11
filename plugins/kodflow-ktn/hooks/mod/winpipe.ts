// winpipe.ts — the Windows side of discovery, kept apart so that nothing
// here runs on POSIX and the node tests can drive it from any platform. Pure.
//
// Since kodflow/ktn-linter#989 the per-user daemon listens, on Windows, on a
// named pipe its IPC library derives from the socket path endpoint.json
// names, never on a file at that path (#143). The name is
//
//   \\.\pipe\ipc-<hex of the first 8 bytes of sha256(lower(clean(path)))>-<base(path)>
//
// (proc/ipc `pipeName`, at the version ktn-linter pins: PIPE_PREFIX and
// PIPE_HASH_BYTES in contract.ts). The daemon writes the socket path with
// filepath.Join, so it is already clean: this side normalises separators
// and refuses a path with `.` or `..` segments rather than re-implement
// Go's filepath.Clean, so a path the two sides could clean differently is
// never dialled. Lower-casing is JavaScript's, which agrees with Go's
// strings.ToLower on ASCII; a path outside ASCII is refused for the same
// reason.
import { PIPE_HASH_BYTES, PIPE_PREFIX, WINDOWS_ANCHOR } from "./contract.ts";

/** A Windows absolute path on a drive: `C:\...` or `C:/...`. */
export function isWindowsAbsolute(p: unknown): p is string {
  if (typeof p !== "string" || p.length < 3 || p.includes("\0")) return false;
  const c = p.charCodeAt(0) | 0x20;
  return (
    c >= 0x61 && c <= 0x7a && p[1] === ":" && (p[2] === "\\" || p[2] === "/")
  );
}

/**
 * The path as Go's filepath.Clean leaves a path that is already clean:
 * backslashes only, no repeated or trailing separator. Undefined for what
 * this side would have to clean for real (a `.` or `..` segment, non-ASCII).
 */
export function windowsNormal(p: string): string | undefined {
  if (!isWindowsAbsolute(p)) return undefined;
  for (let i = 0; i < p.length; i++)
    if (p.charCodeAt(i) > 0x7e || p.charCodeAt(i) < 0x20) return undefined;
  const parts = p
    .slice(3)
    .split(/[\\/]+/)
    .filter((s) => s !== "");
  if (parts.some((s) => s === "." || s === "..")) return undefined;
  return `${p.slice(0, 2)}\\${parts.join("\\")}`;
}

/** The last element, as filepath.Base gives it for a normal path. */
export function windowsBase(normal: string): string {
  const cut = normal.lastIndexOf("\\");
  return cut < 0 ? normal : normal.slice(cut + 1);
}

/** SHA-256 of bytes; the engine's WebCrypto by default (mods have no node:crypto). */
export type Digest = (bytes: Uint8Array) => Promise<Uint8Array>;

export const webDigest: Digest = async (bytes) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

const hex = (b: Uint8Array) =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** The pipe that stands for a Windows socket path, or undefined when it cannot be derived safely. */
export async function pipeNameOf(
  socket: string,
  digest: Digest = webDigest,
): Promise<string | undefined> {
  const normal = windowsNormal(socket);
  if (normal === undefined || normal.length <= 3) return undefined;
  let sum: Uint8Array;
  try {
    sum = await digest(new TextEncoder().encode(normal.toLowerCase()));
  } catch {
    return undefined;
  }
  if (sum.length < PIPE_HASH_BYTES) return undefined;
  return `${PIPE_PREFIX}${hex(sum.slice(0, PIPE_HASH_BYTES))}-${windowsBase(normal)}`;
}

/** endpoint.json under %LOCALAPPDATA%, the Windows anchor; [] when the value is not a drive path. */
export function windowsAnchors(localAppData: string | undefined): string[] {
  const normal =
    localAppData === undefined ? undefined : windowsNormal(localAppData);
  if (normal === undefined) return [];
  return [
    `${normal.length > 3 ? normal : normal.slice(0, 2)}\\${WINDOWS_ANCHOR}`,
  ];
}

/** The drive root a launch runs from on Windows, the counterpart of `/`. */
export function driveRoot(p: string): string {
  return `${p.slice(0, 2)}\\`;
}
