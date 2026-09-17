import type { EditorAPI } from "@floatboat/nexus-core";

interface LineRange {
  lineStart: number;
  lineEnd: number;
  line: string;
}

/**
 * Returns every line that overlaps the half-open range [from, to).
 * When from === to (collapsed cursor) the single anchor line is returned.
 * A line whose start equals `to` exactly is excluded — this matches the
 * standard editor convention where selecting to column 0 of the next line
 * does not include that line.
 */
function getLinesInRange(doc: string, from: number, to: number): LineRange[] {
  const results: LineRange[] = [];
  let pos = doc.lastIndexOf("\n", from - 1) + 1; // start of the first covered line

  while (true) {
    const lineEndIdx = doc.indexOf("\n", pos);
    const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;

    if (pos < to || results.length === 0) {
      results.push({ lineStart: pos, lineEnd, line: doc.slice(pos, lineEnd) });
    }

    if (lineEndIdx === -1 || lineEndIdx >= to) break;
    pos = lineEndIdx + 1;
  }

  return results;
}

/**
 * Writes `newLines` back over the span covered by `lines` in ONE atomic
 * transaction, then sets the selection in the same dispatch so a single
 * undo reverts both the edit and the cursor move.
 *
 *   Single-line  → collapsed cursor at end of the transformed line
 *                  (preserves existing single-cursor toggle behaviour)
 *   Multi-line   → selection covers the entire transformed block, so the
 *                  user can immediately chain another toggle on the same
 *                  range without re-selecting.
 *
 * Do NOT split this into separate replaceRange + setSelection calls —
 * that would re-introduce the two-dispatch undo bug this function was
 * extracted to fix. Case 4 of the atomic-undo test suite is the
 * load-bearing regression guard for this constraint.
 */
function applyLines(editor: EditorAPI, lines: LineRange[], newLines: string[]): boolean {
  const first = lines[0];
  const last = lines[lines.length - 1];
  const newBlock = newLines.join("\n");
  const selection = lines.length === 1
    ? { anchor: first.lineStart + newLines[0].length }
    : { anchor: first.lineStart, head: first.lineStart + newBlock.length };
  editor.replaceRange(first.lineStart, last.lineEnd, newBlock, selection);
  return true;
}

/** Toggle a line prefix (e.g., "> ") across the selected lines. */
function toggleLinePrefix(editor: EditorAPI, prefix: string): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const lines = getLinesInRange(doc, Math.min(anchor, head), Math.max(anchor, head));
  const allMarked = lines.every(({ line }) => line.startsWith(prefix));
  return applyLines(editor, lines, lines.map(({ line }) => (
    allMarked ? line.slice(prefix.length) : prefix + line
  )));
}

export function toggleBlockquote(editor: EditorAPI): boolean {
  return toggleLinePrefix(editor, "> ");
}

export function toggleOrderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const lines = getLinesInRange(doc, from, to);

  const allMarked = lines.every(({ line }) => /^\d+\.\s/.test(line));

  let counter = 1;
  const newLines = lines.map(({ line }) => {
    if (allMarked) {
      return line.replace(/^\d+\.\s/, "");
    }
    const content = line.replace(/^(?:\d+\.\s|[-*+]\s)/, "");
    return `${counter++}. ${content}`;
  });

  return applyLines(editor, lines, newLines);
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const lines = getLinesInRange(doc, from, to);

  const allMarked = lines.every(({ line }) => /^[-*+]\s/.test(line));

  const newLines = lines.map(({ line }) => {
    if (allMarked) {
      return line.replace(/^[-*+]\s/, "");
    }
    const content = line.replace(/^(?:\d+\.\s|[-*+]\s)/, "");
    return `- ${content}`;
  });

  return applyLines(editor, lines, newLines);
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

  // Place cursor on the language line (after ```)
  const langPos = from + (needsLeadingNewline ? 1 : 0) + 3;
  editor.replaceRange(from, to, block, { anchor: langPos });
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
  // Select the "url" part
  const urlStart = from + alt.length + 4;
  editor.replaceRange(from, to, md, { anchor: urlStart, head: urlStart + 3 });
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
  const innerStart = from + `<span style="color:${color}">`.length;
  editor.replaceRange(from, to, wrapped, { anchor: innerStart, head: innerStart + selected.length });
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
  const innerStart = from + `<mark style="background:${color}">`.length;
  editor.replaceRange(from, to, wrapped, { anchor: innerStart, head: innerStart + selected.length });
  return true;
}

export function insertHorizontalRule(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();

  const needsBlankLine = anchor > 0 && doc[anchor - 1] !== "\n";
  const hr = (needsBlankLine ? "\n\n" : "") + "---\n";

  editor.replaceRange(anchor, anchor, hr, { anchor: anchor + hr.length });
  return true;
}
