// view.ts — what kodflow-ktn draws, from what it holds. Pure: the element
// table is the surface's (`$.ui.resolve(e)`), `h` the module's JSX factory;
// nothing here reads `$`, fetches or writes, so a drawing is a function of
// the snapshot and nothing else.
//
// Only Box, Text, Button and Code are used, present on every surface; every
// string from the daemon was sanitised before it got here (daemon.ts), and
// `safe` turns any throw into a fallback tree of Box and Text, never a
// closed pane or an empty band.
import type { KtnCounts, KtnDaemon, KtnNode, KtnSnap, KtnTree } from "../../types";
import { RENDER_BUDGET, WINDOW_EDGE, WINDOW_MAX_CHARS, WINDOW_ROWS } from "./contract.ts";
import { clean } from "./sanitize.ts";

declare const h: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => any;

export type Els = Record<string, unknown>;
export type Actions = {
  launch?: () => void;
  /** Opens or folds a directory or a file, by its id. */
  toggle?: (id: string) => void;
  /** Mints a link to the web UI. */
  openUi?: () => void;
  /** Shows a finding's detail, or hides it when it is the one shown (#787). */
  inspect?: (id: string) => void;
};

/** h without the empty children a conditional leaves behind. */
export function el(type: unknown, props: Record<string, unknown> | null, ...kids: unknown[]): any {
  return h(type, props, ...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function countsText(c: KtnCounts): string {
  const s = c.severity;
  return `${plural(c.findings, "constat", "constats")} · ${s.error} E · ${s.warning} W · ${s.info} I`;
}

/**
 * The status line under the prompt, or undefined for none. The engine heads
 * it with the plugin's name already ("kodflow-ktn: …").
 */
export function statusText(snap: KtnSnap): string | undefined {
  if (snap.activation === "floor") return undefined; // said once, at the start
  if (snap.activation !== "active") return undefined;
  const d = snap.daemon;
  if (!d || d.kind === "loading") return "…";
  switch (d.kind) {
    case "ready":
      return d.totals && d.totals.findings > 0
        ? countsText(d.totals)
        : "✓ aucun constat";
    case "unreachable":
      return d.launching === "starting" ? "démarrage du daemon…" : "daemon injoignable";
    case "incompatible":
      return "API incompatible";
    case "pending":
      return "workspace en attente d'approbation";
    case "refused":
      return "workspace non servi";
    case "policy":
      return "requête refusée (politique)";
  }
}

/** The line that names the state, for the band and the pane's head. */
export function stateLine(snap: KtnSnap): { text: string; color?: string } {
  if (snap.activation === "inactive" || snap.activation === "undetermined")
    return { text: "ktn · hors projet Go", color: "inactive" };
  if (snap.activation !== "active") return { text: "ktn · inactif", color: "inactive" };
  const d = snap.daemon;
  const why = (s: string) => (d?.detail ? `${s} — ${clean(d.detail, 200)}` : s);
  switch (d?.kind) {
    case undefined:
    case "loading":
      return { text: "ktn · chargement…", color: "inactive" };
    case "unreachable":
      return { text: why("ktn · daemon injoignable"), color: "warning" };
    case "incompatible":
      return { text: why("ktn · API incompatible"), color: "error" };
    case "pending":
      return { text: why("ktn · en attente d'approbation"), color: "warning" };
    case "refused":
      return { text: why("ktn · workspace refusé / non servi"), color: "error" };
    case "policy":
      return { text: why("ktn · requête refusée par une politique"), color: "error" };
    case "ready":
      return d.totals && d.totals.findings > 0
        ? { text: `ktn · ${countsText(d.totals)}` }
        : { text: "ktn · propre : aucun constat", color: "success" };
  }
}

/** What the person can do about the state: a button, a command, a note. */
export function remedy(els: Els, d: KtnDaemon | undefined, actions: Actions): any[] {
  if (!d) return [];
  const out: any[] = [];
  if (d.kind === "unreachable") {
    if (d.launching === "starting")
      out.push(el(els.Text, { dimColor: true }, "démarrage du daemon…"));
    else if (d.launch === "button" && actions.launch)
      out.push(
        el(els.Button, { key: "ktn-launch", label: "Lancer le daemon", onPress: actions.launch }),
      );
    if (d.launch === "command" && d.command)
      out.push(
        el(els.Text, { dimColor: true }, "à lancer dans un terminal :"),
        el(els.Code, { source: clean(d.command, 600), language: "sh" }),
      );
    if (d.launching === "failed" && d.launchError)
      out.push(el(els.Text, { color: "error" }, `échec du lancement : ${clean(d.launchError, 300)}`));
  }
  if (d.kind === "pending" && d.command)
    out.push(
      el(els.Text, { dimColor: true }, "à lancer dans votre propre terminal :"),
      el(els.Code, { source: clean(d.command, 600), language: "sh" }),
    );
  return out;
}

/**
 * The band above the prompt: drawn only while there is something to act on
 * (the daemon to start, an approval to give, a refusal to read). A served
 * workspace leaves the band to others; the status line says the counts.
 */
export function band(els: Els, snap: KtnSnap, actions: Actions): any | undefined {
  if (snap.activation !== "active") return undefined;
  const d = snap.daemon;
  if (!d || d.kind === "ready" || d.kind === "loading") return undefined;
  const line = stateLine(snap);
  return el(
    els.Box,
    { flexDirection: "column" },
    el(els.Text, line.color ? { color: line.color, wrap: "truncate-end" } : { wrap: "truncate-end" }, line.text),
    remedy(els, d, actions),
  );
}

/** A drawing that cannot throw: any failure becomes a two-element tree. */
export function safe(els: Els, draw: () => any): any {
  try {
    return draw();
  } catch (err) {
    return fallback(els, err);
  }
}

export function fallback(els: Els, err: unknown): any {
  return h(
    els.Box,
    { flexDirection: "column" },
    h(els.Text, { color: "warning" }, "ktn · rendu impossible"),
    h(els.Text, { dimColor: true }, clean(String((err as any)?.message ?? err), 120)),
  );
}

/** "7 · 1E 4W 2I", the severities that have any. */
export function shortCounts(c: KtnCounts | undefined): string {
  if (!c) return "";
  const s = c.severity;
  const parts = [s.error ? `${s.error}E` : "", s.warning ? `${s.warning}W` : "", s.info ? `${s.info}I` : ""].filter(Boolean);
  return parts.length ? `${c.findings} · ${parts.join(" ")}` : String(c.findings);
}

export function phasesText(c: KtnCounts): string {
  const keys = Object.keys(c.phase).sort((a, b) => Number(a) - Number(b));
  return keys.length ? `phases ${keys.map((k) => `${k}:${c.phase[k]}`).join(" ")}` : "";
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
}

const SEVERITY_COLOR: Record<string, string> = { error: "error", warning: "warning" };

/** One row of the tree: a pressable directory or file, or a finding. */
function row(els: Els, n: KtnNode, actions: Actions): { tree: any; size: number } {
  const indent = "  ".repeat(Math.min(n.depth, 32));
  if (n.kind === "finding") {
    const text = `${indent}L${n.line ?? 0} ${n.rule ?? ""} ${n.message ?? ""}`;
    const color = SEVERITY_COLOR[n.severity ?? ""];
    const label = el(els.Text, color ? { color, wrap: "truncate-end" } : { dimColor: true, wrap: "truncate-end" }, text);
    // Pressed: its detail above the tree (#787)
    if (actions.inspect)
      return {
        tree: el(els.Button, { key: n.id, plain: true, onPress: () => actions.inspect?.(n.id) }, label),
        size: text.length,
      };
    return { tree: label, size: text.length };
  }
  const mark = n.expanded ? "▾" : "▸";
  const label = `${indent}${mark} ${n.name}${n.kind === "dir" && n.name !== "." ? "/" : ""}`;
  const counts = shortCounts(n.counts);
  // The root is always open: drawn, never pressed
  if (n.id === "dir:.")
    return { tree: el(els.Text, { bold: true, wrap: "truncate-end" }, `${label}  ${counts}`), size: label.length + counts.length };
  return {
    tree: el(
      els.Button,
      { key: n.id, plain: true, onPress: () => actions.toggle?.(n.id) },
      label,
      "  ",
      el(els.Text, { dimColor: true }, counts),
    ),
    size: label.length + counts.length + 2,
  };
}

export type PaneData = {
  snap: KtnSnap;
  tree?: KtnTree;
  /** The link the person minted, held by the module alone. */
  link?: { url: string; label: string };
  now: number;
  /**
   * The windowed mode (#787): the first row the mod shows and the rows of
   * THIS render's body (`e.props.scroll.bodyRows`). Absent: the engine
   * scrolls the whole tree natively (#777).
   */
  window?: { offset: number; bodyRows: number };
  /** The severities shown, empty for all (#787). */
  filter?: string[];
  /** The id of the finding whose detail is shown (#787). */
  detail?: string;
  /** Told the rows the windowed render gave the tree (its body less its head). */
  onLayout?: (rows: number) => void;
};

// --- the windowed mode (kodflow/ktn-linter#787) -------------------------------
//
// The daemon serves a window of WINDOW_ROWS nodes from `from`; the pane draws
// [offset, offset + rows) of the whole tree, `rows` being THIS render's body
// less the head. One instance is evaluated per surface with its own rows,
// and `ui.scroll` carries neither the surface nor the other surface's rows:
// the offset is one value, and every render re-clamps it to its own rows.

/** The last first row a window of `rows` rows may show over `total`. */
export function maxOffset(total: number, rows: number): number {
  return Math.max(0, Math.floor(total) - Math.max(1, Math.floor(rows)));
}

/** `offset` brought inside [0, maxOffset]; anything not a number is 0. */
export function clampOffset(offset: number, total: number, rows: number): number {
  const o = Number.isFinite(offset) ? Math.floor(offset) : 0;
  return Math.min(Math.max(0, o), maxOffset(total, rows));
}

/**
 * `ui.scroll`: the offset moved by `by` rows, clamped with the snapshot's
 * total — never `e.contentRows`, which counts only the rows drawn.
 */
export function scrolled(offset: number, by: number, total: number, rows: number): number {
  return clampOffset((Number.isFinite(offset) ? offset : 0) + (Number.isFinite(by) ? by : 0), total, rows);
}

/**
 * The window to ask for next, or undefined while [offset, offset + rows)
 * stays more than WINDOW_EDGE rows inside what the snapshot holds. The new
 * window is centred on what the person looks at.
 */
export function nextWindow(tree: KtnTree | undefined, offset: number, rows: number): number | undefined {
  if (!tree) return undefined;
  const from = tree.from ?? 0;
  const held = tree.nodes.length;
  const total = tree.total ?? from + held;
  const nearTop = from > 0 && offset < from + WINDOW_EDGE;
  const nearEnd = from + held < total && offset + rows > from + held - WINDOW_EDGE;
  if (!nearTop && !nearEnd) return undefined;
  const centred = offset - Math.floor(Math.max(0, WINDOW_ROWS - rows) / 2);
  const next = Math.min(Math.max(0, centred), Math.max(0, total - WINDOW_ROWS));
  return next === from ? undefined : next;
}

/** The text a node weighs in the snapshot, as the engine counts characters. */
const weight = (n: KtnNode) => n.id.length + n.name.length + (n.rule?.length ?? 0) + (n.message?.length ?? 0) + 16;

/**
 * The nodes the snapshot keeps: the window as served, cut once its text
 * passes WINDOW_MAX_CHARS — `$.state` is re-read on every render, so on
 * every wheel tick, and the worker every mod shares pays for its size.
 */
export function capWindow(nodes: KtnNode[], maxChars = WINDOW_MAX_CHARS): KtnNode[] {
  let used = 0;
  let i = 0;
  for (; i < nodes.length; i++) {
    used += weight(nodes[i]!);
    if (used > maxChars) break;
  }
  return i === nodes.length ? nodes : nodes.slice(0, i);
}

/** The detail of the finding `id`, drawn above the tree. */
function detailOf(els: Els, n: KtnNode, actions: Actions): any {
  const file = n.parent?.startsWith("file:") ? n.parent.slice(5) : "?";
  return el(
    els.Box,
    { flexDirection: "column" },
    el(els.Text, { bold: true, wrap: "truncate-end" }, `${n.rule ?? "?"} · ${n.severity ?? "?"} · phase ${n.phase ?? "?"}`),
    el(els.Code, { source: clean(`${file}:${n.line ?? 0}`, 1_100), language: "text" }),
    el(els.Text, null, n.message ?? ""),
    actions.inspect ? el(els.Button, { key: "ktn-detail-close", label: "Fermer le détail", onPress: () => actions.inspect?.(n.id) }) : null,
  );
}

/** How many rows a head element takes: a detail block counts its lines. */
const headRows = (head: any[]) => head.reduce((s, h) => s + (h?.props?.flexDirection === "column" ? 4 : 1), 0);

/**
 * The pane: the synthesis first (the state, the workspace, the totals by
 * severity and by phase, how long since the last answer, the launch button
 * when the daemon is down), then the collapsible tree as the daemon served
 * it — directories folded with their counts, the children of the opened ones
 * only. The pane does not window the tree: the engine scrolls it, and the
 * daemon bounds it (`truncated`, then "… voir l'UI web"). Its rows stop at a
 * text budget below the engine's 100 000 characters, saying what was left.
 */
export function pane(els: Els, data: PaneData, actions: Actions): any {
  const { snap } = data;
  const line = stateLine(snap);
  const head: any[] = [
    el(els.Text, line.color ? { color: line.color, wrap: "truncate-end" } : { bold: true, wrap: "truncate-end" }, line.text),
  ];
  if (snap.activation !== "active") return el(els.Box, { flexDirection: "column" }, head);
  const d = snap.daemon;
  if (snap.workspace) head.push(el(els.Text, { dimColor: true, wrap: "truncate-start" }, clean(snap.workspace, 300)));
  if (d?.kind === "ready" && d.totals) {
    const p = phasesText(d.totals);
    if (p) head.push(el(els.Text, { dimColor: true, wrap: "truncate-end" }, p));
    const age = d.at ? `actualisé il y a ${ago(data.now - d.at)}` : "";
    const engine = d.engine ? `moteur ${clean(d.engine, 30)}` : "";
    if (age || engine) head.push(el(els.Text, { dimColor: true }, [age, engine].filter(Boolean).join(" · ")));
  }
  head.push(...remedy(els, d, actions));
  if (d?.kind === "ready" && actions.openUi) {
    head.push(
      data.link
        ? el(els.Link, { href: data.link.url, label: data.link.label })
        : el(els.Button, { key: "ktn-open-ui", label: "Ouvrir l'UI web", onPress: actions.openUi }),
    );
  }
  const t = d?.kind === "ready" ? data.tree : undefined;
  const filter = (data.filter ?? []).filter((s) => typeof s === "string");
  if (filter.length > 0)
    head.push(el(els.Text, { dimColor: true, wrap: "truncate-end" }, `filtre : ${clean(filter.join(", "), 60)}`));
  const shown = data.detail && t ? t.nodes.find((n) => n.id === data.detail && n.kind === "finding") : undefined;
  if (shown) head.push(detailOf(els, shown, actions));
  if (data.window && t && t.workspace === snap.workspace)
    return windowed(els, head, t, data.window, actions, data.onLayout);
  const rows: any[] = [];
  if (t && t.workspace === snap.workspace) {
    let used = 0;
    let left = 0;
    for (const n of t.nodes) {
      if (used >= RENDER_BUDGET) {
        left++;
        continue;
      }
      const r = row(els, n, actions);
      used += r.size;
      rows.push(r.tree);
    }
    const more = left + (t.truncated ? t.hidden : 0);
    if (more > 0 || t.truncated)
      rows.push(el(els.Text, { dimColor: true }, `… ${more > 0 ? `${more} de plus, ` : ""}voir l'UI web`));
  }
  return el(els.Box, { flexDirection: "column" }, head, rows);
}

/**
 * The windowed tree: the head, then the rows [offset, offset + rows) of the
 * whole tree, re-clamped to THIS render's rows, plus one spare row so the
 * engine always has a row to scroll — and therefore raises `ui.scroll` for
 * the wheel and the arrows, which the mod answers with its own offset. A
 * row the snapshot does not hold yet draws as "…", never as a gap.
 */
function windowed(
  els: Els,
  head: any[],
  t: KtnTree,
  w: { offset: number; bodyRows: number },
  actions: Actions,
  onLayout?: (rows: number) => void,
): any {
  const from = t.from ?? 0;
  const total = Math.max(t.total ?? from + t.nodes.length, 0);
  const bodyRows = Number.isFinite(w.bodyRows) ? Math.max(0, Math.floor(w.bodyRows)) : 0;
  // The position line is a row of the head too
  const rows = Math.max(0, bodyRows - headRows(head) - (total > 0 ? 1 : 0));
  const offset = clampOffset(w.offset, total, rows);
  onLayout?.(rows);
  if (total > 0)
    head.push(el(els.Text, { dimColor: true }, `lignes ${offset + 1}–${Math.min(offset + Math.max(rows, 1), total)} sur ${total}`));
  const out: any[] = [];
  let used = 0;
  const end = Math.min(total, offset + rows + 1);
  for (let i = offset; i < end && used < RENDER_BUDGET; i++) {
    const n = t.nodes[i - from];
    if (!n) {
      out.push(el(els.Text, { dimColor: true }, "…"));
      used += 1;
      continue;
    }
    const r = row(els, n, actions);
    used += r.size;
    out.push(r.tree);
  }
  return el(els.Box, { flexDirection: "column" }, head, out);
}
