// render.ts — the module's JSX factory and an element table, in plain data,
// so the pure tests read a drawing as the engine is handed it: `{ type,
// props, children }`. The engine's own validation of the same trees runs in
// the `claude plugin test` suite, on the terminal and desktop tables.

export type Node = { type: string; props: Record<string, any>; children: unknown[] };

export const ELS = {
  Box: "Box",
  Text: "Text",
  Button: "Button",
  Link: "Link",
  Code: "Code",
} as const;

export function installH(): void {
  (globalThis as any).h = (type: unknown, props: Record<string, any> | null, ...children: unknown[]): Node => ({
    type: String(type),
    props: props ?? {},
    children: children.flat(),
  });
}

/** Every text a drawing shows: string children, labels, sources, links. */
export function texts(tree: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === "string" || typeof n === "number") return void out.push(String(n));
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    for (const k of ["label", "source", "href"])
      if (typeof node.props?.[k] === "string") out.push(node.props[k]);
    node.children?.forEach(walk);
  };
  walk(tree);
  return out;
}

/** Every element of a type, depth first. */
export function all(tree: unknown, type: string): Node[] {
  const out: Node[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as Node;
    if (node.type === type) out.push(node);
    node.children?.forEach(walk);
  };
  walk(tree);
  return out;
}

/** The serialised size of a tree's texts, as the engine counts its 100 000. */
export const textSize = (tree: unknown) => texts(tree).join("").length;
