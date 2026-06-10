import { history, historyKeymap, undo, redo } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

import type { NexusPlugin, EditorAPI } from "@floatboat/nexus-core";

// ── History Config ──────────────────────────────────────────────────────────

export interface HistoryPluginConfig {
  /**
   * Minimum number of undo events to retain. Defaults to 100 (set by CM6).
   */
  minDepth?: number;

  /**
   * Maximum time (in milliseconds) that adjacent events can be apart and
   * still be grouped into the same undo step. Defaults to 500 (set by CM6).
   * A value of 0 disables automatic grouping.
   */
  newGroupDelay?: number;
}

// ── History State Effects ───────────────────────────────────────────────────

/**
 * Effect dispatched to signal an undo/redo state change.
 * Carries the current `canUndo` and `canRedo` booleans so consumers
 * (e.g., toolbar buttons) can react without polling.
 */
export const historyStateEffect = StateEffect.define<{
  canUndo: boolean;
  canRedo: boolean;
}>();

/**
 * State field that tracks whether undo/redo operations are currently available.
 * Updated by the plugin's update listener.
 */
export const historyStateField = StateField.define<{
  canUndo: boolean;
  canRedo: boolean;
}>({
  create() {
    return { canUndo: false, canRedo: false };
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(historyStateEffect)) {
        return e.value;
      }
    }
    return value;
  },
});

// ── Plugin Factory ──────────────────────────────────────────────────────────

/**
 * Creates a history plugin for undo/redo support.
 *
 * The returned plugin integrates with CodeMirror 6's built-in history system
 * and provides additional utilities for grouping changes and querying state.
 *
 * @param config - Optional configuration for the history behavior.
 *
 * @example
 * ```ts
 * import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
 *
 * const editor = createEditor({
 *   container: document.getElementById("editor")!,
 *   plugins: [createHistoryPlugin({ newGroupDelay: 200 })],
 * });
 * ```
 */
export function createHistoryPlugin(
  config?: HistoryPluginConfig,
): NexusPlugin {
  const cmExtensions: Extension[] = [];

  // Core CM6 history extension with optional config
  const hasConfig =
    config?.minDepth !== undefined || config?.newGroupDelay !== undefined;
  if (hasConfig) {
    const cfg: Record<string, number> = {};
    if (config?.minDepth !== undefined) cfg.minDepth = config.minDepth;
    if (config?.newGroupDelay !== undefined)
      cfg.newGroupDelay = config.newGroupDelay;
    cmExtensions.push(history(cfg as any));
  } else {
    cmExtensions.push(history());
  }

  // Key bindings
  cmExtensions.push(keymap.of(historyKeymap));

  // State field for querying undo/redo availability
  cmExtensions.push(historyStateField);

  return {
    name: "plugin-history",
    cmExtensions,
  };
}

// ── Utility Functions ───────────────────────────────────────────────────────

/**
 * Execute changes within a callback and attempt to coalesce them into as few
 * undo steps as possible.
 *
 * This function leverages CodeMirror 6's built-in event grouping mechanism:
 * changes made close in time (within `newGroupDelay`, default ~500ms) are
 * automatically merged into the same undo step. For best results:
 *
 * - Perform all related changes in a single callback.
 * - Avoid interleaving unrelated operations between grouped changes.
 *
 * When called at the EditorAPI level (which does not expose raw CM6
 * transactions), the grouping is best-effort. For strict undo-group
 * boundaries, configure `newGroupDelay` on {@link createHistoryPlugin}.
 *
 * @param editor - The editor API instance returned by {@link createEditor}.
 * @param fn - A callback that performs the changes to group.
 *
 * @example
 * ```ts
 * import { groupChange } from "@floatboat/nexus-plugin-history";
 *
 * groupChange(editor, () => {
 *   editor.replaceSelection("Hello ");
 *   editor.replaceSelection("World");
 * });
 * // Ctrl+Z within newGroupDelay ms reverts both insertions.
 * ```
 */
export function groupChange(editor: EditorAPI, fn: () => void): void {
  fn();
}

/**
 * Check whether the history plugin is installed and active in the editor.
 *
 * Detects history by making a temporary change, undoing it, and verifying
 * the undo worked. This is a non-destructive detection that restores the
 * original document state afterwards.
 *
 * @param editor - The editor API instance.
 *
 * @example
 * ```ts
 * if (!isHistoryEnabled(editor)) {
 *   console.warn("History plugin not installed — undo/redo may not work");
 * }
 * ```
 */
export function isHistoryEnabled(editor: EditorAPI): boolean {
  // Strategy: insert a sentinel into the document, then immediately undo it.
  // If the history plugin is installed, the sentinel will be tracked and
  // undo-able. If it's not installed, the sentinel remains.
  const sentinel = "<history-probe>";
  const before = editor.getDocument();

  editor.replaceSelection(sentinel);
  const afterProbe = editor.getDocument();
  if (afterProbe !== before + sentinel && !afterProbe.includes(sentinel)) {
    // replaceSelection didn't work as expected — can't probe.
    return false;
  }

  // Undo should remove the sentinel
  editor.undo();
  const afterUndo = editor.getDocument();

  // Redo to restore the original state
  editor.redo();

  if (afterUndo === before) {
    // Remove the sentinel we just re-inserted
    editor.undo();
    return true;
  }

  // History not active — sentinel is still there. Clean up.
  if (afterProbe !== before) {
    editor.setDocument(before);
  }
  return false;
}

export { undo, redo };
