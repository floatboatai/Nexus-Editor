import {
  MAX_PLUGIN_PRIORITY,
  MIN_PLUGIN_PRIORITY,
  type EditorContext,
  type EditorTransaction,
  type EditorTransactionContext,
  type EditorUpdateContext,
  type JsonObject,
  type NexusDiagnostic,
  type OperationId,
  type RegistrationId,
  type ResourceOwner,
  type TransactionFilterResult,
} from "@floatboat/nexus-plugin-api";
import type {
  CoreEditorChange,
  CoreEditorTransaction,
  CoreEditorTransactionContext,
  CoreEditorTransactionFilterResult,
  SelectionState,
} from "@floatboat/nexus-core";

export const DEFAULT_FILTER_REJECTION_REASON = "Transaction rejected by a plugin filter";
export const FILTER_INVALID_RESULT_MESSAGE = "Editor transaction filter returned an invalid result";
export const FILTER_ASYNC_RESULT_MESSAGE = "Editor transaction filters must return synchronously";
export const FILTER_INVALID_REPLACEMENT_MESSAGE =
  "Editor transaction filter returned a transaction that cannot be applied";
export const FILTER_CALLBACK_FAILED_MESSAGE = "Editor transaction filter failed";
export const LISTENER_CALLBACK_FAILED_MESSAGE = "Editor transaction update listener failed";
export const LISTENER_ASYNC_RESULT_MESSAGE =
  "Editor transaction update listeners must return synchronously";
export const FILTER_CONTEXT_UNAVAILABLE_MESSAGE =
  "Editor transaction filter could not read the editor context";
export const DISPOSED_MESSAGE = "The editor transaction service has been disposed";
export const DESTROYED_REGISTRATION_MESSAGE =
  "Cannot register a transaction hook on a destroyed editor";
export const REENTRANT_DISPATCH_MESSAGE =
  "Cannot dispatch a transaction from inside a transaction filter";
export const PRIORITY_RANGE_MESSAGE =
  "Transaction hook priority must be an integer between -1000 and 1000";
export const DIAGNOSTIC_ATTRIBUTION_FAILED_MESSAGE =
  "Could not attach the plugin attribution to the supplied diagnostic";

/**
 * Per-dispatch identity carrier. Core carries no operationId/annotations, so the
 * service keeps them for the one synchronous dispatch currently in flight.
 */
export interface TransactionFrame {
  readonly operationId: OperationId;
  readonly annotations: JsonObject | undefined;
  /** The diagnostic a filter rejected with, kept by identity for the dispatch result. */
  rejectionDiagnostic: NexusDiagnostic | null;
}

export function createTransactionFrame(
  operationId: OperationId,
  annotations: JsonObject | undefined,
): TransactionFrame {
  return { operationId, annotations, rejectionDiagnostic: null };
}

export function createDiagnostic(
  code: NexusDiagnostic["code"],
  message: string,
  options: { readonly cause?: unknown; readonly owner?: ResourceOwner } = {},
): NexusDiagnostic {
  return {
    code,
    severity: "error",
    phase: code === "callback-failed" ? "callback" : "runtime",
    message,
    ...(options.owner ? { plugin: { id: options.owner.pluginId, version: "unknown" } } : {}),
    ...(options.cause === undefined
      ? {}
      : {
          cause:
            options.cause instanceof Error
              ? { name: options.cause.name, message: options.cause.message }
              : { message: String(options.cause) },
        }),
  };
}

/**
 * Branded identifiers exist so that a plain string can become one at exactly one reviewable
 * place (the same shape as `toCapabilityId` in `capability.ts`). Keeping the conversion here,
 * and nowhere else, is what keeps the brand meaningful.
 */
export function toOperationId(value: string): OperationId {
  return value as OperationId;
}

export function toRegistrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

/**
 * Adopts a promise the synchronous pipeline can never await. Without an owner its rejection
 * would surface as a host-level unhandled rejection instead of staying inside the boundary
 * that already reported the fault.
 */
export function adoptAbandonedThenable(
  value: PromiseLike<unknown>,
  onRejected?: (reason: unknown) => void,
): void {
  void Promise.resolve(value).then(undefined, (reason: unknown) => {
    try {
      onRejected?.(reason);
    } catch {
      // Reporting a fault must never become a second fault; there is no third channel.
    }
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function normalizeTransactionPriority(priority: number | undefined): number {
  const value = priority ?? 0;
  if (!Number.isInteger(value) || value < MIN_PLUGIN_PRIORITY || value > MAX_PLUGIN_PRIORITY) {
    throw new RangeError(PRIORITY_RANGE_MESSAGE);
  }
  return value;
}

export type PluginTransactionSource = Pick<
  CoreEditorTransactionContext,
  "changes" | "selectionBefore" | "selectionAfter" | "origin" | "userEvent"
>;

export function toPluginTransaction(
  source: PluginTransactionSource,
  frame: TransactionFrame | null,
): EditorTransaction {
  return {
    changes: source.changes,
    selectionBefore: source.selectionBefore,
    selectionAfter: source.selectionAfter,
    origin: source.origin,
    // A user-typed commit has no caller, so the identity keys stay absent rather
    // than present-and-undefined.
    ...(source.userEvent === undefined ? {} : { userEvent: source.userEvent }),
    ...(frame === null ? {} : { operationId: frame.operationId }),
    ...(frame === null || frame.annotations === undefined
      ? {}
      : { annotations: frame.annotations }),
  };
}

export function toFilterContext(
  editor: EditorContext,
  transaction: EditorTransaction,
): EditorTransactionContext {
  return { ...editor, transaction };
}

export function toUpdateContext(
  editor: EditorContext,
  transaction: EditorTransaction,
  documentBefore: string,
  documentAfter: string,
): EditorUpdateContext {
  return { ...editor, transaction, documentBefore, documentAfter };
}

export function toCoreDispatchTransaction(transaction: EditorTransaction): CoreEditorTransaction {
  return {
    changes: transaction.changes,
    selection: transaction.selectionAfter,
    origin: transaction.origin,
    ...(transaction.userEvent === undefined ? {} : { userEvent: transaction.userEvent }),
  };
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  const candidate = value as { readonly then?: unknown };
  return typeof candidate.then === "function";
}

export function isTransactionFilterResult(value: unknown): value is TransactionFilterResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { readonly action?: unknown };
  if (candidate.action === "accept" || candidate.action === "reject") return true;
  return candidate.action === "replace";
}

/**
 * Validates a filter's replacement before core applies it. Core resolves replacements
 * outside its try block, so an unapplicable payload would surface as a RangeError on
 * the host's editing path — the filter adapter has to reject it instead.
 */
export function toCoreReplacementTransaction(
  transaction: unknown,
  documentLength: number,
): CoreEditorTransaction | null {
  // Every field is read through a presence check: the payload comes from plugin code, and a
  // validator that throws would be translated by core into a veto of the caller's commit.
  const candidate = asRecord(transaction);
  if (candidate === null) return null;
  const rawChanges = candidate.changes;
  if (!Array.isArray(rawChanges)) return null;
  const changes: CoreEditorChange[] = [];
  for (const rawChange of rawChanges) {
    const change = asRecord(rawChange);
    if (change === null) return null;
    const { from, to, insert } = change;
    if (
      typeof from !== "number" ||
      typeof to !== "number" ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      from > to ||
      to > documentLength ||
      typeof insert !== "string"
    ) {
      return null;
    }
    changes.push({ from, to, insert });
  }

  const selection = asRecord(candidate.selectionAfter);
  if (selection === null) return null;
  const rawRanges = selection.ranges;
  if (!Array.isArray(rawRanges) || rawRanges.length === 0) return null;
  const mainIndex = selection.mainIndex;
  if (
    typeof mainIndex !== "number" ||
    !Number.isInteger(mainIndex) ||
    mainIndex < 0 ||
    mainIndex >= rawRanges.length
  ) {
    return null;
  }
  const ranges: SelectionState["ranges"] = [];
  for (const rawRange of rawRanges) {
    const range = asRecord(rawRange);
    if (range === null) return null;
    const { anchor, head } = range;
    if (
      typeof anchor !== "number" ||
      typeof head !== "number" ||
      !Number.isInteger(anchor) ||
      !Number.isInteger(head)
    ) {
      return null;
    }
    ranges.push({ anchor, head });
  }

  const rawOrigin = candidate.origin;
  if (!Array.isArray(rawOrigin) || rawOrigin.some((item) => typeof item !== "string")) return null;

  const userEvent = candidate.userEvent;
  if (userEvent !== undefined && typeof userEvent !== "string") return null;

  return {
    changes,
    selection: { ranges, mainIndex },
    origin: rawOrigin as string[],
    ...(userEvent === undefined ? {} : { userEvent }),
  };
}

export type FilterTranslation =
  | { readonly kind: "core"; readonly result: CoreEditorTransactionFilterResult }
  | { readonly kind: "invalid"; readonly message: string; readonly cause?: unknown };

export function toCoreFilterResult(
  value: unknown,
  options: {
    readonly frame: TransactionFrame | null;
    /** Lazily read; only the replace branch needs the pre-commit document length. */
    readonly getDocumentLength: () => number;
    /** Receives the rejection reason of a promise this synchronous path can never await. */
    readonly onAbandoned?: (reason: unknown) => void;
  },
): FilterTranslation {
  // Async results are not a shape question: the transaction pipeline is synchronous,
  // so a promise is reported as its own failure before any shape check. It can never be
  // awaited here, so it is adopted: an unowned rejection would surface as a host-level error.
  if (isThenable(value)) {
    adoptAbandonedThenable(value, options.onAbandoned);
    return { kind: "invalid", message: FILTER_ASYNC_RESULT_MESSAGE };
  }
  if (!isTransactionFilterResult(value)) {
    return { kind: "invalid", message: FILTER_INVALID_RESULT_MESSAGE };
  }
  if (value.action === "accept") {
    return { kind: "core", result: { action: "accept" } };
  }
  if (value.action === "reject") {
    const diagnostic = value.diagnostic;
    if (diagnostic === undefined) {
      // The pipeline supplies the default reason when core reports none.
      return { kind: "core", result: { action: "reject" } };
    }
    if (options.frame) options.frame.rejectionDiagnostic = diagnostic;
    return { kind: "core", result: { action: "reject", reason: diagnostic.message } };
  }
  // A replacement carries the caller's changeset only: operationId and annotations
  // belong to the dispatching call, not to a filter's rewrite of it.
  // Reading the document length reads the host context; a context that is gone (editor
  // detached mid-commit) must degrade to "this replacement cannot be applied" rather than
  // escape as a throw on the host's editing path.
  let documentLength: number;
  try {
    documentLength = options.getDocumentLength();
  } catch (error) {
    return { kind: "invalid", message: FILTER_CONTEXT_UNAVAILABLE_MESSAGE, cause: error };
  }
  const replacement = toCoreReplacementTransaction(value.transaction, documentLength);
  if (replacement === null) {
    return { kind: "invalid", message: FILTER_INVALID_REPLACEMENT_MESSAGE };
  }
  return { kind: "core", result: { action: "replace", transaction: replacement } };
}
