import { EditorSelection, Prec, type EditorState, type Extension, type SelectionRange } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

const LIST_RE = /^(\s*)([-*+]|\d+[.)]) /;
const CHECKBOX_RE = /^\[([ xX])\] /;
const BLOCKQUOTE_PREFIX_RE = /^(\s*(?:> ?)+)/;

type Continuation = {
  prefix: string;
  content: string;
  emptyItemReplacement: string;
};

/** The markdown continuation prefix for the line, or null when the line is plain text. */
function continuationFor(text: string): Continuation | null {
  const quoteMatch = BLOCKQUOTE_PREFIX_RE.exec(text);
  const quotePrefix = quoteMatch?.[1] ?? "";
  const body = text.slice(quotePrefix.length);
  const listMatch = LIST_RE.exec(body);
  if (listMatch) {
    const indent = listMatch[1];
    const marker = listMatch[2];
    const afterMarker = body.slice(listMatch[0].length);

    const cbMatch = CHECKBOX_RE.exec(afterMarker);
    const content = cbMatch ? afterMarker.slice(cbMatch[0].length) : afterMarker;

    // Increment ordered-list numbers
    let nextMarker = marker;
    const numMatch = marker.match(/^(\d+)([.)])/);
    if (numMatch) {
      nextMarker = `${parseInt(numMatch[1]) + 1}${numMatch[2]}`;
    }

    const listPrefix = cbMatch ? `${indent}${nextMarker} [ ] ` : `${indent}${nextMarker} `;
    return { prefix: quotePrefix + listPrefix, content, emptyItemReplacement: quotePrefix };
  }

  if (quoteMatch) {
    return { prefix: quotePrefix, content: body, emptyItemReplacement: "" };
  }

  return null;
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

  // Lines already emptied by an "exit list/quote" range: a second cursor on
  // the same line must become a no-op — its deletion would overlap the first.
  const exitedLines = new Set<number>();

  view.dispatch(
    state.changeByRange((range) => {
      if (!range.empty) {
        // Default Enter semantics for a non-empty range: replace it with a newline.
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

      // Empty item → exit the list / blockquote by clearing the line.
      if (!continuation.content.trim()) {
        if (exitedLines.has(line.from)) {
          return { range };
        }
        exitedLines.add(line.from);
        return {
          changes: { from: line.from, to: line.to, insert: continuation.emptyItemReplacement },
          range: EditorSelection.cursor(line.from + continuation.emptyItemReplacement.length),
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

export function markdownKeymap(): Extension {
  return Prec.high(keymap.of([{ key: "Enter", run: handleMarkdownEnter }]));
}
