import type { EditorAPI } from "@floatboat/nexus-core";

// ── Shared regex constants ────────────────────────────────────────────────────
// Centralised here so every toggle function uses the same patterns.

/** Matches an unordered list marker at the start of a line: `- `, `* `, or `+ `. */
const UL_RE = /^[-*+]\s/;

/** Matches an ordered list marker at the start of a line: `1. `, `12. `, etc. */
const OL_RE = /^\d+\.\s/;

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Get the current line containing the anchor position. */
function getCurrentLine(
  doc: string,
  anchor: number
): { lineStart: number; lineEnd: number; line: string } {
  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEndIdx = doc.indexOf("\n", anchor);
  const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
  return { lineStart, lineEnd, line: doc.slice(lineStart, lineEnd) };
}

interface SelectedLines {
  /** Offset of the first character of the first selected line. */
  blockStart: number;
  /** Offset one past the last character of the last selected line. */
  blockEnd: number;
  /** Individual line strings within the selection. */
  lines: string[];
}

/**
 * Return all complete lines covered by the range [from, to].
 * Snaps `from` back to its line-start and `to` forward to its line-end
 * so callers always operate on whole lines.
 */
function getSelectedLines(doc: string, from: number, to: number): SelectedLines {
  const blockStart = doc.lastIndexOf("\n", from - 1) + 1;
  const blockEndIdx = doc.indexOf("\n", to);
  const blockEnd = blockEndIdx === -1 ? doc.length : blockEndIdx;
  return { blockStart, blockEnd, lines: doc.slice(blockStart, blockEnd).split("\n") };
}

/**
 * Strip the leading list marker (ordered or unordered) from a line and return
 * the bare content. Returns the line unchanged when no marker is found.
 */
function stripListMarker(line: string): string {
  const ul = UL_RE.exec(line);
  if (ul) return line.slice(ul[0].length);
  const ol = OL_RE.exec(line);
  if (ol) return line.slice(ol[0].length);
  return line;
}

/** Toggle a line prefix (e.g., "> " for blockquote). Single-line only. */
function toggleLinePrefix(editor: EditorAPI, prefix: string): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();
  const { lineStart, lineEnd, line } = getCurrentLine(doc, anchor);

  const newLine = line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line;
  editor.setDocument(doc.slice(0, lineStart) + newLine + doc.slice(lineEnd));
  editor.setSelection(lineStart + newLine.length);
  return true;
}

// ── Public toggle functions ───────────────────────────────────────────────────

export function toggleBlockquote(editor: EditorAPI): boolean {
  const { anchor, head } = editor.getSelection();

  // Single-line: delegate to existing helper (no behavior change)
  if (anchor === head) return toggleLinePrefix(editor, "> ");

  const doc = editor.getDocument();
  const { blockStart, blockEnd, lines } = getSelectedLines(
    doc,
    Math.min(anchor, head),
    Math.max(anchor, head)
  );
  const prefix = "> ";
  const allHaveMarker = lines.every(l => l.startsWith(prefix));

  const newLines = lines.map(l =>
    l.trim() === ""
      ? l
      : allHaveMarker
        ? l.slice(prefix.length)
        : l.startsWith(prefix) ? l : prefix + l
  );
  const newText = newLines.join("\n");
  editor.setDocument(doc.slice(0, blockStart) + newText + doc.slice(blockEnd));
  editor.setSelection(blockStart, blockStart + newText.length);
  return true;
}

export function toggleOrderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();

  // Single-line: original logic preserved verbatim
  if (anchor === head) {
    const { lineStart, lineEnd, line } = getCurrentLine(doc, anchor);
    const olMatch = OL_RE.exec(line);
    const newLine = olMatch ? line.slice(olMatch[0].length) : `1. ${stripListMarker(line)}`;
    editor.setDocument(doc.slice(0, lineStart) + newLine + doc.slice(lineEnd));
    editor.setSelection(lineStart + newLine.length);
    return true;
  }

  // Multi-line: all-or-nothing toggle; renumber from 1 when adding markers
  const { blockStart, blockEnd, lines } = getSelectedLines(
    doc,
    Math.min(anchor, head),
    Math.max(anchor, head)
  );
  const allHaveMarker = lines.every(l => l.trim() === "" || OL_RE.test(l));

  let counter = 1;
  const newLines = lines.map(l => {
    // Blank lines are left untouched — they don't consume a sequence number.
    if (l.trim() === "") return l;
    if (allHaveMarker) {
      const m = OL_RE.exec(l);
      return m ? l.slice(m[0].length) : l;
    }
    return `${counter++}. ${stripListMarker(l)}`;
  });
  const newText = newLines.join("\n");
  editor.setDocument(doc.slice(0, blockStart) + newText + doc.slice(blockEnd));
  editor.setSelection(blockStart, blockStart + newText.length);
  return true;
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();

  // Single-line: original logic preserved verbatim
  if (anchor === head) {
    const { lineStart, lineEnd, line } = getCurrentLine(doc, anchor);
    const ulMatch = UL_RE.exec(line);
    const newLine = ulMatch ? line.slice(ulMatch[0].length) : `- ${stripListMarker(line)}`;
    editor.setDocument(doc.slice(0, lineStart) + newLine + doc.slice(lineEnd));
    editor.setSelection(lineStart + newLine.length);
    return true;
  }

  // Multi-line: all-or-nothing toggle across every selected line
  const { blockStart, blockEnd, lines } = getSelectedLines(
    doc,
    Math.min(anchor, head),
    Math.max(anchor, head)
  );
  const allHaveMarker = lines.every(l => l.trim() === "" || UL_RE.test(l));

  const newLines = lines.map(l => {
    // Blank lines are left untouched — no marker added or removed.
    if (l.trim() === "") return l;
    if (allHaveMarker) {
      const m = UL_RE.exec(l);
      return m ? l.slice(m[0].length) : l;
    }
    return UL_RE.test(l) ? l : `- ${stripListMarker(l)}`;
  });
  const newText = newLines.join("\n");
  editor.setDocument(doc.slice(0, blockStart) + newText + doc.slice(blockEnd));
  editor.setSelection(blockStart, blockStart + newText.length);
  return true;
}

// ── Insert / apply helpers (unchanged) ───────────────────────────────────────

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

  editor.setDocument(doc.slice(0, from) + block + doc.slice(to));
  // Place cursor on the language specifier line (right after opening ```)
  editor.setSelection(from + (needsLeadingNewline ? 1 : 0) + 3);
  return true;
}

export function insertImage(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  const alt = doc.slice(from, to) || "alt text";
  const md = `![${alt}](url)`;
  editor.setDocument(doc.slice(0, from) + md + doc.slice(to));
  // Select the "url" placeholder for easy replacement
  const urlStart = from + alt.length + 4;
  editor.setSelection(urlStart, urlStart + 3);
  return true;
}

export function applyTextColor(editor: EditorAPI, color: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  if (from === to) return false;

  const selected = doc.slice(from, to);
  const open = `<span style="color:${color}">`;
  const wrapped = `${open}${selected}</span>`;
  editor.setDocument(doc.slice(0, from) + wrapped + doc.slice(to));
  editor.setSelection(from + open.length, from + open.length + selected.length);
  return true;
}

export function applyHighlight(editor: EditorAPI, color: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  if (from === to) return false;

  const selected = doc.slice(from, to);
  const open = `<mark style="background:${color}">`;
  const wrapped = `${open}${selected}</mark>`;
  editor.setDocument(doc.slice(0, from) + wrapped + doc.slice(to));
  editor.setSelection(from + open.length, from + open.length + selected.length);
  return true;
}

export function insertHorizontalRule(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();

  const needsLeadingNewline = anchor > 0 && doc[anchor - 1] !== "\n";
  const hr = (needsLeadingNewline ? "\n" : "") + "---\n";
  editor.setDocument(doc.slice(0, anchor) + hr + doc.slice(anchor));
  editor.setSelection(anchor + hr.length);
  return true;
}
