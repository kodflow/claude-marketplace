// invariants.ts — what must hold over the whole hooks module, read from its
// sources (node only: a plugin test reads no file). run-node.ts runs it.
//
//   - no hook ever answers allow (modwall's internal verdict excepted);
//   - { result } is built in three places only: a task tool's answer, the
//     output filter, the secret veil;
//   - register.ts reads exactly veil.ts's SECRET_VARS;
//   - mcp-probe.ts stays pure (it imports paths.ts only, builds no { result })
//     and never reads a text or data field of a result.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SECRET_VARS } from "../../hooks/mod/veil.ts";

// modwall.ts's judge() returns { allow: true } as its own verdict on a
// plugin; admit() turns it into "no refusal" and the hook answers next(e).
// No hook answer: the two occurrences of that one signature are expected.
const ALLOW_VERDICTS: Record<string, number> = { "modwall.ts": 2 };

const ALLOWED: Record<string, RegExp> = {
  "register.ts": /answer = \{ result: text \}/,
  "filter.ts": /return \{ \.\.\.r, result: \{ \.\.\.res, stdout \} \}/,
  "veil.ts": /return \{ \.\.\.r, result: v\.value \}/,
};

export function invariants(modDir: string): string[] {
  const bad: string[] = [];
  for (const f of readdirSync(modDir)) {
    if (!f.endsWith(".ts")) continue;
    const src = readFileSync(join(modDir, f), "utf8");
    const allows = src.match(/["']allow["']|allow:\s*true/g) ?? [];
    if (allows.length !== (ALLOW_VERDICTS[f] ?? 0))
      bad.push(`${f}: answers allow (${allows.join(", ")})`);
    // A value built, not a type written: `{ result: string }` is a type
    const builds =
      src.match(/\{\s*(\.\.\.\w+,\s*)?result:(?!\s*(string|unknown|any)\b)/g) ?? [];
    const rule = ALLOWED[f];
    if (rule) {
      if (builds.length !== 1 || !rule.test(src))
        bad.push(`${f}: { result } built ${builds.length} times, or not where allowed`);
    } else if (builds.length) bad.push(`${f}: builds { result } (${builds.length})`);
  }
  const reg = readFileSync(join(modDir, "register.ts"), "utf8");
  const body = reg.slice(
    reg.indexOf("async function secretValues"),
    reg.indexOf("async function projectDir"),
  );
  const read = [...body.matchAll(/\$\.env\.get\("([A-Z_]+)"\)/g)].map((m) => m[1]);
  if (JSON.stringify(read) !== JSON.stringify([...SECRET_VARS]))
    bad.push("register.ts: secretValues does not read exactly SECRET_VARS");
  const probe = readFileSync(join(modDir, "mcp-probe.ts"), "utf8");
  const imports = [...probe.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  if (JSON.stringify(imports) !== JSON.stringify(["./paths.ts"]))
    bad.push(`mcp-probe.ts: imports ${imports.join(", ")}, not paths.ts alone`);
  // Whatever the probe copies from a result is a key or a type, through label()
  if (/\.text\b|\.data\b/.test(probe.replace(/\/\/.*$/gm, "")))
    bad.push("mcp-probe.ts: reads a text or data field of a result");
  return bad;
}
