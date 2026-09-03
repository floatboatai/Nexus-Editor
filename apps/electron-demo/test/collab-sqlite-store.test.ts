import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteReplicaStore } from "../electron/collab-sqlite-store";
import { asDocumentId } from "../../../packages/plugin-collab/src/types";

describe("Electron SQLite Replica Store", () => {
  const require = createRequire(import.meta.url);
  const loadSqlite = async () => require("node:sqlite") as typeof import("node:sqlite");
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })));
  });

  it("restores durable updates after the database is closed and reopened", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nexus-collab-sqlite-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "replicas.sqlite3");
    const documentId = asDocumentId("7d9f03a6-e918-4acd-bdb0-0dda8b8f4f35");

    const firstStore = await createSqliteReplicaStore({ databasePath, loadSqlite });
    const firstLease = await firstStore.open(documentId);
    await firstLease.append(new Uint8Array([11, 12, 13]));
    await firstLease.flush();
    await firstLease.close();
    await firstStore.close();

    const reopenedStore = await createSqliteReplicaStore({ databasePath, loadSqlite });
    const reopenedLease = await reopenedStore.open(documentId);

    expect((await reopenedLease.load()).updates.map((update) => [...update])).toEqual([
      [11, 12, 13],
    ]);

    await reopenedLease.close();
    await reopenedStore.close();
  });

  it("atomically compacts journal rows into a snapshot across restart", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nexus-collab-sqlite-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "replicas.sqlite3");
    const documentId = asDocumentId("134ea2fa-abd5-4054-8187-c986b14fd3ee");
    const store = await createSqliteReplicaStore({ databasePath, loadSqlite });
    const lease = await store.open(documentId);

    await lease.append(new Uint8Array([1]));
    await lease.append(new Uint8Array([2]));
    const through = (await lease.load()).checkpoint;
    await lease.replaceWithSnapshot(new Uint8Array([8, 9]), { through });
    await lease.append(new Uint8Array([3]));
    await lease.close();
    await store.close();

    const reopenedStore = await createSqliteReplicaStore({ databasePath, loadSqlite });
    const reopenedLease = await reopenedStore.open(documentId);
    expect((await reopenedLease.load()).updates.map((update) => [...update])).toEqual([
      [8, 9],
      [3],
    ]);

    await reopenedLease.close();
    await reopenedStore.close();
  });

  it("serializes concurrent leases through one database writer", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nexus-collab-sqlite-"));
    temporaryDirectories.push(directory);
    const store = await createSqliteReplicaStore({
      databasePath: path.join(directory, "replicas.sqlite3"),
      loadSqlite,
    });
    const documentId = asDocumentId("bc38a8e2-a3d9-4cf8-9480-3a5bd39abfd7");
    const first = await store.open(documentId);
    const second = await store.open(documentId);

    await Promise.all([
      first.append(new Uint8Array([1])),
      second.append(new Uint8Array([2])),
      first.append(new Uint8Array([3])),
      second.append(new Uint8Array([4])),
    ]);

    const restored = (await first.load()).updates.map((update) => [...update]);
    expect(restored).toHaveLength(4);
    expect(restored).toEqual(expect.arrayContaining([[1], [2], [3], [4]]));

    await first.close();
    await second.close();
    await store.close();
  });

  it("preserves journal rows written after a snapshot checkpoint", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nexus-collab-sqlite-"));
    temporaryDirectories.push(directory);
    const store = await createSqliteReplicaStore({
      databasePath: path.join(directory, "replicas.sqlite3"),
      loadSqlite,
    });
    const documentId = asDocumentId("f69d35aa-e5cc-4915-a7f0-b0f13102e306");
    const compactor = await store.open(documentId);
    const concurrentWriter = await store.open(documentId);

    await compactor.append(new Uint8Array([1]));
    const covered = (await compactor.load()).checkpoint;
    const later = await concurrentWriter.append(new Uint8Array([2]));
    await expect(compactor.replaceWithSnapshot(new Uint8Array([7]), {
      through: { ...covered, generation: "foreign-generation" },
    })).rejects.toMatchObject({ code: "checkpoint-invalid" });
    expect((await compactor.load()).updates.map((update) => [...update])).toEqual([
      [1],
      [2],
    ]);
    const head = await compactor.replaceWithSnapshot(new Uint8Array([8]), { through: covered });

    expect(head).toEqual(later);
    expect((await compactor.load()).updates.map((update) => [...update])).toEqual([
      [8],
      [2],
    ]);

    await compactor.close();
    await concurrentWriter.close();
    await store.close();
  });

  it("rolls back snapshot replacement when retained rows exceed the document limit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nexus-collab-sqlite-"));
    temporaryDirectories.push(directory);
    const store = await createSqliteReplicaStore({
      databasePath: path.join(directory, "replicas.sqlite3"),
      loadSqlite,
      maxDocumentBytes: 4,
    });
    const documentId = asDocumentId("b94099c6-1883-420e-b87c-f1e5c2908baa");
    const compactor = await store.open(documentId);
    const writer = await store.open(documentId);

    await compactor.append(new Uint8Array([1]));
    const covered = (await compactor.load()).checkpoint;
    await writer.append(new Uint8Array([2]));
    await expect(compactor.replaceWithSnapshot(
      new Uint8Array([8, 8, 8, 8]),
      { through: covered },
    )).rejects.toMatchObject({ code: "document-too-large" });
    expect((await compactor.load()).updates.map((update) => [...update])).toEqual([
      [1],
      [2],
    ]);

    await compactor.close();
    await writer.close();
    await store.close();
  });

  it("rolls back rejected writes and preserves the durable journal", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nexus-collab-sqlite-"));
    temporaryDirectories.push(directory);
    const store = await createSqliteReplicaStore({
      databasePath: path.join(directory, "replicas.sqlite3"),
      loadSqlite,
      maxUpdateBytes: 2,
      maxDocumentBytes: 4,
    });
    const lease = await store.open(asDocumentId("051ff264-03bd-4c08-a71b-6480d69369d5"));

    await lease.append(new Uint8Array([1, 2]));
    await expect(lease.append(new Uint8Array([3, 4, 5]))).rejects.toMatchObject({
      code: "update-too-large",
    });
    await lease.append(new Uint8Array([3, 4]));
    await expect(lease.append(new Uint8Array([5]))).rejects.toMatchObject({
      code: "document-too-large",
    });
    expect((await lease.load()).updates.map((update) => [...update])).toEqual([
      [1, 2],
      [3, 4],
    ]);

    await lease.close();
    await store.close();
  });

  it("fails with a capability diagnostic when node:sqlite is unavailable", async () => {
    await expect(createSqliteReplicaStore({
      databasePath: ":memory:",
      loadSqlite: async () => ({ DatabaseSync: undefined }) as never,
    })).rejects.toMatchObject({ code: "sqlite-unavailable" });
  });

  it("fails closed when a SQLite journal has a missing sequence", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "nexus-collab-sqlite-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "replicas.sqlite3");
    const documentId = asDocumentId("26733df9-4b68-41e9-af75-281cfbe1aa83");
    const firstStore = await createSqliteReplicaStore({ databasePath, loadSqlite });
    const firstLease = await firstStore.open(documentId);
    await firstLease.append(new Uint8Array([1]));
    await firstLease.append(new Uint8Array([2]));
    await firstLease.close();
    await firstStore.close();

    const { DatabaseSync } = await loadSqlite();
    const rawDatabase = new DatabaseSync(databasePath);
    rawDatabase.prepare(`
      DELETE FROM collab_updates
      WHERE document_id = ? AND sequence = 1
    `).run(documentId);
    rawDatabase.prepare(`
      UPDATE collab_documents
      SET journal_bytes = 1
      WHERE document_id = ?
    `).run(documentId);
    rawDatabase.close();

    const reopenedStore = await createSqliteReplicaStore({ databasePath, loadSqlite });
    const reopenedLease = await reopenedStore.open(documentId);
    await expect(reopenedLease.load()).rejects.toMatchObject({ code: "store-corrupt" });

    await reopenedLease.close();
    await reopenedStore.close();
  });
});
