import {
  history,
  historyKeymap,
  isolateHistory,
  redoDepth,
  undoDepth
} from "@codemirror/commands";
import {
  Annotation,
  type AnnotationType,
  type Transaction,
  type TransactionSpec
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

/**
 * Marks transactions that belong to an explicit undo/redo group created by
 * {@link runInHistoryGroup}.
 *
 * When this annotation is present, the history plugin's `joinToEvent` predicate
 * returns `true` even for non-adjacent document ranges — so multi-step host /
 * plugin workflows collapse into a single Ctrl+Z.
 */
export const historyGroupAnnotation: AnnotationType<true> = Annotation.define<true>();

export interface HistoryPluginOptions {
  /**
   * Minimum number of undo events to retain.
   * Mirrors CodeMirror `HistoryConfig.minDepth` (default 100).
   */
  minDepth?: number;
  /**
   * Maximum gap in milliseconds between adjacent edits that still merge into
   * one undo event. Mirrors CodeMirror `HistoryConfig.newGroupDelay` (default 500).
   */
  newGroupDelay?: number;
}

/**
 * CodeMirror history plugin with optional grouping configuration.
 *
 * @example
 * ```ts
 * createEditor({
 *   container,
 *   plugins: [createHistoryPlugin({ newGroupDelay: 250 })]
 * });
 * ```
 */
export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  return {
    name: "plugin-history",
    cmExtensions: [
      history({
        minDepth: options.minDepth,
        newGroupDelay: options.newGroupDelay,
        joinToEvent(tr: Transaction, isAdjacent: boolean) {
          if (tr.annotation(historyGroupAnnotation)) {
            return true;
          }
          return isAdjacent;
        }
      }),
      keymap.of(historyKeymap)
    ]
  };
}

type DispatchArgs =
  | [TransactionSpec]
  | [TransactionSpec, ...TransactionSpec[]]
  | [readonly TransactionSpec[]];

function normalizeDispatchArgs(args: DispatchArgs): TransactionSpec[] {
  if (args.length === 1) {
    const only = args[0];
    if (Array.isArray(only)) {
      return [...only];
    }
    return [only as TransactionSpec];
  }
  return [...(args as TransactionSpec[])];
}

function withAnnotations(spec: TransactionSpec, extras: TransactionSpec["annotations"]): TransactionSpec {
  const current = spec.annotations
    ? Array.isArray(spec.annotations)
      ? spec.annotations
      : [spec.annotations]
    : [];
  const added = extras ? (Array.isArray(extras) ? extras : [extras]) : [];
  return {
    ...spec,
    annotations: [...current, ...added]
  };
}

/**
 * Run `fn` so every `view.dispatch` performed inside joins into **one**
 * undo/redo group — including edits on disjoint ranges.
 *
 * Behavior:
 * 1. The first dispatched transaction is isolated from prior history
 *    (`isolateHistory: "before"`).
 * 2. Every transaction is tagged with {@link historyGroupAnnotation} so the
 *    history plugin forces `joinToEvent`.
 * 3. After `fn` returns, a no-op seal transaction uses
 *    `isolateHistory: "after"` so subsequent user typing starts a new group
 *    without adding an extra undo entry.
 *
 * Nested calls are allowed and reuse the outer group (no double-wrapping).
 *
 * Prefer this for multi-step host/plugin workflows. For a single atomic edit,
 * use `editor.replaceRange(...)` or `editor.dispatchTransactions([...])`
 * instead — those already produce one undo entry without this helper.
 *
 * @example
 * ```ts
 * const view = EditorView.findFromDOM(container)!;
 * runInHistoryGroup(view, () => {
 *   editor.replaceRange(0, 5, "Hello");
 *   editor.replaceRange(20, 25, "world");
 * });
 * // One Ctrl+Z reverts both replacements.
 * ```
 */
export function runInHistoryGroup(view: EditorView, fn: () => void): void {
  const marker = view as EditorView & { __nexusHistoryGrouping?: boolean };
  if (marker.__nexusHistoryGrouping) {
    fn();
    return;
  }

  const originalDispatch = view.dispatch.bind(view);
  let dispatchCount = 0;
  marker.__nexusHistoryGrouping = true;

  view.dispatch = ((...args: DispatchArgs) => {
    const specs = normalizeDispatchArgs(args).map((spec, index) => {
      const extras: Annotation<unknown>[] = [historyGroupAnnotation.of(true)];
      if (dispatchCount === 0 && index === 0) {
        extras.push(isolateHistory.of("before"));
      }
      return withAnnotations(spec, extras);
    });
    dispatchCount += specs.length;
    return originalDispatch(...(specs as [TransactionSpec, ...TransactionSpec[]]));
  }) as typeof view.dispatch;

  try {
    fn();
  } finally {
    view.dispatch = originalDispatch;
    delete marker.__nexusHistoryGrouping;
    if (dispatchCount > 0) {
      // Seal the group without creating an additional undo event.
      originalDispatch({
        annotations: isolateHistory.of("after")
      });
    }
  }
}

/** Resolve a CodeMirror view from an editor root / content DOM node. */
export function findEditorView(dom: HTMLElement): EditorView | null {
  return EditorView.findFromDOM(dom);
}

export { isolateHistory, redoDepth, undoDepth };
