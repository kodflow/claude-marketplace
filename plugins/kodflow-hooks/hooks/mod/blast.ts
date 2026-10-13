// blast.ts — the commands whose damage cannot be undone. Pure.
//
// `rm` both recursive and forced, `git reset --hard`, a forced push. The mod
// puts them to the user through `$.ui.ask`, and only while the user is at
// the prompt (a message typed in the last 10 minutes); with no one there the
// call goes on (fail open): the shell's own guards still apply beneath.
import { argvOf, type Parsed } from "./shell.ts";

/** What on the line would be asked about, one label per command. */
export function blastRadius(p: Parsed): string[] {
  const out: string[] = [];
  for (const cmd of p.commands) {
    const { argv: A, name } = argvOf(cmd);
    if (name === "rm") {
      let r = false;
      let f = false;
      for (const v of A.slice(1)) {
        if (v === "--") break;
        if (v === "--recursive") r = true;
        else if (v === "--force") f = true;
        else if (/^-[^-]/.test(v)) {
          if (/[rR]/.test(v)) r = true;
          if (v.includes("f")) f = true;
        }
      }
      if (r && f) out.push(`rm ${A.slice(1).join(" ")}`);
    } else if (name === "git") {
      let y = 1;
      while (y < A.length && A[y]!.startsWith("-"))
        y += ["-C", "-c", "--git-dir", "--work-tree"].includes(A[y]!) ? 2 : 1;
      const sub = A[y];
      const rest = A.slice(y + 1);
      if (sub === "reset" && rest.includes("--hard"))
        out.push(`git reset ${rest.join(" ")}`);
      if (
        sub === "push" &&
        rest.some(
          (v) =>
            v === "--force" ||
            (/^-[^-]/.test(v) && v.includes("f")) ||
            /^\+./.test(v),
        )
      )
        out.push(`git push ${rest.join(" ")}`);
    }
  }
  return out;
}
