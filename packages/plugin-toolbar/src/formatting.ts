import type { EditorAPI } from "@floatboat/nexus-core";

const UL_MARKER = /^[-*+]\s/;
const OL_MARKER = /^\d+\.\s/;

interface LineInfo {
  lineStart: number;
  lineEnd: number;
  line: string;
}

/** Get the current line containing the anchor position. */
function getCurrentLine(doc: string, anchor: number): LineInfo {
  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEndIdx = doc.indexOf("\n", anchor);
  const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
  return { lineStart, lineEnd, line: doc.slice(lineStart, lineEnd) };
}

/**
 * Return every line touched by the [from, to] selection. When the selection
 * end sits on a line's leading boundary (right after the previous \n) and the
 * selection is non-empty, we still treat that line as part of the range so
 * the caller's intent — "I dragged across these lines" — matches the result.
 */
function getSelectedLines(doc: string, from: number, to: number): LineInfo[] {
  const lines: LineInfo[] = [];
  let cursor = doc.lastIndexOf("\n", from - 1) + 1;

  while (cursor <= doc.length) {
    const nextNewline = doc.indexOf("\n", cursor);
    const lineEnd = nextNewline === -1 ? doc.length : nextNewline;
    lines.push({
      lineStart: cursor,
      lineEnd,
      line: doc.slice(cursor, lineEnd)
    });

    if (lineEnd >= to) break;
    cursor = lineEnd + 1;
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

/**
 * Apply a list-marker transform to every line covered by the selection.
 * Empty lines are passed through unchanged so blank rows aren't bulleted.
 *
 * Toggle direction is decided by "all-or-nothing": only when *every*
 * non-empty line already carries this list's marker do we strip it. Mixed
 * states (some marked, some plain, or wrong marker type) all unify to
 * "added", which matches what users expect when batch-toggling a region.
 */
function toggleListLines(
  editor: EditorAPI,
  mode: "ordered" | "unordered"
): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const lines = getSelectedLines(doc, from, to);

  if (lines.length === 0) return false;

  const ownMarker = mode === "ordered" ? OL_MARKER : UL_MARKER;
  const otherMarker = mode === "ordered" ? UL_MARKER : OL_MARKER;
  const nonEmpty = lines.filter((l) => l.line.trim().length > 0);

  // All non-empty lines carry our marker → remove. Otherwise add.
  const allMarked = nonEmpty.length > 0 && nonEmpty.every((l) => ownMarker.test(l.line));
  const shouldRemove = allMarked;

  const firstLineStart = lines[0].lineStart;
  const lastLineEnd = lines[lines.length - 1].lineEnd;
  const before = doc.slice(0, firstLineStart);
  const after = doc.slice(lastLineEnd);

  let counter = 1;
  const transformed = lines.map((l) => {
    if (l.line.trim().length === 0) return l.line;

    if (shouldRemove) {
      const match = l.line.match(ownMarker);
      return match ? l.line.slice(match[0].length) : l.line;
    }

    // Adding: strip any existing marker first so we don't stack them.
    const ownMatch = l.line.match(ownMarker);
    const otherMatch = l.line.match(otherMarker);
    const stripped = ownMatch
      ? l.line.slice(ownMatch[0].length)
      : otherMatch
        ? l.line.slice(otherMatch[0].length)
        : l.line;

    if (mode === "ordered") {
      return `${counter++}. ${stripped}`;
    }
    return `- ${stripped}`;
  });

  const newRegion = transformed.join("\n");
  const newDoc = before + newRegion + after;
  editor.setDocument(newDoc);
  editor.setSelection(firstLineStart, firstLineStart + newRegion.length);
  return true;
}

export function toggleOrderedList(editor: EditorAPI): boolean {
  return toggleListLines(editor, "ordered");
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  return toggleListLines(editor, "unordered");
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
