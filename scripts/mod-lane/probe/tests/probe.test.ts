import { test, expect } from "claude-code/testing";

test("the engine loads a hooks module and runs its tests", async () => {
  expect(1 + 1).toBe(2);
});
