// conformance.ts — replays the corpus recorded from tasks.py on the port.
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

/** Every difference between the port and the corpus, as readable lines. */
export function conformance(): { calls: number; failures: string[] } {
  const failures: string[] = [];
  let calls = 0;
  if (!equal(PORTED, RECORDED))
    failures.push("tools: names, descriptions or schemas differ from tasks.py");
  for (const scenario of CORPUS as any[]) {
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
