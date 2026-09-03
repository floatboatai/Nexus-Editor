import {
  asDocumentId,
  asFileId,
  hashMarkdown,
  type ExternalFileChange,
  type DocumentId,
  type FileId,
  type FileProjectionAdapter,
  type FileProjectionRef,
  type FileSnapshot,
  type ProjectionMetadataEntry,
  type ProjectionMetadataRecord,
  type ProjectionMetadataStore,
} from "@floatboat/nexus-plugin-collab";
import { normalizeVaultPath } from "@floatboat/nexus-plugin-runtime";

import type {
  IpcContentVersion,
  PluginHostBridge,
  PluginStorageSnapshot,
  PluginVaultChangeEvent,
  VaultSessionId,
} from "../shared/plugin-ipc";

const METADATA_PLUGIN_ID = "nexus-collaboration-projection";
const MAX_METADATA_ENTRIES = 10_000;
const MAX_SAVE_ATTEMPTS = 8;

interface StoredProjectionEntry {
  readonly revision: number;
  readonly record: ProjectionMetadataRecord;
}

interface StoredProjectionState {
  readonly schemaVersion: 1;
  readonly entries: readonly StoredProjectionEntry[];
}

export class PluginProjectionMetadataError extends Error {
  constructor(
    readonly code: "metadata-conflict" | "metadata-corrupt" | "metadata-write-failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PluginProjectionMetadataError";
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseRecord(value: unknown): ProjectionMetadataRecord {
  const record = object(value);
  const file = object(record?.file);
  const base = record?.base === null ? null : object(record?.base);
  if (
    !record ||
    !file ||
    typeof file.id !== "string" ||
    typeof file.path !== "string" ||
    typeof record.documentId !== "string" ||
    (record.base !== null && (
      !base ||
      typeof base.markdown !== "string" ||
      typeof base.contentHash !== "string" ||
      base.contentHash !== hashMarkdown(base.markdown) ||
      typeof base.documentRevision !== "string" ||
      typeof base.fileVersion !== "string" ||
      (base.writeReceipt !== undefined && typeof base.writeReceipt !== "string")
    ))
  ) {
    throw new PluginProjectionMetadataError("metadata-corrupt", "Collaboration projection metadata is invalid");
  }
  try {
    const fileId = asFileId(file.id);
    const documentId = asDocumentId(record.documentId);
    const path = normalizeVaultPath(file.path);
    if (fileId !== file.id || documentId !== record.documentId || path !== file.path) {
      throw new TypeError("Projection metadata identity is not canonical");
    }
    const cloned = structuredClone(record) as unknown as ProjectionMetadataRecord;
    return {
      ...cloned,
      file: { id: fileId, path },
      documentId,
    };
  } catch (cause) {
    throw new PluginProjectionMetadataError(
      "metadata-corrupt",
      "Collaboration projection metadata identity is invalid",
      cause,
    );
  }
}

function parseState(snapshot: PluginStorageSnapshot): StoredProjectionState {
  if (snapshot.corrupt === true) {
    throw new PluginProjectionMetadataError(
      "metadata-corrupt",
      "The Host quarantined corrupt collaboration projection metadata",
    );
  }
  if (
    typeof snapshot.found !== "boolean" ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0
  ) {
    throw new PluginProjectionMetadataError("metadata-corrupt", "Projection metadata envelope is invalid");
  }
  if (!snapshot.found) {
    if (snapshot.revision !== 0 || snapshot.data !== null) {
      throw new PluginProjectionMetadataError("metadata-corrupt", "Missing projection metadata contains stale data");
    }
    return { schemaVersion: 1, entries: [] };
  }
  if (snapshot.revision < 1) {
    throw new PluginProjectionMetadataError("metadata-corrupt", "Projection metadata revision is invalid");
  }
  const data = object(snapshot.data);
  if (data?.schemaVersion !== 1 || !Array.isArray(data.entries) || data.entries.length > MAX_METADATA_ENTRIES) {
    throw new PluginProjectionMetadataError("metadata-corrupt", "Collaboration projection metadata is invalid");
  }
  const seen = new Set<string>();
  const entries = data.entries.map((value) => {
    const entry = object(value);
    const record = parseRecord(entry?.record);
    if (
      !entry ||
      !Number.isSafeInteger(entry.revision) ||
      (entry.revision as number) < 1 ||
      seen.has(record.file.id)
    ) {
      throw new PluginProjectionMetadataError("metadata-corrupt", "Collaboration projection metadata is invalid");
    }
    seen.add(record.file.id);
    return { revision: entry.revision as number, record };
  });
  return { schemaVersion: 1, entries };
}

function revision(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new PluginProjectionMetadataError("metadata-conflict", "Projection metadata revision is stale");
  }
  return parsed;
}

function sameRecord(left: ProjectionMetadataRecord, right: ProjectionMetadataRecord): boolean {
  if (
    left.file.id !== right.file.id ||
    left.file.path !== right.file.path ||
    left.documentId !== right.documentId
  ) return false;
  if (left.base === null || right.base === null) return left.base === right.base;
  return left.base.markdown === right.base.markdown &&
    left.base.contentHash === right.base.contentHash &&
    left.base.documentRevision === right.base.documentRevision &&
    left.base.fileVersion === right.base.fileVersion &&
    left.base.writeReceipt === right.base.writeReceipt;
}

export function createPluginProjectionMetadataStore(options: {
  readonly bridge: Pick<PluginHostBridge, "storage">;
  readonly pluginId?: string;
}): ProjectionMetadataStore {
  const pluginId = options.pluginId ?? METADATA_PLUGIN_ID;

  return {
    async load(fileId) {
      const state = parseState(await options.bridge.storage.load(pluginId));
      const found = state.entries.find((entry) => entry.record.file.id === fileId);
      return found
        ? { record: structuredClone(found.record), revision: String(found.revision) }
        : null;
    },

    async save(record, expectedRevision) {
      const safeRecord = parseRecord(record);
      const expected = expectedRevision === null ? null : revision(expectedRevision);
      for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
        const snapshot = await options.bridge.storage.load(pluginId);
        const state = parseState(snapshot);
        const index = state.entries.findIndex((entry) => entry.record.file.id === safeRecord.file.id);
        const current = index < 0 ? null : state.entries[index];
        if ((current?.revision ?? null) !== expected) {
          throw new PluginProjectionMetadataError("metadata-conflict", "Projection metadata changed before save");
        }
        if (index < 0 && state.entries.length >= MAX_METADATA_ENTRIES) {
          throw new PluginProjectionMetadataError(
            "metadata-write-failed",
            "Collaboration projection metadata reached its configured identity limit",
          );
        }
        const nextRevision = (current?.revision ?? 0) + 1;
        const entries = [...state.entries];
        const nextEntry = { revision: nextRevision, record: safeRecord };
        if (index < 0) entries.push(nextEntry);
        else entries[index] = nextEntry;
        const saved = await options.bridge.storage.save(pluginId, snapshot.revision, {
          schemaVersion: 1,
          entries,
        } satisfies StoredProjectionState);
        if (saved.ok) {
          return { record: structuredClone(safeRecord), revision: String(nextRevision) };
        }
      }
      throw new PluginProjectionMetadataError(
        "metadata-write-failed",
        "Projection metadata remained busy after bounded retries",
      );
    },

    async delete(record, expectedRevisionValue) {
      const expectedRecord = parseRecord(record);
      const expectedRevision = revision(expectedRevisionValue);
      for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
        const snapshot = await options.bridge.storage.load(pluginId);
        const state = parseState(snapshot);
        const index = state.entries.findIndex(
          (entry) => entry.record.file.id === expectedRecord.file.id,
        );
        if (index < 0) return false;
        const current = state.entries[index]!;
        if (
          current.revision !== expectedRevision ||
          !sameRecord(current.record, expectedRecord)
        ) {
          throw new PluginProjectionMetadataError(
            "metadata-conflict",
            "Projection metadata changed before delete",
          );
        }
        const saved = await options.bridge.storage.save(pluginId, snapshot.revision, {
          schemaVersion: 1,
          entries: state.entries.filter((_, candidateIndex) => candidateIndex !== index),
        } satisfies StoredProjectionState);
        if (saved.ok) return true;
      }
      throw new PluginProjectionMetadataError(
        "metadata-write-failed",
        "Projection metadata remained busy during delete",
      );
    },
  };
}

function isMissingFile(cause: unknown): boolean {
  const candidate = cause && typeof cause === "object"
    ? cause as { readonly code?: unknown; readonly message?: unknown }
    : undefined;
  return candidate?.code === "vault-path-invalid" || (
    typeof candidate?.message === "string" && candidate.message.includes("does not exist")
  );
}

function pathAfterRename(currentPath: string, oldPath: string, newPath: string): string | null {
  if (currentPath === oldPath) return newPath;
  const descendantPrefix = `${oldPath}/`;
  return currentPath.startsWith(descendantPrefix)
    ? `${newPath}/${currentPath.slice(descendantPrefix.length)}`
    : null;
}

function pathIsDeleted(currentPath: string, deletedPath: string): boolean {
  return currentPath === deletedPath || currentPath.startsWith(`${deletedPath}/`);
}

async function readFile(
  bridge: Pick<PluginHostBridge, "vault">,
  sessionId: VaultSessionId,
  file: FileProjectionRef,
  echoToken?: string,
): Promise<FileSnapshot | null> {
  try {
    const result = await bridge.vault.read(sessionId, file.path);
    return {
      markdown: result.content,
      version: result.version,
      ...(echoToken ? { echoToken } : {}),
    };
  } catch (cause) {
    if (isMissingFile(cause)) return null;
    throw cause;
  }
}

export function createPluginVaultFileProjectionAdapter(options: {
  readonly bridge: Pick<PluginHostBridge, "vault">;
  readonly sessionId: VaultSessionId;
  readonly metadata: Pick<ProjectionMetadataStore, "load">;
  readonly authorizeProjectionWrite: (
    identity: { readonly fileId: FileId; readonly path: string; readonly documentId: DocumentId },
    options: { readonly openingOperationId?: string },
  ) => Promise<void>;
  readonly resolveUnenrolledProjectionOpening?: (file: {
    readonly fileId: FileId;
    readonly path: string;
  }) => {
    readonly operationId: string;
    readonly documentId: DocumentId;
  } | undefined;
}): FileProjectionAdapter {
  const { bridge, sessionId } = options;
  return {
    read: (file) => readFile(bridge, sessionId, file),

    async writeAtomic(file, markdown, writeOptions) {
      const opening = options.resolveUnenrolledProjectionOpening?.({
        fileId: file.id,
        path: file.path,
      });
      const permit = opening === undefined
        ? await bridge.vault.acquireProjectionWrite(sessionId, file.path)
        : await bridge.vault.acquireProjectionWrite(sessionId, file.path, opening.operationId);
      let result: Awaited<ReturnType<PluginHostBridge["vault"]["write"]>> | undefined;
      let failure: unknown;
      try {
        const metadata = await options.metadata.load(file.id);
        if (
          !metadata ||
          metadata.record.file.id !== file.id ||
          metadata.record.file.path !== file.path
        ) {
          throw new PluginProjectionMetadataError(
            "metadata-conflict",
            "The collaboration projection identity changed before its Host write",
          );
        }
        const identity = {
          fileId: file.id,
          path: file.path,
          documentId: metadata.record.documentId,
        };
        const currentOpening = options.resolveUnenrolledProjectionOpening?.({
          fileId: identity.fileId,
          path: identity.path,
        });
        const openingOperationId = opening !== undefined &&
            currentOpening?.operationId === opening.operationId &&
            currentOpening.documentId === identity.documentId &&
            opening.documentId === identity.documentId
          ? opening.operationId
          : undefined;
        await options.authorizeProjectionWrite(identity, {
          ...(openingOperationId === undefined ? {} : { openingOperationId }),
        });
        result = await bridge.vault.write(sessionId, file.path, markdown, {
          expectedVersion: writeOptions.expectedVersion as IpcContentVersion | null,
          operationId: writeOptions.echoToken,
          projectionWritePermit: permit.permitId,
        });
      } catch (cause) {
        failure = cause;
      }
      try {
        await bridge.vault.releaseProjectionWrite(sessionId, permit.permitId);
      } catch (releaseFailure) {
        if (failure !== undefined) {
          throw new AggregateError(
            [failure, releaseFailure],
            "Projection write and Host permit release both failed",
          );
        }
        throw releaseFailure;
      }
      if (failure !== undefined) throw failure;
      if (!result) throw new Error("Vault Host returned no atomic-write receipt");
      if (!result.version || result.operationId !== writeOptions.echoToken) {
        throw new Error("Vault Host returned an invalid atomic-write receipt");
      }
      return { version: result.version, echoToken: result.operationId };
    },

    async watch(initialFile, listener) {
      let currentFile = initialFile;
      let disposed = false;
      let queue = Promise.resolve();

      const emitSnapshot = async (
        change: Extract<ExternalFileChange, { readonly kind: "changed" | "replaced" }>["kind"],
        event: PluginVaultChangeEvent,
      ) => {
        const snapshot = await readFile(
          bridge,
          sessionId,
          currentFile,
          event.origin === "host" ? event.operationId : undefined,
        );
        if (disposed) return;
        if (!snapshot) listener({ kind: "deleted" });
        else if (!event.version || snapshot.version === event.version) listener({ kind: change, snapshot });
        else listener({ kind: change });
      };

      const unsubscribe = bridge.vault.onChanged((event) => {
        if (disposed || event.sessionId !== sessionId) return;
        let failureFallback: ExternalFileChange | null = null;
        queue = queue.then(async () => {
          if (disposed) return;
          const renamedPath = event.kind === "rename" && event.oldPath
            ? pathAfterRename(currentFile.path, event.oldPath, event.path)
            : null;
          const deleted = event.kind === "delete" && pathIsDeleted(currentFile.path, event.path);
          const relevant = event.path === currentFile.path || event.oldPath === currentFile.path || renamedPath !== null || deleted;
          if (!relevant && event.kind !== "rescan") return;
          failureFallback = { kind: "changed" };
          if (deleted) {
            listener({ kind: "deleted" });
            return;
          }
          if (event.kind === "rename" && renamedPath !== null) {
            currentFile = { id: asFileId(currentFile.id), path: renamedPath };
            failureFallback = { kind: "renamed", file: currentFile };
            const snapshot = await readFile(bridge, sessionId, currentFile);
            listener({ kind: "renamed", file: currentFile, ...(snapshot ? { snapshot } : {}) });
            return;
          }
          await emitSnapshot(event.kind === "create" ? "replaced" : "changed", event);
        }).catch(() => {
          if (!disposed && failureFallback) listener(failureFallback);
        });
      });

      return {
        async dispose() {
          if (disposed) return;
          disposed = true;
          unsubscribe();
          await queue;
        },
      };
    },
  };
}
