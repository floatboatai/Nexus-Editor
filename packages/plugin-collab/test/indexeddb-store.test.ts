import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createIndexedDbReplicaStore } from "../src/indexeddb-store";
import { asDocumentId } from "../src/types";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), {
      once: true,
    });
  });
}

describe("IndexedDB Replica Store", () => {
  it("restores appended updates after closing and reopening a document", async () => {
    const databaseName = `nexus-collab-test-${crypto.randomUUID()}`;
    const firstStore = createIndexedDbReplicaStore({
      databaseName,
      indexedDB,
    });
    const documentId = asDocumentId("5ef21bd2-c142-43a3-a45f-2ca0a0933fb0");

    const first = await firstStore.open(documentId);
    await first.append(new Uint8Array([1, 2, 3]));
    await first.append(new Uint8Array([4, 5]));
    await first.flush();
    await first.close();
    await firstStore.close();

    const reopenedStore = createIndexedDbReplicaStore({
      databaseName,
      indexedDB,
    });
    const reopened = await reopenedStore.open(documentId);
    const restored = await reopened.load();

    expect(restored.updates.map((update) => [...update])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);

    await reopened.close();
    await reopenedStore.close();
  });

  it("atomically replaces the journal with a snapshot before accepting new updates", async () => {
    const store = createIndexedDbReplicaStore({
      databaseName: `nexus-collab-test-${crypto.randomUUID()}`,
      indexedDB,
    });
    const lease = await store.open(
      asDocumentId("0ded8443-f455-4935-8d79-c4662098fab3"),
    );

    await lease.append(new Uint8Array([1]));
    await lease.append(new Uint8Array([2]));
    const through = (await lease.load()).checkpoint;
    await lease.replaceWithSnapshot(new Uint8Array([8, 9]), { through });
    await lease.append(new Uint8Array([3]));

    expect((await lease.load()).updates.map((update) => [...update])).toEqual([
      [8, 9],
      [3],
    ]);

    await lease.close();
    await store.close();
  });

  it("serializes concurrent appends from independent leases without losing updates", async () => {
    const store = createIndexedDbReplicaStore({
      databaseName: `nexus-collab-test-${crypto.randomUUID()}`,
      indexedDB,
    });
    const documentId = asDocumentId("f4696aad-f2b8-431c-bee3-30419a6a107f");
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

  it("compacts only through the supplied checkpoint and preserves later writer updates", async () => {
    const store = createIndexedDbReplicaStore({
      databaseName: `nexus-collab-test-${crypto.randomUUID()}`,
      indexedDB,
    });
    const documentId = asDocumentId("fe680887-18f1-4611-965b-17fa384445be");
    const compactor = await store.open(documentId);
    const concurrentWriter = await store.open(documentId);

    await compactor.append(new Uint8Array([1]));
    const covered = (await compactor.load()).checkpoint;
    const later = await concurrentWriter.append(new Uint8Array([2]));
    await expect(
      compactor.replaceWithSnapshot(new Uint8Array([7]), {
        through: { ...covered, generation: "foreign-generation" },
      }),
    ).rejects.toMatchObject({ code: "checkpoint-invalid" });
    expect(
      (await compactor.load()).updates.map((update) => [...update]),
    ).toEqual([[1], [2]]);
    const head = await compactor.replaceWithSnapshot(new Uint8Array([8]), {
      through: covered,
    });

    expect(head).toEqual(later);
    expect(
      (await compactor.load()).updates.map((update) => [...update]),
    ).toEqual([[8], [2]]);

    await compactor.close();
    await concurrentWriter.close();
    await store.close();
  });

  it("rejects corrupt retained rows during compaction without hanging the lease", async () => {
    const databaseName = `nexus-collab-test-${crypto.randomUUID()}`;
    const store = createIndexedDbReplicaStore({ databaseName, indexedDB });
    const documentId = asDocumentId("0f5588e6-2a1c-4802-81eb-371fc0c42027");
    const lease = await store.open(documentId);
    await lease.append(new Uint8Array([1]));
    const through = (await lease.load()).checkpoint;
    await lease.append(new Uint8Array([2]));

    const rawDatabase = await requestResult(indexedDB.open(databaseName, 1));
    const transaction = rawDatabase.transaction("updates", "readwrite");
    transaction.objectStore("updates").put({
      documentId,
      sequence: 2,
      payload: "corrupt-retained-update",
    });
    await transactionDone(transaction);
    rawDatabase.close();

    await expect(
      lease.replaceWithSnapshot(new Uint8Array([9]), { through }),
    ).rejects.toMatchObject({ code: "store-corrupt" });
    await lease.close();
    await store.close();
  });

  it("rejects an open racing Store close instead of returning an unmanaged lease", async () => {
    const store = createIndexedDbReplicaStore({
      databaseName: `nexus-collab-test-${crypto.randomUUID()}`,
      indexedDB,
    });
    await store.open(asDocumentId("indexeddb-close-existing"));

    const opening = store.open(asDocumentId("indexeddb-close-racing"));
    const closing = store.close();

    await expect(opening).rejects.toMatchObject({ code: "store-closed" });
    await expect(closing).resolves.toBeUndefined();
  });

  it("drains accepted lease writes during Store close while rejecting later writes", async () => {
    const databaseName = `nexus-collab-test-${crypto.randomUUID()}`;
    const documentId = asDocumentId("indexeddb-close-drains-accepted-write");
    const store = createIndexedDbReplicaStore({
      databaseName,
      indexedDB,
      maxUpdateBytes: 2,
    });
    const lease = await store.open(documentId);

    const accepted = lease.append(new Uint8Array([1, 2]));
    const closing = store.close();
    const later = lease.append(new Uint8Array([3, 4, 5]));

    await expect(later).rejects.toMatchObject({ code: "store-closed" });
    await expect(accepted).resolves.toMatchObject({ sequence: 1 });
    await expect(closing).resolves.toBeUndefined();

    const reopenedStore = createIndexedDbReplicaStore({
      databaseName,
      indexedDB,
    });
    const reopenedLease = await reopenedStore.open(documentId);
    expect(
      (await reopenedLease.load()).updates.map((update) => [...update]),
    ).toEqual([[1, 2]]);

    await reopenedLease.close();
    await reopenedStore.close();
  });

  it("rolls back snapshot compaction when retained updates exceed the document limit", async () => {
    const store = createIndexedDbReplicaStore({
      databaseName: `nexus-collab-test-${crypto.randomUUID()}`,
      indexedDB,
      maxDocumentBytes: 4,
    });
    const documentId = asDocumentId("f51c62d2-61ea-47c7-a76b-100785435730");
    const compactor = await store.open(documentId);
    const writer = await store.open(documentId);

    await compactor.append(new Uint8Array([1]));
    const covered = (await compactor.load()).checkpoint;
    await writer.append(new Uint8Array([2]));
    await expect(
      compactor.replaceWithSnapshot(new Uint8Array([8, 8, 8, 8]), {
        through: covered,
      }),
    ).rejects.toMatchObject({ code: "document-too-large" });

    expect(
      (await compactor.load()).updates.map((update) => [...update]),
    ).toEqual([[1], [2]]);

    await compactor.close();
    await writer.close();
    await store.close();
  });

  it("fails oversized writes without corrupting previously durable updates", async () => {
    const store = createIndexedDbReplicaStore({
      databaseName: `nexus-collab-test-${crypto.randomUUID()}`,
      indexedDB,
      maxUpdateBytes: 2,
      maxDocumentBytes: 4,
    });
    const lease = await store.open(
      asDocumentId("d29ed679-59c8-4d8d-88a1-7e3f70f6403b"),
    );
    const callerBuffer = new Uint8Array([1, 2]);
    const firstAppend = lease.append(callerBuffer);
    callerBuffer.fill(9);
    await firstAppend;

    await expect(lease.append(new Uint8Array([3, 4, 5]))).rejects.toMatchObject(
      {
        code: "update-too-large",
      },
    );
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

  it("fails closed when a durable journal has a missing sequence", async () => {
    const databaseName = `nexus-collab-test-${crypto.randomUUID()}`;
    const documentId = asDocumentId("244501f5-5ed5-4c61-b786-56c73d65fb38");
    const firstStore = createIndexedDbReplicaStore({ databaseName, indexedDB });
    const firstLease = await firstStore.open(documentId);
    await firstLease.append(new Uint8Array([1]));
    await firstLease.append(new Uint8Array([2]));
    await firstLease.close();
    await firstStore.close();

    const rawDatabase = await requestResult(indexedDB.open(databaseName, 1));
    const transaction = rawDatabase.transaction(
      ["documents", "updates"],
      "readwrite",
    );
    const documents = transaction.objectStore("documents");
    const record = await requestResult<Record<string, unknown>>(
      documents.get(documentId),
    );
    transaction.objectStore("updates").delete([documentId, 1]);
    documents.put({ ...record, journalBytes: 1 });
    await transactionDone(transaction);
    rawDatabase.close();

    const reopenedStore = createIndexedDbReplicaStore({
      databaseName,
      indexedDB,
    });
    const reopenedLease = await reopenedStore.open(documentId);
    await expect(reopenedLease.load()).rejects.toMatchObject({
      code: "store-corrupt",
    });

    await reopenedLease.close();
    await reopenedStore.close();
  });
});
