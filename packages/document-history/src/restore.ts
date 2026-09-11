import type { EditorAPI } from "@floatboat/nexus-core";
import {
  DocumentHistoryError,
  awaitHistoryOperation,
  throwIfHistoryAborted,
  type AppendDocumentVersionOptions,
  type AppendDocumentVersionResult,
  type DocumentVersion,
  type DocumentVersionStore,
} from "./types";

export interface CheckpointDocumentOptions extends AppendDocumentVersionOptions {
  readonly documentKey: string;
  readonly label?: string;
  readonly reason?: DocumentVersion["reason"];
}

/** Captures the actual editor, not delayed controlled props; it does not save a file. */
export async function checkpointDocument(editor: Pick<EditorAPI, "captureDocumentSnapshot">, store: DocumentVersionStore, options: CheckpointDocumentOptions): Promise<AppendDocumentVersionResult> {
  options = { ...options };
  throwIfHistoryAborted(options.signal);
  const snapshot = await editor.captureDocumentSnapshot({ signal: options.signal });
  throwIfHistoryAborted(options.signal);
  return awaitHistoryOperation(store.append(options.documentKey, {
    markdown: snapshot.markdown,
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  }, { expectedHead: options.expectedHead, signal: options.signal }), options.signal);
}

export interface RestoreDocumentVersionOptions {
  readonly documentKey: string;
  readonly versionId: string;
  readonly expectedRevision: string;
  /** Bind this to the host document lifetime, including any change of resource identity. */
  readonly signal?: AbortSignal;
  readonly selection?: { readonly anchor: number; readonly head?: number };
}

export interface RestoreDocumentVersionResult {
  readonly status: "applied" | "conflict" | "read-only" | "history-unavailable" | "transaction-rejected" |
    "unsupported" | "not-found" | "unchanged" | "store-conflict";
  readonly revision?: string;
  /** May exist even when a later edit or cancellation prevented buffer restoration. */
  readonly checkpointId?: string;
}

/** Checkpoint first, then ask core to atomically revalidate and restore only the buffer. */
export async function restoreDocumentVersion(editor: EditorAPI, store: DocumentVersionStore, options: RestoreDocumentVersionOptions): Promise<RestoreDocumentVersionResult> {
  options = { ...options, ...(options.selection ? { selection: { ...options.selection } } : {}) };
  throwIfHistoryAborted(options.signal);
  if (!editor.restoreDocumentBuffer || !editor.getDocumentRevision) return { status: "unsupported" };
  const current = (): RestoreDocumentVersionResult | null => {
    throwIfHistoryAborted(options.signal);
    const revision = editor.getDocumentRevision?.();
    if (revision !== options.expectedRevision) return { status: "conflict", revision };
    if (editor.isReadOnly?.()) return { status: "read-only", revision };
    return null;
  };
  const initiallyUnavailable = current();
  if (initiallyUnavailable) return initiallyUnavailable;
  const target = await awaitHistoryOperation(store.read(options.documentKey, options.versionId, { signal: options.signal }), options.signal);
  const afterRead = current();
  if (afterRead) return afterRead;
  if (!target) return { status: "not-found" };
  if (target.documentKey !== options.documentKey || target.id !== options.versionId || typeof target.markdown !== "string") {
    throw new DocumentHistoryError("invalid-store-result", "The store returned a version from a different document or request");
  }
  const markdown = target.markdown;
  const snapshot = await editor.captureDocumentSnapshot({ signal: options.signal });
  const afterCapture = current();
  if (afterCapture) return afterCapture;
  if (snapshot.revision === undefined) return { status: "unsupported" };
  if (snapshot.revision !== options.expectedRevision) return { status: "conflict", revision: snapshot.revision };
  if (snapshot.markdown === markdown) return { status: "unchanged", revision: snapshot.revision };
  const page = await awaitHistoryOperation(store.list(options.documentKey, { limit: 1, signal: options.signal }), options.signal);
  const beforeCheckpoint = current();
  if (beforeCheckpoint) return beforeCheckpoint;
  if (page.head !== null && (typeof page.head !== "string" || !page.head)) {
    throw new DocumentHistoryError("invalid-store-result", "The store did not return a valid history head");
  }
  const checkpoint = await awaitHistoryOperation(store.append(options.documentKey, {
    markdown: snapshot.markdown,
    reason: "before-restore",
  }, { expectedHead: page.head, signal: options.signal }), options.signal);
  throwIfHistoryAborted(options.signal);
  if (checkpoint.status === "conflict") return { status: "store-conflict" };
  if (checkpoint.version.documentKey !== options.documentKey || checkpoint.version.markdown !== snapshot.markdown ||
    checkpoint.version.reason !== "before-restore" || typeof checkpoint.version.id !== "string" || !checkpoint.version.id) {
    throw new DocumentHistoryError("invalid-store-result", "The store did not confirm the requested recovery checkpoint");
  }
  const afterCheckpoint = current();
  if (afterCheckpoint) return { ...afterCheckpoint, checkpointId: checkpoint.version.id };
  const result = await editor.restoreDocumentBuffer(markdown, {
    expectedRevision: options.expectedRevision,
    signal: options.signal,
    ...(options.selection === undefined ? {} : { selection: options.selection }),
  });
  return { ...result, checkpointId: checkpoint.version.id };
}
