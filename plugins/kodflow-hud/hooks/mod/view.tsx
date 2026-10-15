// view.tsx — the « Agents » pane's tree, from plain data. No `$`: the
// elements come in from the surface's table (`$.ui.resolve(e)`) and the size
// from the pane's own props, so a test can draw it at any width. The
// « Tâches » pane is drawn by layout.tsx (the tree and the graph), in its
// surface module client.tsx.
//
// For each loop, where it works and the files it last read (violet), wrote
// (orange) or committed (green), as filetree colours them.

import type { HudActivity, HudAgent, HudOp } from "../../types";
import { LIVE, MAIN, activityOf } from "./board.ts";
import { shortFile, tilde } from "./paths.ts";

/** The two elements every surface's table has, all these trees use. */
export type Els = { Box: any; Text: any };

export const OP_COLOR: Record<HudOp, string> = {
  read: "#af87ff",
  write: "#ff8700",
  commit: "#5faf5f",
};
const OP_MARK: Record<HudOp, string> = { read: "R", write: "W", commit: "C" };

/** Columns from which an agent's row shows the time of its last call. */
export const WIDE = { age: 48 } as const;

const stateColor = (state: string): string =>
  state === "running" || state === MAIN
    ? "success"
    : LIVE.has(state)
      ? "warning"
      : "inactive";

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
