import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  asDocumentId,
  createCollaborationEngine,
  type CollaborationEngine,
  type ReplicaStore,
} from "@floatboat/nexus-plugin-collab";
import { createHocuspocusProviderFactory } from "@floatboat/nexus-plugin-collab/hocuspocus";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSqliteReplicaStore,
  type SqliteReplicaStore,
} from "../../electron-demo/electron/collab-sqlite-store";
import { createCollaborationServer, type CollaborationServer } from "../src";

const AUTH_SECRET = "production-path-qualification-secret-32-bytes";
const HOST_IDENTITY = "production-path-qualification-workspace";
const require = createRequire(import.meta.url);
const roots: string[] = [];
const servers: CollaborationServer[] = [];
const engines: CollaborationEngine[] = [];
const stores: SqliteReplicaStore[] = [];

function removeTracked<T>(values: T[], value: T): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

async function sqliteCapability(): Promise<typeof import("node:sqlite")> {
  try {
    const sqlite = require("node:sqlite") as typeof import("node:sqlite");
    if (typeof sqlite.DatabaseSync !== "function") throw new TypeError("DatabaseSync is unavailable");
    return sqlite;
  } catch (cause) {
    throw new Error(
      "Production-path qualification requires a runtime with node:sqlite; this run is unsupported and must not pass",
      { cause },
    );
  }
}

async function startServer(
  storageDirectory: string,
  port = 0,
): Promise<CollaborationServer> {
  const server = createCollaborationServer({
    address: "127.0.0.1",
    port,
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

async function openStore(databasePath: string): Promise<SqliteReplicaStore> {
  const sqlite = await sqliteCapability();
  const store = await createSqliteReplicaStore({
    databasePath,
    loadSqlite: async () => sqlite,
  });
  stores.push(store);
  return store;
}

function createEngine(
  websocketUrl: string,
  token: string,
  store: ReplicaStore,
): CollaborationEngine {
  const provider = createHocuspocusProviderFactory({
    url: websocketUrl,
    token: async () => token,
    initialSyncTimeoutMs: 10_000,
    reconnect: {
      initialDelayMs: 10,
      maximumDelayMs: 100,
      maximumAttempts: 100,
      jitter: false,
    },
  });
  const engine = createCollaborationEngine({
    providers: provider,
    store,
    storeCompaction: { updateThreshold: 2 },
  });
  engines.push(engine);
  return engine;
}

async function closeEngine(engine: CollaborationEngine): Promise<void> {
  await engine.close();
  removeTracked(engines, engine);
}

async function closeStore(store: SqliteReplicaStore): Promise<void> {
  await store.close();
  removeTracked(stores, store);
}

afterEach(async () => {
  await Promise.allSettled(engines.splice(0).reverse().map((engine) => engine.close()));
  await Promise.allSettled(stores.splice(0).reverse().map((store) => store.close()));
  await Promise.allSettled(servers.splice(0).reverse().map((server) => server.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("collaboration production-path qualification", () => {
  it("restores an offline SQLite client and converges two durable Engines after server restart", async () => {
    const sqlite = await sqliteCapability();
    expect(typeof sqlite.DatabaseSync).toBe("function");

    const root = await mkdtemp(join(tmpdir(), "nexus-collab-production-path-"));
    roots.push(root);
    const serverDirectory = join(root, "server");
    const firstDatabase = join(root, "client-a.sqlite3");
    const secondDatabase = join(root, "client-b.sqlite3");
    expect(firstDatabase).not.toBe(secondDatabase);

    const firstServer = await startServer(serverDirectory);
    const serverPort = Number(new URL(firstServer.websocketUrl).port);
    const documentId = asDocumentId("4c713669-2eb1-4dd6-8ccb-8f77dd66ea50");
    const firstCredential = await firstServer.tokens.issue({
      userId: "qualification-client-a",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });
    const secondCredential = await firstServer.tokens.issue({
      userId: "qualification-client-b",
      documentId,
      role: "editor",
      lifetimeSeconds: 300,
    });

    let firstStore = await openStore(firstDatabase);
    const secondStore = await openStore(secondDatabase);
    let firstEngine = createEngine(firstServer.websocketUrl, firstCredential.token, firstStore);
    const secondEngine = createEngine(firstServer.websocketUrl, secondCredential.token, secondStore);
    let firstDocument = await firstEngine.create(
      { id: documentId, hostIdentity: HOST_IDENTITY },
      { initialMarkdown: "durable base" },
    );
    const secondDocument = await secondEngine.open({
      id: documentId,
      hostIdentity: HOST_IDENTITY,
    });

    const onlineSnapshot = firstDocument.getMarkdownSnapshot();
    expect(onlineSnapshot).toBeDefined();
    await firstDocument.replaceMarkdown("durable base online", {
      origin: "external-file",
      expectedRevision: onlineSnapshot!.revision,
    });
    await vi.waitFor(() => {
      expect(secondDocument.getMarkdown()).toBe("durable base online");
      expect(firstDocument.getState().persistence).toBe("clean");
      expect(secondDocument.getState().persistence).toBe("clean");
    }, { timeout: 5_000, interval: 20 });
    await firstServer.waitForPersistence(documentId);

    await stopServer(firstServer);
    await vi.waitFor(() => {
      expect(firstDocument.getState().transport).toBe("offline");
      expect(secondDocument.getState().transport).toBe("offline");
    }, { timeout: 3_000, interval: 20 });

    const offlineSnapshot = firstDocument.getMarkdownSnapshot();
    expect(offlineSnapshot).toBeDefined();
    await firstDocument.replaceMarkdown("durable base online offline-a", {
      origin: "external-file",
      expectedRevision: offlineSnapshot!.revision,
    });
    await vi.waitFor(() => {
      expect(firstDocument.getState().persistence).toBe("clean");
    }, { timeout: 3_000, interval: 20 });

    await firstDocument.close();
    await closeEngine(firstEngine);
    await closeStore(firstStore);

    firstStore = await openStore(firstDatabase);
    firstEngine = createEngine(
      `ws://127.0.0.1:${serverPort}`,
      firstCredential.token,
      firstStore,
    );
    firstDocument = await firstEngine.open({
      id: documentId,
      hostIdentity: HOST_IDENTITY,
    });
    expect(firstDocument.getMarkdown()).toBe("durable base online offline-a");
    expect(firstDocument.getState()).toMatchObject({
      persistence: "clean",
      access: "local-only",
    });

    const restartedServer = await startServer(serverDirectory, serverPort);
    await vi.waitFor(() => {
      expect(firstDocument.getState()).toMatchObject({ transport: "online", sync: "synced" });
      expect(secondDocument.getState()).toMatchObject({ transport: "online", sync: "synced" });
      expect(firstDocument.getMarkdown()).toBe("durable base online offline-a");
      expect(secondDocument.getMarkdown()).toBe("durable base online offline-a");
      expect(firstDocument.getState().persistence).toBe("clean");
      expect(secondDocument.getState().persistence).toBe("clean");
    }, { timeout: 10_000, interval: 20 });
    expect((secondDocument.getMarkdown()!.match(/offline-a/gu) ?? [])).toHaveLength(1);
    await restartedServer.waitForPersistence(documentId);
  }, 30_000);
});
