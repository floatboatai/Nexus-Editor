/**
 * Local-first, debounced autosave for Nexus-Editor.
 *
 * The plugin subscribes to document `change` events and, after `delay`
 * milliseconds of inactivity, calls `onSave(doc)` with the latest
 * Markdown text. It tracks a clean / dirty state by comparing the live
 * document to the last persisted snapshot, so redundant writes are
 * skipped and `flush()` only saves when there is something to save.
 *
 * Usage:
 * ```ts
 * const autosave = createAutosavePlugin({
 *   delay: 800,
 *   onSave: (doc) => window.api.saveFile(doc),
 * });
 * const editor = createEditor({ container, plugins: [autosave] });
 * attachAutosavePlugin(autosave, editor);
 * ```
 *
 * Like the word-count plugin, Nexus-Editor's `NexusPlugin` contract is
 * declarative, so the plugin is attached to a concrete editor instance
 * after `createEditor` returns (via `attachAutosavePlugin`).
 */

import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";

import { createDebouncedTask, type DebouncedTask } from "./scheduler";

export interface AutosaveOptions {
  /**
   * Quiet period in milliseconds before a save is triggered. Every edit
   * resets the timer, so a fast typist produces one save per pause rather
   * than one per keystroke. Default: 800.
   */
  delay?: number;
  /**
   * Persist the document. Called with the latest Markdown string. May
   * return a promise — `flush()` and the internal scheduler await it so a
   * slow write never races the next edit. A rejection here leaves the
   * document dirty (a later edit will retry) and does not crash the
   * editor.
   */
  onSave: (doc: string) => void | Promise<void>;
}

export interface AutosaveState {
  /** The document has unsaved changes. */
  dirty: boolean;
  /** A save is scheduled but has not executed yet. */
  pending: boolean;
  /** An `onSave` call is currently in flight. */
  saving: boolean;
}

export interface AutosaveAPI {
  /** Snapshot of the current autosave state. */
  getState(): AutosaveState;
  /**
   * Persist pending changes immediately. Resolves to `true` if a save ran,
   * `false` if the document was already clean. Awaits `onSave`.
   */
  flush(): Promise<boolean>;
  /** Drop a pending save without persisting. Dirty state is preserved. */
  cancel(): void;
  /** Detach listeners and clear timers. Idempotent. */
  destroy(): void;
}

export type AutosavePlugin = NexusPlugin &
  AutosaveAPI & {
    /**
     * Bind the plugin to an editor instance. Call once after
     * `createEditor` returns. Idempotent — repeats are ignored. Most
     * hosts prefer the `attachAutosavePlugin` free function for clarity.
     */
    attachEditor(editor: EditorAPI): void;
  };

const DEFAULT_DELAY = 800;

export function createAutosavePlugin(options: AutosaveOptions): AutosavePlugin {
  if (typeof options.onSave !== "function") {
    throw new TypeError("createAutosavePlugin requires an `onSave` function");
  }

  const delay = Math.max(0, options.delay ?? DEFAULT_DELAY);

  let editor: EditorAPI | null = null;
  let destroyed = false;
  // Last document we successfully persisted (or the baseline captured at
  // attach). `null` means "no baseline yet" (before attach).
  let lastSavedDoc: string | null = null;
  let saving = false;

  const performSave = async (): Promise<void> => {
    if (destroyed || !editor) return;
    const doc = editor.getDocument();
    // Skip the write when nothing changed since the last successful save.
    if (lastSavedDoc !== null && doc === lastSavedDoc) return;
    saving = true;
    try {
      await options.onSave(doc);
      lastSavedDoc = doc;
    } finally {
      saving = false;
    }
  };

  const task: DebouncedTask = createDebouncedTask({ delay, run: performSave });

  const onChange = (): void => {
    if (destroyed || !editor) return;
    task.schedule();
  };

  const api: AutosaveAPI = {
    getState(): AutosaveState {
      const current = editor?.getDocument() ?? "";
      return {
        dirty: editor !== null && lastSavedDoc !== null && current !== lastSavedDoc,
        pending: task.pending,
        saving
      };
    },
    flush(): Promise<boolean> {
      return task.flush();
    },
    cancel(): void {
      task.cancel();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      task.destroy();
      if (editor) {
        try {
          editor.off("change", onChange);
        } catch {
          /* editor may already be torn down */
        }
        editor = null;
      }
    }
  };

  const plugin: AutosavePlugin = {
    name: "plugin-autosave",
    cmExtensions: [],
    ...api,
    attachEditor(target: EditorAPI): void {
      if (editor || destroyed) return;
      editor = target;
      // Capture the loaded document as the clean baseline so the initial
      // state is not flagged dirty — only genuine edits trigger a save.
      lastSavedDoc = target.getDocument();
      target.on("change", onChange);
    }
  };

  return plugin;
}

/**
 * Bind an autosave plugin to an editor instance. Equivalent to
 * `plugin.attachEditor(editor)` but reads more naturally at the call
 * site:
 *
 * ```ts
 * const autosave = createAutosavePlugin({ onSave });
 * const editor = createEditor({ container, plugins: [autosave] });
 * attachAutosavePlugin(autosave, editor);
 * ```
 */
export function attachAutosavePlugin(plugin: AutosavePlugin, editor: EditorAPI): void {
  plugin.attachEditor(editor);
}

export { createDebouncedTask } from "./scheduler";
export type { DebouncedTask, DebouncedTaskOptions } from "./scheduler";
