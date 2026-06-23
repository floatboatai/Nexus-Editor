import {
  EditorSelection,
  Prec,
  findClusterBreak,
  type EditorState,
  type Extension,
  type SelectionRange,
} from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

const LIST_RE = /^(\s*)([-*+]|\d+[.)]) /;
const CHECKBOX_RE = /^\[([ xX])\] /;
const BLOCKQUOTE_RE = /^(\s*(?:> ?)+)/;
const LIST_INDENT = "  ";

type IndentDirection = "indent" | "outdent";

interface ParsedListLine {
  quotePrefix: string;
  indent: string;
  markerPrefix: string;
  contentOffset: number;
}

interface Continuation {
  prefix: string;
  content: string;
  exitOffset: number;
}

/** Split a line into quote/list parts while preserving nested quote markers. */
function parseListLine(text: string): ParsedListLine | null {
  const quoteMatch = BLOCKQUOTE_RE.exec(text);
  const quotePrefix = quoteMatch?.[1] ?? "";
  const content = text.slice(quotePrefix.length);
  const listMatch = LIST_RE.exec(content);
  if (!listMatch) return null;

  const afterMarker = content.slice(listMatch[0].length);
  const checkboxPrefix = CHECKBOX_RE.exec(afterMarker)?.[0] ?? "";
  return {
    quotePrefix,
    indent: listMatch[1],
    markerPrefix: listMatch[0] + checkboxPrefix,
    contentOffset: quotePrefix.length + listMatch[0].length + checkboxPrefix.length,
  };
}

/** The markdown continuation prefix for the line, or null when the line is plain text. */
function continuationFor(text: string): Continuation | null {
  const quoteMatch = BLOCKQUOTE_RE.exec(text);
  const quotePrefix = quoteMatch?.[1] ?? "";
  const content = text.slice(quotePrefix.length);
  const listMatch = LIST_RE.exec(content);

  if (listMatch) {
    const indent = listMatch[1];
    const marker = listMatch[2];
    const afterMarker = content.slice(listMatch[0].length);
    const cbMatch = CHECKBOX_RE.exec(afterMarker);
    const itemContent = cbMatch ? afterMarker.slice(cbMatch[0].length) : afterMarker;

    let nextMarker = marker;
    const numMatch = marker.match(/^(\d+)([.)])/);
    if (numMatch) {
      nextMarker = `${parseInt(numMatch[1]) + 1}${numMatch[2]}`;
    }

    const listPrefix = cbMatch
      ? `${indent}${nextMarker} [ ] `
      : `${indent}${nextMarker} `;
    return {
      prefix: quotePrefix + listPrefix,
      content: itemContent,
      exitOffset: quotePrefix.length,
    };
  }

  return quotePrefix
    ? { prefix: quotePrefix, content, exitOffset: 0 }
    : null;
}

function isContinuable(state: EditorState, range: SelectionRange): boolean {
  return range.empty && continuationFor(state.doc.lineAt(range.head).text) !== null;
}

/**
 * Handle Enter key for markdown auto-continuation. Returns true if handled.
 *
 * Multi-cursor aware: when at least one cursor sits on a list / blockquote
 * line, every selection range is processed in one dispatch (one undo step) —
 * continuation or empty-item exit on continuable lines, a plain newline
 * elsewhere. When no cursor is on a continuable line the handler defers to
 * the default Enter behaviour.
 */
export function handleMarkdownEnter(view: EditorView): boolean {
  const { state } = view;
  if (!state.selection.ranges.some((range) => isContinuable(state, range))) return false;

  const exitedLines = new Set<number>();
  view.dispatch(
    state.changeByRange((range) => {
      if (!range.empty) {
        return {
          changes: { from: range.from, to: range.to, insert: "\n" },
          range: EditorSelection.cursor(range.from + 1),
        };
      }

      const line = state.doc.lineAt(range.head);
      const continuation = continuationFor(line.text);
      if (!continuation) {
        return {
          changes: { from: range.head, insert: "\n" },
          range: EditorSelection.cursor(range.head + 1),
        };
      }

      if (!continuation.content.trim()) {
        if (exitedLines.has(line.from)) return { range };
        exitedLines.add(line.from);
        const from = line.from + continuation.exitOffset;
        return {
          changes: { from, to: line.to, insert: "" },
          range: EditorSelection.cursor(from),
        };
      }

      return {
        changes: { from: range.head, insert: "\n" + continuation.prefix },
        range: EditorSelection.cursor(range.head + 1 + continuation.prefix.length),
      };
    })
  );
  return true;
}

/** Indent or outdent every selected Markdown list line in one transaction. */
export function handleMarkdownListIndent(
  view: EditorView,
  direction: IndentDirection
): boolean {
  const { state } = view;
  const changes: Array<{ from: number; to?: number; insert: string }> = [];
  const changedLines = new Set<number>();

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from);
    const selectionEnd = range.empty ? range.to : Math.max(range.from, range.to - 1);
    const toLine = state.doc.lineAt(selectionEnd);

    for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber++) {
      const line = state.doc.line(lineNumber);
      if (changedLines.has(line.from)) continue;

      const parsed = parseListLine(line.text);
      if (!parsed) continue;
      const indentFrom = line.from + parsed.quotePrefix.length;

      if (direction === "indent") {
        changes.push({ from: indentFrom, insert: LIST_INDENT });
        changedLines.add(line.from);
      } else if (parsed.indent) {
        const removeLength = Math.min(LIST_INDENT.length, parsed.indent.length);
        changes.push({ from: indentFrom, to: indentFrom + removeLength, insert: "" });
        changedLines.add(line.from);
      }
    }
  }

  if (changes.length === 0) return false;
  changes.sort((a, b) => a.from - b.from);
  view.dispatch({ changes });
  return true;
}

function listBackspaceChange(
  state: EditorState,
  range: SelectionRange
): { from: number; to: number; cursor: number } | null {
  if (!range.empty) return null;

  const line = state.doc.lineAt(range.head);
  const parsed = parseListLine(line.text);
  if (!parsed || range.head !== line.from + parsed.contentOffset) return null;

  const indentFrom = line.from + parsed.quotePrefix.length;
  if (parsed.indent) {
    const removeLength = Math.min(LIST_INDENT.length, parsed.indent.length);
    return {
      from: indentFrom,
      to: indentFrom + removeLength,
      cursor: range.head - removeLength,
    };
  }

  return {
    from: indentFrom,
    to: indentFrom + parsed.markerPrefix.length,
    cursor: indentFrom,
  };
}

/**
 * Normalize list prefixes on Backspace while preserving multi-cursor edits.
 * Unhandled ranges receive normal single-character Backspace behavior when
 * another cursor triggers list-boundary handling.
 */
export function handleMarkdownListBackspace(view: EditorView): boolean {
  const { state } = view;
  if (!state.selection.ranges.some((range) => listBackspaceChange(state, range))) return false;

  view.dispatch(
    state.changeByRange((range) => {
      const listChange = listBackspaceChange(state, range);
      if (listChange) {
        return {
          changes: { from: listChange.from, to: listChange.to, insert: "" },
          range: EditorSelection.cursor(listChange.cursor),
        };
      }

      if (!range.empty) {
        return {
          changes: { from: range.from, to: range.to, insert: "" },
          range: EditorSelection.cursor(range.from),
        };
      }
      if (range.head === 0) return { range };

      const line = state.doc.lineAt(range.head);
      const from = range.head === line.from
        ? range.head - 1
        : line.from + findClusterBreak(line.text, range.head - line.from, false);
      return {
        changes: { from, to: range.head, insert: "" },
        range: EditorSelection.cursor(from),
      };
    })
  );
  return true;
}

export function markdownKeymap(): Extension {
  return Prec.high(keymap.of([
    { key: "Enter", run: handleMarkdownEnter },
    { key: "Backspace", run: handleMarkdownListBackspace },
    { key: "Tab", run: (view) => handleMarkdownListIndent(view, "indent") },
    { key: "Shift-Tab", run: (view) => handleMarkdownListIndent(view, "outdent") },
  ]));
}
