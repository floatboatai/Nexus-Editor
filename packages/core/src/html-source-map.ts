/**
 * Rehype-stage source mapping for `exportHTML({ sourceMap: true })`.
 *
 * Stamps block elements in the generated HTML with the absolute character
 * range of the markdown source they were rendered from:
 *
 *   `## Two`  →  `<h2 data-nexus-from="8" data-nexus-to="14">Two</h2>`
 *
 * Granularity: top-level blocks, descending into container blocks (lists,
 * blockquotes) to stamp their block children instead of the container
 * itself. Without the descent, an outline-style document — one root list
 * holding everything — would collapse to a single anchor and scroll-sync
 * would degrade to one linear segment across the whole file. Anchors stay
 * non-overlapping and in source order because a container is stamped only
 * when none of its children were.
 *
 * Offsets are hast `position` offsets, which remark-rehype carries over
 * from mdast, so they index into the exact markdown string the editor
 * holds. Synthesized elements without positions (e.g. GFM footnote
 * sections) are skipped.
 */

/** Attribute carrying the block's start offset in the markdown source. */
export const SOURCE_MAP_FROM_ATTR = "data-nexus-from";
/** Attribute carrying the block's end offset (exclusive) in the markdown source. */
export const SOURCE_MAP_TO_ATTR = "data-nexus-to";

/**
 * Minimal structural view of the hast nodes this plugin touches. Typed
 * locally so `@floatboat/nexus-core` does not need a dependency on
 * `@types/hast` for a handful of optional fields — the real hast
 * Root/Element are assignable to these shapes.
 */
interface HastNodeLike {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNodeLike[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

/** Containers whose block children make better anchors than the container. */
const CONTAINER_TAGS = new Set(["ul", "ol", "blockquote", "li"]);

/**
 * Tags allowed to receive a stamp when nested inside a container. Root
 * children are stamped regardless (they are blocks by construction), but
 * inside a tight list item the children are inline elements — stamping
 * those would produce line-level noise anchors.
 */
const NESTED_BLOCK_TAGS = new Set([
  "p", "pre", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "hr", "div", "section", "figure",
  "ul", "ol", "blockquote", "li"
]);

function sourceRange(node: HastNodeLike): { from: number; to: number } | null {
  const from = node.position?.start?.offset;
  const to = node.position?.end?.offset;
  if (typeof from !== "number" || typeof to !== "number") return null;
  return { from, to };
}

/**
 * Stamp the block children of `parent`. Returns true when at least one
 * descendant was stamped — the caller uses that to decide whether the
 * container itself still needs to serve as the anchor.
 */
function stampBlocks(parent: HastNodeLike, topLevel: boolean): boolean {
  let stampedAny = false;

  for (const child of parent.children ?? []) {
    if (child.type !== "element" || !child.tagName) continue;

    const range = sourceRange(child);
    if (!range) continue;

    if (!topLevel && !NESTED_BLOCK_TAGS.has(child.tagName)) continue;

    if (CONTAINER_TAGS.has(child.tagName) && stampBlocks(child, false)) {
      stampedAny = true;
      continue;
    }

    // hast property names are camelCased; hast-util-to-html serializes
    // `dataNexusFrom` back to the `data-nexus-from` attribute.
    child.properties = {
      ...child.properties,
      dataNexusFrom: range.from,
      dataNexusTo: range.to
    };
    stampedAny = true;
  }

  return stampedAny;
}

/**
 * Unified plugin. Attach between `remark-rehype` and `rehype-stringify`:
 * `processor.use(remarkRehype).use(rehypeSourceMap).use(rehypeStringify)`.
 */
export function rehypeSourceMap(): (tree: HastNodeLike) => void {
  return (tree) => {
    stampBlocks(tree, true);
  };
}
