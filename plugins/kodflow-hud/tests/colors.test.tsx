// colors.test.tsx — a few words of a reply in colour: the pure split, the
// system prompt section and the drawing, through the engine.
import { test, expect, mock } from "claude-code/testing";
import {
  PROMPT_SECTION,
  SECTION_ID,
  blocks,
  colorsOff,
  runs,
} from "../hooks/mod/colors.ts";

// --- pure ---

test("only the marked words are coloured, the markup is gone", () => {
  expect(runs("la PR est {{r:bloquée}} par la CI")).toEqual([
    { text: "la PR est " },
    { text: "bloquée", color: "red", bold: true },
    { text: " par la CI" },
  ]);
});

test("the four marks have their colours", () => {
  expect(
    runs("{{r:a}} {{o:b}} {{v:c}} {{p:d}}")
      .filter((r) => r.color)
      .map((r) => r.color),
  ).toEqual(["red", "#ff8c00", "green", "#ff69b4"]);
});

test("a paragraph without markup stays markdown", () => {
  expect(blocks("rien de **spécial**")).toEqual([
    { markdown: "rien de **spécial**" },
  ]);
});

test("bold is kept next to a mark", () => {
  expect(runs("**PR #56** {{v:à toi}}").map((r) => r.bold)).toEqual([
    true,
    undefined,
    true,
  ]);
});

test("markup inside a code block is never interpreted", () => {
  expect(blocks("```\n{{r:pas ici}}\n```")).toEqual([
    { markdown: "```\n{{r:pas ici}}\n```" },
  ]);
  // Nor in a fence left open, nor in inline code
  expect(blocks("```sh\necho {{r:x}}")).toEqual([
    { markdown: "```sh\necho {{r:x}}" },
  ]);
  expect(blocks("tape `{{r:x}}` tel quel")).toEqual([
    { markdown: "tape `{{r:x}}` tel quel" },
  ]);
  expect(runs("`{{o:x}}` puis {{o:y}}")).toEqual([
    { text: "`{{o:x}}`" },
    { text: " puis " },
    { text: "y", color: "#ff8c00", bold: true },
  ]);
});

test("only the marked paragraph leaves markdown", () => {
  expect(blocks("# Titre\n\nla CI est {{r:rouge}}\n\n- un\n- deux")).toEqual([
    { markdown: "# Titre" },
    {
      runs: [
        { text: "la CI est " },
        { text: "rouge", color: "red", bold: true },
      ],
    },
    { markdown: "- un\n- deux" },
  ]);
});

test("an unknown letter or an empty mark is plain text", () => {
  expect(blocks("{{x:non}} et {{r:}}")).toEqual([
    { markdown: "{{x:non}} et {{r:}}" },
  ]);
});

test("KODFLOW_COLORS=off, 0, false or no turns it off", () => {
  for (const v of ["off", "OFF", "0", "false", " no "])
    expect(colorsOff(v)).toBe(true);
  for (const v of [undefined, "", "on", "1"]) expect(colorsOff(v)).toBe(false);
});

// --- through the engine ---

const ENGINE = [
  { id: "intro", text: "intro", scope: "shared" as const },
  { id: "memory", text: "memory", scope: "session" as const },
];

// The engine beneath: its own sections, and its own drawing of a reply
function beneath(on: any, env: Record<string, string> = {}) {
  mock.env(on, { HOME: "/u/dev", ...env });
  on("prompt.compose", async () => ({ sections: ENGINE }));
  on("ui.render", async (_$: any, e: any) => ({
    type: "Markdown",
    props: { text: `engine:${e.props.text}` },
  }));
}

const compose = (surfaces: string[], traits: string[]) => ({
  model: "claude-opus-5-5",
  promptModel: "claude-opus-5-5",
  tools: [],
  outputStyle: null,
  surfaces,
  traits,
});

test("the convention is the last section, on the session's side", async ($, on) => {
  beneath(on);
  const r = await $.prompt.compose(compose(["terminal"], []) as any);
  expect(r.sections.map((s) => s.id)).toEqual(["intro", "memory", SECTION_ID]);
  const mine = r.sections[2]!;
  expect(mine.scope).toBe("session");
  expect(mine.text).toBe(PROMPT_SECTION);
  expect(mine.text).toContain("{{r:words}}");
  expect(mine.text).toContain("{{p:words}}");
});

test("no section with KODFLOW_COLORS=off", async ($, on) => {
  beneath(on, { KODFLOW_COLORS: "off" });
  const r = await $.prompt.compose(compose(["terminal"], []) as any);
  expect(r.sections.map((s) => s.id)).toEqual(["intro", "memory"]);
});

test("no section where nothing draws the reply (-p, --bare)", async ($, on) => {
  beneath(on);
  for (const args of [
    compose([], []),
    compose(["terminal"], ["print"]),
    compose(["terminal"], ["bare"]),
  ]) {
    const r = await $.prompt.compose(args as any);
    expect(r.sections.map((s) => s.id)).toEqual(["intro", "memory"]);
  }
});

const REPLY =
  "**PR #56** : la CI est {{r:rouge}}, {{v:à toi}} de dire.\n\n```\n{{o:pas ici}}\n```";

type El = { type?: string; props?: Record<string, any>; children?: unknown[] };
const all = (n: unknown, out: El[] = []): El[] => {
  if (n && typeof n === "object") {
    out.push(n as El);
    for (const c of (n as El).children ?? []) all(c, out);
  }
  return out;
};
const textOf = (n: unknown): string =>
  typeof n === "string" || typeof n === "number"
    ? String(n)
    : n && typeof n === "object"
      ? ((n as El).children ?? []).map(textOf).join("")
      : "";

async function drawReply($: any, text: string) {
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
  });
  const tree = await ui.drawn();
  await ui.unmount();
  return tree;
}

test("a marked reply is drawn in colour on the terminal, the markup gone", async ($, on) => {
  beneath(on);
  const tree = await drawReply($, REPLY);
  const els = all(tree);
  const red = els.find((e) => e.type === "Text" && e.props?.color === "red");
  const green = els.find(
    (e) => e.type === "Text" && e.props?.color === "green",
  );
  expect(textOf(red)).toBe("rouge");
  expect(red?.props?.bold).toBe(true);
  expect(textOf(green)).toBe("à toi");
  // The bold of the paragraph is kept, the marks are not shown
  const bold = els.find(
    (e) => e.type === "Text" && e.props?.bold && !e.props?.color,
  );
  expect(textOf(bold)).toBe("PR #56");
  expect(JSON.stringify(tree)).not.toContain("{{r:");
  expect(JSON.stringify(tree)).not.toContain("{{v:");
  // The code block goes to the engine's markdown, mark and all
  const md = els.filter((e) => e.type === "Markdown");
  expect(md.map((e) => e.props?.text)).toEqual(["```\n{{o:pas ici}}\n```"]);
});

test("a reply with no mark, or with KODFLOW_COLORS=off, is the engine's", async ($, on) => {
  beneath(on, { KODFLOW_COLORS: "off" });
  for (const text of ["rien de **spécial**", REPLY]) {
    const els = all(await drawReply($, text));
    expect(els.some((e) => e.props?.color === "red")).toBe(false);
    expect(els[0]?.props?.text).toBe(`engine:${text}`);
  }
});
