/**
 * Auto-pair extension for Markdown syntax markers.
 * When the user types **, *, ~~, or ` with a selection, it wraps the selection.
 * When typed without selection, it inserts a matching pair and places the cursor between.
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const PAIRS: Array<{ trigger: string; open: string; close: string }> = [
  { trigger: "`", open: "`", close: "`" },
];

// Multi-char markers that auto-pair when the second char is typed
const DOUBLE_PAIRS: Array<{ char: string; open: string; close: string }> = [
  { char: "*", open: "**", close: "**" },
  { char: "~", open: "~~", close: "~~" },
];

export function markdownAutoPair(): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (view.composing || view.compositionStarted) return false;

    const sel = view.state.selection.main;

    // --- Single-char pairs (backtick) ---
    for (const pair of PAIRS) {
      if (text !== pair.trigger) continue;

      if (sel.from !== sel.to) {
        // Wrap selection
        const selected = view.state.sliceDoc(sel.from, sel.to);
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: pair.open + selected + pair.close },
          selection: {
            anchor: sel.from + pair.open.length,
            head: sel.from + pair.open.length + selected.length,
          },
        });
        return true;
      }

      // Insert pair and place cursor between
      view.dispatch({
        changes: { from, to, insert: pair.open + pair.close },
        selection: { anchor: from + pair.open.length },
      });
      return true;
    }

    // --- Double-char pairs (**, ~~) ---
    for (const pair of DOUBLE_PAIRS) {
      if (text !== pair.char) continue;

      // Check if the char before cursor is the same char (forming a double)
      const charBefore = from > 0 ? view.state.sliceDoc(from - 1, from) : "";
      if (charBefore !== pair.char) continue;

      if (sel.from !== sel.to) {
        // Selection active: wrap selection with the double marker
        // Remove the first char we already typed, wrap selection
        view.dispatch({
          changes: [
            { from: from - 1, to: from, insert: "" }, // remove the first char
            {
              from: sel.from,
              to: sel.to,
              insert: pair.open + view.state.sliceDoc(sel.from, sel.to) + pair.close,
            },
          ],
        });
        return true;
      }

      // No selection: insert closing pair after the opening
      // The first char is already in the doc at from-1. We're adding the second char.
      // Result: **|** with cursor in the middle.
      view.dispatch({
        changes: { from, to, insert: pair.char + pair.close },
        selection: { anchor: from + 1 },
      });
      return true;
    }

    return false;
  });
}
