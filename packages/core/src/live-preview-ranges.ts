import type { SelectionRange } from "@codemirror/state";
import type { Content, Parent, Root } from "mdast";

import type { LivePreviewNode } from "./types";

export interface LivePreviewRange {
  from: number;
  to: number;
  node: LivePreviewNode;
  source: string;
}

function isLivePreviewNode(node: Content): node is LivePreviewNode {
  return (
    node.type === "blockquote" ||
    node.type === "delete" ||
    node.type === "emphasis" ||
    node.type === "heading" ||
    node.type === "inlineCode" ||
    node.type === "link" ||
    node.type === "strong" ||
    node.type === "thematicBreak"
  );
}

export function selectionIntersects(
  from: number,
  to: number,
  selection: readonly SelectionRange[]
): boolean {
  return selection.some((range) => {
    const rangeFrom = Math.min(range.anchor, range.head);
    const rangeTo = Math.max(range.anchor, range.head);

    if (range.empty) {
      return range.anchor >= from && range.anchor < to;
    }

    return rangeFrom < to && from < rangeTo;
  });
}

function collectImageRanges(
  doc: string,
  selection: readonly SelectionRange[]
): LivePreviewRange[] {
  const ranges: LivePreviewRange[] = [];
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

  for (const match of doc.matchAll(pattern)) {
    const from = match.index ?? 0;
    const source = match[0];
    const to = from + source.length;

    if (selectionIntersects(from, to, selection)) {
      continue;
    }

    ranges.push({
      from,
      to,
      source,
      node: {
        type: "image",
        alt: match[1] || null,
        url: match[2],
        title: match[3] || null
      }
    });
  }

  return ranges;
}

function visit(
  node: Parent | Root,
  doc: string,
  selection: readonly SelectionRange[],
  ranges: LivePreviewRange[]
): void {
  for (const child of node.children) {
    const from = child.position?.start.offset;
    const to = child.position?.end.offset;

    if (typeof from === "number" && typeof to === "number" && isLivePreviewNode(child)) {
      if (child.type === "heading") {
        // Headings are always emitted regardless of cursor position.
        // buildDecorations decides prefix treatment (hide vs dim) based on cursor.
        ranges.push({ from, to, node: child, source: doc.slice(from, to) });

        // Always recurse into heading children so inline elements
        // (bold, italic, etc.) get their own decorations.
        if ("children" in child && Array.isArray(child.children)) {
          visit(child, doc, selection, ranges);
        }
        continue;
      }

      if (!selectionIntersects(from, to, selection)) {
        ranges.push({ from, to, node: child, source: doc.slice(from, to) });
        continue;
      }
    }

    if ("children" in child && Array.isArray(child.children)) {
      visit(child, doc, selection, ranges);
    }
  }
}

export function collectLivePreviewRanges(
  ast: Root,
  doc: string,
  selection: readonly SelectionRange[]
): LivePreviewRange[] {
  const ranges: LivePreviewRange[] = [];

  visit(ast, doc, selection, ranges);
  ranges.push(...collectImageRanges(doc, selection));

  return ranges.sort((left, right) => left.from - right.from);
}
