import type { SelectionRange } from "@codemirror/state";
import type { Content, Parent, Root } from "mdast";

import type { LivePreviewNode } from "./types";
import { scanWikiLinks } from "./wikilinks";

export interface LivePreviewRange {
  from: number;
  to: number;
  node: LivePreviewNode;
  source: string;
}

function isLivePreviewNode(node: Content): node is LivePreviewNode {
  return (
    node.type === "blockquote" ||
    node.type === "code" ||
    node.type === "definition" ||
    node.type === "delete" ||
    node.type === "footnoteDefinition" ||
    node.type === "footnoteReference" ||
    node.type === "list" ||
    node.type === "emphasis" ||
    node.type === "heading" ||
    node.type === "html" ||
    node.type === "image" ||
    node.type === "inlineCode" ||
    node.type === "link" ||
    node.type === "strong" ||
    node.type === "table" ||
    node.type === "thematicBreak"
  );
}

export function selectionIntersects(
  from: number,
  to: number,
  selection: readonly SelectionRange[],
  inclusiveEnd = false
): boolean {
  return selection.some((range) => {
    const rangeFrom = Math.min(range.anchor, range.head);
    const rangeTo = Math.max(range.anchor, range.head);

    if (range.empty) {
      return range.anchor >= from && (inclusiveEnd ? range.anchor <= to : range.anchor < to);
    }

    return rangeFrom < to && from < rangeTo;
  });
}

/** Check if the cursor is on the same line as the range [from, to]. */
export function selectionOnSameLine(
  from: number,
  to: number,
  doc: string,
  selection: readonly SelectionRange[]
): boolean {
  // Find line boundaries for the node
  const nodeLineStart = doc.lastIndexOf("\n", from - 1) + 1;
  const nodeLineEnd = doc.indexOf("\n", to);
  const lineEnd = nodeLineEnd === -1 ? doc.length : nodeLineEnd;

  return selection.some((range) => {
    const cursor = range.head;
    return cursor >= nodeLineStart && cursor <= lineEnd;
  });
}

function isInsideWikiLink(from: number, to: number, wikiLinkSpans: readonly [number, number][]): boolean {
  return wikiLinkSpans.some(([wikiFrom, wikiTo]) => from >= wikiFrom && to <= wikiTo);
}

function shouldSkipInsideWikiLink(node: Content, from: number, to: number, wikiLinkSpans: readonly [number, number][]): boolean {
  return (
    isInsideWikiLink(from, to, wikiLinkSpans) &&
    node.type !== "heading" &&
    node.type !== "table" &&
    node.type !== "list" &&
    node.type !== "code"
  );
}

function visit(
  node: Parent | Root,
  doc: string,
  selection: readonly SelectionRange[],
  ranges: LivePreviewRange[],
  wikiLinkSpans: readonly [number, number][]
): void {
  for (const child of node.children) {
    const from = child.position?.start.offset;
    const to = child.position?.end.offset;

    if (typeof from === "number" && typeof to === "number" && isLivePreviewNode(child)) {
      if (shouldSkipInsideWikiLink(child, from, to, wikiLinkSpans)) continue;

      // Reference-style images (![alt][label]) carry no inline URL — leave
      // them as raw text rather than emitting a widget with an empty src.
      if (child.type === "image" && !child.url) continue;

      if (child.type === "table") {
        ranges.push({ from, to, node: child, source: doc.slice(from, to) });
        continue;
      }

      if (child.type === "heading" || child.type === "list" || child.type === "code" || child.type === "definition" || child.type === "html") {
        // Always emitted regardless of cursor position.
        // buildDecorations decides decoration treatment based on cursor.
        ranges.push({ from, to, node: child, source: doc.slice(from, to) });

        if ("children" in child && Array.isArray(child.children)) {
          visit(child, doc, selection, ranges, wikiLinkSpans);
        }
        continue;
      }

      // Inline formatting: ALWAYS emit ranges (never skip based on cursor).
      // buildDecorations handles cursor-aware styling (transparent vs visible).
      // This ensures Decoration.replace is never used — only mark decorations
      // with color changes — so the heightmap stays perfectly stable.
      ranges.push({ from, to, node: child, source: doc.slice(from, to) });
      if ("children" in child && Array.isArray(child.children)) {
        visit(child as Parent, doc, selection, ranges, wikiLinkSpans);
      }
      continue;
    }

    if ("children" in child && Array.isArray(child.children)) {
      visit(child, doc, selection, ranges, wikiLinkSpans);
    }
  }
}

export function collectLivePreviewRanges(
  ast: Root,
  doc: string,
  selection: readonly SelectionRange[]
): LivePreviewRange[] {
  const ranges: LivePreviewRange[] = [];
  const wikiLinkSpans = scanWikiLinks(doc).map((link) => [link.from, link.to] as [number, number]);

  // Images are emitted by the AST walk like every other inline node. They must
  // NOT come from a document-wide regex scan: only the AST knows whether
  // `![alt](url)` sits in prose (render it) or inside a code span / fenced
  // block (literal text), and only the parser resolves CommonMark URL edge
  // cases such as balanced parentheses in the destination.
  visit(ast, doc, selection, ranges, wikiLinkSpans);

  return ranges.sort((left, right) => left.from - right.from);
}
