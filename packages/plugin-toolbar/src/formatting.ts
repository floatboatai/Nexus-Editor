import type { EditorAPI } from "@floatboat/nexus-core";

interface LineInfo {
  text: string;
  indent: string;
  content: string;
  isEmpty: boolean;
}

/** Expand a character-range selection to cover full lines. */
function getSelectedLines(
  doc: string,
  anchor: number,
  head: number
): { rangeStart: number; rangeEnd: number; lines: LineInfo[] } {
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);

  const rangeStart = doc.lastIndexOf("\n", from - 1) + 1;
  const rangeEndIdx = doc.indexOf("\n", to);
  const rangeEnd = rangeEndIdx === -1 ? doc.length : rangeEndIdx;

  const rangeText = doc.slice(rangeStart, rangeEnd);
  const lines: LineInfo[] = [];

  for (const raw of rangeText.split("\n")) {
    const indent = raw.match(/^\s*/)?.[0] ?? "";
    const content = raw.slice(indent.length);
    lines.push({
      text: raw,
      indent,
      content,
      isEmpty: raw.trim() === "",
    });
  }

  return { rangeStart, rangeEnd, lines };
}

function toggleMultiLine(
  editor: EditorAPI,
  prefix: string,
  matchPattern: RegExp,
  opts?: { orderedNumbering?: boolean }
): boolean {
  const doc = editor.getDocument();
  const { anchor, head } = editor.getSelection();
  const { rangeStart, rangeEnd, lines } = getSelectedLines(doc, anchor, head);

  const nonEmpty = lines.filter((l) => !l.isEmpty);
  if (nonEmpty.length === 0) return false;

  const allHave = nonEmpty.every((l) => matchPattern.test(l.content));

  let num = 1;
  const newLines = lines.map((line) => {
    if (line.isEmpty) return line.text;

    if (allHave) {
      return line.indent + line.content.replace(matchPattern, "");
    }

    // Strip any existing list marker (ordered or unordered) before adding
    const stripped = line.content
      .replace(matchPattern, "")
      .replace(/^\d+\.\s/, "")
      .replace(/^[-*+]\s/, "");
    const marker = opts?.orderedNumbering ? `${num++}. ` : prefix;
    return line.indent + marker + stripped;
  });

  const newRangeText = newLines.join("\n");
  const newDoc =
    doc.slice(0, rangeStart) + newRangeText + doc.slice(rangeEnd);
  editor.setDocument(newDoc);

  const newRangeEnd = rangeStart + newRangeText.length;
  editor.setSelection(rangeStart, newRangeEnd);
  return true;
}

export function toggleBlockquote(editor: EditorAPI): boolean {
  return toggleMultiLine(editor, "> ", /^>\s?/);
}

export function toggleOrderedList(editor: EditorAPI): boolean {
  return toggleMultiLine(editor, "1. ", /^\d+\.\s/, {
    orderedNumbering: true,
  });
}

export function toggleUnorderedList(editor: EditorAPI): boolean {
  return toggleMultiLine(editor, "- ", /^[-*+]\s/);
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
