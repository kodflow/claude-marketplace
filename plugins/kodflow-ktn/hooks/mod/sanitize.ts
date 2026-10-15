// sanitize.ts — every string that came from the daemon (paths, messages,
// rules, the command it suggests) passes here before it is drawn. Pure.
//
// The daemon already sanitises (pkg/view `Sanitize`); this is the client's own
// guard, so a daemon of another version, or something else listening on the
// socket, cannot move the cursor or recolour the terminal. A plain loop over
// code points: no regular expression ever runs on external data.

/** C0 (tab and newline included), DEL and C1 become a space; cut at `max`. */
export function clean(input: unknown, max = 300): string {
  if (typeof input !== "string") return "";
  let out = "";
  let n = 0;
  for (const ch of input) {
    if (n >= max) return out + "…";
    const c = ch.codePointAt(0)!;
    out += c < 0x20 || (c >= 0x7f && c <= 0x9f) ? " " : ch;
    n++;
  }
  return out;
}

/** Whether a string is safe to send back as is (an id, a path): no control. */
export function isPlain(input: unknown, max: number): input is string {
  if (typeof input !== "string" || input.length === 0 || input.length > max)
    return false;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return false;
  }
  return true;
}
