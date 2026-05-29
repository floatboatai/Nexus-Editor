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
 * Get all lines touched by the [from, to) range. For cursor-only
 * selections (from === to) only the cursor line is returned.
 *
 * Starts scanning from the line containing `from` instead of pos 0.
 */
function getSelectedLines(doc: string, from: number, to: number): LineRange[] {
  const lines: LineRange[] = [];

  // Find the start of the line containing `from`
  let pos = doc.lastIndexOf("\n", from - 1) + 1;

  while (pos <= doc.length) {
    const lineStart = pos;
    const nlIdx = doc.indexOf("\n", pos);
    const lineEnd = nlIdx === -1 ? doc.length : nlIdx;

    if (lineEnd >= from && lineStart < to) {
      lines.push({ lineStart, lineEnd, line: doc.slice(lineStart, lineEnd) });
    }

    // Past the selection — stop early
    if (lineStart >= to) break;
    if (nlIdx === -1) break;
    pos = nlIdx + 1;
  }

  return lines;
}

// ---------------------------------------------------------------
//  Shared multi-line list helper
// ---------------------------------------------------------------

type LineMatcher = (line: string) => boolean;
type LineTransformer = (line: string, index: number) => string;

/**
 * Toggle a list prefix across one or more lines.
 *
 * - **Single-line** (cursor only): delegates to `singleFn`.
 * - **Multi-line**: if ALL lines match `isAlready` → strip via `stripFn`;
 *   otherwise transform every line via `addFn`.
 */
function toggleList(
  editor: EditorAPI,
  isAlready: LineMatcher,
  stripFn: (line: string) => string,
  addFn: LineTransformer,
  singleFn: (editor: EditorAPI) => boolean,
): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const lines = getSelectedLines(doc, Math.min(anchor, head), Math.max(anchor, head));

  if (lines.length <= 1) {
    return singleFn(editor);
  }

  const allMatch = lines.every((l) => isAlready(l.line));

  let offset = 0;
  let newDoc = doc;
  const firstStart = lines[0].lineStart;
  let selEnd = firstStart;

  for (let i = 0; i < lines.length; i++) {
    const { lineStart, lineEnd, line } = lines[i];
    const adjStart = lineStart + offset;
    const adjEnd = lineEnd + offset;

    const newLine = allMatch ? stripFn(line) : addFn(line, i);

    newDoc = newDoc.slice(0, adjStart) + newLine + newDoc.slice(adjEnd);
    offset += newLine.length - (adjEnd - adjStart);
    selEnd = adjStart + newLine.length;
  }

  editor.setDocument(newDoc);
  editor.setSelection(firstStart, selEnd);
  return true;
}

// ---------------------------------------------------------------
//  Single-line helpers (original behaviour, preserved verbatim)
// ---------------------------------------------------------------

function stripOl(line: string): string {
  return line.replace(/^\d+\.\s/, "");
}

function stripUl(line: string): string {
  return line.replace(/^[-*+]\s/, "");
}

function stripAnyList(line: string): string {
  return stripOl(stripUl(line));
}

function singleToggleOrderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();
  const { lineStart, lineEnd, line } = getCurrentLine(doc, anchor);

  const olMatch = line.match(/^\d+\.\s/);
  const newLine = olMatch ? line.slice(olMatch[0].length) : "1. " + stripUl(line);

  const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(lineEnd);
  editor.setDocument(newDoc);
  editor.setSelection(lineStart + newLine.length);
  return true;
}

function singleToggleUnorderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();
  const { lineStart, lineEnd, line } = getCurrentLine(doc, anchor);

  const ulMatch = line.match(/^[-*+]\s/);
  const newLine = ulMatch ? line.slice(ulMatch[0].length) : "- " + stripOl(line);

  const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(lineEnd);
  editor.setDocument(newDoc);
  editor.setSelection(lineStart + newLine.length);
  return true;
}

// ---------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------

export function toggleOrderedList(editor: EditorAPI): boolean {
  return toggleList(
    editor,
    (line) => /^\d+\.\s/.test(line),
    stripOl,
    (line, i) => `${i + 1}. ` + stripAnyList(line),
    singleToggleOrderedList,
  );
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  return toggleList(
    editor,
    (line) => /^[-*+]\s/.test(line),
    stripUl,
    (line) => "- " + stripAnyList(line),
    singleToggleUnorderedList,
  );
}

export function toggleBlockquote(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const lines = getSelectedLines(doc, from, to);

  if (lines.length <= 1) {
    // Single-line — original behaviour
    const { lineStart, lineEnd, line } = lines[0] ?? getCurrentLine(doc, anchor);
    const newLine = line.startsWith("> ") ? line.slice(2) : "> " + line;
    const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(lineEnd);
    editor.setDocument(newDoc);
    editor.setSelection(lineStart + newLine.length);
    return true;
  }

  const allBq = lines.every((l) => l.line.startsWith("> "));

  let offset = 0;
  let newDoc = doc;
  const firstStart = lines[0].lineStart;
  let selEnd = firstStart;

  for (const { lineStart, lineEnd, line } of lines) {
    const adjStart = lineStart + offset;
    const adjEnd = lineEnd + offset;
    const newLine = allBq ? line.slice(2) : "> " + line;
    newDoc = newDoc.slice(0, adjStart) + newLine + newDoc.slice(adjEnd);
    offset += newLine.length - (adjEnd - adjStart);
    selEnd = adjStart + newLine.length;
  }

  editor.setDocument(newDoc);
  editor.setSelection(firstStart, selEnd);
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
