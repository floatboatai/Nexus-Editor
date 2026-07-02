/**
 * Snapshot / Version History — Abstract interface for document versioning.
 *
 * Provides a storage-agnostic API for saving, listing, restoring,
 * and diffing document snapshots.
 */

export interface SnapshotMetadata {
  /** Unique identifier for this snapshot. */
  id: string;
  /** ISO 8601 timestamp when the snapshot was created. */
  createdAt: string;
  /** Optional human-readable label (e.g., "Before refactor"). */
  label?: string;
  /** Document character count at snapshot time. */
  characterCount: number;
  /** File path or document identifier this snapshot belongs to. */
  documentPath?: string;
}

export interface Snapshot extends SnapshotMetadata {
  /** Full document content at snapshot time. */
  content: string;
}

export interface DiffHunk {
  /** Type of change. */
  type: "add" | "remove" | "equal";
  /** The text content of this hunk. */
  content: string;
  /** Line number in the old document (for remove/equal). */
  oldLine?: number;
  /** Line number in the new document (for add/equal). */
  newLine?: number;
}

export interface SnapshotStorage {
  /**
   * Save a new snapshot. Returns the generated snapshot metadata.
   */
  save(documentPath: string, content: string, label?: string): Promise<SnapshotMetadata>;

  /**
   * List all snapshots for a given document, ordered by creation time (newest first).
   */
  list(documentPath: string): Promise<SnapshotMetadata[]>;

  /**
   * Retrieve the full content of a specific snapshot.
   */
  restore(id: string): Promise<Snapshot | null>;

  /**
   * Compute a line-based diff between two snapshots (or between a snapshot and current content).
   */
  diff(oldContent: string, newContent: string): DiffHunk[];

  /**
   * Delete a snapshot by id.
   */
  delete?(id: string): Promise<boolean>;
}

/**
 * Simple line-based diff algorithm.
 * Produces an array of DiffHunks showing additions, removals, and unchanged lines.
 */
export function computeLineDiff(oldText: string, newText: string): DiffHunk[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const hunks: DiffHunk[] = [];

  // Simple LCS-based diff (O(n*m) — adequate for document snapshots)
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  let i = m, j = n;
  const result: DiffHunk[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "equal", content: oldLines[i - 1], oldLine: i, newLine: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", content: newLines[j - 1], newLine: j });
      j--;
    } else {
      result.unshift({ type: "remove", content: oldLines[i - 1], oldLine: i });
      i--;
    }
  }

  return result;
}

/**
 * In-memory snapshot storage implementation.
 * Useful for testing or when persistence is handled externally.
 */
export function createMemorySnapshotStorage(): SnapshotStorage {
  const snapshots = new Map<string, Snapshot>();
  let counter = 0;

  return {
    async save(documentPath, content, label) {
      const id = `snapshot-${++counter}-${Date.now()}`;
      const metadata: SnapshotMetadata = {
        id,
        createdAt: new Date().toISOString(),
        label,
        characterCount: content.length,
        documentPath,
      };
      snapshots.set(id, { ...metadata, content });
      return metadata;
    },

    async list(documentPath) {
      const results: SnapshotMetadata[] = [];
      for (const snap of snapshots.values()) {
        if (snap.documentPath === documentPath) {
          const { content: _, ...meta } = snap;
          results.push(meta);
        }
      }
      return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async restore(id) {
      return snapshots.get(id) ?? null;
    },

    diff(oldContent, newContent) {
      return computeLineDiff(oldContent, newContent);
    },

    async delete(id) {
      return snapshots.delete(id);
    },
  };
}
