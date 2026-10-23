// panels.ts — the « Refus » and « Documents » views of the « Tâches » pane,
// laid out cell by cell as layout.tsx lays out the tree, and `viewScreen`,
// the one entry both the surface module and the hooks module draw from.
// Pure: no `$`.
//
// « Refus »: what kodflow-hooks refused (blocks.jsonl), newest first, under
// what has piled up in the last hour and since the session began. A refusal
// that carries the permission rule that would have allowed it shows the
// rule; a click shows it again on the confirmation line, and only a second
// click, on « ajouter », asks the hooks module to write it.
//
// « Documents »: the project's documents as docs.json says (● present, ●
// missing, ○ ignored). A click on a line ignores it or brings it back; «
// créer » and « Créer les manquants » ask for the docs prompt in the prompt
// box, never sent.

import type { HudBlock, HudDoc, HudDocs } from "../../types";
import type { TreeModel } from "./tree.ts";
import { MODES, missingOf } from "./docs.ts";
import { HOUR_MS, hhmm, tally } from "./refusals.ts";
import {
  BLUE,
  GREEN,
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

/** What the two views read beside the tree: handed down with it. */
export type Extra = { docs: HudDocs; blocks: HudBlock[]; now: number };

export const NO_EXTRA: Extra = {
  docs: { found: false, docs: [] },
  blocks: [],
  now: 0,
};

export const SETTINGS_LOCAL = ".claude/settings.local.json";

/** The bar's counts: the refusals of the last hour, the documents missing. */
export function countsOf(extra: Extra): BarCounts {
  return {
    blocks: extra.blocks.filter((b) => extra.now - b.at < HOUR_MS).length,
    docs: missingOf(extra.docs).length,
  };
}

/** A refusal's key: what a selection holds across redraws. */
export const blockKey = (b: HudBlock): string =>
  `${b.ts}|${b.kind}|${b.tool ?? ""}|${b.summary}`;

/** The view the person chose, every view, or the tree's message. */
export function viewScreen(
  model: TreeModel,
  ui: Ui,
  width: number,
  rows: number,
  extra: Extra = NO_EXTRA,
): Screen | string {
  const counts = countsOf(extra);
  if (ui.view === "blocks") return blocksScreen(extra, ui, width, rows, counts);
  if (ui.view === "docs")
    return docsScreen(extra.docs, ui, width, rows, counts);
  const s = screenOf(model, ui, width, rows, counts);
  // No tree: its message, and the bar, so the two other views stay reachable
  if (typeof s !== "string" || rows < 4) return s;
  return messageScreen(s, ui, width, rows, counts);
}

function messageScreen(
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
  const bar = rows >= 6 ? 2 : 0;
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

/** A line of buttons and text, with where each button sits. */
function buttonLine(
  parts: (Span | { button: string; act: Act; style?: Omit<Span, "text"> })[],
  width: number,
): { line: Cell[]; buttons: { x: number; w: number; act: Act }[] } {
  const line: Cell[] = [];
  const buttons: { x: number; w: number; act: Act }[] = [];
  let x = 0;
  for (const p of parts) {
    const text = "button" in p ? p.button : p.text;
    const w = Math.min(cells(text), Math.max(0, width - x));
    if (!w) break;
    if ("button" in p) {
      line.push(cell(w, [span(text, p.style ?? { color: MAUVE })]));
      buttons.push({ x, w, act: p.act });
    } else line.push(cell(w, [p]));
    x += w;
  }
  if (width - x > 0) line.push(cell(width - x));
  return { line, buttons };
}

// --- « Refus » -----------------------------------------------------------------------

const KIND_TONE: Record<string, Omit<Span, "text">> = {
  hook: { color: RED },
  classifier: { color: YOU },
  permission: { color: YOU },
  ci: { color: RED },
  agent: { dim: true },
};

function countSpans(by: Record<string, number>): Span[] {
  const kinds = Object.keys(by).filter((k) => by[k]);
  if (!kinds.length) return [dim("aucun")];
  const out: Span[] = [];
  kinds
    .sort((a, b) => by[b]! - by[a]!)
    .forEach((k, i) => {
      if (i) out.push(dim(" · "));
      out.push(span(`${k} ${by[k]}`, KIND_TONE[k] ?? {}));
    });
  return out;
}

/** The « Refus » view, `width` cells by `rows` lines. */
export function blocksScreen(
  extra: Extra,
  ui: Ui,
  width: number,
  rows: number,
  counts: BarCounts,
): Screen {
  const t = tally(extra.blocks, extra.now);
  const head: Cell[][] = [
    titleOf(
      [
        span("Refus", { color: MAUVE }),
        dim(
          ` · ${t.hourTotal} dans la dernière heure, ${t.total} depuis le début`,
        ),
      ],
      width,
    ),
    [cell(16, [dim("dernière heure")]), cell(width - 16, countSpans(t.hour))],
    [cell(16, [dim("session")]), cell(width - 16, countSpans(t.all))],
    [
      cell(width, [
        dim("motif le plus fréquent  "),
        ...(t.top
          ? [span(t.top.what, { bold: true }), dim(` ×${t.top.n}`)]
          : [dim("aucun")]),
      ]),
    ],
  ];
  const showTool = width >= 60;
  const ruleW = width >= 76 ? Math.min(28, Math.floor(width / 3)) : 0;
  const fixed = 5 + W.gap + 10 + W.gap + (showTool ? 10 + W.gap : 0);
  const sumW = Math.max(4, width - fixed - (ruleW ? ruleW + W.gap : 0));
  const header: Cell[] = [
    cell(5, [dim("HEURE")]),
    cell(W.gap),
    cell(10, [dim("TYPE")]),
    cell(W.gap),
    ...(showTool ? [cell(10, [dim("OUTIL")]), cell(W.gap)] : []),
    cell(sumW, [dim("RÉSUMÉ")]),
    ...(ruleW ? [cell(W.gap), cell(ruleW, [dim("RÈGLE")])] : []),
  ];
  head.push(header);

  const list = extra.blocks.map((b) => {
    const key = blockKey(b);
    const chosen = key === ui.bsel;
    const line: Cell[] = [
      cell(5, [dim(hhmm(b.at))]),
      cell(W.gap),
      cell(10, [span(b.kind, KIND_TONE[b.kind] ?? {})]),
      cell(W.gap),
      ...(showTool
        ? [cell(10, [span(b.tool ?? "—", { dim: !b.tool })]), cell(W.gap)]
        : []),
      cell(sumW, [
        span(b.summary || b.motif || "", chosen ? { underline: true } : {}),
      ]),
      ...(ruleW
        ? [
            cell(W.gap),
            cell(ruleW, b.rule ? [span(b.rule, { color: BLUE })] : []),
          ]
        : []),
    ];
    return { line, key };
  });

  const chosen = extra.blocks.find((b) => blockKey(b) === ui.bsel);
  const foot: Cell[][] = [];
  const footButtons: { line: number; x: number; w: number; act: Act }[] = [];
  if (ui.pick) {
    foot.push([
      cell(width, [
        span("Autoriser  ", { bold: true }),
        span(ui.pick, { color: BLUE, bold: true }),
        dim(`  dans ${SETTINGS_LOCAL} ?`),
      ]),
    ]);
    const b = buttonLine(
      [
        {
          button: "[ajouter]",
          act: { op: "allow", rule: ui.pick },
          style: { color: GREEN, bold: true },
        },
        dim("  "),
        { button: "[copier]", act: { op: "copy", rule: ui.pick } },
        dim("  "),
        { button: "[annuler]", act: { op: "cancel" }, style: { dim: true } },
        dim("   a · c · n"),
      ],
      width,
    );
    foot.push(b.line);
    for (const x of b.buttons) footButtons.push({ line: 1, ...x });
  } else if (chosen) {
    const who = [chosen.tool, chosen.agent, chosen.motif]
      .filter(Boolean)
      .join(" · ");
    foot.push([
      cell(width, [
        span(
          `${hhmm(chosen.at)}  ${chosen.kind}  `,
          KIND_TONE[chosen.kind] ?? {},
        ),
        span(chosen.summary, { bold: true }),
        dim(who ? `   ${who}` : ""),
      ]),
    ]);
    foot.push([
      cell(W.gap),
      cell(
        Math.max(0, width - W.gap),
        chosen.rule
          ? [
              dim("⏎ ou clic : autoriser "),
              span(chosen.rule, { color: BLUE }),
              dim(", après confirmation"),
            ]
          : [
              dim(
                chosen.ref ??
                  "Aucune règle de permission déduite pour ce refus",
              ),
            ],
      ),
    ]);
  } else {
    foot.push([cell(width, [dim("Aucun refus choisi")])]);
    foot.push([
      cell(W.gap),
      cell(Math.max(0, width - W.gap), [
        dim(
          "Un refus qui porte une règle : clic, puis « ajouter » pour l'autoriser",
        ),
      ]),
    ]);
  }
  return frame(
    head,
    list,
    foot,
    footButtons,
    new Map(),
    ui.bsel,
    ui.ppin,
    "blocks",
    width,
    rows,
    counts,
    "Aucun refus dans cette session.",
  );
}

// --- « Documents » ---------------------------------------------------------------------

const DOC_GLYPH: Record<HudDoc["state"], Span> = {
  ok: { text: "●", color: GREEN },
  missing: { text: "●", color: RED },
  ignored: { text: "○", dim: true },
};

/** The « Documents » view, `width` cells by `rows` lines. */
export function docsScreen(
  docs: HudDocs,
  ui: Ui,
  width: number,
  rows: number,
  counts: BarCounts,
): Screen {
  const missing = missingOf(docs);
  const n = (s: HudDoc["state"]) =>
    docs.docs.filter((d) => d.state === s).length;
  const head: Cell[][] = [
    titleOf(
      [
        span("Documents", { color: MAUVE }),
        dim(
          docs.found
            ? ` · ${missing.length} manquant${missing.length > 1 ? "s" : ""} · ${n("ignored")} ignoré${n("ignored") > 1 ? "s" : ""} · ${n("ok")} présent${n("ok") > 1 ? "s" : ""}`
            : "",
        ),
      ],
      width,
    ),
  ];
  const nameW = Math.min(26, Math.max(8, Math.floor((width - 2) / 3)));
  const btnW = 7; // « [créer] »
  const pathW = Math.max(4, width - 2 - nameW - W.gap - W.gap - btnW);
  head.push([
    cell(2),
    cell(nameW, [dim("DOCUMENT")]),
    cell(W.gap),
    cell(pathW, [dim("CHEMIN")]),
  ]);

  const rowButtons = new Map<string, { x: number; w: number; act: Act }[]>();
  const list = docs.docs.map((d) => {
    const key = d.id;
    const chosen = key === ui.dsel;
    const path: Span[] = [
      span(d.path, d.state === "ignored" ? { dim: true } : {}),
    ];
    if (d.state === "ignored")
      path.push(dim(d.reason ? `  ignoré : ${d.reason}` : "  ignoré"));
    const line: Cell[] = [
      cell(2, [DOC_GLYPH[d.state]]),
      cell(nameW, [
        span(d.name, {
          ...(d.state === "ignored" && { dim: true }),
          ...(chosen && { underline: true }),
        }),
      ]),
      cell(W.gap),
      cell(pathW, path),
      cell(W.gap),
    ];
    if (d.state === "missing") {
      line.push(cell(btnW, [span("[créer]", { color: MAUVE })]));
      rowButtons.set(key, [
        { x: width - btnW, w: btnW, act: { op: "create", ids: [d.id] } },
      ]);
    } else line.push(cell(btnW));
    return { line, key };
  });

  const mode = ui.mode ?? "both";
  const all = missing.length
    ? `[Créer les manquants (${missing.length})]`
    : "Aucun document manquant";
  const parts: Parameters<typeof buttonLine>[0] = [
    missing.length
      ? {
          button: all,
          act: { op: "create", ids: [] },
          style: { color: MAUVE, bold: true },
        }
      : dim(all),
    dim("   mode  "),
  ];
  MODES.forEach((m, i) => {
    if (i) parts.push(dim(" · "));
    parts.push({
      button: m,
      act: { op: "mode", mode: m },
      style:
        m === mode
          ? { color: MAUVE, bold: true, underline: true }
          : { dim: true },
    });
  });
  const b = buttonLine(parts, width);
  const chosen = docs.docs.find((d) => d.id === ui.dsel);
  const foot: Cell[][] = [
    b.line,
    [
      cell(W.gap),
      cell(
        Math.max(0, width - W.gap),
        chosen?.why
          ? [dim(`${chosen.name} : ${chosen.why}`)]
          : [
              dim(
                "Clic : ignorer ou rétablir · le brouillon n'est jamais envoyé seul",
              ),
            ],
      ),
    ],
  ];
  return frame(
    head,
    list,
    foot,
    b.buttons.map((x) => ({ line: 0, ...x })),
    rowButtons,
    ui.dsel,
    ui.ppin,
    "docs",
    width,
    rows,
    counts,
    docs.found
      ? "Aucun document dans docs.json."
      : "Pas de docs.json pour cette session (kodflow-hooks le tient, dans un dépôt git).",
  );
}
