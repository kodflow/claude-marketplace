// pipeline.ts — the one Bash `tool.call`, as ordered policies. No `$`.
//
// Each policy has its own error handling, chosen by what a failure must do:
//
//   1. merge   classify the merge and gate it      a failure REFUSES
//   2. guards  the shell's guards, doubled (L4)    a failure is logged, the call goes on
//   3. blast   rm -rf, reset --hard, force push    a failure is logged, the call goes on
//   4. next    the call runs (the shell's PreToolUse first, beneath)
//   5. filter  compress the output (L3)            a failure returns `r` untouched
//
// No policy ever answers `allow`, and none answers `{ result }` but the
// filter, which returns what `next` resolved to with its stdout shortened.

export type Deny = { deny: string };
export type AnyResult = Record<string, any>;

export type Policies = {
  /** `{ deny }` to refuse, undefined to go on. Throwing refuses. */
  merge(): Promise<Deny | undefined>;
  /** `{ deny }` to refuse, undefined to go on. Throwing goes on. */
  guards(): Promise<Deny | undefined>;
  /** `{ deny }` to refuse, undefined to go on. Throwing goes on. */
  blast(): Promise<Deny | undefined>;
  /** What the model reads; throwing returns `r` untouched. */
  filter(r: AnyResult): Promise<AnyResult>;
  /** Journal one policy's decision or failure; never throws. */
  log(policy: string, decision: string, error?: unknown): void;
};

/** The refusal a failed merge classification answers. */
export function mergeFailure(err: unknown): Deny {
  const why = String((err as Error)?.message ?? err).slice(0, 300);
  return {
    deny: [
      "═══════════════════════════════════════════════",
      "  ❌ MERGE BLOCKED — the merge gate failed",
      "═══════════════════════════════════════════════",
      `  ${why}`,
      "  Nothing is merged on an unchecked call; report it and wait for the user.",
      "  [motif:merge]",
    ].join("\n"),
  };
}

/** A line that may merge, decided without parsing (the hook's last resort). */
export const mayMerge = (line: unknown): boolean =>
  typeof line === "string" &&
  /merge|Merge|pulls\/[^/\s]+\/merge|merge_requests/.test(line);

export async function runBash(
  next: () => Promise<AnyResult>,
  p: Policies,
): Promise<AnyResult> {
  let refused: Deny | undefined;
  try {
    refused = await p.merge();
  } catch (err) {
    p.log("merge", "deny", err);
    return mergeFailure(err);
  }
  if (refused) {
    p.log("merge", "deny");
    return refused;
  }
  try {
    refused = await p.guards();
  } catch (err) {
    p.log("guards", "error", err);
    refused = undefined;
  }
  if (refused) {
    p.log("guards", "deny");
    return refused;
  }
  try {
    refused = await p.blast();
  } catch (err) {
    p.log("blast", "error", err);
    refused = undefined;
  }
  if (refused) {
    p.log("blast", "deny");
    return refused;
  }
  const r = await next();
  try {
    return await p.filter(r);
  } catch (err) {
    p.log("filter", "error", err);
    return r;
  }
}
