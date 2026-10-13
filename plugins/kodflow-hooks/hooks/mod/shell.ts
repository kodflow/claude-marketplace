// shell.ts — what a Bash line will actually run. Pure.
//
// A port of the shell reader of hooks/scripts/on-tool.sh (_p_scan, _p_paren,
// _p_argv, _p_expand, _p_parse, _p_file), step for step, so the mod and the
// shell hook read a line the same way: the bash-guard corpus
// (tests/fixtures/bash-guard.jsonl) is replayed against both.
//
// It does the shell's own first pass: cuts the line into simple commands,
// removes quotes and backslashes, joins `\`+newline, sets heredoc bodies
// aside as data, and queues for another pass every text the shell would
// itself run ($( ), backticks, <( ), bash -c, sh -c, eval, su/sg -c, and a
// body or a pipe fed to a shell). It never expands a variable or an alias.

/** One simple command: its words, its stdin, its redirection targets. */
export type Command = {
  words: string[];
  /** What it reads on stdin: heredoc bodies and here-strings. */
  stdin: string;
  /** Redirection targets (`> f`, `< f`, `&> f`). */
  redirs: string[];
  /** True when a pipe feeds it. */
  pipe: boolean;
  /** Nesting depth of the text it was read from (0: the line itself). */
  depth: number;
};

export type Parsed = { commands: Command[]; nested: boolean };

const QUEUE_MAX = 64;
const DEPTH_MAX = 6;
const WORD = /[A-Za-z0-9_./:@%+,=-]/;

/** The content of a parenthesis opened just before `start`, and the index past `)`. */
function paren(t: string, start: number): { cap: string; end: number } {
  let k = start;
  let dep = 1;
  const m = t.length;
  while (k < m) {
    const ch = t[k]!;
    if (ch === "\\") {
      k += 2;
      continue;
    }
    if (ch === "'") {
      const close = t.indexOf("'", k + 1);
      const r = close < 0 ? t.slice(k + 1) : t.slice(k + 1, close);
      k += r.length + 2;
      continue;
    }
    if (ch === '"') {
      k++;
      while (k < m) {
        const c = t[k]!;
        if (c === "\\") {
          k += 2;
          continue;
        }
        if (c === '"') break;
        k++;
      }
    } else if (ch === "(") dep++;
    else if (ch === ")") {
      dep--;
      if (dep === 0) break;
    }
    k++;
  }
  return { cap: t.slice(start, k), end: k + 1 };
}

/** bash's printf %b on the body of a $'…' string. */
export function ansiC(raw: string): string {
  const simple: Record<string, string> = {
    a: "\x07",
    b: "\b",
    e: "\x1b",
    E: "\x1b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    "\\": "\\",
    "'": "'",
    '"': '"',
  };
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c !== "\\" || i + 1 >= raw.length) {
      out += c;
      continue;
    }
    const n = raw[i + 1]!;
    if (n in simple) {
      out += simple[n];
      i++;
    } else if (n === "x") {
      const hex = /^[0-9A-Fa-f]{1,2}/.exec(raw.slice(i + 2));
      if (hex) {
        out += String.fromCharCode(parseInt(hex[0], 16));
        i += 1 + hex[0].length;
      } else out += c;
    } else if (n === "u" || n === "U") {
      const hex = (n === "u" ? /^[0-9A-Fa-f]{1,4}/ : /^[0-9A-Fa-f]{1,8}/).exec(
        raw.slice(i + 2),
      );
      if (hex) {
        out += String.fromCodePoint(parseInt(hex[0], 16));
        i += 1 + hex[0].length;
      } else out += c;
    } else if (n === "0") {
      const oct = /^[0-7]{0,3}/.exec(raw.slice(i + 2))![0];
      out += String.fromCharCode(parseInt(oct || "0", 8) & 0xff);
      i += 1 + oct.length;
    } else if (/[1-7]/.test(n)) {
      const oct = /^[0-7]{1,3}/.exec(raw.slice(i + 1))![0];
      out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      i += oct.length;
    } else if (n === "c") break;
    else out += c;
  }
  return out;
}

class Reader {
  readonly cmds: Command[] = [];
  /** stdin gathered for an index before (or after) its command is closed. */
  private readonly pendingIn = new Map<number, string>();
  readonly queue: { text: string; depth: number }[] = [];

  push(text: string, depth: number): void {
    if (this.queue.length < QUEUE_MAX && depth <= DEPTH_MAX)
      this.queue.push({ text, depth });
  }

  private addIn(index: number, text: string): void {
    const cmd = this.cmds[index];
    if (cmd) cmd.stdin += text;
    else this.pendingIn.set(index, (this.pendingIn.get(index) ?? "") + text);
  }

  scan(s: string, d: number): void {
    const n = s.length;
    let i = 0;
    let w = "";
    let wa = false;
    let rn = 0;
    let cw: string[] = [];
    let cr: string[] = [];
    let pipe = false;
    let hq: { idx: number; strip: boolean; dl: string }[] = [];

    const pw = () => {
      if (wa) {
        if (rn === 1) cr.push(w);
        else if (rn === 2) this.addIn(this.cmds.length, `${w}\n`);
        else cw.push(w);
        rn = 0;
      }
      w = "";
      wa = false;
    };
    const pc = (nextPipe = false) => {
      pw();
      const idx = this.cmds.length;
      const pending = this.pendingIn.get(idx) ?? "";
      if (cw.length || cr.length || pending) {
        this.pendingIn.delete(idx);
        this.cmds.push({
          words: cw,
          stdin: pending,
          redirs: cr,
          pipe,
          depth: d,
        });
      }
      cw = [];
      cr = [];
      pipe = nextPipe;
    };
    const dollar = () => {
      const p = paren(s, i + 2);
      if (s[i + 2] !== "(") this.push(p.cap, d + 1);
      w += `$(${p.cap})`;
      wa = true;
      i = p.end;
    };
    const tick = () => {
      let k = i + 1;
      while (k < n) {
        const ch = s[k]!;
        if (ch === "\\") {
          k += 2;
          continue;
        }
        if (ch === "`") break;
        k++;
      }
      this.push(s.slice(i + 1, k), d + 1);
      w += s.slice(i, k + 1);
      wa = true;
      i = k + 1;
    };

    while (i < n) {
      const c = s[i]!;
      if (WORD.test(c)) {
        w += c;
        wa = true;
        i++;
        continue;
      }
      switch (c) {
        case " ":
        case "\t":
          pw();
          break;
        case "\n":
          pc();
          if (hq.length) {
            i++;
            for (const q of hq) {
              let body = "";
              while (i < n) {
                const nl = s.indexOf("\n", i);
                let line = nl < 0 ? s.slice(i) : s.slice(i, nl);
                i += line.length + 1;
                if (q.strip) line = line.replace(/^\t+/, "");
                if (line === q.dl) break;
                body += `${line}\n`;
              }
              this.addIn(q.idx, body);
            }
            hq = [];
            continue;
          }
          break;
        case ";":
        case "(":
        case ")":
          pc();
          break;
        case "&":
          if (s[i + 1] === ">") {
            pw();
            i += 2;
            if (s[i] === ">") i++;
            rn = 1;
            continue;
          }
          if (s[i + 1] === "&") i++;
          pc();
          break;
        case "|":
          if (s[i + 1] === "|") {
            i++;
            pc();
          } else if (s[i + 1] === "&") {
            i++;
            pc(true);
          } else pc(true);
          break;
        case "<":
        case ">": {
          if (wa) {
            if (/[^0-9]/.test(w)) pw();
            else {
              w = "";
              wa = false;
            }
          }
          if (c === "<" && s.slice(i + 1, i + 3) === "<<") {
            i += 3;
            rn = 2;
            continue;
          }
          if (c === "<" && s[i + 1] === "<") {
            i += 2;
            let strip = false;
            if (s[i] === "-") {
              strip = true;
              i++;
            }
            while (s[i] === " " || s[i] === "\t") i++;
            let dl = "";
            while (i < n) {
              const ch = s[i]!;
              if (" \t\n;&|<>()".includes(ch)) break;
              if (ch === "'" || ch === '"') {
                const close = s.indexOf(ch, i + 1);
                const r = close < 0 ? s.slice(i + 1) : s.slice(i + 1, close);
                dl += r;
                i += r.length + 2;
                continue;
              }
              if (ch === "\\") {
                dl += s[i + 1] ?? "";
                i += 2;
                continue;
              }
              dl += ch;
              i++;
            }
            hq.push({ idx: this.cmds.length, strip, dl });
            continue;
          }
          if (s[i + 1] === "(") {
            const p = paren(s, i + 2);
            this.push(p.cap, d + 1);
            i = p.end;
            continue;
          }
          i++;
          const nx = s[i];
          if (nx === ">" || nx === "|") i++;
          else if (nx === "&") {
            i++;
            while (i < n && /[0-9-]/.test(s[i]!)) i++;
            continue;
          }
          if (c === "<" && s[i] === ">") i++;
          rn = 1;
          continue;
        }
        case "#":
          if (!wa) {
            const nl = s.indexOf("\n", i);
            i = nl < 0 ? n : nl;
            continue;
          }
          w += c;
          break;
        case "\\":
          if (s[i + 1] === "\n") {
            i += 2;
            continue;
          }
          w += s[i + 1] ?? "";
          wa = true;
          i += 2;
          continue;
        case "'": {
          const close = s.indexOf("'", i + 1);
          const r = close < 0 ? s.slice(i + 1) : s.slice(i + 1, close);
          w += r;
          wa = true;
          i += r.length + 2;
          continue;
        }
        case '"': {
          i++;
          wa = true;
          while (i < n) {
            const ch = s[i]!;
            if (ch === '"') break;
            if (ch === "\\") {
              const nx = s[i + 1];
              if (nx === "\n") {
                i += 2;
                continue;
              }
              if (nx === '"' || nx === "\\" || nx === "$" || nx === "`") {
                w += nx;
                i += 2;
                continue;
              }
            } else if (ch === "$" && s[i + 1] === "(") {
              dollar();
              continue;
            } else if (ch === "`") {
              tick();
              continue;
            }
            w += ch;
            i++;
          }
          break;
        }
        case "$":
          if (s[i + 1] === "(") {
            dollar();
            continue;
          }
          if (s[i + 1] === "'") {
            i += 2;
            let r = "";
            while (i < n) {
              const ch = s[i]!;
              if (ch === "'") break;
              if (ch === "\\") {
                r += s.slice(i, i + 2);
                i += 2;
                continue;
              }
              r += ch;
              i++;
            }
            w += ansiC(r);
            wa = true;
          } else {
            w += c;
            wa = true;
          }
          break;
        case "`":
          tick();
          continue;
        default:
          w += c;
          wa = true;
      }
      i++;
    }
    pc();
  }
}

/** Every simple command the line runs, nested ones included. */
export function parse(line: string): Parsed {
  const r = new Reader();
  r.push(line, 0);
  for (let qi = 0; qi < r.queue.length; qi++) {
    const { text, depth } = r.queue[qi]!;
    const from = r.cmds.length;
    r.scan(text, depth);
    for (let k = from; k < r.cmds.length; k++) expand(r, k, depth);
  }
  return { commands: r.cmds, nested: r.queue.length > 1 };
}

export type Argv = {
  /** argv from the executable on, wrappers and assignments walked past. */
  argv: string[];
  /** The executable's basename (`lookup` for `command -v`). */
  name: string;
  /** NAME=value words before it, wrappers' own included. */
  assigns: Record<string, string>;
};

const RESERVED = new Set([
  "!",
  "{",
  "}",
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
]);
const isAssign = (t: string) => /^[A-Za-z_][^=]*=/.test(t);
const validName = (t: string) => /^[A-Za-z0-9_]*$/.test(t.split("=")[0]!);
const base = (t: string) => {
  const s = t.replace(/^=/, "");
  return s.slice(s.lastIndexOf("/") + 1);
};

/** The command's argv, as on-tool.sh's _p_argv reads it. */
export function argvOf(cmd: Command): Argv {
  const W = cmd.words;
  const nw = W.length;
  const assigns: Record<string, string> = {};
  let x = 0;
  while (x < nw) {
    const t = W[x]!;
    if (RESERVED.has(t)) {
      x++;
      continue;
    }
    if (isAssign(t) && validName(t)) {
      const eq = t.indexOf("=");
      assigns[t.slice(0, eq)] = t.slice(eq + 1);
      x++;
      continue;
    }
    const name = base(t);
    if (name === "env") {
      x++;
      while (x < nw) {
        const v = W[x]!;
        if (["-u", "-C", "-S", "--unset", "--chdir"].includes(v)) x += 2;
        else if (v.startsWith("-")) x++;
        else if (isAssign(v)) {
          const eq = v.indexOf("=");
          assigns[v.slice(0, eq)] = v.slice(eq + 1);
          x++;
        } else break;
      }
    } else if (
      [
        "command",
        "builtin",
        "nohup",
        "chronic",
        "exec",
        "time",
        "caffeinate",
      ].includes(name)
    ) {
      x++;
      while (x < nw) {
        const v = W[x]!;
        if (name === "command" && (v === "-v" || v === "-V"))
          return { argv: [], name: "lookup", assigns };
        if (name === "exec" && v === "-a") x += 2;
        else if (v.startsWith("-")) x++;
        else break;
      }
    } else if (
      ["nice", "timeout", "ionice", "stdbuf", "doas", "sudo", "xargs"].includes(
        name,
      )
    ) {
      x++;
      while (x < nw) {
        const v = W[x]!;
        if (v === "--") {
          x++;
          break;
        }
        if (
          (name === "sudo" && /^-[ugChpUrtDR]$/.test(v)) ||
          (name === "doas" && /^-[uC]$/.test(v)) ||
          (name === "nice" && v === "-n") ||
          (name === "xargs" && /^-[InPLsdEa]$/.test(v)) ||
          (name === "timeout" && /^-[sk]$/.test(v)) ||
          (name === "ionice" && /^-[cnp]$/.test(v))
        )
          x += 2;
        else if (v.startsWith("-")) x++;
        else break;
      }
      if (name === "timeout") x++;
    } else if (name === "rtk") {
      x++;
      if (W[x] === "proxy") x++;
    } else break;
  }
  const argv = W.slice(x);
  return { argv, name: argv[0] === undefined ? "" : base(argv[0]), assigns };
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "ash", "mksh"]);

/** Queue what command k hands to a shell. */
function expand(r: Reader, k: number, depth: number): void {
  const cmd = r.cmds[k]!;
  const { argv: A, name } = argvOf(cmd);
  if (SHELLS.has(name)) {
    let y = 1;
    while (y < A.length) {
      const v = A[y]!;
      if (v === "-o" || v === "+o") {
        y += 2;
        continue;
      }
      if (v.startsWith("--")) {
        /* a long option */
      } else if (v.startsWith("-") && v.includes("c")) {
        r.push(A[y + 1] ?? "", depth + 1);
        return;
      } else if (v.startsWith("-") || v.startsWith("+")) {
        /* an option */
      } else return; // a script file: not ours to read
      y++;
    }
    if (cmd.stdin) r.push(cmd.stdin, depth + 1);
    if (cmd.pipe && k > 0) {
      const prev = r.cmds[k - 1]!;
      if (prev.stdin) r.push(prev.stdin, depth + 1);
      const p = argvOf(prev);
      if (p.name === "echo" || p.name === "printf")
        r.push(p.argv.slice(1).join(" "), depth + 1);
    }
  } else if (name === "eval") {
    if (A.length > 1) r.push(A.slice(1).join(" "), depth + 1);
  } else if (name === "su" || name === "sg") {
    for (let y = 1; y < A.length; y++)
      if (A[y] === "-c") {
        r.push(A[y + 1] ?? "", depth + 1);
        return;
      }
  }
}

/**
 * The text a file argument of command k stands for: `-` its stdin (and what a
 * pipe feeds it), a file on disk through `read`, else what an earlier
 * redirection on the same line wrote there.
 */
export async function fileText(
  p: Parsed,
  k: number,
  f: string,
  read: (path: string) => Promise<string | undefined>,
): Promise<string> {
  const cmds = p.commands;
  const fed = (j: number) => {
    const a = argvOf(cmds[j]!);
    return a.name === "echo" || a.name === "printf"
      ? `${a.argv.slice(1).join(" ")}\n`
      : "";
  };
  if (f === "-") {
    let out = cmds[k]?.stdin ?? "";
    if (cmds[k]?.pipe && k > 0) out += (cmds[k - 1]!.stdin ?? "") + fed(k - 1);
    return out;
  }
  if (!f) return "";
  const disk = await read(f).catch(() => undefined);
  if (disk !== undefined) return disk.slice(0, 200_000);
  let out = "";
  cmds.forEach((c, j) => {
    if (c.redirs.includes(f)) out += c.stdin + fed(j);
  });
  return out;
}
