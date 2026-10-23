// docs.ts — the « Documents » view's data: docs.json as kodflow-hooks
// computes it, the project's docs/manifest.json as a click rewrites it, and
// the prompt a « Créer » button drafts. Pure.
//
// docs.json and the manifest are kodflow-hooks' contract (catalogue of 15
// documents, `ok` | `missing` | `ignored`); this mod reads the first and
// rewrites the second only on the person's click, keeping every key it does
// not know, the documents in the catalogue's order, two spaces, a final
// newline.

import type { HudDoc, HudDocs } from "../../types";

/** The catalogue's ids, in its order: the manifest's documents are sorted by it. */
export const CATALOG = [
  "prd",
  "trd",
  "flow",
  "design",
  "data",
  "impl",
  "adr",
  "voice",
  "glossary",
  "quality",
  "testing",
  "threat",
  "rgpd",
  "ops",
  "readme",
] as const;

export const MODES = ["ask", "context", "both"] as const;
export type DocMode = (typeof MODES)[number];

export const NO_DOCS: HudDocs = { found: false, docs: [] };

const STATES = new Set(["ok", "missing", "ignored"]);
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** docs.json's text as the view reads it; anything malformed is left out. */
export function parseDocs(text: string | undefined): HudDocs {
  if (text === undefined) return NO_DOCS;
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return NO_DOCS;
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.docs))
    return NO_DOCS;
  const docs: HudDoc[] = [];
  for (const d of raw.docs) {
    const id = str(d?.id);
    const path = str(d?.path);
    if (!id || !path || !STATES.has(d.state)) continue;
    docs.push({
      id,
      name: str(d.name) || id,
      path,
      state: d.state,
      ...(str(d.reason) !== undefined && { reason: d.reason }),
      ...(str(d.why) && { why: d.why }),
    });
  }
  const root = str(raw.root);
  const manifest = str(raw.manifest);
  return {
    found: true,
    ...(root && { root }),
    ...(manifest && { manifest }),
    docs,
  };
}

export const missingOf = (docs: HudDocs): HudDoc[] =>
  docs.docs.filter((d) => d.state === "missing");

/**
 * Where the manifest is, absolute: under docs.json's root, at the path it
 * names (docs/manifest.json by default). Undefined when the root is not
 * absolute or the path climbs out of it.
 */
export function manifestPath(docs: HudDocs): string | undefined {
  const root = docs.root;
  if (!root || !root.startsWith("/")) return undefined;
  const rel = docs.manifest || "docs/manifest.json";
  if (rel.startsWith("/") || rel.split("/").includes("..")) return undefined;
  return `${root.replace(/\/+$/, "")}/${rel}`;
}

/**
 * The manifest with `id` ignored or brought back. `text` is the file as it
 * stands (undefined: absent). Unknown keys stay; the documents follow the
 * catalogue's order, ids it does not know after them as they stood. An
 * ignored document keeps its `path`; brought back, an entry left empty goes.
 * Undefined when the file is not a JSON object: it is never overwritten.
 */
export function toggleManifest(
  text: string | undefined,
  id: string,
  ignore: boolean,
  reason = "",
): string | undefined {
  let raw: any = {};
  if (text !== undefined && text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return undefined;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  }
  const docs: Record<string, any> =
    raw.documents &&
    typeof raw.documents === "object" &&
    !Array.isArray(raw.documents)
      ? { ...raw.documents }
      : {};
  const entry: Record<string, unknown> =
    docs[id] && typeof docs[id] === "object" ? { ...docs[id] } : {};
  if (ignore) entry.ignored = reason;
  else delete entry.ignored;
  if (Object.keys(entry).length) docs[id] = entry;
  else delete docs[id];
  const known = (k: string) => (CATALOG as readonly string[]).indexOf(k);
  const keys = Object.keys(docs);
  const sorted = [
    ...keys.filter((k) => known(k) >= 0).sort((a, b) => known(a) - known(b)),
    ...keys.filter((k) => known(k) < 0),
  ];
  const documents: Record<string, unknown> = {};
  for (const k of sorted) documents[k] = docs[k];
  // version first when the file had none, every other key where it stood
  const out: Record<string, unknown> = "version" in raw ? {} : { version: 1 };
  for (const [k, v] of Object.entries(raw))
    out[k] = k === "documents" ? documents : v;
  if (!("documents" in raw)) out.documents = documents;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * What a « Créer » button drafts: the docs skill on the ids given (none:
 * every missing one) and the mode chosen.
 */
export function createPrompt(ids: readonly string[], mode: DocMode): string {
  const list = ids.length ? ` ${ids.join(",")}` : "";
  return `/kodflow-workflow:docs${list} --mode ${mode}`;
}
