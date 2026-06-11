import type { EditorAPI } from "@floatboat/nexus-core";

// Patterns for detecting existing list/blockquote markers on a line.
const OL_RE = /^(\s*)(\d+)[.)]\s/;
const UL_RE = /^(\s*)[-*+]\s/;
const BQ_RE = /^(\s*)>\s?/;

/** Get the current line containing the given offset. */
function getCurrentLine(doc: string, pos: number): { lineStart: number; lineEnd: number; line: string } {
  const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
  const lineEndIdx = doc.indexOf("\n", pos);
  const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
  return { lineStart, lineEnd, line: doc.slice(lineStart, lineEnd) };
}

/**
 * Extract all lines that are fully or partially covered by [from, to].
 * Returns an array of { lineStart, lineEnd, line } objects and the offset
 * of the very first line start and the very last line end.
 */
function getLinesInRange(
  doc: string,
  from: number,
  to: number
): {
  lines: Array<{ lineStart: number; lineEnd: number; line: string }>;
  rangeStart: number;
  rangeEnd: number;
} {
  const firstLine = getCurrentLine(doc, from);
  // When from === to (no selection), operate only on the anchor line.
  if (from === to) {
    return {
      lines: [firstLine],
      rangeStart: firstLine.lineStart,
      rangeEnd: firstLine.lineEnd,
    };
  }

  const lines: Array<{ lineStart: number; lineEnd: number; line: string }> = [];
  let cursor = firstLine.lineStart;

  while (cursor <= to && cursor <= doc.length) {
    const lineEndIdx = doc.indexOf("\n", cursor);
    const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
    lines.push({ lineStart: cursor, lineEnd, line: doc.slice(cursor, lineEnd) });
    if (lineEnd === doc.length) break;
    cursor = lineEnd + 1;
  }

  return {
    lines,
    rangeStart: lines[0].lineStart,
    rangeEnd: lines[lines.length - 1].lineEnd,
  };
}

/** Strip any list marker (ordered or unordered) from a line, preserving leading indent. */
function stripListMarker(line: string): string {
  const olM = OL_RE.exec(line);
  if (olM) return olM[1] + line.slice(olM[0].length);
  const ulM = UL_RE.exec(line);
  if (ulM) return ulM[1] + line.slice(ulM[0].length);
  return line;
}

/** Strip a blockquote marker from a line, preserving leading indent. */
function stripBlockquoteMarker(line: string): string {
  const m = BQ_RE.exec(line);
  return m ? m[1] + line.slice(m[0].length) : line;
}

// ─── Public formatting commands ──────────────────────────────────────────────

export function toggleBlockquote(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const { lines, rangeStart, rangeEnd } = getLinesInRange(doc, from, to);

  const allQuoted = lines.every((l) => BQ_RE.test(l.line));

  const newLines = lines.map((l) => {
    if (allQuoted) return stripBlockquoteMarker(l.line);
    // In mixed state, only add `> ` to lines that are not yet blockquotes.
    return BQ_RE.test(l.line) ? l.line : "> " + l.line;
  });

  const newBlock = newLines.join("\n");
  const newDoc = doc.slice(0, rangeStart) + newBlock + doc.slice(rangeEnd);
  editor.setDocument(newDoc);

  // Restore selection to cover the transformed block.
  const newRangeEnd = rangeStart + newBlock.length;
  if (from === to) {
    editor.setSelection(newRangeEnd);
  } else {
    editor.setSelection(rangeStart, newRangeEnd);
  }
  return true;
}

export function toggleOrderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const { lines, rangeStart, rangeEnd } = getLinesInRange(doc, from, to);

  const allOrdered = lines.every((l) => OL_RE.test(l.line));

  let counter = 1;
  const newLines = lines.map((l) => {
    if (allOrdered) {
      // Remove ordered marker, restore any leading indent.
      return stripListMarker(l.line);
    }
    // Strip any existing marker (ul or ol) before applying a fresh numbered one.
    const indent = (UL_RE.exec(l.line) ?? OL_RE.exec(l.line))?.[1] ?? "";
    const content = stripListMarker(l.line);
    return `${indent}${counter++}. ${content.slice(indent.length)}`;
  });

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

export function toggleUnorderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const { lines, rangeStart, rangeEnd } = getLinesInRange(doc, from, to);

  const allUnordered = lines.every((l) => UL_RE.test(l.line));

  const newLines = lines.map((l) => {
    if (allUnordered) {
      return stripListMarker(l.line);
    }
    // Strip any existing marker before applying `- `.
    const indent = (UL_RE.exec(l.line) ?? OL_RE.exec(l.line))?.[1] ?? "";
    const content = stripListMarker(l.line);
    return `${indent}- ${content.slice(indent.length)}`;
  });

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
