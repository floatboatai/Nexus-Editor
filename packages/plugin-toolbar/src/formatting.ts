import type { EditorAPI } from "@floatboat/nexus-core";
export function getSelectionLineRange(
  doc: string,
  anchor: number,
  head: number,
): {
  rangeStart: number;
  rangeEnd: number;
  lines: string[];
  lineStarts: number[];
} {
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  const rangeStart = doc.lastIndexOf("\n", from - 1) + 1;
  const nl = doc.indexOf("\n", to);
  const rangeEnd = nl === -1 ? doc.length : nl;

  const lines: string[] = [];
  const lineStarts: number[] = [];
  let pos = rangeStart;
  let remaining = doc.slice(rangeStart, rangeEnd);

  while (true) {
    const nlIdx = remaining.indexOf("\n");
    if (nlIdx === -1) {
      lines.push(remaining);
      lineStarts.push(pos);
      break;
    }
    lines.push(remaining.slice(0, nlIdx));
    lineStarts.push(pos);
    pos += nlIdx + 1;
    remaining = remaining.slice(nlIdx + 1);
  }

  return { rangeStart, rangeEnd, lines, lineStarts };
}

export const OL_RE = /^(\s*)(\d+[.)]\s)/;
export const UL_RE = /^(\s*)([-*+]\s)/;

function isOrderedListItem(line: string): boolean {
  return OL_RE.test(line);
}

function isUnorderedListItem(line: string): boolean {
  return UL_RE.test(line);
}

function removeListMarker(line: string): string {
  const olMatch = line.match(OL_RE);
  if (olMatch)
    return olMatch[1] + line.slice(olMatch[1].length + olMatch[2].length);
  const ulMatch = line.match(UL_RE);
  if (ulMatch)
    return ulMatch[1] + line.slice(ulMatch[1].length + ulMatch[2].length);
  return line;
}

function makeOrderedListItem(line: string): string {
  const olMatch = line.match(OL_RE);
  if (olMatch) return line;
  const ulMatch = line.match(UL_RE);
  if (ulMatch)
    return (
      ulMatch[1] + "1. " + line.slice(ulMatch[1].length + ulMatch[2].length)
    );
  return "1. " + line;
}

function makeUnorderedListItem(line: string): string {
  const ulMatch = line.match(UL_RE);
  if (ulMatch) return line;
  const olMatch = line.match(OL_RE);
  if (olMatch)
    return (
      olMatch[1] + "- " + line.slice(olMatch[1].length + olMatch[2].length)
    );
  return "- " + line;
}

export function extractLineContent(
  line: string,
  marker: string,
): { prefix: string; content: string } {
  const olMatch = line.match(OL_RE);
  if (olMatch) {
    const prefix = olMatch[1] + olMatch[2];
    return { prefix, content: line.slice(prefix.length) };
  }
  const ulMatch = line.match(UL_RE);
  if (ulMatch) {
    const prefix = ulMatch[1] + ulMatch[2];
    return { prefix, content: line.slice(prefix.length) };
  }
  return { prefix: "", content: line };
}

export function isLineWrapped(content: string, marker: string): boolean {
  if (content.length < 2 * marker.length) return false;
  if (!content.startsWith(marker) || !content.endsWith(marker)) return false;
  if (marker.length === 1 && content.length > 2) {
    const afterOpen = content[marker.length];
    const beforeClose = content[content.length - marker.length - 1];
    if (afterOpen === marker || beforeClose === marker) return false;
  }
  return true;
}

export function unwrapLine(content: string, marker: string): string {
  return content.slice(marker.length, content.length - marker.length);
}

export function stripAllMarkers(content: string, marker: string): string {
  if (marker.length === 1) {
    const double = marker + marker;
    if (!content.includes(double)) {
      return content.split(marker).join("");
    }
    const parts = content.split(double);
    for (let i = 0; i < parts.length; i++) {
      parts[i] = parts[i].split(marker).join("");
    }
    return parts.join(double);
  }
  return content.split(marker).join("");
}

export function countStarsLeft(doc: string, pos: number): number {
  let count = 0;
  while (pos - count - 1 >= 0 && doc[pos - count - 1] === "*") {
    count++;
  }
  return count;
}

export function countStarsRight(doc: string, pos: number): number {
  let count = 0;
  while (pos + count < doc.length && doc[pos + count] === "*") {
    count++;
  }
  return count;
}

export function toggleBlockquote(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const prefix = "> ";
  const selected = doc.slice(Math.min(anchor, head), Math.max(anchor, head));

  if (selected.includes("\n")) {
    const { rangeStart, rangeEnd, lines } = getSelectionLineRange(
      doc,
      anchor,
      head,
    );
    const nonEmpty = lines.filter((l) => l.trim() !== "");
    const allQuoted =
      nonEmpty.length > 0 &&
      nonEmpty.every((l) => l.startsWith(prefix) && l.length > prefix.length);

    const newLines = lines.map((line) => {
      if (line.trim() === "") return line;
      if (allQuoted) return line.slice(prefix.length);
      return prefix + line;
    });

    const newDoc =
      doc.slice(0, rangeStart) + newLines.join("\n") + doc.slice(rangeEnd);
    editor.setDocument(newDoc);
    let cursorOffset = 0;
    for (let i = 0; i < newLines.length - 1; i++) {
      cursorOffset += newLines[i].length + 1;
    }
    cursorOffset += newLines[newLines.length - 1].length;
    editor.setSelection(rangeStart + cursorOffset);
    return true;
  }

  const lineStart = doc.lastIndexOf("\n", anchor - 1) + 1;
  const lineEndIdx = doc.indexOf("\n", anchor);
  const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
  const line = doc.slice(lineStart, lineEnd);

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

export function toggleOrderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const { rangeStart, rangeEnd, lines } = getSelectionLineRange(
    doc,
    anchor,
    head,
  );

  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const allOl = nonEmpty.length > 0 && nonEmpty.every(isOrderedListItem);

  const newLines: string[] = [];

  for (const line of lines) {
    if (line.trim() === "") {
      newLines.push(line);
    } else if (allOl) {
      newLines.push(removeListMarker(line));
    } else {
      newLines.push(makeOrderedListItem(line));
    }
  }

  let cursorOffset = 0;
  for (let i = 0; i < newLines.length - 1; i++) {
    cursorOffset += newLines[i].length + 1;
  }
  cursorOffset += newLines[newLines.length - 1].length;

  const newRangeText = newLines.join("\n");
  const newDoc = doc.slice(0, rangeStart) + newRangeText + doc.slice(rangeEnd);
  editor.setDocument(newDoc);
  editor.setSelection(rangeStart + cursorOffset);
  return true;
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const { rangeStart, rangeEnd, lines } = getSelectionLineRange(
    doc,
    anchor,
    head,
  );

  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const allUl = nonEmpty.length > 0 && nonEmpty.every(isUnorderedListItem);

  const newLines: string[] = [];

  for (const line of lines) {
    if (line.trim() === "") {
      newLines.push(line);
    } else if (allUl) {
      newLines.push(removeListMarker(line));
    } else {
      newLines.push(makeUnorderedListItem(line));
    }
  }

  let cursorOffset = 0;
  for (let i = 0; i < newLines.length - 1; i++) {
    cursorOffset += newLines[i].length + 1;
  }
  cursorOffset += newLines[newLines.length - 1].length;

  const newRangeText = newLines.join("\n");
  const newDoc = doc.slice(0, rangeStart) + newRangeText + doc.slice(rangeEnd);
  editor.setDocument(newDoc);
  editor.setSelection(rangeStart + cursorOffset);
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
    "```\n" +
    (selected || "") +
    "\n```" +
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
  return applyInlineHtml(editor, `<span style="color:${color}">`, "</span>");
}

export function applyHighlight(editor: EditorAPI, color: string): boolean {
  return applyInlineHtml(
    editor,
    `<mark style="background:${color}">`,
    "</mark>",
  );
}

function applyInlineHtml(
  editor: EditorAPI,
  open: string,
  close: string,
): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const selected = doc.slice(from, to);

  if (from === to) return false;

  if (selected.includes("\n")) {
    const { rangeStart, rangeEnd, lines, lineStarts } = getSelectionLineRange(
      doc,
      anchor,
      head,
    );

    const newLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lStart = lineStarts[i];

      if (line.trim() === "") {
        newLines.push(line);
        continue;
      }

      const { prefix } = extractLineContent(line, "");
      const prefixLen = prefix.length;
      const content = line.slice(prefixLen);

      let selContentStart = 0;
      let selContentEnd = content.length;

      if (i === 0) {
        selContentStart = Math.max(from - lStart - prefixLen, 0);
      }
      if (i === lines.length - 1) {
        const lineEnd = lStart + line.length;
        if (to >= lineEnd) {
          selContentEnd = content.length;
        } else {
          selContentEnd = Math.min(to - lStart - prefixLen, content.length);
        }
      }

      if (selContentStart >= selContentEnd) {
        newLines.push(line);
        continue;
      }

      const beforeContent = content.slice(0, selContentStart);
      const selContent = content.slice(selContentStart, selContentEnd);
      const afterContent = content.slice(selContentEnd);

      newLines.push(
        prefix + beforeContent + open + selContent + close + afterContent,
      );
    }

    const newDoc =
      doc.slice(0, rangeStart) + newLines.join("\n") + doc.slice(rangeEnd);
    editor.setDocument(newDoc);
    let cursorOffset = 0;
    for (let i = 0; i < newLines.length - 1; i++) {
      cursorOffset += newLines[i].length + 1;
    }
    cursorOffset += newLines[newLines.length - 1].length;
    editor.setSelection(rangeStart + cursorOffset);
    return true;
  }

  const wrapped = open + selected + close;
  const newDoc = doc.slice(0, from) + wrapped + doc.slice(to);
  editor.setDocument(newDoc);
  const innerStart = from + open.length;
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
