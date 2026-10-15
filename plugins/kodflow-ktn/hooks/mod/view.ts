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
import { RENDER_BUDGET } from "./contract.ts";
import { clean } from "./sanitize.ts";

declare const h: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => any;

export type Els = Record<string, unknown>;
export type Actions = {
  launch?: () => void;
  /** Opens or folds a directory or a file, by its id. */
  toggle?: (id: string) => void;
  /** Mints a link to the web UI. */
  openUi?: () => void;
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
    return {
      tree: el(els.Text, color ? { color, wrap: "truncate-end" } : { dimColor: true, wrap: "truncate-end" }, text),
      size: text.length,
    };
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
};

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
  const rows: any[] = [];
  const t = d?.kind === "ready" ? data.tree : undefined;
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
