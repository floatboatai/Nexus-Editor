import type { EditorAPI } from "@floatboat/nexus-core";

export function toggleWrap(editor: EditorAPI, marker: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);
  const before = doc.slice(Math.max(0, from - marker.length), from);
  const after = doc.slice(to, to + marker.length);

  const unwrap = before === marker && after === marker;
  const start = unwrap ? from - marker.length : from + marker.length;
  return editor.dispatchTransaction({
    changes: [{
      from: unwrap ? from - marker.length : from,
      to: unwrap ? to + marker.length : to,
      insert: unwrap ? selected : marker + selected + marker,
    }],
    selection: { ranges: [{ anchor: start, head: start + selected.length }], mainIndex: 0 },
    origin: ["formatting"],
    userEvent: "input.format",
  }).status === "success";
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
  return editor.dispatchTransaction({
    changes: [{ from, to, insert: markdown }],
    selection: { ranges: [{ anchor: urlStart, head: urlStart + 3 }], mainIndex: 0 },
    origin: ["formatting"],
    userEvent: "input.format",
  }).status === "success";
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
