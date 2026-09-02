import {
  history,
  historyKeymap,
  isolateHistory as cmIsolateHistory,
  redo as cmRedo,
  redoDepth as cmRedoDepth,
  undo as cmUndo,
  undoDepth as cmUndoDepth,
} from "@codemirror/commands";
import { Annotation, EditorState, Transaction } from "@codemirror/state";
import { keymap, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";

/**
 * Marker annotation attached to every transaction dispatched while a
 * {@link HistoryAPI.groupHistory} scope is active (except the first change of
 * the group). The history `joinToEvent` predicate reads it to force the change
 * to merge into the group's single undo event.
 */
const historyGroup = Annotation.define<boolean>();

/**
 * Tracks the active grouping / isolation scopes for a single editor view.
 * Scopes are reference-counted so nested calls compose correctly.
 */
interface HistoryScopeState {
  /** Number of active {@link HistoryAPI.groupHistory} scopes. */
  groupDepth: number;
  /** Number of active {@link HistoryAPI.isolateHistory} scopes. */
  isolateDepth: number;
  /** Whether the current group has already emitted its first document change. */
  groupEmittedFirst: boolean;
}

const scopeStates = new WeakMap<EditorView, HistoryScopeState>();

function getScopeState(view: EditorView): HistoryScopeState {
  let state = scopeStates.get(view);
  if (!state) {
    state = { groupDepth: 0, isolateDepth: 0, groupEmittedFirst: false };
    scopeStates.set(view, state);
  }
  return state;
}

/** Maps an EditorState back to its owning EditorView (populated by the tracker plugin). */
const stateToView = new WeakMap<EditorState, EditorView>();

/**
 * Build the per-instance extensions that implement grouping. They close over
 * `activeViewRef` so the plugin can attach scopes to the editor it is bound to.
 */
function buildGroupingExtensions(activeViewRef: { current: EditorView | null }) {
  /**
   * A ViewPlugin that records the owning EditorView for each EditorState. The
   * transaction extender needs the view to look up the active scope, but
   * extensions are configured before the view exists, so we resolve it lazily
   * through this map.
   */
  const viewTracker = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        stateToView.set(view.state, view);
        activeViewRef.current = view;
      }
      update(update: ViewUpdate) {
        stateToView.set(update.state, update.view);
        activeViewRef.current = update.view;
      }
    }
  );

  /**
   * The transaction extender that injects history annotations. It runs inside
   * `EditorState.update()` for every transaction — including those dispatched
   * through the core transaction pipeline — so grouping works regardless of
   * how the change reaches the editor.
   */
  const historyGroupingExtension = EditorState.transactionExtender.of((transaction) => {
    const view = stateToView.get(transaction.startState);
    if (!view) return null;

    const scope = getScopeState(view);
    const annotations: Annotation<unknown>[] = [];
    if (scope.isolateDepth > 0 && transaction.docChanged) {
      // Isolation wins over grouping when both scopes are active.
      annotations.push(cmIsolateHistory.of("full"));
    } else if (scope.groupDepth > 0 && transaction.docChanged) {
      if (!scope.groupEmittedFirst) {
        // First change of a group: start a fresh undo event so it never merges
        // with an unrelated edit that happened just before the scope began.
        scope.groupEmittedFirst = true;
        annotations.push(cmIsolateHistory.of("before"));
      } else {
        // Subsequent changes: mark them so the joinToEvent predicate merges
        // them into the group's single undo event.
        annotations.push(historyGroup.of(true));
      }
    }

    return annotations.length > 0 ? { annotations } : null;
  });

  return { viewTracker, historyGroupingExtension };
}

/**
 * Options for {@link createHistoryPlugin}.
 */
export interface HistoryPluginOptions {
  /**
   * Maximum number of undo events to retain. Defaults to CodeMirror's
   * built-in value (100).
   */
  minDepth?: number;
  /**
   * Maximum time (ms) between adjacent changes for them to be grouped into a
   * single undo event. Defaults to 500.
   */
  newGroupDelay?: number;
}

/**
 * A snapshot of the current undo / redo history depth.
 */
export interface HistoryDepth {
  /** Number of undoable change events currently stored. */
  undo: number;
  /** Number of redoable change events currently stored. */
  redo: number;
}

/**
 * The public API surface of the history plugin. The returned plugin object
 * also implements these methods directly, so hosts can call them on the value
 * returned by {@link createHistoryPlugin}.
 */
export interface HistoryAPI {
  /**
   * Run `fn` while grouping every document change it makes into a single undo
   * entry. A single `undo()` reverts all of them together.
   *
   * Nested calls compose: the outermost scope wins, and the whole block is
   * grouped as one event.
   *
   * @returns the return value of `fn`.
   */
  groupHistory<T>(fn: () => T): T;
  /**
   * Run `fn` while preventing its document changes from being merged with
   * adjacent edits. Each change inside the scope still produces its own undo
   * entry, but none of them merge with edits outside the scope.
   *
   * @returns the return value of `fn`.
   */
  isolateHistory<T>(fn: () => T): T;
  /** Number of undoable / redoable change events currently stored. */
  getHistoryDepth(): HistoryDepth;
}

export type HistoryPlugin = NexusPlugin & HistoryAPI;

/**
 * Create the history plugin. The returned value can be passed straight into
 * `createEditor({ plugins: [...] })` and *also* used as a query handle:
 *
 * ```ts
 * const history = createHistoryPlugin();
 * const editor = createEditor({ container, plugins: [history] });
 *
 * history.groupHistory(() => {
 *   editor.replaceSelection("a");
 *   editor.replaceSelection("b");
 * });
 * // A single Ctrl+Z reverts both insertions.
 * ```
 */
export function createHistoryPlugin(options: HistoryPluginOptions = {}): HistoryPlugin {
  // The plugin needs a live EditorView to attach grouping scopes. Because a
  // plugin instance is typically bound to one editor, we cache the view here.
  const activeViewRef: { current: EditorView | null } = { current: null };

  const { viewTracker, historyGroupingExtension } = buildGroupingExtensions(activeViewRef);

  const cmExtensions = [
    history({
      minDepth: options.minDepth,
      newGroupDelay: options.newGroupDelay,
      // Force changes marked with the group annotation to merge into the
      // group's single undo event, even when they don't touch overlapping
      // ranges. Non-group changes keep the default adjacency behaviour.
      joinToEvent: (transaction, isAdjacent) =>
        transaction.annotation(historyGroup) === true || isAdjacent,
    }),
    keymap.of(historyKeymap),
    viewTracker,
    historyGroupingExtension,
  ];

  const api: HistoryAPI = {
    groupHistory<T>(fn: () => T): T {
      const view = activeViewRef.current;
      if (!view) return fn();
      const scope = getScopeState(view);
      const entering = scope.groupDepth === 0;
      scope.groupDepth += 1;
      if (entering) scope.groupEmittedFirst = false;
      try {
        return fn();
      } finally {
        scope.groupDepth -= 1;
      }
    },
    isolateHistory<T>(fn: () => T): T {
      const view = activeViewRef.current;
      if (!view) return fn();
      const scope = getScopeState(view);
      scope.isolateDepth += 1;
      try {
        return fn();
      } finally {
        scope.isolateDepth -= 1;
      }
    },
    getHistoryDepth(): HistoryDepth {
      const view = activeViewRef.current;
      if (!view) return { undo: 0, redo: 0 };
      return { undo: cmUndoDepth(view.state), redo: cmRedoDepth(view.state) };
    },
  };

  const plugin: HistoryPlugin = {
    name: "plugin-history",
    cmExtensions,
    commands: [
      {
        id: "history.undo",
        label: "Undo",
        run: (editor) => editor.undo(),
      },
      {
        id: "history.redo",
        label: "Redo",
        run: (editor) => editor.redo(),
      },
    ],
    ...api,
  };

  return plugin;
}
