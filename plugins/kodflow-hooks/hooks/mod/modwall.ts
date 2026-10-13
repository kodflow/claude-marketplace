// modwall.ts — which hooks modules may join the chain. Pure.
//
// A mod a person installs runs in the user tier, beside kodflow-hooks: it
// could approve what the shell guards refuse. Only the kodflow marketplace's
// own plugins are admitted there. The list lives here, in the code, so
// nothing the model can write widens it. Built-ins and the organisation's
// managed tiers are not judged.

/** The marketplaces whose plugins a user-tier module may come from. */
export const ALLOWED_MARKETPLACES: readonly string[] = ["kodflow"];

export type Registration = {
  name: string;
  tier: string;
  provenance: string;
};

export type Decision = Registration & {
  /** Seconds since the epoch. */
  at: number;
  verdict: "allowed" | "refused" | "not judged";
  reason?: string;
};

/** How many decisions the store keeps, newest last. */
export const KEEP = 100;

/** The marketplace a provenance names: `<name>@<marketplace>`. */
export function marketplaceOf(provenance: string): string {
  const at = provenance.lastIndexOf("@");
  return at < 0 ? "" : provenance.slice(at + 1);
}

/**
 * The verdict on one module. Keyed on the provenance the loader writes, not
 * on the name the plugin gives itself: `evil@kodflow` cannot be spelled by a
 * plugin from elsewhere, `kodflow-hooks@inline` (a `--plugin-dir`) can.
 */
export function judge(
  r: Registration,
): { refuse: string } | { allow: true } | { skip: true } {
  if (r.tier !== "user") return { skip: true };
  if (ALLOWED_MARKETPLACES.includes(marketplaceOf(r.provenance)))
    return { allow: true };
  return {
    refuse: `modwall: ${r.provenance} is not from the kodflow marketplace; only *@kodflow mods load in the user tier`,
  };
}

export function decision(r: Registration, nowSec: number): Decision {
  const v = judge(r);
  const base = {
    name: r.name,
    tier: r.tier,
    provenance: r.provenance,
    at: nowSec,
  };
  if ("refuse" in v) return { ...base, verdict: "refused", reason: v.refuse };
  return { ...base, verdict: "skip" in v ? "not judged" : "allowed" };
}

/** Append, newest last, at most KEEP; anything malformed in the store is dropped. */
export function remember(stored: unknown, d: Decision): Decision[] {
  const list = Array.isArray(stored)
    ? stored.filter(
        (x): x is Decision =>
          !!x &&
          typeof x === "object" &&
          typeof (x as any).provenance === "string",
      )
    : [];
  return [...list, d].slice(-KEEP);
}

const when = (sec: number): string =>
  new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19);

/** What `/kodflow-mods` prints. */
export function report(
  thisLoad: readonly Decision[],
  history: readonly Decision[],
): string {
  const lines = [
    "Mods judged at this load (a module loaded before kodflow-hooks is not seen):",
  ];
  if (thisLoad.length === 0) lines.push("  none");
  for (const d of thisLoad)
    lines.push(`  ${d.verdict.padEnd(10)} ${d.provenance} (${d.tier})`);
  const refused = history.filter((d) => d.verdict === "refused");
  lines.push("", `Refusals on record (last ${KEEP} decisions, UTC):`);
  if (refused.length === 0) lines.push("  none");
  for (const d of refused)
    lines.push(`  ${when(d.at)}  ${d.provenance} (${d.tier})`);
  return lines.join("\n");
}
