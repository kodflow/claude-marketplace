// corpus.ts — the bash-guard corpus replayed against the mod's guards.
//
// tests/fixtures/bash-guard.jsonl is what scripts/tests/test_hooks.sh feeds
// on-tool.sh. Every Bash row (`cmd`) is decided here by guards.ts the same
// way: rc 2 with the same [motif:x], or rc 0. A known_gap row is played and
// reported, not counted, as the shell suite does. Rows for other tools
// (`tool`) are the shell's alone: the mod's Bash pipeline does not see them.
import { inspect, verdict, type GuardCtx } from "../../hooks/mod/guards.ts";

export type Row = {
  family: string;
  cmd?: string;
  tool?: string;
  rc: number;
  motif?: string;
  agent?: boolean;
  root?: boolean;
  known_gap?: string;
};

export type Replay = {
  rows: number;
  passed: number;
  failures: string[];
  gaps: string[];
  otherTools: number;
};

/** The decision the guards take on one row: [rc, motif]. */
export async function decide(
  row: Row,
  base: Omit<GuardCtx, "agentId" | "rootMain">,
): Promise<[number, string]> {
  const ctx: GuardCtx = {
    ...base,
    agentId: row.agent ? "agt_corpus" : undefined,
    rootMain: !row.agent && row.root === true,
  };
  const found = await inspect(row.cmd!, ctx);
  const r = found && (await verdict(row.cmd!, found, ctx));
  return r ? [2, r.motif] : [0, ""];
}

export async function replay(
  jsonl: string,
  base: Omit<GuardCtx, "agentId" | "rootMain">,
): Promise<Replay> {
  const out: Replay = {
    rows: 0,
    passed: 0,
    failures: [],
    gaps: [],
    otherTools: 0,
  };
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Row;
    if (row.tool) {
      out.otherTools++;
      continue;
    }
    out.rows++;
    const [rc, motif] = await decide(row, base);
    const same =
      rc === row.rc && (row.rc === 0 || !row.motif || motif === row.motif);
    const label = row.cmd!.replace(/\n/g, "⏎").slice(0, 90);
    if (row.known_gap) out.gaps.push(`${same ? "(now holds) " : ""}${label}`);
    else if (same) out.passed++;
    else
      out.failures.push(
        `${label}: want rc=${row.rc} motif=${row.motif ?? ""}, got rc=${rc} motif=${motif}`,
      );
  }
  return out;
}
