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

/** Toggle a line prefix (e.g., "> " for blockquote). */
function toggleLinePrefix(editor: EditorAPI, prefix: string): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();
  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEndIdx = doc.indexOf("\n", anchor);
  const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
  const line = doc.slice(lineStart, lineEnd);

  const newLine = line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line;
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

export interface InsertTableOptions {
  /**
   * Number of columns in the table. Clamped to at least 1.
   */
  cols?: number;
  /**
   * Number of body rows. Clamped to at least 1. The separator (delimiter) row
   * and an optional header row are added on top of this count.
   */
  rows?: number;
  /**
   * Emit a `Header N` row above the delimiter row. Defaults to `true`.
   */
  includeHeaderRow?: boolean;
}

const TASK_MARKER = /^(\s*)([-*+]\s+)\[([ xX])\]\s?(.*)$/;
const LIST_MARKER = /^(\s*)([-*+]\s+|\d+\.\s+)(.*)$/;

/**
 * Build a single GFM table row from its cell contents. Each cell is padded with
 * a single space on both sides (e.g. `| a | b |`) which is the most readable
 * and widely-supported variant of GFM table syntax.
 */
function buildTableRow(cells: readonly string[]): string {
  return `|${cells.map((cell) => ` ${cell} `).join("|")}|`;
}

/**
 * Insert a GitHub-Flavored Markdown table at the caret.
 *
 * The table is emitted as one atomic `replaceRange` transaction so the whole
 * insertion — including the resulting caret move — collapses into a single undo
 * step (mirrors `applyLines`). The caret is placed inside the first body cell
 * so the user can start typing immediately.
 *
 * Surrounding newlines are added only when needed, so inserting into the middle
 * of a paragraph or at the very start/end of the document stays well-formed.
 */
export function insertTable(editor: EditorAPI, options: InsertTableOptions = {}): boolean {
  const cols = Math.max(1, Math.floor(options.cols ?? 3));
  const rows = Math.max(1, Math.floor(options.rows ?? 3));
  const includeHeader = options.includeHeaderRow ?? true;

  const lines: string[] = [];
  if (includeHeader) {
    lines.push(buildTableRow(Array.from({ length: cols }, (_, i) => `Header ${i + 1}`)));
  }
  // The delimiter row is mandatory for GFM tables even when there is no header.
  lines.push(buildTableRow(Array.from({ length: cols }, () => "---")));
  for (let row = 0; row < rows; row++) {
    lines.push(buildTableRow(Array.from({ length: cols }, () => "")));
  }
  const table = lines.join("\n");

  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  const needsLeadingNewline = from > 0 && doc[from - 1] !== "\n";
  const needsTrailingNewline = to < doc.length && doc[to] !== "\n";
  const leading = needsLeadingNewline ? "\n" : "";
  const trailing = needsTrailingNewline ? "\n" : "";
  const inserted = `${leading}${table}${trailing}`;

  // Caret offset *inside* `table`, in the first cell of the first body row.
  const firstBodyRowIndex = (includeHeader ? 1 : 0) + 1; // +1 for the delimiter row
  let cursorInTable = 0;
  for (let i = 0; i < firstBodyRowIndex; i++) {
    cursorInTable += lines[i].length + 1;
  }
  cursorInTable += "| ".length;
  const caretPos = from + leading.length + cursorInTable;

  editor.replaceRange(from, to, inserted, { anchor: caretPos });
  return true;
}

/**
 * Toggle a GitHub-Flavored Markdown task list on the lines intersecting the
 * current selection (or the line under a collapsed caret).
 *
 * - Every intersecting line already a task item  → the markers are removed and
 *   the lines revert to plain text (toggle off, mirroring `toggleUnorderedList`).
 * - Otherwise every line becomes a `- [ ]` task item, converting plain bullets,
 *   ordered list markers, and bare text in one pass.
 *
 * The whole block is rewritten in a single `replaceRange` transaction so it is
 * one undo step and the caret select the transformed block afterwards.
 */
export function toggleTaskList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const lines = getLinesInRange(doc, from, to);

  const allTasks = lines.every(({ line }) => TASK_MARKER.test(line));

  const newLines = lines.map(({ line }) => {
    const task = line.match(TASK_MARKER);
    if (task) {
      if (allTasks) {
        // Toggle off: drop the entire `- [ ] ` marker, keep indent + text.
        return `${task[1]}${task[4]}`;
      }
      // Not all lines are tasks yet — normalise existing items to unchecked.
      return line.replace(TASK_MARKER, "$1$2[ ] $4");
    }

    const list = line.match(LIST_MARKER);
    if (list) {
      return `${list[1]}- [ ] ${list[3]}`;
    }

    const indent = line.match(/^(\s*)/)?.[1] ?? "";
    return `${indent}- [ ] ${line.slice(indent.length)}`;
  });

  return applyLines(editor, lines, newLines);
}