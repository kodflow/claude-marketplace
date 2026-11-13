// conformance.ts — replays the corpus recorded from tasks.py on the port,
// then the user's tasks (conformance.human.corpus.ts), added after it.
//
// The changes since are deliberate, and the corpus is replayed amended for
// them, every other byte as recorded:
// - a subject holds 30 characters, not 40, to keep the task tree's title
//   short (AMEND: its long subjects shortened, its limits moved);
// - no refusal promises the status line any more (AMEND: the subject and
//   title refusals reworded);
// - a subagent has no epic of its own (AMEND per step: the refusals a
//   subagent reads send it to epic=0, not to task_epic; the scenario where
//   one opened its own epics is retired, its refusal tested apart);
// - a task keeps `workers`, every agent id an accepted worker= named
//   (amendState: from the first acceptance in a scenario, the field is in
//   the state after that step and before and after every later one);
// - task_epic and task_focus describe the epic lifecycle (close, reopen)
//   and task_create and task_update the tree: the four keep every argument
//   tasks.py gave them (CHANGED).
//
// Pure: run by tasks.test.ts under `claude plugin test` and by run-node.ts
// under plain node, so the parity holds wherever either is available.
import {
  MAIN,
  TOOLS as PORTED,
  isTaskError,
  parse,
  plan,
  serialize,
  type ToolName,
  type Worker,
} from "../../hooks/mod/tasks.ts";
import { safe } from "../../hooks/mod/paths.ts";
import { CORPUS, TOOLS as RECORDED } from "./conformance.corpus.ts";
import { HUMAN_CORPUS } from "./conformance.human.corpus.ts";

type Answer = { error: boolean; text: string };

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== typeof b ||
    a === null ||
    b === null ||
    typeof a !== "object"
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.hasOwn(b as object, k) && equal((a as any)[k], (b as any)[k]),
  );
}

// A file the corpus planted malformed compares as its text
function loose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** One call through the port, on the file's text; the new text when it wrote. */
export function call(
  file: string | undefined,
  tool: ToolName,
  agent: string,
  args: Record<string, unknown>,
  now: number,
  workers: readonly Worker[],
): { answer: Answer; file: string | undefined } {
  try {
    const step = plan(tool, agent, args);
    const data = parse(file, now);
    const text = step.run(data, { now, workers });
    return {
      answer: { error: false, text },
      file: step.mutates ? serialize(data) : file,
    };
  } catch (err) {
    if (isTaskError(err))
      return { answer: { error: true, text: err.message }, file };
    throw err;
  }
}

const OLD_REFUSAL =
  "subject is 41 characters, the limit is 40: it is shown in full on the status line.";
const NEW_REFUSAL =
  "subject is 31 characters, the limit is 30: it is the title column of the task tree.";
const OLD_TITLE = "it is the label of a pill on the status line.";
const NEW_TITLE = "it is the label of the epic in the task tree.";

/** The corpus' text with the 30-character subject in place of the 40. */
const AMEND: readonly [RegExp, string][] = [
  [/(?<!x)x{41}(?!x)/g, "x".repeat(31)],
  [/(?<!x)x{40}(?!x)/g, "x".repeat(30)],
  [/(?<!y)y{41}(?!y)/g, "y".repeat(31)],
  [/(?:😀){41}/gu, "😀".repeat(31)],
  [/(?:😀){40}/gu, "😀".repeat(30)],
  [new RegExp(OLD_REFUSAL, "g"), NEW_REFUSAL],
  [new RegExp(OLD_TITLE, "g"), NEW_TITLE],
];

/** The scenario whose subagent opened epics of its own: refused since. */
export const RETIRED = ["subagent_uses_its_own_epics"] as const;

// What a subagent read when it was sent to an epic, and what it reads now
const SUB_FROM = [
  "task_create(subject, epic=<id>) files the task in one of your epics; epic=0 files it outside any epic; task_epic(title) opens a new epic first.",
  "Open a new one with task_epic.",
];
const SUB_TO =
  "Epics are the main agent's: a subagent files its tasks with task_create(subject, epic=0).";

/** One step's answer as a subagent reads it now. */
function amendSubagent(step: any): boolean {
  if (step.agent === MAIN || typeof step.text !== "string") return false;
  let text = step.text as string;
  for (const from of SUB_FROM) text = text.split(from).join(SUB_TO);
  if (text === step.text) return false;
  step.text = text;
  return true;
}

/** How much of the corpus the amendments touched, asserted by the tests. */
export type Amended = {
  /** worker= starts accepted, each adding its id to a task's workers */
  accepted: number;
  /** steps whose recorded state gained `workers` */
  steps: number;
  /** states (before or after) that gained it */
  states: number;
  /** scenarios with an accepted worker= */
  scenarios: number;
  /** scenarios whose subagent refusals were reworded */
  subagent: number;
  retired: number;
};

/**
 * Carry `workers` forward through one scenario: from the first accepted
 * worker= start, every task it named holds the ids, in order of acceptance,
 * in the after of that step and the before and after of every later one.
 */
function amendState(scenario: any, stats: Amended): void {
  const held = new Map<string, string[]>();
  const key = (session: string, agent: unknown, id: unknown) =>
    `${session}\t${String(agent ?? MAIN)}\t${String(id)}`;
  // The state with `workers` set on every task held, or undefined when none is
  const inject = (session: string, state: unknown): unknown => {
    if (state === null || (typeof state !== "string" && typeof state !== "object")) return undefined;
    const parsed: any = typeof state === "string" ? loose(state) : state;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tasks)) return undefined;
    let changed = false;
    for (const t of parsed.tasks) {
      const ids = held.get(key(session, t?.agent ?? MAIN, t?.id));
      if (ids) {
        t.workers = [...ids];
        changed = true;
      }
    }
    if (!changed) return undefined;
    // a state recorded as text is compared as JSON (loose): written back as text
    return typeof state === "string" ? JSON.stringify(parsed) : parsed;
  };
  let touched = false;
  for (const step of scenario.steps) {
    if (!("tool" in step)) continue;
    let states = 0;
    const before = held.size ? inject(step.session, step.before) : undefined;
    if (before !== undefined) {
      step.before = before;
      states++;
    }
    if (
      !step.error &&
      step.tool === "task_update" &&
      step.args?.status === "in_progress" &&
      typeof step.args?.worker === "string" &&
      step.args.worker.trim() !== "" &&
      step.after
    ) {
      const id = String(step.args.id ?? "").trim().replace(/^#+/, "");
      const agent = step.agent === MAIN ? MAIN : safe(step.agent);
      const task = step.after.tasks.find(
        (t: any) => t.id === id && (t.agent ?? MAIN) === agent,
      );
      if (task?.worker_id) {
        const k = key(step.session, agent, id);
        const ids = held.get(k) ?? [];
        if (!ids.includes(task.worker_id)) ids.push(task.worker_id);
        held.set(k, ids);
        stats.accepted++;
        touched = true;
      }
    }
    const after = held.size ? inject(step.session, step.after) : undefined;
    if (after !== undefined) {
      step.after = after;
      states++;
    }
    if (states) {
      stats.steps++;
      stats.states += states;
    }
  }
  if (touched) stats.scenarios++;
}

/** The corpus as the port answers it now: retired scenarios out, amendments in. */
export function amendCorpus(corpus: readonly unknown[]): { scenarios: any[]; stats: Amended } {
  const stats: Amended = { accepted: 0, steps: 0, states: 0, scenarios: 0, subagent: 0, retired: 0 };
  const scenarios: any[] = [];
  for (const s of amended(corpus) as any[]) {
    if ((RETIRED as readonly string[]).includes(s.name)) {
      stats.retired++;
      continue;
    }
    let sub = false;
    for (const step of s.steps) if ("tool" in step && amendSubagent(step)) sub = true;
    if (sub) stats.subagent++;
    amendState(s, stats);
    scenarios.push(s);
  }
  return { scenarios, stats };
}

export function amended(corpus: unknown): unknown {
  let text = JSON.stringify(corpus);
  for (const [from, to] of AMEND) text = text.replace(from, to);
  return JSON.parse(text);
}

/** The tools whose description, limits or arguments moved since tasks.py. */
const CHANGED = new Set(["task_create", "task_update", "task_epic", "task_focus"]);

/** A changed tool still takes every argument tasks.py's did, as it did. */
function keepsArguments(ported: any, recorded: any): boolean {
  if (ported?.name !== recorded.name) return false;
  const want = recorded.inputSchema;
  const got = ported.inputSchema;
  if (!equal(got.required, want.required)) return false;
  return Object.entries(want.properties).every(([name, prop]: [string, any]) => {
    const now = got.properties[name];
    if (!now || now.type !== prop.type || !equal(now.enum, prop.enum)) return false;
    return name === "subject" || equal(now, prop);
  });
}

/** Every difference between the port and the corpus, as readable lines. */
export function conformance(): { calls: number; failures: string[]; stats: Amended } {
  const failures: string[] = [];
  let calls = 0;
  // The tools tasks.py had come first and are its own, word for word, but
  // the two the task tree changed
  (RECORDED as any[]).forEach((recorded, i) => {
    const ported = PORTED[i];
    const same = CHANGED.has(recorded.name)
      ? keepsArguments(ported, recorded)
      : equal(ported, recorded);
    if (!same)
      failures.push(`tools: ${recorded.name} differs from tasks.py`);
  });
  const { scenarios, stats } = amendCorpus([...CORPUS, ...HUMAN_CORPUS]);
  for (const scenario of scenarios) {
    const files = new Map<string, string | undefined>();
    let workers: Worker[] = [];
    scenario.steps.forEach((step: any, i: number) => {
      const where = `${scenario.name} #${i + 1}`;
      if ("file" in step) return void files.set("s1", step.file);
      if ("agents" in step) {
        workers = step.agents.map((a: any) => ({
          id: a.id,
          type: a.type,
          alive: a.alive,
          started: a.started,
        }));
        return;
      }
      calls++;
      const before = files.get(step.session);
      if (
        !equal(
          before === undefined ? null : loose(before),
          step.before === null ? null : loose(step.before),
        )
      ) {
        failures.push(`${where}: state before differs`);
      }
      const agent = step.agent === MAIN ? MAIN : safe(step.agent);
      const got = call(before, step.tool, agent, step.args, step.now, workers);
      files.set(step.session, got.file);
      if (got.answer.error !== step.error || got.answer.text !== step.text) {
        failures.push(
          `${where} ${step.tool}: answer differs\n  want ${JSON.stringify({ error: step.error, text: step.text })}\n  got  ${JSON.stringify(got.answer)}`,
        );
      }
      const after = got.file === undefined ? null : JSON.parse(got.file);
      if (!equal(after, step.after)) {
        failures.push(
          `${where} ${step.tool}: state after differs\n  want ${JSON.stringify(step.after)}\n  got  ${JSON.stringify(after)}`,
        );
      }
    });
  }
  return { calls, failures, stats };
}
