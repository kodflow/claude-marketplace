// conformance.ts — replays the corpus recorded from tasks.py on the port,
// then the user's tasks (conformance.human.corpus.ts), added after it.
//
// One change since is deliberate: a subject holds 30 characters, not 40, to
// keep the task tree's title short. The corpus is replayed amended for it
// (AMEND: its long subjects shortened, its limits and its refusal text
// moved), every other byte as recorded; the two tools whose text changed
// keep every argument tasks.py gave them (CHANGED).
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
  "subject is 31 characters, the limit is 30: it is the title column of the task tree and is shown in full on the status line.";

/** The corpus' text with the 30-character subject in place of the 40. */
const AMEND: readonly [RegExp, string][] = [
  [/(?<!x)x{41}(?!x)/g, "x".repeat(31)],
  [/(?<!x)x{40}(?!x)/g, "x".repeat(30)],
  [/(?<!y)y{41}(?!y)/g, "y".repeat(31)],
  [/(?:😀){41}/gu, "😀".repeat(31)],
  [/(?:😀){40}/gu, "😀".repeat(30)],
  [new RegExp(OLD_REFUSAL, "g"), NEW_REFUSAL],
];

export function amended(corpus: unknown): unknown {
  let text = JSON.stringify(corpus);
  for (const [from, to] of AMEND) text = text.replace(from, to);
  return JSON.parse(text);
}

/** The tools whose description and subject limit moved since tasks.py. */
const CHANGED = new Set(["task_create", "task_update"]);

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
export function conformance(): { calls: number; failures: string[] } {
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
  const scenarios = amended([...CORPUS, ...HUMAN_CORPUS]) as any[];
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
  return { calls, failures };
}
