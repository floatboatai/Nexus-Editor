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

interface ParsedImageReference {
  readonly alt: string | null;
  readonly url: string;
  readonly title: string | null;
}

function parseImageDestination(raw: string): ParsedImageReference | null {
  const value = raw.trim();
  if (!value) return null;

  if (value.startsWith("<")) {
    const close = value.indexOf(">");
    if (close <= 1) return null;
    const url = value.slice(1, close);
    const rest = value.slice(close + 1).trim();
    const title = rest.match(/^"([^"]*)"$/)?.[1] ?? null;
    return { alt: null, url, title };
  }

  const titled = value.match(/^(.*?)\s+"([^"]*)"$/);
  return titled
    ? { alt: null, url: titled[1].trim(), title: titled[2] }
    : { alt: null, url: value, title: null };
}

function collectImageRanges(doc: string): LivePreviewRange[] {
  const ranges: LivePreviewRange[] = [];
  const markdownPattern = /!\[([^\]]*)\]\(([^)\n]+)\)/g;

  for (const match of doc.matchAll(markdownPattern)) {
    const from = match.index ?? 0;
    const source = match[0];
    const to = from + source.length;
    const destination = parseImageDestination(match[2]);
    if (!destination?.url) continue;

    ranges.push({
      from,
      to,
      source,
      node: {
        type: "image",
        alt: match[1] || null,
        url: destination.url,
        title: destination.title,
      }
    });
  }

  // Obsidian image embeds are intentionally represented as image ranges rather
  // than rewritten into the document. A numeric pipe suffix reuses the host's
  // existing `alt|width` image-size parser.
  const embedPattern = /!\[\[([^\[\]\n]+)\]\]/g;
  for (const match of doc.matchAll(embedPattern)) {
    const from = match.index ?? 0;
    if (from > 0 && doc[from - 1] === "\\") continue;
    const source = match[0];
    const to = from + source.length;
    const rawTarget = match[1].trim();
    const pipe = rawTarget.lastIndexOf("|");
    const suffix = pipe >= 0 ? rawTarget.slice(pipe + 1).trim() : "";
    const hasSize = /^\d+(?:x\d+)?$/.test(suffix);
    const url = (hasSize ? rawTarget.slice(0, pipe) : rawTarget).trim();
    if (!url) continue;

    ranges.push({
      from,
      to,
      source,
      node: {
        type: "image",
        alt: hasSize ? `|${suffix}` : null,
        url,
        title: null,
      },
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

  visit(ast, doc, selection, ranges, wikiLinkSpans);
  ranges.push(...collectImageRanges(doc));

  return ranges.sort((left, right) => left.from - right.from);
}
