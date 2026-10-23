// fixtures.ts — docs.json, blocks.jsonl and a docs/manifest.json written as
// the shared contract lays them out (kodflow-hooks writes the first two in
// the session's folder, beside tasks.json; the project versions the third),
// dated around the test clock.
import { CFG, NOW, SID } from "./host.ts";

export const DIR = `${CFG}/kodflow/sessions/${SID}`;
export const DOCS = `${DIR}/docs.json`;
export const BLOCKS = `${DIR}/blocks.jsonl`;
export const ROOT = "/w/repo";
export const MANIFEST = `${ROOT}/docs/manifest.json`;
export const SETTINGS = `${ROOT}/.claude/settings.local.json`;

const MIN = 60_000;
export const iso = (ms: number) =>
  new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export const docsJson = JSON.stringify(
  {
    version: 1,
    root: ROOT,
    manifest: "docs/manifest.json",
    updated: iso(NOW - MIN),
    docs: [
      {
        id: "prd",
        name: "Exigences produit",
        path: "docs/vision.md",
        state: "ok",
        source: "video",
        why: "Ce que le produit doit faire, pour qui.",
      },
      {
        id: "trd",
        name: "Exigences techniques",
        path: "docs/tech/requirements.md",
        state: "missing",
        source: "video",
        why: "Les contraintes techniques retenues.",
      },
      {
        id: "flow",
        name: "Parcours",
        path: "docs/product/flow.md",
        state: "missing",
        source: "video",
        why: "Les parcours de l'utilisateur.",
      },
      {
        id: "design",
        name: "Brief de design",
        path: "docs/design/brief.md",
        state: "ignored",
        reason: "aucune interface hors du site",
        source: "video",
        why: "…",
      },
      {
        id: "readme",
        name: "README et démarrage",
        path: "README.md",
        state: "ok",
        source: "extra",
        why: "…",
      },
    ],
  },
  null,
  2,
);

/** Appended oldest first, as kodflow-hooks writes it; one line is broken. */
export const blocksJsonl = [
  {
    ts: iso(NOW - 180 * MIN),
    kind: "hook",
    tool: "Bash",
    summary: "TRIAGE FIRST",
    motif: "triage",
    agent: "main",
  },
  {
    ts: iso(NOW - 50 * MIN),
    kind: "classifier",
    tool: "Bash",
    summary: "Instruction Poisoning",
    agent: "tasks-flow-rules",
  },
  {
    ts: iso(NOW - 40 * MIN),
    kind: "ci",
    summary: "marketplace#81 directive size",
    ref: "https://github.com/kodflow/claude-marketplace/pull/81",
  },
  {
    ts: iso(NOW - 20 * MIN),
    kind: "hook",
    tool: "Bash",
    summary: "TRIAGE FIRST",
    motif: "triage",
    agent: "main",
  },
  {
    ts: iso(NOW - 10 * MIN),
    kind: "permission",
    tool: "Bash",
    summary: "git push refusé",
    agent: "main",
    rule: "Bash(git push:*)",
  },
]
  .map((b) => JSON.stringify(b))
  .concat(
    "not json",
    JSON.stringify({
      ts: iso(NOW - 5 * MIN),
      kind: "agent",
      summary: "tasks-flow-rules arrêté, tâche #2 reprise",
    }),
  )
  .join("\n")
  .concat("\n");

/** The project's manifest: its documents out of order, a key of its own. */
export const manifestJson = `${JSON.stringify(
  {
    version: 1,
    documents: {
      design: { ignored: "aucune interface hors du site" },
      prd: { path: "docs/vision.md" },
    },
    owner: "équipe",
  },
  null,
  2,
)}\n`;
