// width.ts — how many terminal cells a string takes, and cutting one to fit.
// Pure.
//
// Every column of the task tree is a Box of a fixed width; what goes in it is
// cut here first, by cells rather than by characters, so a wide glyph or an
// emoji never pushes the next column. The rule is string-width's, which the
// terminal surface measures with: East Asian wide and fullwidth characters
// and emoji take two cells, combining marks and joiners none, and the
// ambiguous ones (✓ ● ◆ ▶ ┃ ⇢ …) one, as a terminal that is not set to CJK
// widths draws them.

const ZERO = /[\p{M}​-‏⁠-⁤︀-️﻿]|\p{Cc}/u;
const EMOJI = /\p{Extended_Pictographic}/u;

/** Whether a code point takes two cells. */
function wide(cp: number, ch: string): boolean {
  if (cp >= 0x1f000 && EMOJI.test(ch)) return true;
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function cellsOf(ch: string): number {
  if (ZERO.test(ch)) return 0;
  return wide(ch.codePointAt(0)!, ch) ? 2 : 1;
}

/** The cells a string takes on the terminal. */
export function cells(s: string): number {
  let n = 0;
  for (const ch of s) n += cellsOf(ch);
  return n;
}

/** The string cut to `width` cells, an ellipsis in the last one it lost. */
export function fit(s: string, width: number): string {
  if (width <= 0) return "";
  if (cells(s) <= width) return s;
  let out = "";
  let n = 0;
  for (const ch of s) {
    const c = cellsOf(ch);
    if (n + c > width - 1) break;
    out += ch;
    n += c;
  }
  return `${out}…`;
}
