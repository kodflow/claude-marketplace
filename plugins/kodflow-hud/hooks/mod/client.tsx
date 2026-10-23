// client.tsx — the « Tâches » pane's surface module: the tree and the graph,
// and what the person does with them. Runs on the drawing thread, without `$`:
// the hooks module hands it the tree as plain data (`props.model`) on every
// redraw, and the selection, the open branches and the view stay here, in the
// instance's own state, across those redraws.
//
// Keys reach it once a click has given its region the focus (Escape hands
// the focus back): ↑ ↓ choose a task, ⏎ (or space) folds or unfolds it, tab
// switches between the tree and the graph. A click on a task chooses it, a
// second click (or one on a task with subtasks) folds it; a click on
// « Arbre » or « Graphe » switches the view. A click never moves the row it
// hit (the pin, layout.tsx), so a second click lands where the first one did.

import type { TreeModel } from "./tree.ts";
import {
  draw,
  initialUi,
  pinAt,
  screenOf,
  step,
  toggle,
  type Ui,
} from "./layout.tsx";

type Props = { model: TreeModel; width: number; rows: number };

export default function TaskTree(raw: unknown, surface: any) {
  const props = raw as Props;
  const ui: Ui = surface.state ?? initialUi(props.model);
  const screen = screenOf(props.model, ui, props.width, props.rows);
  // An event reads the state as it is now, not as this call drew it: two
  // events before the next frame each start from the one before
  const now = () => {
    const cur: Ui = surface.state ?? ui;
    return {
      cur,
      scr:
        cur === ui
          ? screen
          : screenOf(props.model, cur, props.width, props.rows),
    };
  };
  const set = (next: Ui, cur: Ui) => {
    if (next !== cur) surface.setState(next);
  };
  surface.onKey((k: { key: string; shift?: true; ctrl?: true; meta?: true }) => {
    const { cur, scr } = now();
    if (k.key === "tab")
      return set({ ...cur, view: cur.view === "tree" ? "graph" : "tree" }, cur);
    if (typeof scr === "string" || cur.view !== "tree") return;
    if (k.key === "down") set(step(scr, cur, 1), cur);
    else if (k.key === "up") set(step(scr, cur, -1), cur);
    else if ((k.key === "return" || k.key === " ") && cur.sel !== undefined)
      set(toggle(props.model, pinAt(scr, cur, cur.sel), cur.sel), cur);
  });
  surface.onPointer(
    (e: { type: string; x: number; y: number; button?: string }) => {
      if (e.type !== "down" || (e.button && e.button !== "left")) return;
      const { cur, scr } = now();
      if (typeof scr === "string") return;
      if (e.y === scr.tabsLine) {
        const tab = scr.tabs.find((t) => e.x >= t.x && e.x < t.x + t.w);
        if (tab) set({ ...cur, view: tab.view }, cur);
        return;
      }
      const id = scr.rowIds[e.y];
      if (id === undefined) return;
      // The task stays on the line clicked, whatever opens or closes
      const chosen: Ui = { ...cur, sel: id, pin: { id, y: e.y } };
      set(
        cur.sel === id || hasKids(props.model, id)
          ? toggle(props.model, chosen, id, true)
          : chosen,
        cur,
      );
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
