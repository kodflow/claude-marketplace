// hunt.ts — what the « Chasse » view knows of /hunt's runs. Pure: no `$`.
//
// /hunt (kodflow-workflow) keeps two small files per machine, written whole
// (a file beside, then `mv`) by its own scripts: `active.json`, the hunts
// under way, and each hunt's `<slug>/status.json`, a snapshot of at most
// 16 KiB folded from its journal. This module reads those two and nothing
// else: the journal is /hunt's, and a reader that went to it would be a
// second reducer. The paths are built here, from HOME and the slug made
// path-safe, never from a field of a file.
//
// A file of a format this reader does not know is said so, « format vN non
// lu », with no figure guessed. « figée » and « orpheline probable » are
// judged only in an active state (hunting, frozen, final-pass, pushing):
// a paused hunt or one waiting for its merge is quiet on purpose. The view
// cannot test a process, so « orpheline » stays a probability: the beat is
// very old, or the watchdog said the owner was gone; « reprendre » drafts
// `/hunt --resume <slug>` and /hunt's preflight decides.
//
// Toasts: the events past a per-hunt cursor, at most 3 a poll then
// « +N autres ». The first read of a hunt is the reference, silent; an older
// seq is ignored; a slug reused (its `created` changed) starts from zero.
// The events that call for the person now (pause, decision, convergence,
// MR, stall) are /hunt's desktop notification, sent once: the view shows
// them, never toasts them again.

import type {
  HudHunt,
  HudHuntCursor,
  HudHuntEvent,
  HudHuntRun,
  HudHuntStatus,
} from "../../types";
import { safe } from "./paths.ts";

/** The status.json format this reader knows. */
export const HUNT_V = 1;
/** Never more hunts read than this: one file each, every poll. */
export const MAX_HUNTS = 8;
/** hunt-status' default `stall_ms` (2 h 05, longer than a queued job's wait). */
export const STALL_MS = 7_500_000;
/** A beat this old in an active state: the owner is probably gone. */
export const ORPHAN_MS = 2 * STALL_MS;
/** Toasts a poll, past which one « +N autres » says the rest. */
export const TOASTS_PER_POLL = 3;

export const ACTIVE_STATES = ["hunting", "frozen", "final-pass", "pushing"];
/** Kinds /hunt notifies on the desktop itself, once (hunt-ledger ACT_NOW). */
export const ACT_NOW = ["pause", "decision", "converged", "mr-opened", "stall"];

export const NO_HUNT: HudHunt = { found: false, runs: [] };
export const UNREADABLE = "état illisible";

/** The state directory: always `$HOME/.local/state/hunt`, never XDG_STATE_HOME. */
export function huntRoot(home: string | undefined): string | undefined {
  if (!home || !home.startsWith("/")) return undefined;
  return `${home.replace(/\/+$/, "")}/.local/state/hunt`;
}

export const activeFile = (root: string): string => `${root}/active.json`;
export const statusFile = (root: string, slug: string): string =>
  `${root}/${safe(slug)}/status.json`;

/** KODFLOW_HUD_HUNT=off (or 0, false, no) turns the view off. */
export const huntOff = (value: string | undefined): boolean =>
  /^(off|0|false|no)$/i.test((value ?? "").trim());

/** A slug as /hunt accepts one: what a draft may carry. */
export const goodSlug = (slug: unknown): slug is string =>
  typeof slug === "string" && /^[a-z0-9-]{1,40}$/.test(slug);

export const unknownFormat = (v: unknown): string =>
  `format v${typeof v === "number" || typeof v === "string" ? String(v).slice(0, 8) : "?"} non lu, mettre à jour kodflow-hud`;

const num = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isFinite(x) ? x : undefined;
const str = (x: unknown): string | undefined =>
  typeof x === "string" ? x : undefined;
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

function json(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** One hunt of active.json: slug, created, the mirrored state and beat. */
type Entry = { slug: string; created: number; state: string; beat?: number };

/**
 * active.json: the hunts listed, or why it cannot be read. Absent is no
 * hunt at all; a torn or foreign file is a problem the view says.
 */
export function parseActive(
  text: string | undefined,
): { entries: Entry[] } | { problem: string } {
  if (text === undefined) return { entries: [] };
  const raw = json(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { problem: UNREADABLE };
  const o = raw as Record<string, unknown>;
  if (o.v !== HUNT_V) return { problem: unknownFormat(o.v) };
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const h of arr(o.hunts)) {
    const e = obj(h);
    const slug = str(e.slug);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const beat = num(e.beat);
    entries.push({
      slug,
      created: num(e.created) ?? 0,
      state: str(e.state) ?? "",
      ...(beat !== undefined && { beat }),
    });
    if (entries.length >= MAX_HUNTS) break;
  }
  return { entries };
}

const count = (x: unknown): number => Math.max(0, Math.floor(num(x) ?? 0));

/**
 * A status.json: the snapshot, or why not (torn, of an unknown version).
 * Unknown fields are left aside; a field of the wrong type reads as absent.
 */
export function parseStatus(
  text: string | undefined,
): { status: HudHuntStatus } | { problem: string } {
  const raw = json(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { problem: UNREADABLE };
  const o = raw as Record<string, unknown>;
  if (o.v !== HUNT_V) return { problem: unknownFormat(o.v) };
  const seq = num(o.seq);
  if (seq === undefined || typeof o.state !== "string")
    return { problem: UNREADABLE };
  const counter = obj(o.counter);
  const pass = obj(o.pass);
  const queue = obj(o.queue);
  const tip = obj(o.tip);
  const codex = obj(o.codex);
  const pause = o.pause === null ? undefined : obj(o.pause);
  const busy = o.busy === null ? undefined : obj(o.busy);
  const events: HudHuntEvent[] = arr(o.events)
    .map(obj)
    .filter((e) => num(e.seq) !== undefined && typeof e.kind === "string")
    .map((e) => ({
      seq: num(e.seq)!,
      kind: String(e.kind),
      text: str(e.text) ?? "",
    }));
  const status: HudHuntStatus = {
    seq,
    state: o.state,
    ...(pause && {
      pause: {
        reason: str(pause.reason) ?? "",
        ...(num(pause.since) !== undefined && { since: num(pause.since) }),
      },
    }),
    counter: {
      open: count(counter.open),
      cap: count(counter.cap),
      ...(num(counter.resume_at) !== undefined && {
        resumeAt: num(counter.resume_at),
      }),
    },
    pass: {
      n: count(pass.n),
      ...(str(pass.sha) && { sha: str(pass.sha) }),
      done: count(pass.cells_done),
      total: count(pass.cells_total),
    },
    queue: {
      tokens: count(queue.tokens_total),
      holders: arr(queue.holders)
        .map(obj)
        .map((h) => ({
          slug: str(h.slug) ?? "",
          label: str(h.label) ?? "",
          ...(num(h.since) !== undefined && { since: num(h.since) }),
          exclusive: h.exclusive === true,
        })),
      waiting: arr(queue.waiting)
        .map(obj)
        .map((w) => ({
          slug: str(w.slug) ?? "",
          label: str(w.label) ?? "",
          ...(num(w.since) !== undefined && { since: num(w.since) }),
        })),
    },
    tip: {
      ...(str(tip.sha) && { sha: str(tip.sha) }),
      ...(num(tip.bundle_at) !== undefined && { bundleAt: num(tip.bundle_at) }),
    },
    codex: {
      pending: count(codex.pending),
      done: count(codex.done),
      skipped: count(codex.skipped),
      abandoned: count(codex.abandoned),
    },
    decisions: arr(o.decisions)
      .map(obj)
      .map((d) => ({
        repo: str(d.repo) ?? "",
        issue:
          num(d.issue) !== undefined ? String(d.issue) : (str(d.issue) ?? ""),
        title: str(d.title) ?? "",
      })),
    ...(num(o.beat) !== undefined && { beat: num(o.beat) }),
    ...(busy && {
      busy: {
        ...(num(busy.since) !== undefined && { since: num(busy.since) }),
        ...(num(busy.deadline) !== undefined && {
          deadline: num(busy.deadline),
        }),
      },
    }),
    notifyFailed: o.notify_failed === true,
    events,
  };
  return { status };
}

/**
 * What one poll read, put together: active.json's text, then each listed
 * slug's status.json text (undefined when it could not be read).
 */
export function readHunt(
  activeText: string | undefined,
  statusText: (slug: string) => string | undefined,
): HudHunt {
  const a = parseActive(activeText);
  if ("problem" in a) return { found: true, problem: a.problem, runs: [] };
  if (!a.entries.length) return NO_HUNT;
  const runs: HudHuntRun[] = a.entries.map((e) => {
    const s = parseStatus(statusText(e.slug));
    return "status" in s
      ? { ...e, status: s.status }
      : { ...e, problem: s.problem };
  });
  return { found: true, runs };
}

/** The slugs active.json lists, as the poll reads their status.json. */
export function slugsOf(activeText: string | undefined): string[] {
  const a = parseActive(activeText);
  return "entries" in a ? a.entries.map((e) => e.slug) : [];
}

// --- judged at draw time -------------------------------------------------------

export type Flags = { stalled: boolean; orphan: boolean; busy: boolean };

/**
 * « figée »: an active state, the beat older than STALL_MS and no job of
 * the hunt running (a job past its deadline counts as none). « orpheline
 * probable »: the same with a beat older than ORPHAN_MS, or the watchdog's
 * last word was that the owner is gone.
 */
export function flagsOf(run: HudHuntRun, now: number): Flags {
  const s = run.status;
  const state = s?.state ?? run.state;
  const busy =
    !!s?.busy && (s.busy.deadline === undefined || s.busy.deadline >= now);
  if (!ACTIVE_STATES.includes(state))
    return { stalled: false, orphan: false, busy };
  const beats = [s?.beat, run.beat].filter(
    (b): b is number => typeof b === "number",
  );
  const beat = beats.length ? Math.max(...beats) : undefined;
  const age = beat === undefined ? 0 : now - beat;
  const last = s?.events[s.events.length - 1];
  const ownerGone =
    last?.kind === "stall" && /propriétaire mort/.test(last.text);
  const orphan = ownerGone || (!busy && age > ORPHAN_MS);
  return { stalled: orphan || (!busy && age > STALL_MS), orphan, busy };
}

const STATE_FR: Record<string, string> = {
  hunting: "chasse",
  frozen: "gel",
  "final-pass": "passe finale",
  pushing: "push",
  "awaiting-merge": "attente du merge",
  paused: "pause",
  done: "terminée",
};
export const stateFr = (state: string): string => STATE_FR[state] ?? state;

const KIND_FR: Record<string, string> = {
  confirmed: "confirmée",
  "integrate-fail": "intégration rejetée",
  "integrate-ok": "intégrée",
  label: "étiquette",
  "tip-after": "bout",
  decision: "décision",
  "pass-start": "passe",
  "pass-end": "fin de passe",
  pause: "pause",
  resume: "reprise",
  converged: "convergence",
  "mr-opened": "MR ouverte",
  push: "push",
  stall: "figée",
  state: "état",
  closed: "fermée",
  teardown: "fin",
};
export const kindFr = (kind: string): string => KIND_FR[kind] ?? kind;

/**
 * The tab's label, one width whatever the figures (« Chasse 7/10 » then
 * figure spaces): the busiest hunt's counter, « ×N » for several. Narrow,
 * the name alone.
 */
export const HUNT_TAB_CELLS = 15; // « Chasse 99/99 ×9 »
export function huntTab(hunt: HudHunt, narrow = false): string | undefined {
  if (!hunt.found) return undefined;
  if (narrow) return "Chasse";
  const read = hunt.runs.filter((r) => r.status);
  const top = read.sort(
    (a, b) => b.status!.counter.open - a.status!.counter.open,
  )[0];
  const n = Math.min(9, hunt.runs.length);
  const c = (k: number) => String(Math.min(99, k));
  const label = top
    ? `Chasse ${c(top.status!.counter.open)}/${c(top.status!.counter.cap)}${n > 1 ? ` ×${n}` : ""}`
    : `Chasse ?${n > 1 ? ` ×${n}` : ""}`;
  return label + " ".repeat(Math.max(0, HUNT_TAB_CELLS - label.length));
}

/** What « reprendre » drafts in the prompt box, never sent. */
export const resumePrompt = (slug: string): string => `/hunt --resume ${slug}`;

/** A slug « reprendre » may draft for: listed, and probably orphaned. */
export function canResume(hunt: HudHunt, slug: unknown, now: number): boolean {
  if (!goodSlug(slug)) return false;
  const run = hunt.runs.find((r) => r.slug === slug);
  return !!run && flagsOf(run, now).orphan;
}

// --- toasts ----------------------------------------------------------------------

/**
 * The toasts this read is worth, and the cursor after it. A hunt never seen
 * is the reference (silent); a lower seq than the cursor is ignored; a new
 * `created` resets the cursor to zero. Kinds /hunt notifies itself are not
 * toasted. At most `TOASTS_PER_POLL`, then one « +N autres ».
 */
export function huntToasts(
  hunt: HudHunt,
  cursor: HudHuntCursor,
): { toasts: string[]; cursor: HudHuntCursor } {
  const next: HudHuntCursor = {};
  const lines: string[] = [];
  for (const run of hunt.runs) {
    const before = cursor[run.slug];
    const s = run.status;
    if (!s) {
      if (before) next[run.slug] = before;
      continue;
    }
    if (!before) {
      next[run.slug] = { created: run.created, seq: s.seq };
      continue;
    }
    const from = before.created === run.created ? before.seq : 0;
    if (s.seq < from) {
      next[run.slug] = before;
      continue;
    }
    for (const e of s.events)
      if (e.seq > from && !ACT_NOW.includes(e.kind))
        lines.push(
          `Chasse ${run.slug} · ${kindFr(e.kind)}${e.text ? ` : ${e.text}` : ""}`,
        );
    next[run.slug] = { created: run.created, seq: s.seq };
  }
  const toasts = lines.slice(0, TOASTS_PER_POLL);
  if (lines.length > TOASTS_PER_POLL)
    toasts.push(`Chasse : +${lines.length - TOASTS_PER_POLL} autres`);
  return { toasts, cursor: next };
}
