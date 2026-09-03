// @vitest-environment jsdom

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import {
  asDocumentId,
  asFileId,
} from "@floatboat/nexus-plugin-collab";
import { createHocuspocusProviderFactory } from "@floatboat/nexus-plugin-collab/hocuspocus";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSqliteReplicaStore,
  type SqliteReplicaStore,
} from "../../electron-demo/electron/collab-sqlite-store";
import {
  ElectronPluginStorageBroker,
  ElectronVaultBroker,
  type SenderIdentity,
} from "../../electron-demo/electron/plugin-host-broker";
import { createCollaborationEnrollmentStore } from "../../electron-demo/src/renderer/collaboration-enrollment-store";
import {
  decodeCollaborationInvitation,
  encodeCollaborationInvitation,
} from "../../electron-demo/src/renderer/collaboration-network-adapters";
import {
  createPluginProjectionMetadataStore,
  createPluginVaultFileProjectionAdapter,
} from "../../electron-demo/src/renderer/collaboration-vault-adapters";
import {
  createCollaborationWorkspace,
  type CollaborationWorkspace,
  type CollaborationWorkspaceFile,
} from "../../electron-demo/src/renderer/collaboration-workspace";
import {
  createElectronCollaborationBackendFactory,
  createElectronProjectionOpeningCoordinator,
} from "../../electron-demo/src/renderer/electron-collaboration-product";
import type {
  IpcContentVersion,
  PluginHostBridge,
  PluginVaultChangeEvent,
  PluginVaultProjectionOpeningOwner,
  VaultId,
  VaultSessionId,
} from "../../electron-demo/src/shared/plugin-ipc";
import { createCollaborationServer, type CollaborationServer } from "../src";

const AUTH_SECRET = "electron-product-stack-qualification-secret";
const DOCUMENT_ID = asDocumentId("3d76b5a8-bcd1-4d8a-a0af-11dc626ae345");
const FILE_PATH = "Notes/Qualification.md";
const INITIAL_MARKDOWN = "# Product stack qualification\n";
const EDITED_MARKDOWN = `${INITIAL_MARKDOWN}\nEdited through Core Editor A.\n`;
const localRequire = createRequire(import.meta.url);

const roots: string[] = [];
const servers: CollaborationServer[] = [];
const workspaces: CollaborationWorkspace[] = [];
const stores: SqliteReplicaStore[] = [];
const editors: EditorAPI[] = [];
const hosts: DurableElectronHost[] = [];
let hostSequence = 0;

function removeTracked<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

async function sqliteCapability(): Promise<typeof import("node:sqlite")> {
  try {
    const sqlite = localRequire("node:sqlite") as typeof import("node:sqlite");
    if (typeof sqlite.DatabaseSync !== "function") throw new TypeError("DatabaseSync is unavailable");
    return sqlite;
  } catch (cause) {
    throw new Error(
      "Electron product-stack qualification requires node:sqlite; an unsupported runtime must not pass",
      { cause },
    );
  }
}

async function openStore(databasePath: string): Promise<SqliteReplicaStore> {
  const sqlite = await sqliteCapability();
  const store = await createSqliteReplicaStore({
    databasePath,
    loadSqlite: async () => sqlite,
  });
  stores.push(store);
  return store;
}

async function closeStore(store: SqliteReplicaStore): Promise<void> {
  await store.close();
  removeTracked(stores, store);
}

async function startServer(storageDirectory: string): Promise<CollaborationServer> {
  const server = createCollaborationServer({
    address: "127.0.0.1",
    port: 0,
    storageDirectory,
    authSecret: AUTH_SECRET,
    persistenceDebounceMs: 5,
    persistenceMaxDebounceMs: 20,
  });
  await server.start();
  servers.push(server);
  return server;
}

async function stopServer(server: CollaborationServer): Promise<void> {
  await server.stop();
  removeTracked(servers, server);
}

interface DurableElectronHost {
  readonly bridge: Pick<PluginHostBridge, "vault" | "storage">;
  readonly sessionId: VaultSessionId;
  readonly vaultId: VaultId;
  close(): Promise<void>;
}

async function openDurableElectronHost(
  vaultRoot: string,
  storageRoot: string,
): Promise<DurableElectronHost> {
  const sequence = ++hostSequence;
  const sender: SenderIdentity = { id: sequence, url: "app://nexus/index.html" };
  const listeners = new Set<(event: PluginVaultChangeEvent) => void>();
  let operationSequence = 0;
  const vault = new ElectronVaultBroker({
    isSenderAuthorized: (candidate) => candidate.id === sender.id && candidate.url === sender.url,
    trashItem: async () => undefined,
    watchFactory: () => ({ close() {} }),
    onChange: (senderId, event) => {
      if (senderId !== sender.id) return;
      for (const listener of [...listeners]) listener(event);
    },
    sessionId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, "0")}`,
    operationId: () => `qualification-operation-${sequence}-${++operationSequence}`,
  });
  const storage = new ElectronPluginStorageBroker(storageRoot);
  const session = await vault.openSession(sender, vaultRoot);
  const bridge = {
    vault: {
      read: (sessionId: VaultSessionId, path: string) => vault.read(sender, sessionId, path),
      write: (
        sessionId: VaultSessionId,
        path: string,
        content: string,
        options?: {
          readonly expectedVersion?: IpcContentVersion | null;
          readonly operationId?: string;
          readonly projectionWritePermit?: string;
        },
      ) => vault.write(sender, sessionId, path, content, options),
      acquireProjectionWrite: (
        sessionId: VaultSessionId,
        path: string,
        projectionOpeningOperationId?: string,
      ) => vault.acquireProjectionWrite(sender, sessionId, path, projectionOpeningOperationId),
      async releaseProjectionWrite(sessionId: VaultSessionId, permitId: string) {
        vault.releaseProjectionWrite(sender, sessionId, permitId);
        return { ok: true as const };
      },
      reserveProjectionOpening: (
        sessionId: VaultSessionId,
        path: string,
        documentId: string,
        operationId: string,
        recoveryOwner?: PluginVaultProjectionOpeningOwner,
      ) => vault.reserveProjectionOpening(
        sender,
        sessionId,
        path,
        documentId,
        operationId,
        recoveryOwner,
      ),
      commitProjectionOpening: (
        sessionId: VaultSessionId,
        path: string,
        documentId: string,
        operationId: string,
      ) => vault.commitProjectionOpening(sender, sessionId, path, documentId, operationId),
      listProjectionOpenings: (sessionId: VaultSessionId) =>
        vault.listProjectionOpenings(sender, sessionId),
      async releaseProjectionOpening(
        sessionId: VaultSessionId,
        path: string,
        documentId: string,
        operationId: string,
      ) {
        return {
          released: await vault.releaseProjectionOpening(
            sender,
            sessionId,
            path,
            documentId,
            operationId,
          ),
        };
      },
      reserveDeletion: (
        sessionId: VaultSessionId,
        path: string,
        operationId: string,
        state?: "precommit" | "committed",
      ) => vault.reserveDeletion(sender, sessionId, path, operationId, state),
      listDeletionFences: (sessionId: VaultSessionId) => vault.listDeletionFences(sender, sessionId),
      async releaseDeletion(sessionId: VaultSessionId, path: string, operationId: string) {
        return { released: await vault.releaseDeletion(sender, sessionId, path, operationId) };
      },
      onChanged(callback: (event: PluginVaultChangeEvent) => void) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
    storage: {
      load: (pluginId: string) => storage.load(pluginId),
      save: (pluginId: string, expectedRevision: number, data: unknown) =>
        storage.save(pluginId, expectedRevision, data),
    },
  } as unknown as Pick<PluginHostBridge, "vault" | "storage">;
  let closed = false;
  const host: DurableElectronHost = {
    bridge,
    sessionId: session.sessionId,
    vaultId: session.vaultId,
    async close() {
      if (closed) return;
      closed = true;
      vault.closeAll();
      listeners.clear();
      await storage.drain();
      removeTracked(hosts, host);
    },
  };
  hosts.push(host);
  return host;
}

function openEditor(markdown: string): { readonly api: EditorAPI; readonly container: HTMLElement } {
  const container = document.createElement("div");
  document.body.append(container);
  const api = createEditor({ container, initialValue: markdown });
  editors.push(api);
  return { api, container };
}

function closeEditor(editor: EditorAPI, container: HTMLElement): void {
  editor.destroy();
  container.remove();
  removeTracked(editors, editor);
}

function workspaceFile(
  editor: EditorAPI,
  container: HTMLElement,
  markdown: string,
): CollaborationWorkspaceFile {
  return {
    path: FILE_PATH,
    title: "Qualification",
    markdown,
    editor,
    setReadOnly(readOnly) {
      if (readOnly) container.dataset.collaborationReadOnly = "true";
      else delete container.dataset.collaborationReadOnly;
    },
  };
}

function openWorkspace(
  host: DurableElectronHost,
  store: SqliteReplicaStore,
  fileId: string,
): CollaborationWorkspace {
  const metadata = createPluginProjectionMetadataStore({
    bridge: host.bridge,
    pluginId: "qualification-projection",
  });
  const enrollments = createCollaborationEnrollmentStore({
    bridge: host.bridge,
    pluginId: "qualification-enrollment",
  });
  let openingSequence = 0;
  const openings = createElectronProjectionOpeningCoordinator({
    enrollments,
    metadata,
    vaultId: host.vaultId,
    operationId: () => `qualification-opening-${++openingSequence}`,
    host: {
      reserve: (identity, operationId, recoveryOwner) =>
        host.bridge.vault.reserveProjectionOpening(
          host.sessionId,
          identity.path,
          identity.documentId,
          operationId,
          recoveryOwner,
        ),
      commit: (identity, operationId) => host.bridge.vault.commitProjectionOpening(
        host.sessionId,
        identity.path,
        identity.documentId,
        operationId,
      ),
      list: () => host.bridge.vault.listProjectionOpenings(host.sessionId),
      release: (identity, operationId) => host.bridge.vault.releaseProjectionOpening(
        host.sessionId,
        identity.path,
        identity.documentId,
        operationId,
      ),
    },
  });
  const files = createPluginVaultFileProjectionAdapter({
    bridge: host.bridge,
    sessionId: host.sessionId,
    metadata,
    authorizeProjectionWrite: (identity, options) =>
      enrollments.assertProjectionWriteAuthorized(identity, options),
    resolveUnenrolledProjectionOpening: (file) => openings.resolve(file),
  });
  const backends = createElectronCollaborationBackendFactory({
    store,
    files,
    metadata,
    invitationIdGenerator: () => "qualification-client-b",
    invitationLifetimeSeconds: 300,
    createProvider: (serverUrl, resolveToken) => createHocuspocusProviderFactory({
      url: serverUrl,
      token: resolveToken,
      initialSyncTimeoutMs: 3_000,
      reconnect: {
        initialDelayMs: 10,
        maximumDelayMs: 100,
        maximumAttempts: 5,
        jitter: false,
      },
    }),
  });
  const workspace = createCollaborationWorkspace({
    enrollments,
    backends,
    projectionMetadata: metadata,
    joinTransactions: openings,
    createFileId: () => asFileId(fileId),
  });
  workspaces.push(workspace);
  return workspace;
}

async function closeWorkspace(workspace: CollaborationWorkspace): Promise<void> {
  await workspace.close();
  removeTracked(workspaces, workspace);
}

afterEach(async () => {
  await Promise.allSettled(
    workspaces.splice(0).reverse().map((workspace) => workspace.close({ discardUnprojected: true })),
  );
  await Promise.allSettled(stores.splice(0).reverse().map((store) => store.close()));
  for (const editor of editors.splice(0).reverse()) editor.destroy();
  await Promise.allSettled(hosts.splice(0).reverse().map((host) => host.close()));
  await Promise.allSettled(servers.splice(0).reverse().map((server) => server.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  document.body.replaceChildren();
});

describe("Electron collaboration product-stack qualification", () => {
  it("does not trust a seeded durable Replica when a join credential is invalid, wrong-room, or revoked", async () => {
    const root = await mkdtemp(join(tmpdir(), "nexus-electron-product-auth-gate-"));
    roots.push(root);
    const vault = join(root, "client", "vault");
    const note = join(vault, FILE_PATH);
    await mkdir(join(vault, "Notes"), { recursive: true });
    await writeFile(note, INITIAL_MARKDOWN);

    const server = await startServer(join(root, "server"));
    const ownerCredential = await server.tokens.issue({
      userId: "cache-owner",
      documentId: DOCUMENT_ID,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const host = await openDurableElectronHost(vault, join(root, "client", "plugin-storage"));
    const store = await openStore(join(root, "client", "replica.sqlite3"));
    const surface = openEditor(INITIAL_MARKDOWN);
    const workspace = openWorkspace(host, store, "seeded-cache-file");
    const currentFile = workspaceFile(surface.api, surface.container, INITIAL_MARKDOWN);

    await workspace.create({
      file: currentFile,
      serverUrl: server.websocketUrl,
      documentId: DOCUMENT_ID,
      credential: {
        token: ownerCredential.token,
        userId: "cache-owner",
        role: "editor",
      },
      displayName: "Cache owner",
    });
    await server.waitForPersistence(DOCUMENT_ID);
    await workspace.leave();
    await expect(workspace.forget(FILE_PATH)).resolves.toBe(true);

    const wrongRoomCredential = await server.tokens.issue({
      userId: "wrong-room-invitee",
      documentId: "another-document",
      role: "reader",
      lifetimeSeconds: 300,
    });
    const revokedCredential = await server.tokens.issue({
      userId: "revoked-invitee",
      documentId: DOCUMENT_ID,
      role: "reader",
      lifetimeSeconds: 300,
    });
    await server.revokeToken(revokedCredential.tokenId, revokedCredential.expiresAt);
    const futureExpiry = Math.floor(Date.now() / 1_000) + 300;
    const cases = [
      {
        label: "invalid",
        token: "invalid.header.signature",
        userId: "invalid-invitee",
        expiresAt: futureExpiry,
        code: "authentication-denied",
      },
      {
        label: "wrong-room",
        token: wrongRoomCredential.token,
        userId: "wrong-room-invitee",
        expiresAt: wrongRoomCredential.expiresAt,
        code: "authentication-denied",
      },
      {
        label: "revoked",
        token: revokedCredential.token,
        userId: "revoked-invitee",
        expiresAt: revokedCredential.expiresAt,
        code: "authorization-revoked",
      },
    ] as const;

    for (const authCase of cases) {
      const invitation = encodeCollaborationInvitation({
        version: 1,
        serverUrl: server.websocketUrl,
        documentId: DOCUMENT_ID,
        userId: authCase.userId,
        role: "reader",
        token: authCase.token,
        expiresAt: authCase.expiresAt,
      });

      await expect(workspace.join({
        file: currentFile,
        invitation,
        displayName: `${authCase.label} participant`,
      })).rejects.toMatchObject({ code: authCase.code });
      expect(workspace.getState()).toMatchObject({ phase: "failed", attachment: "none" });
      expect(workspace.getState().session).toBeUndefined();
      await expect(workspace.findEnrollment(FILE_PATH)).resolves.toBeNull();
      expect(surface.api.getDocument()).toBe(INITIAL_MARKDOWN);
      expect(surface.container.dataset.collaborationReadOnly).toBeUndefined();
    }
  }, 30_000);

  it("creates, invites, joins, projects, and restores an offline SQLite-backed Workspace", async () => {
    const sqlite = await sqliteCapability();
    expect(typeof sqlite.DatabaseSync).toBe("function");

    const root = await mkdtemp(join(tmpdir(), "nexus-electron-product-stack-"));
    roots.push(root);
    const vaultA = join(root, "client-a", "vault");
    const vaultB = join(root, "client-b", "vault");
    const noteA = join(vaultA, FILE_PATH);
    const noteB = join(vaultB, FILE_PATH);
    const databaseA = join(root, "client-a", "replica.sqlite3");
    const databaseB = join(root, "client-b", "replica.sqlite3");
    await Promise.all([
      mkdir(join(vaultA, "Notes"), { recursive: true }),
      mkdir(join(vaultB, "Notes"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(noteA, INITIAL_MARKDOWN),
      writeFile(noteB, INITIAL_MARKDOWN),
    ]);
    expect(databaseA).not.toBe(databaseB);

    const server = await startServer(join(root, "server"));
    const ownerCredential = await server.tokens.issue({
      userId: "qualification-client-a",
      documentId: DOCUMENT_ID,
      role: "editor",
      lifetimeSeconds: 1_800,
    });
    const hostA = await openDurableElectronHost(vaultA, join(root, "client-a", "plugin-storage"));
    let hostB = await openDurableElectronHost(vaultB, join(root, "client-b", "plugin-storage"));
    const storeA = await openStore(databaseA);
    let storeB = await openStore(databaseB);
    const surfaceA = openEditor(INITIAL_MARKDOWN);
    let surfaceB = openEditor(INITIAL_MARKDOWN);
    const workspaceA = openWorkspace(hostA, storeA, "qualification-file-a");
    let workspaceB = openWorkspace(hostB, storeB, "qualification-file-b");

    await workspaceA.create({
      file: workspaceFile(surfaceA.api, surfaceA.container, INITIAL_MARKDOWN),
      serverUrl: server.websocketUrl,
      documentId: DOCUMENT_ID,
      credential: {
        token: ownerCredential.token,
        userId: "qualification-client-a",
        role: "editor",
      },
      displayName: "Client A",
    });
    const invitation = await workspaceA.createInvite("editor");
    const invitedCredential = decodeCollaborationInvitation(invitation.value);
    await workspaceB.join({
      file: workspaceFile(surfaceB.api, surfaceB.container, INITIAL_MARKDOWN),
      invitation: invitation.value,
      displayName: "Client B",
    });

    await vi.waitFor(() => {
      expect(workspaceA.getState()).toMatchObject({
        phase: "active",
        attachment: "attached",
        serverPersistence: "server-synchronized",
      });
      expect(workspaceB.getState()).toMatchObject({
        phase: "active",
        attachment: "attached",
        serverPersistence: "server-synchronized",
      });
    }, { timeout: 5_000, interval: 20 });

    expect(surfaceA.api.dispatchTransaction({
      changes: [{ from: INITIAL_MARKDOWN.length, to: INITIAL_MARKDOWN.length, insert: "\nEdited through Core Editor A.\n" }],
      origin: ["qualification-user-edit"],
    })).toMatchObject({ status: "success" });
    await vi.waitFor(() => expect(surfaceB.api.getDocument()).toBe(EDITED_MARKDOWN), {
      timeout: 5_000,
      interval: 20,
    });

    await Promise.all([
      workspaceA.flushFileProjection(),
      workspaceB.flushFileProjection(),
    ]);
    await server.waitForPersistence(DOCUMENT_ID);
    await expect(readFile(noteA, "utf8")).resolves.toBe(EDITED_MARKDOWN);
    await expect(readFile(noteB, "utf8")).resolves.toBe(EDITED_MARKDOWN);
    expect(workspaceA.getState().session?.projection.projection).toBe("clean");
    expect(workspaceB.getState().session?.projection.projection).toBe("clean");

    await closeWorkspace(workspaceB);
    await closeStore(storeB);
    closeEditor(surfaceB.api, surfaceB.container);
    await hostB.close();
    await stopServer(server);

    hostB = await openDurableElectronHost(vaultB, join(root, "client-b", "plugin-storage"));
    storeB = await openStore(databaseB);
    const restoredMarkdown = await readFile(noteB, "utf8");
    surfaceB = openEditor(restoredMarkdown);
    workspaceB = openWorkspace(hostB, storeB, "unused-on-resume");
    await workspaceB.resume({
      file: workspaceFile(surfaceB.api, surfaceB.container, restoredMarkdown),
      credential: {
        token: invitedCredential.token,
        userId: invitedCredential.userId,
        role: invitedCredential.role,
      },
      displayName: "Client B restored",
    });

    expect(surfaceB.api.getDocument()).toBe(EDITED_MARKDOWN);
    expect(workspaceB.getState()).toMatchObject({
      phase: "active",
      attachment: "attached",
      enrollment: {
        documentId: DOCUMENT_ID,
        access: "editor",
        path: FILE_PATH,
      },
      session: {
        collaboration: { access: "local-only", persistence: "clean" },
        projection: { projection: "clean" },
      },
    });
  }, 30_000);
});
