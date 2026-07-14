/**
 * NoteVault — Storage-agnostic interface for document persistence.
 *
 * Abstracts file I/O so the same editor code can work with:
 * - Local filesystem (Electron/Node)
 * - Remote storage (S3, WebDAV, custom API)
 * - In-memory storage (testing)
 */

export interface VaultEntry {
  /** Relative path within the vault (e.g., "notes/hello.md"). */
  path: string;
  /** Whether this is a file or directory. */
  kind: "file" | "directory";
  /** Last modification time as ISO 8601 string. */
  modifiedAt?: string;
  /** File size in bytes (files only). */
  size?: number;
}

export interface NoteVault {
  /** Vault identifier / root path. */
  readonly root: string;

  /**
   * List all entries in a directory (non-recursive).
   * Pass "" or "/" for the vault root.
   */
  list(dirPath: string): Promise<VaultEntry[]>;

  /**
   * Read a file's content as UTF-8 string.
   * Returns null if the file doesn't exist.
   */
  read(filePath: string): Promise<string | null>;

  /**
   * Write content to a file, creating intermediate directories as needed.
   */
  write(filePath: string, content: string): Promise<void>;

  /**
   * Delete a file or empty directory.
   * Returns true if deleted, false if not found.
   */
  delete(filePath: string): Promise<boolean>;

  /**
   * Rename/move a file within the vault.
   */
  rename?(oldPath: string, newPath: string): Promise<void>;

  /**
   * Check if a file or directory exists.
   */
  exists(filePath: string): Promise<boolean>;

  /**
   * Optional: watch for changes in the vault.
   * Returns an unsubscribe function.
   */
  watch?(callback: (event: VaultWatchEvent) => void): () => void;
}

export interface VaultWatchEvent {
  type: "create" | "modify" | "delete";
  path: string;
}

/**
 * In-memory NoteVault implementation for testing.
 */
export function createMemoryVault(root = "memory://vault"): NoteVault {
  const files = new Map<string, { content: string; modifiedAt: string }>();

  function normalizePath(p: string): string {
    return p.replace(/^\/+/, "").replace(/\/+$/, "");
  }

  return {
    root,

    async list(dirPath) {
      const prefix = normalizePath(dirPath);
      const entries: VaultEntry[] = [];
      const seen = new Set<string>();

      for (const [path] of files) {
        if (prefix && !path.startsWith(prefix + "/")) continue;
        if (!prefix && path.includes("/")) {
          // Top-level: show first segment as directory
          const first = path.split("/")[0];
          if (!seen.has(first)) {
            seen.add(first);
            entries.push({ path: first, kind: "directory" });
          }
          continue;
        }

        const relative = prefix ? path.slice(prefix.length + 1) : path;
        if (!relative) continue;

        if (relative.includes("/")) {
          const dir = relative.split("/")[0];
          const dirFullPath = prefix ? `${prefix}/${dir}` : dir;
          if (!seen.has(dirFullPath)) {
            seen.add(dirFullPath);
            entries.push({ path: dirFullPath, kind: "directory" });
          }
        } else {
          entries.push({ path, kind: "file", size: files.get(path)!.content.length });
        }
      }

      return entries;
    },

    async read(filePath) {
      const entry = files.get(normalizePath(filePath));
      return entry?.content ?? null;
    },

    async write(filePath, content) {
      files.set(normalizePath(filePath), {
        content,
        modifiedAt: new Date().toISOString(),
      });
    },

    async delete(filePath) {
      return files.delete(normalizePath(filePath));
    },

    async exists(filePath) {
      return files.has(normalizePath(filePath));
    },

    async rename(oldPath, newPath) {
      const old = normalizePath(oldPath);
      const entry = files.get(old);
      if (!entry) throw new Error(`File not found: ${old}`);
      files.delete(old);
      files.set(normalizePath(newPath), entry);
    },
  };
}
