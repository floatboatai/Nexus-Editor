import {
  EditorSelection,
  Prec,
  type EditorState,
  type Extension,
  type SelectionRange,
} from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

const LIST_RE = /^(\s*)([-*+]|\d+[.)]) /;
const CHECKBOX_RE = /^\[([ xX])\] /;
const BLOCKQUOTE_RE = /^(\s*>+ ?)/;

const TASK_ITEM_RE = /^(\s*(?:[-*+]|\d+[.)]))\s+\[([ xX])\](?:\s*)/;
const LIST_ITEM_RE = /^(\s*(?:[-*+]|\d+[.)]))\s+/;
const INDENT_RE = /^(\s*)/;

/** The markdown continuation prefix for the line, or null when the line is plain text. */
function continuationFor(
  text: string,
): { prefix: string; content: string } | null {
  const listMatch = LIST_RE.exec(text);
  if (listMatch) {
    const indent = listMatch[1];
    const marker = listMatch[2];
    const afterMarker = text.slice(listMatch[0].length);

    const cbMatch = CHECKBOX_RE.exec(afterMarker);
    const content = cbMatch
      ? afterMarker.slice(cbMatch[0].length)
      : afterMarker;

    // Increment ordered-list numbers
    let nextMarker = marker;
    const numMatch = marker.match(/^(\d+)([.)])/);
    if (numMatch) {
      nextMarker = `${parseInt(numMatch[1]) + 1}${numMatch[2]}`;
    }

    const prefix = cbMatch
      ? `${indent}${nextMarker} [ ] `
      : `${indent}${nextMarker} `;
    return { prefix, content };
  }

  const quoteMatch = BLOCKQUOTE_RE.exec(text);
  if (quoteMatch) {
    const prefix = quoteMatch[1];
    return { prefix, content: text.slice(prefix.length) };
  }

  return null;
}

function isContinuable(state: EditorState, range: SelectionRange): boolean {
  return (
    range.empty && continuationFor(state.doc.lineAt(range.head).text) !== null
  );
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
  if (!state.selection.ranges.some((range) => isContinuable(state, range)))
    return false;

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
          changes: { from: line.from, to: line.to, insert: "" },
          range: EditorSelection.cursor(line.from),
        };
      }

      return {
        changes: { from: range.head, insert: "\n" + continuation.prefix },
        range: EditorSelection.cursor(
          range.head + 1 + continuation.prefix.length,
        ),
      };
    }),
  );
  return true;
}

/**
 * Toggle task item checkbox status `[ ]` <-> `[x]` on current line or selection.
 * If current line is a plain list item or text, converts it to `- [ ] ...`.
 * Single dispatch ensures atomic undo/redo history.
 */
export function handleToggleTaskItem(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;

  const processedLines = new Set<number>();
  let hasChanges = false;

  const tr = state.changeByRange((range) => {
    if (range.empty) {
      const line = state.doc.lineAt(range.head);
      if (processedLines.has(line.from)) {
        return { range };
      }
      processedLines.add(line.from);

      const taskMatch = TASK_ITEM_RE.exec(line.text);
      if (taskMatch) {
        const isChecked = taskMatch[2] !== " ";
        const newChar = isChecked ? " " : "x";
        const bracketPos = line.text.indexOf("[");
        const charPos = line.from + bracketPos + 1;
        hasChanges = true;
        return {
          changes: { from: charPos, to: charPos + 1, insert: newChar },
          range: EditorSelection.cursor(range.head),
        };
      }

      const listMatch = LIST_ITEM_RE.exec(line.text);
      if (listMatch) {
        const insertPos = line.from + listMatch[0].length;
        hasChanges = true;
        const insertText = "[ ] ";
        const newHead =
          range.head >= insertPos ? range.head + insertText.length : range.head;
        return {
          changes: { from: insertPos, insert: insertText },
          range: EditorSelection.cursor(newHead),
        };
      }

      const indentMatch = INDENT_RE.exec(line.text);
      const indent = indentMatch ? indentMatch[1] : "";
      const insertPos = line.from + indent.length;
      const insertText = "- [ ] ";
      hasChanges = true;
      const newHead =
        range.head >= insertPos ? range.head + insertText.length : range.head;
      return {
        changes: { from: insertPos, insert: insertText },
        range: EditorSelection.cursor(newHead),
      };
    }

    const fromLine = state.doc.lineAt(range.from);
    const toLine = state.doc.lineAt(range.to);
    const changes: { from: number; to?: number; insert: string }[] = [];
    let delta = 0;

    for (let pos = fromLine.from; pos <= toLine.from;) {
      const line = state.doc.lineAt(pos);
      if (!processedLines.has(line.from)) {
        processedLines.add(line.from);

        const taskMatch = TASK_ITEM_RE.exec(line.text);
        if (taskMatch) {
          const isChecked = taskMatch[2] !== " ";
          const newChar = isChecked ? " " : "x";
          const bracketPos = line.text.indexOf("[");
          const charPos = line.from + bracketPos + 1;
          changes.push({ from: charPos, to: charPos + 1, insert: newChar });
        } else {
          const listMatch = LIST_ITEM_RE.exec(line.text);
          if (listMatch) {
            const insertPos = line.from + listMatch[0].length;
            changes.push({ from: insertPos, insert: "[ ] " });
            delta += 4;
          } else {
            const indentMatch = INDENT_RE.exec(line.text);
            const indent = indentMatch ? indentMatch[1] : "";
            const insertPos = line.from + indent.length;
            changes.push({ from: insertPos, insert: "- [ ] " });
            delta += 6;
          }
        }
      }

      if (line.to >= state.doc.length) break;
      pos = line.to + 1;
    }

    if (changes.length > 0) {
      hasChanges = true;
    }

    return {
      changes,
      range: EditorSelection.range(range.from, range.to + delta),
    };
  });

  if (!hasChanges) return false;
  view.dispatch(tr);
  return true;
}

export function markdownKeymap(): Extension {
  return Prec.high(
    keymap.of([
      { key: "Enter", run: handleMarkdownEnter },
      { key: "Mod-Enter", run: handleToggleTaskItem },
      { key: "Alt-Enter", run: handleToggleTaskItem },
    ]),
  );
}
