/**
 * Auto-pair extension for Markdown syntax markers.
 * When the user types **, *, ~~, or ` with a selection, it wraps the selection.
 * When typed without selection, it inserts a matching pair and places the cursor between.
 *
 * Multi-cursor aware: wrapping / pair insertion applies to every selection
 * range in one dispatch, with the double-marker preceding-character check
 * evaluated per range — secondary cursors never lose the typed character.
 */
import { EditorSelection, type Extension } from "@codemirror/state";
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
  return EditorView.inputHandler.of((view, _from, _to, text) => {
    if (view.composing || view.compositionStarted) return false;

    const { state } = view;

    // --- Single-char pairs (backtick) ---
    for (const pair of PAIRS) {
      if (text !== pair.trigger) continue;

      view.dispatch(
        state.changeByRange((range) => {
          if (!range.empty) {
            // Wrap selection
            const selected = state.sliceDoc(range.from, range.to);
            return {
              changes: { from: range.from, to: range.to, insert: pair.open + selected + pair.close },
              range: EditorSelection.range(
                range.from + pair.open.length,
                range.from + pair.open.length + selected.length
              ),
            };
          }

          // Insert pair and place cursor between
          return {
            changes: { from: range.from, insert: pair.open + pair.close },
            range: EditorSelection.cursor(range.from + pair.open.length),
          };
        })
      );
      return true;
    }

    // --- Double-char pairs (**, ~~) ---
    for (const pair of DOUBLE_PAIRS) {
      if (text !== pair.char) continue;

      // Only step in when some cursor just completed a double marker
      // (the previous keystroke left `pair.char` right before the range).
      const charBeforeMatches = (from: number): boolean =>
        from > 0 && state.sliceDoc(from - 1, from) === pair.char;
      if (!state.selection.ranges.some((range) => charBeforeMatches(range.from))) continue;

      view.dispatch(
        state.changeByRange((range) => {
          if (!charBeforeMatches(range.from)) {
            // This cursor is not completing a double marker — plain insert.
            return {
              changes: { from: range.from, to: range.to, insert: text },
              range: EditorSelection.cursor(range.from + text.length),
            };
          }

          if (!range.empty) {
            // Selection active: remove the already-typed first char, wrap the selection
            const selected = state.sliceDoc(range.from, range.to);
            return {
              changes: [
                { from: range.from - 1, to: range.from, insert: "" },
                { from: range.from, to: range.to, insert: pair.open + selected + pair.close },
              ],
              range: EditorSelection.range(
                range.from - 1 + pair.open.length,
                range.from - 1 + pair.open.length + selected.length
              ),
            };
          }

          // No selection: the first char is already in the doc at from-1, we're
          // adding the second. Result: **|** with the cursor in the middle.
          return {
            changes: { from: range.from, insert: pair.char + pair.close },
            range: EditorSelection.cursor(range.from + 1),
          };
        })
      );
      return true;
    }

    return false;
  });
}
