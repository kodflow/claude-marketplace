// pipeline.ts — the one Bash `tool.call`, as ordered policies. No `$`.
//
// Each policy has its own error handling, chosen by what a failure must do:
//
//   1. guards  the shell's guards, doubled (L4)    a failure is logged, the call goes on
//   2. next    the call runs (the shell's PreToolUse first, beneath)
//   3. filter  compress the output (L3)            a failure returns `r` untouched
//
// No policy ever answers `allow`, and none answers `{ result }` but the
// filter, which returns what `next` resolved to with its stdout shortened.

export type Deny = { deny: string };
export type AnyResult = Record<string, any>;

export type Policies = {
  /** `{ deny }` to refuse, undefined to go on. Throwing goes on. */
  guards(): Promise<Deny | undefined>;
  /** What the model reads; throwing returns `r` untouched. */
  filter(r: AnyResult): Promise<AnyResult>;
  /** Journal one policy's decision or failure; never throws. */
  log(policy: string, decision: string, error?: unknown): void;
};

export async function runBash(
  next: () => Promise<AnyResult>,
  p: Policies,
): Promise<AnyResult> {
  let refused: Deny | undefined;
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
  const r = await next();
  try {
    return await p.filter(r);
  } catch (err) {
    p.log("filter", "error", err);
    return r;
  }
}
