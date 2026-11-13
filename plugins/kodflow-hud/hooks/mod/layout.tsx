// layout.tsx — the « Tâches » pane's tree, laid out cell by cell.
// Pure: no `$`. The surface module (client.tsx) draws it with its own
// elements and keeps the selection; a surface with no `Client` gets the same
// screen, still, from the hooks module.
//
// Alignment is the point. A screen is a list of lines, a line a row of cells
// of a fixed width each, and every cell is drawn padded to exactly that
// width: what goes in a cell is cut to it first, then filled with spaces,
// both measured in terminal cells (width.ts), so a wide glyph never shifts
// the next column. A line is one Text, so a wide board stays a small tree.
// No cell paints a background: colour is the text's alone, so a transparent
// terminal shows through everywhere.
//
// R12, the tree, at its full width (88 cells of body, 90 with the frame):
//   margin 2 · tree 30 (3 a level, glyph 2, ref 7, title 18) · agent 22 ·
//   model·effort 10 · age 6 (right) · links 10, a gap of 2 between them.
// The agent column names who works the task: « ◉ principal » in the theme's
// colour, « ↳ name · role » in the subagent's own (who.ts), « toi », « prête ».
// Narrower, the links go first (under 88), then the model (under 76), then
// the agent (under 64); the tree and the age stay. On 20 rows: title,
// headers, the epic, 11 tasks, a rule, the critical path and two lines of
// detail on the selection. Shorter, the finished branches fold into « ✓ fait
// (n) », first under the epic, then the detail drops to one line, then to
// none, then the list scrolls with the selection.
//
// Epics stand in the order they were opened, the active one marked « actif »
// in place. One idle for 24 h is a single line, « ▸ », that ⏎ or a click
// opens (`Ui.idle`). Under a task handed to subagents, one read-only line
// sums up their own tasks (tree.ts `helpers`). The views' bar (« Arbre »,
// « Chasse ») is drawn only while a hunt is listed.

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
  /** What a click on a line does beyond choosing it (« reprendre » in « Chasse »). */
  buttons?: { y: number; x: number; w: number; act: Act }[];
  /** The tasks ↑ and ↓ walk, in the order shown. */
  order: string[];
  /** The lines the task list takes: the first, and how many. */
  list: { top: number; rows: number };
};

export type View = "tree" | "hunt";
/** « Chasse » last, and only while a hunt is listed (`BarCounts.hunt`). */
export const VIEWS: readonly View[] = ["tree", "hunt"];

/**
 * « Chasse »'s label (hunt.ts, one width) when a hunt is listed: no hunt, no
 * bar at all.
 */
export type BarCounts = { hunt?: string };
const NO_COUNTS: BarCounts = {};

/** A button of the « Chasse » view, posted to the hooks module. */
export type Act = { op: "resume"; slug: string };

/** The selection key of an idle epic's line: never a task id. */
export const idleKey = (epic: number): string => `epic:${epic}`;
export const epicOfKey = (key: string | undefined): number | undefined =>
  key?.startsWith("epic:") ? Number(key.slice(5)) : undefined;

/**
 * What the person moved: kept by the surface module, across redraws. `pin`
 * is the line the chosen task was on when the person last acted on it: the
 * next screen keeps it there whenever it can, so a click never moves the
 * row it hit and ↑↓ scroll only as far as they must.
 */
export type Ui = {
  view: View;
  sel?: string;
  open: string[];
  pin?: { id: string; y: number };
  /** The line the chosen line of « Chasse » stays on, as `pin`. */
  ppin?: { id: string; y: number };
  /** « Chasse »: the line chosen, and each hunt's last seq when the view
   * was opened before this time (`hsince`) and this time (`hlast`): the
   * digest is what came after `hsince`. */
  hsel?: string;
  hsince?: Record<string, number>;
  hlast?: Record<string, number>;
  /** The idle epics the person opened. */
  idle?: number[];
};

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

const HINTS: Record<View, string> = {
  tree: "↑↓ choisir · ⏎ plier · tab vue",
  hunt: "↑↓ choisir · ⏎ reprendre · tab vue",
};
const HINT_SHORT = "↑↓ ⏎ tab";
// « Arbre », then « Chasse » with its counter from this width, alone below
const HUNT_FULL = 26;

// --- cells ------------------------------------------------------------------------

export const span = (text: string, style: Omit<Span, "text"> = {}): Span => ({
  text,
  ...style,
});
export const dim = (text: string): Span => ({ text, dim: true });

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

export const cell = (w: number, spans: Span[] = [], right = false): Cell =>
  right ? { w, spans: cut(spans, w), right } : { w, spans: cut(spans, w) };
export const row = (w: number, inner: Cell[]): Cell => ({ w, row: inner });
const gap = (): Cell => ({ w: W.gap });
export const rule = (w: number, ch: string): Cell[] => [
  cell(w, [dim(ch.repeat(w))]),
];

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
    for (const top of epic.idle ? [] : epic.nodes) {
      if (top.state !== "run") continue;
      const open: string[] = [];
      for (let n: TreeNode | undefined = top; n?.kids.length;) {
        open.push(n.id);
        n = n.kids.find((k) => k.state === "run" && k.kids.length);
      }
      return { view: "tree", sel: top.id, open };
    }
  const tops = model.epics.flatMap((e) => (e.idle ? [] : e.nodes));
  const first = tops.find((n) => n.state !== "done") ?? tops[0];
  if (first) return { view: "tree", sel: first.id, open: [] };
  const sleeping = model.epics.find((e) => e.idle);
  return sleeping
    ? { view: "tree", sel: idleKey(sleeping.id), open: [] }
    : { view: "tree", open: [] };
}

/** Whether `sel` is a line the tree shows now: a task, or an idle epic's line. */
function shown(model: TreeModel, ui: Ui, sel: string): boolean {
  const epic = epicOfKey(sel);
  if (epic !== undefined)
    return model.epics.some((e) => e.id === epic && e.idle);
  const hit = findNode(model, sel);
  return !!hit && (!hit.epic.idle || (ui.idle ?? []).includes(hit.epic.id));
}

const VIEW_SET: ReadonlySet<string> = new Set(VIEWS);

/**
 * What the surface kept, made safe to draw: a view this version does not
 * have is the tree, fields of an older version are left aside, a selection
 * the tree no longer shows (its epic closed, its task gone) moves to the
 * first task of the active epic, else the tree's first. Nothing is written
 * back: only what the person changes is kept.
 */
export function normalise(model: TreeModel, raw: unknown): Ui {
  if (!raw || typeof raw !== "object") return initialUi(model);
  const u = raw as Record<string, any>;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const ui: Ui = {
    view: VIEW_SET.has(u.view) ? u.view : "tree",
    open: strings(u.open),
  };
  if (typeof u.sel === "string") ui.sel = u.sel;
  const pinOk = (p: any) =>
    p && typeof p.id === "string" && Number.isInteger(p.y);
  if (pinOk(u.pin)) ui.pin = { id: u.pin.id, y: u.pin.y };
  if (pinOk(u.ppin)) ui.ppin = { id: u.ppin.id, y: u.ppin.y };
  if (typeof u.hsel === "string") ui.hsel = u.hsel;
  for (const k of ["hsince", "hlast"] as const)
    if (u[k] && typeof u[k] === "object") ui[k] = u[k];
  if (Array.isArray(u.idle))
    ui.idle = u.idle.filter((x: unknown): x is number => Number.isInteger(x));
  return repair(model, ui);
}

/** A selection the tree does not show moved to the active epic's first task. */
export function repair(model: TreeModel, ui: Ui): Ui {
  if (ui.sel !== undefined && shown(model, ui, ui.sel)) return ui;
  const active = model.epics.find((e) => e.active && !e.idle);
  const first = active?.nodes[0]?.id ?? initialUi(model).sel;
  const { pin: _pin, sel: _sel, ...rest } = ui;
  return first === undefined ? rest : { ...rest, sel: first };
}

/** ⏎ or a click on an idle epic's line: it opens, or closes again. */
export function toggleIdle(ui: Ui, epic: number): Ui {
  const open = ui.idle ?? [];
  return {
    ...ui,
    idle: open.includes(epic)
      ? open.filter((e) => e !== epic)
      : [...open, epic],
  };
}

/**
 * ⏎ on a task: fold or unfold it; one top-level branch open at a time. A
 * click (`keepAbove`) closes only the branches below the one it opens: one
 * above closing would pull the clicked row up from under the pointer.
 */
export function toggle(
  model: TreeModel,
  ui: Ui,
  id: string,
  keepAbove = false,
): Ui {
  const hit = findNode(model, id);
  if (!hit || !hit.node.kids.length) return ui;
  if (ui.open.includes(id))
    return { ...ui, open: ui.open.filter((o) => o !== id) };
  const order = model.epics.flatMap((e) => e.nodes.map((n) => n.id));
  const at = order.indexOf(id);
  const closes = (o: string) => {
    const i = order.indexOf(o);
    return i >= 0 && !(keepAbove && i < at);
  };
  const open = at >= 0 ? ui.open.filter((o) => !closes(o)) : ui.open;
  return { ...ui, open: [...open, id] };
}

/** The task `id` pinned to the line it is shown on now, else to `y`. */
export function pinAt(screen: Screen, ui: Ui, id: string, y?: number): Ui {
  const shown = screen.rowIds.indexOf(id);
  const line = shown >= 0 ? shown : y;
  return line === undefined ? ui : { ...ui, pin: { id, y: line } };
}

/**
 * ↑ or ↓: the previous or next task shown, at the ends it stays. It keeps
 * its line when it is in view; out of it, it lands on the list's edge, so
 * the list moves by one.
 */
export function step(screen: Screen, ui: Ui, by: number): Ui {
  const i = ui.sel === undefined ? -1 : screen.order.indexOf(ui.sel);
  const next =
    screen.order[Math.max(0, Math.min(screen.order.length - 1, i + by))];
  if (next === undefined) return ui;
  const { top, rows } = screen.list;
  const edge = by > 0 ? top + Math.max(0, rows - 1) : top;
  return pinAt(screen, { ...ui, sel: next }, next, edge);
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

/**
 * The read-only line under a task handed to subagents: how many tasks of
 * their own, how many done, the one under way, those a stopped agent left.
 * Not a row of the tree: no depth, no count, no critical path.
 */
function helpersLine(v: Visible, cols: Cols, width: number): Cell[] {
  const h = v.node.helpers!;
  const indent = W.level * (v.depth + 1);
  const parts: Span[] = [
    dim("↳ sous-agents : "),
    span(`${h.total} tâche${h.total > 1 ? "s" : ""}`),
    dim(h.done ? ` (${h.done} faite${h.done > 1 ? "s" : ""})` : ""),
  ];
  if (h.current) parts.push(dim(" · en cours "), span(h.current, { color: AMBER }));
  if (h.stopped)
    parts.push(dim(" · "), span(`${h.stopped} arrêtée${h.stopped > 1 ? "s" : ""}`, { color: RED }));
  if (h.unknown) parts.push(dim(" · état inconnu"));
  const used = W.margin + Math.min(indent, cols.tree);
  return [
    cell(W.margin),
    cell(Math.min(indent, cols.tree)),
    cell(Math.max(0, width - used), parts),
  ];
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
 * An epic's line: ◆, its number and title, « actif » on the main agent's
 * active one, its progress right after, its age. The agent and model
 * columns stay empty: they speak of the tasks. The tasks filed under no
 * epic sit under a quiet « Hors épopée », with no number, no progress and
 * no age; the subagents' tasks no task names under « Sous-agents », with
 * how many their stopped agents left. An idle epic folded is « ▸ » and
 * « inactive », its tasks out of view until it is opened.
 */
function epicLine(
  epic: TreeEpic,
  cols: Cols,
  folded = false,
  selected = false,
): Cell[] {
  // The title runs over the agent and model columns, empty on this line
  const span2 =
    cols.tree +
    (cols.agent ? W.gap + W.agent : 0) +
    (cols.model ? W.gap + W.model : 0);
  const titleW = Math.max(0, span2 - W.glyph - W.ref);
  const loose = epic.id <= 0;
  const count = loose ? undefined : progress(epic);
  const tags: Span[] = [];
  if (epic.active) tags.push(dim(" · "), span("actif", { color: MAUVE }));
  if (epic.idle)
    tags.push(dim(" · "), span(folded ? "inactive ▸" : "inactive ▾", { dim: true }));
  if (epic.stopped)
    tags.push(dim(" · "), span(`${epic.stopped} arrêtée${epic.stopped > 1 ? "s" : ""}`, { color: RED }));
  const tail: Span[] = [...(count ? [dim("  "), count] : []), ...tags];
  const countW = cells(tail.map((s) => s.text).join(""));
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
          ? span(epic.title, { dim: true, ...(selected && { underline: true }) })
          : span(epic.title, {
              color: MAUVE,
              bold: true,
              ...(selected && { underline: true }),
            }),
      ]),
      cell(
        Math.max(0, titleW - nameW),
        titleW - nameW >= countW ? tail : count ? [dim("  "), count] : [],
      ),
    ]),
  ];
  out.push(gap(), cell(W.age, loose ? [] : [dim(epic.age)], true));
  if (cols.links) out.push(gap(), cell(W.links));
  return out;
}

/**
 * The finished branches, folded: first under the epic, where they mostly
 * stood, so « └─ » is its own only when nothing is left open after it.
 */
function foldLine(count: number, last: boolean, cols: Cols): Cell[] {
  return [
    cell(W.margin),
    cell(cols.tree, [
      dim(last ? "└─ " : "├─ "),
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

/**
 * The views' bar, drawn only while a hunt is listed: « Arbre », then
 * « Chasse » with its label of one width (hunt.ts) where it fits, else
 * « Chasse » alone; the hint of the view shown on the right, where it fits.
 */
export function tabsLines(
  view: View,
  width: number,
  counts: BarCounts = NO_COUNTS,
): { lines: Cell[][]; tabs: Screen["tabs"] } {
  const on = (v: View): Omit<Span, "text"> =>
    v === view ? { color: MAUVE, bold: true, underline: true } : { dim: true };
  const names: [View, string][] = [["tree", "Arbre"]];
  if (counts.hunt)
    names.push(["hunt", width >= HUNT_FULL ? counts.hunt : "Chasse"]);
  const sep = 3;
  const line: Cell[] = [];
  const tabs: Screen["tabs"] = [];
  let x = 0;
  names.forEach(([v, label], i) => {
    const w = cells(label);
    if (v === "hunt" && x + sep + w > width) return;
    if (i) {
      line.push(cell(sep));
      x += sep;
    }
    line.push(cell(Math.min(w, Math.max(0, width - x)), [span(label, on(v))]));
    tabs.push({ x, w, view: v });
    x += w;
  });
  const hint = width - x >= cells(HINTS[view]) + 2 ? HINTS[view] : HINT_SHORT;
  const hintW = width - x >= cells(hint) + 1 ? cells(hint) : 0;
  const rest = Math.max(0, width - x - hintW);
  if (rest) line.push(cell(rest));
  if (hintW) line.push(cell(hintW, [dim(hint)]));
  return { lines: [rule(width, "─"), line], tabs };
}

// --- R12 ---------------------------------------------------------------------------------

type Body = { line: Cell[]; id?: string; selectable?: string };

/** The tree view, `width` cells by `rows` lines. */
export function treeScreen(
  model: TreeModel,
  ui: Ui,
  width: number,
  rows: number,
  counts: BarCounts = NO_COUNTS,
): Screen {
  const cols = columnsFor(width);
  const sel = findNode(model, ui.sel);
  const epic = sel?.epic ?? model.epics[0];

  const bodyOf = (foldDone: boolean): Body[] => {
    const out: Body[] = [];
    for (const e of model.epics) {
      const folded = !!e.idle && !(ui.idle ?? []).includes(e.id);
      const key = e.idle ? idleKey(e.id) : undefined;
      out.push({
        line: epicLine(e, cols, folded, key !== undefined && key === ui.sel),
        ...(key !== undefined && { id: key, selectable: key }),
      });
      if (folded) continue;
      const finished = foldDone
        ? e.nodes.filter((n) => n.state === "done" && n.id !== sel?.top.id)
        : [];
      // The rest drawn as siblings of their own: the corners say where each
      // one really stands once the finished ones have left the list
      const left = e.nodes.filter((n) => !finished.includes(n));
      if (finished.length)
        out.push({ line: foldLine(finished.length, !left.length, cols) });
      for (const v of visible(left, ui.open)) {
        const id = v.node.id;
        out.push({
          line: taskLine(v, cols, id === ui.sel, ui.open.includes(id)),
          id,
          selectable: id,
        });
        if (v.node.helpers) out.push({ line: helpersLine(v, cols, width) });
      }
    }
    return out;
  };

  // What the rows hold, most kept first: the folds, then the detail, then
  // the bar, the path and the headers give way, and the list scrolls
  const fitFor = (length: number) => {
    let detail = 2;
    let bar = counts.hunt ? 2 : 0;
    let foot = 2; // the rule and the critical path
    let header = 1;
    let title = 1;
    const room = () => rows - title - header - foot - detail - bar;
    while (length > room() && detail > 0) detail--;
    while (room() < 1 + model.epics.length && bar > 0) bar = 0;
    while (room() < 1 + model.epics.length && foot > 0) foot = 0;
    if (room() < 2 && header) header = 0;
    if (room() < 2 && title) title = 0;
    return { detail, bar, foot, header, title, space: Math.max(0, room()) };
  };
  // Where the list starts in `body`: centred on the selection, or so that
  // the pinned task stays on its line
  const startOf = (body: Body[], fit: ReturnType<typeof fitFor>) => {
    if (body.length <= fit.space) return 0;
    const at = Math.max(
      0,
      body.findIndex((b) => b.id === ui.sel),
    );
    const want =
      ui.pin?.id === ui.sel
        ? at - (ui.pin!.y - fit.title - fit.header)
        : at - Math.floor(fit.space / 2);
    return Math.max(0, Math.min(body.length - fit.space, want));
  };
  const lineOf = (body: Body[], fit: ReturnType<typeof fitFor>) => {
    const at = body.findIndex((b) => b.id === ui.sel);
    return at < 0 ? -1 : fit.title + fit.header + at - startOf(body, fit);
  };
  const whole = bodyOf(false);
  const folded = bodyOf(true);
  const roomAtFirst = rows - 1 - 1 - 2 - 2 - (counts.hunt ? 2 : 0);
  let body = whole.length > roomAtFirst ? folded : whole;
  // A pinned task keeps its line: with the finished branches folded or
  // not, whichever keeps it there
  if (
    ui.pin &&
    ui.pin.id === ui.sel &&
    lineOf(body, fitFor(body.length)) !== ui.pin.y
  ) {
    const other = body === whole ? folded : whole;
    if (lineOf(other, fitFor(other.length)) === ui.pin.y) body = other;
  }
  const { detail, bar, foot, header, title, space } = fitFor(body.length);
  const start = startOf(body, { detail, bar, foot, header, title, space });
  const shown = body.slice(start, start + space);

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
    const t = tabsLines("tree", width, counts);
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
    list: { top: title + header, rows: space },
  };
}

/** The view the person chose, or the message when there is no tree. */
export function screenOf(
  model: TreeModel,
  ui: Ui,
  width: number,
  rows: number,
  counts: BarCounts = NO_COUNTS,
): Screen | string {
  if (!model.found)
    return "Aucune liste de tâches pour cette session (kodflow-hooks la tient).";
  if (!model.epics.length) return "Aucune épopée ouverte.";
  return treeScreen(model, ui, width, rows, counts);
}

// --- drawing --------------------------------------------------------------------------------

const same = (a: Span, b: Span) =>
  a.color === b.color &&
  !a.dim === !b.dim &&
  !a.bold === !b.bold &&
  !a.underline === !b.underline;

/** Spans clipped to `w` cells, as a Box of that width clips them: no ellipsis. */
function clip(spans: Span[], w: number): Span[] {
  const out: Span[] = [];
  let n = 0;
  for (const s of spans) {
    let text = "";
    for (const ch of s.text) {
      const c = cells(ch);
      if (n + c > w) break;
      text += ch;
      n += c;
    }
    if (text) out.push({ ...s, text });
    if (text !== s.text) break;
  }
  return out;
}

/**
 * A cell as spans of exactly its width: its text, padded with spaces on the
 * side it does not hug, a row of cells one after the other; too wide (a
 * row's cells summing past it), clipped as a Box of that width would.
 */
function flat(c: Cell): Span[] {
  const inner = c.row ? c.row.flatMap(flat) : (c.spans ?? []);
  const kept = clip(inner, c.w);
  const pad = c.w - cells(kept.map((s) => s.text).join(""));
  if (pad <= 0) return kept;
  const fill = { text: " ".repeat(pad) };
  return c.right ? [fill, ...kept] : [...kept, fill];
}

const blank = (s: Span) => !s.underline && !s.text.trim();

/**
 * A line's spans, neighbours of one style merged, plain text left bare. No
 * cell paints a background, so a blank takes its neighbour's style unseen
 * (unless underlined), and the blanks closing the line go: the Box fills it.
 */
function drawLine({ Text }: Els, line: Cell[]) {
  const runs: Span[] = [];
  for (const s of line.flatMap(flat)) {
    const last = runs[runs.length - 1];
    if (last && (same(last, s) || (blank(s) && !last.underline)))
      last.text += s.text;
    else if (last && blank(last) && !s.underline)
      runs[runs.length - 1] = { ...s, text: last.text + s.text };
    else runs.push({ ...s });
  }
  const end = runs[runs.length - 1];
  if (end && !end.underline) {
    end.text = end.text.trimEnd();
    if (!end.text) runs.pop();
  }
  return runs.map((s) =>
    s.color || s.dim || s.bold || s.underline ? (
      <Text
        {...(s.color && { color: s.color })}
        {...(s.dim && { dimColor: true })}
        {...(s.bold && { bold: true })}
        {...(s.underline && { underline: true })}
      >
        {s.text}
      </Text>
    ) : (
      s.text
    ),
  );
}

/**
 * A screen as one Box a line and one Text in it: each cell padded with spaces
 * to its width (width.ts counts them), so the columns line up as Boxes of a
 * fixed width would, at a node a span rather than three a cell. A Client's
 * tree is checked and shipped on every tick, within a second and under
 * 100,000 characters: a Box a cell crossed both on a wide board.
 */
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
        <Box key={`l${i}`} height={1} width={width}>
          <Text wrap="truncate-end">{drawLine(els, line)}</Text>
        </Box>
      ))}
    </Box>
  );
}
