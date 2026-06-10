/**
 * Multi-cursor / multi-selection support (ROADMAP #6).
 *
 * CodeMirror ships the state machinery (`allowMultipleSelections`) but the
 * editor never enables it, and secondary cursors are invisible without
 * `drawSelection`. This module bundles the enablement extensions with a
 * VS Code-flavoured command set. Commands are exported standalone so hosts
 * and plugins can rebind them; `multiCursorExtension()` is what
 * `createEditor({ multiCursor: true })` installs.
 */
import { EditorSelection, EditorState, type Extension, type SelectionRange } from "@codemirror/state";
import { drawSelection, EditorView, keymap, type Command, type KeyBinding } from "@codemirror/view";

function rangesToSelection(
  ranges: readonly SelectionRange[],
  added: SelectionRange
): EditorSelection {
  return EditorSelection.create([...ranges, added], ranges.length);
}

function isCovered(ranges: readonly SelectionRange[], from: number, to: number): boolean {
  return ranges.some((range) => range.from <= from && range.to >= to);
}

/**
 * Find the next occurrence of `query` that no selection range covers yet,
 * scanning forward from the end of the last range and wrapping around to the
 * document start. Returns null when every occurrence is already selected.
 */
function findNextOccurrence(
  state: EditorState,
  query: string
): { from: number; to: number } | null {
  const doc = state.doc.toString();
  const ranges = state.selection.ranges;
  const searchOrigin = ranges[ranges.length - 1].to;

  for (const start of [searchOrigin, 0]) {
    let index = doc.indexOf(query, start);
    while (index !== -1) {
      // Past the origin on the wrapped pass everything has been seen already.
      if (start === 0 && index >= searchOrigin) break;
      if (!isCovered(ranges, index, index + query.length)) {
        return { from: index, to: index + query.length };
      }
      index = doc.indexOf(query, index + 1);
    }
  }

  return null;
}

/**
 * VS Code-style `Mod-d`. With any empty range: expand every empty range to
 * the word under it (no new range is added on this invocation). With all
 * ranges non-empty: add the next occurrence of the main range's text as the
 * new main range. Matching is case-sensitive and not word-bounded.
 */
export const selectNextOccurrence: Command = (view) => {
  const { state } = view;
  const selection = state.selection;

  if (selection.ranges.some((range) => range.empty)) {
    let expanded = false;
    const ranges = selection.ranges.map((range) => {
      if (!range.empty) return range;
      const word = state.wordAt(range.head);
      if (!word) return range;
      expanded = true;
      return EditorSelection.range(word.from, word.to);
    });
    if (!expanded) return false;
    view.dispatch({
      selection: EditorSelection.create(ranges, selection.mainIndex),
      userEvent: "select",
    });
    return true;
  }

  const main = selection.main;
  const query = state.sliceDoc(main.from, main.to);
  if (!query) return false;

  const next = findNextOccurrence(state, query);
  if (!next) return false;

  view.dispatch({
    selection: rangesToSelection(selection.ranges, EditorSelection.range(next.from, next.to)),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

/**
 * Add an empty cursor on the previous (`forward = false`) or next logical
 * line, relative to the topmost / bottommost existing range. Logical lines —
 * not visual lines — so the command stays deterministic in headless
 * environments and independent of soft-wrap measurement.
 */
function addCursorVertically(view: EditorView, forward: boolean): boolean {
  const { state } = view;
  const selection = state.selection;
  const source = forward
    ? selection.ranges[selection.ranges.length - 1]
    : selection.ranges[0];

  const sourceLine = state.doc.lineAt(source.head);
  const targetNumber = sourceLine.number + (forward ? 1 : -1);
  if (targetNumber < 1 || targetNumber > state.doc.lines) return false;

  const targetLine = state.doc.line(targetNumber);
  const column = Math.min(source.head - sourceLine.from, targetLine.length);
  const pos = targetLine.from + column;
  if (selection.ranges.some((range) => range.empty && range.head === pos)) return false;

  view.dispatch({
    selection: rangesToSelection(selection.ranges, EditorSelection.cursor(pos)),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

export const addCursorAbove: Command = (view) => addCursorVertically(view, false);

export const addCursorBelow: Command = (view) => addCursorVertically(view, true);

/**
 * Drop secondary ranges, keep the main one. Returns false on a single-range
 * selection so other Escape bindings (slash menu, search panel) still fire.
 */
export const collapseToMainSelection: Command = (view) => {
  const selection = view.state.selection;
  if (selection.ranges.length <= 1) return false;
  view.dispatch({
    selection: EditorSelection.create([selection.main]),
    userEvent: "select",
  });
  return true;
};

export const multiCursorKeymap: readonly KeyBinding[] = [
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
  { key: "Mod-Alt-ArrowUp", run: addCursorAbove, preventDefault: true },
  { key: "Mod-Alt-ArrowDown", run: addCursorBelow, preventDefault: true },
  { key: "Escape", run: collapseToMainSelection },
];

// drawSelection replaces the native caret/selection layers, whose defaults
// are tuned for light backgrounds. Recolour through the theme variables so
// dark themes keep a visible caret and an accent-tinted selection.
const multiCursorTheme = EditorView.theme({
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--nexus-text)" },
  "&.cm-focused .cm-selectionBackground": {
    background: "var(--nexus-accent)",
    opacity: "0.25",
  },
});

/**
 * Everything `createEditor({ multiCursor: true })` installs: multiple
 * selection ranges, drawn cursors/selections, Alt-click to add a range
 * (explicit facet — VS Code / Obsidian convention), and the command keymap.
 */
export function multiCursorExtension(): Extension {
  return [
    EditorState.allowMultipleSelections.of(true),
    EditorView.clickAddsSelectionRange.of((event) => event.altKey),
    drawSelection(),
    multiCursorTheme,
    keymap.of([...multiCursorKeymap]),
  ];
}
