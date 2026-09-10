import {
  DocumentHistoryError,
  throwIfHistoryAborted,
  type AppendDocumentVersion,
  type AppendDocumentVersionOptions,
  type AppendDocumentVersionResult,
  type DocumentHistorySnapshot,
  type DocumentVersion,
  type DocumentVersionMetadata,
  type DocumentVersionPage,
  type DocumentVersionStore,
  type HistoryOperationOptions,
  type ListDocumentVersionsOptions,
} from "./types";

export interface MemoryDocumentVersionStoreOptions {
  readonly maxDocuments?: number;
  readonly maxVersionsPerDocument?: number;
  /** UTF-8 content and record metadata bytes, not the JS heap size. */
  readonly maxBytesPerDocument?: number;
  readonly maxTotalBytes?: number;
  readonly now?: () => number;
  /** Validated before exposing the store. Unsupported schemas are never overwritten. */
  readonly snapshot?: unknown;
}

function limit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return resolved;
}

function identifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new RangeError(`${name} must be a non-empty string of at most 1024 code units`);
}

function recordSize(record: DocumentVersion): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

function metadata(record: DocumentVersion): DocumentVersionMetadata {
  const { markdown: _markdown, ...value } = record;
  return Object.freeze(value);
}

function validateRecord(value: unknown): DocumentVersion {
  if (!value || typeof value !== "object") throw new RangeError("Invalid version record");
  const record = value as Record<string, unknown>;
  identifier(record.id, "version id");
  identifier(record.documentKey, "documentKey");
  if (typeof record.markdown !== "string" || typeof record.createdAt !== "number" ||
    !Number.isFinite(record.createdAt) || record.createdAt < 0 ||
    typeof record.reason !== "string" || !["checkpoint", "saved", "before-restore"].includes(record.reason) ||
    (record.label !== undefined && (typeof record.label !== "string" || record.label.length > 1024))) {
    throw new RangeError("Invalid version record fields");
  }
  return Object.freeze({
    id: record.id,
    documentKey: record.documentKey,
    markdown: record.markdown,
    createdAt: record.createdAt,
    reason: record.reason as DocumentVersion["reason"],
    ...(record.label === undefined ? {} : { label: record.label as string }),
  });
}

/** A bounded reference store. All appends commit synchronously before their promise resolves. */
export class MemoryDocumentVersionStore implements DocumentVersionStore {
  private readonly documents = new Map<string, DocumentVersion[]>();
  private readonly documentBytes = new Map<string, number>();
  private readonly ids = new Set<string>();
  private readonly maxDocuments: number;
  private readonly maxVersions: number;
  private readonly maxDocumentBytes: number;
  private readonly maxTotalBytes: number;
  private readonly now: () => number;
  private totalBytes = 0;
  private sequence = 0;

  constructor(options: MemoryDocumentVersionStoreOptions = {}) {
    this.maxDocuments = limit(options.maxDocuments, 100, "maxDocuments");
    this.maxVersions = limit(options.maxVersionsPerDocument, 100, "maxVersionsPerDocument");
    this.maxDocumentBytes = limit(options.maxBytesPerDocument, 20 * 1024 * 1024, "maxBytesPerDocument");
    this.maxTotalBytes = limit(options.maxTotalBytes, 64 * 1024 * 1024, "maxTotalBytes");
    this.now = options.now ?? Date.now;
    if (options.snapshot !== undefined) this.loadSnapshot(options.snapshot);
  }

  async list(documentKey: string, options: ListDocumentVersionsOptions = {}): Promise<DocumentVersionPage> {
    throwIfHistoryAborted(options.signal);
    identifier(documentKey, "documentKey");
    const pageSize = limit(options.limit, 50, "limit");
    if (pageSize > 1000) throw new RangeError("limit cannot exceed 1000");
    const versions = this.documents.get(documentKey) ?? [];
    let end = versions.length;
    if (options.cursor !== undefined) {
      end = versions.findIndex((record) => record.id === options.cursor);
      if (end < 0) throw new RangeError("Unknown history cursor");
    }
    const start = Math.max(0, end - pageSize);
    const items = versions.slice(start, end).reverse().map(metadata);
    return Object.freeze({
      items: Object.freeze(items),
      cursor: start > 0 ? versions[start].id : null,
      head: versions.at(-1)?.id ?? null,
    });
  }

  async read(documentKey: string, versionId: string, options: HistoryOperationOptions = {}): Promise<DocumentVersion | null> {
    throwIfHistoryAborted(options.signal);
    identifier(documentKey, "documentKey");
    identifier(versionId, "versionId");
    return this.documents.get(documentKey)?.find((record) => record.id === versionId) ?? null;
  }

  async append(documentKey: string, input: AppendDocumentVersion, options: AppendDocumentVersionOptions = {}): Promise<AppendDocumentVersionResult> {
    throwIfHistoryAborted(options.signal);
    identifier(documentKey, "documentKey");
    const head = this.documents.get(documentKey)?.at(-1)?.id ?? null;
    if (options.expectedHead !== undefined && options.expectedHead !== head) {
      return Object.freeze({ status: "conflict", currentHead: head });
    }
    let id: string;
    do { id = `version-${++this.sequence}`; } while (this.ids.has(id));
    const record = validateRecord({ ...input, id, documentKey, createdAt: this.now(), reason: input.reason ?? "checkpoint" });
    this.commit(record);
    return Object.freeze({ status: "appended", version: record });
  }

  exportSnapshot(): DocumentHistorySnapshot {
    return Object.freeze({
      schemaVersion: 1,
      versions: Object.freeze([...this.documents.values()].flat()),
    });
  }

  private commit(record: DocumentVersion): void {
    if (this.ids.has(record.id)) throw new RangeError("Duplicate history version id");
    const versions = this.documents.get(record.documentKey);
    if ((!versions && this.documents.size >= this.maxDocuments) || (versions?.length ?? 0) >= this.maxVersions ||
      record.markdown.length > this.maxDocumentBytes || record.markdown.length > this.maxTotalBytes) {
      throw new DocumentHistoryError("quota-exceeded", "Document history quota exceeded; no version was discarded");
    }
    const size = recordSize(record);
    const nextDocumentBytes = (this.documentBytes.get(record.documentKey) ?? 0) + size;
    if (nextDocumentBytes > this.maxDocumentBytes || this.totalBytes + size > this.maxTotalBytes) {
      throw new DocumentHistoryError("quota-exceeded", "Document history byte quota exceeded; no version was discarded");
    }
    if (versions) versions.push(record);
    else this.documents.set(record.documentKey, [record]);
    this.ids.add(record.id);
    this.documentBytes.set(record.documentKey, nextDocumentBytes);
    this.totalBytes += size;
  }

  private loadSnapshot(value: unknown): void {
    try {
      if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1 ||
        !("versions" in value) || !Array.isArray(value.versions)) throw new RangeError("Unsupported history snapshot");
      if (value.versions.length > this.maxDocuments * this.maxVersions) {
        throw new DocumentHistoryError("quota-exceeded", "History snapshot exceeds the record quota");
      }
      for (const record of value.versions) this.commit(validateRecord(record));
    } catch (error) {
      if (error instanceof DocumentHistoryError) throw error;
      throw new DocumentHistoryError("invalid-snapshot", error instanceof Error ? error.message : "Invalid history snapshot");
    }
  }
}
