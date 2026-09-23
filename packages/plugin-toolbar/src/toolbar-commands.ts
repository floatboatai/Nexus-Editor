import type { EditorAPI, SlashCommandDef } from "@floatboat/nexus-core";

import {
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  toggleBlockquote,
  toggleOrderedList,
  toggleUnorderedList,
} from "./formatting";

const TOOLBAR_REPLACE_OPTIONS = { isolateHistory: true } as const;

export function toggleWrap(editor: EditorAPI, marker: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);
  const before = doc.slice(Math.max(0, from - marker.length), from);
  const after = doc.slice(to, to + marker.length);

  if (before === marker && after === marker) {
    editor.replaceRange(
      from - marker.length,
      to + marker.length,
      selected,
      { anchor: from - marker.length, head: to - marker.length },
      TOOLBAR_REPLACE_OPTIONS,
    );
    return true;
  }

  editor.replaceRange(
    from,
    to,
    marker + selected + marker,
    { anchor: from + marker.length, head: to + marker.length },
    TOOLBAR_REPLACE_OPTIONS,
  );
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

export function toggleInlineCode(editor: EditorAPI): boolean {
  return toggleWrap(editor, "`");
}

export function insertLink(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);
  const linkText = selected || "link text";
  const markdown = `[${linkText}](url)`;

  const urlStart = from + linkText.length + 3;
  editor.replaceRange(from, to, markdown, { anchor: urlStart, head: urlStart + 3 }, TOOLBAR_REPLACE_OPTIONS);
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

  editor.replaceRange(lineStart, end, newLine, { anchor: lineStart + newLine.length }, TOOLBAR_REPLACE_OPTIONS);
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
