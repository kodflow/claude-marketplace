// view.tsx — the two panes' trees, from plain data. No `$`: the elements
// come in from the surface's table (`$.ui.resolve(e)`) and the size from the
// pane's own props, so a test can draw them at any width.
//
// The vocabulary is the status line's (internal/presentation/renderer): an
// epic is its title and done/total in mauve; ■ a task done, an amber ■ the
// task under way, □ one left to do. What the status line does not draw is
// added here: who works each task and how that worker stands, how long since
// it last moved, the silent flag, the tasks waiting on the person, and where
// each agent works. Below a width, columns drop off from the right; below
// the pane's height, completed tasks fold into one line per epic.

import type {
  HudActivity,
  HudAgent,
  HudBoard,
  HudCi,
  HudOp,
  HudTask,
} from "../../types";
import {
  LIVE,
  MAIN,
  activityOf,
  ago,
  humanTasks,
  judge,
  loopLabel,
  type Ctx,
} from "./board.ts";
import { shortFile, tilde } from "./paths.ts";

/** The two elements every surface's table has, all these trees use. */
export type Els = { Box: any; Text: any };

export const MAUVE = "#d7afd7"; // the status line's epic ground, 256-colour 182
export const AMBER = "#d78700"; // the cell under way
export const OP_COLOR: Record<HudOp, string> = {
  read: "#af87ff",
  write: "#ff8700",
  commit: "#5faf5f",
};
const OP_MARK: Record<HudOp, string> = { read: "R", write: "W", commit: "C" };

/** Columns at which the rows gain a field, narrowest first. */
export const WIDE = { age: 48, worker: 76, human: 100 } as const;

const ICON: Record<string, { glyph: string; color?: string; dim?: boolean }> = {
  completed: { glyph: "■", dim: true },
  in_progress: { glyph: "■", color: AMBER },
  waiting: { glyph: "◇", color: "warning" },
  pending: { glyph: "□" },
};

const stateColor = (state: string): string =>
  state === "running" || state === MAIN
    ? "success"
    : LIVE.has(state)
      ? "warning"
      : "inactive";

const CI_MARK: Record<string, { text: string; color: string } | undefined> = {
  pass: { text: "CI ✓", color: "success" },
  fail: { text: "CI ✗", color: "error" },
  pending: { text: "CI …", color: "warning" },
  error: { text: "CI ?", color: "inactive" },
  none: undefined,
};

export type TasksData = {
  board: HudBoard;
  ctx: Ctx;
  ci: Readonly<Record<string, HudCi>>;
};

function taskRow(
  { Box, Text }: Els,
  task: HudTask,
  data: TasksData,
  width: number,
  prefix = "task",
) {
  const icon = ICON[task.status] ?? ICON.pending!;
  const v = judge(task, data.ctx);
  const wide = width >= WIDE.worker;
  const meta: any[] = [];
  if (wide && (task.workerId || task.agent !== MAIN)) {
    meta.push(
      <Text color={stateColor(v.state)}>● </Text>,
      <Text dimColor>
        {task.worker || loopLabel(v.loop, data.ctx.agents)} {v.state}{" "}
      </Text>,
    );
  }
  if (width >= WIDE.age && task.status !== "completed")
    meta.push(<Text dimColor>{ago(data.ctx.now - v.last)}</Text>);
  if (v.silent)
    meta.push(
      <Text color="error" bold>
        {wide ? " silencieux" : " !"}
      </Text>,
    );
  if (wide)
    for (const pr of task.prs) {
      const mark = CI_MARK[data.ci[pr]?.state ?? "none"];
      if (mark) meta.push(<Text color={mark.color}> {mark.text}</Text>);
    }
  return (
    <Box key={`${prefix}-${task.id}`} flexDirection="row">
      <Text
        {...(icon.color && { color: icon.color })}
        {...(icon.dim && { dimColor: true })}
      >
        {icon.glyph}{" "}
      </Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor={task.status === "completed"} wrap="truncate-end">
          #{task.id} {task.subject}
        </Text>
      </Box>
      {meta.length > 0 && (
        <Box flexShrink={0} paddingLeft={1}>
          {meta}
        </Box>
      )}
    </Box>
  );
}

/** Lines the board takes with every task shown. */
const fullLines = (board: HudBoard): number =>
  board.epics.reduce((n, e) => n + 1 + e.tasks.length, 0);

function board(els: Els, data: TasksData, width: number, rows: number) {
  const { Box, Text } = els;
  if (!data.board.found)
    return (
      <Text dimColor>
        Aucune liste de tâches pour cette session (kodflow-hooks la tient).
      </Text>
    );
  if (data.board.epics.length === 0)
    return <Text dimColor>Aucun epic ouvert.</Text>;
  const fold = fullLines(data.board) > rows;
  return (
    <Box flexDirection="column">
      {data.board.epics.map((epic) => {
        const done = epic.tasks.filter((t) => t.status === "completed");
        const shown = fold
          ? epic.tasks.filter((t) => t.status !== "completed")
          : epic.tasks;
        const owner =
          epic.agent !== MAIN && width >= WIDE.worker
            ? ` · ${loopLabel(epic.agent, data.ctx.agents)}`
            : "";
        return (
          <Box key={`epic-${epic.id}`} flexDirection="column">
            <Text color={MAUVE} bold wrap="truncate-end">
              {epic.id ? `#${epic.id} ` : ""}
              {epic.title || `#${epic.id}`} {done.length}/{epic.tasks.length}
              {owner}
            </Text>
            {fold && done.length > 0 && (
              <Text dimColor>
                ■ {done.length} terminée{done.length > 1 ? "s" : ""}
              </Text>
            )}
            {shown.map((t) => taskRow(els, t, data, width))}
          </Box>
        );
      })}
    </Box>
  );
}

function humans(els: Els, list: HudTask[], data: TasksData, width: number) {
  const { Box, Text } = els;
  return (
    <Box key="human" flexDirection="column">
      <Text bold>Pour toi ({list.length})</Text>
      {list.map((t) => taskRow(els, t, data, width, "human"))}
    </Box>
  );
}

/** The « Tâches » pane: the open epics, and the person's tasks apart. */
export function tasksView(
  els: Els,
  data: TasksData,
  width: number,
  rows: number,
) {
  const { Box } = els;
  const mine = humanTasks(data.board);
  if (mine.length === 0)
    return (
      <Box key="tasks" flexDirection="column">
        {board(els, data, width, rows)}
      </Box>
    );
  if (width >= WIDE.human) {
    const side = Math.min(40, Math.floor(width / 3));
    return (
      <Box key="tasks" flexDirection="row">
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {board(els, data, width - side - 1, rows)}
        </Box>
        <Box flexDirection="column" width={side} flexShrink={0} paddingLeft={1}>
          {humans(els, mine, data, side - 1)}
        </Box>
      </Box>
    );
  }
  return (
    <Box key="tasks" flexDirection="column">
      {board(els, data, width, rows - mine.length - 1)}
      {humans(els, mine, data, width)}
    </Box>
  );
}

export type AgentsData = {
  agents: readonly HudAgent[];
  activity: Readonly<Record<string, HudActivity>>;
  now: number;
  home: string | undefined;
};

/** HH:MM:SS of a time, local. */
export const clock = (ms: number): string => {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};

/** How long an agent with no file left and no loop running stays listed. */
export const AGENT_LINGER_MS = 30 * 60_000;

type Row = { id: string; label: string; state: string; act?: HudActivity };

/** The loops to list: the main one and every agent alive or recently busy. */
export function agentRows(data: AgentsData): Row[] {
  const rows: Row[] = [];
  const main = data.activity[MAIN];
  if (main) rows.push({ id: MAIN, label: "principal", state: MAIN, act: main });
  const listed = new Set<string>();
  for (const a of data.agents) {
    listed.add(a.id);
    const act = activityOf(data.activity, a.id);
    const recent = act && data.now - act.last < AGENT_LINGER_MS;
    if (!LIVE.has(a.status) && !recent) continue;
    rows.push({
      id: a.id,
      label: a.label,
      state: a.status,
      ...(act && { act }),
    });
  }
  // Activity from a loop no list names (a workflow's agents, an engine fork)
  for (const act of Object.values(data.activity)) {
    if (act.agentId === MAIN || listed.has(act.agentId)) continue;
    if (data.now - act.last >= AGENT_LINGER_MS) continue;
    rows.push({
      id: act.agentId,
      label: act.agentId.slice(0, 8),
      state: "absent",
      act,
    });
  }
  const head = rows[0]?.id === MAIN ? rows.splice(0, 1) : [];
  rows.sort((a, b) => (b.act?.last ?? 0) - (a.act?.last ?? 0));
  return [...head, ...rows];
}

/** The « Agents » pane: per loop, its folder, its last files, its last call. */
export function agentsView(
  { Box, Text }: Els,
  data: AgentsData,
  width: number,
  rows: number,
) {
  const list = agentRows(data);
  if (list.length === 0)
    return <Text dimColor>Aucune activité pour l'instant.</Text>;
  // Room for files: what the headers leave, shared out, at most five each
  const perAgent = Math.max(
    0,
    Math.min(5, Math.floor((rows - list.length) / list.length)),
  );
  const showTime = width >= WIDE.age;
  return (
    <Box key="agents" flexDirection="column">
      {list.map((row) => (
        <Box key={`agent-${row.id}`} flexDirection="column">
          <Box flexDirection="row">
            <Text color={stateColor(row.state)}>● </Text>
            <Text bold>{row.label} </Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor wrap="truncate-start">
                {row.act?.dir ? tilde(row.act.dir, data.home) : "—"}
              </Text>
            </Box>
            {showTime && (
              <Box flexShrink={0} paddingLeft={1}>
                <Text dimColor>
                  {row.act ? clock(row.act.last) : row.state}
                </Text>
              </Box>
            )}
          </Box>
          {(row.act?.files ?? []).slice(0, perAgent).map((f) => (
            <Box
              key={`file-${row.id}-${f.path}`}
              flexDirection="row"
              paddingLeft={2}
            >
              <Text color={OP_COLOR[f.op]}>{OP_MARK[f.op]} </Text>
              <Text color={OP_COLOR[f.op]} wrap="truncate-start">
                {tilde(shortFile(f.path, row.act?.dir), data.home)}
              </Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
