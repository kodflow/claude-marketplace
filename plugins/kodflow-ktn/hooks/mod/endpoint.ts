// endpoint.ts — where the per-user daemon is, read from the ONE discovery
// anchor ktn-linter writes for its clients: endpoint.json under HOME (#757,
// pkg/daemonctl `EndpointValue`). Pure.
//
// The socket path is never computed here: it depends on the runtime directory
// and the environment, and a second resolver in JS would agree with the Go one
// on one platform out of three. The pointer names it; the mod reads it.
// state.json is not a source either: a clean stop removes it, which is exactly
// when the launch button has to appear.
//
// Windows (#143) is read by winpipe.ts: the anchor under %LOCALAPPDATA%, a
// drive path for the socket and the binary. A POSIX session never meets it:
// its anchors come first, and LOCALAPPDATA is only read when it is a drive
// path.
import { ANCHORS, ENDPOINT_SCHEMA, SOCKET_MAX_BYTES } from "./contract.ts";
import { isWindowsAbsolute, windowsAnchors } from "./winpipe.ts";

export type Endpoint = {
  socket: string;
  /** The absolute binary the launcher starts; "" when the pointer has none. */
  exe: string;
  version: string;
};

export type EndpointRead =
  | { ok: true; endpoint: Endpoint }
  | { ok: false; reason: string };

/**
 * The anchors to try, in order: under an absolute HOME, then, when
 * LOCALAPPDATA names a drive path, the Windows one.
 */
export function anchorPaths(home: string | undefined, localAppData?: string): string[] {
  const posix: string[] = [];
  if (home && home.startsWith("/")) {
    const base = home.endsWith("/") ? home.slice(0, -1) : home;
    posix.push(...ANCHORS.map((rel) => `${base}/${rel}`));
  }
  return [...posix, ...windowsAnchors(localAppData)];
}

/**
 * An absolute path this side can dial or run: POSIX for a pointer read from
 * a HOME anchor, a Windows drive path for one read from the LOCALAPPDATA
 * anchor, never the other, so a POSIX session refuses a drive path as before.
 */
const absolute = (p: unknown, windows: boolean): p is string =>
  typeof p === "string" && !p.includes("\0") && (windows ? isWindowsAbsolute(p) : p.startsWith("/"));

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/**
 * Reads endpoint.json's text; every failure is a reason, never a throw.
 * `windows`: the pointer came from the LOCALAPPDATA anchor (#143).
 */
export function parseEndpoint(text: string, opts: { windows?: boolean } = {}): EndpointRead {
  const windows = opts.windows === true;
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "endpoint.json illisible (JSON invalide)" };
  }
  if (!raw || typeof raw !== "object")
    return { ok: false, reason: "endpoint.json illisible" };
  if (raw.schema !== ENDPOINT_SCHEMA)
    return {
      ok: false,
      reason: `endpoint.json de schéma ${String(raw.schema)}, ${ENDPOINT_SCHEMA} attendu`,
    };
  const socket = raw.socket;
  if (!absolute(socket, windows))
    return { ok: false, reason: "endpoint.json sans socket absolu" };
  if (utf8Length(socket) > SOCKET_MAX_BYTES)
    return {
      ok: false,
      reason: `socket trop long (${utf8Length(socket)} octets, ${SOCKET_MAX_BYTES} au plus)`,
    };
  const exe = absolute(raw.exe, windows) ? raw.exe : "";
  const version = typeof raw.version === "string" ? raw.version : "";
  return { ok: true, endpoint: { socket, exe, version } };
}
