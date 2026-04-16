import type { EditorAPI, NexusPlugin } from "@nexus/core";

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
  const { anchor } = editor.getSelection();
  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEnd = doc.indexOf("\n", anchor);
  const end = lineEnd === -1 ? doc.length : lineEnd;
  const line = doc.slice(lineStart, end);

  const prefix = "#".repeat(level) + " ";
  const headingMatch = line.match(/^#{1,6}\s/);

  let newLine: string;
  if (headingMatch && headingMatch[0] === prefix) {
    // Same level — remove heading
    newLine = line.slice(headingMatch[0].length);
  } else if (headingMatch) {
    // Different level — replace
    newLine = prefix + line.slice(headingMatch[0].length);
  } else {
    // No heading — add
    newLine = prefix + line;
  }

  const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(end);
  editor.setDocument(newDoc);
  editor.setSelection(lineStart + newLine.length);
  return true;
}

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
  };
}
