import type { EditorAPI, SlashCommandDef } from "@floatboat/nexus-core";

import {
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  toggleBlockquote,
  toggleOrderedList,
  toggleUnorderedList,
} from "./formatting";

export function toggleWrap(editor: EditorAPI, marker: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);
  const before = doc.slice(Math.max(0, from - marker.length), from);
  const after = doc.slice(to, to + marker.length);

  if (before === marker && after === marker) {
    editor.setDocument(
      doc.slice(0, from - marker.length) + selected + doc.slice(to + marker.length),
    );
    editor.setSelection(from - marker.length, to - marker.length);
    return true;
  }

  editor.setDocument(doc.slice(0, from) + marker + selected + marker + doc.slice(to));
  editor.setSelection(from + marker.length, to + marker.length);
  return true;
}

export function toggleBold(editor: EditorAPI): boolean {
  return toggleWrap(editor, "**");
}

export function toggleItalic(editor: EditorAPI): boolean {
  return toggleWrap(editor, "*");
}

export function toggleStrikethrough(editor: EditorAPI): boolean {
  return toggleWrap(editor, "~~");
}

interface EnclosingCodeSpan {
  from: number;
  to: number;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}

function countBackticksBefore(doc: string, position: number): number {
  let cursor = position;
  while (cursor > 0 && doc[cursor - 1] === "`") cursor -= 1;
  return position - cursor;
}

function countBackticksAfter(doc: string, position: number): number {
  let cursor = position;
  while (cursor < doc.length && doc[cursor] === "`") cursor += 1;
  return cursor - position;
}

function findEnclosingCodeSpan(
  doc: string,
  from: number,
  to: number,
  selected: string
): EnclosingCodeSpan | null {
  for (const padding of [0, 1]) {
    const openingEnd = from - padding;
    const closingStart = to + padding;
    if (padding === 1 && (doc[openingEnd] !== " " || doc[to] !== " ")) continue;

    const openingLength = countBackticksBefore(doc, openingEnd);
    const closingLength = countBackticksAfter(doc, closingStart);
    if (openingLength === 0 || openingLength !== closingLength) continue;
    if (openingLength <= longestBacktickRun(selected)) continue;

    const spanFrom = openingEnd - openingLength;
    const spanTo = closingStart + closingLength;
    if (doc[spanFrom - 1] === "`" || doc[spanTo] === "`") continue;
    return { from: spanFrom, to: spanTo };
  }
  return null;
}

export function toggleInlineCode(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);
  const enclosing = findEnclosingCodeSpan(doc, from, to, selected);

  if (enclosing) {
    editor.replaceRange(enclosing.from, enclosing.to, selected, {
      anchor: enclosing.from,
      head: enclosing.from + selected.length
    });
    return true;
  }

  const delimiter = "`".repeat(longestBacktickRun(selected) + 1);
  // Padding prevents an edge backtick from merging with the delimiter and
  // preserves paired edge spaces after CommonMark's code-span normalization.
  const needsPadding =
    selected.startsWith("`") ||
    selected.endsWith("`") ||
    (selected.startsWith(" ") && selected.endsWith(" ") && !/^ +$/.test(selected));
  const padding = needsPadding ? " " : "";
  const replacement = `${delimiter}${padding}${selected}${padding}${delimiter}`;
  const selectionFrom = from + delimiter.length + padding.length;

  editor.replaceRange(from, to, replacement, {
    anchor: selectionFrom,
    head: selectionFrom + selected.length
  });
  return true;
}

export function insertLink(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);
  const linkText = selected || "link text";
  const markdown = `[${linkText}](url)`;

  editor.setDocument(doc.slice(0, from) + markdown + doc.slice(to));
  const urlStart = from + linkText.length + 3;
  editor.setSelection(urlStart, urlStart + 3);
  return true;
}

export function toggleHeading(editor: EditorAPI, level: number): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();
  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEnd = doc.indexOf("\n", anchor);
  const end = lineEnd === -1 ? doc.length : lineEnd;
  const line = doc.slice(lineStart, end);
  const prefix = "#".repeat(level) + " ";
  const headingMatch = line.match(/^#{1,6}\s/);
  const newLine = headingMatch?.[0] === prefix
    ? line.slice(prefix.length)
    : prefix + (headingMatch ? line.slice(headingMatch[0].length) : line);

  editor.setDocument(doc.slice(0, lineStart) + newLine + doc.slice(end));
  editor.setSelection(lineStart + newLine.length);
  return true;
}

/** Shared command catalogue used by both the legacy and lifecycle entrypoints. */
export const toolbarSlashCommands: SlashCommandDef[] = [
  {
    id: "h1",
    title: "Heading 1",
    description: "Big section heading",
    keywords: ["h1", "title", "heading", "header"],
    run: (editor) => toggleHeading(editor, 1),
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "Medium section heading",
    keywords: ["h2", "subtitle", "heading", "header"],
    run: (editor) => toggleHeading(editor, 2),
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "Small section heading",
    keywords: ["h3", "heading", "header"],
    run: (editor) => toggleHeading(editor, 3),
  },
  {
    id: "bold",
    title: "Bold",
    description: "Strong emphasis around the selection",
    keywords: ["bold", "strong", "b"],
    run: toggleBold,
  },
  {
    id: "italic",
    title: "Italic",
    description: "Italic emphasis around the selection",
    keywords: ["italic", "em", "i"],
    run: toggleItalic,
  },
  {
    id: "strikethrough",
    title: "Strikethrough",
    description: "Strike through the selection",
    keywords: ["strike", "strikethrough", "del"],
    run: toggleStrikethrough,
  },
  {
    id: "inline-code",
    title: "Inline code",
    description: "Wrap the selection in backticks",
    keywords: ["code", "inline", "monospace"],
    run: toggleInlineCode,
  },
  {
    id: "code-block",
    title: "Code block",
    description: "Insert a fenced code block",
    keywords: ["code", "block", "fence", "```"],
    run: insertCodeBlock,
  },
  {
    id: "blockquote",
    title: "Blockquote",
    description: "Quote the current line",
    keywords: ["quote", "blockquote", ">"],
    run: toggleBlockquote,
  },
  {
    id: "ulist",
    title: "Bulleted list",
    description: "Start an unordered list",
    keywords: ["list", "ul", "bullet", "unordered"],
    run: toggleUnorderedList,
  },
  {
    id: "olist",
    title: "Numbered list",
    description: "Start an ordered list",
    keywords: ["list", "ol", "ordered", "numbered"],
    run: toggleOrderedList,
  },
  {
    id: "link",
    title: "Link",
    description: "Insert a markdown link",
    keywords: ["link", "url", "href", "a"],
    run: insertLink,
  },
  {
    id: "image",
    title: "Image",
    description: "Insert a markdown image",
    keywords: ["image", "img", "picture", "photo"],
    run: insertImage,
  },
  {
    id: "hr",
    title: "Divider",
    description: "Insert a horizontal rule",
    keywords: ["hr", "rule", "divider", "separator", "---"],
    run: insertHorizontalRule,
  },
];
