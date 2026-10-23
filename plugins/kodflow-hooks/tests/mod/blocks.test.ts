// blocks.test.ts — blockOf, the line a refusal's text gives blocks.jsonl.
import { test, expect } from "claude-code/testing";
import { blockOf } from "../../hooks/mod/blocks.ts";
import { refusalText } from "../../hooks/mod/guards.ts";
import { refusal } from "../../hooks/mod/fable.ts";

test("blockOf: a guard's refusal gives its title and its motif", () => {
  const text = refusalText({ motif: "force", title: "COMMAND BLOCKED — forced push", lines: ["a", "b"] });
  expect(blockOf(text)).toEqual({ motif: "force", title: "COMMAND BLOCKED — forced push" });
});

test("blockOf: a gated-model refusal, its first line", () => {
  expect(blockOf(refusal("claude-fable-5-1", "the call's model"))).toEqual({
    motif: "fable",
    title: "GATED MODEL REFUSED — claude-fable-5-1 (the call's model)",
  });
});

test("blockOf: no motif reads as guard, nothing reads as nothing", () => {
  expect(blockOf("refused\nwhy")).toEqual({ motif: "guard", title: "refused" });
  expect(blockOf(undefined)).toBeUndefined();
  expect(blockOf("")).toBeUndefined();
  expect(blockOf("═══\n\n═══")).toBeUndefined();
  expect(blockOf("x".repeat(400))!.title.length).toBe(300);
});
