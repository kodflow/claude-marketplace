// fault.ts — when the « Tâches » Client failed, whether to draw it again.
// Pure.
//
// The engine gives a Client a second of wall clock a run: a stall of the
// whole process (the machine asleep, a long GC, a starved CPU) is enough to
// fail it, and once failed it is never drawn again unasked. So a fault is
// answered with a new instance, under a new key, and a fresh render. A fault
// the Client would hit every time must not loop: past MAX_FAULTS within
// FAULT_WINDOW_MS the pane is drawn still, as where no Client runs, for
// RESTING_MS, then the Client is tried again.

import type { HudFault } from "../../types";

export const MAX_FAULTS = 3;
export const FAULT_WINDOW_MS = 60_000;
export const RESTING_MS = 5 * 60_000;

export const NO_FAULT: HudFault = { gen: 0, at: [], until: 0 };

/** The state after a fault at `now`: a new generation, or a rest. */
export function onFault(f: HudFault, now: number): HudFault {
  const at = [...f.at.filter((t) => now - t < FAULT_WINDOW_MS), now];
  if (at.length > MAX_FAULTS)
    return { gen: f.gen + 1, at: [], until: now + RESTING_MS };
  return { gen: f.gen + 1, at, until: f.until };
}

/** Whether the Client may be drawn at `now`, or the pane rests still. */
export const resting = (f: HudFault, now: number): boolean => now < f.until;
