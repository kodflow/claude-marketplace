// client.tsx — the « Tâches » pane's surface module: the tree and the graph,
// and what the person does with them. Runs on the drawing thread, without `$`:
// the hooks module hands it the tree as plain data (`props.model`) on every
// redraw, and the selection, the open branches and the view stay here, in the
// instance's own state, across those redraws.
//
// Keys reach it once a click has given its region the focus (Escape hands
// the focus back): ↑ ↓ choose a task, ⏎ (or space) folds or unfolds it, tab
// switches between the tree and the graph. A click on a task chooses it, a
// second click (or one on a task with subtasks) folds it; a click on « Arbre »
// or « Graphe » switches the view.

import type { TreeModel } from "./tree.ts";
import { draw, initialUi, screenOf, step, toggle, type Ui } from "./layout.tsx";

type Props = { model: TreeModel; width: number; rows: number };

export default function TaskTree(raw: unknown, surface: any) {
  const props = raw as Props;
  const ui: Ui = surface.state ?? initialUi(props.model);
  const screen = screenOf(props.model, ui, props.width, props.rows);
  const set = (next: Ui) => {
    if (next !== ui) surface.setState(next);
  };
  surface.onKey((k: { key: string; shift?: true }) => {
    if (k.key === "tab")
      return set({ ...ui, view: ui.view === "tree" ? "graph" : "tree" });
    if (typeof screen === "string" || ui.view !== "tree") return;
    if (k.key === "down") set(step(screen, ui, 1));
    else if (k.key === "up") set(step(screen, ui, -1));
    else if ((k.key === "return" || k.key === " ") && ui.sel !== undefined)
      set(toggle(props.model, ui, ui.sel));
  });
  surface.onPointer(
    (e: { type: string; x: number; y: number; button?: string }) => {
      if (e.type !== "down" || (e.button && e.button !== "left")) return;
      if (typeof screen === "string") return;
      if (e.y === screen.tabsLine) {
        const tab = screen.tabs.find((t) => e.x >= t.x && e.x < t.x + t.w);
        if (tab) set({ ...ui, view: tab.view });
        return;
      }
      const id = screen.rowIds[e.y];
      if (id === undefined) return;
      const chosen = { ...ui, sel: id };
      set(
        ui.sel === id || hasKids(props.model, id)
          ? toggle(props.model, chosen, id)
          : chosen,
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
