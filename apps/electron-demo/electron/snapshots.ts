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

export interface CreateSnapshotInput {
  docKey: string;
  filePath: string | null;
  content: string;
  title?: string;
  createdAt?: string;
}

export const DEFAULT_SNAPSHOT_LIMIT = 20;

export function createEmptySnapshotStore(): SnapshotStore {
  return { byDocument: {} };
}

export function normalizeDocKey(filePath: string | null): string {
  if (!filePath) return "untitled";
  return filePath.replace(/\\/g, "/");
}

export function summarizeSnapshot(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "(empty document)";
  return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine;
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
  try {
    const parsed = JSON.parse(raw) as Partial<SnapshotStore>;
    if (!parsed.byDocument || typeof parsed.byDocument !== "object") {
      return createEmptySnapshotStore();
    }
    const byDocument: Record<string, SnapshotEntry[]> = {};
    for (const [docKey, value] of Object.entries(parsed.byDocument)) {
      if (!Array.isArray(value)) continue;
      byDocument[docKey] = value.filter(isSnapshotEntryLike).sort((a, b) => {
        return b.createdAt.localeCompare(a.createdAt);
      });
    }
    return { byDocument };
  } catch {
    return createEmptySnapshotStore();
  }
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
