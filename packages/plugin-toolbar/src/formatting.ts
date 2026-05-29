import type { EditorAPI } from "@floatboat/nexus-core";

/** Get the current line containing the anchor position. */
function getCurrentLine(doc: string, anchor: number): { lineStart: number; lineEnd: number; line: string } {
  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEndIdx = doc.indexOf("\n", anchor);
  const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
  return { lineStart, lineEnd, line: doc.slice(lineStart, lineEnd) };
}

interface LineRange {
  lineStart: number;
  lineEnd: number;
  line: string;
}

/**
 * Get all lines touched by the current selection (or just the cursor line
 * when there is no selection). Returns the lines in document order together
 * with each line's start/end offsets.
 */
function getSelectedLines(doc: string, anchor: number, head: number): LineRange[] {
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  const lines: LineRange[] = [];
  let pos = 0;

  while (pos <= doc.length) {
    const lineStart = pos;
    const nlIdx = doc.indexOf("\n", pos);
    const lineEnd = nlIdx === -1 ? doc.length : nlIdx;
    const line = doc.slice(lineStart, lineEnd);

    // A line is "selected" when it overlaps the [from, to) range.
    // For cursor-only selections (from === to) only the line containing
    // the cursor is returned.
    if (lineEnd > from && lineStart < to) {
      lines.push({ lineStart, lineEnd, line });
    }

    if (nlIdx === -1) break;
    pos = nlIdx + 1;
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
  const lines = getSelectedLines(doc, anchor, head);

  if (lines.length <= 1) {
    // Single-line (cursor-only) — original behaviour
    const { lineStart, lineEnd, line } = lines[0] ?? getCurrentLine(doc, anchor);

    const olMatch = line.match(/^\d+\.\s/);
    let newLine: string;
    if (olMatch) {
      newLine = line.slice(olMatch[0].length);
    } else {
      const ulMatch = line.match(/^[-*+]\s/);
      const content = ulMatch ? line.slice(ulMatch[0].length) : line;
      newLine = "1. " + content;
    }

    const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(lineEnd);
    editor.setDocument(newDoc);
    editor.setSelection(lineStart + newLine.length);
    return true;
  }

  // Multi-line: if ALL lines are already ordered-list items → remove;
  // otherwise add "N. " to every non-OL line (replacing any UL marker).
  const allOl = lines.every((l) => /^\d+\.\s/.test(l.line));

  let offset = 0;
  let newDoc = doc;
  let firstNewLineStart = lines[0].lineStart;
  let selectionEnd = firstNewLineStart;

  for (let i = 0; i < lines.length; i++) {
    const { lineStart, lineEnd, line } = lines[i];
    const adjStart = lineStart + offset;
    const adjEnd = lineEnd + offset;

    let newLine: string;
    if (allOl) {
      const olMatch = line.match(/^\d+\.\s/)!;
      newLine = line.slice(olMatch[0].length);
    } else {
      const ulMatch = line.match(/^[-*+]\s/);
      const olMatch = line.match(/^\d+\.\s/);
      const content = ulMatch
        ? line.slice(ulMatch[0].length)
        : olMatch
          ? line.slice(olMatch[0].length)
          : line;
      newLine = `${i + 1}. ` + content;
    }

    newDoc = newDoc.slice(0, adjStart) + newLine + newDoc.slice(adjEnd);
    offset += newLine.length - (adjEnd - adjStart);
    selectionEnd = adjStart + newLine.length;
  }

  editor.setDocument(newDoc);
  editor.setSelection(firstNewLineStart, selectionEnd);
  return true;
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const lines = getSelectedLines(doc, anchor, head);

  if (lines.length <= 1) {
    // Single-line (cursor-only) — original behaviour
    const { lineStart, lineEnd, line } = lines[0] ?? getCurrentLine(doc, anchor);

    const ulMatch = line.match(/^[-*+]\s/);
    let newLine: string;
    if (ulMatch) {
      newLine = line.slice(ulMatch[0].length);
    } else {
      const olMatch = line.match(/^\d+\.\s/);
      const content = olMatch ? line.slice(olMatch[0].length) : line;
      newLine = "- " + content;
    }

    const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(lineEnd);
    editor.setDocument(newDoc);
    editor.setSelection(lineStart + newLine.length);
    return true;
  }

  // Multi-line: if ALL lines are already unordered-list items → remove;
  // otherwise add "- " to every non-UL line (replacing any OL marker).
  const allUl = lines.every((l) => /^[-*+]\s/.test(l.line));

  let offset = 0;
  let newDoc = doc;
  let firstNewLineStart = lines[0].lineStart;
  let selectionEnd = firstNewLineStart;

  for (const { lineStart, lineEnd, line } of lines) {
    const adjStart = lineStart + offset;
    const adjEnd = lineEnd + offset;

    let newLine: string;
    if (allUl) {
      const ulMatch = line.match(/^[-*+]\s/)!;
      newLine = line.slice(ulMatch[0].length);
    } else {
      const ulMatch = line.match(/^[-*+]\s/);
      const olMatch = line.match(/^\d+\.\s/);
      const content = ulMatch
        ? line.slice(ulMatch[0].length)
        : olMatch
          ? line.slice(olMatch[0].length)
          : line;
      newLine = "- " + content;
    }

    newDoc = newDoc.slice(0, adjStart) + newLine + newDoc.slice(adjEnd);
    offset += newLine.length - (adjEnd - adjStart);
    selectionEnd = adjStart + newLine.length;
  }

  editor.setDocument(newDoc);
  editor.setSelection(firstNewLineStart, selectionEnd);
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
