// layout.tsx — the « Tâches » pane's two views, laid out cell by cell.
// Pure: no `$`. The surface module (client.tsx) draws them with its own
// elements and keeps the selection; a surface with no `Client` gets the same
// screen, still, from the hooks module.
//
// Alignment is the point. A screen is a list of lines, a line a row of cells
// of a fixed width each, and every cell becomes a Box of exactly that width:
// nothing is lined up with padding spaces, and what goes in a cell is cut to
// it first, measured in terminal cells (width.ts), so a wide glyph never
// shifts the next column. No cell paints a background: colour is the text's
// alone, so a transparent terminal shows through everywhere.
//
// R12, the tree, at its full width (88 cells of body, 90 with the frame):
//   margin 2 · tree 30 (3 a level, glyph 2, ref 7, title 18) · agent 22 ·
//   model·effort 10 · age 6 (right) · links 10, a gap of 2 between them.
// The agent column names who works the task: « ◉ principal » in the theme's
// colour, « ↳ name · role » in the subagent's own (who.ts), « toi », « prête ».
// Narrower, the links go first (under 88), then the model (under 76), then
// the agent (under 64); the tree and the age stay. On 20 rows: title,
// headers, the epic, 11 tasks, a rule, the critical path, two lines of
// detail on the selection and the two lines of the views' bar. Shorter, the
// finished branches fold into « ✓ fait (n) », then the detail drops to one
// line, then to none, then the list scrolls with the selection.
//
// R4, the graph: three columns of 26 (FAIT · PRÊT, EN COURS · ATTENTE,
// BLOQUÉ) and two gutters of 5, each top-level task on two rows (its title,
// then its agent and age). A gutter routes its links on a vertical with
// ┬ ┐ ┤ ┼ ┘ └ junctions, links sharing no lane on stretches of their own; a
// link that skips the middle column crosses it on a lane of its own, as a
// solid line, so no two lines ever cross.

import type { NodeState, TreeEpic, TreeModel, TreeNode } from "./tree.ts";
import {
  AGENT_CELLS,
  LINK_CELLS,
  MODEL_CELLS,
  agentParts,
  roleCell,
} from "./tree.ts";
import { cells, fit } from "./width.ts";

/** The elements a screen is drawn with: any surface's table has them. */
export type Els = { Box: any; Text: any };

// Theme colours, never fixed shades: the engine gives each its tone for the
// light and the dark themes alike, so the tree reads on either ground.
export const MAUVE = "merged"; // the epics, the critical path, the views' bar
export const AMBER = "warning"; // the task under way
export const TEAL = "planMode"; // ready, nobody on it yet
export const BLUE = "ide"; // the model
export const YOU = "permission"; // waiting on the person, as a permission is
export const GREEN = "success";
export const RED = "error";

export type Span = {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  underline?: boolean;
};

/** A cell: a fixed width, and either its text or a row of cells inside. */
export type Cell = { w: number; spans?: Span[]; right?: boolean; row?: Cell[] };

export type Screen = {
  lines: Cell[][];
  /** For each line, the task it shows, for a click to select. */
  rowIds: (string | undefined)[];
  /** The line of the views' bar, and where each view's name sits. */
  tabsLine: number;
  tabs: { x: number; w: number; view: View }[];
  /** The tasks ↑ and ↓ walk, in the order shown. */
  order: string[];
};

export type View = "tree" | "graph";

/** What the person moved: kept by the surface module, across redraws. */
export type Ui = { view: View; sel?: string; open: string[] };

export const FULL = { links: 88, model: 76, agent: 64 } as const;
export const W = {
  margin: 2,
  tree: 30,
  agent: AGENT_CELLS,
  model: MODEL_CELLS,
  age: 6,
  links: LINK_CELLS,
  gap: 2,
  level: 3,
  glyph: 2,
  ref: 7,
  title: 18,
} as const;

export const GLYPH: Record<
  NodeState,
  { glyph: string; color?: string; dim?: boolean }
> = {
  done: { glyph: "✓", color: GREEN },
  run: { glyph: "●", color: AMBER },
  you: { glyph: "◇", color: YOU },
  wait: { glyph: "◇", color: YOU },
  ready: { glyph: "▶", color: TEAL },
  blocked: { glyph: "⊘", color: RED },
  todo: { glyph: "○", dim: true },
};

const HINT = "↑↓ choisir · ⏎ plier/déplier · tab changer de vue";
const HINT_SHORT = "↑↓ ⏎ tab";

// --- cells ------------------------------------------------------------------------

const span = (text: string, style: Omit<Span, "text"> = {}): Span => ({
  text,
  ...style,
});
const dim = (text: string): Span => ({ text, dim: true });

/** Spans cut to `w` cells as one text: the cut falls in the span it reaches. */
export function cut(spans: Span[], w: number): Span[] {
  const whole = spans.map((s) => s.text).join("");
  if (cells(whole) <= w) return spans;
  const kept = fit(whole, w);
  const out: Span[] = [];
  let left = [...kept];
  for (const s of spans) {
    if (!left.length) break;
    const n = [...s.text].length;
    out.push({ ...s, text: left.slice(0, n).join("") });
    left = left.slice(n);
  }
  if (left.length && out.length) out[out.length - 1]!.text += left.join("");
  return out;
}

const cell = (w: number, spans: Span[] = [], right = false): Cell =>
  right ? { w, spans: cut(spans, w), right } : { w, spans: cut(spans, w) };
const row = (w: number, inner: Cell[]): Cell => ({ w, row: inner });
const gap = (): Cell => ({ w: W.gap });
const rule = (w: number, ch: string): Cell[] => [cell(w, [dim(ch.repeat(w))])];

/** Which of the optional columns a body of `width` cells keeps. */
export function columnsFor(width: number) {
  return {
    links: width >= FULL.links,
    model: width >= FULL.model,
    agent: width >= FULL.agent,
    tree: Math.max(8, Math.min(W.tree, width - W.margin - W.gap - W.age)),
  };
}

// --- the tree's rows ----------------------------------------------------------------

type Visible = {
  node: TreeNode;
  depth: number;
  lasts: boolean[];
  top: TreeNode;
};

/** The rows the tree shows, an open task's subtasks under it. */
export function visible(nodes: TreeNode[], open: readonly string[]): Visible[] {
  const out: Visible[] = [];
  const walk = (
    list: TreeNode[],
    depth: number,
    lasts: boolean[],
    top?: TreeNode,
  ) =>
    list.forEach((node, i) => {
      const here = [...lasts, i === list.length - 1];
      out.push({ node, depth, lasts: here, top: top ?? node });
      if (node.kids.length && open.includes(node.id))
        walk(node.kids, depth + 1, here, top ?? node);
    });
  walk(nodes, 0, []);
  return out;
}

const findNode = (model: TreeModel, id: string | undefined) => {
  let hit:
    | { node: TreeNode; epic: TreeEpic; top: TreeNode; parent?: TreeNode }
    | undefined;
  for (const epic of model.epics) {
    const walk = (list: TreeNode[], top?: TreeNode, parent?: TreeNode) =>
      list.forEach((n) => {
        if (n.id === id)
          hit = parent
            ? { node: n, epic, top: top!, parent }
            : { node: n, epic, top: n };
        walk(n.kids, top ?? n, n);
      });
    walk(epic.nodes);
  }
  return hit;
};

/**
 * Where the person starts: the first task under way, its branch open down to
 * the running subtask; else the first task left to do; else the first.
 */
export function initialUi(model: TreeModel): Ui {
  for (const epic of model.epics)
    for (const top of epic.nodes) {
      if (top.state !== "run") continue;
      const open: string[] = [];
      for (let n: TreeNode | undefined = top; n?.kids.length;) {
        open.push(n.id);
        n = n.kids.find((k) => k.state === "run" && k.kids.length);
      }
      return { view: "tree", sel: top.id, open };
    }
  const tops = model.epics.flatMap((e) => e.nodes);
  const first = tops.find((n) => n.state !== "done") ?? tops[0];
  return first
    ? { view: "tree", sel: first.id, open: [] }
    : { view: "tree", open: [] };
}

/** ⏎ on a task: fold or unfold it; one top-level branch open at a time. */
export function toggle(model: TreeModel, ui: Ui, id: string): Ui {
  const hit = findNode(model, id);
  if (!hit || !hit.node.kids.length) return ui;
  if (ui.open.includes(id))
    return { ...ui, open: ui.open.filter((o) => o !== id) };
  const tops = new Set(model.epics.flatMap((e) => e.nodes.map((n) => n.id)));
  const open = tops.has(id) ? ui.open.filter((o) => !tops.has(o)) : ui.open;
  return { ...ui, open: [...open, id] };
}

/** ↑ or ↓: the previous or next task shown, at the ends it stays. */
export function step(screen: Screen, ui: Ui, by: number): Ui {
  const i = ui.sel === undefined ? -1 : screen.order.indexOf(ui.sel);
  const next =
    screen.order[Math.max(0, Math.min(screen.order.length - 1, i + by))];
  return next === undefined ? ui : { ...ui, sel: next };
}

function treeCell(
  v: Visible,
  width: number,
  selected: boolean,
  open: boolean,
): Cell {
  const { node, depth } = v;
  const inner: Cell[] = [];
  // The ancestors' lines, then this task's own corner
  for (const last of v.lasts.slice(0, -1))
    inner.push(cell(W.level, [dim(last ? "" : "│")]));
  const corner = v.lasts[v.lasts.length - 1] ? "└" : "├";
  const mark = node.kids.length ? (open ? "▾" : "▸") : "─";
  inner.push(
    cell(W.level, [
      dim(corner),
      node.kids.length ? span(mark, { color: MAUVE }) : dim(mark),
    ]),
  );
  const g = GLYPH[node.state];
  inner.push(
    cell(W.glyph, [
      span(g.glyph, {
        ...(g.color && { color: g.color }),
        ...(g.dim && { dim: true }),
      }),
    ]),
  );
  const used = W.level * (depth + 1) + W.glyph;
  const strong = node.state === "run";
  const faint = node.state === "done" || node.state === "blocked";
  if (depth === 0) {
    inner.push(
      cell(W.ref, [
        span(node.label, strong ? { bold: true } : faint ? { dim: true } : {}),
      ]),
    );
  }
  const left = width - used - (depth === 0 ? W.ref : 0);
  inner.push(
    cell(Math.max(0, Math.min(W.title, left)), [
      span(node.title, {
        ...(strong && { bold: true }),
        ...(faint && { dim: true }),
        ...(selected && { underline: true }),
      }),
    ]),
  );
  return row(width, inner);
}

type Cols = ReturnType<typeof columnsFor>;

/**
 * Who works a task, in `w` cells: « ◉ principal » in the theme's colour,
 * « ↳ name · role » in the subagent's own, the person « toi », « prête »
 * when nobody took it yet. A finished task's is dimmed.
 */
export function agentSpans(n: TreeNode, w: number): Span[] {
  if (!n.agent) return [];
  const faint = n.state === "done";
  const tone = (color: string | undefined): Omit<Span, "text"> => ({
    ...(color && { color }),
    ...(faint && { dim: true }),
  });
  switch (n.agentKind) {
    case "you":
      return [span(n.agent, tone(YOU))];
    case "ready":
      return [span(n.agent, tone(TEAL))];
    case "main":
      return [
        span("◉ ", tone(n.agentColor)),
        span(n.agent, tone(n.agentColor)),
      ];
    case "sub": {
      const p = agentParts(n.agent, roleCell(n.role), Math.max(0, w - 2));
      return [
        span("↳ ", tone(n.agentColor)),
        span(p.name, tone(n.agentColor)),
        ...(p.role ? [dim(" · "), dim(p.role)] : []),
      ];
    }
    default:
      return [span(n.agent, faint ? { dim: true } : {})];
  }
}

function taskLine(
  v: Visible,
  cols: Cols,
  selected: boolean,
  open: boolean,
): Cell[] {
  const n = v.node;
  const out: Cell[] = [
    cell(W.margin, n.crit ? [span("┃", { color: MAUVE })] : []),
    treeCell(v, cols.tree, selected, open),
  ];
  if (cols.agent) out.push(gap(), cell(W.agent, agentSpans(n, W.agent)));
  if (cols.model)
    out.push(
      gap(),
      cell(
        W.model,
        n.model
          ? [
              span(
                n.model,
                n.state === "done" ? { dim: true } : { color: BLUE },
              ),
            ]
          : [],
      ),
    );
  const ageTone = n.silent
    ? { color: RED, bold: true }
    : n.state === "run"
      ? { color: AMBER }
      : n.state === "you" || n.state === "wait"
        ? { color: YOU }
        : { dim: true };
  out.push(gap(), cell(W.age, n.age ? [span(n.age, ageTone)] : [], true));
  if (cols.links)
    out.push(
      gap(),
      cell(
        W.links,
        n.links
          ? [
              span(
                n.links,
                n.state === "blocked" ? { color: RED } : { dim: true },
              ),
            ]
          : [],
      ),
    );
  return out;
}

function headerLine(cols: Cols): Cell[] {
  const hd = (t: string) => [dim(t)];
  const out: Cell[] = [cell(W.margin), cell(cols.tree, hd("TÂCHE"))];
  if (cols.agent) out.push(gap(), cell(W.agent, hd("AGENT")));
  if (cols.model) out.push(gap(), cell(W.model, hd("MODÈLE")));
  out.push(gap(), cell(W.age, hd("ÂGE"), true));
  if (cols.links) out.push(gap(), cell(W.links, hd("LIENS")));
  return out;
}

/** « 3/5 », done over total, in green once every task is done. */
const progress = (epic: TreeEpic): Span =>
  epic.total && epic.done === epic.total
    ? span(`${epic.done}/${epic.total}`, { color: GREEN })
    : dim(`${epic.done}/${epic.total}`);

/**
 * An epic's line: ◆, its number and title, its progress right after the
 * title, its age. The agent and model columns stay empty: they speak of the
 * tasks. The tasks filed under no epic sit under a quiet « Hors épopée »,
 * with no number, no progress and no age.
 */
function epicLine(epic: TreeEpic, cols: Cols): Cell[] {
  // The title runs over the agent and model columns, empty on this line
  const span2 =
    cols.tree +
    (cols.agent ? W.gap + W.agent : 0) +
    (cols.model ? W.gap + W.model : 0);
  const titleW = Math.max(0, span2 - W.glyph - W.ref);
  const loose = epic.id === 0;
  const count = loose ? undefined : progress(epic);
  const countW = count ? cells(count.text) + 2 : 0;
  const nameW = Math.max(
    0,
    Math.min(cells(epic.title), titleW - (titleW > countW + 4 ? countW : 0)),
  );
  const out: Cell[] = [
    cell(W.margin),
    row(span2, [
      cell(W.glyph, [loose ? dim("◌") : span("◆", { color: MAUVE })]),
      cell(
        W.ref,
        loose ? [] : [span(`#${epic.id}`, { color: MAUVE, bold: true })],
      ),
      cell(nameW, [
        loose
          ? dim(epic.title)
          : span(epic.title, { color: MAUVE, bold: true }),
      ]),
      cell(
        Math.max(0, titleW - nameW),
        count && titleW - nameW >= countW ? [dim("  "), count] : [],
      ),
    ]),
  ];
  out.push(gap(), cell(W.age, loose ? [] : [dim(epic.age)], true));
  if (cols.links) out.push(gap(), cell(W.links));
  return out;
}

function foldLine(count: number, cols: Cols): Cell[] {
  return [
    cell(W.margin),
    cell(cols.tree, [
      dim("└─ "),
      span("✓", { color: GREEN }),
      dim(` fait (${count})`),
    ]),
  ];
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

/**
 * What the section is about, never the tab's own name again: the one epic
 * open (« #1 Recette kodflow »), else how many (« 2 épopées ouvertes »),
 * then the tasks under no epic (« 1 tâche hors épopée »).
 */
export function sectionTitle(
  model: TreeModel,
  epic: TreeEpic | undefined,
): string {
  const real = model.epics.filter((e) => e.id !== 0);
  const loose = model.epics.find((e) => e.id === 0);
  const left = loose ? loose.total - loose.done : 0;
  const parts: string[] = [];
  if (real.length === 1 && !left) {
    const one = epic && epic.id !== 0 ? epic : real[0]!;
    parts.push(`#${one.id} ${one.title}`);
  } else if (real.length)
    parts.push(plural(real.length, "épopée ouverte", "épopées ouvertes"));
  if (left) parts.push(plural(left, "tâche hors épopée", "tâches hors épopée"));
  return parts.join(" · ");
}

function titleLine(
  model: TreeModel,
  epic: TreeEpic | undefined,
  width: number,
): Cell[] {
  const what = sectionTitle(model, epic);
  const head: Cell[] = [cell(2, [dim("─ ")])];
  const used = 2;
  const wWhat = Math.min(cells(what), Math.max(0, width - used - 2));
  head.push(cell(wWhat, [span(what, { color: MAUVE })]));
  const rest = Math.max(0, width - used - wWhat);
  if (rest > 1) head.push(cell(1), cell(rest - 1, [dim("─".repeat(rest - 1))]));
  return head;
}

const stateTone = (s: NodeState): Omit<Span, "text"> => {
  const g = GLYPH[s];
  return g.color ? { color: g.color } : { dim: true };
};

function chainSpans(epic: TreeEpic | undefined): Span[] {
  if (!epic?.chains.length) return [dim("aucun lien")];
  const out: Span[] = [];
  epic.chains.forEach((chain, i) => {
    if (i) out.push(dim("  ·  "));
    chain.forEach((t, j) => {
      if (j) out.push(dim(" → "));
      out.push(span(t.label, stateTone(t.state)));
    });
  });
  return out;
}

/** "┃ chemin critique  C6 → C9 · C7 → C9", and who it waits on, right. */
function critLine(epic: TreeEpic | undefined, width: number): Cell[] {
  const head = [
    span("┃ ", { color: MAUVE }),
    span("chemin critique  ", { color: MAUVE }),
  ];
  const you = epic?.you;
  const tail: Span[] = you
    ? you.crit
      ? [dim("bloqué par "), span(`toi (${you.label})`, { color: YOU })]
      : [
          dim("t'attend "),
          span(`◇ ${you.label}`, { color: YOU }),
          dim(you.age ? ` · ${you.age}` : ""),
        ]
    : [];
  const headW = Math.min(19, width);
  // The chains keep 8 cells before who waits is given any, and the gap of 2
  const fits = width - headW - 8 - W.gap;
  const tailW =
    fits > 0 ? Math.min(cells(tail.map((s) => s.text).join("")), fits) : 0;
  const midW = Math.max(0, width - headW - tailW - (tailW ? 2 : 0));
  const out: Cell[] = [cell(headW, head), cell(midW, chainSpans(epic))];
  if (tailW) out.push(cell(2), cell(tailW, tail));
  return out;
}

function detailLines(
  model: TreeModel,
  ui: Ui,
  width: number,
  count: number,
): Cell[][] {
  if (count <= 0) return [];
  const hit = findNode(model, ui.sel);
  if (!hit)
    return [[cell(width, [dim("Aucune tâche choisie")])], [cell(width)]].slice(
      0,
      count,
    );
  const n = hit.node;
  const g = GLYPH[n.state];
  const name = hit.parent ? n.title : `${n.label}  ${n.title}`;
  const meta = [
    n.role ? `${n.agent} · ${n.role}` : n.agent,
    n.model,
    n.age,
    n.links,
    n.ci,
    n.silent ? "figé" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const first: Span[] = [
    span(`${g.glyph} `, g.color ? { color: g.color } : { dim: true }),
    span(name, { bold: true }),
  ];
  if (meta) first.push(dim(`   ${meta}`));
  if (hit.parent) first.push(dim(`  sous-tâche de ${hit.top.label}`));
  const kids = n.kids.length
    ? `${n.kids.length} sous-tâche${n.kids.length > 1 ? "s" : ""}${
        ui.open.includes(n.id)
          ? ""
          : `, repliée${n.kids.length > 1 ? "s" : ""} (⏎ ou clic)`
      }`
    : "";
  const second = n.desc || kids || "Aucune description";
  const lines = [
    [cell(width, first)],
    [cell(W.gap), cell(Math.max(0, width - W.gap), [dim(second)])],
  ];
  return lines.slice(0, count);
}

function tabsLines(
  view: View,
  width: number,
): { lines: Cell[][]; tabs: Screen["tabs"] } {
  const on = (v: View): Omit<Span, "text"> =>
    v === view ? { color: MAUVE, bold: true, underline: true } : { dim: true };
  const hint = width >= 64 ? HINT : HINT_SHORT;
  const hintW = Math.min(cells(hint), Math.max(0, width - 15));
  const line: Cell[] = [
    cell(5, [span("Arbre", on("tree"))]),
    cell(3),
    cell(6, [span("Graphe", on("graph"))]),
  ];
  const rest = Math.max(0, width - 14 - hintW);
  if (rest) line.push(cell(rest));
  if (hintW) line.push(cell(hintW, [dim(hint)]));
  return {
    lines: [rule(width, "─"), line],
    tabs: [
      { x: 0, w: 5, view: "tree" },
      { x: 8, w: 6, view: "graph" },
    ],
  };
}

// --- R12 ---------------------------------------------------------------------------------

type Body = { line: Cell[]; id?: string; selectable?: string };

/** The tree view, `width` cells by `rows` lines. */
export function treeScreen(
  model: TreeModel,
  ui: Ui,
  width: number,
  rows: number,
): Screen {
  const cols = columnsFor(width);
  const sel = findNode(model, ui.sel);
  const epic = sel?.epic ?? model.epics[0];

  const bodyOf = (foldDone: boolean): Body[] => {
    const out: Body[] = [];
    for (const e of model.epics) {
      out.push({ line: epicLine(e, cols) });
      const rows = visible(e.nodes, ui.open);
      const finished = foldDone
        ? e.nodes.filter((n) => n.state === "done" && n.id !== sel?.top.id)
        : [];
      const folded = new Set(finished.map((n) => n.id));
      let foldShown = false;
      for (const v of rows) {
        if (folded.has(v.top.id)) {
          if (!foldShown) out.push({ line: foldLine(finished.length, cols) });
          foldShown = true;
          continue;
        }
        const id = v.node.id;
        out.push({
          line: taskLine(v, cols, id === ui.sel, ui.open.includes(id)),
          id,
          selectable: id,
        });
      }
    }
    return out;
  };

  // What the rows hold, most kept first: the folds, then the detail, then
  // the bar, the path and the headers give way, and the list scrolls
  let detail = 2;
  let bar = 2;
  let foot = 2; // the rule and the critical path
  let header = 1;
  let title = 1;
  const room = () => rows - title - header - foot - detail - bar;
  let body = bodyOf(false);
  if (body.length > room()) body = bodyOf(true);
  while (body.length > room() && detail > 0) detail--;
  while (room() < 1 + model.epics.length && bar > 0) bar = 0;
  while (room() < 1 + model.epics.length && foot > 0) foot = 0;
  if (room() < 2 && header) header = 0;
  if (room() < 2 && title) title = 0;

  const space = Math.max(0, room());
  let shown = body;
  if (body.length > space) {
    const at = Math.max(
      0,
      body.findIndex((b) => b.id === ui.sel),
    );
    const start = Math.max(
      0,
      Math.min(body.length - space, at - Math.floor(space / 2)),
    );
    shown = body.slice(start, start + space);
  }

  const lines: Cell[][] = [];
  const rowIds: (string | undefined)[] = [];
  const push = (line: Cell[], id?: string) => {
    lines.push(line);
    rowIds.push(id);
  };
  if (title) push(titleLine(model, epic, width));
  if (header) push(headerLine(cols));
  for (const b of shown) push(b.line, b.id);
  while (lines.length < title + header + space) push([cell(width)]);
  if (foot) {
    push(rule(width, "┄"));
    push(critLine(epic, width));
  }
  for (const d of detailLines(model, ui, width, detail)) push(d);
  let tabsLine = -1;
  let tabs: Screen["tabs"] = [];
  if (bar) {
    const t = tabsLines("tree", width);
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
    order: body.filter((b) => b.selectable).map((b) => b.selectable!),
  };
}

// --- R4 -----------------------------------------------------------------------------------

const COLUMN: Record<NodeState, 0 | 1 | 2> = {
  done: 0,
  ready: 0,
  run: 1,
  you: 1,
  wait: 1,
  blocked: 2,
  todo: 2,
};

export type Lanes = {
  /** Lane of each top-level task, by id, and its column. */
  at: Map<string, { col: 0 | 1 | 2; lane: number }>;
  count: number;
  /** The edges drawn: left column to a column on its right. */
  edges: [string, string][];
};

/**
 * Lanes for the graph's top-level tasks. The middle column takes the first
 * lanes; on the left, the tasks feeding only the middle come first, those
 * feeding the right one after every lane the middle uses (so their line
 * crosses the middle on a free lane), the ones that also feed the middle
 * before those that do not; on the right, each task at its sources'
 * middle lane, or the next one free.
 */
export function lanesOf(epic: TreeEpic): Lanes {
  const col = new Map(epic.nodes.map((n) => [n.id, COLUMN[n.state]]));
  const edges = epic.edges.filter(
    ([a, b]) => (col.get(a) ?? 0) < (col.get(b) ?? 0),
  );
  const at = new Map<string, { col: 0 | 1 | 2; lane: number }>();
  const inCol = (c: number) => epic.nodes.filter((n) => col.get(n.id) === c);
  const mid = inCol(1);
  mid.forEach((n, lane) => at.set(n.id, { col: 1, lane }));
  const to = (id: string, c: number) =>
    edges.some(([a, b]) => a === id && col.get(b) === c);
  const left = inCol(0);
  const feedsMid = left.filter((n) => !to(n.id, 2));
  const firstTarget = (id: string) =>
    Math.min(
      ...edges
        .filter(([a]) => a === id)
        .map(([, b]) => at.get(b)?.lane ?? Infinity),
      Infinity,
    );
  feedsMid.sort((a, b) => firstTarget(a.id) - firstTarget(b.id));
  feedsMid.forEach((n, lane) => at.set(n.id, { col: 0, lane }));
  const skips = left.filter((n) => to(n.id, 2));
  skips.sort((a, b) => Number(to(b.id, 1)) - Number(to(a.id, 1)));
  const base = Math.max(feedsMid.length, mid.length);
  skips.forEach((n, i) => at.set(n.id, { col: 0, lane: base + i }));
  const taken = new Set<number>();
  for (const n of inCol(2)) {
    const sources = edges
      .filter(([, b]) => b === n.id)
      .map(([a]) => at.get(a)?.lane ?? 0);
    // At its sources' middle lane, so its line splits them evenly
    sources.sort((x, y) => x - y);
    let lane = sources.length ? sources[Math.floor(sources.length / 2)]! : 0;
    while (taken.has(lane)) lane++;
    taken.add(lane);
    at.set(n.id, { col: 2, lane });
  }
  let count = 0;
  for (const v of at.values()) count = Math.max(count, v.lane + 1);
  return { at, count, edges };
}

/** The junction for a row of a gutter's vertical. */
function junction(
  left: boolean,
  right: boolean,
  up: boolean,
  down: boolean,
): string {
  const key = `${+left}${+right}${+up}${+down}`;
  const table: Record<string, string> = {
    "1111": "┼",
    "1101": "┬",
    "1110": "┴",
    "1001": "┐",
    "1010": "┘",
    "0101": "┌",
    "0110": "└",
    "1011": "┤",
    "0111": "├",
    "1100": "─",
    "0011": "│",
    "1000": "─",
    "0100": "─",
  };
  return table[key] ?? "";
}

type Gutter = { cells: Cell[][] };

/**
 * The vertical spans of a gutter: the lanes its links join, grouped so that
 * links sharing no lane get a span each; spans that would overlap are one
 * (they share the vertical, which is a merge, never a crossing).
 */
function spans(links: readonly [number, number][]): [number, number][] {
  let out: [number, number][] = links.map(([a, b]) => [
    Math.min(a, b),
    Math.max(a, b),
  ]);
  out.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

/**
 * One gutter's cells, two per lane: entries from the left (a task feeding the
 * next column, or a line crossing the middle), exits to the right (a task
 * fed), each group of links on its own stretch of the vertical.
 */
function gutter(
  lanes: number,
  links: readonly [number, number][],
  passes: Set<number>,
): Gutter {
  const enters = new Set(links.map(([a]) => a));
  const exits = new Set(links.map(([, b]) => b));
  const stretches = spans(links);
  const within = (lane: number) =>
    stretches.find(([t, b]) => lane >= t && lane <= b);
  const out: Cell[][] = [];
  for (let lane = 0; lane < lanes; lane++) {
    const l = enters.has(lane);
    const r = exits.has(lane);
    const p = passes.has(lane);
    const span = within(lane);
    const up = !!span && lane > span[0];
    const down = !!span && lane < span[1];
    // A line crossing on to the next column leaves the junction to the right
    const j =
      l || r ? junction(l, r || p, up, down) : p ? "─" : up && down ? "│" : "";
    const tail = r ? "─▶" : p ? "───" : "";
    out.push([
      cell(1, l || p ? [dim("─")] : []),
      cell(1, j ? [dim(j)] : []),
      cell(3, tail ? [dim(tail)] : []),
    ]);
    out.push([cell(1), cell(1, down ? [dim("│")] : []), cell(3)]);
  }
  return { cells: out };
}

function graphNode(n: TreeNode, w: number, fills: boolean): Cell[][] {
  const g = GLYPH[n.state];
  const strong = n.state === "run";
  const idW = 6;
  const titleW = Math.min(
    cells(fit(n.title, Math.max(0, w - W.glyph - idW))),
    Math.max(0, w - W.glyph - idW),
  );
  const fillW = Math.max(0, w - W.glyph - idW - titleW);
  const first: Cell[] = [
    cell(W.glyph, [
      span(g.glyph, g.color ? { color: g.color } : { dim: true }),
    ]),
    cell(idW, [span(n.label, strong ? { bold: true } : {})]),
    cell(titleW, [span(n.title, strong ? { bold: true } : {})]),
  ];
  if (fillW)
    first.push(
      cell(fillW, fills && fillW > 1 ? [dim(` ${"─".repeat(fillW - 1)}`)] : []),
    );
  const meta: Span[] =
    n.state === "ready"
      ? [span("prête", { color: TEAL }), dim(" · personne dessus")]
      : n.state === "you"
        ? [
            span("attend toi", { color: YOU }),
            ...(n.age ? [dim(" · "), span(n.age, { color: YOU })] : []),
          ]
        : n.state === "blocked"
          ? [
              span(
                n.links.startsWith("⇠")
                  ? `attend ${n.links.slice(2)}`
                  : "bloquée",
                { color: RED },
              ),
            ]
          : [
              ...(n.agent
                ? [
                    span(n.agent, {
                      ...(n.agentColor && { color: n.agentColor }),
                      ...(n.state === "done" && { dim: true }),
                    }),
                  ]
                : []),
              // The model only where the age still fits after it
              ...(n.model &&
              n.state === "done" &&
              cells(`${n.agent} · ${n.model} · ${n.age}`) <= w - W.gap
                ? [dim(` · ${n.model}`)]
                : []),
              ...(n.age
                ? [
                    dim(n.agent ? " · " : ""),
                    span(
                      n.age,
                      n.state === "run" ? { color: AMBER } : { dim: true },
                    ),
                  ]
                : []),
            ];
  return [
    [row(w, first)],
    [row(w, [cell(W.gap), cell(Math.max(0, w - W.gap), meta)])],
  ];
}

/** The graph view, `width` cells by `rows` lines. */
export function graphScreen(
  model: TreeModel,
  ui: Ui,
  width: number,
  rows: number,
): Screen {
  const sel = findNode(model, ui.sel);
  const epic = sel?.epic ?? model.epics[0];
  const colW = width >= FULL.links ? 26 : Math.floor((width - 10) / 3);
  // Under 40 cells a node no longer holds its glyph, its ref and a title
  const fits = colW >= 10;
  const lines: Cell[][] = [];
  const push = (l: Cell[]) => lines.push(l);
  push(titleLine(model, epic, width));
  push(
    fits
      ? [
          cell(colW, [dim("FAIT · PRÊT")]),
          cell(5),
          cell(colW, [dim("EN COURS · ATTENTE")]),
          cell(5),
          cell(colW, [dim("BLOQUÉ")]),
        ]
      : [cell(width, [dim("le graphe veut 40 colonnes")])],
  );
  const footer = 6; // rule, three lines, the bar's two
  const room = Math.max(0, rows - 2 - footer);
  if (epic && fits) {
    const { at, count, edges } = lanesOf(epic);
    const byLane: (TreeNode | undefined)[][] = [[], [], []];
    for (const n of epic.nodes) {
      const p = at.get(n.id)!;
      byLane[p.col]![p.lane] = n;
    }
    const colOf = (id: string) => at.get(id)?.col;
    const laneOf = (id: string) => at.get(id)!.lane;
    const lanePair = ([a, b]: [string, string]): [number, number] => [
      laneOf(a),
      laneOf(b),
    ];
    const links0 = edges
      .filter(([a, b]) => colOf(a) === 0 && colOf(b) === 1)
      .map(lanePair);
    // A link from the left column to the right one crosses the middle on its
    // source's lane, and joins the second gutter there
    const links1 = edges.filter(([, b]) => colOf(b) === 2).map(lanePair);
    const skipping = new Set(
      edges
        .filter(([a, b]) => colOf(a) === 0 && colOf(b) === 2)
        .map(([a]) => laneOf(a)),
    );
    const g0 = gutter(count, links0, skipping);
    const g1 = gutter(count, links1, new Set());
    const fills = (id: string) => edges.some(([a]) => a === id);
    const lanesShown = Math.min(count, Math.floor(room / 2));
    for (let lane = 0; lane < lanesShown; lane++) {
      const parts = [0, 1, 2].map((c) => {
        const n = byLane[c]![lane];
        if (n) return graphNode(n, colW, fills(n.id));
        // A line crossing the middle column on a free lane
        if (c === 1 && skipping.has(lane))
          return [[cell(colW, [dim("─".repeat(colW))])], [cell(colW)]];
        return [[cell(colW)], [cell(colW)]];
      });
      for (const r of [0, 1])
        push([
          ...parts[0]![r]!,
          row(5, g0.cells[lane * 2 + r]!),
          ...parts[1]![r]!,
          row(5, g1.cells[lane * 2 + r]!),
          ...parts[2]![r]!,
        ]);
    }
    if (count > lanesShown && lines.length > 2) {
      lines.pop();
      push([
        cell(width, [dim(`… ${count - lanesShown + 1} couloir(s) de plus`)]),
      ]);
    }
  }
  while (lines.length < 2 + room) push([cell(width)]);
  push(rule(width, "┄"));
  // Footer: next action and who waits on you, the path, the deliverable
  const next: Span[] = [dim("prochaine action  ")];
  if (epic?.next)
    next.push(
      span(`▶ ${epic.next.label}`, { color: TEAL }),
      dim(" prête, personne dessus"),
    );
  else next.push(dim("rien de prêt"));
  const you: Span[] = epic?.you
    ? [
        dim("t'attend  "),
        span(`◇ ${epic.you.label}`, { color: YOU }),
        dim(epic.you.age ? ` · ${epic.you.age}` : ""),
      ]
    : [];
  const youW = Math.min(
    cells(you.map((s) => s.text).join("")),
    Math.max(0, width - 30),
  );
  const first: Cell[] = [cell(width - youW - (youW ? 2 : 0), next)];
  if (youW) first.push(cell(2), cell(youW, you));
  push(first);
  push([
    cell(19, [span("┃ ", { color: MAUVE }), dim("chemin critique  ")]),
    cell(Math.max(0, width - 19), chainSpans(epic)),
  ]);
  const goal: Span[] = [dim("livrable  ")];
  if (epic?.goal) {
    const g = GLYPH[epic.goal.state];
    goal.push(
      span(`${g.glyph} `, g.color ? { color: g.color } : { dim: true }),
      span(`${epic.goal.label} ${epic.goal.title}`),
      dim(` · ${epic.goal.note}`),
    );
  } else goal.push(dim("aucun"));
  push([cell(width, goal)]);
  const t = tabsLines("graph", width);
  push(t.lines[0]!);
  const tabsLine = lines.length;
  push(t.lines[1]!);
  return {
    lines: lines.slice(0, Math.max(rows, 0)),
    rowIds: lines.map(() => undefined),
    tabsLine: tabsLine < rows ? tabsLine : -1,
    tabs: t.tabs,
    order: [],
  };
}

/** The view the person chose, or the message when there is no tree. */
export function screenOf(
  model: TreeModel,
  ui: Ui,
  width: number,
  rows: number,
): Screen | string {
  if (!model.found)
    return "Aucune liste de tâches pour cette session (kodflow-hooks la tient).";
  if (!model.epics.length) return "Aucune épopée ouverte.";
  return ui.view === "graph"
    ? graphScreen(model, ui, width, rows)
    : treeScreen(model, ui, width, rows);
}

// --- drawing --------------------------------------------------------------------------------

function drawSpans({ Text }: Els, spans: Span[]) {
  return spans.map((s) => (
    <Text
      {...(s.color && { color: s.color })}
      {...(s.dim && { dimColor: true })}
      {...(s.bold && { bold: true })}
      {...(s.underline && { underline: true })}
    >
      {s.text}
    </Text>
  ));
}

function drawCell(els: Els, c: Cell, key: string): any {
  const { Box, Text } = els;
  if (c.row)
    return (
      <Box key={key} width={c.w} flexShrink={0} flexDirection="row">
        {c.row.map((inner, i) => drawCell(els, inner, `${key}.${i}`))}
      </Box>
    );
  return (
    <Box
      key={key}
      width={c.w}
      flexShrink={0}
      {...(c.right && { justifyContent: "flex-end" })}
    >
      {c.spans?.length ? (
        <Text wrap="truncate-end">{drawSpans(els, c.spans)}</Text>
      ) : null}
    </Box>
  );
}

/** A screen as Boxes: one row a line, one Box of its fixed width a cell. */
export function draw(els: Els, screen: Screen | string, width: number) {
  const { Box, Text } = els;
  if (typeof screen === "string")
    return (
      <Box key="tasks" flexDirection="column" width={width}>
        <Text dimColor wrap="truncate-end">
          {screen}
        </Text>
      </Box>
    );
  return (
    <Box key="tasks" flexDirection="column" width={width}>
      {screen.lines.map((line, i) => (
        <Box key={`l${i}`} flexDirection="row" height={1} width={width}>
          {line.map((c, j) => drawCell(els, c, `l${i}.${j}`))}
        </Box>
      ))}
    </Box>
  );
}
