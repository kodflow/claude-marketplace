// view.ts — what the « Tâches » pane draws: `viewScreen`, the one entry the
// surface module and the hooks module both draw from, the tree's message
// when there is no list, and the « Chasse » view. Pure: no `$`.
//
// « Chasse »: /hunt's runs as active.json and each status.json say (hunt.ts),
// one section a hunt; a tab, and the bar with it, only while a hunt is
// listed. « reprendre », on a hunt probably orphaned, asks for
// `/hunt --resume <slug>` in the prompt box, never sent.

import type { HudHunt, HudHuntRun } from "../../types";
import type { TreeModel } from "./tree.ts";
import {
  NO_HUNT,
  ORPHAN_MS,
  STALL_MS,
  flagsOf,
  huntTab,
  kindFr,
  stateFr,
} from "./hunt.ts";
import {
  AMBER,
  BLUE,
  MAUVE,
  RED,
  W,
  YOU,
  cell,
  dim,
  rule,
  screenOf,
  span,
  tabsLines,
  type Act,
  type BarCounts,
  type Cell,
  type Screen,
  type Span,
  type Ui,
} from "./layout.tsx";
import { cells } from "./width.ts";

/** What the views read beside the tree: handed down with it. */
export type Extra = {
  now: number;
  /** Absent from an older caller: no hunt, no « Chasse » tab. */
  hunt?: HudHunt;
  /**
   * The fault seam, inert unless KODFLOW_HUD_FAULT_PROBE=1: the key « ! »
   * then makes the Client draw past the engine's 100,000 characters, which
   * fails it for real (fault.test.tsx). Never set otherwise.
   */
  faultProbe?: boolean;
};

export const NO_EXTRA: Extra = { now: 0, hunt: NO_HUNT };

/** « Chasse »'s label in the bar while a hunt is listed; nothing else counts. */
export function countsOf(extra: Extra): BarCounts {
  const hunt = extra.hunt ? huntTab(extra.hunt) : undefined;
  return hunt ? { hunt } : {};
}

/** « 14:05 », local time, from milliseconds. */
export function hhmm(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The view the person chose, or the tree's message. */
export function viewScreen(
  model: TreeModel,
  ui: Ui,
  width: number,
  rows: number,
  extra: Extra = NO_EXTRA,
): Screen | string {
  const counts = countsOf(extra);
  // « Chasse » gone while shown (the hunt ended): the tree, as tab would
  if (ui.view === "hunt" && !counts.hunt) ui = { ...ui, view: "tree" };
  if (ui.view === "hunt")
    return huntScreen(
      extra.hunt ?? NO_HUNT,
      ui,
      width,
      rows,
      counts,
      extra.now,
    );
  const s = screenOf(model, ui, width, rows, counts);
  // No tree: its message, and the bar while a hunt keeps « Chasse » reachable
  if (typeof s !== "string" || rows < 4 || !counts.hunt) return s;
  return messageScreen(s, ui, width, rows, counts);
}

export function messageScreen(
  text: string,
  ui: Ui,
  width: number,
  rows: number,
  counts: BarCounts,
): Screen {
  const lines: Cell[][] = [[cell(width, [dim(text)])]];
  while (lines.length < rows - 2) lines.push([cell(width)]);
  const t = tabsLines(ui.view, width, counts);
  lines.push(t.lines[0]!, t.lines[1]!);
  return {
    lines,
    rowIds: lines.map(() => undefined),
    tabsLine: rows - 1,
    tabs: t.tabs,
    order: [],
    list: { top: 0, rows: 0 },
  };
}

function titleOf(what: Span[], width: number): Cell[] {
  const used = 2;
  const text = what.map((s) => s.text).join("");
  const w = Math.min(cells(text), Math.max(0, width - used - 2));
  const out: Cell[] = [cell(2, [dim("─ ")]), cell(w, what)];
  const rest = Math.max(0, width - used - w);
  if (rest > 1) out.push(cell(1), cell(rest - 1, [dim("─".repeat(rest - 1))]));
  return out;
}

/**
 * Where a list of `keys` starts in `space` lines: from the top, or so the
 * chosen one stays on the line it was acted on (`pin`), else in view.
 */
function startOf(
  keys: string[],
  sel: string | undefined,
  pin: Ui["ppin"],
  top: number,
  space: number,
): number {
  if (keys.length <= space) return 0;
  const at = sel === undefined ? -1 : keys.indexOf(sel);
  if (at < 0) return 0;
  const want =
    pin?.id === sel ? at - (pin!.y - top) : at < space ? 0 : at - space + 1;
  return Math.max(0, Math.min(keys.length - space, want));
}

/** Lays a view out: head lines, the list, two foot lines, then the bar. */
function frame(
  head: Cell[][],
  list: { line: Cell[]; key: string }[],
  foot: Cell[][],
  footButtons: { line: number; x: number; w: number; act: Act }[],
  rowButtons: Map<string, { x: number; w: number; act: Act }[]>,
  sel: string | undefined,
  pin: Ui["ppin"],
  view: Ui["view"],
  width: number,
  rows: number,
  counts: BarCounts,
  empty: string,
): Screen {
  const bar = rows >= 6 && counts.hunt ? 2 : 0;
  const footN = rows >= 8 ? foot.length + 1 : 0;
  const headN = Math.min(head.length, Math.max(0, rows - bar - footN - 1));
  const space = Math.max(0, rows - headN - footN - bar);
  const keys = list.map((l) => l.key);
  const start = startOf(keys, sel, pin, headN, space);
  const shown = list.slice(start, start + space);

  const lines: Cell[][] = [];
  const rowIds: (string | undefined)[] = [];
  const buttons: NonNullable<Screen["buttons"]> = [];
  const push = (line: Cell[], id?: string) => {
    lines.push(line);
    rowIds.push(id);
  };
  for (const h of head.slice(0, headN)) push(h);
  for (const l of shown) {
    for (const b of rowButtons.get(l.key) ?? [])
      buttons.push({ y: lines.length, ...b });
    push(l.line, l.key);
  }
  if (!list.length && space) push([cell(width, [dim(empty)])]);
  while (lines.length < headN + space) push([cell(width)]);
  if (footN) {
    push(rule(width, "┄"));
    const base = lines.length;
    for (const f of foot) push(f);
    for (const b of footButtons)
      buttons.push({ y: base + b.line, x: b.x, w: b.w, act: b.act });
  }
  let tabsLine = -1;
  let tabs: Screen["tabs"] = [];
  if (bar) {
    const t = tabsLines(view, width, counts);
    push(t.lines[0]!);
    tabsLine = lines.length;
    push(t.lines[1]!);
    tabs = t.tabs;
  }
  return {
    lines,
    rowIds,
    tabsLine,
    tabs,
    buttons,
    order: keys,
    list: { top: headN, rows: space },
  };
}

// --- « Chasse » ---------------------------------------------------------------------

/** « il y a 12 min », « il y a 2 h 05 », from a time in milliseconds. */
export function ago(now: number, at: number | undefined): string {
  if (at === undefined) return "jamais";
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  return m < 1 ? "à l'instant" : `il y a ${minutes(m)}`;
}

/** « 12 min », « 2 h 05 ». */
const minutes = (m: number): string =>
  m < 120
    ? `${m} min`
    : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;

const short = (sha: string | undefined): string =>
  sha ? sha.slice(0, 12) : "—";
const plural = (n: number, one: string, many: string): string =>
  `${n} ${n > 1 ? many : one}`;

/** A list line's key: the hunt's slug, then the line's rank in its section. */
export const huntKey = (slug: string, i: number): string => `${slug}#${i}`;
export const slugOfKey = (key: string): string =>
  key.slice(0, Math.max(0, key.lastIndexOf("#")));

/** The digest's events: those after the last time the view was left. */
export function digestOf(
  run: HudHuntRun,
  since: Record<string, number> | undefined,
): { seq: number; kind: string; text: string }[] {
  const from = since?.[run.slug] ?? 0;
  return (run.status?.events ?? []).filter((e) => e.seq > from).slice(-8);
}

const LABEL = 13;

/** One hunt: its head line (glyph, slug, state, flags, « reprendre »), then its rows. */
function huntLines(
  run: HudHuntRun,
  ui: Ui,
  width: number,
  now: number,
): { lines: Cell[][]; button?: { x: number; w: number; act: Act } } {
  const s = run.status;
  const f = flagsOf(run, now);
  const head: Span[] = [
    span(f.stalled ? "◆ " : "● ", { color: f.stalled ? RED : AMBER }),
    span(run.slug, { bold: true }),
    dim(" · "),
    span(stateFr(s?.state ?? run.state), { color: MAUVE }),
  ];
  if (f.orphan)
    head.push(
      dim(" · "),
      span("orpheline probable", { color: RED, bold: true }),
    );
  else if (f.stalled)
    head.push(dim(" · "), span("figée", { color: RED, bold: true }));
  const resume = "[reprendre]";
  const btnW = f.orphan ? cells(resume) : 0;
  const first: Cell[] = [cell(Math.max(0, width - btnW), head)];
  let button: { x: number; w: number; act: Act } | undefined;
  if (btnW && width > btnW) {
    first.push(cell(btnW, [span(resume, { color: MAUVE, bold: true })]));
    button = {
      x: width - btnW,
      w: btnW,
      act: { op: "resume", slug: run.slug },
    };
  }
  const lines: Cell[][] = [first];
  const row = (label: string, value: Span[]) =>
    lines.push([
      cell(2),
      cell(LABEL, [dim(label)]),
      cell(Math.max(0, width - 2 - LABEL), value),
    ]);
  if (!s) {
    row("état", [span(run.problem ?? "état illisible", { color: RED })]);
    return { lines, button };
  }
  if (s.pause)
    row("pause", [
      span(s.pause.reason || "sans raison", { color: YOU }),
      dim(s.pause.since === undefined ? "" : ` depuis ${hhmm(s.pause.since)}`),
    ]);
  row("compteur", [
    span(`${s.counter.open}/${s.counter.cap}`, { bold: true }),
    dim(
      ` ouvertes${s.counter.resumeAt === undefined ? "" : ` · reprise à ${s.counter.resumeAt}`}`,
    ),
  ]);
  row("passe", [
    span(`n°${s.pass.n}`),
    dim(` · ${short(s.pass.sha)} · `),
    span(`${s.pass.done}/${s.pass.total}`),
    dim(" cases"),
  ]);
  const holders = s.queue.holders.map(
    (h) =>
      `${h.slug || "hors chasse"}${h.label ? ` « ${h.label} »` : ""}${h.exclusive ? " (exclusif)" : ""}`,
  );
  row("file lourde", [
    dim(`${plural(s.queue.tokens, "jeton", "jetons")} · `),
    span(holders.length ? holders.join(", ") : "aucun job"),
  ]);
  if (s.queue.waiting.length)
    row("en attente", [
      span(
        s.queue.waiting
          .map(
            (w) =>
              `${w.slug || "hors chasse"}${w.label ? ` « ${w.label} »` : ""}`,
          )
          .join(", "),
      ),
      dim(
        s.queue.waiting[0]!.since === undefined
          ? ""
          : ` · depuis ${hhmm(s.queue.waiting[0]!.since)}`,
      ),
    ]);
  row("bout", [
    span(short(s.tip.sha), { color: BLUE }),
    dim(
      s.tip.bundleAt === undefined ? "" : ` · bundle ${hhmm(s.tip.bundleAt)}`,
    ),
  ]);
  row("Codex", [
    span(
      `${s.codex.pending} en attente`,
      s.codex.pending ? { color: AMBER } : { dim: true },
    ),
    dim(
      ` · ${plural(s.codex.done, "faite", "faites")} · ${plural(s.codex.skipped, "sautée", "sautées")} · ${plural(s.codex.abandoned, "abandonnée", "abandonnées")}`,
    ),
  ]);
  if (!s.decisions.length) row("décisions", [dim("aucune")]);
  s.decisions
    .slice(0, 5)
    .forEach((d, i) =>
      row(i ? "" : "décisions", [
        span(`${d.repo}#${d.issue}`, { color: YOU }),
        span(` ${d.title}`),
      ]),
    );
  row("battement", [
    span(
      ago(now, s.beat ?? run.beat),
      f.stalled ? { color: RED, bold: true } : {},
    ),
    dim(
      f.busy && s.busy?.since !== undefined
        ? ` · job en cours depuis ${hhmm(s.busy.since)}`
        : "",
    ),
  ]);
  if (s.notifyFailed)
    row("notification", [
      span("en échec", { color: RED, bold: true }),
      dim(" · le watchdog réessaie"),
    ]);
  const news = digestOf(run, ui.hsince);
  if (!news.length) row("nouveau", [dim("rien depuis ta dernière visite")]);
  news.forEach((e, i) =>
    row(i ? "" : "nouveau", [
      dim(`#${e.seq} `),
      span(kindFr(e.kind), { color: MAUVE }),
      span(e.text ? ` ${e.text}` : ""),
    ]),
  );
  return { lines, button };
}

/** The « Chasse » view, `width` cells by `rows` lines. */
export function huntScreen(
  hunt: HudHunt,
  ui: Ui,
  width: number,
  rows: number,
  counts: BarCounts,
  now: number,
): Screen {
  const n = hunt.runs.length;
  const head: Cell[][] = [
    titleOf(
      [
        span("Chasse", { color: MAUVE }),
        dim(n ? ` · ${plural(n, "chasse listée", "chasses listées")}` : ""),
      ],
      width,
    ),
  ];
  const list: { line: Cell[]; key: string }[] = [];
  const rowButtons = new Map<string, { x: number; w: number; act: Act }[]>();
  if (hunt.problem)
    list.push({
      line: [
        cell(width, [span(`active.json : ${hunt.problem}`, { color: RED })]),
      ],
      key: huntKey("", 0),
    });
  hunt.runs.forEach((run, r) => {
    const { lines, button } = huntLines(run, ui, width, now);
    if (r) list.push({ line: [cell(width)], key: huntKey(run.slug, -1) });
    lines.forEach((line, i) => {
      const key = huntKey(run.slug, i);
      if (!i && button) rowButtons.set(key, [button]);
      list.push({ line, key });
    });
  });
  const orphan = hunt.runs.find((r) => flagsOf(r, now).orphan);
  const foot: Cell[][] = [
    [
      cell(width, [
        dim(
          orphan
            ? `« reprendre » pose /hunt --resume ${orphan.slug} en brouillon, jamais envoyé ; le préflight décide`
            : "Lecture seule : active.json et status.json de /hunt, jamais son journal",
        ),
      ]),
    ],
    [
      cell(W.gap),
      cell(Math.max(0, width - W.gap), [
        dim(
          `figée : aucun progrès depuis ${minutes(STALL_MS / 60_000)} hors job en cours · orpheline probable : ${minutes(ORPHAN_MS / 60_000)}`,
        ),
      ]),
    ],
  ];
  return frame(
    head,
    list,
    foot,
    [],
    rowButtons,
    ui.hsel,
    ui.ppin,
    "hunt",
    width,
    rows,
    counts,
    "Aucune chasse en cours.",
  );
}
