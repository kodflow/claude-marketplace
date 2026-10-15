// view.ts — what kodflow-ktn draws, from what it holds. Pure: the element
// table is the surface's (`$.ui.resolve(e)`), `h` the module's JSX factory;
// nothing here reads `$`, fetches or writes, so a drawing is a function of
// the snapshot and nothing else.
//
// Only Box, Text, Button and Code are used, present on every surface; every
// string from the daemon was sanitised before it got here (daemon.ts), and
// `safe` turns any throw into a fallback tree of Box and Text, never a
// closed pane or an empty band.
import type { KtnCounts, KtnDaemon, KtnSnap } from "../../types";
import { clean } from "./sanitize.ts";

declare const h: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => any;

export type Els = Record<string, unknown>;
export type Actions = { launch?: () => void };

/** h without the empty children a conditional leaves behind. */
export function el(type: unknown, props: Record<string, unknown> | null, ...kids: unknown[]): any {
  return h(type, props, ...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function countsText(c: KtnCounts): string {
  const s = c.severity;
  return `${plural(c.findings, "constat", "constats")} · ${s.error} E · ${s.warning} W · ${s.info} I`;
}

/** The status line under the prompt, or undefined for none. */
export function statusText(snap: KtnSnap): string | undefined {
  if (snap.activation === "floor") return undefined; // said once, at the start
  if (snap.activation !== "active") return undefined;
  const d = snap.daemon;
  if (!d || d.kind === "loading") return "ktn: …";
  switch (d.kind) {
    case "ready":
      return d.totals && d.totals.findings > 0
        ? `ktn: ${countsText(d.totals)}`
        : "ktn: ✓ aucun constat";
    case "unreachable":
      return d.launching === "starting" ? "ktn: démarrage du daemon…" : "ktn: daemon injoignable";
    case "incompatible":
      return "ktn: API incompatible";
    case "pending":
      return "ktn: workspace en attente d'approbation";
    case "refused":
      return "ktn: workspace non servi";
    case "policy":
      return "ktn: requête refusée (politique)";
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
