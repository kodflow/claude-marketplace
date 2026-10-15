// view.tsx — the « Agents » pane, from plain data. No `$`: the elements come
// in from the surface's table (`$.ui.resolve(e)`) and the size from the
// pane's own props, so a test can draw it at any width. The « Tâches » pane
// is drawn by layout.tsx (the tree and the graph), in its surface module
// client.tsx; this one is laid out with the same cells, so its columns line
// up as the tree's do.
//
// The pane is about the subagents: register.tsx opens its tab only while one
// runs, and its title counts them. The main loop heads the list on one line,
// in the theme's `claude` colour, so the subagents read against it; each
// subagent then has its line in its own colour (who.ts, the same as in the
// tree's agent column): its name, its role (its type, short, or « type
// inconnu » when nothing said it), its model, and its state, a frozen one
// in red. Under it, the task it holds and the folder it works in, then the
// files it last read (violet), wrote (orange) or committed (green).
//
//   ─ 2 sous-agents en cours ───────────────────────────────────────────────
//     AGENT               RÔLE                    MODÈLE      ÉTAT
//   ◉ principal           fil principal           opus        ● actif · 3 s
//   ↳ hud-agents          general-purpose         opus·xhigh  ● actif · 15 s
//       ● #2 Rendu des agents  ·  /w/repo
//       W src/view.tsx

import type {
  HudActivity,
  HudAgent,
  HudBoard,
  HudModel,
  HudOp,
  HudTask,
} from "../../types";
import { MAIN, activityOf } from "./board.ts";
import { cut, draw, type Cell, type Span } from "./layout.tsx";
import { modelKey } from "./models.ts";
import { safe, shortFile, tilde } from "./paths.ts";
import { modelCell, span as since } from "./tree.ts";
import { cells } from "./width.ts";
import {
  MAIN_COLOR,
  MAIN_NAME,
  RUNNING,
  colorOf,
  roleOf,
  running,
} from "./who.ts";

/** The two elements every surface's table has, all these trees use. */
export type Els = { Box: any; Text: any };

export const OP_COLOR: Record<HudOp, string> = {
  read: "#af87ff",
  write: "#ff8700",
  commit: "#5faf5f",
};
const OP_MARK: Record<HudOp, string> = { read: "R", write: "W", commit: "C" };

/** Under this long since its last call, a loop is « actif ». */
export const ACTIVE_MS = 60_000;
/** How long an agent that stopped stays listed, dimmed, under the others. */
export const AGENT_LINGER_MS = 30 * 60_000;

/** The columns: glyph, name, role, model, then the state takes the rest. */
export const AW = { glyph: 2, name: 18, role: 22, model: 10, gap: 2 } as const;
/** Widths from which the role, then the model, keep their column. */
export const AFULL = { role: 76, model: 56 } as const;

export type AgentsData = {
  agents: readonly HudAgent[];
  activity: Readonly<Record<string, HudActivity>>;
  now: number;
  home: string | undefined;
  models?: Readonly<Record<string, HudModel>>;
  session?: string;
  board?: HudBoard;
  /** How long a running loop may go without a call before it is « figé ». */
  silentMs?: number;
};

/** HH:MM:SS of a time, local. */
export const clock = (ms: number): string => {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};

type Tone = Omit<Span, "text">;
const sp = (text: string, tone: Tone = {}): Span => ({ text, ...tone });
const dim = (text: string): Span => ({ text, dim: true });
const cell = (w: number, spans: Span[] = []): Cell => ({
  w,
  spans: cut(spans, w),
});

export type AgentRow = {
  id: string;
  name: string;
  /** The role, its type short; "" when nothing said it. */
  role: string;
  color: string;
  status: string;
  /** Whether its loop is at work (the tab counts these). */
  live: boolean;
  act?: HudActivity;
  model: string;
  task?: { label: string; title: string };
  state: Span[];
};

/** How a loop stands, in a few words and one colour. */
function stateOf(
  status: string,
  act: HudActivity | undefined,
  now: number,
  silentMs: number,
): Span[] {
  const age = act ? ` · ${since(now - act.last)}` : "";
  if (status === "completed") return [dim(`✓ terminé${age}`)];
  if (status === "failed") return [sp(`✗ échec${age}`, { color: "error" })];
  if (status === "killed") return [sp(`✗ arrêté${age}`, { color: "error" })];
  if (status === "idle") return [dim(`◌ au repos${age}`)];
  if (status === "pending") return [dim("○ démarre")];
  if (status === "absent") return [dim(`◌ parti${age}`)];
  if (act && now - act.last >= silentMs)
    return [sp(`⏸ figé${age}`, { color: "error", bold: true })];
  if (status === "waiting")
    return [sp(`◇ attend${age}`, { color: "permission" })];
  if (act && now - act.last < ACTIVE_MS)
    return [sp(`● actif${age}`, { color: "success" })];
  return [sp(`● en cours${age}`, { color: "warning" })];
}

const sameLoop = (a: string | undefined, b: string) =>
  !!a && (a === b || safe(a) === safe(b));

/** The task a loop holds: in progress, handed to it, else filed by it. */
function heldBy(
  board: HudBoard | undefined,
  loop: string,
): HudTask | undefined {
  const tasks = (board?.epics ?? []).flatMap((e) => e.tasks);
  const doing = tasks.filter((t) => t.status === "in_progress");
  return (
    doing.find((t) => sameLoop(t.workerId, loop)) ??
    doing.find((t) => !t.workerId && sameLoop(t.agent, loop))
  );
}

/**
 * The loops to list: the main one first, then the subagents at work, most
 * recently busy first, then the ones that stopped within the last half hour.
 * A loop no list names (an engine fork, compaction) is not a subagent.
 */
export function agentRows(data: AgentsData): AgentRow[] {
  const silentMs = data.silentMs ?? 10 * 60_000;
  const model = (loop: string) =>
    modelCell(data.models?.[modelKey(data.session ?? "", loop)]);
  const task = (loop: string) => {
    const t = heldBy(data.board, loop);
    return t ? { label: t.ref || `#${t.id}`, title: t.subject } : undefined;
  };
  const main = data.activity[MAIN];
  const head: AgentRow = {
    id: MAIN,
    name: MAIN_NAME,
    role: "fil principal",
    color: MAIN_COLOR,
    status: "running",
    live: true,
    ...(main && { act: main }),
    model: model(MAIN),
    state: main ? stateOf("running", main, data.now, Infinity) : [dim("—")],
  };
  const t0 = task(MAIN);
  if (t0) head.task = t0;
  const subs: AgentRow[] = [];
  for (const a of data.agents) {
    const act = activityOf(data.activity, a.id);
    const live = RUNNING.has(a.status);
    if (!live && !(act && data.now - act.last < AGENT_LINGER_MS)) continue;
    const row: AgentRow = {
      id: a.id,
      name: a.name || a.label,
      role: roleOf(a.type),
      color: colorOf(a.id),
      status: a.status,
      live,
      ...(act && { act }),
      model: model(a.id),
      state: stateOf(a.status, act, data.now, silentMs),
    };
    const held = task(a.id);
    if (held) row.task = held;
    subs.push(row);
  }
  subs.sort(
    (a, b) =>
      Number(b.live) - Number(a.live) ||
      (b.act?.last ?? 0) - (a.act?.last ?? 0),
  );
  return [head, ...subs];
}

/** The section's title: how many subagents are at work, never « Agents ». */
export function agentsTitle(data: AgentsData): string {
  const n = running(data.agents).length;
  return n === 0
    ? "aucun sous-agent en cours"
    : `${n} sous-agent${n > 1 ? "s" : ""} en cours`;
}

function nameLine(r: AgentRow, width: number): Cell[] {
  const faint = r.id !== MAIN && !r.live;
  const tone: Tone = { color: r.color, ...(faint && { dim: true }) };
  const glyph = r.id === MAIN ? "◉" : "↳";
  const out: Cell[] = [
    cell(AW.glyph, [sp(glyph, tone)]),
    cell(AW.name, [sp(r.name, { ...tone, bold: r.live })]),
  ];
  let used = AW.glyph + AW.name;
  if (width >= AFULL.role) {
    out.push(
      cell(AW.gap),
      cell(AW.role, [r.role ? dim(r.role) : dim("type inconnu")]),
    );
    used += AW.gap + AW.role;
  }
  if (width >= AFULL.model) {
    out.push(
      cell(AW.gap),
      cell(AW.model, r.model ? [sp(r.model, { color: "ide" })] : []),
    );
    used += AW.gap + AW.model;
  }
  const rest = Math.max(0, width - used - AW.gap);
  out.push(cell(AW.gap), cell(rest, r.state));
  return out;
}

/** Under a loop: the task it holds, its folder, and the role when narrow. */
function whereLine(r: AgentRow, width: number, home: string | undefined) {
  const spans: Span[] = [];
  if (width < AFULL.role && r.id !== MAIN)
    spans.push(dim(r.role || "type inconnu"), dim("  ·  "));
  if (r.task)
    spans.push(
      sp("● ", { color: "warning" }),
      sp(`${r.task.label} `, { bold: true }),
      sp(r.task.title),
    );
  const dir = r.act?.dir ? tilde(r.act.dir, home) : "";
  if (dir) spans.push(dim(r.task ? `  ·  ${dir}` : dir));
  if (!spans.length) return undefined;
  const pad = 4;
  return [cell(pad), cell(Math.max(0, width - pad), spans)];
}

function fileLines(
  r: AgentRow,
  width: number,
  home: string | undefined,
  count: number,
): Cell[][] {
  const pad = 4;
  return (r.act?.files ?? []).slice(0, count).map((f) => [
    cell(pad),
    cell(2, [sp(OP_MARK[f.op], { color: OP_COLOR[f.op] })]),
    cell(Math.max(0, width - pad - 2), [
      sp(tilde(shortFile(f.path, r.act?.dir), home), {
        color: OP_COLOR[f.op],
      }),
    ]),
  ]);
}

function titleLine(text: string, width: number): Cell[] {
  const w = Math.min(cells(text), Math.max(0, width - 4));
  const rest = Math.max(0, width - 2 - w);
  const line = [cell(2, [dim("─ ")]), cell(w, [sp(text, { bold: true })])];
  if (rest > 1) line.push(cell(1), cell(rest - 1, [dim("─".repeat(rest - 1))]));
  return line;
}

function headerLine(width: number): Cell[] {
  const out: Cell[] = [cell(AW.glyph), cell(AW.name, [dim("AGENT")])];
  let used = AW.glyph + AW.name;
  if (width >= AFULL.role) {
    out.push(cell(AW.gap), cell(AW.role, [dim("RÔLE")]));
    used += AW.gap + AW.role;
  }
  if (width >= AFULL.model) {
    out.push(cell(AW.gap), cell(AW.model, [dim("MODÈLE")]));
    used += AW.gap + AW.model;
  }
  out.push(
    cell(AW.gap),
    cell(Math.max(0, width - used - AW.gap), [dim("ÉTAT")]),
  );
  return out;
}

/** The lines of the pane, `width` cells by at most `rows`. */
export function agentsLines(
  data: AgentsData,
  width: number,
  rows: number,
): Cell[][] {
  const list = agentRows(data);
  // What the rows hold, most kept first: each loop's line, then the title,
  // the task and folder lines, the headers, then the files shared out
  const fixed = list.length;
  const title = rows > fixed ? 1 : 0;
  const where = list.map((r) => whereLine(r, width, data.home));
  const whereAll = where.filter(Boolean).length;
  const showWhere = rows >= fixed + title + whereAll;
  const whereN = showWhere ? whereAll : 0;
  const header = rows >= fixed + title + whereN + 1 ? 1 : 0;
  const left = rows - fixed - title - whereN - header;
  const perAgent = Math.max(0, Math.min(3, Math.floor(left / list.length)));
  const out: Cell[][] = [];
  if (title) out.push(titleLine(agentsTitle(data), width));
  if (header) out.push(headerLine(width));
  list.forEach((r, i) => {
    out.push(nameLine(r, width));
    if (showWhere && where[i]) out.push(where[i]!);
    out.push(...fileLines(r, width, data.home, perAgent));
  });
  return out.slice(0, Math.max(0, rows));
}

/** The « Agents » pane: the main loop, then each subagent, as cells. */
export function agentsView(
  els: Els,
  data: AgentsData,
  width: number,
  rows: number,
) {
  return draw(
    els,
    {
      lines: agentsLines(data, width, rows),
      rowIds: [],
      tabsLine: -1,
      tabs: [],
      order: [],
    },
    width,
  );
}
