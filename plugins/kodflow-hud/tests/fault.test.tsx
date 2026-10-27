// fault.test.tsx — the « Tâches » Client failing: born again under a new key,
// resting drawn still when it fails too often, and back after the rest.
//
// A fault the kit raises for real: the « Refus » view of hundreds of
// refusals on a tall pane draws a tree past the engine's 100,000 characters,
// which unmounts the instance. A new one starts on the tree view, which fits.
import { test, expect } from "claude-code/testing";
import { NOW, PANE, T, host, start, writeTasks } from "./host.ts";
import { BLOCKS, iso } from "./fixtures.ts";
import {
  FAULT_WINDOW_MS,
  NO_FAULT,
  RESTING_MS,
  onFault,
  resting,
} from "../hooks/mod/fault.ts";

/** The key of the Client the pane holds, if it holds one. */
const clientKey = (n: any): string | undefined => {
  if (!n || typeof n !== "object") return undefined;
  if (n.type === "Client") return n.props?.key ?? n.key;
  for (const c of n.children ?? []) {
    const k = clientKey(c);
    if (k) return k;
  }
  return undefined;
};

async function seeded($: any, on: any) {
  const { h, clock } = host(on);
  writeTasks(h, [T("1", "in_progress"), T("2", "pending")], 1);
  const many = Array.from({ length: 400 }, (_, i) =>
    JSON.stringify({
      ts: iso(NOW - (400 - i) * 5_000),
      kind: "permission",
      tool: "Bash",
      summary: `git push refusé, essai ${i} sur une branche au nom assez long`,
      agent: "main",
      rule: "Bash(git push:*)",
    }),
  );
  h.files.set(BLOCKS, { text: `${many.join("\n")}\n`, mtimeMs: 1 });
  await start($, clock);
  const ui = await $.ui.mount({
    plugin: "kodflow-hud",
    surface: "terminal",
    component: "Pane",
    requestId: "hud-tasks",
    props: PANE(300, 400),
  });
  return { h, clock, ui };
}

/** Tab over to « Refus » in the Client keyed `key`: that view fails it. */
const fail = async (ui: any, key: string) => {
  await ui.key({ key: "tab", in: key });
  await ui.key({ key: "tab", in: key }).catch(() => undefined);
};

test("a Client that fails is born again under a new key, on the tree", async ($, on) => {
  const { clock, ui } = await seeded($, on);
  expect(clientKey(await ui.drawn())).toBe("tree");
  await fail(ui, "tree");
  await clock.advance(3_000);
  expect(clientKey(await ui.drawn())).toBe("tree-1");
  expect(await ui.find({ in: "tree-1", text: /Task 1/ })).toBeTruthy();
});

test("a fourth fault within a minute: drawn still for five minutes, then the Client again", async ($, on) => {
  const { clock, ui } = await seeded($, on);
  for (const key of ["tree", "tree-1", "tree-2"]) {
    await fail(ui, key);
    await clock.advance(3_000);
  }
  expect(clientKey(await ui.drawn())).toBe("tree-3");
  await fail(ui, "tree-3");
  await clock.advance(3_000);
  // At rest: the hooks module draws the tree itself, no Client in it
  const still = await ui.drawn();
  expect(clientKey(still)).toBeUndefined();
  expect(JSON.stringify(still)).toContain("Task 1");
  await clock.advance(RESTING_MS - 60_000);
  expect(clientKey(await ui.drawn())).toBeUndefined();
  // The rest over, the next tick draws the Client back, on a key of its own
  await clock.advance(75_000);
  expect(clientKey(await ui.drawn())).toBe("tree-4");
});

test("faults further apart than a minute never rest the Client", () => {
  let f = NO_FAULT;
  for (let i = 0; i < 10; i++) f = onFault(f, i * FAULT_WINDOW_MS);
  expect(f.gen).toBe(10);
  expect(resting(f, 9 * FAULT_WINDOW_MS)).toBe(false);
  // Four within the minute: a rest, then a clean count after it
  let g = NO_FAULT;
  for (const t of [0, 1, 2, 3]) g = onFault(g, t * 1_000);
  expect(resting(g, 3_000 + RESTING_MS - 1)).toBe(true);
  expect(resting(g, 3_000 + RESTING_MS)).toBe(false);
  expect(g.at).toEqual([]);
});
