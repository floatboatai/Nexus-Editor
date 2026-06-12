import type { EditorAPI } from "@floatboat/nexus-core";

const COLOR_MARKER_PREFIX = "[[nexus-color:";
const COLOR_MARKER_SUFFIX = "]]";
const COLOR_CLOSE_MARKER = "[[/nexus-color]]";
const HIGHLIGHT_MARKER_PREFIX = "[[nexus-highlight:";
const HIGHLIGHT_MARKER_SUFFIX = "]]";
const HIGHLIGHT_CLOSE_MARKER = "[[/nexus-highlight]]";

function wrapWithMarker(text: string, openMarker: string, closeMarker: string): string {
  return `${openMarker}${text}${closeMarker}`;
}

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

export function toggleOrderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();
  const { lineStart, lineEnd, line } = getCurrentLine(doc, anchor);

  const olMatch = line.match(/^\d+\.\s/);
  let newLine: string;
  if (olMatch) {
    newLine = line.slice(olMatch[0].length);
  } else {
    // Remove other list markers if present
    const ulMatch = line.match(/^[-*+]\s/);
    const content = ulMatch ? line.slice(ulMatch[0].length) : line;
    newLine = "1. " + content;
  }

  const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(lineEnd);
  editor.setDocument(newDoc);
  editor.setSelection(lineStart + newLine.length);
  return true;
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor } = editor.getSelection();
  const { lineStart, lineEnd, line } = getCurrentLine(doc, anchor);

  const ulMatch = line.match(/^[-*+]\s/);
  let newLine: string;
  if (ulMatch) {
    newLine = line.slice(ulMatch[0].length);
  } else {
    // Remove ordered list marker if present
    const olMatch = line.match(/^\d+\.\s/);
    const content = olMatch ? line.slice(olMatch[0].length) : line;
    newLine = "- " + content;
  }

  const newDoc = doc.slice(0, lineStart) + newLine + doc.slice(lineEnd);
  editor.setDocument(newDoc);
  editor.setSelection(lineStart + newLine.length);
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

  if (from === to) {
    const openMarker = `${COLOR_MARKER_PREFIX}${color}${COLOR_MARKER_SUFFIX}`;

    const openMarkerPattern = /\[\[nexus-color:([^\]]+)\]\]/g;
    let activeOpenMarkerIndex = -1;
    let activeOpenMarkerText = "";
    let match: RegExpExecArray | null;

    while ((match = openMarkerPattern.exec(doc)) !== null) {
      if (match.index >= from) break;
      activeOpenMarkerIndex = match.index;
      activeOpenMarkerText = match[0];
    }

    const closeMarkerIndex = doc.indexOf(COLOR_CLOSE_MARKER, from);
    if (
      activeOpenMarkerIndex >= 0 &&
      activeOpenMarkerText.length > 0 &&
      closeMarkerIndex !== -1 &&
      closeMarkerIndex >= from
    ) {
      const replacementStart = activeOpenMarkerIndex;
      const replacementEnd = replacementStart + activeOpenMarkerText.length;
      const newDoc = doc.slice(0, replacementStart) + openMarker + doc.slice(replacementEnd);
      editor.setDocument(newDoc);
      const delta = openMarker.length - activeOpenMarkerText.length;
      editor.setSelection(from + delta, from + delta);
      return true;
    }

    const newDoc = doc.slice(0, from) + openMarker + COLOR_CLOSE_MARKER + doc.slice(to);
    editor.setDocument(newDoc);
    editor.setSelection(from + openMarker.length, from + openMarker.length);
    return true;
  }

  const openMarker = `${COLOR_MARKER_PREFIX}${color}${COLOR_MARKER_SUFFIX}`;
  const wrapped = wrapWithMarker(selected, openMarker, COLOR_CLOSE_MARKER);
  const newDoc = doc.slice(0, from) + wrapped + doc.slice(to);
  editor.setDocument(newDoc);
  const innerStart = from + openMarker.length;
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

  const openMarker = `${HIGHLIGHT_MARKER_PREFIX}${color}${HIGHLIGHT_MARKER_SUFFIX}`;
  const wrapped = wrapWithMarker(selected, openMarker, HIGHLIGHT_CLOSE_MARKER);
  const newDoc = doc.slice(0, from) + wrapped + doc.slice(to);
  editor.setDocument(newDoc);
  const innerStart = from + openMarker.length;
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
