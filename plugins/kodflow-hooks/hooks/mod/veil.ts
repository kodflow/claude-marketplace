// veil.ts — secrets masked in what a tool returns, before the model reads it.
// Pure: register.ts hands in the environment's values and the clock.
//
// After the tool ran (`next`), never on its input: the call runs as written,
// only its result is read through this. Three kinds of secret go:
//   - the value of a known credential variable of the session's environment;
//   - a credential by its shape (provider prefixes, Bearer, private key
//     blocks, user:password@ in a URL, key=value assignments);
//   - a token of 20 characters or more, letters and digits mixed, whose
//     entropy passes 4.3 bits per character, unless it is a hash (hex), a
//     UUID, a path, an integrity digest, or base64 of plain text.
// An image block ({type:"image"}) is left whole: its data is base64 pixels.
// A masked value cannot be revealed: nothing keeps it. Past the size or the
// time budget the result is returned as it came (fail open).

export const VEIL_MAX_CHARS = 2_000_000;
export const VEIL_MAX_MS = 1_500;
export const ENTROPY_MIN = 4.3;
export const TOKEN_MIN = 20;

/** Environment variables whose value is a credential. */
export const SECRET_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITLAB_TOKEN",
  "GL_TOKEN",
  "CI_JOB_TOKEN",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "OP_SERVICE_ACCOUNT_TOKEN",
  "OP_CONNECT_TOKEN",
  "VAULT_TOKEN",
  "NOMAD_TOKEN",
  "CONSUL_HTTP_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CF_API_TOKEN",
  "SLACK_TOKEN",
  "SLACK_BOT_TOKEN",
  "DOCKER_PASSWORD",
  "HF_TOKEN",
  "GOOGLE_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "DATABASE_URL",
] as const;

type Shape = { kind: string; re: RegExp; group?: number };

// Assembled so this file does not read as a credential to a line scanner.
const PEM = `-----BEGIN [A-Z0-9 ]*PRIV${"ATE"} KEY-----[\\s\\S]*?-----END [A-Z0-9 ]*PRIV${"ATE"} KEY-----`;

export const SHAPES: readonly Shape[] = [
  { kind: "private-key", re: new RegExp(PEM, "g") },
  {
    kind: "github",
    re: /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  },
  { kind: "gitlab", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: "anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: "openai", re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/g },
  { kind: "aws", re: /\b(AK|AS)IA[0-9A-Z]{16}\b/g },
  { kind: "google", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "slack", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: "1password", re: /\bops_[A-Za-z0-9_-]{40,}/g },
  { kind: "vault", re: /\bhv[sbr]\.[A-Za-z0-9_-]{20,}/g },
  { kind: "npm", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  {
    kind: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    kind: "bearer",
    re: /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{12,})/g,
    group: 2,
  },
  { kind: "url-credentials", re: /:\/\/[^/\s:@]+:([^/\s:@]{3,})@/g, group: 1 },
  {
    kind: "assignment",
    re: /\b(pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)(["']?\s*[:=]\s*["']?)([^\s"'`,;]{8,})/gi,
    group: 3,
  },
];

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  const n = [...s].length;
  for (const k of counts.values()) {
    const p = k / n;
    h -= p * Math.log2(p);
  }
  return h;
}

const printable = (bytes: Uint8Array) => {
  if (!bytes.length) return false;
  let ok = 0;
  for (const b of bytes)
    if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13) ok++;
  return ok / bytes.length >= 0.9;
};

function decodeBase64(s: string): Uint8Array | undefined {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+=*$/.test(t)) return undefined;
  try {
    const bin = atob(t.padEnd(t.length + ((4 - (t.length % 4)) % 4), "="));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** Why a high-entropy token is not a secret, or undefined when it may be one. */
export function exempt(tok: string): string | undefined {
  if (/^[0-9a-f]+$/i.test(tok)) return "hex";
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tok)
  )
    return "uuid";
  if (
    tok.includes("/") &&
    /^(\.{0,2}\/|~\/)?[\w.@+-]+(\/[\w.@+-]*)+$/.test(tok) &&
    !/[+=]/.test(tok)
  )
    return "path";
  if (/^sha(1|256|384|512)-/.test(tok)) return "integrity";
  if (!/[A-Za-z]/.test(tok) || !/[0-9]/.test(tok)) return "not mixed";
  const bytes = decodeBase64(tok.replace(/=+$/, ""));
  if (bytes && printable(bytes)) return "base64 text";
  return undefined;
}

const TOKEN = /[A-Za-z0-9+/=_.-]{20,}/g;

export type Veiled = { text: string; masked: number; kinds: string[] };

export type VeilCtx = {
  /** Values of the known credential variables, empty ones left out. */
  envValues: readonly string[];
  /** Milliseconds; the time budget is measured with it. */
  now(): number;
};

class Budget extends Error {}

/** One text, masked. Throws Budget past the time limit. */
function maskText(
  text: string,
  ctx: VeilCtx,
  deadline: number,
  kinds: Set<string>,
): { text: string; masked: number } {
  let masked = 0;
  let out = text;
  const tag = (kind: string) => {
    masked++;
    kinds.add(kind);
    return `[masked:${kind}]`;
  };
  for (const v of ctx.envValues) {
    if (v.length < 8 || !out.includes(v)) continue;
    out = out.split(v).join(tag("env"));
  }
  for (const s of SHAPES) {
    if (ctx.now() > deadline) throw new Budget();
    s.re.lastIndex = 0;
    out = out.replace(s.re, (...m: any[]) => {
      if (s.group === undefined) return tag(s.kind);
      const whole: string = m[0];
      const part: string | undefined = m[s.group];
      if (!part || part.startsWith("[masked:")) return whole;
      return (
        whole.slice(0, whole.lastIndexOf(part)) +
        tag(s.kind) +
        whole.slice(whole.lastIndexOf(part) + part.length)
      );
    });
  }
  if (ctx.now() > deadline) throw new Budget();
  out = out.replace(TOKEN, (tok) => {
    const core = tok.replace(/^[.=_-]+|[.=_-]+$/g, "");
    if (core.length < TOKEN_MIN || core.startsWith("masked:")) return tok;
    if (exempt(core) !== undefined) return tok;
    if (entropy(core) <= ENTROPY_MIN) return tok;
    return tok.replace(core, tag("entropy"));
  });
  return { text: out, masked };
}

/** Masks every string reached in `value` (depth-limited), in place of a copy. */
export function veil(
  value: unknown,
  ctx: VeilCtx,
): { value: unknown; masked: number; kinds: string[] } | undefined {
  const start = ctx.now();
  const deadline = start + VEIL_MAX_MS;
  let size = 0;
  const kinds = new Set<string>();
  let masked = 0;
  // Keys that name things rather than carry output
  const SKIP = new Set([
    "filePath",
    "file_path",
    "path",
    "type",
    "tool_use_id",
    "persistedOutputPath",
    "backgroundTaskId",
  ]);
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") {
      size += v.length;
      if (size > VEIL_MAX_CHARS) throw new Budget();
      const r = maskText(v, ctx, deadline, kinds);
      masked += r.masked;
      return r.text;
    }
    if (depth > 8 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    // An image block carries base64 pixels, not text: its data field passes
    // the entropy test and would be replaced, breaking the picture. Every
    // text block of the same result is still read.
    if ((v as { type?: unknown }).type === "image") return v;
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v))
      o[k] = SKIP.has(k) ? x : walk(x, depth + 1);
    return o;
  };
  try {
    const out = walk(value, 0);
    return { value: out, masked, kinds: [...kinds] };
  } catch (err) {
    if (err instanceof Budget) return undefined;
    throw err;
  }
}

type AnyResult = Record<string, any>;

/**
 * What the model reads for `r`, secrets masked. `r` itself when nothing was
 * found, or past the budget. An answered result keeps its shape; an errored
 * one (whose text is the core's own) is withheld with the masked text, the
 * only answer a hook can give after the tool ran without passing `result`.
 */
export function veilResult(r: AnyResult, ctx: VeilCtx): AnyResult {
  if (!r || typeof r !== "object" || r.deny !== undefined) return r;
  if (r.isError) {
    const text =
      typeof r.text === "string"
        ? r.text
        : typeof r.result === "string"
          ? r.result
          : undefined;
    if (text === undefined) return r;
    const v = veil(text, ctx);
    if (!v || !v.masked) return r;
    return { deny: String(v.value) };
  }
  if (!("result" in r)) return r;
  const v = veil(r.result, ctx);
  if (!v || !v.masked) return r;
  return { ...r, result: v.value };
}
