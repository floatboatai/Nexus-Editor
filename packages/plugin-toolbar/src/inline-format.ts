import type { EditorAPI } from "@floatboat/nexus-core";
import type { InlineCode, Nodes, Parents, Root } from "mdast";

export type InlineKind = "strong" | "emphasis" | "delete" | "inlineCode";

const MARKER: Record<InlineKind, string> = {
  strong: "**",
  emphasis: "*",
  delete: "~~",
  inlineCode: "`",
};

export const KIND_BY_MARKER: Record<string, InlineKind | undefined> = {
  "**": "strong",
  "__": "strong",
  "*": "emphasis",
  "_": "emphasis",
  "~~": "delete",
  "`": "inlineCode",
};

interface Located {
  node: Nodes;
  start: number;
  end: number;
}

type Range = readonly [number, number];

function childrenOf(node: Nodes): readonly Nodes[] {
  return (node as Parents).children ?? [];
}

function locate(node: Nodes): Located | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return start === undefined || end === undefined ? null : { node, start, end };
}

/** Smallest node of `kind` whose source range fully contains [from, to]. */
function findEnclosing(root: Root, kind: InlineKind, from: number, to: number): Located | null {
  const walk = (node: Nodes): Located[] => {
    const self = node.type === kind ? locate(node) : null;
    const nested = childrenOf(node).flatMap(walk);
    return self ? [self, ...nested] : nested;
  };

  return walk(root).reduce<Located | null>((best, candidate) => {
    if (candidate.start > from || candidate.end < to) return best;
    if (!best) return candidate;
    return candidate.end - candidate.start < best.end - best.start ? candidate : best;
  }, null);
}

/**
 * Source span of the node's own text, ignoring any nested markers. Toggling is
 * "off" only when the selection covers all of it — that is what keeps
 * `***text***` from collapsing into a single marker pair.
 */
function textSpan(node: Nodes): Range | null {
  const spans = (function walk(current: Nodes): Range[] {
    if (current.type === "text" || current.type === "inlineCode") {
      const located = locate(current);
      return located ? [[located.start, located.end] as Range] : [];
    }
    return childrenOf(current).flatMap(walk);
  })(node);

  if (spans.length === 0) return null;
  return [
    spans.reduce((lo, [start]) => Math.min(lo, start), Number.POSITIVE_INFINITY),
    spans.reduce((hi, [, end]) => Math.max(hi, end), Number.NEGATIVE_INFINITY),
  ];
}

function fenceLength(doc: string, start: number): number {
  let length = 0;
  while (doc[start + length] === "`") length += 1;
  return length;
}

function markerLength(doc: string, target: Located, kind: InlineKind): number {
  return kind === "inlineCode" ? fenceLength(doc, target.start) : MARKER[kind].length;
}

function innerSpan(doc: string, target: Located, kind: InlineKind): Range {
  const length = markerLength(doc, target, kind);
  return [target.start + length, target.end - length];
}

interface Wrapped {
  text: string;
  contentOffset: number;
}

function longestBacktickRun(text: string): number {
  return (text.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0);
}

/**
 * A code span needs a fence longer than any backtick run it contains, and one
 * space of padding on both sides when the content would otherwise merge with
 * the fence. CommonMark strips exactly one space from each end when both are
 * present, so the padding round-trips.
 */
function wrapCode(content: string): Wrapped {
  const fence = "`".repeat(longestBacktickRun(content) + 1);
  const needsPadding =
    content.startsWith("`") ||
    content.endsWith("`") ||
    (content.startsWith(" ") && content.endsWith(" "));
  const padding = needsPadding ? " " : "";

  return {
    text: fence + padding + content + padding + fence,
    contentOffset: fence.length + padding.length,
  };
}

function wrapContent(kind: InlineKind, content: string): Wrapped {
  if (kind === "inlineCode") return wrapCode(content);
  const marker = MARKER[kind];
  return { text: marker + content + marker, contentOffset: marker.length };
}

/** Wraps the segment's non-blank core, leaving its surrounding whitespace outside the markers. */
function wrapSegment(kind: InlineKind, segment: string): string {
  const leading = segment.length - segment.trimStart().length;
  const trailing = segment.length - segment.trimEnd().length;
  const core = segment.slice(leading, segment.length - trailing);
  if (core === "") return segment;

  return segment.slice(0, leading) + wrapContent(kind, core).text + segment.slice(segment.length - trailing);
}

/** Shrinks the range past whitespace at either end; markers never wrap a blank edge. */
function trimRange(doc: string, from: number, to: number): Range | null {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(doc[start])) start += 1;
  while (end > start && /\s/.test(doc[end - 1])) end -= 1;
  return start < end ? [start, end] : null;
}

function unwrap(editor: EditorAPI, doc: string, target: Located, kind: InlineKind): boolean {
  const [innerStart, innerEnd] = innerSpan(doc, target, kind);
  const content = kind === "inlineCode"
    ? (target.node as InlineCode).value
    : doc.slice(innerStart, innerEnd);

  editor.replaceRange(target.start, target.end, content, {
    anchor: target.start,
    head: target.start + content.length,
  });
  return true;
}

/** Lifts [from, to) out of the node and re-wraps whatever is left on either side. */
function splitOut(
  editor: EditorAPI,
  doc: string,
  target: Located,
  kind: InlineKind,
  from: number,
  to: number,
): boolean {
  const [innerStart, innerEnd] = innerSpan(doc, target, kind);
  const start = Math.max(from, innerStart);
  const end = Math.min(to, innerEnd);

  const head = wrapSegment(kind, doc.slice(innerStart, start));
  const lifted = doc.slice(start, end);
  const tail = wrapSegment(kind, doc.slice(end, innerEnd));
  const anchor = target.start + head.length;

  editor.replaceRange(target.start, target.end, head + lifted + tail, {
    anchor,
    head: anchor + lifted.length,
  });
  return true;
}

export function toggleInline(editor: EditorAPI, kind: InlineKind): boolean {
  const { anchor, head } = editor.getSelection();
  const doc = editor.getDocument();
  const trimmed = trimRange(doc, Math.min(anchor, head), Math.max(anchor, head));
  if (!trimmed) return false;

  const [from, to] = trimmed;
  const target = findEnclosing(editor.getAst(), kind, from, to);

  if (target) {
    const span = textSpan(target.node) ?? innerSpan(doc, target, kind);
    return from <= span[0] && to >= span[1]
      ? unwrap(editor, doc, target, kind)
      : splitOut(editor, doc, target, kind, from, to);
  }

  const wrapped = wrapContent(kind, doc.slice(from, to));
  editor.replaceRange(from, to, wrapped.text, {
    anchor: from + wrapped.contentOffset,
    head: from + wrapped.contentOffset + (to - from),
  });
  return true;
}
