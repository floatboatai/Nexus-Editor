/**
 * Offline-first persistence.
 *
 * Local edits are appended to a WAL (write-ahead log) before they are acked to
 * the transport, so a crash or disconnect never loses work. Periodically the
 * WAL is collapsed into a snapshot, and entries older than the snapshot are
 * garbage-collected. This is the "IndexedDB 增量持久化、offline op log、snapshot GC"
 * layer from the architecture.
 */

import type { CollabOp } from "../provider/tree-crdt";
import type { AwarenessState } from "../provider/adapter";

/** Minimal key-value contract the host's PluginStorageService satisfies. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CollabSnapshotState {
  readonly docId: string;
  readonly ops: readonly CollabOp[];
  readonly awareness: readonly AwarenessState[];
  readonly seq: number;
}

export class CollabStorage {
  private readonly walKey: string;
  private readonly snapKey: string;
  private seq = 0;

  constructor(
    private readonly store: KeyValueStore,
    private readonly docId: string,
  ) {
    this.walKey = `collab:wal:${docId}`;
    this.snapKey = `collab:snap:${docId}`;
  }

  /** Append an op to the WAL (idempotent by op.id). */
  async appendOp(op: CollabOp): Promise<void> {
    const wal = (await this.store.get<CollabOp[]>(this.walKey)) ?? [];
    if (wal.some((o) => o.id === op.id)) return;
    wal.push(op);
    this.seq++;
    await this.store.set(this.walKey, wal);
  }

  /** Replay the WAL + last snapshot into a single op stream. */
  async replay(): Promise<CollabOp[]> {
    const snap = await this.store.get<CollabSnapshotState>(this.snapKey);
    const wal = (await this.store.get<CollabOp[]>(this.walKey)) ?? [];
    return [...(snap?.ops ?? []), ...wal];
  }

  /** Collapse the WAL into a snapshot and truncate the WAL (GC). */
  async checkpoint(awareness: readonly AwarenessState[]): Promise<void> {
    const ops = await this.replay();
    const snapshot: CollabSnapshotState = { docId: this.docId, ops, awareness, seq: this.seq };
    await this.store.set(this.snapKey, snapshot);
    await this.store.set(this.walKey, []);
  }

  async destroy(): Promise<void> {
    await this.store.delete(this.walKey);
    await this.store.delete(this.snapKey);
  }
}
