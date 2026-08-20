import { history, historyKeymap, isolateHistory } from "@codemirror/commands";
import {
  Transaction,
  type Annotation,
  type TransactionSpec
} from "@codemirror/state";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

/**
 * Options forwarded to CodeMirror 6's `history()` extension.
 *
 * Use these to tune undo grouping without reaching into CM6 directly:
 * - `newGroupDelay` — max gap (ms) between adjacent events that may still
 *   join into one undo group. CM6 default is 500.
 * - `minDepth` — minimum number of undo events retained.
 * - `joinToEvent` — custom predicate for whether a transaction should join
 *   the previous history event (advanced; most hosts can ignore this).
 */
export interface HistoryPluginOptions {
  minDepth?: number;
  newGroupDelay?: number;
  joinToEvent?: (tr: Transaction, isAdjacent: boolean) => boolean;
}

/** Side of the current transaction at which to force a history boundary. */
export type HistoryIsolate = "full" | "before" | "after";

/**
 * Annotation that excludes a transaction from the undo stack.
 *
 * Prefer this (or `withHistoryControl`) over inventing a second history
 * mechanism. Core already attaches the equivalent annotation to silent
 * `setDocument` / `replaceRange` loads.
 */
export const notInHistory: Annotation<boolean> = Transaction.addToHistory.of(false);

/**
 * Force an undo-group boundary around (or beside) a transaction.
 *
 * Typical use: a toolbar command that must never merge with adjacent typing,
 * even when it lands inside `newGroupDelay`.
 */
export function forceHistoryBoundary(
  side: HistoryIsolate = "full"
): Annotation<"full" | "before" | "after"> {
  return isolateHistory.of(side);
}

/**
 * Merge history-control annotations into a `TransactionSpec`.
 *
 * Existing `annotations` on `spec` (single value or array) are preserved.
 * When both `addToHistory: false` and `isolate` are set, both annotations
 * are attached — CM6 honors `addToHistory` first, so the isolate is only
 * meaningful when the transaction *is* recorded.
 */
export function withHistoryControl(
  spec: TransactionSpec,
  control: { addToHistory?: boolean; isolate?: HistoryIsolate }
): TransactionSpec {
  const extra: Annotation<unknown>[] = [];
  if (control.addToHistory === false) {
    extra.push(notInHistory);
  }
  if (control.isolate) {
    extra.push(forceHistoryBoundary(control.isolate));
  }
  if (extra.length === 0) return spec;

  const existing = spec.annotations;
  const merged = existing
    ? Array.isArray(existing)
      ? [...existing, ...extra]
      : [existing, ...extra]
    : extra;

  return { ...spec, annotations: merged };
}

/**
 * Undo / redo plugin backed by CodeMirror 6 `history()`.
 *
 * Grouping policy:
 * 1. Default CM6 time-based joining (`newGroupDelay`, default 500ms).
 * 2. Callers that need a hard boundary use `forceHistoryBoundary` /
 *    `withHistoryControl({ isolate })` on their dispatch.
 * 3. Programmatic silent loads (`setDocument` / `replaceRange` with
 *    `{ silent: true }`) are excluded from history by core — opening a
 *    file must never become an undo step that erases the previous buffer.
 */
export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  const config: HistoryPluginOptions = {};
  if (options.minDepth !== undefined) config.minDepth = options.minDepth;
  if (options.newGroupDelay !== undefined) config.newGroupDelay = options.newGroupDelay;
  if (options.joinToEvent !== undefined) config.joinToEvent = options.joinToEvent;

  const hasConfig = Object.keys(config).length > 0;

  return {
    name: "plugin-history",
    cmExtensions: [hasConfig ? history(config) : history(), keymap.of(historyKeymap)]
  };
}

export { isolateHistory, historyKeymap };
