/**
 * Storage contract for version snapshots. Persistence is host-injected —
 * the plugin never touches `localStorage` or the filesystem implicitly.
 * All operations are async so file / IPC / network backends are
 * representable (unlike the synchronous search-history storage, which
 * only fits `localStorage`-shaped hosts).
 */

export interface SnapshotMeta {
  /** Unique within a document key: `<createdAt>-<hash>` plus a collision suffix. */
  id: string;
  /** Capture time in milliseconds since the Unix epoch. */
  createdAt: number;
  /** Optional trimmed user label (e.g. "Before restore"). */
  label?: string;
  /** Content length in UTF-16 code units (`string.length`). */
  size: number;
  /** FNV-1a hex digest of the content, used for consecutive de-duplication. */
  hash: string;
}

export interface Snapshot extends SnapshotMeta {
  content: string;
}

export interface SnapshotStore {
  /**
   * Metadata for every snapshot under `documentKey`. Order is not
   * significant — callers sort by `createdAt` (later entries win ties).
   */
  list(documentKey: string): Promise<SnapshotMeta[]>;
  /** Snapshot content, or `null` when the id does not exist. */
  load(documentKey: string, id: string): Promise<string | null>;
  save(documentKey: string, snapshot: Snapshot): Promise<void>;
  /** Removing a missing id MUST NOT throw. */
  remove(documentKey: string, id: string): Promise<void>;
  clear(documentKey: string): Promise<void>;
}

/**
 * In-memory store — the plugin default, and the reference implementation
 * of the {@link SnapshotStore} contract for host backends.
 */
export function createMemorySnapshotStore(): SnapshotStore {
  const documents = new Map<string, Map<string, Snapshot>>();

  const snapshotsOf = (documentKey: string): Map<string, Snapshot> => {
    let snapshots = documents.get(documentKey);
    if (!snapshots) {
      snapshots = new Map();
      documents.set(documentKey, snapshots);
    }
    return snapshots;
  };

  return {
    list(documentKey) {
      const metas = [...snapshotsOf(documentKey).values()].map((snapshot) => {
        const { content: _content, ...meta } = snapshot;
        return meta;
      });
      return Promise.resolve(metas);
    },
    load(documentKey, id) {
      return Promise.resolve(snapshotsOf(documentKey).get(id)?.content ?? null);
    },
    save(documentKey, snapshot) {
      snapshotsOf(documentKey).set(snapshot.id, { ...snapshot });
      return Promise.resolve();
    },
    remove(documentKey, id) {
      snapshotsOf(documentKey).delete(id);
      return Promise.resolve();
    },
    clear(documentKey) {
      documents.delete(documentKey);
      return Promise.resolve();
    }
  };
}
