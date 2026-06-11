import type { EditorAPI, NexusPlugin, SlashCommandDef } from "@floatboat/nexus-core";
import { colorDecorationExtension } from "./color-decoration";
import {
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  toggleBlockquote,
  toggleOrderedList,
  toggleUnorderedList,
} from "./formatting";

export { toggleBlockquote, toggleOrderedList, toggleUnorderedList, insertCodeBlock, insertImage, insertHorizontalRule, applyTextColor, applyHighlight } from "./formatting";
export { createToolbarUI } from "./toolbar-ui";
export { colorDecorationExtension } from "./color-decoration";
export type { ToolbarUI, ToolbarUIOptions, ToolbarButton, ToolbarGroup } from "./toolbar-ui";

export function toggleWrap(editor: EditorAPI, marker: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);

  const before = doc.slice(Math.max(0, from - marker.length), from);
  const after = doc.slice(to, to + marker.length);

  if (before === marker && after === marker) {
    // Already wrapped — remove markers
    const newDoc =
      doc.slice(0, from - marker.length) +
      selected +
      doc.slice(to + marker.length);
    editor.setDocument(newDoc);
    editor.setSelection(from - marker.length, to - marker.length);
    return true;
  }

  // Wrap selection with markers
  const newDoc =
    doc.slice(0, from) + marker + selected + marker + doc.slice(to);
  editor.setDocument(newDoc);
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
  const md = `[${linkText}](url)`;
  const newDoc = doc.slice(0, from) + md + doc.slice(to);
  editor.setDocument(newDoc);

  // Select the "url" part for easy replacement
  const urlStart = from + linkText.length + 3;
  editor.setSelection(urlStart, urlStart + 3);
  return true;
}

export function toggleHeading(editor: EditorAPI, level: number): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  // Collect all lines in the selection range.
  const firstLineStart = doc.lastIndexOf("\n", from - 1) + 1;
  const lines: Array<{ lineStart: number; lineEnd: number; line: string }> = [];
  let cursor = firstLineStart;
  while (cursor <= to && cursor <= doc.length) {
    const lineEndIdx = doc.indexOf("\n", cursor);
    const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
    lines.push({ lineStart: cursor, lineEnd, line: doc.slice(cursor, lineEnd) });
    if (lineEnd === doc.length) break;
    cursor = lineEnd + 1;
  }

  const prefix = "#".repeat(level) + " ";
  const HEADING_RE = /^#{1,6}\s/;

  // Toggle off only when every line is already at exactly this heading level.
  const allAtLevel = lines.every((l) => l.line.startsWith(prefix));

  const newLines = lines.map(({ line }) => {
    const headingMatch = HEADING_RE.exec(line);
    if (allAtLevel) {
      // Remove the heading prefix from every line.
      return headingMatch ? line.slice(headingMatch[0].length) : line;
    }
    if (headingMatch) {
      // Replace a different heading level with the target level.
      return prefix + line.slice(headingMatch[0].length);
    }
    return prefix + line;
  });

  const rangeStart = lines[0].lineStart;
  const rangeEnd = lines[lines.length - 1].lineEnd;
  const newBlock = newLines.join("\n");
  const newDoc = doc.slice(0, rangeStart) + newBlock + doc.slice(rangeEnd);
  editor.setDocument(newDoc);

  const newRangeEnd = rangeStart + newBlock.length;
  if (from === to) {
    editor.setSelection(newRangeEnd);
  } else {
    editor.setSelection(rangeStart, newRangeEnd);
  }
  return true;
}

/**
 * Slash-command catalogue exposed by the toolbar plugin. Each entry
 * reuses an existing formatting helper as its `run` so the slash menu
 * and the toolbar always produce identical output.
 *
 * Exported separately so hosts can compose this list with their own
 * commands (e.g. a vault-aware plugin adding `[[wikilink]]` insertion)
 * without re-deriving the toolbar set by hand.
 */
export const toolbarSlashCommands: SlashCommandDef[] = [
  {
    id: "h1",
    title: "Heading 1",
    description: "Big section heading",
    keywords: ["h1", "title", "heading", "header"],
    run: (e) => toggleHeading(e, 1),
  },
  {
    id: "h2",
    title: "Heading 2",
    description: "Medium section heading",
    keywords: ["h2", "subtitle", "heading", "header"],
    run: (e) => toggleHeading(e, 2),
  },
  {
    id: "h3",
    title: "Heading 3",
    description: "Small section heading",
    keywords: ["h3", "heading", "header"],
    run: (e) => toggleHeading(e, 3),
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

export function createToolbarPlugin(): NexusPlugin {
  return {
    name: "plugin-toolbar",
    shortcuts: [
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
      { key: "Mod-Shift-s", run: toggleStrikethrough },
      { key: "Mod-e", run: toggleInlineCode },
      { key: "Mod-k", run: insertLink },
      { key: "Mod-1", run: (e) => toggleHeading(e, 1) },
      { key: "Mod-2", run: (e) => toggleHeading(e, 2) },
      { key: "Mod-3", run: (e) => toggleHeading(e, 3) },
    ],
    slashCommands: toolbarSlashCommands,
    cmExtensions: [colorDecorationExtension()],
  };
}
