export interface DocumentVersion {
  readonly id: string;
  readonly documentKey: string;
  readonly createdAt: number;
  readonly markdown: string;
  readonly reason: "checkpoint" | "saved" | "before-restore";
  readonly label?: string;
}

export type DocumentVersionMetadata = Omit<DocumentVersion, "markdown">;

export interface HistoryOperationOptions {
  readonly signal?: AbortSignal;
}

export interface ListDocumentVersionsOptions extends HistoryOperationOptions {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface DocumentVersionPage {
  readonly items: readonly DocumentVersionMetadata[];
  readonly cursor: string | null;
  readonly head: string | null;
}

export interface AppendDocumentVersion {
  readonly markdown: string;
  readonly reason?: DocumentVersion["reason"];
  readonly label?: string;
}

export interface AppendDocumentVersionOptions extends HistoryOperationOptions {
  /** Omit for an unconditional append, not an overwrite. null requires an empty history. */
  readonly expectedHead?: string | null;
}

export type AppendDocumentVersionResult =
  | { readonly status: "appended"; readonly version: DocumentVersion }
  | { readonly status: "conflict"; readonly currentHead: string | null };

/** Stores immutable Unicode content, not filesystem bytes or the editor's undo stack. */
export interface DocumentVersionStore {
  list(documentKey: string, options?: ListDocumentVersionsOptions): Promise<DocumentVersionPage>;
  read(documentKey: string, versionId: string, options?: HistoryOperationOptions): Promise<DocumentVersion | null>;
  append(documentKey: string, record: AppendDocumentVersion, options?: AppendDocumentVersionOptions): Promise<AppendDocumentVersionResult>;
}

export interface DocumentHistorySnapshot {
  readonly schemaVersion: 1;
  /** Oldest first, with each record carrying its documentKey. */
  readonly versions: readonly DocumentVersion[];
}

export class DocumentHistoryError extends Error {
  constructor(readonly code: "quota-exceeded" | "invalid-snapshot" | "invalid-store-result", message: string) {
    super(message);
    this.name = "DocumentHistoryError";
  }
}

export function throwIfHistoryAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Document history operation cancelled", "AbortError");
}

/** Observe late provider failures even when cancellation has already returned to the caller. */
export function awaitHistoryOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Document history operation cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
