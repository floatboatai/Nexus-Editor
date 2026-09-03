// @vitest-environment jsdom

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEditor } from "@floatboat/nexus-core";
import {
  asDocumentId,
  createCollaborationEngine,
  type CollaborationEngine,
  type CollaborationReplicaPort,
} from "@floatboat/nexus-plugin-collab";
import {
  createAssessmentMemoryStore,
  createAssessmentProviderHub,
} from "@floatboat/nexus-plugin-collab/assessment";
import { createHocuspocusProviderFactory } from "@floatboat/nexus-plugin-collab/hocuspocus";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  createCollaborationServer,
  createFileDocumentStore,
  type CollaborationServer,
} from "../src";
import {
  DocumentOperationGate,
  tokenOperationKey,
} from "../src/document-operation-gate";

const secret = "integration-only-secret-that-is-at-least-thirty-two-bytes";
const roots: string[] = [];
const servers: CollaborationServer[] = [];
const engines: CollaborationEngine[] = [];

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nexus-collab-e2e-"));
  roots.push(root);
  return root;
}

async function startServer(
  directory: string,
  overrides: {
    readonly port?: number;
    readonly maxMessageBytes?: number;
    readonly maxDocumentBytes?: number;
    readonly maxAuthenticatedQueueBytes?: number;
    readonly maxAuthenticatedQueueMessages?: number;
    readonly persistenceDebounceMs?: number;
    readonly persistenceMaxDebounceMs?: number;
    readonly shutdownTimeoutMs?: number;
  } = {},
): Promise<CollaborationServer> {
  const server = createCollaborationServer({
    address: "127.0.0.1",
    port: 0,
    storageDirectory: directory,
    authSecret: secret,
    persistenceDebounceMs: 5,
    persistenceMaxDebounceMs: 20,
    ...overrides,
  });
  await server.start();
  servers.push(server);
  return server;
}

async function engineFor(
  server: CollaborationServer,
  token: string,
  captureReplica?: (replica: CollaborationReplicaPort) => void,
): Promise<CollaborationEngine> {
  const provider = createHocuspocusProviderFactory({
    url: server.websocketUrl,
    token: () => token,
    initialSyncTimeoutMs: 5_000,
    reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 5, jitter: false },
  });
  const engine = createCollaborationEngine({
    providers: captureReplica ? {
      async prepare(context) {
        captureReplica(context.replica);
        return provider.prepare(context);
      },
    } : provider,
    store: { mode: "volatile" },
  });
  engines.push(engine);
  return engine;
}

function frameByteLength(data: string | ArrayBufferLike | Blob | ArrayBufferView): number {
  if (typeof data === "string") return new TextEncoder().encode(data).byteLength;
  if (data instanceof Blob) return data.size;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return data.byteLength;
}

function copyFrameBytes(
  data: string | ArrayBufferLike | Blob | ArrayBufferView,
): Uint8Array | undefined {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Blob) return undefined;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }
  return new Uint8Array(data).slice();
}

function readVarUint(bytes: Uint8Array, cursor: { offset: number }): number {
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < 8; index += 1) {
    const byte = bytes[cursor.offset++];
    if (byte === undefined) throw new RangeError("Truncated WebSocket frame");
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return value;
    multiplier *= 128;
  }
  throw new RangeError("WebSocket frame integer exceeds bounds");
}

function readVarString(bytes: Uint8Array, cursor: { offset: number }): string {
  const length = readVarUint(bytes, cursor);
  const end = cursor.offset + length;
  if (end > bytes.byteLength) throw new RangeError("Truncated WebSocket frame string");
  const value = new TextDecoder().decode(bytes.subarray(cursor.offset, end));
  cursor.offset = end;
  return value;
}

async function closeReasonFromFrame(data: unknown): Promise<string | undefined> {
  let bytes: Uint8Array;
  if (data instanceof Blob) {
    bytes = new Uint8Array(await data.arrayBuffer());
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    return undefined;
  }
  try {
    const cursor = { offset: 0 };
    readVarString(bytes, cursor);
    return readVarUint(bytes, cursor) === 7 ? readVarString(bytes, cursor) : undefined;
  } catch {
    return undefined;
  }
}

class ObservedWebSocket extends WebSocket {
  static readonly instances: ObservedWebSocket[] = [];
  static readonly sentFrames: Uint8Array[] = [];
  static readonly sentFrameBytes: number[] = [];
  static readonly documentCloseReasons: string[] = [];
  static readonly socketCloseReasons: string[] = [];

  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    ObservedWebSocket.instances.push(this);
    this.addEventListener("message", (event) => {
      void closeReasonFromFrame(event.data).then((reason) => {
        if (reason) ObservedWebSocket.documentCloseReasons.push(reason);
      });
    });
    this.addEventListener("close", (event) => {
      if (event.reason) ObservedWebSocket.socketCloseReasons.push(event.reason);
    });
  }

  override send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    ObservedWebSocket.sentFrameBytes.push(frameByteLength(data));
    const frame = copyFrameBytes(data);
    if (frame) ObservedWebSocket.sentFrames.push(frame);
    super.send(data);
  }

  static reset(): void {
    this.instances.length = 0;
    this.sentFrames.length = 0;
    this.sentFrameBytes.length = 0;
    this.documentCloseReasons.length = 0;
    this.socketCloseReasons.length = 0;
  }
}

function protocolTypes(frame: Uint8Array): { message: number; sync?: number } | undefined {
  try {
    const cursor = { offset: 0 };
    readVarString(frame, cursor);
    const message = readVarUint(frame, cursor);
    return message === 0 ? { message, sync: readVarUint(frame, cursor) } : { message };
  } catch {
    return undefined;
  }
}

function editor(initialValue: string) {
  const container = document.createElement("div");
  document.body.append(container);
  return { api: createEditor({ container, initialValue }), container };
}

afterEach(async () => {
  await Promise.allSettled(engines.splice(0).map((engine) => engine.close()));
  await Promise.allSettled(servers.splice(0).map((server) => server.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  document.body.replaceChildren();
});

describe("Hocuspocus collaboration deployment", () => {
  it("waits for the latest server-observed generation instead of consuming an older store", async () => {
    const directory = await temporaryDirectory();
    const server = await startServer(directory, {
      persistenceDebounceMs: 200,
      persistenceMaxDebounceMs: 400,
    });
    const documentId = asDocumentId("document-persistence-generation");
    const credential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const writer = await engineFor(server, credential.token);
    const writerDocument = await writer.create(
      { id: documentId },
      { initialMarkdown: "first durable generation" },
    );
    const store = createFileDocumentStore({ directory });

    await vi.waitFor(async () => {
      const update = await store.fetch(documentId);
      if (!update) throw new Error("The first generation is not durable yet");
      const restored = new Y.Doc();
      try {
        Y.applyUpdate(restored, update);
        expect(restored.getText("content").toString()).toBe("first durable generation");
      } finally {
        restored.destroy();
      }
    });

    const reader = await engineFor(server, credential.token);
    const readerDocument = await reader.open({ id: documentId });
    const snapshot = writerDocument.getMarkdownSnapshot();
    expect(snapshot).toBeDefined();
    await writerDocument.replaceMarkdown("second durable generation", {
      origin: "external-file",
      expectedRevision: snapshot!.revision,
    });
    await vi.waitFor(() => expect(readerDocument.getMarkdown()).toBe("second durable generation"));

    let settled = false;
    const persisted = server.waitForPersistence(documentId).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(settled).toBe(false);
    await persisted;

    const update = await store.fetch(documentId);
    expect(update).not.toBeNull();
    const restored = new Y.Doc();
    try {
      Y.applyUpdate(restored, update!);
      expect(restored.getText("content").toString()).toBe("second durable generation");
    } finally {
      restored.destroy();
    }
  });

  it("bounds shutdown after a persistence failure and preserves the storage cause", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const directory = await temporaryDirectory();
    const server = await startServer(directory, {
      persistenceDebounceMs: 5_000,
      persistenceMaxDebounceMs: 6_000,
      shutdownTimeoutMs: 100,
    });
    const documentId = asDocumentId("document-failed-shutdown-store");
    const credential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const writer = await engineFor(server, credential.token);
    const writerDocument = await writer.create(
      { id: documentId },
      { initialMarkdown: "pending server persistence" },
    );
    const reader = await engineFor(server, credential.token);
    const readerDocument = await reader.open({ id: documentId });
    expect(readerDocument.getMarkdown()).toBe("pending server persistence");

    await rm(join(directory, "documents"), { recursive: true });
    await writeFile(join(directory, "documents"), "not a directory", "utf8");
    const healthUrl = `${server.httpUrl}/healthz`;
    servers.splice(servers.indexOf(server), 1);

    let guard: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      server.stop().then(
        () => ({ status: "resolved" as const }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      ),
      new Promise<{ status: "timed-out" }>((resolve) => {
        guard = setTimeout(() => resolve({ status: "timed-out" }), 500);
      }),
    ]);
    if (guard) clearTimeout(guard);

    await Promise.allSettled([
      writerDocument.close(),
      readerDocument.close(),
      writer.close(),
      reader.close(),
    ]);

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.error).toBeInstanceOf(AggregateError);
      expect((outcome.error as AggregateError).errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "ENOTDIR" })]),
      );
    }
    expect(server.inspect()).toEqual({ running: false, documents: 0, connections: 0 });
    await expect(fetch(healthUrl)).rejects.toThrow();
  });

  it("does not treat a reader's divergent durable cache as authenticated remote state", async () => {
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-reader-divergent-cache");
    const writerCredential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const writer = await engineFor(server, writerCredential.token);
    const authoritative = await writer.create(
      { id: documentId },
      { initialMarkdown: "server authority" },
    );
    await server.waitForPersistence(documentId);
    await authoritative.close();
    await writer.close();

    const cacheHub = createAssessmentProviderHub();
    const cache = createAssessmentMemoryStore();
    try {
      const cacheEngine = createCollaborationEngine({ providers: cacheHub.factory, store: cache });
      engines.push(cacheEngine);
      const cached = await cacheEngine.create(
        { id: documentId },
        { initialMarkdown: "untrusted cached draft" },
      );
      await cached.close();
      await cacheEngine.close();

      const readerCredential = await server.tokens.issue({
        userId: "bob",
        documentId,
        role: "reader",
        lifetimeSeconds: 300,
      });
      const readerProvider = createHocuspocusProviderFactory({
        url: server.websocketUrl,
        token: () => readerCredential.token,
        initialSyncTimeoutMs: 5_000,
        reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 5, jitter: false },
      });
      const reader = createCollaborationEngine({ providers: readerProvider, store: cache });
      engines.push(reader);
      const joined = await reader.open(
        { id: documentId },
        { readiness: "require-authenticated-sync" },
      );

      expect(joined.getState()).toMatchObject({
        authentication: "authenticated",
        access: "read-only",
        sync: "synced",
      });
      expect(joined.getMarkdown()).toBe("server authority");
      await joined.close();
      await reader.close();
    } finally {
      await cacheHub.close();
      await cache.close();
    }
  });

  it("does not let an editor invitation upload a divergent durable join cache", async () => {
    const directory = await temporaryDirectory();
    const server = await startServer(directory);
    const documentId = asDocumentId("document-editor-divergent-cache");
    const initialCredential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const initialEngine = await engineFor(server, initialCredential.token);
    const authoritative = await initialEngine.create(
      { id: documentId },
      { initialMarkdown: "server authority" },
    );
    await server.waitForPersistence(documentId);
    await authoritative.close();
    await initialEngine.close();

    const cacheHub = createAssessmentProviderHub();
    const cache = createAssessmentMemoryStore();
    try {
      const cacheEngine = createCollaborationEngine({ providers: cacheHub.factory, store: cache });
      engines.push(cacheEngine);
      const cached = await cacheEngine.create(
        { id: documentId },
        { initialMarkdown: "untrusted cached draft" },
      );
      await cached.close();
      await cacheEngine.close();

      const editorCredential = await server.tokens.issue({
        userId: "mallory",
        documentId,
        role: "editor",
        lifetimeSeconds: 300,
      });
      const editorProvider = createHocuspocusProviderFactory({
        url: server.websocketUrl,
        token: () => editorCredential.token,
        initialSyncTimeoutMs: 5_000,
        reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 5, jitter: false },
      });
      const joiningEngine = createCollaborationEngine({ providers: editorProvider, store: cache });
      engines.push(joiningEngine);
      const joined = await joiningEngine.open(
        { id: documentId },
        { readiness: "require-authenticated-sync" },
      );

      expect(joined.getState()).toMatchObject({
        authentication: "authenticated",
        access: "read-write",
        sync: "synced",
        persistence: "clean",
      });
      expect(joined.getMarkdown()).toBe("server authority");
      await joined.close();
      await joiningEngine.close();

      const cacheLease = await cache.open(documentId);
      const restored = await cacheLease.load();
      const restoredDocument = new Y.Doc();
      try {
        for (const update of restored.updates) Y.applyUpdate(restoredDocument, update);
        expect(restoredDocument.getText("content").toString()).toBe("server authority");
      } finally {
        restoredDocument.destroy();
        await cacheLease.close();
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      await server.stop();
      const restarted = await startServer(directory);
      const readerCredential = await restarted.tokens.issue({
        userId: "bob",
        documentId,
        role: "reader",
        lifetimeSeconds: 300,
      });
      const reader = await engineFor(restarted, readerCredential.token);
      const reopened = await reader.open({ id: documentId });
      expect(reopened.getMarkdown()).toBe("server authority");
    } finally {
      await cacheHub.close();
      await cache.close();
    }
  });

  it("creates an empty remote room without uploading an older durable create cache", async () => {
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-create-divergent-cache");
    const cacheHub = createAssessmentProviderHub();
    const cache = createAssessmentMemoryStore();
    try {
      const cacheEngine = createCollaborationEngine({ providers: cacheHub.factory, store: cache });
      engines.push(cacheEngine);
      const cached = await cacheEngine.create(
        { id: documentId },
        { initialMarkdown: "stale local create cache" },
      );
      await cached.close();
      await cacheEngine.close();

      const creatorCredential = await server.tokens.issue({
        userId: "alice",
        documentId,
        role: "editor",
        lifetimeSeconds: 300,
      });
      const creatorProvider = createHocuspocusProviderFactory({
        url: server.websocketUrl,
        token: () => creatorCredential.token,
        initialSyncTimeoutMs: 5_000,
        reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 5, jitter: false },
      });
      const creator = createCollaborationEngine({ providers: creatorProvider, store: cache });
      engines.push(creator);
      const created = await creator.create(
        { id: documentId },
        { initialMarkdown: "fresh remote create" },
      );
      expect(created.getMarkdown()).toBe("fresh remote create");
      expect(created.getState().persistence).toBe("clean");
      await server.waitForPersistence(documentId);
      await created.close();
      await creator.close();

      const readerCredential = await server.tokens.issue({
        userId: "bob",
        documentId,
        role: "reader",
        lifetimeSeconds: 300,
      });
      const reader = await engineFor(server, readerCredential.token);
      const reopened = await reader.open(
        { id: documentId },
        { readiness: "require-authenticated-sync" },
      );
      expect(reopened.getMarkdown()).toBe("fresh remote create");
      expect(reopened.getMarkdown()).not.toContain("stale local create cache");
    } finally {
      await cacheHub.close();
      await cache.close();
    }
  });

  it("leaves a durable cache byte-for-byte untouched when strict authentication is denied", async () => {
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-denied-cache-preservation");
    const cacheHub = createAssessmentProviderHub();
    const cache = createAssessmentMemoryStore();
    try {
      const seedEngine = createCollaborationEngine({ providers: cacheHub.factory, store: cache });
      engines.push(seedEngine);
      const seeded = await seedEngine.create(
        { id: documentId },
        { initialMarkdown: "preserve this cache" },
      );
      await seeded.close();
      await seedEngine.close();
      const beforeLease = await cache.open(documentId);
      const before = await beforeLease.load();
      const beforeBytes = before.updates.map((update) => [...update]);
      await beforeLease.close();

      let appends = 0;
      let replacements = 0;
      const guardedStore = {
        async open(id: typeof documentId) {
          const lease = await cache.open(id);
          return {
            load: () => lease.load(),
            async append(update: Uint8Array) {
              appends += 1;
              return lease.append(update);
            },
            flush: () => lease.flush(),
            async replaceWithSnapshot(
              update: Uint8Array,
              options: Parameters<typeof lease.replaceWithSnapshot>[1],
            ) {
              replacements += 1;
              return lease.replaceWithSnapshot(update, options);
            },
            close: () => lease.close(),
          };
        },
      };
      const deniedProvider = createHocuspocusProviderFactory({
        url: server.websocketUrl,
        token: () => "not-a-token",
        initialSyncTimeoutMs: 5_000,
        reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 5, jitter: false },
      });
      const denied = createCollaborationEngine({ providers: deniedProvider, store: guardedStore });
      engines.push(denied);

      await expect(denied.open(
        { id: documentId },
        { readiness: "require-authenticated-sync" },
      )).rejects.toMatchObject({ code: "authentication-denied" });
      expect(appends).toBe(0);
      expect(replacements).toBe(0);

      const afterLease = await cache.open(documentId);
      const after = await afterLease.load();
      expect(after.updates.map((update) => [...update])).toEqual(beforeBytes);
      await afterLease.close();
    } finally {
      await cacheHub.close();
      await cache.close();
    }
  });

  it("fails strict readiness when the authoritative cache replacement cannot commit", async () => {
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-cache-reset-failure");
    const ownerCredential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const owner = await engineFor(server, ownerCredential.token);
    const authoritative = await owner.create(
      { id: documentId },
      { initialMarkdown: "server authority" },
    );
    await server.waitForPersistence(documentId);
    await authoritative.close();
    await owner.close();

    const cacheHub = createAssessmentProviderHub();
    const cache = createAssessmentMemoryStore();
    try {
      const seedEngine = createCollaborationEngine({ providers: cacheHub.factory, store: cache });
      engines.push(seedEngine);
      const seeded = await seedEngine.create(
        { id: documentId },
        { initialMarkdown: "untrusted cached draft" },
      );
      await seeded.close();
      await seedEngine.close();

      const resetFailure = new Error("injected authoritative reset failure");
      let replacements = 0;
      const failingStore = {
        async open(id: typeof documentId) {
          const lease = await cache.open(id);
          return {
            load: () => lease.load(),
            append: (update: Uint8Array) => lease.append(update),
            flush: () => lease.flush(),
            async replaceWithSnapshot() {
              replacements += 1;
              throw resetFailure;
            },
            close: () => lease.close(),
          };
        },
      };
      const readerCredential = await server.tokens.issue({
        userId: "bob",
        documentId,
        role: "reader",
        lifetimeSeconds: 300,
      });
      const provider = createHocuspocusProviderFactory({
        url: server.websocketUrl,
        token: () => readerCredential.token,
        initialSyncTimeoutMs: 5_000,
        reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 5, jitter: false },
      });
      const diagnostics: string[] = [];
      const joining = createCollaborationEngine({
        providers: provider,
        store: failingStore,
        diagnostics: (value) => diagnostics.push(value.code),
      });
      engines.push(joining);

      await expect(joining.open(
        { id: documentId },
        { readiness: "require-authenticated-sync" },
      )).rejects.toMatchObject({ code: "store-failed" });
      expect(replacements).toBe(1);
      expect(diagnostics).toContain("store-failed");
      expect(joining.list()).toEqual([]);

      const preservedLease = await cache.open(documentId);
      const preserved = await preservedLease.load();
      const preservedDocument = new Y.Doc();
      try {
        for (const update of preserved.updates) Y.applyUpdate(preservedDocument, update);
        expect(preservedDocument.getText("content").toString()).toBe("untrusted cached draft");
      } finally {
        preservedDocument.destroy();
        await preservedLease.close();
      }
    } finally {
      await cacheHub.close();
      await cache.close();
    }
  });

  it("authenticates room-scoped readers and editors and enforces read-only locally and remotely", async () => {
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-authz");
    const writerCredential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const readerCredential = await server.tokens.issue({
      userId: "bob",
      documentId,
      role: "reader",
      lifetimeSeconds: 300,
    });
    const writer = await engineFor(server, writerCredential.token);
    const writerDocument = await writer.create({ id: documentId }, { initialMarkdown: "shared" });
    await server.waitForPersistence(documentId);
    let readerReplica: CollaborationReplicaPort | undefined;
    const reader = await engineFor(server, readerCredential.token, (replica) => {
      readerReplica = replica;
    });
    const readerDocument = await reader.open({ id: documentId });
    const writerEditor = editor("shared");
    const readerEditor = editor("shared");
    const writerBinding = await writerDocument.attach(writerEditor.api, { content: "require-match" });
    const readerBinding = await readerDocument.attach(readerEditor.api, { content: "require-match" });

    expect(writerDocument.getState()).toMatchObject({
      transport: "online",
      sync: "synced",
      authentication: "authenticated",
      access: "read-write",
    });
    expect(readerDocument.getState()).toMatchObject({
      authentication: "authenticated",
      access: "read-only",
    });
    writerBinding.setPresence({ userId: "client-supplied-id", name: "Alice" });
    await vi.waitFor(() => expect(readerDocument.getState().peers).toContainEqual(
      expect.objectContaining({ userId: "alice", name: "Alice" }),
    ));
    expect(readerDocument.getState().peers).not.toContainEqual(
      expect.objectContaining({ userId: "client-supplied-id" }),
    );
    expect(readerEditor.api.dispatchTransaction({
      changes: [{ from: 6, to: 6, insert: " rejected" }],
      origin: ["reader"],
    })).toMatchObject({ status: "rejected", reason: "collaboration-read-only" });

    writerEditor.api.dispatchTransaction({
      changes: [{ from: 6, to: 6, insert: "!" }],
      origin: ["writer"],
    });
    await vi.waitFor(() => expect(readerEditor.api.getDocument()).toBe("shared!"));
    await server.waitForPersistence(documentId);

    // Bypass the Engine's local read-only filter to prove the server independently rejects writes.
    const hostileDocument = new Y.Doc();
    Y.applyUpdate(hostileDocument, readerReplica!.encodeStateAsUpdate());
    const beforeHostileEdit = Y.encodeStateVector(hostileDocument);
    hostileDocument.getText("content").insert(7, " server-rejected");
    readerReplica!.applyUpdate(
      Y.encodeStateAsUpdate(hostileDocument, beforeHostileEdit),
      { kind: "malicious-reader" },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writerDocument.getMarkdown()).toBe("shared!");
    hostileDocument.destroy();

    await writerBinding.detach();
    await readerBinding.detach();
    writerEditor.api.destroy();
    readerEditor.api.destroy();
    writerEditor.container.remove();
    readerEditor.container.remove();
  });

  it("rejects malformed, expired, and wrong-room credentials before applying document state", async () => {
    const server = await startServer(await temporaryDirectory());
    const valid = await server.tokens.issue({
      userId: "alice",
      documentId: "another-document",
      role: "editor",
      lifetimeSeconds: 300,
    });
    const malformed = await engineFor(server, "not-a-token");
    await expect(malformed.open({ id: asDocumentId("protected-document") })).rejects.toMatchObject({
      code: "authentication-denied",
    });
    const wrongRoom = await engineFor(server, valid.token);
    await expect(wrongRoom.open({ id: asDocumentId("protected-document") })).rejects.toMatchObject({
      code: "authentication-denied",
    });

    const expired = await server.tokens.issue({
      userId: "alice",
      documentId: "protected-document",
      role: "editor",
      lifetimeSeconds: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const expiredEngine = await engineFor(server, expired.token);
    await expect(expiredEngine.open({ id: asDocumentId("protected-document") })).rejects.toMatchObject({
      code: "authentication-expired",
    });
    expect(server.inspect()).toMatchObject({ documents: 0 });
  });

  it("reports a credential revoked before connection with the stable revoked contract", async () => {
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-revoked-before-connect");
    const credential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    await server.revokeToken(credential.tokenId, credential.expiresAt);
    const engine = await engineFor(server, credential.token);

    await expect(engine.open({ id: documentId })).rejects.toMatchObject({
      code: "authorization-revoked",
    });
    expect(server.inspect()).toMatchObject({ documents: 0 });
  });

  it("revokes an active writer, removes its Presence, and blocks later local updates", async () => {
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-revocation");
    const credential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const engine = await engineFor(server, credential.token);
    const collaborativeDocument = await engine.create({ id: documentId }, { initialMarkdown: "safe" });
    const target = editor("safe");
    const binding = await collaborativeDocument.attach(target.api, { content: "require-match" });
    binding.setPresence({ userId: "alice", name: "Alice" });

    await server.revokeToken(credential.tokenId, credential.expiresAt);
    await vi.waitFor(() => expect(collaborativeDocument.getState()).toMatchObject({
      authentication: "revoked",
      access: "none",
      diagnostic: { code: "authorization-revoked" },
    }));
    expect(collaborativeDocument.getState().peers).toHaveLength(0);
    expect(target.api.dispatchTransaction({
      changes: [{ from: 4, to: 4, insert: " blocked" }],
      origin: ["revoked"],
    })).toMatchObject({ status: "rejected", reason: "collaboration-authorization-unavailable" });
    expect(target.api.getDocument()).toBe("safe");

    await binding.detach();
    target.api.destroy();
    target.container.remove();
  });

  it("linearizes an admitted update behind revocation without blocking another room", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const directory = await temporaryDirectory();
    const server = await startServer(directory);
    const documentId = asDocumentId("document-revocation-race");
    const credential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const engine = await engineFor(server, credential.token);
    const collaborativeDocument = await engine.create(
      { id: documentId },
      { initialMarkdown: "safe" },
    );
    await server.waitForPersistence(documentId);
    const target = editor("safe");
    const binding = await collaborativeDocument.attach(target.api, { content: "require-match" });
    const authoritativeDocument = Reflect.get(server, "server").hocuspocus.documents.get(documentId);
    const serverConnection = authoritativeDocument.getConnections()[0];

    const operations = Reflect.get(server, "documentOperations") as DocumentOperationGate;
    expect(operations).toBeInstanceOf(DocumentOperationGate);
    const tokenKey = tokenOperationKey(credential.tokenId);
    const releaseBlocker = await operations.acquire(tokenKey);
    const originalAcquire = operations.acquire.bind(operations);
    let tokenAcquisitions = 0;
    let updateReachedGate!: () => void;
    const updateWaiting = new Promise<void>((resolve) => {
      updateReachedGate = resolve;
    });
    vi.spyOn(operations, "acquire").mockImplementation((key) => {
      const pending = originalAcquire(key);
      if (key === tokenKey && ++tokenAcquisitions === 2) updateReachedGate();
      return pending;
    });

    try {
      const revocation = server.revokeToken(credential.tokenId, credential.expiresAt);
      expect(target.api.dispatchTransaction({
        changes: [{ from: 4, to: 4, insert: " stale" }],
        origin: ["revocation-race"],
      })).toMatchObject({ status: "success" });
      await updateWaiting;

      const healthyDocumentId = asDocumentId("document-revocation-race-independent");
      const healthyCredential = await server.tokens.issue({
        userId: "bob",
        documentId: healthyDocumentId,
        role: "editor",
        lifetimeSeconds: 300,
      });
      const healthyEngine = await engineFor(server, healthyCredential.token);
      const healthyDocument = await healthyEngine.create(
        { id: healthyDocumentId },
        { initialMarkdown: "other room is healthy" },
      );
      await server.waitForPersistence(healthyDocumentId);
      expect(healthyDocument.getMarkdown()).toBe("other room is healthy");

      releaseBlocker();
      await revocation;
      await vi.waitFor(() => expect(collaborativeDocument.getState()).toMatchObject({
        authentication: "revoked",
        access: "none",
      }));
      await serverConnection.waitForPendingMessages();
      expect(authoritativeDocument.getText("content").toString()).toBe("safe");
      const stored = await createFileDocumentStore({ directory }).fetch(documentId);
      expect(stored).not.toBeNull();
      const authoritative = new Y.Doc();
      try {
        Y.applyUpdate(authoritative, stored!);
        expect(authoritative.getText("content").toString()).toBe("safe");
      } finally {
        authoritative.destroy();
      }

      const replacementCredential = await server.tokens.issue({
        userId: "carol",
        documentId,
        role: "editor",
        lifetimeSeconds: 300,
      });
      const replacementEngine = await engineFor(server, replacementCredential.token);
      const replacementDocument = await replacementEngine.open({ id: documentId });
      const replacementTarget = editor("safe");
      const replacementBinding = await replacementDocument.attach(
        replacementTarget.api,
        { content: "require-match" },
      );
      try {
        expect(replacementTarget.api.dispatchTransaction({
          changes: [{ from: 4, to: 4, insert: " fresh" }],
          origin: ["replacement-writer"],
        })).toMatchObject({ status: "success" });
        await vi.waitFor(() => {
          const currentDocument = Reflect.get(server, "server").hocuspocus.documents.get(documentId);
          expect(currentDocument.getText("content").toString()).toBe("safe fresh");
        });
        await server.waitForPersistence(documentId);
      } finally {
        await replacementBinding.detach();
        replacementTarget.api.destroy();
        replacementTarget.container.remove();
      }
      await expect(fetch(`${server.httpUrl}/healthz`).then((response) => response.json())).resolves.toEqual({
        status: "ok",
      });
    } finally {
      releaseBlocker();
      await binding.detach();
      target.api.destroy();
      target.container.remove();
    }
  });

  it("does not let admitted Awareness recreate Presence after revocation returns", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-awareness-revocation-race");
    const writerCredential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const readerCredential = await server.tokens.issue({
      userId: "bob",
      documentId,
      role: "reader",
      lifetimeSeconds: 300,
    });
    const writer = await engineFor(server, writerCredential.token);
    const writerDocument = await writer.create({ id: documentId }, { initialMarkdown: "safe" });
    const reader = await engineFor(server, readerCredential.token);
    const readerDocument = await reader.open({ id: documentId });
    const writerTarget = editor("safe");
    const writerBinding = await writerDocument.attach(writerTarget.api, { content: "require-match" });
    writerBinding.setPresence({ userId: "alice", name: "before revoke" });
    await vi.waitFor(() => expect(readerDocument.getState().peers).toContainEqual(
      expect.objectContaining({ userId: "alice", name: "before revoke" }),
    ));
    const authoritativeDocument = Reflect.get(server, "server").hocuspocus.documents.get(documentId);
    const writerConnection = authoritativeDocument.getConnections().find(
      (connection: { context: { tokenId: string } }) => connection.context.tokenId === writerCredential.tokenId,
    );
    if (!writerConnection) throw new Error("Expected the writer connection to be active");

    const operations = Reflect.get(server, "documentOperations") as DocumentOperationGate;
    const tokenKey = tokenOperationKey(writerCredential.tokenId);
    const releaseBlocker = await operations.acquire(tokenKey);
    const originalAcquire = operations.acquire.bind(operations);
    let tokenAcquisitions = 0;
    let awarenessReachedGate!: () => void;
    const awarenessWaiting = new Promise<void>((resolve) => {
      awarenessReachedGate = resolve;
    });
    vi.spyOn(operations, "acquire").mockImplementation((key) => {
      const pending = originalAcquire(key);
      if (key === tokenKey && ++tokenAcquisitions === 2) awarenessReachedGate();
      return pending;
    });

    try {
      const revocation = server.revokeToken(writerCredential.tokenId, writerCredential.expiresAt);
      writerBinding.setPresence({ userId: "alice", name: "late presence" });
      await awarenessWaiting;
      releaseBlocker();
      await revocation;
      await writerConnection.waitForPendingMessages();
      await server.revokeToken(writerCredential.tokenId, writerCredential.expiresAt);
      await vi.waitFor(() => expect(readerDocument.getState().peers).not.toContainEqual(
        expect.objectContaining({ userId: "alice" }),
      ));
      const states = [...authoritativeDocument.awareness.getStates().values()] as Array<{
        nexusPresence?: Array<{ userId?: string }>;
      }>;
      expect(states.flatMap((state) => state.nexusPresence ?? [])).not.toContainEqual(
        expect.objectContaining({ userId: "alice" }),
      );
    } finally {
      releaseBlocker();
      await writerBinding.detach();
      writerTarget.api.destroy();
      writerTarget.container.remove();
    }
  });

  it("does not send a read-only SyncStep1 snapshot after revocation returns", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ObservedWebSocket.reset();
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-reader-revocation-race");
    const writerCredential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    let writerReplica: CollaborationReplicaPort | undefined;
    const writer = await engineFor(server, writerCredential.token, (replica) => {
      writerReplica = replica;
    });
    await writer.create({ id: documentId }, { initialMarkdown: "private snapshot" });
    await server.waitForPersistence(documentId);

    const readerCredential = await server.tokens.issue({
      userId: "bob",
      documentId,
      role: "reader",
      lifetimeSeconds: 300,
    });
    const readerProvider = createHocuspocusProviderFactory({
      url: server.websocketUrl,
      token: () => readerCredential.token,
      initialSyncTimeoutMs: 5_000,
      reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 0, jitter: false },
      webSocketPolyfill: ObservedWebSocket,
    });
    const reader = createCollaborationEngine({ providers: readerProvider, store: { mode: "volatile" } });
    engines.push(reader);
    const readerDocument = await reader.open({ id: documentId });
    expect(readerDocument.getMarkdown()).toBe("private snapshot");
    const syncStep1 = ObservedWebSocket.sentFrames.find((frame) => {
      const types = protocolTypes(frame);
      return types?.message === 0 && types.sync === 0;
    });
    if (!syncStep1) throw new Error("Expected the reader's initial SyncStep1 frame");

    const authoritativeDocument = Reflect.get(server, "server").hocuspocus.documents.get(documentId);
    const readerConnection = authoritativeDocument.getConnections().find(
      (connection: { context: { tokenId: string } }) => connection.context.tokenId === readerCredential.tokenId,
    );
    if (!readerConnection) throw new Error("Expected the reader connection to be active");
    const sentAfterAdmission: Uint8Array[] = [];
    const send = readerConnection.webSocket.send.bind(readerConnection.webSocket);
    readerConnection.webSocket.send = (frame: Uint8Array) => {
      sentAfterAdmission.push(frame.slice());
      send(frame);
    };

    const operations = Reflect.get(server, "documentOperations") as DocumentOperationGate;
    const tokenKey = tokenOperationKey(readerCredential.tokenId);
    const releaseBlocker = await operations.acquire(tokenKey);
    const originalAcquire = operations.acquire.bind(operations);
    let tokenAcquisitions = 0;
    let readerRequestReachedGate!: () => void;
    const readerRequestWaiting = new Promise<void>((resolve) => {
      readerRequestReachedGate = resolve;
    });
    vi.spyOn(operations, "acquire").mockImplementation((key) => {
      const pending = originalAcquire(key);
      if (key === tokenKey && ++tokenAcquisitions === 2) readerRequestReachedGate();
      return pending;
    });

    try {
      const revocation = server.revokeToken(readerCredential.tokenId, readerCredential.expiresAt);
      ObservedWebSocket.instances.at(-1)!.send(syncStep1);
      await readerRequestWaiting;

      const healthyDocumentId = asDocumentId("document-reader-revocation-independent");
      const healthyCredential = await server.tokens.issue({
        userId: "carol",
        documentId: healthyDocumentId,
        role: "editor",
        lifetimeSeconds: 300,
      });
      const healthyReader = await engineFor(server, healthyCredential.token);
      const healthyDocument = await healthyReader.create(
        { id: healthyDocumentId },
        { initialMarkdown: "independent room" },
      );
      expect(healthyDocument.getMarkdown()).toBe("independent room");

      releaseBlocker();
      await revocation;
      await readerConnection.waitForPendingMessages();
      expect(sentAfterAdmission.map(protocolTypes)).not.toContainEqual(
        expect.objectContaining({ message: 0 }),
      );
      await vi.waitFor(() => expect(readerDocument.getState()).toMatchObject({
        authentication: "revoked",
        access: "none",
      }));
      const source = new Y.Doc();
      try {
        Y.applyUpdate(source, writerReplica!.encodeStateAsUpdate());
        const before = Y.encodeStateVector(source);
        source.getText("content").insert(source.getText("content").length, " after revoke");
        writerReplica!.applyUpdate(Y.encodeStateAsUpdate(source, before), { kind: "post-revoke" });
        await vi.waitFor(() => {
          expect(authoritativeDocument.getText("content").toString()).toBe(
            "private snapshot after revoke",
          );
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(readerDocument.getMarkdown()).toBe("private snapshot");
      } finally {
        source.destroy();
      }
    } finally {
      releaseBlocker();
    }
  });

  it("reauthenticates an open document with a fresh credential on explicit reconnect", async () => {
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-reauthentication");
    const revokedCredential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    let currentToken = revokedCredential.token;
    const resolvedTokens: string[] = [];
    const provider = createHocuspocusProviderFactory({
      url: server.websocketUrl,
      token: () => {
        resolvedTokens.push(currentToken);
        return currentToken;
      },
      initialSyncTimeoutMs: 5_000,
      reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 5, jitter: false },
    });
    const engine = createCollaborationEngine({ providers: provider, store: { mode: "volatile" } });
    engines.push(engine);
    const collaborativeDocument = await engine.create(
      { id: documentId },
      { initialMarkdown: "before reauthentication" },
    );

    await server.revokeToken(revokedCredential.tokenId, revokedCredential.expiresAt);
    await vi.waitFor(() => expect(collaborativeDocument.getState()).toMatchObject({
      authentication: "revoked",
      access: "none",
    }));
    const replacementCredential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    currentToken = replacementCredential.token;

    await provider.control.reconnect(documentId);

    expect(collaborativeDocument.getState()).toMatchObject({
      transport: "online",
      sync: "synced",
      authentication: "authenticated",
      access: "read-write",
    });
    expect(collaborativeDocument.getState().diagnostic).toBeUndefined();
    expect(resolvedTokens).toContain(revokedCredential.token);
    expect(resolvedTokens.at(-1)).toBe(replacementCredential.token);
  });

  it("expires an idle active credential and blocks local updates until reauthentication", async () => {
    const server = await startServer(await temporaryDirectory());
    const documentId = asDocumentId("document-active-expiration");
    const credential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 2,
    });
    const engine = await engineFor(server, credential.token);
    const collaborativeDocument = await engine.create(
      { id: documentId },
      { initialMarkdown: "expires" },
    );
    const target = editor("expires");
    const binding = await collaborativeDocument.attach(target.api, { content: "require-match" });

    await vi.waitFor(() => expect(collaborativeDocument.getState()).toMatchObject({
      authentication: "expired",
      access: "none",
      diagnostic: { code: "authentication-expired" },
    }), { timeout: 3_500 });
    expect(target.api.dispatchTransaction({
      changes: [{ from: 7, to: 7, insert: " blocked" }],
      origin: ["expired"],
    })).toMatchObject({ status: "rejected", reason: "collaboration-authorization-unavailable" });

    await binding.detach();
    target.api.destroy();
    target.container.remove();
  });

  it("restores a persisted collaborative document after a full server restart", async () => {
    const directory = await temporaryDirectory();
    const documentId = asDocumentId("document-restart");
    const firstServer = await startServer(directory);
    const firstCredential = await firstServer.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const firstEngine = await engineFor(firstServer, firstCredential.token);
    const created = await firstEngine.create({ id: documentId }, { initialMarkdown: "survives restart" });
    await firstServer.waitForPersistence(documentId);
    await created.close();
    await firstEngine.close();
    await firstServer.stop();
    engines.splice(engines.indexOf(firstEngine), 1);
    servers.splice(servers.indexOf(firstServer), 1);

    const restarted = await startServer(directory);
    const secondCredential = await restarted.tokens.issue({
      userId: "bob",
      documentId,
      role: "reader",
      lifetimeSeconds: 300,
    });
    const secondEngine = await engineFor(restarted, secondCredential.token);
    const opened = await secondEngine.open({ id: documentId });
    expect(opened.getMarkdown()).toBe("survives restart");
    expect(opened.getState()).toMatchObject({ access: "read-only", sync: "synced" });
  });

  it("reconnects after a network restart and replays offline edits exactly once", async () => {
    const directory = await temporaryDirectory();
    const documentId = asDocumentId("document-partition");
    const firstServer = await startServer(directory);
    const port = Number(new URL(firstServer.websocketUrl).port);
    const credential = await firstServer.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const engine = await engineFor(firstServer, credential.token);
    const collaborativeDocument = await engine.create(
      { id: documentId },
      { initialMarkdown: "before" },
    );
    const target = editor("before");
    const binding = await collaborativeDocument.attach(target.api, { content: "require-match" });
    await firstServer.waitForPersistence(documentId);

    await firstServer.stop();
    servers.splice(servers.indexOf(firstServer), 1);
    await vi.waitFor(() => expect(collaborativeDocument.getState()).toMatchObject({
      transport: "offline",
      authentication: "authenticated",
      access: "read-write",
    }), {
      timeout: 2_000,
    });
    expect(target.api.dispatchTransaction({
      changes: [{ from: 6, to: 6, insert: " offline" }],
      origin: ["partitioned-edit"],
    })).toMatchObject({ status: "success" });

    const restarted = await startServer(directory, { port });
    await vi.waitFor(() => expect(collaborativeDocument.getState()).toMatchObject({
      transport: "online",
      sync: "synced",
      authentication: "authenticated",
      access: "read-write",
    }), { timeout: 5_000 });
    await restarted.waitForPersistence(documentId);
    const readerToken = await restarted.tokens.issue({
      userId: "bob",
      documentId,
      role: "reader",
      lifetimeSeconds: 300,
    });
    const readerEngine = await engineFor(restarted, readerToken.token);
    const readerDocument = await readerEngine.open({ id: documentId });
    expect(readerDocument.getMarkdown()).toBe("before offline");
    expect((readerDocument.getMarkdown()!.match(/offline/gu) ?? [])).toHaveLength(1);

    await binding.detach();
    target.api.destroy();
    target.container.remove();
  });

  it("bounds oversized unauthenticated frames and remains healthy", async () => {
    const directory = await temporaryDirectory();
    const server = createCollaborationServer({
      address: "127.0.0.1",
      port: 0,
      storageDirectory: directory,
      authSecret: secret,
      maxMessageBytes: 1_024,
    });
    await server.start();
    servers.push(server);
    const socket = new WebSocket(server.websocketUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket did not open")), { once: true });
    });
    const closed = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener("close", (event) => resolve(event), { once: true });
    });
    socket.send(new Uint8Array(2_048));
    const event = await closed;
    expect(event.code).toBe(1009);
    await expect(fetch(`${server.httpUrl}/healthz`).then((response) => response.json())).resolves.toEqual({
      status: "ok",
    });
  });

  it("rejects the writer before many individually bounded updates can grow one room past its document limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ObservedWebSocket.reset();
    const maximumFrameBytes = 64 * 1024;
    const maximumDocumentBytes = 2 * 1024;
    const directory = await temporaryDirectory();
    const server = await startServer(directory, {
      maxMessageBytes: maximumFrameBytes,
      maxDocumentBytes: maximumDocumentBytes,
      persistenceDebounceMs: 500,
      persistenceMaxDebounceMs: 1_000,
    });
    const limitedDocumentId = asDocumentId("document-cumulative-limit");
    const credential = await server.tokens.issue({
      userId: "alice",
      documentId: limitedDocumentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const provider = createHocuspocusProviderFactory({
      url: server.websocketUrl,
      token: () => credential.token,
      initialSyncTimeoutMs: 5_000,
      reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 0, jitter: false },
      webSocketPolyfill: ObservedWebSocket,
    });
    const engine = createCollaborationEngine({ providers: provider, store: { mode: "volatile" } });
    engines.push(engine);
    const collaborativeDocument = await engine.create(
      { id: limitedDocumentId },
      { initialMarkdown: "seed" },
    );
    const surface = editor("seed");
    const binding = await collaborativeDocument.attach(surface.api, { content: "require-match" });

    for (let index = 0; index < 128; index += 1) {
      const position = surface.api.getDocument().length;
      expect(surface.api.dispatchTransaction({
        changes: [{ from: position, to: position, insert: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }],
        origin: ["cumulative-limit-regression"],
      })).toMatchObject({ status: "success" });
    }

    await vi.waitFor(() => {
      expect(ObservedWebSocket.documentCloseReasons).toContain("document-size-limit");
    }, { timeout: 5_000 });
    expect(ObservedWebSocket.sentFrameBytes.length).toBeGreaterThan(10);
    expect(Math.max(...ObservedWebSocket.sentFrameBytes)).toBeLessThan(maximumFrameBytes);
    await vi.waitFor(() => expect(collaborativeDocument.getState()).toMatchObject({
      transport: "offline",
      sync: "stale",
    }));
    await server.waitForPersistence(limitedDocumentId);
    const stored = await createFileDocumentStore({
      directory,
      maxDocumentBytes: maximumDocumentBytes,
    }).fetch(limitedDocumentId);
    expect(stored).not.toBeNull();
    expect(stored!.byteLength).toBeLessThanOrEqual(maximumDocumentBytes);
    const authoritative = new Y.Doc();
    try {
      Y.applyUpdate(authoritative, stored!);
      expect(authoritative.getText("content").length).toBeLessThan(
        surface.api.getDocument().length,
      );
    } finally {
      authoritative.destroy();
    }

    const healthyDocumentId = asDocumentId("document-after-cumulative-limit");
    const healthyCredential = await server.tokens.issue({
      userId: "bob",
      documentId: healthyDocumentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const healthyEngine = await engineFor(server, healthyCredential.token);
    const healthyDocument = await healthyEngine.create(
      { id: healthyDocumentId },
      { initialMarkdown: "other room stays healthy" },
    );
    await server.waitForPersistence(healthyDocumentId);
    expect(healthyDocument.getMarkdown()).toBe("other room stays healthy");
    await expect(fetch(`${server.httpUrl}/healthz`).then((response) => response.json())).resolves.toEqual({
      status: "ok",
    });

    await binding.detach();
    surface.api.destroy();
    surface.container.remove();
  });

  it("bounds authenticated pending work when tiny updates burst near the document limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ObservedWebSocket.reset();
    const maximumDocumentBytes = 512 * 1024;
    const directory = await temporaryDirectory();
    const server = await startServer(directory, {
      maxDocumentBytes: maximumDocumentBytes,
      maxAuthenticatedQueueBytes: 1024 * 1024,
      maxAuthenticatedQueueMessages: 8,
    });
    const attackedDocumentId = asDocumentId("document-authenticated-queue-limit");
    const credential = await server.tokens.issue({
      userId: "alice",
      documentId: attackedDocumentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    let replica: CollaborationReplicaPort | undefined;
    const networkProvider = createHocuspocusProviderFactory({
      url: server.websocketUrl,
      token: () => credential.token,
      initialSyncTimeoutMs: 5_000,
      reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 0, jitter: false },
      webSocketPolyfill: ObservedWebSocket,
    });
    const engine = createCollaborationEngine({
      providers: {
        async prepare(context) {
          replica = context.replica;
          return networkProvider.prepare(context);
        },
      },
      store: { mode: "volatile" },
    });
    engines.push(engine);
    const initialMarkdown = "x".repeat(480 * 1024);
    await engine.create(
      { id: attackedDocumentId },
      { initialMarkdown },
    );
    await server.waitForPersistence(attackedDocumentId);

    const source = new Y.Doc();
    Y.applyUpdate(source, replica!.encodeStateAsUpdate());
    try {
      for (let index = 0; index < 128; index += 1) {
        const before = Y.encodeStateVector(source);
        source.getText("content").insert(source.getText("content").length, "y");
        replica!.applyUpdate(Y.encodeStateAsUpdate(source, before), { kind: "authenticated-burst" });
      }
      expect(ObservedWebSocket.sentFrameBytes.length).toBeGreaterThan(100);

      const healthStartedAt = performance.now();
      await expect(fetch(`${server.httpUrl}/healthz`).then((response) => response.json())).resolves.toEqual({
        status: "ok",
      });
      expect(performance.now() - healthStartedAt).toBeLessThan(1_000);
      await vi.waitFor(() => {
        expect(ObservedWebSocket.documentCloseReasons).toContain("authenticated-queue-limit");
        expect(ObservedWebSocket.socketCloseReasons).toContain("authenticated-queue-limit");
      }, { timeout: 5_000 });
      const healthyDocumentId = asDocumentId("document-after-authenticated-queue-limit");
      const healthyCredential = await server.tokens.issue({
        userId: "bob",
        documentId: healthyDocumentId,
        role: "editor",
        lifetimeSeconds: 300,
      });
      const healthyEngine = await engineFor(server, healthyCredential.token);
      const healthyDocument = await healthyEngine.create(
        { id: healthyDocumentId },
        { initialMarkdown: "healthy after authenticated burst" },
      );
      await server.waitForPersistence(healthyDocumentId);
      expect(healthyDocument.getMarkdown()).toBe("healthy after authenticated burst");
    } finally {
      source.destroy();
    }
  });

  it("bounds authenticated pending bytes independently from the message count", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ObservedWebSocket.reset();
    const server = await startServer(await temporaryDirectory(), {
      maxDocumentBytes: 512 * 1024,
      maxAuthenticatedQueueBytes: 2 * 1024,
      maxAuthenticatedQueueMessages: 1_024,
    });
    const documentId = asDocumentId("document-authenticated-byte-limit");
    const credential = await server.tokens.issue({
      userId: "alice",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    let replica: CollaborationReplicaPort | undefined;
    const networkProvider = createHocuspocusProviderFactory({
      url: server.websocketUrl,
      token: () => credential.token,
      initialSyncTimeoutMs: 5_000,
      reconnect: { initialDelayMs: 10, maximumDelayMs: 100, maximumAttempts: 0, jitter: false },
      webSocketPolyfill: ObservedWebSocket,
    });
    const engine = createCollaborationEngine({
      providers: {
        async prepare(context) {
          replica = context.replica;
          return networkProvider.prepare(context);
        },
      },
      store: { mode: "volatile" },
    });
    engines.push(engine);
    await engine.create({ id: documentId }, { initialMarkdown: "seed" });

    const source = new Y.Doc();
    Y.applyUpdate(source, replica!.encodeStateAsUpdate());
    try {
      for (let index = 0; index < 128; index += 1) {
        const before = Y.encodeStateVector(source);
        source.getText("content").insert(source.getText("content").length, "z".repeat(256));
        replica!.applyUpdate(Y.encodeStateAsUpdate(source, before), { kind: "authenticated-byte-burst" });
      }
      await vi.waitFor(() => {
        expect(ObservedWebSocket.documentCloseReasons).toContain("authenticated-queue-limit");
        expect(ObservedWebSocket.socketCloseReasons).toContain("authenticated-queue-limit");
      }, { timeout: 5_000 });
      await expect(fetch(`${server.httpUrl}/healthz`).then((response) => response.json())).resolves.toEqual({
        status: "ok",
      });
    } finally {
      source.destroy();
    }
  });

  it("fails a first join within its bounded initial-sync timeout and releases idempotently", async () => {
    const unavailableUrl = "ws://127.0.0.1:9";
    const engine = createCollaborationEngine({
      providers: createHocuspocusProviderFactory({
        url: unavailableUrl,
        token: () => "unreachable-token",
        initialSyncTimeoutMs: 100,
        reconnect: { initialDelayMs: 10, maximumDelayMs: 20, maximumAttempts: 1, jitter: false },
      }),
      store: { mode: "volatile" },
    });
    engines.push(engine);

    await expect(engine.open({ id: asDocumentId("unreachable") })).rejects.toMatchObject({
      code: "provider-failed",
    });
    await engine.close();
    await engine.close();
    expect(engine.list()).toEqual([]);
  });
});
