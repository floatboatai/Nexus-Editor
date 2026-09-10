import {
  Annotation,
  EditorSelection,
  type EditorState,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import type {
  CoreEditorChange,
  CoreEditorTransaction,
  CoreEditorTransactionContext,
  CoreEditorTransactionDispatchResult,
  CoreEditorTransactionFilter,
  CoreEditorTransactionHookOptions,
  CoreEditorUpdateContext,
  CoreEditorUpdateListener,
  EditorAPI,
  EditorContributionRegistration,
  EditorTransactionContributionSink,
  SelectionState,
} from "./types";

export const EDITOR_TRANSACTION_RECURSION_LIMIT = 32;
export const EDITOR_TRANSACTION_PRIORITY_MIN = -10_000;
export const EDITOR_TRANSACTION_PRIORITY_MAX = 10_000;

export const editorTransactionOrigin = Annotation.define<readonly string[]>();

interface HookEntry<T> {
  readonly id: string;
  readonly ownerId: string;
  readonly callback: T;
  readonly priority: number;
  readonly sequence: number;
  disposed: boolean;
}

interface TransactionPipelineHost {
  readonly editor: EditorAPI;
  readonly view: EditorView;
  isDestroyed(): boolean;
}

interface PreparedTransaction {
  readonly transaction: Transaction;
  readonly context: CoreEditorTransactionContext;
}

type FilterPreparation =
  | { readonly status: "accepted"; readonly prepared: PreparedTransaction }
  | { readonly status: "rejected"; readonly ownerId: string; readonly reason?: string };

function validateOwnerId(ownerId: string): void {
  if (ownerId.trim().length === 0) {
    throw new TypeError("Editor transaction hook ownerId must not be empty");
  }
}

function normalizePriority(priority: number | undefined): number {
  const value = priority ?? 0;
  if (
    !Number.isInteger(value) ||
    value < EDITOR_TRANSACTION_PRIORITY_MIN ||
    value > EDITOR_TRANSACTION_PRIORITY_MAX
  ) {
    throw new RangeError(
      `Editor transaction hook priority must be an integer between ${EDITOR_TRANSACTION_PRIORITY_MIN} and ${EDITOR_TRANSACTION_PRIORITY_MAX}`
    );
  }
  return value;
}

function selectionSnapshot(selection: EditorSelection): SelectionState {
  const ranges = selection.ranges.map((range) => Object.freeze({
    anchor: range.anchor,
    head: range.head,
  }));
  Object.freeze(ranges);
  return Object.freeze({
    ranges,
    mainIndex: selection.mainIndex,
  });
}

function selectionFromSnapshot(selection: SelectionState): EditorSelection {
  if (selection.ranges.length === 0) {
    throw new RangeError("Editor transaction selection must contain at least one range");
  }
  return EditorSelection.create(
    selection.ranges.map((range) => EditorSelection.range(range.anchor, range.head)),
    selection.mainIndex
  );
}

function changesFromTransaction(transaction: Transaction): readonly CoreEditorChange[] {
  const changes: CoreEditorChange[] = [];
  transaction.changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) => {
    changes.push(Object.freeze({ from, to, insert: inserted.toString() }));
  }, true);
  return Object.freeze(changes);
}

function makeContext(editor: EditorAPI, transaction: Transaction): CoreEditorTransactionContext {
  return Object.freeze({
    editor,
    changes: changesFromTransaction(transaction),
    selectionBefore: selectionSnapshot(transaction.startState.selection),
    selectionAfter: selectionSnapshot(transaction.newSelection),
    origin: Object.freeze([...(transaction.annotation(editorTransactionOrigin) ?? [])]),
    userEvent: transaction.annotation(Transaction.userEvent),
  });
}

function stableHookOrder<T>(entries: Iterable<HookEntry<T>>): HookEntry<T>[] {
  return Array.from(entries)
    .filter((entry) => !entry.disposed)
    .sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
}

function toTransactionSpec(transaction: CoreEditorTransaction): TransactionSpec {
  const annotations = transaction.origin.length > 0
    ? [editorTransactionOrigin.of(Object.freeze([...transaction.origin]))]
    : undefined;
  return {
    changes: transaction.changes.map((change) => ({
      from: change.from,
      to: change.to,
      insert: change.insert,
    })),
    selection: transaction.selection ? selectionFromSnapshot(transaction.selection) : undefined,
    annotations,
    userEvent: transaction.userEvent,
  };
}

function publicTransaction(context: CoreEditorTransactionContext): CoreEditorTransaction {
  return {
    changes: context.changes,
    selection: context.selectionAfter,
    origin: context.origin,
    userEvent: context.userEvent,
  };
}

function inheritReplacement(
  previous: CoreEditorTransactionContext,
  replacement: CoreEditorTransaction
): CoreEditorTransaction {
  const origin = [...previous.origin];
  for (const item of replacement.origin) {
    if (origin[origin.length - 1] !== item) origin.push(item);
  }
  return {
    changes: replacement.changes,
    selection: replacement.selection,
    origin,
    userEvent: replacement.userEvent ?? previous.userEvent,
  };
}

export class CoreEditorTransactionPipeline implements EditorTransactionContributionSink {
  private readonly filters = new Map<string, HookEntry<CoreEditorTransactionFilter>>();
  private readonly updateListeners = new Map<string, HookEntry<CoreEditorUpdateListener>>();
  private registrationId = 0;
  private registrationSequence = 0;
  private notificationDepth = 0;
  private destroyed = false;

  constructor(private readonly host: TransactionPipelineHost) {}

  registerTransactionFilter(
    ownerId: string,
    filter: CoreEditorTransactionFilter,
    options: CoreEditorTransactionHookOptions = {}
  ): EditorContributionRegistration {
    return this.register(this.filters, "transaction-filter", ownerId, filter, options);
  }

  registerUpdateListener(
    ownerId: string,
    listener: CoreEditorUpdateListener,
    options: CoreEditorTransactionHookOptions = {}
  ): EditorContributionRegistration {
    return this.register(this.updateListeners, "update-listener", ownerId, listener, options);
  }

  dispatchTransaction(transaction: CoreEditorTransaction): CoreEditorTransactionDispatchResult {
    return this.dispatchTransactions([transaction]);
  }

  dispatchTransactions(transactions: readonly CoreEditorTransaction[]): CoreEditorTransactionDispatchResult {
    if (this.destroyed || this.host.isDestroyed()) {
      return { status: "rejected", ownerId: "host", reason: "editor-destroyed" };
    }
    if (this.notificationDepth >= EDITOR_TRANSACTION_RECURSION_LIMIT) {
      return { status: "recursion-limit", limit: EDITOR_TRANSACTION_RECURSION_LIMIT };
    }

    const merged = this.mergeBatch(this.host.view.state, transactions);
    return this.commit(merged, this.host.view);
  }

  dispatchCodeMirrorTransactions(
    transactions: readonly Transaction[],
    view: EditorView
  ): CoreEditorTransactionDispatchResult | null {
    if (transactions.length === 0 || this.destroyed || this.host.isDestroyed()) return null;
    if (transactions.every((transaction) => !transaction.docChanged && transaction.selection === undefined)) {
      view.update(transactions);
      return null;
    }
    if (this.notificationDepth >= EDITOR_TRANSACTION_RECURSION_LIMIT) {
      console.error(
        `[NexusEditor] Transaction recursion limit (${EDITOR_TRANSACTION_RECURSION_LIMIT}) reached`
      );
      return { status: "recursion-limit", limit: EDITOR_TRANSACTION_RECURSION_LIMIT };
    }

    const merged = this.mergeNativeBatch(view.state, transactions);
    return this.commit(merged, view);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.filters.clear();
    this.updateListeners.clear();
  }

  private mergeBatch(
    state: EditorState,
    transactions: readonly CoreEditorTransaction[]
  ): Transaction {
    if (transactions.length === 0) return state.update({});
    const origins: string[] = [];
    const specs: TransactionSpec[] = transactions.map((transaction, index) => {
      for (const origin of transaction.origin) {
        if (origins[origins.length - 1] !== origin) origins.push(origin);
      }
      const { annotations: _annotations, ...spec } = toTransactionSpec(transaction);
      return index === 0 ? spec : { ...spec, sequential: true };
    });
    specs[0] = {
      ...specs[0],
      annotations: origins.length > 0
        ? editorTransactionOrigin.of(Object.freeze(origins))
        : undefined,
    };
    return state.update(...specs);
  }

  private mergeNativeBatch(state: EditorState, transactions: readonly Transaction[]): Transaction {
    if (transactions.length === 1) return transactions[0];
    const origins: string[] = [];
    const specs = transactions.map((transaction, index): TransactionSpec => {
      for (const origin of transaction.annotation(editorTransactionOrigin) ?? []) {
        if (origins[origins.length - 1] !== origin) origins.push(origin);
      }
      return {
        changes: transaction.changes,
        selection: transaction.selection,
        effects: transaction.effects,
        annotations: index === transactions.length - 1 && origins.length > 0
          ? editorTransactionOrigin.of(Object.freeze(origins))
          : undefined,
        scrollIntoView: transaction.scrollIntoView,
        userEvent: transaction.annotation(Transaction.userEvent),
        sequential: index > 0,
        filter: false,
      };
    });
    return state.update(...specs);
  }

  private commit(
    initial: Transaction,
    view: EditorView
  ): CoreEditorTransactionDispatchResult {
    const filtered = this.applyFilters(initial);
    if (filtered.status === "rejected") return filtered;

    const { transaction, context } = filtered.prepared;
    const documentBefore = transaction.startState.doc.toString();
    view.update([transaction]);
    const update: CoreEditorUpdateContext = Object.freeze({
      ...context,
      documentBefore,
      documentAfter: transaction.state.doc.toString(),
    });
    this.notify(update);
    return { status: "success", update };
  }

  private applyFilters(initial: Transaction): FilterPreparation {
    let transaction = initial;
    let context = makeContext(this.host.editor, transaction);
    const filters = stableHookOrder(this.filters.values());

    for (const entry of filters) {
      if (entry.disposed) continue;
      let result: ReturnType<CoreEditorTransactionFilter>;
      try {
        result = entry.callback(context);
      } catch (error) {
        console.error(`[NexusEditor] Transaction filter failed (${entry.ownerId})`, error);
        return { status: "rejected", ownerId: entry.ownerId, reason: "filter-error" };
      }
      if (result.action === "reject") {
        return { status: "rejected", ownerId: entry.ownerId, reason: result.reason };
      }
      if (result.action === "replace") {
        transaction = transaction.startState.update({
          ...toTransactionSpec(inheritReplacement(context, result.transaction)),
          filter: false,
        });
        context = makeContext(this.host.editor, transaction);
      }
    }
    return { status: "accepted", prepared: { transaction, context } };
  }

  private notify(update: CoreEditorUpdateContext): void {
    const listeners = stableHookOrder(this.updateListeners.values());
    this.notificationDepth += 1;
    try {
      for (const entry of listeners) {
        if (entry.disposed) continue;
        try {
          entry.callback(update);
        } catch (error) {
          console.error(`[NexusEditor] Update listener failed (${entry.ownerId})`, error);
        }
      }
    } finally {
      this.notificationDepth -= 1;
    }
  }

  private register<T>(
    registry: Map<string, HookEntry<T>>,
    prefix: string,
    ownerId: string,
    callback: T,
    options: CoreEditorTransactionHookOptions
  ): EditorContributionRegistration {
    validateOwnerId(ownerId);
    if (this.destroyed || this.host.isDestroyed()) {
      throw new Error("Cannot register a transaction hook on a destroyed editor");
    }
    const id = `${prefix}:${++this.registrationId}`;
    const entry: HookEntry<T> = {
      id,
      ownerId,
      callback,
      priority: normalizePriority(options.priority),
      sequence: this.registrationSequence++,
      disposed: false,
    };
    registry.set(id, entry);
    let disposed = false;
    return {
      id,
      ownerId,
      ready: Promise.resolve(),
      get disposed() {
        return disposed;
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        entry.disposed = true;
        registry.delete(id);
      },
    };
  }
}

export function transactionContextToTransaction(
  context: CoreEditorTransactionContext
): CoreEditorTransaction {
  return publicTransaction(context);
}
