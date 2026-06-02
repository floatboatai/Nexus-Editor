import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

/**
 * Walk a Lezer syntax tree, calling `visit` on every node whose `from`/`to`
 * intersect `[from, to]`. Mirrors `tree.iterate({ enter, from, to })` but
 * accepts a viewport pair directly so callers don't need to import lezer
 * types just to clamp coordinates.
 *
 * `visit` returns `false` to skip descent into children of the current node;
 * any other return value (including `void`/`undefined`) descends as normal.
 */
export function iterateInRange(
  tree: Tree,
  from: number,
  to: number,
  visit: (info: { name: string; from: number; to: number; node: SyntaxNode | null }) =>
    | undefined
    | boolean,
): void {
  tree.iterate({
    from,
    to,
    enter(ref) {
      const result = visit({ name: ref.name, from: ref.from, to: ref.to, node: ref.node });
      return result === false ? false : undefined;
    },
  });
}

/**
 * Read the slice of source between a node's `from`/`to` from the editor doc.
 * O(log n) via CM6's piece tree — safe to call per node.
 */
export function getNodeText(state: EditorState, node: { from: number; to: number }): string {
  return state.doc.sliceString(node.from, node.to);
}

/**
 * Find the first direct child of `node` whose name matches. Returns null when
 * absent. Used for things like pulling the `URL` child out of a `Link` node or
 * the `CodeInfo` child out of a `FencedCode`.
 */
export function findChildByName(node: SyntaxNode, name: string): SyntaxNode | null {
  let child = node.firstChild;
  while (child) {
    if (child.name === name) return child;
    child = child.nextSibling;
  }
  return null;
}

/** Iterate all direct children of `node` in document order. */
export function* directChildren(node: SyntaxNode): Generator<SyntaxNode> {
  let child = node.firstChild;
  while (child) {
    yield child;
    child = child.nextSibling;
  }
}

/**
 * Resolve the syntax tree for a state. Returns the tree and a flag indicating
 * whether parsing is fully complete up to the document end (Lezer parses
 * incrementally and may still be in progress for very large documents).
 */
export function getSyntaxTree(state: EditorState): { tree: Tree; complete: boolean } {
  const tree = syntaxTree(state);
  return { tree, complete: tree.length >= state.doc.length };
}

/** True for any of the ATX heading node names produced by @lezer/markdown. */
export function isAtxHeading(name: string): boolean {
  return (
    name === "ATXHeading1" ||
    name === "ATXHeading2" ||
    name === "ATXHeading3" ||
    name === "ATXHeading4" ||
    name === "ATXHeading5" ||
    name === "ATXHeading6"
  );
}

/** Extract the heading depth (1–6) from an ATXHeading or SetextHeading node name. */
export function headingDepth(name: string): 1 | 2 | 3 | 4 | 5 | 6 | null {
  if (name.startsWith("ATXHeading")) {
    const n = Number(name.slice("ATXHeading".length));
    return n >= 1 && n <= 6 ? (n as 1 | 2 | 3 | 4 | 5 | 6) : null;
  }
  if (name === "SetextHeading1") return 1;
  if (name === "SetextHeading2") return 2;
  return null;
}
