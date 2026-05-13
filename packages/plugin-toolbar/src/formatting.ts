import type { EditorAPI } from "@floatboat/nexus-core";

/** Get the current line containing the anchor position. */
function getCurrentLine(doc: string, anchor: number): { lineStart: number; lineEnd: number; line: string } {
  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEndIdx = doc.indexOf("\n", anchor);
  const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
  return { lineStart, lineEnd, line: doc.slice(lineStart, lineEnd) };
}

/** Get all lines within the selection range. */
function getSelectedLines(doc: string, from: number, to: number): Array<{ lineStart: number; lineEnd: number; line: string }> {
  const lines: Array<{ lineStart: number; lineEnd: number; line: string }> = [];
  let pos = from;

  while (pos <= to) {
    const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
    const lineEndIdx = doc.indexOf("\n", pos);
    const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;

    // Avoid duplicate lines
    if (lines.length === 0 || lines[lines.length - 1].lineStart !== lineStart) {
      lines.push({ lineStart, lineEnd, line: doc.slice(lineStart, lineEnd) });
    }

    if (lineEndIdx === -1) break;
    pos = lineEndIdx + 1;
  }

  return lines;
}

/** Toggle a line prefix (e.g., "> " for blockquote). */
function toggleLinePrefix(editor: EditorAPI, prefix: string): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();
  const { lineStart, lineEnd, line } = getCurrentLine(doc, anchor);

  let newLine: string;
  if (line.startsWith(prefix)) {
    newLine = line.slice(prefix.length);
  } else {
    newLine = prefix + line;
  }

  const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(lineEnd);
  editor.setDocument(newDoc);
  editor.setSelection(lineStart + newLine.length);
  return true;
}

export function toggleBlockquote(editor: EditorAPI): boolean {
  return toggleLinePrefix(editor, "> ");
}

export function toggleOrderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  // Get all selected lines
  const lines = getSelectedLines(doc, from, to);

  if (lines.length === 0) return false;

  // Check if all lines are already ordered lists
  const allOrdered = lines.every(({ line }) => /^\d+\.\s/.test(line));

  // Build new document
  let newDoc = doc;
  let offset = 0;
  let lastNewLineEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const { lineStart, lineEnd, line } = lines[i];
    const adjustedStart = lineStart + offset;
    const adjustedEnd = lineEnd + offset;

    let newLine: string;
    if (allOrdered) {
      // Remove ordered list marker
      const olMatch = line.match(/^\d+\.\s/);
      newLine = olMatch ? line.slice(olMatch[0].length) : line;
    } else {
      // Convert to ordered list (remove other markers first)
      const ulMatch = line.match(/^[-*+]\s/);
      const olMatch = line.match(/^\d+\.\s/);
      const content = ulMatch ? line.slice(ulMatch[0].length) : (olMatch ? line.slice(olMatch[0].length) : line);
      newLine = `${i + 1}. ${content}`;
    }

    newDoc = newDoc.slice(0, adjustedStart) + newLine + newDoc.slice(adjustedEnd);
    offset += newLine.length - (lineEnd - lineStart);
    lastNewLineEnd = adjustedStart + newLine.length;
  }

  editor.setDocument(newDoc);
  // Place cursor at the end of the last modified line
  editor.setSelection(lastNewLineEnd);
  return true;
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  // Get all selected lines
  const lines = getSelectedLines(doc, from, to);

  if (lines.length === 0) return false;

  // Check if all lines are already unordered lists
  const allUnordered = lines.every(({ line }) => /^[-*+]\s/.test(line));

  // Build new document
  let newDoc = doc;
  let offset = 0;
  let lastNewLineEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const { lineStart, lineEnd, line } = lines[i];
    const adjustedStart = lineStart + offset;
    const adjustedEnd = lineEnd + offset;

    let newLine: string;
    if (allUnordered) {
      // Remove unordered list marker
      const ulMatch = line.match(/^[-*+]\s/);
      newLine = ulMatch ? line.slice(ulMatch[0].length) : line;
    } else {
      // Convert to unordered list (remove other markers first)
      const olMatch = line.match(/^\d+\.\s/);
      const ulMatch = line.match(/^[-*+]\s/);
      const content = olMatch ? line.slice(olMatch[0].length) : (ulMatch ? line.slice(ulMatch[0].length) : line);
      newLine = `- ${content}`;
    }

    newDoc = newDoc.slice(0, adjustedStart) + newLine + newDoc.slice(adjustedEnd);
    offset += newLine.length - (lineEnd - lineStart);
    lastNewLineEnd = adjustedStart + newLine.length;
  }

  editor.setDocument(newDoc);
  // Place cursor at the end of the last modified line
  editor.setSelection(lastNewLineEnd);
  return true;
}

export function insertCodeBlock(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);

  const needsLeadingNewline = from > 0 && doc[from - 1] !== "\n";
  const needsTrailingNewline = to < doc.length && doc[to] !== "\n";

  const block =
    (needsLeadingNewline ? "\n" : "") +
    "```\n" + (selected || "") + "\n```" +
    (needsTrailingNewline ? "\n" : "");

  const newDoc = doc.slice(0, from) + block + doc.slice(to);
  editor.setDocument(newDoc);

  // Place cursor on the language line (after ```)
  const langPos = from + (needsLeadingNewline ? 1 : 0) + 3;
  editor.setSelection(langPos);
  return true;
}

export function insertImage(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);

  const alt = selected || "alt text";
  const md = `![${alt}](url)`;
  const newDoc = doc.slice(0, from) + md + doc.slice(to);
  editor.setDocument(newDoc);

  // Select the "url" part
  const urlStart = from + alt.length + 4;
  editor.setSelection(urlStart, urlStart + 3);
  return true;
}

export function applyTextColor(editor: EditorAPI, color: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);

  if (from === to) return false;

  const wrapped = `<span style="color:${color}">${selected}</span>`;
  const newDoc = doc.slice(0, from) + wrapped + doc.slice(to);
  editor.setDocument(newDoc);
  const innerStart = from + `<span style="color:${color}">`.length;
  editor.setSelection(innerStart, innerStart + selected.length);
  return true;
}

export function applyHighlight(editor: EditorAPI, color: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);

  if (from === to) return false;

  const wrapped = `<mark style="background:${color}">${selected}</mark>`;
  const newDoc = doc.slice(0, from) + wrapped + doc.slice(to);
  editor.setDocument(newDoc);
  const innerStart = from + `<mark style="background:${color}">`.length;
  editor.setSelection(innerStart, innerStart + selected.length);
  return true;
}

export function insertHorizontalRule(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();

  const needsLeadingNewline = anchor > 0 && doc[anchor - 1] !== "\n";
  const hr = (needsLeadingNewline ? "\n" : "") + "---\n";

  const newDoc = doc.slice(0, anchor) + hr + doc.slice(anchor);
  editor.setDocument(newDoc);
  editor.setSelection(anchor + hr.length);
  return true;
}
