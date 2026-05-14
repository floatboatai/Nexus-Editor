import path from "node:path";

export interface SnapshotEntry {
  id: string;
  docKey: string;
  filePath: string | null;
  title: string;
  content: string;
  createdAt: string;
  summary: string;
}

export interface SnapshotStore {
  byDocument: Record<string, SnapshotEntry[]>;
}

export interface SnapshotDocumentRef {
  documentId: string;
  filePath: string | null;
}

export interface CreateSnapshotInput {
  docKey: string;
  filePath: string | null;
  content: string;
  title?: string;
  createdAt?: string;
}

export const DEFAULT_SNAPSHOT_LIMIT = 20;
export const DEFAULT_SNAPSHOT_CONTENT_BYTES = 512 * 1024;

export function createEmptySnapshotStore(): SnapshotStore {
  return { byDocument: {} };
}

export function createSnapshotDocumentRef(filePath: string | null): SnapshotDocumentRef {
  return {
    documentId: filePath ? documentIdFromPath(filePath) : "untitled",
    filePath,
  };
}

export function normalizeDocKey(filePath: string | null): string {
  return createSnapshotDocumentRef(filePath).documentId;
}

export function assertSnapshotContentSize(
  content: string,
  limitBytes = DEFAULT_SNAPSHOT_CONTENT_BYTES
): void {
  const size = Buffer.byteLength(content, "utf-8");
  if (size > limitBytes) {
    throw new Error(`Snapshot content exceeds ${limitBytes} bytes`);
  }
}

export function summarizeSnapshot(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return "(empty document)";

  const preferred = lines.find((line) => !line.startsWith("#")) ?? lines[0];
  return preferred.length > 96 ? `${preferred.slice(0, 93)}...` : preferred;
}

export function createSnapshotEntry(input: CreateSnapshotInput): SnapshotEntry {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const baseTitle = input.title?.trim() || summarizeSnapshot(input.content);
  return {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 10)}`,
    docKey: input.docKey,
    filePath: input.filePath,
    title: baseTitle,
    content: input.content,
    createdAt,
    summary: summarizeSnapshot(input.content),
  };
}

export function listSnapshots(store: SnapshotStore, docKey: string): SnapshotEntry[] {
  return [...(store.byDocument[docKey] ?? [])];
}

export function addSnapshot(
  store: SnapshotStore,
  entry: SnapshotEntry,
  limit = DEFAULT_SNAPSHOT_LIMIT
): SnapshotStore {
  const current = store.byDocument[entry.docKey] ?? [];
  const next = [entry, ...current]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  return {
    byDocument: {
      ...store.byDocument,
      [entry.docKey]: next,
    },
  };
}

export function parseSnapshotStore(raw: string): SnapshotStore {
  const parsed = JSON.parse(raw) as Partial<SnapshotStore>;
  if (!parsed.byDocument || typeof parsed.byDocument !== "object") {
    throw new Error("Invalid snapshot store shape");
  }
  const byDocument: Record<string, SnapshotEntry[]> = {};
  for (const [docKey, value] of Object.entries(parsed.byDocument)) {
    if (!Array.isArray(value)) continue;
    byDocument[docKey] = value.filter(isSnapshotEntryLike).sort((a, b) => {
      return b.createdAt.localeCompare(a.createdAt);
    });
  }
  return { byDocument };
}

function isSnapshotEntryLike(value: unknown): value is SnapshotEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string"
    && typeof entry.docKey === "string"
    && (typeof entry.filePath === "string" || entry.filePath === null)
    && typeof entry.title === "string"
    && typeof entry.content === "string"
    && typeof entry.createdAt === "string"
    && typeof entry.summary === "string";
}

function isCaseInsensitiveFileSystem(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

function documentIdFromPath(filePath: string): string {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return isCaseInsensitiveFileSystem() ? resolved.toLowerCase() : resolved;
}
