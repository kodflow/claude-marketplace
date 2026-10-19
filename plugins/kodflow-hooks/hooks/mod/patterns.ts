// patterns.ts — §5 of the user's rules, as on-tool.sh's _scan applies them. Pure.
//
// The rules are kodflow/post-commit's patterns.txt and patterns-strict.txt,
// vendored at a pinned commit in hooks/patterns (SOURCE names it). Both
// readers apply the same format: one POSIX ERE a line, `#` and blank lines
// skipped, `# @scope: <list>` for what follows, `commit` before the first.
// A commit message meets every pattern, strict included; a pull or merge
// request title or body meets the `pr` scope only.
//
// The shell feeds each text to `grep -qiE`, which matches line by line: `^`
// anchors a line, and neither `.` nor a bracket expression crosses a newline.
// toRegExp keeps that: the multiline flag, `[ \t\r\f\v]` for POSIX
// `[[:space:]]`, and a newline added to every negated bracket.

export type Kind = "commit" | "pr";
export type Hit = { motif: string; pattern: string; kind: Kind };
export type Rule = { motif: string; re: RegExp };
/** attr: the commit,pr scope. commit: the commit-only rest, leaks first. */
export type Rules = { attr: readonly Rule[]; commit: readonly Rule[] };

export const PATTERN_FILES = ["patterns.txt", "patterns-strict.txt"] as const;

const CLASSES: Record<string, string> = {
  space: " \\t\\r\\f\\v",
  blank: " \\t",
  digit: "0-9",
  lower: "a-z",
  upper: "A-Z",
  alpha: "a-zA-Z",
  alnum: "a-zA-Z0-9",
};

/** A POSIX ERE as grep -iE reads it, line by line, as a JavaScript RegExp. */
export function toRegExp(ere: string): RegExp {
  let out = "";
  for (let i = 0; i < ere.length; i++) {
    const c = ere[i]!;
    if (c === "\\") {
      out += ere.slice(i, i + 2);
      i++;
    } else if (c === "[") {
      let j = i + 1;
      const neg = ere[j] === "^";
      if (neg) j++;
      let body = "";
      if (ere[j] === "]") {
        body += "\\]";
        j++;
      }
      while (j < ere.length && ere[j] !== "]") {
        const m = /^\[:([a-z]+):\]/.exec(ere.slice(j));
        if (m) {
          const cls = CLASSES[m[1]!];
          if (cls === undefined)
            throw new Error(`unsupported class [:${m[1]}:]`);
          body += cls;
          j += m[0].length;
        } else {
          body += ere[j] === "\\" || ere[j] === "[" ? `\\${ere[j]}` : ere[j];
          j++;
        }
      }
      if (j >= ere.length) throw new Error(`unclosed bracket in ${ere}`);
      out += `[${neg ? "^" : ""}${body}${neg ? "\\n" : ""}]`;
      i = j;
    } else out += c;
  }
  return new RegExp(out, "imu");
}

/**
 * The rules of the two files' texts, in order; undefined when one is missing,
 * a directive is malformed or a pattern does not translate, which scan
 * refuses rather than read as clean. A commit-only pattern naming a workflow
 * artefact (a .claude path, the Plan: footer) is a leak and is tried before
 * the vendor keywords, so `\bclaude\b` does not report `.claude/plans/x.md`
 * as an attribution.
 */
export function parseRules(
  texts: readonly (string | undefined)[],
): Rules | undefined {
  const attr: Rule[] = [];
  const leak: Rule[] = [];
  const kw: Rule[] = [];
  for (const text of texts) {
    if (text === undefined) return undefined;
    let scope = ["commit"];
    for (const line of text.split("\n")) {
      const d = /^#\s*@scope:(.*)$/.exec(line);
      if (d) {
        const list = d[1]!.replace(/\s/g, "");
        if (!/^[a-z]+(,[a-z]+)*$/.test(list)) return undefined;
        scope = list.split(",");
        if (scope.some((s) => s !== "commit" && s !== "pr")) return undefined;
        continue;
      }
      if (line === "" || line.startsWith("#")) continue;
      let re: RegExp;
      try {
        re = toRegExp(line);
      } catch {
        return undefined;
      }
      if (scope.includes("pr")) attr.push({ motif: "attribution", re });
      else if (/\\\.claude|plan:/.test(line)) leak.push({ motif: "leak", re });
      else kw.push({ motif: "attribution", re });
    }
  }
  const commit = [...leak, ...kw];
  return attr.length && commit.length ? { attr, commit } : undefined;
}

/** The rules read from the vendored directory through `read`. */
export async function loadRules(
  read: (path: string) => Promise<string | undefined>,
  dir: string,
): Promise<Rules | undefined> {
  return parseRules(
    await Promise.all(
      PATTERN_FILES.map((f) => read(`${dir}/${f}`).catch(() => undefined)),
    ),
  );
}

/** The first §5 pattern `text` meets for `kind`, undefined for none. */
export function scan(
  kind: Kind,
  text: string,
  rules: Rules | undefined,
): Hit | undefined {
  const hay = text.toLowerCase();
  if (!/\S/.test(hay)) return undefined;
  if (!rules)
    return {
      motif: "attribution",
      pattern: `(hooks/patterns unreadable or malformed: nothing to check ${kind} text against)`,
      kind,
    };
  for (const p of rules.attr)
    if (p.re.test(hay)) return { motif: p.motif, pattern: p.re.source, kind };
  if (kind !== "commit") return undefined;
  const plain = plainNames(hay);
  for (const p of rules.commit)
    if (p.re.test(p.motif === "attribution" ? plain : hay))
      return { motif: p.motif, pattern: p.re.source, kind };
  return undefined;
}

/**
 * The vendor keywords (claude, anthropic) aim at a mention of the assistant,
 * not at a name that happens to contain the word. A name is technical when
 * the word is glued to an alphanumeric by - _ . or / (super-claude,
 * claude-code.d.ts, CLAUDE.md, @anthropic-ai/sdk) or sits inside backticks;
 * such an occurrence becomes `x`. Only the keyword pass reads this text:
 * leaks (.claude/ paths) and the attribution patterns see the text as
 * written. `hay` is lowercased. Same rule as _plain_names of on-tool.sh.
 */
export function plainNames(hay: string): string {
  return hay
    .replace(/`[^`\n]*(claude|anthropic)[^`\n]*`/g, " ")
    .replace(/([a-z0-9][-._/])(claude|anthropic)/g, "$1x")
    .replace(/(claude|anthropic)([-_/][a-z0-9]|\.[a-z0-9])/g, "x$2");
}
