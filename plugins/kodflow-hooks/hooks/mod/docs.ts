// docs.ts — the docs_search tool: a read of the project's document index
// (hooks/scripts/lib/kf_docs.py), served without a second MCP server. Pure:
// register.ts runs the argv this builds.

export const DOCS_TOOL = "docs_search";

export const DOCS_SEARCH = {
  name: DOCS_TOOL,
  description:
    "Search the project's documents (ADRs split by section, docs/**/*.md, every CLAUDE.md, and the global " +
    "knowledge base and memory) with BM25. Returns at most `limit` hits (default 8), each " +
    "`num · title · status · area · path:line` and a snippet of at most 200 characters, never a whole " +
    "document: Read the cited section with offset/limit. Versions, numbers and paths match whole " +
    "(0.2.57, ADR-0152, net/http1). Superseded ADRs are left out unless all=true. Use it before grepping docs/.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Words, a version, an ADR number or a path." },
      area: { type: "string", description: "Keep ADRs whose Area contains this tag." },
      need: {
        type: "string",
        description: "decision, constraint, incident, convention or record.",
      },
      status: { type: "string", description: "proposed, accepted, rejected, deprecated, amended..." },
      all: { type: "boolean", description: "Include superseded ADRs." },
      limit: { type: "integer", minimum: 1, maximum: 20, description: "At most this many hits (default 8)." },
    },
    required: ["query"],
  },
} as const;

/** The argv that runs one search; undefined when the query is not a non-empty string. */
export function docsArgv(
  script: string,
  args: Record<string, unknown>,
): string[] | undefined {
  const q = args.query;
  if (typeof q !== "string" || !q.trim()) return undefined;
  const argv = ["python3", "-I", script, "search", q, "--format", "md"];
  for (const k of ["area", "need", "status"] as const) {
    const v = args[k];
    if (typeof v === "string" && v.trim()) argv.push(`--${k}`, v);
  }
  if (args.all === true) argv.push("--all");
  const n = args.limit;
  if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 20)
    argv.push("--limit", String(n));
  return argv;
}
