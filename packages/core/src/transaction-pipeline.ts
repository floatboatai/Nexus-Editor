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
  EditorAuthoritativeSourceRegistration,
  EditorContributionRegistration,
  EditorHistoryController,
  EditorTransactionAuthority,
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
  setExternalDocumentMode(active: boolean): void;
  prepareAuthoritativeUpdate(): void;
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
  return {
    ranges: selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head })),
    mainIndex: selection.mainIndex,
  };
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
    changes.push({ from, to, insert: inserted.toString() });
  }, true);
  return changes;
}

function makeContext(
  editor: EditorAPI,
  transaction: Transaction,
  authority: EditorTransactionAuthority,
  sourceOwnerId?: string,
): CoreEditorTransactionContext {
  return Object.freeze({
    editor,
    changes: Object.freeze(changesFromTransaction(transaction)),
    selectionBefore: Object.freeze(selectionSnapshot(transaction.startState.selection)),
    selectionAfter: Object.freeze(selectionSnapshot(transaction.newSelection)),
    origin: Object.freeze([...(transaction.annotation(editorTransactionOrigin) ?? [])]),
    userEvent: transaction.annotation(Transaction.userEvent),
    authority,
    sourceOwnerId,
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
  private authoritativeSource: {
    readonly id: string;
    readonly ownerId: string;
    readonly history: EditorHistoryController;
    disposed: boolean;
    invalidReason: "source-disposed" | "editor-destroyed";
  } | null = null;

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

  registerAuthoritativeSource(
    ownerId: string,
    history: EditorHistoryController,
  ): EditorAuthoritativeSourceRegistration {
    validateOwnerId(ownerId);
    if (this.destroyed || this.host.isDestroyed()) {
      throw new Error("Cannot register an authoritative source on a destroyed editor");
    }
    if (this.authoritativeSource && !this.authoritativeSource.disposed) {
      throw new Error(
        `Editor already has an authoritative source owned by ${this.authoritativeSource.ownerId}`,
      );
    }
    const entry: NonNullable<CoreEditorTransactionPipeline["authoritativeSource"]> = {
      id: `authoritative-source:${++this.registrationId}`,
      ownerId,
      history,
      disposed: false,
      invalidReason: "source-disposed",
    };
    this.authoritativeSource = entry;
    try {
      this.host.setExternalDocumentMode(true);
    } catch (error) {
      entry.disposed = true;
      this.authoritativeSource = null;
      throw error;
    }

    const invalidResult = (): CoreEditorTransactionDispatchResult => ({
      status: "rejected",
      ownerId,
      reason: entry.invalidReason,
    });
    const dispatchTransactions = (
      transactions: readonly CoreEditorTransaction[],
    ): CoreEditorTransactionDispatchResult => {
      if (entry.disposed || this.authoritativeSource !== entry) return invalidResult();
      if (this.destroyed || this.host.isDestroyed()) {
        entry.invalidReason = "editor-destroyed";
        entry.disposed = true;
        return invalidResult();
      }
      if (this.notificationDepth >= EDITOR_TRANSACTION_RECURSION_LIMIT) {
        return { status: "recursion-limit", limit: EDITOR_TRANSACTION_RECURSION_LIMIT };
      }
      try {
        this.host.prepareAuthoritativeUpdate();
        const merged = this.mergeBatch(this.host.view.state, transactions, false, false);
        return this.commit(merged, this.host.view, "authoritative", ownerId);
      } catch (error) {
        console.error(`[NexusEditor] Authoritative apply failed (${ownerId})`, error);
        return { status: "rejected", ownerId, reason: "authoritative-apply-failed" };
      }
    };

    return {
      id: entry.id,
      ownerId,
      ready: Promise.resolve(),
      get disposed() {
        return entry.disposed;
      },
      dispatch: (transaction) => dispatchTransactions([transaction]),
      dispatchTransactions,
      dispose: async () => {
        if (entry.disposed) return;
        entry.disposed = true;
        if (this.authoritativeSource === entry) {
          this.authoritativeSource = null;
          this.host.setExternalDocumentMode(false);
        }
      },
    };
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

    const merged = this.mergeBatch(
      this.host.view.state,
      transactions,
      true,
      this.authoritativeSource === null,
    );
    return this.commit(merged, this.host.view, "proposal");
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

    const merged = this.mergeNativeBatch(view.state, transactions, this.authoritativeSource === null);
    return this.commit(merged, view, "proposal");
  }

  runAuthoritativeHistory(action: "undo" | "redo"): { active: boolean; changed: boolean } {
    const source = this.authoritativeSource;
    if (!source || source.disposed || this.destroyed || this.host.isDestroyed()) {
      return { active: false, changed: false };
    }
    try {
      return { active: true, changed: source.history[action]() };
    } catch (error) {
      console.error(`[NexusEditor] Authoritative ${action} failed (${source.ownerId})`, error);
      return { active: true, changed: false };
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.authoritativeSource) {
      this.authoritativeSource.invalidReason = "editor-destroyed";
      this.authoritativeSource.disposed = true;
      this.authoritativeSource = null;
      this.host.setExternalDocumentMode(false);
    }
    this.filters.clear();
    this.updateListeners.clear();
  }

  private mergeBatch(
    state: EditorState,
    transactions: readonly CoreEditorTransaction[],
    filter = true,
    addToHistory = true,
  ): Transaction {
    if (transactions.length === 0) return state.update({});
    const origins: string[] = [];
    const specs: TransactionSpec[] = transactions.map((transaction, index) => {
      for (const origin of transaction.origin) {
        if (origins[origins.length - 1] !== origin) origins.push(origin);
      }
      const { annotations: _annotations, ...spec } = toTransactionSpec(transaction);
      const filteredSpec = filter ? spec : { ...spec, filter: false };
      return index === 0 ? filteredSpec : { ...filteredSpec, sequential: true };
    });
    const annotations = [
      ...(origins.length > 0 ? [editorTransactionOrigin.of(Object.freeze(origins))] : []),
      ...(!addToHistory ? [Transaction.addToHistory.of(false)] : []),
    ];
    specs[0] = {
      ...specs[0],
      annotations: annotations.length > 0 ? annotations : undefined,
    };
    return state.update(...specs);
  }

  private mergeNativeBatch(
    state: EditorState,
    transactions: readonly Transaction[],
    addToHistory = true,
  ): Transaction {
    if (transactions.length === 1 && addToHistory) return transactions[0];
    const origins: string[] = [];
    const specs = transactions.map((transaction, index): TransactionSpec => {
      for (const origin of transaction.annotation(editorTransactionOrigin) ?? []) {
        if (origins[origins.length - 1] !== origin) origins.push(origin);
      }
      return {
        changes: transaction.changes,
        selection: transaction.selection,
        effects: transaction.effects,
        annotations: index === 0
          ? [
              ...(origins.length > 0 ? [editorTransactionOrigin.of(Object.freeze(origins))] : []),
              ...(!addToHistory ? [Transaction.addToHistory.of(false)] : []),
            ]
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
    view: EditorView,
    authority: EditorTransactionAuthority,
    sourceOwnerId?: string,
  ): CoreEditorTransactionDispatchResult {
    const filtered: FilterPreparation = authority === "proposal"
      ? this.applyFilters(initial)
      : {
          status: "accepted",
          prepared: {
            transaction: initial,
            context: makeContext(this.host.editor, initial, authority, sourceOwnerId),
          },
        };
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
    let context = makeContext(this.host.editor, transaction, "proposal");
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
        context = makeContext(this.host.editor, transaction, "proposal");
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
