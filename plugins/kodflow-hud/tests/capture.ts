// capture.ts — a drawn tree as the terminal lays it out, in text: what the
// tests compare the panes against, line for line.
//
// It reads the tree the surface validated (`ui.drawn()`), not a paint: a Box
// with a width is cut or filled to that many cells (string-width's count,
// width.ts), its text to the right under `justifyContent: flex-end`; a row
// sets its children side by side, a column one under another. So a column
// that is not a Box of a fixed width shows up as a shifted line here.

import { cells } from "../hooks/mod/width.ts";

type El = { type?: string; props?: Record<string, any>; children?: unknown[] };

function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return ((node as El).children ?? []).map(textOf).join("");
}

function fitTo(line: string, w: number, right: boolean): string {
  let out = "";
  let n = 0;
  for (const ch of line) {
    const c = cells(ch);
    if (n + c > w) break;
    out += ch;
    n += c;
  }
  const pad = " ".repeat(w - n);
  return right ? pad + out : out + pad;
}

function lay(node: unknown): string[] {
  if (typeof node === "string" || typeof node === "number")
    return [String(node)];
  if (!node || typeof node !== "object") return [];
  const el = node as El;
  if (el.type === "Text") return [textOf(el)];
  const kids = (el.children ?? []).filter((c) => c !== null && c !== undefined);
  const dir = el.props?.flexDirection ?? "row";
  let lines: string[];
  if (dir === "column") lines = kids.flatMap(lay);
  else {
    const parts = kids.map(lay);
    const height = Math.max(0, ...parts.map((p) => p.length));
    const widths = parts.map((p) => Math.max(0, ...p.map(cells)));
    lines = [];
    for (let i = 0; i < height; i++)
      lines.push(
        parts.map((p, j) => fitTo(p[i] ?? "", widths[j]!, false)).join(""),
      );
  }
  const w = el.props?.width;
  if (typeof w === "number") {
    const right = el.props?.justifyContent === "flex-end";
    lines = (lines.length ? lines : [""]).map((l) =>
      fitTo(right ? l.replace(/\s+$/, "") : l, w, right),
    );
  }
  const h = el.props?.height;
  if (typeof h === "number") {
    lines = lines.slice(0, h);
    while (lines.length < h)
      lines.push(typeof w === "number" ? " ".repeat(w) : "");
  }
  return lines;
}

/** The drawing's lines, trailing blanks kept off so a capture reads clean. */
export function capture(tree: unknown): string {
  return lay(tree)
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n");
}

/** Every line's width in cells, for the alignment checks. */
export const widths = (tree: unknown): number[] => lay(tree).map(cells);
