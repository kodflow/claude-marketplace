// client.tsx — the « Tâches » pane's surface module: the tree, and what the
// person does with it. Runs on the drawing thread, without `$`: the hooks
// module hands it the tree as plain data (`props.model`) on every redraw,
// and the selection, the open branches, the idle epics opened and the view
// stay here, in the instance's own state, across those redraws.
//
// Keys reach it once a click has given its region the focus (Escape hands
// the focus back): ↑ ↓ choose a task, ⏎ (or space) folds or unfolds it, or
// opens an idle epic's line; tab goes to « Chasse » and back while a hunt is
// listed. A click on a task chooses it, a second click (or one on a task
// with subtasks) folds it; a click on an idle epic's line opens it; a click
// on a view's name in the bar shows it. A click never moves the row it hit
// (the pin, layout.tsx), so a second click lands where the first one did.
//
// What the surface kept is normalised before it is drawn (layout.tsx
// `normalise`): a view of an older version is the tree, its other fields
// are left aside, a selection the tree no longer shows moves to the active
// epic's first task. Nothing is written back for that: only what the person
// changes is kept.
//
// « Chasse » (view.ts), only while a hunt is listed: tab skips it otherwise,
// and a view left on it when the hunt goes shows the tree. ↑ ↓ scroll its
// lines; « reprendre » (or ⏎ on that hunt) posts the draft
// `/hunt --resume <slug>`, the one thing this module posts. Leaving the view
// notes each hunt's last seq: the next visit's digest is what came after.

import type { TreeModel } from "./tree.ts";
import {
  VIEWS,
  draw,
  epicOfKey,
  normalise,
  pinAt,
  step,
  toggle,
  toggleIdle,
  type Act,
  type Screen,
  type Ui,
} from "./layout.tsx";
import { countsOf, slugOfKey, viewScreen, type Extra } from "./view.ts";
import { canResume } from "./hunt.ts";

type Props = { model: TreeModel; width: number; rows: number; extra?: Extra };

export default function TaskTree(raw: unknown, surface: any) {
  const props = raw as Props;
  const hunting = !!(props.extra && countsOf(props.extra).hunt);
  // A view on « Chasse » once the hunt is gone reads as the tree
  const fix = (u: unknown): Ui => {
    const n = normalise(props.model, u);
    return n.view === "hunt" && !hunting ? { ...n, view: "tree" } : n;
  };
  // The fault seam (view.ts Extra): inert unless the hooks module hands it down
  const probe = !!props.extra?.faultProbe;
  if (probe && (surface.state as { probe?: boolean } | undefined)?.probe)
    return draw(surface.elements, "×".repeat(120_000), props.width);
  const ui: Ui = fix(surface.state);
  const screenFor = (u: Ui) =>
    viewScreen(props.model, u, props.width, props.rows, props.extra);
  const screen = screenFor(ui);
  // An event reads the state as it is now, not as this call drew it: two
  // events before the next frame each start from the one before
  const now = () => {
    const cur: Ui = surface.state ? fix(surface.state) : ui;
    return { cur, scr: cur === ui ? screen : screenFor(cur) };
  };
  const set = (next: Ui, cur: Ui) => {
    if (next !== cur) surface.setState(next);
  };
  // Each hunt's last seq, as the view is left or opened
  const seqs = () =>
    Object.fromEntries(
      (props.extra?.hunt?.runs ?? [])
        .filter((r) => r.status)
        .map((r) => [r.slug, r.status!.seq]),
    );
  // Another view: « Chasse » left notes what was seen, opened reads it back
  const goto = (cur: Ui, view: Ui["view"]): Ui => {
    if (view === cur.view) return cur;
    if (cur.view === "hunt") return { ...cur, view, hlast: seqs() };
    if (view === "hunt") return { ...cur, view, hsince: cur.hlast ?? {} };
    return { ...cur, view };
  };
  const resume = (slug: string) => {
    if (
      canResume(
        props.extra?.hunt ?? { found: false, runs: [] },
        slug,
        props.extra?.now ?? 0,
      )
    )
      surface.post({ op: "resume", slug });
  };
  const act = (a: Act) => resume(a.slug);
  // ↑ ↓ in « Chasse »: the next line, kept on its line
  const walk = (scr: Screen, cur: Ui, by: number) => {
    const i = cur.hsel === undefined ? -1 : scr.order.indexOf(cur.hsel);
    const next = scr.order[Math.max(0, Math.min(scr.order.length - 1, i + by))];
    if (next === undefined) return;
    const shown = scr.rowIds.indexOf(next);
    const { top, rows } = scr.list;
    const y = shown >= 0 ? shown : by > 0 ? top + Math.max(0, rows - 1) : top;
    set({ ...cur, hsel: next, ppin: { id: next, y } }, cur);
  };
  // ⏎ or a click on a line of « Chasse »
  const choose = (cur: Ui, id: string, y?: number) => {
    const ppin = y === undefined ? cur.ppin : { id, y };
    set({ ...cur, hsel: id, ppin }, cur);
    // ⏎ on a hunt probably orphaned drafts its resume; a click only chooses
    if (y === undefined) resume(slugOfKey(id));
  };
  // ⏎ or a click on the tree's line `id`: an idle epic opens, a task folds
  const press = (scr: Screen, cur: Ui, id: string, y?: number) => {
    const epic = epicOfKey(id);
    const pinned = pinAt(scr, { ...cur, sel: id }, id, y);
    if (epic !== undefined) return set(toggleIdle(pinned, epic), cur);
    if (y === undefined) return set(toggle(props.model, pinned, id), cur);
    // The task stays on the line clicked, whatever opens or closes
    const chosen: Ui = { ...cur, sel: id, pin: { id, y } };
    set(
      cur.sel === id || hasKids(props.model, id)
        ? toggle(props.model, chosen, id, true)
        : chosen,
      cur,
    );
  };
  surface.onKey(
    (k: { key: string; shift?: true; ctrl?: true; meta?: true }) => {
      const { cur, scr } = now();
      if (probe && k.key === "!") return surface.setState({ ...cur, probe: true });
      if (k.key === "tab") {
        const views = VIEWS.filter((v) => v !== "hunt" || hunting);
        const next = views[(views.indexOf(cur.view) + 1) % views.length]!;
        return set(goto(cur, next), cur);
      }
      if (typeof scr === "string") return;
      if (cur.view === "hunt") {
        if (k.key === "down") return walk(scr, cur, 1);
        if (k.key === "up") return walk(scr, cur, -1);
        if ((k.key === "return" || k.key === " ") && cur.hsel !== undefined)
          return choose(cur, cur.hsel);
        return;
      }
      if (k.key === "down") set(step(scr, cur, 1), cur);
      else if (k.key === "up") set(step(scr, cur, -1), cur);
      else if ((k.key === "return" || k.key === " ") && cur.sel !== undefined)
        press(scr, cur, cur.sel);
    },
  );
  surface.onPointer(
    (e: { type: string; x: number; y: number; button?: string }) => {
      if (e.type !== "down" || (e.button && e.button !== "left")) return;
      const { cur, scr } = now();
      if (typeof scr === "string") return;
      if (e.y === scr.tabsLine) {
        const tab = scr.tabs.find((t) => e.x >= t.x && e.x < t.x + t.w);
        if (tab) set(goto(cur, tab.view), cur);
        return;
      }
      const button = scr.buttons?.find(
        (b) => b.y === e.y && e.x >= b.x && e.x < b.x + b.w,
      );
      if (button) return act(button.act);
      const id = scr.rowIds[e.y];
      if (id === undefined) return;
      if (cur.view === "hunt") return choose(cur, id, e.y);
      press(scr, cur, id, e.y);
    },
  );
  return draw(surface.elements, screen, props.width);
}

function hasKids(model: TreeModel, id: string): boolean {
  let found = false;
  const walk = (list: TreeModel["epics"][number]["nodes"]) =>
    list.forEach((n) => {
      if (n.id === id && n.kids.length) found = true;
      walk(n.kids);
    });
  for (const e of model.epics) walk(e.nodes);
  return found;
}
