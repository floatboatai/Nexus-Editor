import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { GFM, parser as commonmarkParser } from "@lezer/markdown";

import type {
  Blockquote,
  Code,
  Content,
  Definition,
  Delete,
  Emphasis,
  FootnoteDefinition,
  FootnoteReference,
  Heading,
  Html,
  Image,
  InlineCode,
  Link,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
  Strong,
  Table,
  TableCell,
  TableRow,
  Text,
  ThematicBreak,
} from "mdast";
import { footnoteExtension } from "./lezer-footnote-extension";

import { findChildByName, headingDepth } from "./lezer-helpers";

// Lezer markdown's Document tree → real mdast Root. Designed to be CHEAP
// (one synchronous walk, viewport-agnostic) so it can fully replace the
// remark/micromark worker round-trip on the live-preview hot path. Only the
// fields actually consumed by buildDecorations + renderers + table widget
// are emitted; everything else is null/empty.
//
// The output is structurally compatible with the mdast Root produced by
// `unified().use(remarkParse).use(remarkGfm)` for the subset of nodes the
// editor's live-preview cares about. Adapter-emitted nodes carry full
// `position` info so collectLivePreviewRanges can read offsets.

interface PositionedNode {
  position: {
    start: { line: number; column: number; offset: number };
    end: { line: number; column: number; offset: number };
  };
}

function position(from: number, to: number): PositionedNode["position"] {
  // Live-preview only ever reads `position.start.offset` / `position.end.offset`,
  // so line/column are placeholder zeros — keeps the adapter O(1) per node.
  return {
    start: { line: 0, column: 0, offset: from },
    end: { line: 0, column: 0, offset: to },
  };
}

// Source provider — abstracts over `EditorState.doc.sliceString` (the live
// editor case) and a plain string slice (the headless case used for initial
// AST and for `getAst()` outside of an active view). Lets the walk logic stay
// identical for both entry points.
interface Source {
  slice(from: number, to: number): string;
  length: number;
}

function stateSource(state: EditorState): Source {
  return {
    slice: (from, to) => state.doc.sliceString(from, to),
    length: state.doc.length,
  };
}

function stringSource(s: string): Source {
  return {
    slice: (from, to) => s.slice(from, to),
    length: s.length,
  };
}

function readSlice(source: Source, from: number, to: number): string {
  return source.slice(from, to);
}

/**
 * Strip the leading `#` markers (and a single trailing newline if any) from
 * an ATX heading source so the synthesized text node matches what remark
 * emits for `## title`.
 */
function headingTextRange(source: Source, node: SyntaxNode): { from: number; to: number } {
  // Skip past the opening HeaderMark child(ren) (the `##`).
  let cursor = node.from;
  let openingEnd = node.from;
  let child = node.firstChild;
  while (child && child.name === "HeaderMark") {
    cursor = child.to;
    openingEnd = child.to;
    child = child.nextSibling;
  }
  // Trim leading whitespace.
  while (cursor < node.to && /\s/.test(source.slice(cursor, cursor + 1))) cursor++;

  // Trim trailing closing `#` markers — but only if they are SEPARATE from
  // the opening run (i.e. start past `openingEnd`). Without this guard a
  // heading with a single HeaderMark child (the common case `# Title`) has
  // its `lastChild` equal to the opening mark and we'd collapse the text
  // range to nothing.
  let end = node.to;
  let trailing = node.lastChild;
  while (trailing && trailing.name === "HeaderMark" && trailing.from >= openingEnd) {
    end = trailing.from;
    trailing = trailing.prevSibling;
  }
  while (end > cursor && /\s/.test(source.slice(end - 1, end))) end--;
  return { from: cursor, to: end };
}

function emitText(source: Source, from: number, to: number): Text {
  if (to <= from) return { type: "text", value: "", position: position(from, from) };
  return {
    type: "text",
    value: readSlice(source, from, to),
    position: position(from, to),
  };
}

/** Build phrasing children from the inline syntax under `parent`. */
function emitInline(source: Source, parent: SyntaxNode): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  let cursor = parent.from;
  // Iterate direct inline children; everything between them becomes a Text node.
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.from > cursor) {
      out.push(emitText(source, cursor, child.from));
    }
    const phr = adaptInlineNode(source, child);
    if (phr) out.push(phr);
    cursor = child.to;
  }
  if (cursor < parent.to) {
    out.push(emitText(source, cursor, parent.to));
  }
  return out;
}

function isEscapedPipe(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashCount++;
  return slashCount % 2 === 1;
}

function trimTableCellRange(
  line: string,
  lineFrom: number,
  start: number,
  end: number,
): { from: number; to: number } {
  // biome-ignore lint/style/noParameterAssign: trim whitespace in-place
  while (start < end && /[ \t]/.test(line[start])) start++;
  // biome-ignore lint/style/noParameterAssign: trim whitespace in-place
  while (end > start && /[ \t]/.test(line[end - 1])) end--;
  return { from: lineFrom + start, to: lineFrom + end };
}

function tableCellContentRanges(
  source: Source,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const line = readSlice(source, from, to);
  const pipes: number[] = [];

  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && !isEscapedPipe(line, i)) pipes.push(i);
  }
  if (pipes.length === 0) return [];

  const hasLeadingPipe = line.slice(0, pipes[0]).trim() === "";
  const hasTrailingPipe = line.slice(pipes[pipes.length - 1] + 1).trim() === "";
  const delimiters = hasLeadingPipe ? pipes.slice(1) : pipes;
  const ranges: Array<{ from: number; to: number }> = [];
  let cellStart = hasLeadingPipe ? pipes[0] + 1 : 0;

  for (const pipe of delimiters) {
    ranges.push(trimTableCellRange(line, from, cellStart, pipe));
    cellStart = pipe + 1;
  }

  if (!hasTrailingPipe) {
    ranges.push(trimTableCellRange(line, from, cellStart, line.length));
  }

  return ranges;
}

function adaptTableRowCells(source: Source, row: SyntaxNode): TableCell[] {
  const syntaxCells: SyntaxNode[] = [];
  for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
    if (cell.name === "TableCell") syntaxCells.push(cell);
  }

  const ranges = tableCellContentRanges(source, row.from, row.to);
  if (ranges.length === 0) {
    return syntaxCells.map((cell) => ({
      type: "tableCell",
      children: emitInline(source, cell) as TableCell["children"],
      position: position(cell.from, cell.to),
    }));
  }

  const used = new Set<SyntaxNode>();
  return ranges.map((range) => {
    const syntaxCell = syntaxCells.find(
      (cell) => !used.has(cell) && cell.from >= range.from && cell.to <= range.to,
    );
    if (syntaxCell) {
      used.add(syntaxCell);
      return {
        type: "tableCell",
        children: emitInline(source, syntaxCell) as TableCell["children"],
        position: position(syntaxCell.from, syntaxCell.to),
      };
    }

    return {
      type: "tableCell",
      children: [],
      position: position(range.from, range.to),
    };
  });
}

// Lezer marker nodes carry the literal delimiter characters (`**`, backtick,
// `[`, `]`, …) and must be skipped — emitting them as text would surface raw
// markdown syntax inside the rendered preview.
// Lezer marker nodes carry the literal delimiter characters (`**`, backtick,
// `[`, `]`, …). These are only ever children of a containing inline node and
// must be skipped — emitting them as text would surface raw markdown syntax
// inside the rendered preview. (URL intentionally NOT in this set: it can
// appear as a standalone top-level node for GFM autolink literals.)
const MARKER_NODE_NAMES = new Set([
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "ListMark",
  "QuoteMark",
  "HeaderMark",
  "CodeInfo",
  "CodeText",
  "TaskMarker",
  "TableDelimiter",
]);

/** Inline-only adapter — delimiter marks and structural wrappers are skipped. */
function adaptInlineNode(source: Source, node: SyntaxNode): PhrasingContent | null {
  const name = node.name;
  if (MARKER_NODE_NAMES.has(name)) return null;
  switch (name) {
    case "StrongEmphasis": {
      const out: Strong = {
        type: "strong",
        children: emitInline(source, node) as Strong["children"],
        position: position(node.from, node.to),
      };
      return out;
    }
    case "Emphasis": {
      const out: Emphasis = {
        type: "emphasis",
        children: emitInline(source, node) as Emphasis["children"],
        position: position(node.from, node.to),
      };
      return out;
    }
    case "Strikethrough": {
      const out: Delete = {
        type: "delete",
        children: emitInline(source, node) as Delete["children"],
        position: position(node.from, node.to),
      };
      return out;
    }
    case "InlineCode": {
      // Lezer's InlineCode does NOT emit a CodeText child — the value is the
      // raw range between the opening and closing CodeMark tokens. Locate
      // them and slice; fall back to a CodeText child if a future Lezer
      // version starts emitting one.
      let value = "";
      const codeText = findChildByName(node, "CodeText");
      if (codeText) {
        value = readSlice(source, codeText.from, codeText.to);
      } else {
        // Find first and last CodeMark children to bracket the body.
        let firstMark: SyntaxNode | null = null;
        let lastMark: SyntaxNode | null = null;
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.name !== "CodeMark") continue;
          if (!firstMark) firstMark = c;
          lastMark = c;
        }
        if (firstMark && lastMark && lastMark.from >= firstMark.to) {
          value = readSlice(source, firstMark.to, lastMark.from);
        } else {
          // No marks at all: slice the whole node and strip surrounding `s.
          value = readSlice(source, node.from, node.to).replace(/^`+|`+$/g, "");
        }
      }
      const out: InlineCode = {
        type: "inlineCode",
        value,
        position: position(node.from, node.to),
      };
      return out;
    }
    case "Link":
    case "Autolink":
    case "URL": {
      // Lezer Link: contains LinkMark `[`, label content, LinkMark `]`,
      // optional `(URL "title")`. We pull URL via child name.
      const url = findChildByName(node, "URL");
      const urlText = url
        ? readSlice(source, url.from, url.to)
        : readSlice(source, node.from, node.to).replace(/^<|>$/g, "");
      // Walk children between the first `[` and the matching `]` and
      // recursively adapt nested inline nodes (Image, StrongEmphasis,
      // Emphasis, InlineCode, etc.) so things like
      // `[![logo](imgUrl)](pageUrl)` keep their nested Image, and
      // `[**bold link**](url)` keeps its Strong wrapper. The previous
      // implementation emitted the label as a single flat Text node,
      // which dropped every nested mdast node.
      const labelChildren: PhrasingContent[] = (() => {
        let labelStartMark: SyntaxNode | null = null;
        let labelEndMark: SyntaxNode | null = null;
        let seen = 0;
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.name !== "LinkMark") continue;
          seen++;
          if (seen === 1) labelStartMark = c;
          else if (seen === 2) {
            labelEndMark = c;
            break;
          }
        }
        if (!labelStartMark || !labelEndMark) {
          // Autolink / bare URL — no `[]`, the whole node is the label.
          return [emitText(source, node.from, node.to)];
        }
        const labelFrom = labelStartMark.to;
        const labelEnd = labelEndMark.from;
        const out: PhrasingContent[] = [];
        let cursor = labelFrom;
        for (let c = labelStartMark.nextSibling; c && c !== labelEndMark; c = c.nextSibling) {
          if (c.from >= labelEnd) break;
          if (c.from > cursor) out.push(emitText(source, cursor, c.from));
          const adapted = adaptInlineNode(source, c);
          if (adapted) out.push(adapted);
          cursor = c.to;
        }
        if (cursor < labelEnd) out.push(emitText(source, cursor, labelEnd));
        return out;
      })();
      const out: Link = {
        type: "link",
        url: urlText,
        title: null,
        children: labelChildren as Link["children"],
        position: position(node.from, node.to),
      };
      return out;
    }
    case "Image": {
      const url = findChildByName(node, "URL");
      const urlText = url ? readSlice(source, url.from, url.to) : "";
      // Image label sits between `![` and `]` — same structure as Link.
      let alt = "";
      const first = node.firstChild;
      if (first && first.name === "LinkMark") {
        const altFrom = first.to;
        let altTo = node.to;
        let seen = 0;
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.name === "LinkMark") {
            seen++;
            if (seen === 2) {
              altTo = c.from;
              break;
            }
          }
        }
        alt = readSlice(source, altFrom, altTo);
      }
      const out: Image = {
        type: "image",
        url: urlText,
        alt,
        title: null,
        position: position(node.from, node.to),
      };
      return out;
    }
    case "FootnoteReference": {
      const label = findChildByName(node, "FootnoteLabel");
      const identifier = label ? readSlice(source, label.from, label.to) : "";
      const out: FootnoteReference = {
        type: "footnoteReference",
        identifier,
        label: identifier,
        position: position(node.from, node.to),
      };
      return out;
    }
    case "HardBreak":
    case "Linebreak":
      return null;
    default:
      // Unknown inline construct (HTMLTag, Entity, Escape) → flatten as text.
      return emitText(source, node.from, node.to);
  }
}

function adaptListItem(source: Source, node: SyntaxNode): ListItem {
  const children: Content[] = [];
  let checked: boolean | null | undefined = undefined;
  // GFM TaskList extension wraps the `[x]`/`[ ]` marker in a `Task` node
  // (with a TaskMarker child). Some dialects emit TaskMarker directly under
  // ListItem; handle both shapes.
  const detectTaskChecked = (markerSource: string): boolean | null => {
    if (/\[[xX]\]/.test(markerSource)) return true;
    if (/\[\s\]/.test(markerSource)) return false;
    return null;
  };
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "ListMark") continue;
    if (c.name === "Task") {
      const marker = findChildByName(c, "TaskMarker");
      const m = marker ?? c;
      checked = detectTaskChecked(readSlice(source, m.from, m.to));
      // Task wraps Paragraph content too — descend so inner blocks are kept.
      for (let inner = c.firstChild; inner; inner = inner.nextSibling) {
        if (inner.name === "TaskMarker") continue;
        const block = adaptBlockChild(source, inner);
        if (block) children.push(block);
      }
      continue;
    }
    if (c.name === "TaskMarker") {
      checked = detectTaskChecked(readSlice(source, c.from, c.to));
      continue;
    }
    const block = adaptBlockChild(source, c);
    if (block) children.push(block);
  }
  return {
    type: "listItem",
    spread: false,
    checked,
    children: children as ListItem["children"],
    position: position(node.from, node.to),
  };
}

function adaptList(source: Source, node: SyntaxNode, ordered: boolean): List {
  const items: ListItem[] = [];
  let start: number | null = null;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "ListItem") {
      items.push(adaptListItem(source, c));
      if (ordered && start === null) {
        // Pull start from the first list item's marker e.g. "3."
        const marker = findChildByName(c, "ListMark");
        if (marker) {
          const m = /^(\d+)/.exec(readSlice(source, marker.from, marker.to));
          if (m) start = Number(m[1]);
        }
      }
    }
  }
  return {
    type: "list",
    ordered,
    start: ordered ? (start ?? 1) : null,
    spread: false,
    children: items,
    position: position(node.from, node.to),
  };
}

function adaptTable(source: Source, node: SyntaxNode): Table {
  const rows: TableRow[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "TableHeader" || c.name === "TableRow") {
      const cells = adaptTableRowCells(source, c);
      rows.push({
        type: "tableRow",
        children: cells,
        position: position(c.from, c.to),
      });
    }
  }
  return {
    type: "table",
    align: [],
    children: rows,
    position: position(node.from, node.to),
  };
}

function adaptCode(source: Source, node: SyntaxNode, fenced: boolean): Code {
  let lang: string | null = null;
  let value = "";
  if (fenced) {
    const info = findChildByName(node, "CodeInfo");
    if (info) lang = readSlice(source, info.from, info.to).trim() || null;
    const text = findChildByName(node, "CodeText");
    if (text) value = readSlice(source, text.from, text.to);
  } else {
    // IndentedCode: strip 4-space prefix on each line.
    const raw = readSlice(source, node.from, node.to);
    value = raw.replace(/^(\t| {1,4})/gm, "");
  }
  return {
    type: "code",
    lang,
    meta: null,
    value,
    position: position(node.from, node.to),
  };
}

function adaptHeading(source: Source, node: SyntaxNode): Heading {
  const depth = headingDepth(node.name);
  const text = headingTextRange(source, node);
  // Build inline children inside the text range. Re-iterate Lezer's children
  // that fall within this span.
  const children: PhrasingContent[] = [];
  let cursor = text.from;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "HeaderMark") continue;
    if (c.from < text.from || c.to > text.to) continue;
    if (c.from > cursor) children.push(emitText(source, cursor, c.from));
    const phr = adaptInlineNode(source, c);
    if (phr) children.push(phr);
    cursor = c.to;
  }
  if (cursor < text.to) children.push(emitText(source, cursor, text.to));
  return {
    type: "heading",
    depth: depth ?? 1,
    children: children as Heading["children"],
    position: position(node.from, node.to),
  };
}

// Docusaurus / VitePress / Obsidian style fenced callouts. Single-paragraph
// shape (the only one lezer keeps in one node — body without blank lines):
//   :::type [optional title]
//   body line(s) without blank lines
//   :::
const CALLOUT_FENCE_RE = /^:::([a-zA-Z]+)(?:[ \t]+(.+?))?\r?\n([\s\S]*?)\r?\n:::\s*$/;

interface CalloutPalette {
  border: string;
  bg: string;
  color: string;
  icon: string;
  defaultLabel: string;
}

const CALLOUT_PALETTE: Record<string, CalloutPalette> = {
  info: {
    border: "#0969da",
    bg: "rgba(9,105,218,0.08)",
    color: "#0969da",
    icon: "ℹ",
    defaultLabel: "INFO",
  },
  note: {
    border: "#0969da",
    bg: "rgba(9,105,218,0.08)",
    color: "#0969da",
    icon: "ℹ",
    defaultLabel: "NOTE",
  },
  tip: {
    border: "#1a7f37",
    bg: "rgba(26,127,55,0.08)",
    color: "#1a7f37",
    icon: "💡",
    defaultLabel: "TIP",
  },
  success: {
    border: "#1a7f37",
    bg: "rgba(26,127,55,0.08)",
    color: "#1a7f37",
    icon: "✓",
    defaultLabel: "SUCCESS",
  },
  important: {
    border: "#8250df",
    bg: "rgba(130,80,223,0.08)",
    color: "#8250df",
    icon: "❗",
    defaultLabel: "IMPORTANT",
  },
  warning: {
    border: "#9a6700",
    bg: "rgba(154,103,0,0.08)",
    color: "#9a6700",
    icon: "⚠",
    defaultLabel: "WARNING",
  },
  caution: {
    border: "#cf222e",
    bg: "rgba(207,34,46,0.08)",
    color: "#cf222e",
    icon: "🚫",
    defaultLabel: "CAUTION",
  },
  danger: {
    border: "#cf222e",
    bg: "rgba(207,34,46,0.08)",
    color: "#cf222e",
    icon: "🚫",
    defaultLabel: "DANGER",
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCalloutHtml(type: string, title: string | null, body: string): string {
  const palette = CALLOUT_PALETTE[type.toLowerCase()] ?? CALLOUT_PALETTE.info;
  const heading = title ?? palette.defaultLabel;
  return `<div class="nexus-callout" data-callout-type="${escapeHtml(type)}" style="border-left:4px solid ${palette.border};background:${palette.bg};padding:8px 14px;border-radius:6px;margin:6px 0;"><div class="nexus-callout-title" style="color:${palette.color};font-weight:600;display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span aria-hidden="true">${palette.icon}</span><span>${escapeHtml(heading)}</span></div><div class="nexus-callout-body" style="color:var(--nexus-text);white-space:pre-wrap;">${escapeHtml(body)}</div></div>`;
}

function adaptParagraph(source: Source, node: SyntaxNode): Paragraph | Html {
  const src = readSlice(source, node.from, node.to);

  // Docusaurus / VitePress / Obsidian callout: `:::type [title]\n...\n:::`.
  // Body is rendered verbatim (no inner Markdown pass yet) — acceptable
  // because typical callout bodies are short, single-paragraph notes.
  const calloutMatch = CALLOUT_FENCE_RE.exec(src);
  if (calloutMatch) {
    const [, type, title, body] = calloutMatch;
    return {
      type: "html",
      value: buildCalloutHtml(type, title ?? null, body),
      position: position(node.from, node.to),
    };
  }

  // If the paragraph contains any inline HTML tags (`<kbd>`, `<mark>`, `<sub>`,
  // `<br />`, multi-line `<svg>` opening into the same paragraph, etc.),
  // promote the whole paragraph to an Html node. Live-preview renders Html
  // via innerHTML so the browser parses every tag at once — which is the only
  // way to make matched open/close pairs (`<kbd>X</kbd>`) render correctly.
  //
  // Trade-off: inline Markdown marks inside the same paragraph (e.g. `**bold**`)
  // stop being decoration-styled and render as literal asterisks. In practice
  // authors don't mix inline HTML with inline Markdown in the same paragraph;
  // splitting them with a blank line restores Markdown styling.
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "HTMLTag") {
      return adaptHtml(source, node);
    }
  }
  return {
    type: "paragraph",
    children: emitInline(source, node) as Paragraph["children"],
    position: position(node.from, node.to),
  };
}

function adaptBlockquote(source: Source, node: SyntaxNode): Blockquote {
  const children: Content[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "QuoteMark") continue;
    const block = adaptBlockChild(source, c);
    if (block) children.push(block);
  }
  return {
    type: "blockquote",
    children: children as Blockquote["children"],
    position: position(node.from, node.to),
  };
}

function adaptLinkReference(source: Source, node: SyntaxNode): Definition {
  // Definition source: `[label]: url "title"`
  const src = readSlice(source, node.from, node.to);
  const m = /^\[([^\]]+)\]:\s*(\S+)(?:\s+"([^"]*)")?/.exec(src);
  return {
    type: "definition",
    identifier: m ? m[1] : "",
    label: m ? m[1] : undefined,
    url: m ? m[2] : "",
    title: m ? (m[3] ?? null) : null,
    position: position(node.from, node.to),
  };
}

function adaptFootnoteDefinition(source: Source, node: SyntaxNode): FootnoteDefinition {
  const src = readSlice(source, node.from, node.to);
  const m = /^\[\^([^\]]+)\]:/.exec(src);
  return {
    type: "footnoteDefinition",
    identifier: m ? m[1] : "",
    label: m ? m[1] : undefined,
    children: [],
    position: position(node.from, node.to),
  };
}

function adaptThematicBreak(node: SyntaxNode): ThematicBreak {
  return {
    type: "thematicBreak",
    position: position(node.from, node.to),
  };
}

function adaptHtml(source: Source, node: SyntaxNode): Html {
  // Live-preview renders the raw HTML span via innerHTML when the cursor is
  // outside the block, and falls back to source when the cursor is inside.
  // We just need to carry the original source slice and a stable position.
  return {
    type: "html",
    value: readSlice(source, node.from, node.to),
    position: position(node.from, node.to),
  };
}

function adaptBlockChild(source: Source, node: SyntaxNode): Content | null {
  const name = node.name;
  if (name.startsWith("ATXHeading") || name.startsWith("SetextHeading")) {
    return adaptHeading(source, node);
  }
  switch (name) {
    case "Paragraph":
      return adaptParagraph(source, node);
    case "Blockquote":
      return adaptBlockquote(source, node);
    case "BulletList":
      return adaptList(source, node, false);
    case "OrderedList":
      return adaptList(source, node, true);
    case "FencedCode":
      return adaptCode(source, node, true);
    // @lezer/markdown emits "CodeBlock" for indented code blocks; keep
    // "IndentedCode" as a defensive alias for any non-default config.
    case "CodeBlock":
    case "IndentedCode":
      return adaptCode(source, node, false);
    case "HorizontalRule":
      return adaptThematicBreak(node);
    case "Table":
      return adaptTable(source, node);
    case "LinkReference":
      return adaptLinkReference(source, node);
    case "FootnoteDefinition":
      return adaptFootnoteDefinition(source, node);
    case "HTMLBlock":
    case "CommentBlock":
      return adaptHtml(source, node);
    default:
      return null;
  }
}

/**
 * Walk the editor's Lezer syntax tree and synthesize an mdast Root with the
 * subset of fields consumed by the live-preview pipeline. Synchronous; safe
 * to call inside StateField.update / view updateListener (Lezer parse is
 * incremental and the tree is intrinsic to EditorState).
 */
function walkRoot(tree: Tree, source: Source): Root {
  const children: RootContent[] = [];
  const cursor = tree.cursor();
  if (!cursor.firstChild()) {
    return { type: "root", children: [], position: position(0, source.length) };
  }
  do {
    const node = cursor.node;
    const block = adaptBlockChild(source, node);
    if (block) children.push(block as RootContent);
  } while (cursor.nextSibling());
  return {
    type: "root",
    children,
    position: position(0, source.length),
  };
}

export function lezerTreeToMdast(state: EditorState, tree: Tree = syntaxTree(state)): Root {
  return walkRoot(tree, stateSource(state));
}

// Headless string parser — used by editor.ts for the initial currentAst
// (before a CM6 view exists) and for any get-ast call that doesn't have a
// live state. Configures the same GFM + footnote extensions as the live
// language support so the produced AST shape matches.
let configuredParser: ReturnType<typeof commonmarkParser.configure> | null = null;
function getStringParser() {
  if (!configuredParser) {
    configuredParser = commonmarkParser.configure([...GFM, footnoteExtension]);
  }
  return configuredParser;
}

export function lezerStringToMdast(markdown: string): Root {
  const tree = getStringParser().parse(markdown);
  return walkRoot(tree, stringSource(markdown));
}
