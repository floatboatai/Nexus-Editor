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

// 作者：tobegold574（2026/9/17）
// 原因：selection 参数在本函数内从未被读取，随"输出与光标无关"的解耦一并移除。
function collectImageRanges(
  doc: string
): LivePreviewRange[] {
  const ranges: LivePreviewRange[] = [];
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

  for (const match of doc.matchAll(pattern)) {
    const from = match.index ?? 0;
    const source = match[0];
    const to = from + source.length;

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

// 作者：tobegold574（2026/9/17）
// 原因：同理移除从未被读取的 selection 参数，递归调用点随之同步收敛。
function visit(
  node: Parent | Root,
  doc: string,
  ranges: LivePreviewRange[],
  wikiLinkSpans: readonly [number, number][]
): void {
  for (const child of node.children) {
    const from = child.position?.start.offset;
    const to = child.position?.end.offset;

    if (typeof from === "number" && typeof to === "number" && isLivePreviewNode(child)) {
      if (shouldSkipInsideWikiLink(child, from, to, wikiLinkSpans)) continue;

      if (child.type === "table") {
        ranges.push({ from, to, node: child, source: doc.slice(from, to) });
        continue;
      }

      if (child.type === "heading" || child.type === "list" || child.type === "code" || child.type === "definition" || child.type === "html") {
        // Always emitted regardless of cursor position.
        // buildDecorations decides decoration treatment based on cursor.
        ranges.push({ from, to, node: child, source: doc.slice(from, to) });

        if ("children" in child && Array.isArray(child.children)) {
          visit(child, doc, ranges, wikiLinkSpans);
        }
        continue;
      }

      // Inline formatting: ALWAYS emit ranges (never skip based on cursor).
      // buildDecorations handles cursor-aware styling (transparent vs visible).
      // This ensures Decoration.replace is never used — only mark decorations
      // with color changes — so the heightmap stays perfectly stable.
      ranges.push({ from, to, node: child, source: doc.slice(from, to) });
      if ("children" in child && Array.isArray(child.children)) {
        visit(child as Parent, doc, ranges, wikiLinkSpans);
      }
      continue;
    }

    if ("children" in child && Array.isArray(child.children)) {
      visit(child, doc, ranges, wikiLinkSpans);
    }
  }
}

/**
 * 收集文档中所有 live-preview 候选区间。
 *
 * 作者：tobegold574（2026/9/17）
 * 原因：返回值只由 (ast, doc) 决定——历史上的 selection 参数本就不会被函数体
 * 读取（光标感知的显示/编辑切换在 buildDecorations 里做），这里改为可选参数
 * 仅为兼容旧调用方。输出与 selection 无关，是 StateField 能在纯光标移动时
 * 缓存复用该结果的前提。
 */
export function collectLivePreviewRanges(
  ast: Root,
  doc: string,
  _selection?: readonly SelectionRange[]
): LivePreviewRange[] {
  const ranges: LivePreviewRange[] = [];
  const wikiLinkSpans = scanWikiLinks(doc).map((link) => [link.from, link.to] as [number, number]);

  visit(ast, doc, ranges, wikiLinkSpans);
  ranges.push(...collectImageRanges(doc));

  return ranges.sort((left, right) => left.from - right.from);
}
