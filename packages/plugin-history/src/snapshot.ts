/**
 * Document snapshot management for history plugin.
 * Provides capability to save, restore, and manage document snapshots.
 */

export interface Snapshot {
  /** Unique snapshot identifier (UUID v4) */
  id: string;
  /** Document content at snapshot time */
  content: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Optional user-provided label for the snapshot */
  label?: string;
}

export interface SnapshotManagerConfig {
  /** Maximum number of snapshots to keep (default: 50) */
  maxSnapshots?: number;
}

export class SnapshotManager {
  private snapshots: Map<string, Snapshot> = new Map();
  private maxSnapshots: number;
  private sequenceNumber: number = 0;

  constructor(config: SnapshotManagerConfig = {}) {
    this.maxSnapshots = config.maxSnapshots ?? 50;
  }

  /**
   * Generate a unique ID for a snapshot.
   * Uses timestamp and random component for uniqueness.
   */
  private generateId(): string {
    return `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Save a snapshot of the current document.
   * @param content The document content to snapshot
   * @param label Optional label for the snapshot
   * @returns The created snapshot
   */
  saveSnapshot(content: string, label?: string): Snapshot {
    const snapshot: Snapshot = {
      id: this.generateId(),
      content,
      timestamp: Date.now(),
      label
    };

    this.snapshots.set(snapshot.id, snapshot);

    // Enforce max snapshots limit by removing oldest
    if (this.snapshots.size > this.maxSnapshots) {
      const oldest = Array.from(this.snapshots.values()).reduce((min, snap) =>
        snap.timestamp < min.timestamp ? snap : min
      );
      this.snapshots.delete(oldest.id);
    }

    return snapshot;
  }

  /**
   * Restore a snapshot and return its content.
   * @param id The snapshot ID to restore
   * @returns The snapshot content, or null if not found
   */
  restoreSnapshot(id: string): string | null {
    const snapshot = this.snapshots.get(id);
    return snapshot?.content ?? null;
  }

  /**
   * Get a snapshot by ID.
   * @param id The snapshot ID
   * @returns The snapshot, or null if not found
   */
  getSnapshot(id: string): Snapshot | null {
    return this.snapshots.get(id) ?? null;
  }

  /**
   * List all snapshots, sorted by timestamp descending (newest first).
   * For snapshots with same timestamp, maintain insertion order.
   */
  listSnapshots(): Snapshot[] {
    return Array.from(this.snapshots.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  /**
   * Delete a snapshot by ID.
   * @param id The snapshot ID
   * @returns true if deleted, false if not found
   */
  deleteSnapshot(id: string): boolean {
    return this.snapshots.delete(id);
  }

  /**
   * Delete all snapshots.
   */
  clearAllSnapshots(): void {
    this.snapshots.clear();
  }

  /**
   * Get the number of stored snapshots.
   */
  getSnapshotCount(): number {
    return this.snapshots.size;
  }

  /**
   * Export snapshots as JSON (for persistence or debugging).
   */
  exportSnapshots(): Snapshot[] {
    return this.listSnapshots();
  }

  /**
   * Import snapshots from JSON (for restoration or testing).
   * Note: This will overwrite existing snapshots with the same ID.
   */
  importSnapshots(snapshots: Snapshot[]): void {
    snapshots.forEach(snap => {
      this.snapshots.set(snap.id, snap);
    });

    // Enforce max snapshots limit after import
    while (this.snapshots.size > this.maxSnapshots) {
      const oldest = Array.from(this.snapshots.values()).reduce((min, snap) =>
        snap.timestamp < min.timestamp ? snap : min
      );
      this.snapshots.delete(oldest.id);
    }
  }
}

