// engine.ts — the engine's version against the mod's floor. Pure.

/** `2.1.299`, `2.1.299-dev…` → [2, 1, 299]; undefined when not a release. */
export function release(v: string | undefined): number[] | undefined {
  if (typeof v !== "string") return undefined;
  const core = v.split("-")[0]!.split(".");
  if (core.length !== 3) return undefined;
  const nums = core.map((p) => (/^\d{1,6}$/.test(p) ? Number(p) : NaN));
  return nums.some(Number.isNaN) ? undefined : nums;
}

/**
 * Whether `version` is at or above `floor`. A version that is not spelled
 * as a release is below it: the mod was measured on releases only.
 */
export function atLeast(version: string | undefined, floor: string): boolean {
  const a = release(version);
  const b = release(floor);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
}
