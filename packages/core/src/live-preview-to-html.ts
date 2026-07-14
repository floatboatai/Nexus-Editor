import type { Data, Root, RootContent } from "mdast";
import rehypeStringify from "rehype-stringify";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

// Built once, not per call — see the identical rationale on `createParser` in
// editor.ts: resolving a unified plugin chain is measurably expensive even
// for empty input, and this pipeline is transform+stringify only (no
// `remark-parse`), so there is nothing per-document to configure.
const processor = unified().use(remarkRehype).use(rehypeStringify);
processor.freeze();

/**
 * Tags every top-level block child of `ast` with a `data-offset` hint
 * (`node.data.hProperties`, the mechanism `mdast-util-to-hast` reads to
 * influence the emitted hast element) carrying the node's source character
 * offset. Shallow — only `ast.children` are tagged, not nested descendants,
 * since a scroll-sync anchor only needs block-boundary granularity.
 */
function withTopLevelOffsets(ast: Root): Root {
  return {
    ...ast,
    children: ast.children.map((child): RootContent => {
      const offset = child.position?.start.offset;
      if (offset === undefined) return child;

      const data: Data = {
        ...child.data,
        hProperties: {
          ...(child.data?.hProperties as Record<string, unknown> | undefined),
          "data-offset": String(offset),
        },
      };
      return { ...child, data };
    }),
  };
}

/**
 * Renders an mdast tree (typically `editor.getAst()`) to an HTML string,
 * annotating each top-level block element with `data-offset` for scroll-sync
 * consumers. Runs only the mdast→hast transform + stringify — the tree is
 * never re-parsed from markdown text, so this stays in sync with whatever
 * produced `ast` (the Lezer-backed live AST, by default).
 *
 * Known v1 limitation: wiki-link (`[[...]]`) syntax is not a real mdast node
 * (see wikilinks.ts — implemented via CM6 decoration, not a remark plugin),
 * so it renders as literal text here.
 */
export function renderPreviewHtml(ast: Root): string {
  const tagged = withTopLevelOffsets(ast);
  const hast = processor.runSync(tagged);
  return processor.stringify(hast) as string;
}
