import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Prec, type EditorState, type Extension, type SelectionRange } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { backspaceListItem, dispatchListTransaction, indentListItem, outdentListItem } from "./markdown-list";

const LIST_RE = /^((?:[ \t]*>)*[ \t]*)([-*+]|\d+[.)]) /;
const CHECKBOX_RE = /^\[([ xX])\] /;
const BLOCKQUOTE_RE = /^(\s*>+ ?)/;
const CODE_NODE_NAMES = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock"]);

interface Continuation {
  /** Prefix for the next line: the incremented marker, an empty task box, or the quote marks. */
  prefix: string;
  content: string;
  /** Offset within the line where the item's content starts. */
  markerEnd: number;
  ordered: boolean;
}

/**
 * The markdown continuation prefix for the line, or null when the line is
 * plain text. A list item's indent includes any `> ` blockquote prefixes so
 * a list inside a quote continues as a quoted list.
 */
function continuationFor(text: string): Continuation | null {
  const listMatch = LIST_RE.exec(text);
  if (listMatch) {
    const indent = listMatch[1];
    const marker = listMatch[2];
    const afterMarker = text.slice(listMatch[0].length);

    const cbMatch = CHECKBOX_RE.exec(afterMarker);
    const content = cbMatch ? afterMarker.slice(cbMatch[0].length) : afterMarker;

    // Increment ordered-list numbers
    let nextMarker = marker;
    const numMatch = marker.match(/^(\d+)([.)])/);
    if (numMatch) {
      nextMarker = `${parseInt(numMatch[1]) + 1}${numMatch[2]}`;
    }

    const prefix = cbMatch ? `${indent}${nextMarker} [ ] ` : `${indent}${nextMarker} `;
    return {
      prefix,
      content,
      markerEnd: listMatch[0].length + (cbMatch ? cbMatch[0].length : 0),
      ordered: numMatch !== null,
    };
  }

  const quoteMatch = BLOCKQUOTE_RE.exec(text);
  if (quoteMatch) {
    const prefix = quoteMatch[1];
    return { prefix, content: text.slice(prefix.length), markerEnd: prefix.length, ordered: false };
  }

  return null;
}

/**
 * A line that merely looks like a list item inside a fenced or indented code
 * block must not be continued. Uses whatever tree is already parsed; an
 * unparsed region simply falls back to the text-based decision.
 */
function insideCode(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (CODE_NODE_NAMES.has(node.name)) return true;
  }
  return false;
}

function continuationAt(state: EditorState, range: SelectionRange): Continuation | null {
  if (!range.empty || insideCode(state, range.head)) return null;
  return continuationFor(state.doc.lineAt(range.head).text);
}

/**
 * Handle Enter key for markdown auto-continuation. Returns true if handled.
 *
 * Multi-cursor aware: when at least one cursor sits on a list / blockquote
 * line, every selection range is processed in one dispatch (one undo step) —
 * continuation or empty-item exit on continuable lines, a plain newline
 * elsewhere. When no cursor is on a continuable line the handler defers to
 * the default Enter behaviour.
 *
 * Ordered lists touched by the edit are renumbered in the same transaction,
 * so inserting or removing an item in the middle of `1. 2. 3.` never leaves
 * duplicate or skipped numbers behind.
 */
export function handleMarkdownEnter(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;

  if (!state.selection.ranges.some((range) => continuationAt(state, range))) return false;

  // Lines already emptied by an "exit list/quote" range: a second cursor on
  // the same line must become a no-op — its deletion would overlap the first.
  const exitedLines = new Set<number>();
  let ordered = false;

  const spec = state.changeByRange((range) => {
    if (!range.empty) {
      // Default Enter semantics for a non-empty range: replace it with a newline.
      return {
        changes: { from: range.from, to: range.to, insert: "\n" },
        range: EditorSelection.cursor(range.from + 1),
      };
    }

    const line = state.doc.lineAt(range.head);
    const continuation = continuationAt(state, range);

    if (!continuation) {
      return {
        changes: { from: range.head, insert: "\n" },
        range: EditorSelection.cursor(range.head + 1),
      };
    }
    ordered ||= continuation.ordered;

    // Empty item → exit the list / blockquote by clearing the line.
    if (!continuation.content.trim()) {
      if (exitedLines.has(line.from)) {
        return { range };
      }
      exitedLines.add(line.from);
      return {
        changes: { from: line.from, to: line.to, insert: "" },
        range: EditorSelection.cursor(line.from),
      };
    }

    // Cursor before the content: splitting the marker would leave garbage
    // like "2. 1. a", so push the whole item down one line instead.
    if (range.head < line.from + continuation.markerEnd) {
      return {
        changes: { from: line.from, insert: "\n" },
        range: EditorSelection.cursor(range.head + 1),
      };
    }

    return {
      changes: { from: range.head, insert: "\n" + continuation.prefix },
      range: EditorSelection.cursor(range.head + 1 + continuation.prefix.length),
    };
  });

  if (ordered) {
    dispatchListTransaction(view, spec);
  } else {
    view.dispatch({ ...spec, userEvent: "input", scrollIntoView: true });
  }
  return true;
}

export function markdownKeymap(): Extension {
  return Prec.high(
    keymap.of([
      { key: "Enter", run: handleMarkdownEnter },
      { key: "Tab", run: indentListItem, shift: outdentListItem },
      { key: "Backspace", run: backspaceListItem },
    ])
  );
}
