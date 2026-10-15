// colors.ts — a few words of a reply in colour, never a whole paragraph.
//
// The model writes `{{r:words}}`; the transcript draws "words" in red, bold,
// and the markup is gone. A paragraph with no markup, and every fenced code
// block, is left to the engine's own markdown. The convention reaches the
// model as one system prompt section (PROMPT_SECTION), on the session's side
// of the cache boundary, so it holds after a compaction.
//
// Pure: no `$`, nothing read from the host. register.tsx wires it.

/** The four marks and their colours. */
export const COLORS: Record<string, string> = {
  r: "red", // blocking
  o: "#ff8c00", // needs attention
  v: "green", // waits on the person: their attention or their answer
  p: "#ff69b4", // a decision the person already made
};

export type Run = { text: string; color?: string; bold?: boolean };
export type Block = { markdown: string } | { runs: Run[] };

const MARK = /\{\{([rovp]):([^{}]+?)\}\}/g;
const HAS_MARK = /\{\{[rovp]:[^{}]+?\}\}/;
// Inline code, `like this`: a mark inside it is shown as typed
// (CommonMark: a run of backticks closed by a run of the same length, a
// shorter run inside it is code too)
const INLINE_CODE = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
// A fence opens on three backticks or tildes or more and closes on a line
// of the same character, at least as long, with nothing after it
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Splits on blank lines; a fenced code block stays one block. */
export function paragraphs(text: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  let buf: string[] = [];
  let fence = "";
  const flush = (code: boolean) => {
    if (buf.length) out.push({ text: buf.join("\n"), code });
    buf = [];
  };
  const closes = (line: string): boolean => {
    const m = /^ {0,3}(`+|~+)\s*$/.exec(line);
    return !!m && m[1]![0] === fence[0] && m[1]!.length >= fence.length;
  };
  for (const line of text.split("\n")) {
    if (fence) {
      buf.push(line);
      if (closes(line)) {
        flush(true);
        fence = "";
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      flush(false);
      buf.push(line);
      fence = open[1]!;
      continue;
    }
    if (line.trim() === "") {
      flush(false);
      continue;
    }
    buf.push(line);
  }
  // An unclosed fence is still code: never interpreted
  flush(!!fence);
  return out;
}

/** One paragraph as runs: coloured marks, **bold**, plain text. */
export function runs(paragraph: string): Run[] {
  const out: Run[] = [];
  const plain = (s: string) => {
    for (const [i, part] of s.split("**").entries())
      if (part) out.push(i % 2 ? { text: part, bold: true } : { text: part });
  };
  const marks = (s: string) => {
    let last = 0;
    for (const m of s.matchAll(MARK)) {
      plain(s.slice(last, m.index));
      out.push({ text: m[2]!, color: COLORS[m[1]!], bold: true });
      last = m.index! + m[0].length;
    }
    plain(s.slice(last));
  };
  let last = 0;
  for (const c of paragraph.matchAll(INLINE_CODE)) {
    marks(paragraph.slice(last, c.index));
    out.push({ text: c[0] });
    last = c.index! + c[0].length;
  }
  marks(paragraph.slice(last));
  return out;
}

/** A reply as blocks: runs where a paragraph is marked, markdown elsewhere. */
export function blocks(text: string): Block[] {
  return paragraphs(text).map((p) =>
    !p.code && HAS_MARK.test(p.text.replace(INLINE_CODE, ""))
      ? { runs: runs(p.text) }
      : { markdown: p.text },
  );
}

/** True when the reply holds a mark the transcript would colour. */
export const marked = (parts: Block[]): boolean =>
  parts.some((p) => "runs" in p);

/** KODFLOW_COLORS=off (or 0, false, no) turns off the colours and the section. */
export const colorsOff = (value: string | undefined): boolean =>
  /^(off|0|false|no)$/i.test((value ?? "").trim());

export const SECTION_ID = "kodflow-hud:colors";

/**
 * The convention as the model reads it. Short on purpose: it rides on every
 * request of the session.
 */
export const PROMPT_SECTION = [
  "# Coloured words",
  "",
  "The terminal colours a few words of your replies when you wrap them in a mark; the mark itself is never shown:",
  "- `{{r:words}}` red: what blocks (a failure, a refusal, a stop).",
  "- `{{o:words}}` orange: what needs attention (a risk, a warning, a limit).",
  "- `{{v:words}}` green: what waits on the user, their answer or their action.",
  "- `{{p:words}}` pink: a decision the user already made; use it only when you cite that decision with its date.",
  "",
  "Colour two to five words at a time, never a sentence or a paragraph, and put at most a few marks in one message; most messages need none. Never put a mark in code, in a command, in a path or in a table meant to be copied, since it would be copied as typed. A paragraph holding a mark loses its other markdown except bold, so keep links, lists and inline code out of it.",
].join("\n");

/** Whether the prompt being composed is one the transcript will draw. */
export function drawn(input: {
  surfaces: readonly string[];
  traits: readonly string[];
}): boolean {
  if (!input.surfaces.length) return false;
  return !input.traits.some((t) => t === "print" || t === "bare");
}
