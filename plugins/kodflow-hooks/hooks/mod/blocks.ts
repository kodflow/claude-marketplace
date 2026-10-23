// blocks.ts — a refusal's line in blocks.jsonl, read off its text. Pure.
//
// The mod refuses with the text the model reads (guards.ts refusalText,
// fable.ts refusal): a title, lines, and a closing [motif:…]. journal()
// hands the title and the motif to on-mod.sh, which appends the line through
// lib/blocks.sh like every refusal of the shell.

export type Block = { motif: string; title: string };

/** The title (first line with text, bars and ❌ dropped) and the motif. */
export function blockOf(text: unknown): Block | undefined {
  if (typeof text !== "string" || !text) return undefined;
  const motif = /\[motif:([^\]\s]+)\]/.exec(text)?.[1] ?? "guard";
  const title = text
    .split("\n")
    .map((l) => l.replace(/[═❌]/g, "").trim())
    .find((l) => l.length > 0);
  return title ? { motif, title: title.slice(0, 300) } : undefined;
}
