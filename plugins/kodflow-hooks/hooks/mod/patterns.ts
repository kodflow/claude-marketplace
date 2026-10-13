// patterns.ts — §5 of the user's rules, as on-tool.sh's _scan applies them. Pure.
//
// The shell feeds each text to `grep -qiE`, which matches line by line: `^`
// anchors a line, and neither `.` nor a bracket expression crosses a newline.
// The translations below keep that: the multiline flag, and `[ \t\r\f\v]` for
// POSIX `[[:space:]]`. A commit message meets both lists; a pull or merge
// request title or body meets the attribution list only.

export type Kind = "commit" | "pr";
export type Hit = { motif: string; pattern: string; kind: Kind };

const S = "[ \\t\\r\\f\\v]";
const re = (p: string) => new RegExp(p, "imu");

export const ATTR_PATTERNS: readonly RegExp[] = [
  re(
    `^${S}*(co-authored-by|assisted-by|generated-by|authored-by|committed-by|reviewed-by|signed-off-by)${S}*:.*(claude|anthropic|openai|chatgpt|gpt-[0-9]|copilot|gemini|codeium|cursor|devin|aider|llm|[^a-z\\n]ai[^a-z\\n])`,
  ),
  re("noreply@anthropic\\.com"),
  re("copilot@users\\.noreply\\.github\\.com"),
  re(
    `generated${S}+(by|with|using)${S}+\\[?(claude|ai|gpt|chatgpt|anthropic|copilot|gemini|cursor|devin|aider|an?${S}+llm)`,
  ),
  re("\u{1F916}"),
  re(`\\bai[-${S.slice(1, -1)}]?(assisted|generated|authored|written)\\b`),
  re(
    `\\b(written|authored|generated)${S}+by${S}+an?${S}+(ai|llm|language${S}+model)\\b`,
  ),
];

/** commit only: the rest of §5, each with its motif. */
export const COMMIT_PATTERNS: readonly { motif: string; re: RegExp }[] = [
  { motif: "leak", re: re(`^${S}*plan:`) },
  { motif: "attribution", re: re(`claude[-${S.slice(1, -1)}]code`) },
  { motif: "leak", re: re("\\.claude/") },
  { motif: "leak", re: re(`(see|ref|tracked-in)${S}+\\.claude`) },
  { motif: "leak", re: re(`\\bplan${S}+\\.claude`) },
];

/** The first §5 pattern `text` meets for `kind`, undefined for none. */
export function scan(kind: Kind, text: string): Hit | undefined {
  const hay = text.toLowerCase();
  if (!/\S/.test(hay)) return undefined;
  for (const p of ATTR_PATTERNS)
    if (p.test(hay)) return { motif: "attribution", pattern: p.source, kind };
  if (kind !== "commit") return undefined;
  for (const p of COMMIT_PATTERNS)
    if (p.re.test(hay)) return { motif: p.motif, pattern: p.re.source, kind };
  return undefined;
}
