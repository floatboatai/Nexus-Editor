import {
  history,
  historyKeymap,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth
} from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

/**
 * Effect dispatched to signal the start of an undo group. Increments the
 * internal group-depth counter so that subsequent transactions are joined
 * into a single history event.
 */
const startUndoGroup = StateEffect.define<void>();

/**
 * Effect dispatched to signal the end of an undo group. Decrements the
 * internal group-depth counter. When the depth reaches zero the current
 * history event is closed and future transactions start a new event.
 */
const endUndoGroup = StateEffect.define<void>();

/**
 * Tracks the active undo-group nesting depth. Each `startUndoGroup` effect
 * increments the depth; each `endUndoGroup` decrements it. When depth > 0,
 * the history `joinToEvent` predicate forces all consecutive transactions
 * into the same history event.
 *
 * This field is intentionally **not** mapped through document changes — it
 * only reacts to `startUndoGroup` / `endUndoGroup` effects. That constraint
 * means the depth value is position-independent and survives undos/redos
 * without position-mapping complications.
 */
const undoGroupDepth = StateField.define<number>({
  create() {
    return 0;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(startUndoGroup)) return value + 1;
      if (effect.is(endUndoGroup)) return Math.max(0, value - 1);
    }
    return value;
  }
});

/**
 * Programmatically group a series of editor changes into a single undo step.
 *
 * All `replaceRange` / `replaceSelection` / `setDocument` calls made inside
 * `fn` (across any number of CodeMirror transactions) are collapsed into one
 * history event. A single Ctrl+Z reverts the entire group.
 *
 * Nesting is supported — calling `groupUndo` inside another `groupUndo`
 * callback increments the depth counter. The group only closes when the
 * outermost call returns.
 *
 * If `fn` throws, the group is still properly closed (the depth counter is
 * decremented and an isolating marker is dispatched) so that subsequent
 * editor operations are not accidentally joined into the broken group.
 *
 * @example
 * ```ts
 * import { groupUndo } from "@floatboat/nexus-plugin-history";
 *
 * groupUndo(view, () => {
 *   editor.replaceRange(0, 3, "foo");
 *   editor.replaceRange(10, 14, "bar");
 * });
 * // One Ctrl+Z reverts both replacements.
 * ```
 */
export function groupUndo(view: EditorView, fn: () => void): void {
  const wasZero = (view.state.field(undoGroupDepth, false) ?? 0) === 0;

  // Open the group: isolate from whatever came before.
  if (wasZero) {
    view.dispatch({
      effects: startUndoGroup.of(undefined),
      annotations: isolateHistory.of("before")
    });
  } else {
    view.dispatch({
      effects: startUndoGroup.of(undefined)
    });
  }

  try {
    fn();
  } finally {
    const depth = view.state.field(undoGroupDepth, false) ?? 0;
    const closing = depth === 1;

    view.dispatch({
      effects: endUndoGroup.of(undefined),
      annotations: closing ? isolateHistory.of("after") : undefined
    });
  }
}

export interface HistoryPluginOptions {
  /**
   * Maximum time (in milliseconds) that adjacent changes can be apart and
   * still be grouped into the same history event. Passed through to
   * CodeMirror's `history()` config. Defaults to 500.
   */
  newGroupDelay?: number;
  /**
   * Minimum number of history events to store. Defaults to 100.
   */
  minDepth?: number;
}

/**
 * Create a Nexus history plugin with undo/redo support and optional
 * programmatic undo-group control via {@link groupUndo}.
 *
 * The plugin exposes CodeMirror's standard Ctrl+Z / Ctrl+Y (or Cmd+Z /
 * Cmd+Shift+Z on macOS) keybindings plus the `undoGroupDepth` state field
 * that powers {@link groupUndo}.
 */
export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [
      history({
        minDepth: options.minDepth,
        newGroupDelay: options.newGroupDelay,
        joinToEvent(tr, isAdjacent) {
          // When inside an active undo group (depth > 0), force-join every
          // consecutive transaction so they collapse into a single history
          // event. The start/end isolating annotations prevent the group
          // from leaking into surrounding edits.
          if ((tr.startState.field(undoGroupDepth, false) ?? 0) > 0) return true;
          return isAdjacent;
        }
      }),
      keymap.of(historyKeymap),
      undoGroupDepth
    ]
  };
}

// Re-export CodeMirror primitives so consumers don't need a direct
// dependency on @codemirror/commands for common history queries.
export { undo, redo, undoDepth, redoDepth };
