import type { Register } from "claude-code";

// Nothing hooked: the probe asks only whether the engine loads modules.
export const register: Register = (on) => {
  on("session.start", async ($, e, next) => next(e));
};
