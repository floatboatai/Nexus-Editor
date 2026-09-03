import type {
  DocumentId,
  ReplicaStore,
  ReplicaStoreCheckpoint,
  ReplicaStoreLease,
  ReplicaStoreLoadResult,
} from "./types";

const DATABASE_VERSION = 1;
const DOCUMENTS_STORE = "documents";
const UPDATES_STORE = "updates";
const DOCUMENT_UPDATES_INDEX = "by-document";
const DEFAULT_DATABASE_NAME = "nexus-collaboration";
const DEFAULT_MAX_UPDATE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;

export type IndexedDbReplicaStoreErrorCode =
  | "indexeddb-unavailable"
  | "database-blocked"
  | "store-closed"
  | "lease-closed"
  | "update-too-large"
  | "document-too-large"
  | "checkpoint-invalid"
  | "store-corrupt";

export class IndexedDbReplicaStoreError extends Error {
  constructor(
    readonly code: IndexedDbReplicaStoreErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IndexedDbReplicaStoreError";
  }
}

export interface IndexedDbReplicaStoreOptions {
  readonly databaseName?: string;
  readonly maxUpdateBytes?: number;
  readonly maxDocumentBytes?: number;
  /** Injection seam for workers, tests, and browsers without a global Window. */
  readonly indexedDB?: IDBFactory;
}

export interface IndexedDbReplicaStore extends ReplicaStore {
  close(): Promise<void>;
}

interface DocumentRecord {
  readonly documentId: string;
  readonly generation: string;
  readonly snapshot: ArrayBuffer | null;
  readonly snapshotBytes: number;
  readonly snapshotSequence: number;
  readonly journalBytes: number;
  readonly nextSequence: number;
  readonly updatedAt: number;
}

interface UpdateRecord {
  readonly documentId: string;
  readonly sequence: number;
  readonly payload: ArrayBuffer;
}

interface ManagedLease extends ReplicaStoreLease {
  close(): Promise<void>;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function copyBuffer(update: Uint8Array, maximum: number): ArrayBuffer {
  if (!(update instanceof Uint8Array)) {
    throw new TypeError("Replica Store updates must be Uint8Array values");
  }
  if (update.byteLength === 0 || update.byteLength > maximum) {
    throw new IndexedDbReplicaStoreError(
      "update-too-large",
      `Replica Store update must contain between 1 and ${maximum} bytes`,
    );
  }
  return new Uint8Array(update).buffer;
}

function checkedInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new IndexedDbReplicaStoreError(
      "store-corrupt",
      `IndexedDB Replica Store has an invalid ${name}`,
    );
  }
  return value;
}

function createGeneration(): string {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const value = new Uint8Array(16);
    globalThis.crypto.getRandomValues(value);
    return [...value]
      .map((entry) => entry.toString(16).padStart(2, "0"))
      .join("");
  }
  throw new IndexedDbReplicaStoreError(
    "indexeddb-unavailable",
    "Secure randomness is required to create an IndexedDB Replica Store generation",
  );
}

function checkpoint(document: DocumentRecord): ReplicaStoreCheckpoint {
  return Object.freeze({
    generation: document.generation,
    sequence: document.nextSequence - 1,
  });
}

function assertCheckpoint(
  value: ReplicaStoreCheckpoint,
  document: DocumentRecord,
): ReplicaStoreCheckpoint {
  if (
    !value ||
    typeof value !== "object" ||
    value.generation !== document.generation ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < document.snapshotSequence ||
    value.sequence >= document.nextSequence
  ) {
    throw new IndexedDbReplicaStoreError(
      "checkpoint-invalid",
      `Replica Store checkpoint is stale or belongs to another generation for ${document.documentId}`,
    );
  }
  return value;
}

function checkedBuffer(value: unknown, name: string): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return new Uint8Array(value as ArrayBuffer).slice();
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  throw new IndexedDbReplicaStoreError(
    "store-corrupt",
    `IndexedDB Replica Store has an invalid ${name}`,
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      {
        once: true,
      },
    );
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () =>
        reject(
          transaction.error ?? new Error("IndexedDB transaction was aborted"),
        ),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

async function runTransaction<T>(
  database: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const transaction = database.transaction(stores, mode, {
    durability: "strict",
  });
  const completed = transactionCompletion(transaction);
  try {
    const result = await operation(transaction);
    await completed;
    return result;
  } catch (cause) {
    try {
      transaction.abort();
    } catch {
      // It may already have aborted. Preserve the original failure.
    }
    await completed.catch(() => undefined);
    throw cause;
  }
}

function openDatabase(
  factory: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, DATABASE_VERSION);
    let blocked = false;
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: "documentId" });
      }
      if (!database.objectStoreNames.contains(UPDATES_STORE)) {
        const updates = database.createObjectStore(UPDATES_STORE, {
          keyPath: ["documentId", "sequence"],
        });
        updates.createIndex(DOCUMENT_UPDATES_INDEX, "documentId", {
          unique: false,
        });
      }
    });
    request.addEventListener(
      "blocked",
      () => {
        blocked = true;
        reject(
          new IndexedDbReplicaStoreError(
            "database-blocked",
            `IndexedDB upgrade for '${databaseName}' is blocked by another open connection`,
          ),
        );
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () => {
        if (!blocked)
          reject(
            request.error ??
              new Error("Could not open IndexedDB Replica Store"),
          );
      },
      { once: true },
    );
    request.addEventListener(
      "success",
      () => {
        if (blocked) {
          request.result.close();
          return;
        }
        resolve(request.result);
      },
      { once: true },
    );
  });
}

function assertDocumentRecord(
  value: unknown,
  documentId: DocumentId,
): DocumentRecord {
  if (!value || typeof value !== "object") {
    throw new IndexedDbReplicaStoreError(
      "store-corrupt",
      `IndexedDB Replica Store metadata is missing for ${documentId}`,
    );
  }
  const record = value as Partial<DocumentRecord>;
  if (record.documentId !== documentId) {
    throw new IndexedDbReplicaStoreError(
      "store-corrupt",
      `IndexedDB Replica Store identity is invalid for ${documentId}`,
    );
  }
  if (
    typeof record.generation !== "string" ||
    record.generation.length === 0 ||
    record.generation.length > 128
  ) {
    throw new IndexedDbReplicaStoreError(
      "store-corrupt",
      `IndexedDB Replica Store generation is invalid for ${documentId}`,
    );
  }
  checkedInteger(record.snapshotBytes, "snapshot byte count");
  checkedInteger(record.snapshotSequence, "snapshot sequence");
  checkedInteger(record.journalBytes, "journal byte count");
  const nextSequence = checkedInteger(record.nextSequence, "next sequence");
  if ((record.snapshotSequence ?? 0) >= nextSequence) {
    throw new IndexedDbReplicaStoreError(
      "store-corrupt",
      `IndexedDB Replica Store sequence metadata is invalid for ${documentId}`,
    );
  }
  checkedInteger(record.updatedAt, "updated timestamp");
  if (
    record.snapshot !== null &&
    !(record.snapshot instanceof ArrayBuffer) &&
    Object.prototype.toString.call(record.snapshot) !== "[object ArrayBuffer]"
  ) {
    throw new IndexedDbReplicaStoreError(
      "store-corrupt",
      `IndexedDB Replica Store snapshot is invalid for ${documentId}`,
    );
  }
  return record as DocumentRecord;
}

export function createIndexedDbReplicaStore(
  options: IndexedDbReplicaStoreOptions = {},
): IndexedDbReplicaStore {
  const databaseName = options.databaseName?.trim() || DEFAULT_DATABASE_NAME;
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) {
    throw new IndexedDbReplicaStoreError(
      "indexeddb-unavailable",
      "IndexedDB is unavailable in this browser context",
    );
  }
  const maxUpdateBytes = positiveInteger(
    options.maxUpdateBytes,
    DEFAULT_MAX_UPDATE_BYTES,
    "maxUpdateBytes",
  );
  const maxDocumentBytes = positiveInteger(
    options.maxDocumentBytes,
    DEFAULT_MAX_DOCUMENT_BYTES,
    "maxDocumentBytes",
  );
  let databasePromise: Promise<IDBDatabase> | null = null;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  const openings = new Set<Promise<unknown>>();
  const leases = new Set<ManagedLease>();

  function assertStoreOpen(): void {
    if (closed)
      throw new IndexedDbReplicaStoreError(
        "store-closed",
        "IndexedDB Replica Store is closed",
      );
  }

  function trackOpening<T>(opening: Promise<T>): Promise<T> {
    openings.add(opening);
    void opening.then(
      () => openings.delete(opening),
      () => openings.delete(opening),
    );
    return opening;
  }

  async function database(): Promise<IDBDatabase> {
    assertStoreOpen();
    databasePromise ??= openDatabase(factory, databaseName).then(
      (connection) => {
        connection.addEventListener("versionchange", () => connection.close());
        return connection;
      },
    );
    return databasePromise;
  }

  const store: IndexedDbReplicaStore = {
    async open(documentId): Promise<ReplicaStoreLease> {
      assertStoreOpen();
      return trackOpening(
        (async (): Promise<ReplicaStoreLease> => {
          const connection = await database();
          assertStoreOpen();
          await runTransaction(
            connection,
            DOCUMENTS_STORE,
            "readwrite",
            async (transaction) => {
              const documents = transaction.objectStore(DOCUMENTS_STORE);
              const existing = await requestResult(documents.get(documentId));
              if (existing === undefined) {
                await requestResult(
                  documents.add({
                    documentId,
                    generation: createGeneration(),
                    snapshot: null,
                    snapshotBytes: 0,
                    snapshotSequence: 0,
                    journalBytes: 0,
                    nextSequence: 1,
                    updatedAt: Date.now(),
                  } satisfies DocumentRecord),
                );
              } else {
                assertDocumentRecord(existing, documentId);
              }
            },
          );
          assertStoreOpen();

          let leaseClosed = false;
          let leaseClosing = false;
          let leaseClosePromise: Promise<void> | null = null;
          let queue: Promise<unknown> = Promise.resolve();

          function assertLeaseOpen(): void {
            assertStoreOpen();
            if (leaseClosed || leaseClosing) {
              throw new IndexedDbReplicaStoreError(
                "lease-closed",
                "IndexedDB Replica Store lease is closed",
              );
            }
          }

          function enqueue<T>(operation: () => Promise<T>): Promise<T> {
            try {
              assertLeaseOpen();
            } catch (cause) {
              return Promise.reject(cause);
            }
            const result = queue.then(operation);
            queue = result.catch(() => undefined);
            return result;
          }

          const lease: ManagedLease = {
            load(): Promise<ReplicaStoreLoadResult> {
              return enqueue(async () =>
                runTransaction(
                  connection,
                  [DOCUMENTS_STORE, UPDATES_STORE],
                  "readonly",
                  async (transaction) => {
                    const rawDocument = await requestResult(
                      transaction.objectStore(DOCUMENTS_STORE).get(documentId),
                    );
                    const document = assertDocumentRecord(
                      rawDocument,
                      documentId,
                    );
                    if (
                      document.snapshotBytes + document.journalBytes >
                      maxDocumentBytes
                    ) {
                      throw new IndexedDbReplicaStoreError(
                        "store-corrupt",
                        `IndexedDB Replica Store metadata exceeds the document limit for ${documentId}`,
                      );
                    }
                    const rawUpdates = (await requestResult(
                      transaction
                        .objectStore(UPDATES_STORE)
                        .index(DOCUMENT_UPDATES_INDEX)
                        .getAll(documentId),
                    )) as unknown[];
                    const updates: Uint8Array[] = [];
                    if (document.snapshot !== null) {
                      const snapshot = checkedBuffer(
                        document.snapshot,
                        "snapshot",
                      );
                      if (
                        snapshot.byteLength === 0 ||
                        snapshot.byteLength !== document.snapshotBytes
                      ) {
                        throw new IndexedDbReplicaStoreError(
                          "store-corrupt",
                          `IndexedDB Replica Store snapshot length is invalid for ${documentId}`,
                        );
                      }
                      updates.push(snapshot);
                    } else if (document.snapshotBytes !== 0) {
                      throw new IndexedDbReplicaStoreError(
                        "store-corrupt",
                        `IndexedDB Replica Store snapshot metadata is invalid for ${documentId}`,
                      );
                    }
                    if (
                      document.snapshot === null &&
                      document.snapshotSequence !== 0
                    ) {
                      throw new IndexedDbReplicaStoreError(
                        "store-corrupt",
                        `IndexedDB Replica Store snapshot sequence is invalid for ${documentId}`,
                      );
                    }
                    let previousSequence = document.snapshotSequence;
                    let journalBytes = 0;
                    for (const raw of rawUpdates) {
                      if (!raw || typeof raw !== "object") {
                        throw new IndexedDbReplicaStoreError(
                          "store-corrupt",
                          "IndexedDB journal row is invalid",
                        );
                      }
                      const update = raw as Partial<UpdateRecord>;
                      if (update.documentId !== documentId) {
                        throw new IndexedDbReplicaStoreError(
                          "store-corrupt",
                          "IndexedDB journal identity is invalid",
                        );
                      }
                      const sequence = checkedInteger(
                        update.sequence,
                        "journal sequence",
                      );
                      if (
                        sequence !== previousSequence + 1 ||
                        sequence >= document.nextSequence
                      ) {
                        throw new IndexedDbReplicaStoreError(
                          "store-corrupt",
                          "IndexedDB journal order is invalid",
                        );
                      }
                      const payload = checkedBuffer(
                        update.payload,
                        "journal update",
                      );
                      if (
                        payload.byteLength === 0 ||
                        payload.byteLength > maxUpdateBytes
                      ) {
                        throw new IndexedDbReplicaStoreError(
                          "store-corrupt",
                          "IndexedDB journal update size is invalid",
                        );
                      }
                      previousSequence = sequence;
                      journalBytes += payload.byteLength;
                      updates.push(payload);
                    }
                    if (
                      previousSequence !== document.nextSequence - 1 ||
                      journalBytes !== document.journalBytes
                    ) {
                      throw new IndexedDbReplicaStoreError(
                        "store-corrupt",
                        `IndexedDB Replica Store journal length is invalid for ${documentId}`,
                      );
                    }
                    return { updates, checkpoint: checkpoint(document) };
                  },
                ),
              );
            },

            append(update): Promise<ReplicaStoreCheckpoint> {
              let payload: ArrayBuffer;
              try {
                assertLeaseOpen();
                payload = copyBuffer(update, maxUpdateBytes);
              } catch (cause) {
                return Promise.reject(cause);
              }
              return enqueue(async () =>
                runTransaction(
                  connection,
                  [DOCUMENTS_STORE, UPDATES_STORE],
                  "readwrite",
                  async (transaction) => {
                    const documents = transaction.objectStore(DOCUMENTS_STORE);
                    const rawDocument = await requestResult(
                      documents.get(documentId),
                    );
                    const document = assertDocumentRecord(
                      rawDocument,
                      documentId,
                    );
                    const nextJournalBytes =
                      document.journalBytes + payload.byteLength;
                    if (
                      document.snapshotBytes + nextJournalBytes >
                      maxDocumentBytes
                    ) {
                      throw new IndexedDbReplicaStoreError(
                        "document-too-large",
                        `IndexedDB Replica Store exceeded ${maxDocumentBytes} bytes for ${documentId}`,
                      );
                    }
                    await requestResult(
                      transaction.objectStore(UPDATES_STORE).add({
                        documentId,
                        sequence: document.nextSequence,
                        payload,
                      } satisfies UpdateRecord),
                    );
                    await requestResult(
                      documents.put({
                        ...document,
                        journalBytes: nextJournalBytes,
                        nextSequence: document.nextSequence + 1,
                        updatedAt: Date.now(),
                      } satisfies DocumentRecord),
                    );
                    return Object.freeze({
                      generation: document.generation,
                      sequence: document.nextSequence,
                    });
                  },
                ),
              );
            },

            flush(): Promise<void> {
              return enqueue(async () => undefined);
            },

            replaceWithSnapshot(
              update,
              options: { readonly through: ReplicaStoreCheckpoint },
            ): Promise<ReplicaStoreCheckpoint> {
              let snapshot: ArrayBuffer;
              try {
                assertLeaseOpen();
                snapshot = copyBuffer(update, maxDocumentBytes);
              } catch (cause) {
                return Promise.reject(cause);
              }
              return enqueue(async () =>
                runTransaction(
                  connection,
                  [DOCUMENTS_STORE, UPDATES_STORE],
                  "readwrite",
                  async (transaction) => {
                    const documents = transaction.objectStore(DOCUMENTS_STORE);
                    const rawDocument = await requestResult(
                      documents.get(documentId),
                    );
                    const document = assertDocumentRecord(
                      rawDocument,
                      documentId,
                    );
                    const through = assertCheckpoint(options.through, document);
                    let retainedJournalBytes = 0;
                    const cursorRequest = transaction
                      .objectStore(UPDATES_STORE)
                      .index(DOCUMENT_UPDATES_INDEX)
                      .openCursor(documentId);
                    await new Promise<void>((resolve, reject) => {
                      cursorRequest.addEventListener(
                        "error",
                        () =>
                          reject(
                            cursorRequest.error ??
                              new Error("Could not compact IndexedDB journal"),
                          ),
                        { once: true },
                      );
                      cursorRequest.addEventListener("success", () => {
                        try {
                          const cursor = cursorRequest.result;
                          if (!cursor) {
                            resolve();
                            return;
                          }
                          const row = cursor.value as Partial<UpdateRecord>;
                          const sequence = checkedInteger(
                            row.sequence,
                            "journal sequence",
                          );
                          if (row.documentId !== documentId) {
                            reject(
                              new IndexedDbReplicaStoreError(
                                "store-corrupt",
                                "IndexedDB journal identity is invalid during compaction",
                              ),
                            );
                            return;
                          }
                          if (sequence <= through.sequence) cursor.delete();
                          else
                            retainedJournalBytes += checkedBuffer(
                              row.payload,
                              "journal update",
                            ).byteLength;
                          cursor.continue();
                        } catch (cause) {
                          reject(
                            cause instanceof IndexedDbReplicaStoreError
                              ? cause
                              : new IndexedDbReplicaStoreError(
                                  "store-corrupt",
                                  "IndexedDB journal is invalid during compaction",
                                  cause,
                                ),
                          );
                        }
                      });
                    });
                    if (
                      snapshot.byteLength + retainedJournalBytes >
                      maxDocumentBytes
                    ) {
                      throw new IndexedDbReplicaStoreError(
                        "document-too-large",
                        `IndexedDB Replica Store exceeded ${maxDocumentBytes} bytes for ${documentId}`,
                      );
                    }
                    await requestResult(
                      documents.put({
                        ...document,
                        snapshot,
                        snapshotBytes: snapshot.byteLength,
                        snapshotSequence: through.sequence,
                        journalBytes: retainedJournalBytes,
                        updatedAt: Date.now(),
                      } satisfies DocumentRecord),
                    );
                    return checkpoint(document);
                  },
                ),
              );
            },

            close(): Promise<void> {
              if (leaseClosePromise) return leaseClosePromise;
              leaseClosing = true;
              leaseClosePromise = (async () => {
                await queue;
                leaseClosed = true;
                leases.delete(lease);
              })();
              return leaseClosePromise;
            },
          };
          leases.add(lease);
          return lease;
        })(),
      );
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await Promise.allSettled([...openings]);
        await Promise.all([...leases].map((lease) => lease.close()));
        const connection = await databasePromise;
        connection?.close();
        databasePromise = null;
      })();
      return closePromise;
    },
  };

  return store;
}
