/**
 * Snapshot bookkeeping on top of a {@link SnapshotStore}: content-hash
 * de-duplication, retention pruning, and failure containment. The engine
 * knows nothing about the editor — hosts feed it plain strings — so the
 * whole lifecycle is unit-testable without a DOM.
 */

import type { Snapshot, SnapshotMeta, SnapshotStore } from "./store";

export const DEFAULT_MAX_SNAPSHOTS = 50;

export function hashContent(content: string): string {
  // FNV-1a 32-bit — dependency-free and stable across runs. Collisions are
  // acceptable here: the worst case is a skipped consecutive snapshot, not
  // a security boundary.
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeLabel(label?: string): string | undefined {
  const trimmed = label?.trim();
  return trimmed ? trimmed : undefined;
}

export function sortNewestFirst(metas: SnapshotMeta[]): SnapshotMeta[] {
  // Ties on createdAt (same-millisecond captures) resolve towards the
  // store's later entries, matching insertion order for append-style stores.
  return metas
    .map((meta, index) => ({ meta, index }))
    .sort((a, b) => b.meta.createdAt - a.meta.createdAt || b.index - a.index)
    .map(({ meta }) => meta);
}

function createSnapshotId(createdAt: number, hash: string, taken: SnapshotMeta[]): string {
  const ids = new Set(taken.map((meta) => meta.id));
  let id = `${createdAt}-${hash}`;
  let suffix = 1;
  while (ids.has(id)) {
    id = `${createdAt}-${hash}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export interface SnapshotEngineOptions {
  store: SnapshotStore;
  maxSnapshots?: number;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export class SnapshotEngine {
  private readonly store: SnapshotStore;
  private readonly maxSnapshots: number;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: SnapshotEngineOptions) {
    this.store = options.store;
    this.maxSnapshots = Math.max(1, options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS);
    this.now = options.now ?? Date.now;
  }

  /**
   * Record a snapshot unless the newest entry already holds identical
   * content. Returns the stored metadata, or `null` when the capture was
   * de-duplicated or the store rejected the write.
   */
  capture(documentKey: string, content: string, label?: string): Promise<SnapshotMeta | null> {
    return this.enqueue(async () => {
      const hash = hashContent(content);
      const existing = await this.safeList(documentKey);
      if (existing[0]?.hash === hash) return null;

      const createdAt = this.now();
      const snapshot: Snapshot = {
        id: createSnapshotId(createdAt, hash, existing),
        createdAt,
        label: normalizeLabel(label),
        size: content.length,
        hash,
        content
      };
      try {
        await this.store.save(documentKey, snapshot);
      } catch {
        // Persistence is best-effort; a failing store must not break editing.
        return null;
      }
      await this.prune(documentKey);
      const { content: _content, ...meta } = snapshot;
      return meta;
    });
  }

  /** Newest-first metadata, or an empty list when the store fails. */
  list(documentKey: string): Promise<SnapshotMeta[]> {
    return this.enqueue(() => this.safeList(documentKey));
  }

  /** Snapshot content, or `null` for missing ids and store failures. */
  load(documentKey: string, id: string): Promise<string | null> {
    return this.enqueue(async () => {
      try {
        return await this.store.load(documentKey, id);
      } catch {
        return null;
      }
    });
  }

  remove(documentKey: string, id: string): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        await this.store.remove(documentKey, id);
        return true;
      } catch {
        return false;
      }
    });
  }

  clear(documentKey: string): Promise<boolean> {
    return this.enqueue(async () => {
      try {
        await this.store.clear(documentKey);
        return true;
      } catch {
        return false;
      }
    });
  }

  /** Serialize async operations so rapid capture/restore clicks queue up. */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op, op);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async safeList(documentKey: string): Promise<SnapshotMeta[]> {
    try {
      return sortNewestFirst(await this.store.list(documentKey));
    } catch {
      return [];
    }
  }

  private async prune(documentKey: string): Promise<void> {
    const metas = await this.safeList(documentKey);
    for (const extra of metas.slice(this.maxSnapshots)) {
      try {
        await this.store.remove(documentKey, extra.id);
      } catch {
        // Retention is best-effort; a stuck entry just survives to next time.
      }
    }
  }
}
