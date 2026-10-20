// daemon.ts — what the daemon's answers mean, read defensively. Pure.
//
// The spike of kodflow/ktn-linter#774 measured how each failure reaches a mod
// through `$.http.fetch`, and the states are told apart by that shape:
//
//   daemon absent         rejected: ECONNREFUSED (TCP) or ENOENT (socket)
//   daemon silent         rejected at 30 s: "aborted … no complete answer"
//                         (the mod's own race fires first, at wait + 5 s)
//   HTTP error            resolved, ok:false
//   invalid JSON          resolved; JSON.parse throws IN THE MOD
//   answer too big        rejected: "over the 4194304-byte limit"
//   socket path refused   rejected: "… refused: takes an absolute path"
//   refused by a policy   rejected with the refusal's own text (a hook's
//   or another plugin     `{ deny }` or the organization's web-fetch policy)
//
// The last one is NOT "daemon unreachable": offering to launch a daemon the
// session is not allowed to reach would only fail again.
import type { KtnCounts, KtnModel, KtnNode } from "../../types";
import { MAX_BODY_CHARS, MAX_NODES, NOT_SERVED, PROTOCOL_VERSION } from "./contract.ts";
import { clean, isPlain } from "./sanitize.ts";

export type Failure =
  | { kind: "absent"; detail: string }
  | { kind: "silent"; detail: string }
  | { kind: "broken"; detail: string }
  | { kind: "policy"; detail: string };

// A transport failure's own words, as the engine and the OS spell them
const TRANSPORT = [
  "ECONNREFUSED",
  "ENOENT",
  "ECONNRESET",
  "EPIPE",
  "EACCES",
  "ENOTSOCK",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "socket hang up",
];

/** A rejected fetch, by its message. */
export function classifyRejection(err: unknown): Failure {
  const msg = String((err as any)?.message ?? err);
  const detail = clean(msg, 200);
  if (msg.includes("no complete answer") || msg.includes("aborted"))
    return { kind: "silent", detail: "le daemon ne répond pas" };
  if (msg.includes("-byte limit"))
    return { kind: "broken", detail: "réponse trop grosse" };
  if (msg.includes("takes an absolute path"))
    return { kind: "broken", detail: "chemin de socket refusé" };
  for (const word of TRANSPORT)
    if (msg.includes(word)) return { kind: "absent", detail };
  return { kind: "policy", detail };
}

/** JSON.parse that answers undefined instead of throwing, and refuses a body too big to parse. */
export function parseJson(text: unknown): unknown {
  if (typeof text !== "string" || text.length > MAX_BODY_CHARS) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

// "1" to "99": a phase number as the daemon keys it
const isPhaseKey = (k: string): boolean =>
  k.length >= 1 && k.length <= 2 && [...k].every((c) => c >= "0" && c <= "9");

export function countsOf(raw: any): KtnCounts {
  const sev = raw && typeof raw === "object" ? raw.severity : undefined;
  const phase: Record<string, number> = {};
  const p = raw && typeof raw === "object" ? raw.phase : undefined;
  if (p && typeof p === "object")
    for (const k of Object.keys(p).slice(0, 16))
      if (isPhaseKey(k)) phase[k] = num(p[k]);
  return {
    findings: num(raw?.findings),
    severity: {
      error: num(sev?.error),
      warning: num(sev?.warning),
      info: num(sev?.info),
    },
    phase,
  };
}

const KINDS = new Set(["dir", "file", "finding"]);

function nodeOf(raw: any): KtnNode | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  // An id goes back to the daemon as it came (expand=): never altered, so
  // one with a control character or past any sane length is dropped instead
  if (!isPlain(raw.id, 1_100) || !KINDS.has(raw.kind)) return undefined;
  const node: KtnNode = {
    id: raw.id,
    kind: raw.kind,
    name: clean(raw.name, 200),
    depth: Math.min(num(raw.depth), 64),
    expanded: raw.expanded === true,
  };
  if (isPlain(raw.parent, 1_100)) node.parent = raw.parent;
  if (raw.kind === "finding") {
    node.line = num(raw.line);
    node.rule = clean(raw.rule, 80);
    node.severity = clean(raw.severity, 16);
    node.phase = num(raw.phase);
    node.message = clean(raw.message, 200);
  } else node.counts = countsOf(raw.counts);
  return node;
}

export type ModelRead =
  | { ok: true; model: KtnModel }
  | { ok: false; incompatible?: string; detail: string };

/** An /api/view answer of 200, read field by field; never a throw. */
export function parseModel(text: string): ModelRead {
  if (text.length > MAX_BODY_CHARS)
    return { ok: false, detail: "réponse trop grosse" };
  const raw: any = parseJson(text);
  if (!raw || typeof raw !== "object")
    return { ok: false, detail: "réponse illisible (JSON invalide)" };
  if (raw.schema !== PROTOCOL_VERSION)
    return {
      ok: false,
      incompatible: clean(String(raw.schema), 20),
      detail: "schéma du modèle inconnu",
    };
  const rawNodes: unknown[] = Array.isArray(raw.tree?.nodes) ? raw.tree.nodes : [];
  const nodes: KtnNode[] = [];
  for (const n of rawNodes) {
    if (nodes.length >= MAX_NODES) break;
    const node = nodeOf(n);
    if (node) nodes.push(node);
  }
  const total = num(raw.window?.total);
  return {
    ok: true,
    model: {
      rev: num(raw.rev),
      workspace: clean(raw.workspace, 300),
      state: clean(raw.state, 30),
      totals: countsOf(raw.totals),
      nodes,
      // Cut by the server or by us: the rest is the web UI's
      truncated: raw.truncated === true || rawNodes.length > nodes.length,
      hidden: Math.max(0, total - nodes.length),
      from: num(raw.window?.offset),
      total: Math.max(total, nodes.length),
    },
  };
}

export type StatusRead =
  | { ok: true; protocol: string; pending?: { reason: string; command: string } }
  | { ok: false; detail: string };

/**
 * /status: the protocol it speaks and, when the workspace waits for the
 * person's approval, the exact command the daemon says to run.
 */
export function parseStatus(text: string, workspace: string): StatusRead {
  const raw: any = parseJson(text);
  if (!raw || typeof raw !== "object")
    return { ok: false, detail: "réponse illisible (JSON invalide)" };
  const protocol = typeof raw.protocol_version === "string" ? raw.protocol_version : "";
  const list: any[] = Array.isArray(raw.pending_workspaces) ? raw.pending_workspaces : [];
  const hit = list.find((p) => p && p.root === workspace);
  return {
    ok: true,
    protocol: clean(protocol, 20),
    pending: hit
      ? { reason: clean(hit.reason, 200), command: clean(hit.command, 600) }
      : undefined,
  };
}

/** The reason in a refusal's body: the typed error's message, or its text. */
export function refusalOf(text: string): string {
  const raw: any = parseJson(text);
  const msg = raw?.error?.message;
  return clean(typeof msg === "string" ? msg : text, 200).trim();
}

export function isNotServed(status: number, text: string): boolean {
  if (status === 403) return text.includes("is not served");
  if (status === 404) return (parseJson(text) as any)?.error?.code === NOT_SERVED;
  return false;
}
