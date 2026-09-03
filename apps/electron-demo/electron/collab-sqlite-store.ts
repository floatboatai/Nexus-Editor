import { randomUUID } from "node:crypto";

import type {
  DocumentId,
  ReplicaStore,
  ReplicaStoreCheckpoint,
  ReplicaStoreLease,
  ReplicaStoreLoadResult,
} from "@floatboat/nexus-plugin-collab";

const DEFAULT_MAX_UPDATE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;

type SqliteModule = typeof import("node:sqlite");
type SqliteDatabase = InstanceType<SqliteModule["DatabaseSync"]>;

export type SqliteReplicaStoreErrorCode =
  | "sqlite-unavailable"
  | "store-closed"
  | "lease-closed"
  | "update-too-large"
  | "document-too-large"
  | "checkpoint-invalid"
  | "store-corrupt";

export class SqliteReplicaStoreError extends Error {
  constructor(
    readonly code: SqliteReplicaStoreErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SqliteReplicaStoreError";
  }
}

export interface SqliteReplicaStoreOptions {
  readonly databasePath: string;
  readonly maxUpdateBytes?: number;
  readonly maxDocumentBytes?: number;
  /** Test seam; production callers use Electron's bundled `node:sqlite`. */
  readonly loadSqlite?: () => Promise<SqliteModule>;
}

export interface SqliteReplicaStore extends ReplicaStore {
  close(): Promise<void>;
}

interface DocumentRow {
  readonly generation: unknown;
  readonly snapshot: unknown;
  readonly snapshot_bytes: unknown;
  readonly snapshot_sequence: unknown;
  readonly journal_bytes: unknown;
  readonly next_sequence: unknown;
}

interface UpdateRow {
  readonly sequence: unknown;
  readonly payload: unknown;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function numberField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SqliteReplicaStoreError("store-corrupt", `SQLite Replica Store has an invalid ${field}`);
  }
  return value;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new SqliteReplicaStoreError("store-corrupt", `SQLite Replica Store has an invalid ${field}`);
  }
  return value;
}

function checkpoint(row: DocumentRow): ReplicaStoreCheckpoint {
  return Object.freeze({
    generation: stringField(row.generation, "generation"),
    sequence: numberField(row.next_sequence, "next sequence") - 1,
  });
}

function assertCheckpoint(
  value: ReplicaStoreCheckpoint,
  row: DocumentRow,
  documentId: DocumentId,
): ReplicaStoreCheckpoint {
  const generation = stringField(row.generation, "generation");
  const snapshotSequence = numberField(row.snapshot_sequence, "snapshot sequence");
  const nextSequence = numberField(row.next_sequence, "next sequence");
  if (
    !value ||
    typeof value !== "object" ||
    value.generation !== generation ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < snapshotSequence ||
    value.sequence >= nextSequence
  ) {
    throw new SqliteReplicaStoreError(
      "checkpoint-invalid",
      `Replica Store checkpoint is stale or belongs to another generation for ${documentId}`,
    );
  }
  return value;
}

function binaryField(value: unknown, field: string): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new SqliteReplicaStoreError("store-corrupt", `SQLite Replica Store has an invalid ${field}`);
}

function copyUpdate(update: Uint8Array, maxUpdateBytes: number): Uint8Array {
  if (!(update instanceof Uint8Array)) {
    throw new TypeError("Replica Store updates must be Uint8Array values");
  }
  if (update.byteLength === 0 || update.byteLength > maxUpdateBytes) {
    throw new SqliteReplicaStoreError(
      "update-too-large",
      `Replica Store update must contain between 1 and ${maxUpdateBytes} bytes`,
    );
  }
  return new Uint8Array(update);
}

function inImmediateTransaction<T>(database: SqliteDatabase, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the operation failure. Reopening SQLite performs recovery if rollback itself failed.
    }
    throw cause;
  }
}

async function loadDefaultSqlite(): Promise<SqliteModule> {
  try {
    // Keep the built-in dynamic so browser-oriented test/bundle transforms do not
    // try to resolve it as an npm package. This module only runs in the Electron
    // utility process.
    const sqliteSpecifier = "node:sqlite";
    const sqlite = await import(/* @vite-ignore */ sqliteSpecifier) as SqliteModule;
    if (typeof sqlite.DatabaseSync !== "function") throw new TypeError("DatabaseSync is unavailable");
    return sqlite;
  } catch (cause) {
    throw new SqliteReplicaStoreError(
      "sqlite-unavailable",
      "Electron collaboration persistence requires node:sqlite (Node.js >= 22.5)",
      cause,
    );
  }
}

export async function createSqliteReplicaStore(
  options: SqliteReplicaStoreOptions,
): Promise<SqliteReplicaStore> {
  if (!options.databasePath) throw new TypeError("A SQLite database path is required");
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
  const sqlite = await (options.loadSqlite ?? loadDefaultSqlite)();
  if (typeof sqlite.DatabaseSync !== "function") {
    throw new SqliteReplicaStoreError(
      "sqlite-unavailable",
      "Electron collaboration persistence requires node:sqlite (Node.js >= 22.5)",
    );
  }

  const database = new sqlite.DatabaseSync(options.databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS collab_documents (
      document_id TEXT PRIMARY KEY,
      generation TEXT NOT NULL,
      snapshot BLOB,
      snapshot_bytes INTEGER NOT NULL DEFAULT 0,
      snapshot_sequence INTEGER NOT NULL DEFAULT 0,
      journal_bytes INTEGER NOT NULL DEFAULT 0,
      next_sequence INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS collab_updates (
      document_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      payload BLOB NOT NULL,
      PRIMARY KEY (document_id, sequence),
      FOREIGN KEY (document_id) REFERENCES collab_documents(document_id) ON DELETE CASCADE
    ) STRICT;
  `);

  const insertDocument = database.prepare(`
    INSERT OR IGNORE INTO collab_documents (document_id, generation, updated_at)
    VALUES (?, ?, ?)
  `);
  const selectDocument = database.prepare(`
    SELECT generation, snapshot, snapshot_bytes, snapshot_sequence, journal_bytes, next_sequence
    FROM collab_documents
    WHERE document_id = ?
  `);
  const selectUpdates = database.prepare(`
    SELECT sequence, payload
    FROM collab_updates
    WHERE document_id = ?
    ORDER BY sequence ASC
  `);
  const insertUpdate = database.prepare(`
    INSERT INTO collab_updates (document_id, sequence, payload)
    VALUES (?, ?, ?)
  `);
  const advanceDocument = database.prepare(`
    UPDATE collab_documents
    SET next_sequence = ?, journal_bytes = ?, updated_at = ?
    WHERE document_id = ?
  `);
  const replaceSnapshot = database.prepare(`
    UPDATE collab_documents
    SET snapshot = ?, snapshot_bytes = ?, snapshot_sequence = ?, journal_bytes = ?, updated_at = ?
    WHERE document_id = ?
  `);
  const deleteUpdates = database.prepare(`
    DELETE FROM collab_updates
    WHERE document_id = ? AND sequence <= ?
  `);
  const sumUpdatesAfter = database.prepare(`
    SELECT COALESCE(SUM(length(payload)), 0) AS retained_bytes
    FROM collab_updates
    WHERE document_id = ? AND sequence > ?
  `);

  const leases = new Set<ReplicaStoreLease>();
  let closed = false;

  function assertStoreOpen(): void {
    if (closed) throw new SqliteReplicaStoreError("store-closed", "SQLite Replica Store is closed");
  }

  function requireDocument(documentId: DocumentId): DocumentRow {
    const row = selectDocument.get(documentId) as DocumentRow | undefined;
    if (!row) {
      throw new SqliteReplicaStoreError(
        "store-corrupt",
        `SQLite Replica Store metadata is missing for ${documentId}`,
      );
    }
    return row;
  }

  const store: SqliteReplicaStore = {
    async open(documentId): Promise<ReplicaStoreLease> {
      assertStoreOpen();
      insertDocument.run(documentId, randomUUID(), Date.now());
      let leaseClosed = false;

      const lease: ReplicaStoreLease = {
        async load(): Promise<ReplicaStoreLoadResult> {
          assertStoreOpen();
          if (leaseClosed) {
            throw new SqliteReplicaStoreError("lease-closed", "SQLite Replica Store lease is closed");
          }
          const row = requireDocument(documentId);
          const snapshotBytes = numberField(row.snapshot_bytes, "snapshot byte count");
          const snapshotSequence = numberField(row.snapshot_sequence, "snapshot sequence");
          const journalBytes = numberField(row.journal_bytes, "journal byte count");
          const nextSequence = numberField(row.next_sequence, "next sequence");
          stringField(row.generation, "generation");
          if (snapshotSequence >= nextSequence) {
            throw new SqliteReplicaStoreError(
              "store-corrupt",
              `SQLite Replica Store sequence metadata is invalid for ${documentId}`,
            );
          }
          if (snapshotBytes + journalBytes > maxDocumentBytes) {
            throw new SqliteReplicaStoreError(
              "store-corrupt",
              `SQLite Replica Store metadata exceeds the configured document limit for ${documentId}`,
            );
          }
          const updates: Uint8Array[] = [];
          if (row.snapshot !== null) {
            const snapshot = binaryField(row.snapshot, "snapshot");
            if (snapshot.byteLength === 0 || snapshot.byteLength !== snapshotBytes) {
              throw new SqliteReplicaStoreError(
                "store-corrupt",
                `SQLite Replica Store snapshot length is invalid for ${documentId}`,
              );
            }
            updates.push(snapshot);
          } else if (snapshotBytes !== 0 || snapshotSequence !== 0) {
            throw new SqliteReplicaStoreError(
              "store-corrupt",
              `SQLite Replica Store snapshot metadata is invalid for ${documentId}`,
            );
          }
          let observedJournalBytes = 0;
          let previousSequence = snapshotSequence;
          for (const updateRow of selectUpdates.all(documentId) as unknown as UpdateRow[]) {
            const sequence = numberField(updateRow.sequence, "journal sequence");
            if (sequence !== previousSequence + 1 || sequence >= nextSequence) {
              throw new SqliteReplicaStoreError(
                "store-corrupt",
                `SQLite Replica Store journal order is invalid for ${documentId}`,
              );
            }
            const update = binaryField(updateRow.payload, "journal update");
            if (update.byteLength === 0 || update.byteLength > maxUpdateBytes) {
              throw new SqliteReplicaStoreError(
                "store-corrupt",
                `SQLite Replica Store journal update size is invalid for ${documentId}`,
              );
            }
            previousSequence = sequence;
            observedJournalBytes += update.byteLength;
            updates.push(update);
          }
          if (previousSequence !== nextSequence - 1 || observedJournalBytes !== journalBytes) {
            throw new SqliteReplicaStoreError(
              "store-corrupt",
              `SQLite Replica Store journal length is invalid for ${documentId}`,
            );
          }
          return { updates, checkpoint: checkpoint(row) };
        },

        async append(update): Promise<ReplicaStoreCheckpoint> {
          assertStoreOpen();
          if (leaseClosed) {
            throw new SqliteReplicaStoreError("lease-closed", "SQLite Replica Store lease is closed");
          }
          const copy = copyUpdate(update, maxUpdateBytes);
          return inImmediateTransaction(database, () => {
            const row = requireDocument(documentId);
            const sequence = numberField(row.next_sequence, "next sequence");
            const snapshotBytes = numberField(row.snapshot_bytes, "snapshot byte count");
            const journalBytes = numberField(row.journal_bytes, "journal byte count");
            const nextJournalBytes = journalBytes + copy.byteLength;
            if (snapshotBytes + nextJournalBytes > maxDocumentBytes) {
              throw new SqliteReplicaStoreError(
                "document-too-large",
                `SQLite Replica Store exceeded ${maxDocumentBytes} bytes for ${documentId}`,
              );
            }
            insertUpdate.run(documentId, sequence, copy);
            advanceDocument.run(sequence + 1, nextJournalBytes, Date.now(), documentId);
            return Object.freeze({
              generation: stringField(row.generation, "generation"),
              sequence,
            });
          });
        },

        async flush(): Promise<void> {
          assertStoreOpen();
          if (leaseClosed) {
            throw new SqliteReplicaStoreError("lease-closed", "SQLite Replica Store lease is closed");
          }
          database.exec("PRAGMA wal_checkpoint(PASSIVE)");
        },

        async replaceWithSnapshot(
          update,
          options: { readonly through: ReplicaStoreCheckpoint },
        ): Promise<ReplicaStoreCheckpoint> {
          assertStoreOpen();
          if (leaseClosed) {
            throw new SqliteReplicaStoreError("lease-closed", "SQLite Replica Store lease is closed");
          }
          const copy = copyUpdate(update, maxDocumentBytes);
          return inImmediateTransaction(database, () => {
            const row = requireDocument(documentId);
            const through = assertCheckpoint(options.through, row, documentId);
            const sum = sumUpdatesAfter.get(documentId, through.sequence) as {
              readonly retained_bytes?: unknown;
            } | undefined;
            const retainedBytes = numberField(sum?.retained_bytes, "retained journal byte count");
            if (copy.byteLength + retainedBytes > maxDocumentBytes) {
              throw new SqliteReplicaStoreError(
                "document-too-large",
                `SQLite Replica Store exceeded ${maxDocumentBytes} bytes for ${documentId}`,
              );
            }
            replaceSnapshot.run(
              copy,
              copy.byteLength,
              through.sequence,
              retainedBytes,
              Date.now(),
              documentId,
            );
            deleteUpdates.run(documentId, through.sequence);
            return checkpoint(row);
          });
        },

        async close(): Promise<void> {
          if (leaseClosed) return;
          leaseClosed = true;
          leases.delete(lease);
        },
      };
      leases.add(lease);
      return lease;
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await Promise.all([...leases].map((lease) => lease.close()));
      database.close();
    },
  };

  return store;
}
