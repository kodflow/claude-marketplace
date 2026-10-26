// client.tsx — the « Tâches » pane's surface module: the tree and the graph,
// and what the person does with them. Runs on the drawing thread, without `$`:
// the hooks module hands it the tree as plain data (`props.model`) on every
// redraw, and the selection, the open branches and the view stay here, in the
// instance's own state, across those redraws.
//
// Keys reach it once a click has given its region the focus (Escape hands
// the focus back): ↑ ↓ choose a task, ⏎ (or space) folds or unfolds it, tab
// goes to the next view (Arbre, Graphe, Refus, Documents). A click on a task
// chooses it, a second click (or one on a task with subtasks) folds it; a
// click on a view's name in the bar shows it. A click never moves the row it
// hit (the pin, layout.tsx), so a second click lands where the first one did.
//
// « Refus » and « Documents » (panels.ts): ↑ ↓ choose, ⏎ shows a refusal's
// rule for confirmation or ignores and brings back a document; a click does
// the same. What writes a file or the prompt box is posted to the hooks
// module (`surface.post`), which checks it again: « ajouter » (a), « copier »
// (c), a document ignored or brought back, « créer » (c) and « Créer les
// manquants » (t). The mode the drafts carry (m) stays here.
//
// « Chasse » (panels.ts), last and only while a hunt is listed: tab skips it
// otherwise, and a view left on it when the hunt goes shows the tree. ↑ ↓
// scroll its lines; « reprendre » (or ⏎ on that hunt) posts the draft
// `/hunt --resume <slug>`. Leaving the view notes each hunt's last seq: the
// next visit's digest is what came after.

import type { TreeModel } from "./tree.ts";
import {
  VIEWS,
  draw,
  initialUi,
  pinAt,
  step,
  toggle,
  type Act,
  type Screen,
  type Ui,
} from "./layout.tsx";
import { MODES } from "./docs.ts";
import {
  blockKey,
  countsOf,
  slugOfKey,
  viewScreen,
  type Extra,
} from "./panels.ts";
import { canResume } from "./hunt.ts";

type Props = { model: TreeModel; width: number; rows: number; extra?: Extra };

export default function TaskTree(raw: unknown, surface: any) {
  const props = raw as Props;
  const hunting = !!(props.extra && countsOf(props.extra).hunt);
  // A view on « Chasse » once the hunt is gone reads as the tree
  const fix = (u: Ui): Ui =>
    u.view === "hunt" && !hunting ? { ...u, view: "tree" } : u;
  const ui: Ui = fix(surface.state ?? initialUi(props.model));
  const screenFor = (u: Ui) =>
    viewScreen(props.model, u, props.width, props.rows, props.extra);
  const screen = screenFor(ui);
  // An event reads the state as it is now, not as this call drew it: two
  // events before the next frame each start from the one before
  const now = () => {
    const cur: Ui = surface.state ? fix(surface.state) : ui;
    return {
      cur,
      scr: cur === ui ? screen : screenFor(cur),
    };
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
  // A button's act: the hooks module's to do, or this state's
  const act = (a: Act, cur: Ui) => {
    if (a.op === "cancel") return set({ ...cur, pick: undefined }, cur);
    if (a.op === "pick") return set({ ...cur, pick: a.rule }, cur);
    if (a.op === "mode") return set({ ...cur, mode: a.mode }, cur);
    if (a.op === "resume") return resume(a.slug);
    if (a.op === "create")
      return surface.post({
        op: "create",
        ids: a.ids,
        mode: cur.mode ?? "both",
      });
    surface.post(a);
    if (a.op === "allow") set({ ...cur, pick: undefined }, cur);
  };
  // ↑ ↓ in « Refus » and « Documents »: the next one, kept on its line
  const walk = (scr: Screen, cur: Ui, by: number) => {
    const key =
      cur.view === "blocks"
        ? cur.bsel
        : cur.view === "hunt"
          ? cur.hsel
          : cur.dsel;
    const i = key === undefined ? -1 : scr.order.indexOf(key);
    const next = scr.order[Math.max(0, Math.min(scr.order.length - 1, i + by))];
    if (next === undefined) return;
    const shown = scr.rowIds.indexOf(next);
    const { top, rows } = scr.list;
    const y = shown >= 0 ? shown : by > 0 ? top + Math.max(0, rows - 1) : top;
    const pick =
      cur.view === "blocks"
        ? { bsel: next, pick: undefined }
        : cur.view === "hunt"
          ? { hsel: next }
          : { dsel: next };
    set({ ...cur, ...pick, ppin: { id: next, y } }, cur);
  };
  // ⏎ or a click on a refusal or a document
  const choose = (cur: Ui, id: string, y?: number) => {
    const ppin = y === undefined ? cur.ppin : { id, y };
    if (cur.view === "hunt") {
      set({ ...cur, hsel: id, ppin }, cur);
      // ⏎ on a hunt probably orphaned drafts its resume; a click only chooses
      if (y === undefined) resume(slugOfKey(id));
      return;
    }
    if (cur.view === "blocks") {
      const b = props.extra?.blocks.find((x) => blockKey(x) === id);
      return set({ ...cur, bsel: id, pick: b?.rule, ppin }, cur);
    }
    const d = props.extra?.docs.docs.find((x) => x.id === id);
    set({ ...cur, dsel: id, ppin }, cur);
    if (d) surface.post({ op: "ignore", id, ignore: d.state !== "ignored" });
  };
  surface.onKey(
    (k: { key: string; shift?: true; ctrl?: true; meta?: true }) => {
      const { cur, scr } = now();
      if (k.key === "tab") {
        const views = VIEWS.filter((v) => v !== "hunt" || hunting);
        const next = views[(views.indexOf(cur.view) + 1) % views.length]!;
        return set(goto(cur, next), cur);
      }
      if (typeof scr === "string") return;
      if (cur.view === "blocks" || cur.view === "docs" || cur.view === "hunt") {
        const sel =
          cur.view === "blocks"
            ? cur.bsel
            : cur.view === "hunt"
              ? cur.hsel
              : cur.dsel;
        if (k.key === "down") return walk(scr, cur, 1);
        if (k.key === "up") return walk(scr, cur, -1);
        if ((k.key === "return" || k.key === " ") && sel !== undefined)
          return choose(cur, sel);
        if (cur.view === "blocks" && cur.pick) {
          if (k.key === "a") return act({ op: "allow", rule: cur.pick }, cur);
          if (k.key === "c") return act({ op: "copy", rule: cur.pick }, cur);
          if (k.key === "n") return act({ op: "cancel" }, cur);
        }
        if (cur.view === "docs") {
          const m = cur.mode ?? "both";
          if (k.key === "m")
            return act(
              {
                op: "mode",
                mode: MODES[(MODES.indexOf(m) + 1) % MODES.length]!,
              },
              cur,
            );
          if (k.key === "t") return act({ op: "create", ids: [] }, cur);
          const d = props.extra?.docs.docs.find((x) => x.id === sel);
          if (k.key === "c" && d?.state === "missing")
            return act({ op: "create", ids: [d.id] }, cur);
        }
        return;
      }
      if (cur.view !== "tree") return;
      if (k.key === "down") set(step(scr, cur, 1), cur);
      else if (k.key === "up") set(step(scr, cur, -1), cur);
      else if ((k.key === "return" || k.key === " ") && cur.sel !== undefined)
        set(toggle(props.model, pinAt(scr, cur, cur.sel), cur.sel), cur);
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
      if (button) return act(button.act, cur);
      const id = scr.rowIds[e.y];
      if (id === undefined) return;
      if (cur.view === "blocks" || cur.view === "docs" || cur.view === "hunt")
        return choose(cur, id, e.y);
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
