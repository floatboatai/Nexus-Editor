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
    node.type === "emphasis" ||
    node.type === "heading" ||
    node.type === "inlineCode" ||
    node.type === "link" ||
    node.type === "strong"
  );
}

function selectionIntersects(
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
      if (!selectionIntersects(from, to, selection)) {
        ranges.push({
          from,
          to,
          node: child,
          source: doc.slice(from, to)
        });
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
