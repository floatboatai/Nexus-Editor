import { enLocale } from "@floatboat/nexus-core";
import type { EditorAPI, NexusLocale, SlashCommandDef } from "@floatboat/nexus-core";

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

/** Build the shared command catalogue from a resolved locale. */
export function createToolbarSlashCommands(locale: NexusLocale): SlashCommandDef[] {
  return [
    {
      id: "h1",
      title: locale.slashHeading1,
      description: locale.slashHeading1Description,
      keywords: ["h1", "title", "heading", "header"],
      run: (editor) => toggleHeading(editor, 1),
    },
    {
      id: "h2",
      title: locale.slashHeading2,
      description: locale.slashHeading2Description,
      keywords: ["h2", "subtitle", "heading", "header"],
      run: (editor) => toggleHeading(editor, 2),
    },
    {
      id: "h3",
      title: locale.slashHeading3,
      description: locale.slashHeading3Description,
      keywords: ["h3", "heading", "header"],
      run: (editor) => toggleHeading(editor, 3),
    },
    {
      id: "bold",
      title: locale.slashBold,
      description: locale.slashBoldDescription,
      keywords: ["bold", "strong", "b"],
      run: toggleBold,
    },
    {
      id: "italic",
      title: locale.slashItalic,
      description: locale.slashItalicDescription,
      keywords: ["italic", "em", "i"],
      run: toggleItalic,
    },
    {
      id: "strikethrough",
      title: locale.slashStrikethrough,
      description: locale.slashStrikethroughDescription,
      keywords: ["strike", "strikethrough", "del"],
      run: toggleStrikethrough,
    },
    {
      id: "inline-code",
      title: locale.slashInlineCode,
      description: locale.slashInlineCodeDescription,
      keywords: ["code", "inline", "monospace"],
      run: toggleInlineCode,
    },
    {
      id: "code-block",
      title: locale.slashCodeBlock,
      description: locale.slashCodeBlockDescription,
      keywords: ["code", "block", "fence", "```"],
      run: insertCodeBlock,
    },
    {
      id: "blockquote",
      title: locale.slashBlockquote,
      description: locale.slashBlockquoteDescription,
      keywords: ["quote", "blockquote", ">"],
      run: toggleBlockquote,
    },
    {
      id: "ulist",
      title: locale.slashBulletedList,
      description: locale.slashBulletedListDescription,
      keywords: ["list", "ul", "bullet", "unordered"],
      run: toggleUnorderedList,
    },
    {
      id: "olist",
      title: locale.slashNumberedList,
      description: locale.slashNumberedListDescription,
      keywords: ["list", "ol", "ordered", "numbered"],
      run: toggleOrderedList,
    },
    {
      id: "link",
      title: locale.slashLink,
      description: locale.slashLinkDescription,
      keywords: ["link", "url", "href", "a"],
      run: insertLink,
    },
    {
      id: "image",
      title: locale.slashImage,
      description: locale.slashImageDescription,
      keywords: ["image", "img", "picture", "photo"],
      run: insertImage,
    },
    {
      id: "hr",
      title: locale.slashDivider,
      description: locale.slashDividerDescription,
      keywords: ["hr", "rule", "divider", "separator", "---"],
      run: insertHorizontalRule,
    },
  ];
}

/** English command catalogue — kept for backward-compatible imports. */
export const toolbarSlashCommands: SlashCommandDef[] = createToolbarSlashCommands(enLocale);
