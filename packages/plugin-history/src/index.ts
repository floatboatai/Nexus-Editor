import { history, historyKeymap, isolateHistory, undoDepth, redoDepth } from "@codemirror/commands";
import type { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

export interface HistoryPluginOptions {
  /**
   * Maximum idle time (ms) between adjacent edits that still merge into one
   * undo group. CodeMirror default: 500. Pass 0 to make every edit its own
   * undo step.
   */
  newGroupDelay?: number;
  /**
   * Minimum number of undo events retained on the stack. CodeMirror
   * default: 100.
   */
  minDepth?: number;
}

/**
 * Undo/redo support with `Ctrl+Z` / `Ctrl+Shift+Z`.
 *
 * Grouping notes:
 * - Rapid adjacent typing merges into a single undo step (tune with
 *   `newGroupDelay` / `minGroupSize`).
 * - Table widget operations (structural edits, cell commits) are isolated by
 *   core into their own undo groups, so one undo never reverts a table op
 *   together with surrounding typing.
 * - Silent document loads (`setDocument(md, { silent: true })`) never enter
 *   the undo history, so undo right after opening a file is a no-op instead
 *   of reverting the freshly loaded document.
 */
export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [history(options), keymap.of(historyKeymap)]
  };
}

/**
 * Number of undoable change groups on the undo stack. Useful for hosts that
 * render undo/redo buttons with enabled/disabled state. Requires the history
 * extension to be active (via {@link createHistoryPlugin}).
 */
export function getUndoDepth(state: EditorState): number {
  return undoDepth(state);
}

/**
 * Number of change groups on the redo stack. See {@link getUndoDepth}.
 */
export function getRedoDepth(state: EditorState): number {
  return redoDepth(state);
}

/**
 * Annotation that keeps a host-dispatched transaction out of the surrounding
 * undo group (`"before"` / `"after"` / `"full"`). Re-exported so hosts with
 * their own CM6 extensions can mark structural mutations (e.g. a
 * host-driven format command) without importing @codemirror/commands
 * directly.
 */
export { isolateHistory };
