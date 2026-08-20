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
import { EditorSelection, EditorState, StateEffect, StateField, type Extension, type SelectionRange } from "@codemirror/state";
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
 * StateField storing positions that have been skipped via `skipNextOccurrence`.
 * The skip list is cleared on document changes or when selection collapses
 * to a single range (e.g. after Escape or click).
 */
const setSkipList = StateEffect.define<ReadonlyArray<{ from: number; to: number }>>();

const skipListField = StateField.define<ReadonlyArray<{ from: number; to: number }>>({
  create() {
    return [];
  },
  update(value, tr) {
    if (tr.docChanged) return [];
    if (tr.selection && tr.selection.ranges.length <= 1) return [];
    for (const effect of tr.effects) {
      if (effect.is(setSkipList)) {
        return effect.value;
      }
    }
    return value;
  },
});

/**
 * Like `findNextOccurrence`, but also skips positions stored in `skipList`.
 * Used by `selectNextOccurrence` and `skipNextOccurrence` so that skipped
 * matches are not re-selected on subsequent Ctrl+D presses.
 */
function findNextOccurrenceWithSkip(
  state: EditorState,
  query: string,
  skipList: ReadonlyArray<{ from: number; to: number }>
): { from: number; to: number } | null {
  const doc = state.doc.toString();
  const ranges = state.selection.ranges;
  const searchOrigin = ranges[ranges.length - 1].to;

  const isSkipped = (from: number, to: number): boolean =>
    skipList.some((s) => s.from <= from && s.to >= to);

  for (const start of [searchOrigin, 0]) {
    let index = doc.indexOf(query, start);
    while (index !== -1) {
      if (start === 0 && index >= searchOrigin) break;
      if (
        !isCovered(ranges, index, index + query.length) &&
        !isSkipped(index, index + query.length)
      ) {
        return { from: index, to: index + query.length };
      }
      index = doc.indexOf(query, index + 1);
    }
  }

  return null;
}

/**
 * Find all occurrences of `query` in the document. Returns an empty array
 * when no occurrences are found.
 */
function findAllOccurrences(state: EditorState, query: string): { from: number; to: number }[] {
  const doc = state.doc.toString();
  const occurrences: { from: number; to: number }[] = [];

  let index = doc.indexOf(query);
  while (index !== -1) {
    occurrences.push({ from: index, to: index + query.length });
    index = doc.indexOf(query, index + query.length);
  }

  return occurrences;
}

/**
 * Find all word-boundary occurrences of `query` in the document. Returns an empty array
 * when no occurrences are found. Matching respects word boundaries - a match is only
 * valid if the characters before and after are non-word characters.
 */
function findAllWordOccurrences(state: EditorState, query: string): { from: number; to: number }[] {
  const doc = state.doc.toString();
  const occurrences: { from: number; to: number }[] = [];

  let index = doc.indexOf(query);
  while (index !== -1) {
    const end = index + query.length;

    // Check word boundaries: previous and next characters must not be word characters
    const isWordStart = index === 0 || !/\w/.test(doc[index - 1]);
    const isWordEnd = end === doc.length || !/\w/.test(doc[end]);

    if (isWordStart && isWordEnd) {
      occurrences.push({ from: index, to: end });
    }

    index = doc.indexOf(query, index + 1);
  }

  return occurrences;
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

  const skipList = state.field(skipListField, false) ?? [];
  const next = findNextOccurrenceWithSkip(state, query, skipList);
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
 * VS Code-style `Mod-F2`. Select all word-boundary occurrences of the word under cursor.
 * If there is already a selection, select all word-boundary occurrences of the selected text.
 * Matching respects word boundaries - useful for variable/function renaming.
 */
export const selectAllWordOccurrences: Command = (view) => {
  const { state } = view;
  const selection = state.selection;

  // If any range is empty, expand to the word under cursor first
  if (selection.ranges.some((range) => range.empty)) {
    const word = state.wordAt(selection.main.head);
    if (!word) return false;

    const query = state.sliceDoc(word.from, word.to);
    const occurrences = findAllWordOccurrences(state, query);

    if (occurrences.length <= 1) return false;

    view.dispatch({
      selection: EditorSelection.create(
        occurrences.map((o) => EditorSelection.range(o.from, o.to)),
        0
      ),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }

  // Use the selected text as query
  const query = state.sliceDoc(selection.main.from, selection.main.to);
  if (!query) return false;

  const occurrences = findAllWordOccurrences(state, query);
  if (occurrences.length <= 1) return false;

  view.dispatch({
    selection: EditorSelection.create(
      occurrences.map((o) => EditorSelection.range(o.from, o.to)),
      0
    ),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

/**
 * VS Code-style `Mod-Shift-L`. Select all occurrences of the currently selected text.
 * If the selection is empty, expand to the word under cursor first.
 * Matching is case-sensitive and not word-bounded.
 */
export const selectAllOccurrences: Command = (view) => {
  const { state } = view;
  const selection = state.selection;

  // If any range is empty, expand to the word under cursor first
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

    // Use the first non-empty range text as query
    const mainRange = ranges.find((r) => !r.empty);
    if (!mainRange) return false;
    const query = state.sliceDoc(mainRange.from, mainRange.to);
    if (!query) return false;

    const occurrences = findAllOccurrences(state, query);
    if (occurrences.length <= 1) return false;

    // Filter out skipped positions
    const skipList = state.field(skipListField, false) ?? [];
    const filtered = occurrences.filter(
      (o) => !skipList.some((s) => s.from <= o.from && s.to >= o.to)
    );
    if (filtered.length <= 1) return false;

    // If all filtered occurrences are already selected, nothing to do
    if (filtered.every((o) => isCovered(selection.ranges, o.from, o.to))) return false;

    view.dispatch({
      selection: EditorSelection.create(
        filtered.map((o) => EditorSelection.range(o.from, o.to)),
        0
      ),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }

  const main = selection.main;
  const query = state.sliceDoc(main.from, main.to);
  if (!query) return false;

  const occurrences = findAllOccurrences(state, query);
  if (occurrences.length <= 1) return false;

  // Filter out skipped positions
  const skipList = state.field(skipListField, false) ?? [];
  const filtered = occurrences.filter(
    (o) => !skipList.some((s) => s.from <= o.from && s.to >= o.to)
  );
  if (filtered.length <= 1) return false;

  // If all filtered occurrences are already selected, nothing to do
  if (filtered.every((o) => isCovered(selection.ranges, o.from, o.to))) return false;

  view.dispatch({
    selection: EditorSelection.create(
      filtered.map((o) => EditorSelection.range(o.from, o.to)),
      0
    ),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

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

/**
 * `Mod-Shift-;`. Add a cursor at the end of every line in the selection.
 * Useful for adding content to multiple lines simultaneously.
 */
export const addCursorToLineEnds: Command = (view) => {
  const { state } = view;
  const selection = state.selection.main;

  const fromLine = state.doc.lineAt(selection.from);
  const toLine = state.doc.lineAt(selection.to);

  // If only one line is selected, there's no need for multiple cursors
  if (fromLine.number === toLine.number) return false;

  const ranges: SelectionRange[] = [];
  for (let i = fromLine.number; i <= toLine.number; i++) {
    const line = state.doc.line(i);
    // Add cursor at end of each line
    ranges.push(EditorSelection.cursor(line.to));
  }

  view.dispatch({
    selection: EditorSelection.create(ranges, 0),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

/**
 * `Mod-Shift-D`. Skip the current (main) selection and
 * select the next occurrence instead. The skipped position is stored in
 * `skipListField` so subsequent `Ctrl+D` and `Ctrl+Shift+L` won't re-select it.
 *
 * Workflow: Ctrl+D → Ctrl+D → Ctrl+Shift+D (skip) → Ctrl+D → ...
 */
export const skipNextOccurrence: Command = (view) => {
  const { state } = view;
  const selection = state.selection;

  // Need at least one non-empty range to skip
  const main = selection.main;
  if (main.empty) return false;

  const query = state.sliceDoc(main.from, main.to);
  if (!query) return false;

  // Add current main range to skip list
  const skipList = state.field(skipListField, false) ?? [];
  const newSkipList = [...skipList, { from: main.from, to: main.to }];

  // Find next occurrence respecting the updated skip list
  const next = findNextOccurrenceWithSkip(state, query, newSkipList);
  if (!next) return false;

  // Remove the current main range (last one) and add the next occurrence
  const remainingRanges = selection.ranges.slice(0, -1);

  view.dispatch({
    selection: rangesToSelection(remainingRanges, EditorSelection.range(next.from, next.to)),
    effects: setSkipList.of(newSkipList),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

/**
 * `Mod-Shift-U`. Undo the last skip — re-select the position
 * that was skipped by `skipNextOccurrence`. The last entry is removed from
 * `skipListField` and added back as the new main selection.
 */
export const undoSkipOccurrence: Command = (view) => {
  const { state } = view;
  const skipList = state.field(skipListField, false) ?? [];

  if (skipList.length === 0) return false;

  // Get the last skipped position
  const lastSkipped = skipList[skipList.length - 1];
  const newSkipList = skipList.slice(0, -1);

  // Add the last skipped position back as a selection
  const selection = state.selection;

  view.dispatch({
    selection: rangesToSelection(
      selection.ranges,
      EditorSelection.range(lastSkipped.from, lastSkipped.to)
    ),
    effects: setSkipList.of(newSkipList),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

export const multiCursorKeymap: readonly KeyBinding[] = [
  { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
  { key: "Mod-Shift-l", run: selectAllOccurrences, preventDefault: true },
  { key: "Mod-F2", run: selectAllWordOccurrences, preventDefault: true },
  { key: "Mod-Shift-;", run: addCursorToLineEnds, preventDefault: true },
  { key: "Mod-Shift-d", run: skipNextOccurrence, preventDefault: true },
  { key: "Mod-Shift-u", run: undoSkipOccurrence, preventDefault: true },
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
    skipListField,
    keymap.of([...multiCursorKeymap]),
  ];
}
