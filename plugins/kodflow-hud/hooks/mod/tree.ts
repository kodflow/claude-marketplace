// tree.ts — the task tree the « Tâches » pane draws, derived from the board.
// Pure: no `$`, no I/O; what it returns is plain data, handed whole to the
// pane's surface module (client.tsx) as its props.
//
// Nothing here is typed by anyone: the states the tree shows beyond
// tasks.json's own statuses are read off the links kodflow-hooks keeps
// (`parent`, `blockedBy`):
//   ready    ▶ pending, every blocker completed, nobody on it: a task at the
//              top, or under a parent already completed;
//   blocked  ⊘ pending, at least one blocker not completed;
//   todo     ○ pending under a parent not completed: whoever takes the
//              parent takes it, so it is nobody's to pick up on its own.
// The critical path is the longest blockedBy chain of tasks not completed,
// down to the epic's final tasks (the ones nothing waits on); every task on
// a chain of that length is on it. A list with no link has none.
//
// A subagent's own tasks are no rows of the tree: the task it was handed
// (its `workers`, the anchor board.ts picks) carries one read-only summary
// of them, `helpers` (how many, the one under way, the ones whose agent
// stopped), outside the depth, the counts and the critical path. Those whose
// subagent no task names form one more group, « Sous-agents », which counts
// its stopped ones too.

import type { HudBoard, HudCi, HudEpic, HudModel, HudTask } from "../../types";
import { MAIN, UNKNOWN, anchorOf, judge, loopLabel, type Ctx } from "./board.ts";
import { MAIN_NAME, colorOf, roleOf } from "./who.ts";
import { cells, fit } from "./width.ts";
import { modelKey } from "./models.ts";

export type NodeState =
  "done" | "run" | "you" | "wait" | "ready" | "blocked" | "todo";

/** One task as a row of the tree: every cell already worded. */
export type TreeNode = {
  id: string;
  /** How links and footers name it: its ref, else #id. */
  label: string;
  title: string;
  state: NodeState;
  /** Who works it: a subagent's name, "principal", "toi", "prête"; "" for nobody. */
  agent: string;
  /** What `agent` names: the main loop, a subagent, the person, nobody yet. */
  agentKind: "main" | "sub" | "you" | "ready" | "";
  /** The subagent's role, its type short (who.ts); "" when unknown. */
  role: string;
  /** The loop's colour (who.ts), for the main loop and the subagents. */
  agentColor?: string;
  /** model·effort of that loop, "" when the session never said. */
  model: string;
  /** Since it last moved; "" for a task nobody has taken. */
  age: string;
  silent: boolean;
  /** "⇠ C6 C7" what it waits on, else "⇢ C9" what it unblocks. */
  links: string;
  crit: boolean;
  desc: string;
  /** "CI ✓" and the like, for a cited pull request. */
  ci: string;
  kids: TreeNode[];
  /**
   * The subagents' own tasks hanging on this one (its `workers`): how many,
   * how many done, the one under way, how many left by a stopped agent, and
   * whether the agents' standing could not be read. Absent when none.
   */
  helpers?: {
    total: number;
    done: number;
    current?: string;
    stopped: number;
    unknown?: boolean;
  };
};

/** The group of the subagents' tasks no task names: its id. */
export const HELPERS_GROUP = -1;
export const HELPERS_TITLE = "Sous-agents";

export type TreeEpic = {
  /** The epic's id; 0 the tasks under no epic, -1 the « Sous-agents » group. */
  id: number;
  title: string;
  /** The main agent's active epic, marked in place. */
  active?: boolean;
  /** Nothing moved for 24 h: one line until the person opens it. */
  idle?: boolean;
  /** « Sous-agents »: tasks left by a stopped agent, counted, not drawn. */
  stopped?: number;
  done: number;
  total: number;
  age: string;
  nodes: TreeNode[];
  /** The critical path's chains, each a list of its tasks, top level first. */
  chains: { label: string; state: NodeState }[][];
  /** The task of the person's the epic waits on, and whether on the path. */
  you?: { label: string; age: string; crit: boolean };
  /** The first ready task, on the path first. */
  next?: { label: string; title: string };
  /** Where the epic ends: its final task on the path, else its last. */
  goal?: { label: string; title: string; state: NodeState; note: string };
};

export type TreeModel = { found: boolean; epics: TreeEpic[] };

export type TreeData = {
  board: HudBoard;
  ctx: Ctx;
  ci: Readonly<Record<string, HudCi>>;
  models: Readonly<Record<string, HudModel>>;
  /** The session the board was read for: the model keys carry it. */
  session: string;
};

/** "45 s", "12 min", "1 h 20", "12 h", "3 j": six cells at most. */
export function span(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 10)
    return m % 60 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${h} h`;
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

const FAMILY = /\b(opus|sonnet|haiku|fable)\b/i;
const EFFORT: Record<string, [string, string]> = {
  low: ["low", "lo"],
  medium: ["med", "med"],
  high: ["high", "hi"],
  xhigh: ["xhigh", "xhi"],
  max: ["max", "max"],
};
export const MODEL_CELLS = 10;

/** "opus·xhigh", "sonnet·hi", "haiku": a model id and an effort, in ten cells. */
export function modelCell(m: HudModel | undefined): string {
  if (!m?.model) return "";
  const family = FAMILY.exec(m.model)?.[1]?.toLowerCase() ?? m.model;
  if (!m.effort) return fit(family, MODEL_CELLS);
  const [long, short] = EFFORT[m.effort] ?? [m.effort, m.effort];
  const full = `${family}·${long}`;
  if (cells(full) <= MODEL_CELLS) return full;
  return fit(`${family}·${short}`, MODEL_CELLS);
}

const AGENT_PREFIX = /^[\w.-]+:(developer-)?/;
export const AGENT_CELLS = 22;
/** What the role keeps at least beside a long name, in the agent column. */
const ROLE_MIN = 7;

/** An agent's name, the plugin prefix of a type used as a name dropped. */
export const agentName = (name: string): string =>
  name.replace(AGENT_PREFIX, "");

/** A role in the narrow agent column: a specialist's topic, a type's head. */
export function roleCell(role: string): string {
  if (!role) return "";
  const topic = role.split(" · ").pop()!;
  return topic === "general-purpose" ? "general" : topic;
}

/**
 * The agent column's two parts, the name and the role, cut to share `room`
 * cells around a « · » of three: the role keeps up to seven, the name the
 * rest; a role with no room for four cells is left out.
 */
export function agentParts(
  name: string,
  role: string,
  room: number,
): { name: string; role: string } {
  if (!role || cells(name) + 3 + cells(role) <= room)
    return { name: fit(name, room), role: role && fit(role, room) };
  const roleW = Math.min(cells(role), ROLE_MIN, room - 3 - 4);
  if (roleW < 4) return { name: fit(name, room), role: "" };
  const nameW = Math.min(cells(name), room - 3 - roleW);
  return { name: fit(name, nameW), role: fit(role, room - 3 - nameW) };
}

export const LINK_CELLS = 10;

/** "⇠ C6 C7 C8", three labels then "+n", in fourteen cells. */
export function linkCell(arrow: string, labels: string[]): string {
  if (!labels.length) return "";
  const shown = labels.slice(0, 3);
  const more = labels.length - shown.length;
  let text = `${arrow} ${shown.join(" ")}${more ? ` +${more}` : ""}`;
  while (cells(text) > LINK_CELLS && shown.length > 1) {
    shown.pop();
    text = `${arrow} ${shown.join(" ")} +${labels.length - shown.length}`;
  }
  return fit(text, LINK_CELLS);
}

const CI_TEXT: Record<string, string> = {
  pass: "CI ✓",
  fail: "CI ✗",
  pending: "CI …",
  error: "CI ?",
};

const done = (t: HudTask) => t.status === "completed";
const labelOf = (t: HudTask) => t.ref || `#${t.id}`;

/** The longest blockedBy chains of unfinished tasks, and who is on them. */
function criticalPath(
  tasks: readonly HudTask[],
  byId: ReadonlyMap<string, HudTask>,
): { onPath: Set<string>; chains: string[][] } {
  const open = tasks.filter((t) => !done(t));
  const openIds = new Set(open.map((t) => t.id));
  const blockers = (t: HudTask) =>
    (t.blockedBy ?? []).filter((id) => openIds.has(id) && id !== t.id);
  const dependents = new Map<string, string[]>();
  for (const t of open)
    for (const b of blockers(t))
      dependents.set(b, [...(dependents.get(b) ?? []), t.id]);
  // Longest chain from a task down to a final one, and up to a first one;
  // a cycle in a hand-edited file counts once, never forever
  const memo = (next: (id: string) => string[]) => {
    const got = new Map<string, number>();
    const walk = (id: string, path: Set<string>): number => {
      const known = got.get(id);
      if (known !== undefined) return known;
      if (path.has(id)) return 0;
      path.add(id);
      let best = 1;
      for (const n of next(id)) best = Math.max(best, 1 + walk(n, path));
      path.delete(id);
      got.set(id, best);
      return best;
    };
    return (id: string) => walk(id, new Set());
  };
  const down = memo((id) => dependents.get(id) ?? []);
  const up = memo((id) => blockers(byId.get(id)!));
  let longest = 0;
  for (const t of open) longest = Math.max(longest, down(t.id));
  const onPath = new Set<string>();
  const chains: string[][] = [];
  if (longest < 2) return { onPath, chains };
  for (const t of open)
    if (up(t.id) + down(t.id) - 1 === longest) onPath.add(t.id);
  // The chains themselves, from each first task along the longest way down
  const follow = (id: string, left: number, acc: string[]) => {
    const here = [...acc, id];
    if (left === 1) return void chains.push(here);
    for (const n of dependents.get(id) ?? [])
      if (onPath.has(n) && down(n) === left - 1 && chains.length < 8)
        follow(n, left - 1, here);
  };
  for (const t of open)
    if (onPath.has(t.id) && up(t.id) === 1) follow(t.id, longest, []);
  const top = (id: string) => !byId.get(id)?.parent;
  chains.sort((a, b) => Number(b.every(top)) - Number(a.every(top)));
  return {
    onPath,
    chains,
  };
}

/**
 * The tree of every open epic: tasks under their parent (a parent from
 * another epic, or none that exists, puts a task at the top), each with its
 * derived state, its loop, its model, its age and its links.
 */
export function buildTree(data: TreeData): TreeModel {
  const { board, ctx } = data;
  const mainTasks = board.epics.flatMap((e) => e.tasks);
  const helpers = board.helpers ?? [];
  // Each subagent's tasks under the task it was handed, if any is shown
  const anchorFor = new Map<string, HudTask | undefined>();
  const anchored = (agent: string) => {
    if (!anchorFor.has(agent)) anchorFor.set(agent, anchorOf(mainTasks, agent));
    return anchorFor.get(agent);
  };
  const helpersOf = (t: HudTask): TreeNode["helpers"] => {
    const mine = helpers.filter((h) => anchored(h.agent) === t);
    if (!mine.length) return undefined;
    const shown = mine.filter((h) => !h.stopped);
    const run = shown.find((h) => h.status === "in_progress");
    const out: NonNullable<TreeNode["helpers"]> = {
      total: shown.length,
      done: shown.filter(done).length,
      stopped: mine.length - shown.length,
    };
    if (run) out.current = `${labelOf(run)} ${run.subject}`;
    if (ctx.liveness === UNKNOWN) out.unknown = true;
    return out;
  };
  const loose = helpers.filter((h) => !anchored(h.agent));
  const groups: HudEpic[] = [...board.epics];
  if (loose.length)
    groups.push({
      id: HELPERS_GROUP,
      title: HELPERS_TITLE,
      agent: "",
      created: 0,
      touched: 0,
      tasks: loose.filter((h) => !h.stopped),
    });
  const epics = groups.map((epic) => {
    const tasks = epic.tasks;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const { onPath, chains: pathIds } = criticalPath(tasks, byId);
    const unblocks = new Map<string, string[]>();
    for (const t of tasks)
      for (const b of t.blockedBy ?? [])
        unblocks.set(b, [...(unblocks.get(b) ?? []), t.id]);
    const waitsOn = (t: HudTask) =>
      (t.blockedBy ?? []).filter((id) => byId.has(id) && !done(byId.get(id)!));
    const parentOf = (t: HudTask) =>
      t.parent && t.parent !== t.id ? byId.get(t.parent) : undefined;

    const stateOf = (t: HudTask): NodeState => {
      if (done(t)) return "done";
      if (t.status === "in_progress") return "run";
      // The person's task is theirs whatever its status says
      if (t.assignee === "human" || t.status === "waiting")
        return t.assignee === "human" ? "you" : "wait";
      if (waitsOn(t).length) return "blocked";
      const parent = parentOf(t);
      return parent && !done(parent) ? "todo" : "ready";
    };

    const node = (t: HudTask, depth: number, path: Set<string>): TreeNode => {
      const state = stateOf(t);
      const v = judge(t, ctx);
      // The worker on it now, else the last one it was handed to
      const workerId = t.workerId || t.workers?.[t.workers.length - 1];
      const worker = t.worker;
      const loop = workerId || t.agent;
      let agent = "";
      let agentKind: TreeNode["agentKind"] = "";
      let role = "";
      if (state === "you") {
        agent = "toi";
        agentKind = "you";
      } else if (state === "ready") {
        agent = "prête";
        agentKind = "ready";
      } else if (state === "run" || state === "done" || state === "wait") {
        // A worker named with no id is still a subagent, known by its name
        if (loop === MAIN && (!worker || worker === MAIN)) {
          agent = MAIN_NAME;
          agentKind = "main";
        } else {
          const listed =
            ctx.agents.find((a) => a.id === loop) ??
            (loop === MAIN
              ? ctx.agents.find((a) => a.name === worker)
              : undefined);
          agent = agentName(
            listed?.name || worker || loopLabel(loop, ctx.agents),
          );
          role = roleOf(listed?.type);
          agentKind = "sub";
        }
      }
      const model =
        state === "run" || state === "done" || state === "wait"
          ? modelCell(data.models[modelKey(data.session, loop)])
          : "";
      let age = "";
      if (state === "run") age = span(ctx.now - v.last);
      else if (state === "done" || state === "you" || state === "wait")
        age = span(ctx.now - t.updated * 1000);
      const waits = waitsOn(t).map((id) => labelOf(byId.get(id)!));
      const frees = (unblocks.get(t.id) ?? [])
        .filter((id) => byId.has(id))
        .map((id) => labelOf(byId.get(id)!));
      const links = waits.length ? linkCell("⇠", waits) : linkCell("⇢", frees);
      const ci =
        t.prs
          .map((pr) => CI_TEXT[data.ci[pr]?.state ?? ""] ?? "")
          .find((c) => c) ?? "";
      path.add(t.id);
      const kids =
        depth < 3
          ? tasks
              .filter(
                (k) =>
                  parentOf(k) === t && !path.has(k.id) && !topIds.has(k.id),
              )
              .map((k) => node(k, depth + 1, path))
          : [];
      path.delete(t.id);
      const hang = epic.id === HELPERS_GROUP ? undefined : helpersOf(t);
      return {
        id: t.id,
        label: labelOf(t),
        title: t.subject,
        state,
        agent,
        agentKind,
        role,
        ...((agentKind === "main" || agentKind === "sub") && {
          agentColor: colorOf(
            agentKind === "sub" && loop === MAIN
              ? (ctx.agents.find((a) => a.name === worker)?.id ??
                  `name:${worker}`)
              : loop,
          ),
        }),
        model,
        age,
        silent: v.silent,
        links,
        crit: onPath.has(t.id),
        desc: t.description ?? "",
        ci,
        kids,
        ...(hang && { helpers: hang }),
      };
    };

    // A parent that is missing, in another epic or in a loop puts the task on top
    const rooted = (t: HudTask) => {
      const seen = new Set<string>([t.id]);
      for (let p = parentOf(t); p; p = parentOf(p)) {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
      }
      return true;
    };
    const tops = tasks.filter((t) => !parentOf(t) || !rooted(t));
    const topIds = new Set(tops.map((t) => t.id));
    const nodes = tops.map((t) => node(t, 1, new Set()));

    const topOf = (t: HudTask): HudTask => {
      const seen = new Set<string>();
      let cur = t;
      for (let p = parentOf(cur); p && !seen.has(p.id); p = parentOf(cur)) {
        seen.add(cur.id);
        cur = p;
      }
      return cur;
    };
    const edges: [string, string][] = [];
    for (const t of tasks)
      for (const b of t.blockedBy ?? []) {
        const from = byId.get(b);
        if (!from) continue;
        const pair: [string, string] = [topOf(from).id, topOf(t).id];
        if (
          pair[0] !== pair[1] &&
          !edges.some((e) => e[0] === pair[0] && e[1] === pair[1])
        )
          edges.push(pair);
      }

    const flat: TreeNode[] = [];
    const walk = (list: TreeNode[]) =>
      list.forEach((n) => (flat.push(n), walk(n.kids)));
    walk(nodes);
    const mine = flat.filter((n) => n.state === "you");
    const youNode = mine.find((n) => n.crit) ?? mine[0];
    const ready = flat.filter((n) => n.state === "ready");
    const nextNode =
      ready.find((n) => n.crit) ??
      ready.find((n) => tops.some((t) => t.id === n.id)) ??
      ready[0];
    const finals = nodes.filter((n) => !edges.some((e) => e[0] === n.id));
    const goalNode =
      finals.find((n) => n.crit) ??
      finals.find((n) => edges.some((e) => e[1] === n.id)) ??
      nodes[nodes.length - 1];
    let goal: TreeEpic["goal"];
    if (goalNode) {
      const note: Record<NodeState, string> = {
        done: "fait",
        run: "en cours",
        you: "t'attend",
        wait: "en attente",
        ready: "prête",
        blocked: goalNode.links.startsWith("⇠")
          ? `attend ${goalNode.links.slice(2)}`
          : "bloquée",
        todo: "à faire",
      };
      goal = {
        label: goalNode.label,
        title: goalNode.title,
        state: goalNode.state,
        note: note[goalNode.state],
      };
    }
    const doneCount = tasks.filter(done).length;
    const out: TreeEpic = {
      id: epic.id,
      title: epic.title || `#${epic.id}`,
      done: doneCount,
      total: tasks.length,
      age: epic.created ? span(ctx.now - epic.created * 1000) : "",
      nodes,
      chains: pathIds.map((c) =>
        c.map((id) => ({
          label: labelOf(byId.get(id)!),
          state: stateOf(byId.get(id)!),
        })),
      ),
    };
    if (epic.active) out.active = true;
    if (epic.idle) out.idle = true;
    if (epic.id === HELPERS_GROUP)
      out.stopped = loose.filter((h) => h.stopped).length;
    if (youNode)
      out.you = { label: youNode.label, age: youNode.age, crit: youNode.crit };
    if (nextNode) out.next = { label: nextNode.label, title: nextNode.title };
    if (goal) out.goal = goal;
    return out;
  });
  return { found: board.found, epics };
}
