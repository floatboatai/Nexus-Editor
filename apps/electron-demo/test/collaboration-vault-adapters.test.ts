import { describe, expect, it, vi } from "vitest";

import { asDocumentId, asFileId, hashMarkdown } from "@floatboat/nexus-plugin-collab";
import type {
  IpcContentVersion,
  PluginHostBridge,
  PluginStorageSnapshot,
  PluginVaultChangeEvent,
  VaultSessionId,
} from "../src/shared/plugin-ipc";
import {
  createPluginProjectionMetadataStore,
  createPluginVaultFileProjectionAdapter,
} from "../src/renderer/collaboration-vault-adapters";
import { createCollaborationEnrollmentStore } from "../src/renderer/collaboration-enrollment-store";

function asSessionId(value: string): VaultSessionId {
  return value as VaultSessionId;
}

function asVersion(value: string): IpcContentVersion {
  return value as IpcContentVersion;
}

function projectionGuard(file: { readonly id: ReturnType<typeof asFileId>; readonly path: string }) {
  return {
    metadata: {
      load: vi.fn(async () => ({
        revision: "1",
        record: {
          file,
          documentId: asDocumentId("document-for-projection-test"),
          base: null,
        },
      })),
    },
    authorizeProjectionWrite: vi.fn(async () => undefined),
  };
}

function bridgeHarness(): {
  readonly bridge: PluginHostBridge;
  emit(event: PluginVaultChangeEvent): void;
  seedStorage(snapshot: PluginStorageSnapshot, pluginId?: string): void;
  readonly write: ReturnType<typeof vi.fn>;
  readonly acquireProjectionWrite: ReturnType<typeof vi.fn>;
  readonly releaseProjectionWrite: ReturnType<typeof vi.fn>;
  readonly storageSave: ReturnType<typeof vi.fn>;
} {
  const listeners = new Set<(event: PluginVaultChangeEvent) => void>();
  let file = { path: "Notes/A.md", content: "base\n", version: asVersion("sha256:base") };
  const storages = new Map<string, PluginStorageSnapshot>();
  const write = vi.fn(async (
    _sessionId: VaultSessionId,
    path: string,
    content: string,
    options: {
      expectedVersion?: IpcContentVersion | null;
      operationId?: string;
      projectionWritePermit?: string;
    } = {},
  ) => {
    if (options.expectedVersion !== file.version) throw new Error("version conflict");
    file = { path, content, version: asVersion(`sha256:${content.length}`) };
    return { path, version: file.version, operationId: options.operationId ?? "host-op" };
  });
  const storageSave = vi.fn(async (pluginId: string, expectedRevision: number, data: unknown) => {
    const storage = storages.get(pluginId) ?? { found: false as const, revision: 0, data: null };
    if (storage.revision !== expectedRevision) return { ok: false as const, revision: storage.revision };
    const next = { found: true as const, revision: storage.revision + 1, data: structuredClone(data) };
    storages.set(pluginId, next);
    return { ok: true as const, revision: next.revision };
  });
  const acquireProjectionWrite = vi.fn(async (_sessionId: VaultSessionId, path: string) => ({
    path,
    permitId: "projection-permit-1",
  }));
  const releaseProjectionWrite = vi.fn(async () => ({ ok: true as const }));
  const bridge = {
    vault: {
      read: vi.fn(async (_sessionId: VaultSessionId, path: string) => ({ ...file, path })),
      write,
      acquireProjectionWrite,
      releaseProjectionWrite,
      onChanged(callback: (event: PluginVaultChangeEvent) => void) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
    storage: {
      async load(pluginId: string) {
        return structuredClone(storages.get(pluginId) ?? { found: false, revision: 0, data: null });
      },
      save: storageSave,
    },
  } as unknown as PluginHostBridge;
  return {
    bridge,
    emit(event) { for (const listener of listeners) listener(event); },
    seedStorage(snapshot, pluginId = "nexus-collaboration-projection") {
      storages.set(pluginId, structuredClone(snapshot));
    },
    write,
    acquireProjectionWrite,
    releaseProjectionWrite,
    storageSave,
  };
}

describe("Electron Host File Projection adapters", () => {
  it("holds a Host write permit while rechecking exact durable projection identity", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session-authorized-projection");
    const file = { id: asFileId("file-authorized"), path: "Notes/A.md" };
    const documentId = asDocumentId("document-authorized");
    const metadata = {
      load: vi.fn(async () => ({
        revision: "1",
        record: { file, documentId, base: null },
      })),
    };
    const authorizeProjectionWrite = vi.fn(async () => undefined);
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      metadata,
      authorizeProjectionWrite,
    });

    await expect(adapter.writeAtomic(file, "next\n", {
      expectedVersion: "sha256:base",
      echoToken: "projection-write-authorized",
    })).resolves.toMatchObject({ echoToken: "projection-write-authorized" });

    expect(harness.acquireProjectionWrite).toHaveBeenCalledWith(sessionId, file.path);
    expect(authorizeProjectionWrite).toHaveBeenCalledWith({
      fileId: file.id,
      path: file.path,
      documentId,
    }, {});
    expect(harness.write).toHaveBeenCalledWith(sessionId, file.path, "next\n", {
      expectedVersion: "sha256:base",
      operationId: "projection-write-authorized",
      projectionWritePermit: "projection-permit-1",
    });
    expect(harness.releaseProjectionWrite).toHaveBeenCalledWith(sessionId, "projection-permit-1");
  });

  it("binds an unenrolled join write to its exact Host opening operation and DocumentId", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session-opening-projection");
    const file = { id: asFileId("file-opening"), path: "Notes/A.md" };
    const documentId = asDocumentId("document-opening");
    const authorizeProjectionWrite = vi.fn(async () => undefined);
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      metadata: {
        load: vi.fn(async () => ({
          revision: "1",
          record: { file, documentId, base: null },
        })),
      },
      authorizeProjectionWrite,
      resolveUnenrolledProjectionOpening: () => ({
        documentId,
        operationId: "join-opening-a",
      }),
    });

    await adapter.writeAtomic(file, "joined\n", {
      expectedVersion: "sha256:base",
      echoToken: "opening-write",
    });

    expect(harness.acquireProjectionWrite).toHaveBeenCalledWith(
      sessionId,
      file.path,
      "join-opening-a",
    );
    expect(authorizeProjectionWrite).toHaveBeenCalledWith({
      fileId: file.id,
      path: file.path,
      documentId,
    }, { openingOperationId: "join-opening-a" });
  });

  it("does not grant unenrolled authority when projection metadata names another document", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session-mismatched-opening");
    const file = { id: asFileId("file-opening"), path: "Notes/A.md" };
    const metadataDocumentId = asDocumentId("document-metadata");
    const openingDocumentId = asDocumentId("document-opening");
    const denied = Object.assign(new Error("exact Enrollment required"), {
      code: "projection-identity-unavailable",
    });
    const authorizeProjectionWrite = vi.fn(async (_identity, options) => {
      if (!options.openingOperationId) throw denied;
    });
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      metadata: {
        load: vi.fn(async () => ({
          revision: "1",
          record: { file, documentId: metadataDocumentId, base: null },
        })),
      },
      authorizeProjectionWrite,
      resolveUnenrolledProjectionOpening: () => ({
        documentId: openingDocumentId,
        operationId: "join-opening-a",
      }),
    });

    await expect(adapter.writeAtomic(file, "wrong-document\n", {
      expectedVersion: "sha256:base",
      echoToken: "opening-write",
    })).rejects.toBe(denied);
    expect(authorizeProjectionWrite).toHaveBeenCalledWith(expect.objectContaining({
      documentId: metadataDocumentId,
    }), {});
    expect(harness.write).not.toHaveBeenCalled();
    expect(harness.releaseProjectionWrite).toHaveBeenCalledWith(sessionId, "projection-permit-1");
  });

  it("releases the Host permit without writing when durable projection authority is stale", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session-stale-projection");
    const file = { id: asFileId("file-stale"), path: "Notes/A.md" };
    const metadata = projectionGuard(file).metadata;
    const denied = Object.assign(new Error("enrollment removed"), {
      code: "projection-identity-unavailable",
    });
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      metadata,
      authorizeProjectionWrite: vi.fn(async () => { throw denied; }),
    });

    await expect(adapter.writeAtomic(file, "stale\n", {
      expectedVersion: "sha256:base",
      echoToken: "stale-write",
    })).rejects.toBe(denied);

    expect(harness.write).not.toHaveBeenCalled();
    expect(harness.releaseProjectionWrite).toHaveBeenCalledWith(sessionId, "projection-permit-1");
  });

  it("releases the Host permit when the admitted filesystem write fails", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session-failed-write");
    const file = { id: asFileId("file-failed-write"), path: "Notes/A.md" };
    const writeFailure = new Error("disk unavailable");
    harness.write.mockRejectedValueOnce(writeFailure);
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      ...projectionGuard(file),
    });

    await expect(adapter.writeAtomic(file, "next\n", {
      expectedVersion: "sha256:base",
      echoToken: "failed-write",
    })).rejects.toBe(writeFailure);
    expect(harness.releaseProjectionWrite).toHaveBeenCalledWith(sessionId, "projection-permit-1");
  });

  it("rejects a stale projection after enrollment deletion even with a fresh post-restart permit", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session-restarted-main");
    const file = { id: asFileId("file-deleted"), path: "Notes/A.md" };
    const documentId = asDocumentId("document-deleted");
    const metadata = createPluginProjectionMetadataStore({
      bridge: harness.bridge,
      pluginId: "projection-after-restart",
    });
    await metadata.save({ file, documentId, base: null }, null);
    const enrollments = createCollaborationEnrollmentStore({
      bridge: harness.bridge,
      pluginId: "enrollment-after-restart",
      operationIdGenerator: () => "forget-deleted-file",
    });
    const enrollment = await enrollments.upsert({
      fileId: file.id,
      path: file.path,
      documentId,
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    });
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      metadata,
      authorizeProjectionWrite: (identity, options) =>
        enrollments.assertProjectionWriteAuthorized(identity, options),
    });
    await adapter.writeAtomic(file, "next\n", {
      expectedVersion: "sha256:base",
      echoToken: "before-delete",
    });
    const deletion = await enrollments.forget(enrollment);
    await enrollments.completeForget(deletion!);
    harness.acquireProjectionWrite.mockResolvedValueOnce({
      path: file.path,
      permitId: "fresh-main-permit",
    });

    await expect(adapter.writeAtomic(file, "resurrected\n", {
      expectedVersion: "sha256:5",
      echoToken: "after-delete",
    })).rejects.toMatchObject({ code: "projection-identity-unavailable" });

    expect(harness.write).toHaveBeenCalledTimes(1);
    expect(harness.releaseProjectionWrite).toHaveBeenLastCalledWith(sessionId, "fresh-main-permit");
  });

  it("deletes only the exact Projection Base entry supplied to its CAS interface", async () => {
    const harness = bridgeHarness();
    const metadata = createPluginProjectionMetadataStore({ bridge: harness.bridge });
    const file = { id: asFileId("file-cas-delete"), path: "Notes/CAS.md" };
    const first = await metadata.save({
      file,
      documentId: asDocumentId("document-cas-delete"),
      base: null,
    }, null);
    const latest = await metadata.save({
      ...first.record,
      base: {
        markdown: "new base\n",
        contentHash: hashMarkdown("new base\n"),
        documentRevision: "2",
        fileVersion: "sha256:new",
      },
    }, first.revision);

    await expect(metadata.delete(first.record, first.revision)).rejects.toMatchObject({ code: "metadata-conflict" });
    await expect(metadata.load(file.id)).resolves.toEqual(latest);
    await expect(metadata.delete(latest.record, latest.revision)).resolves.toBe(true);
    await expect(metadata.delete(latest.record, latest.revision)).resolves.toBe(false);
    await expect(metadata.load(file.id)).resolves.toBeNull();
  });

  it("maps atomic versions and confirmed Host watcher echoes without exposing absolute paths", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session");
    const file = { id: asFileId("file-a"), path: "Notes/A.md" };
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      ...projectionGuard(file),
    });
    const changes: unknown[] = [];
    const watch = await adapter.watch(file, (change) => changes.push(change));

    const initial = await adapter.read(file);
    expect(initial).toEqual({ markdown: "base\n", version: "sha256:base" });
    const receipt = await adapter.writeAtomic(file, "next\n", {
      expectedVersion: "sha256:base",
      echoToken: "projection-write-1",
    });
    expect(receipt).toEqual({ version: "sha256:5", echoToken: "projection-write-1" });
    expect(harness.write).toHaveBeenCalledWith(sessionId, "Notes/A.md", "next\n", {
      expectedVersion: "sha256:base",
      operationId: "projection-write-1",
      projectionWritePermit: "projection-permit-1",
    });

    harness.emit({
      sessionId,
      kind: "modify",
      path: "Notes/A.md",
      version: asVersion("sha256:5"),
      operationId: "projection-write-1",
      origin: "host",
    });
    await vi.waitFor(() => expect(changes).toEqual([{
      kind: "changed",
      snapshot: {
        markdown: "next\n",
        version: "sha256:5",
        echoToken: "projection-write-1",
      },
    }]));
    await watch.dispose();
  });

  it("projects an ancestor folder rename onto the watched Markdown file identity", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session-folder-rename");
    const file = { id: asFileId("file-in-renamed-folder"), path: "Notes/A.md" };
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      ...projectionGuard(file),
    });
    const changes: unknown[] = [];
    const watch = await adapter.watch(file, (change) => changes.push(change));

    harness.emit({
      sessionId,
      kind: "rename",
      path: "Archive",
      oldPath: "Notes",
      operationId: "rename-folder-1",
      origin: "host",
    });

    await vi.waitFor(() => expect(changes).toEqual([{
      kind: "renamed",
      file: { id: file.id, path: "Archive/A.md" },
      snapshot: { markdown: "base\n", version: "sha256:base" },
    }]));
    await watch.dispose();
  });

  it("serializes back-to-back renames and preserves identity when the first rename read races", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session-rename-race");
    const file = { id: asFileId("file-rename-race"), path: "Notes/A.md" };
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      ...projectionGuard(file),
    });
    const changes: unknown[] = [];
    const watch = await adapter.watch(file, (change) => changes.push(change));
    let releaseFirstRead!: () => void;
    const firstReadBarrier = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
    vi.mocked(harness.bridge.vault.read).mockImplementationOnce(async () => {
      await firstReadBarrier;
      throw new Error("rename target was temporarily unavailable");
    });

    harness.emit({
      sessionId,
      kind: "rename",
      path: "Middle",
      oldPath: "Notes",
      origin: "external",
    });
    harness.emit({
      sessionId,
      kind: "rename",
      path: "Archive",
      oldPath: "Middle",
      origin: "external",
    });
    releaseFirstRead();

    await vi.waitFor(() => expect(changes).toEqual([
      {
        kind: "renamed",
        file: { id: file.id, path: "Middle/A.md" },
      },
      {
        kind: "renamed",
        file: { id: file.id, path: "Archive/A.md" },
        snapshot: { markdown: "base\n", version: "sha256:base" },
      },
    ]));
    await watch.dispose();
  });

  it("treats deletion of an ancestor folder as deletion of the watched Markdown file", async () => {
    const harness = bridgeHarness();
    const sessionId = asSessionId("vault-session-folder-delete");
    const file = { id: asFileId("file-in-deleted-folder"), path: "Notes/Nested/A.md" };
    const adapter = createPluginVaultFileProjectionAdapter({
      bridge: harness.bridge,
      sessionId,
      ...projectionGuard(file),
    });
    const changes: unknown[] = [];
    const watch = await adapter.watch(file, (change) => changes.push(change));

    harness.emit({
      sessionId,
      kind: "delete",
      path: "Notes",
      operationId: "delete-folder-1",
      origin: "host",
    });

    await vi.waitFor(() => expect(changes).toEqual([{ kind: "deleted" }]));
    await watch.dispose();
  });

  it("lets a second window reload and advance a per-entry compare-and-swap revision", async () => {
    const harness = bridgeHarness();
    const firstWindow = createPluginProjectionMetadataStore({ bridge: harness.bridge });
    const secondWindow = createPluginProjectionMetadataStore({ bridge: harness.bridge });
    const record = {
      file: { id: asFileId("stable-file"), path: "Notes/A.md" },
      documentId: asDocumentId("6e917066-f441-49ba-a116-906cb47d88f5"),
      base: {
        markdown: "base\n",
        contentHash: hashMarkdown("base\n"),
        documentRevision: "1",
        fileVersion: "sha256:base",
      },
    };

    await expect(firstWindow.load(record.file.id)).resolves.toBeNull();
    await expect(secondWindow.load(record.file.id)).resolves.toBeNull();
    const created = await firstWindow.save(record, null);
    expect(created).toMatchObject({ record, revision: "1" });
    await expect(secondWindow.save(record, null)).rejects.toMatchObject({ code: "metadata-conflict" });
    const reloaded = await secondWindow.load(record.file.id);
    await expect(secondWindow.save(
      { ...record, file: { ...record.file, path: "Moved/A.md" } },
      reloaded!.revision,
    )).resolves.toMatchObject({ revision: "2", record: { file: { path: "Moved/A.md" } } });
    await expect(firstWindow.save(record, "1")).rejects.toMatchObject({ code: "metadata-conflict" });
    await expect(firstWindow.load(record.file.id)).resolves.toMatchObject({
      revision: "2",
      record: { file: { path: "Moved/A.md" } },
    });
  });

  it("rejects a new metadata identity at capacity without writing an unreadable state", async () => {
    const harness = bridgeHarness();
    const entries = Array.from({ length: 10_000 }, (_, index) => ({
      revision: 1,
      record: {
        file: { id: `file-${index}`, path: `Notes/${index}.md` },
        documentId: `document-${index}`,
        base: null,
      },
    }));
    harness.seedStorage({
      found: true,
      revision: 1,
      data: { schemaVersion: 1, entries },
    });
    const metadata = createPluginProjectionMetadataStore({ bridge: harness.bridge });

    await expect(metadata.save({
      file: { id: asFileId("file-over-capacity"), path: "Notes/overflow.md" },
      documentId: asDocumentId("document-over-capacity"),
      base: null,
    }, null)).rejects.toMatchObject({ code: "metadata-write-failed" });

    expect(harness.storageSave).not.toHaveBeenCalled();
    await expect(metadata.load(asFileId("file-0"))).resolves.toMatchObject({
      revision: "1",
      record: { file: { path: "Notes/0.md" } },
    });
  });

  it("fails closed when a missing metadata envelope carries stale revision or data", async () => {
    const harness = bridgeHarness();
    harness.seedStorage({
      found: false,
      revision: 7,
      data: { schemaVersion: 1, entries: [] },
    });
    const metadata = createPluginProjectionMetadataStore({ bridge: harness.bridge });

    await expect(metadata.load(asFileId("file-from-invalid-envelope")))
      .rejects.toMatchObject({ code: "metadata-corrupt" });
  });

  it("fails closed when the Host quarantined corrupt projection metadata", async () => {
    const harness = bridgeHarness();
    harness.seedStorage({
      found: false,
      corrupt: true,
      revision: 0,
      data: null,
    });
    const metadata = createPluginProjectionMetadataStore({ bridge: harness.bridge });

    await expect(metadata.load(asFileId("file-from-quarantined-storage")))
      .rejects.toMatchObject({ code: "metadata-corrupt" });
  });

  it("fails closed when durable Projection Base Markdown does not match its content hash", async () => {
    const harness = bridgeHarness();
    harness.seedStorage({
      found: true,
      revision: 1,
      data: {
        schemaVersion: 1,
        entries: [{
          revision: 1,
          record: {
            file: { id: "file-corrupt-base", path: "Notes/Corrupt.md" },
            documentId: "document-corrupt-base",
            base: {
              markdown: "tampered\n",
              contentHash: "0000000000000000",
              documentRevision: "revision-1",
              fileVersion: "version-1",
            },
          },
        }],
      },
    });
    const metadata = createPluginProjectionMetadataStore({ bridge: harness.bridge });

    await expect(metadata.load(asFileId("file-corrupt-base")))
      .rejects.toMatchObject({ code: "metadata-corrupt" });
  });

  it("fails closed instead of hiding a non-canonical durable file identity", async () => {
    const harness = bridgeHarness();
    harness.seedStorage({
      found: true,
      revision: 1,
      data: {
        schemaVersion: 1,
        entries: [{
          revision: 1,
          record: {
            file: { id: " file-with-padding ", path: "Notes/A.md" },
            documentId: "document-corrupt-identity",
            base: null,
          },
        }],
      },
    });
    const metadata = createPluginProjectionMetadataStore({ bridge: harness.bridge });

    await expect(metadata.load(asFileId("some-other-file")))
      .rejects.toMatchObject({ code: "metadata-corrupt" });
  });
});
