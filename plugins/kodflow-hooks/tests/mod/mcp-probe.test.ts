// mcp-probe.test.ts — what the probe writes about an MCP result: structure
// and size, never a value (the wiring is in register.test.ts).
import { test, expect } from "claude-code/testing";
import {
  appendArgv,
  shapeLine,
  shapeOf,
  shapesFile,
} from "../../hooks/mod/mcp-probe.ts";

const NOW = 1_800_000_123_456;
const BODY = "the-secret-body-of-a-result ".repeat(10);
const PIXELS = "Zm9vYmFy".repeat(200);

test("probe: the file is mcp-shapes.jsonl in the session directory", () => {
  expect(shapesFile("/cfg/kodflow/sessions/s1")).toBe(
    "/cfg/kodflow/sessions/s1/mcp-shapes.jsonl",
  );
});

test("probe: blocks, keys, form and length of a content result", () => {
  const s = shapeOf(
    "mcp__srv__read",
    {
      result: {
        content: [
          { type: "text", text: BODY },
          { type: "image", data: PIXELS },
        ],
        isError: false,
      },
    },
    NOW,
  );
  expect(s.tool).toBe("mcp__srv__read");
  expect(s.at).toBe(Math.floor(NOW / 1000));
  expect(s.keys).toEqual(["result"]);
  expect(s.form).toBe("object");
  expect(s.resultKeys).toEqual(["content", "isError"]);
  expect(s.blocks).toEqual(["text", "image"]);
  expect(s.chars).toBeGreaterThan(BODY.length + PIXELS.length);
});

test("probe: a string result, an array of blocks, a refusal, junk", () => {
  expect(shapeOf("mcp__a__b", { result: BODY }, NOW).form).toBe("string");
  expect(shapeOf("mcp__a__b", { result: BODY }, NOW).chars).toBe(BODY.length);
  const arr = shapeOf("mcp__a__b", { result: [{ type: "text", text: BODY }] }, NOW);
  expect(arr.form).toBe("array");
  expect(arr.blocks).toEqual(["text"]);
  expect(shapeOf("mcp__a__b", { deny: "no" }, NOW).keys).toEqual(["deny"]);
  for (const junk of [undefined, null, 3, "x", []])
    expect(typeof shapeOf("mcp__a__b", junk, NOW).chars).toBe("number");
  const cyc: any = {};
  cyc.self = cyc;
  expect(shapeOf("mcp__a__b", { result: cyc }, NOW).chars).toBe(0);
});

test("probe: no value of the result reaches the line", () => {
  const s = shapeOf(
    "mcp__srv__read",
    {
      result: {
        // keys and types that are data, not structure
        "user@example.com has 3 invoices": 1,
        content: [
          { type: "text", text: BODY },
          { type: "weird value with spaces", data: PIXELS },
        ],
      },
    },
    NOW,
  );
  const line = shapeLine(s);
  expect(line.endsWith("\n")).toBe(true);
  expect(line.indexOf("\n")).toBe(line.length - 1);
  expect(line).not.toContain("secret-body");
  expect(line).not.toContain(PIXELS);
  expect(line).not.toContain("user@example.com");
  expect(line).not.toContain("weird value");
  expect(s.resultKeys).toEqual(["?", "content"]);
  expect(s.blocks).toEqual(["text", "?"]);
  expect(Object.keys(JSON.parse(line)).sort()).toEqual(
    ["at", "blocks", "chars", "form", "keys", "resultKeys", "tool"],
  );
});

test("probe: the lists are bounded", () => {
  const many = Array.from({ length: 500 }, () => ({ type: "text", text: "a" }));
  expect(shapeOf("mcp__a__b", { result: many }, NOW).blocks.length).toBe(20);
});

test("probe: the append is an argv, 0600, the file last", () => {
  const argv = appendArgv("/cfg/s/mcp-shapes.jsonl");
  expect(argv[0]).toBe("sh");
  expect(argv[2]).toContain("umask 077");
  expect(argv[2]).toContain("chmod 600");
  expect(argv[2]).not.toContain("/cfg");
  expect(argv[argv.length - 1]).toBe("/cfg/s/mcp-shapes.jsonl");
});
