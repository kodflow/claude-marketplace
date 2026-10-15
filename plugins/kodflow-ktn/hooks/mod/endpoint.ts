// endpoint.ts — where the per-user daemon is, read from the ONE discovery
// anchor ktn-linter writes for its clients: endpoint.json under HOME (#757,
// pkg/daemonctl `EndpointValue`). Pure.
//
// The socket path is never computed here: it depends on the runtime directory
// and the environment, and a second resolver in JS would agree with the Go one
// on one platform out of three. The pointer names it; the mod reads it.
// state.json is not a source either: a clean stop removes it, which is exactly
// when the launch button has to appear.
import { ANCHORS, ENDPOINT_SCHEMA, SOCKET_MAX_BYTES } from "./contract.ts";

export type Endpoint = {
  socket: string;
  /** The absolute binary the launcher starts; "" when the pointer has none. */
  exe: string;
  version: string;
};

export type EndpointRead =
  | { ok: true; endpoint: Endpoint }
  | { ok: false; reason: string };

/** The anchors to try, in order, under an absolute HOME. */
export function anchorPaths(home: string | undefined): string[] {
  if (!home || !home.startsWith("/")) return [];
  const base = home.endsWith("/") ? home.slice(0, -1) : home;
  return ANCHORS.map((rel) => `${base}/${rel}`);
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** Reads endpoint.json's text; every failure is a reason, never a throw. */
export function parseEndpoint(text: string): EndpointRead {
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
  if (typeof socket !== "string" || !socket.startsWith("/") || socket.includes("\0"))
    return { ok: false, reason: "endpoint.json sans socket absolu" };
  if (utf8Length(socket) > SOCKET_MAX_BYTES)
    return {
      ok: false,
      reason: `socket trop long (${utf8Length(socket)} octets, ${SOCKET_MAX_BYTES} au plus)`,
    };
  const exe =
    typeof raw.exe === "string" && raw.exe.startsWith("/") && !raw.exe.includes("\0")
      ? raw.exe
      : "";
  const version = typeof raw.version === "string" ? raw.version : "";
  return { ok: true, endpoint: { socket, exe, version } };
}
