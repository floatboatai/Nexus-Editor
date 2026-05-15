import type { EditorAPI } from "@floatboat/nexus-core";

/** Get the current line containing the anchor position. */
function getCurrentLine(doc: string, anchor: number): { lineStart: number; lineEnd: number; line: string } {
  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEndIdx = doc.indexOf("\n", anchor);
  const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
  return { lineStart, lineEnd, line: doc.slice(lineStart, lineEnd) };
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

interface LineRange {
  lineStart: number;
  lineEnd: number;
  line: string;
}

function getLinesInRange(doc: string, from: number, to: number): LineRange[] {
  const lines: LineRange[] = [];
  let pos = 0;
  for (const text of doc.split("\n")) {
    const lineStart = pos;
    const lineEnd = pos + text.length;
    if (lineEnd >= from && lineStart <= to) {
      lines.push({ lineStart, lineEnd, line: text });
    }
    pos = lineEnd + 1;
  }
  return lines;
}

export function toggleOrderedList(editor: EditorAPI): boolean {
  let doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const selFrom = Math.min(anchor, head);
  const selTo = Math.max(anchor, head);
  const lines = getLinesInRange(doc, selFrom, selTo);

  let offset = 0;
  let lastLineEnd = 0;
  let number = 1;
  const allHaveMarkers = lines.every((l) => /^\d+\.\s/.test(l.line) || /^[-*+]\s/.test(l.line));
  for (const { lineStart, lineEnd, line } of lines) {
    if (line.trim() === "") continue;
    const adjustedStart = lineStart + offset;
    const adjustedEnd = lineEnd + offset;
    const currentLine = doc.slice(adjustedStart, adjustedEnd);

    const olMatch = currentLine.match(/^\d+\.\s/);
    let newLine: string;
    if (olMatch && allHaveMarkers) {
      newLine = currentLine.slice(olMatch[0].length);
    } else if (olMatch) {
      newLine = `${number}. ${currentLine.slice(olMatch[0].length)}`;
      number++;
    } else {
      const ulMatch = currentLine.match(/^[-*+]\s/);
      const content = ulMatch ? currentLine.slice(ulMatch[0].length) : currentLine;
      newLine = `${number}. ${content}`;
      number++;
    }

    doc = doc.slice(0, adjustedStart) + newLine + doc.slice(adjustedEnd);
    offset += newLine.length - currentLine.length;
    lastLineEnd = adjustedStart + newLine.length;
  }

  editor.setDocument(doc);
  editor.setSelection(selFrom, lastLineEnd);
  return true;
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  let doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const selFrom = Math.min(anchor, head);
  const selTo = Math.max(anchor, head);
  const lines = getLinesInRange(doc, selFrom, selTo);

  let offset = 0;
  let lastLineEnd = 0;
  const allHaveMarkers = lines.every((l) => /^\d+\.\s/.test(l.line) || /^[-*+]\s/.test(l.line));
  for (const { lineStart, lineEnd, line } of lines) {
    if (line.trim() === "") continue;
    const adjustedStart = lineStart + offset;
    const adjustedEnd = lineEnd + offset;
    const currentLine = doc.slice(adjustedStart, adjustedEnd);

    const ulMatch = currentLine.match(/^[-*+]\s/);
    let newLine: string;
    if (ulMatch && allHaveMarkers) {
      newLine = currentLine.slice(ulMatch[0].length);
    } else if (ulMatch) {
      newLine = `- ${currentLine.slice(ulMatch[0].length)}`;
    } else {
      const olMatch = currentLine.match(/^\d+\.\s/);
      const content = olMatch ? currentLine.slice(olMatch[0].length) : currentLine;
      newLine = `- ${content}`;
    }

    doc = doc.slice(0, adjustedStart) + newLine + doc.slice(adjustedEnd);
    offset += newLine.length - currentLine.length;
    lastLineEnd = adjustedStart + newLine.length;
  }

  editor.setDocument(doc);
  editor.setSelection(selFrom, lastLineEnd);
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
