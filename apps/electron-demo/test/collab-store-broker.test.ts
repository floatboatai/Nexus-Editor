import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createReplicaStoreRequestBroker } from "../electron/collab-store-request-broker";
import { createSqliteReplicaStore } from "../electron/collab-sqlite-store";
import { createReconnectableCollabStoreBridge } from "../electron/collab-store-preload-bridge";
import { createPortReplicaStore } from "../src/renderer/collab-store-client";
import type { CollaborationStoreChannel } from "../src/shared/collab-store-protocol";
import { asDocumentId } from "../../../packages/plugin-collab/src/types";

interface TestChannel extends CollaborationStoreChannel {
  connect(peer: TestChannel): void;
  dispatch(message: unknown): void;
  remoteClosed(): void;
  pauseOutgoing(): void;
  resumeOutgoing(): void;
}

function channelPair(): readonly [TestChannel, TestChannel] {
  const endpoint = (): TestChannel => {
    let peer: TestChannel | null = null;
    const listeners = new Set<(message: unknown) => void>();
    const closeListeners = new Set<() => void>();
    const pendingOutgoing: unknown[] = [];
    let closed = false;
    let outgoingPaused = false;
    const finishClose = () => {
      if (closed) return;
      closed = true;
      listeners.clear();
      for (const listener of [...closeListeners]) listener();
      closeListeners.clear();
    };
    return {
      connect(next) {
        peer = next;
      },
      postMessage(message) {
        if (closed) throw new Error("channel closed");
        if (outgoingPaused) {
          pendingOutgoing.push(message);
          return;
        }
        queueMicrotask(() => peer?.dispatch(message));
      },
      dispatch(message) {
        if (!closed) for (const listener of [...listeners]) listener(message);
      },
      remoteClosed() {
        finishClose();
      },
      pauseOutgoing() {
        outgoingPaused = true;
      },
      resumeOutgoing() {
        outgoingPaused = false;
        for (const message of pendingOutgoing.splice(0)) {
          queueMicrotask(() => peer?.dispatch(message));
        }
      },
      subscribe(listener) {
        if (closed) throw new Error("channel closed");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      subscribeClose(listener) {
        closeListeners.add(listener);
        return () => closeListeners.delete(listener);
      },
      close() {
        if (closed) return;
        finishClose();
        queueMicrotask(() => peer?.remoteClosed());
      },
    };
  };
  const left = endpoint();
  const right = endpoint();
  left.connect(right);
  right.connect(left);
  return [left, right];
}

describe("Electron collaboration Store broker", () => {
  const temporaryDirectories: string[] = [];
  const require = createRequire(import.meta.url);
  const loadSqlite = async () =>
    require("node:sqlite") as typeof import("node:sqlite");

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("serializes two renderer clients through one Host-owned SQLite writer", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "nexus-collab-broker-"),
    );
    temporaryDirectories.push(directory);
    const sqlite = await createSqliteReplicaStore({
      databasePath: path.join(directory, "replicas.sqlite3"),
      loadSqlite,
    });
    const broker = createReplicaStoreRequestBroker(sqlite);
    const [firstClientChannel, firstHostChannel] = channelPair();
    const [secondClientChannel, secondHostChannel] = channelPair();
    broker.connect(firstHostChannel);
    broker.connect(secondHostChannel);
    const firstStore = createPortReplicaStore(firstClientChannel);
    const secondStore = createPortReplicaStore(secondClientChannel);
    const documentId = asDocumentId("1d5f0135-469c-4420-9560-6d32ad1a2c86");
    const first = await firstStore.open(documentId);
    const second = await secondStore.open(documentId);

    await Promise.all([
      first.append(new Uint8Array([1])),
      second.append(new Uint8Array([2])),
      first.append(new Uint8Array([3])),
      second.append(new Uint8Array([4])),
    ]);
    await first.close();

    const loaded = await second.load();
    const updates = loaded.updates.map((update) => [...update]);
    expect(updates).toHaveLength(4);
    expect(updates).toEqual(expect.arrayContaining([[1], [2], [3], [4]]));

    await second.replaceWithSnapshot(new Uint8Array([8, 9]), {
      through: loaded.checkpoint,
    });
    await second.append(new Uint8Array([5]));
    await second.flush();
    expect((await second.load()).updates.map((update) => [...update])).toEqual([
      [8, 9],
      [5],
    ]);

    await second.close();
    await firstStore.close();
    await secondStore.close();
    await broker.close();
  });

  it("releases only the crashed renderer's leases when its channel closes", async () => {
    const closedLeases: string[] = [];
    const appended: number[] = [];
    const broker = createReplicaStoreRequestBroker({
      async open(documentId) {
        let sequence = 0;
        const generation = `generation-${documentId}`;
        return {
          load: async () => ({
            updates: [],
            checkpoint: { generation, sequence },
          }),
          append: async (update) => {
            appended.push(update[0] ?? -1);
            sequence += 1;
            return { generation, sequence };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation, sequence }),
          close: async () => {
            closedLeases.push(documentId);
          },
        };
      },
      close: async () => undefined,
    });
    const [firstClientChannel, firstHostChannel] = channelPair();
    const [secondClientChannel, secondHostChannel] = channelPair();
    broker.connect(firstHostChannel);
    broker.connect(secondHostChannel);
    const firstStore = createPortReplicaStore(firstClientChannel);
    const secondStore = createPortReplicaStore(secondClientChannel);
    await firstStore.open(asDocumentId("crash-first"));
    const survivor = await secondStore.open(asDocumentId("survivor"));

    firstClientChannel.close();
    await vi.waitFor(() => expect(closedLeases).toEqual(["crash-first"]));
    await survivor.append(new Uint8Array([7]));
    expect(appended).toEqual([7]);

    await survivor.close();
    await secondStore.close();
    await broker.close();
  });

  it("drains a request posted before broker shutdown instead of silently dropping it", async () => {
    const events: string[] = [];
    const broker = createReplicaStoreRequestBroker({
      async open() {
        return {
          load: async () => ({
            updates: [],
            checkpoint: { generation: "shutdown-drain", sequence: 0 },
          }),
          append: async () => {
            events.push("append-committed");
            return { generation: "shutdown-drain", sequence: 1 };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation: "shutdown-drain", sequence: 0 }),
          close: async () => {
            events.push("lease-closed");
          },
        };
      },
      close: async () => {
        events.push("store-closed");
      },
    });
    const [clientChannel, hostChannel] = channelPair();
    broker.connect(hostChannel);
    const store = createPortReplicaStore(clientChannel);
    const lease = await store.open(asDocumentId("shutdown-drain"));

    clientChannel.pauseOutgoing();
    const append = lease.append(new Uint8Array([9]));
    const closing = broker.close();
    await Promise.resolve();
    clientChannel.resumeOutgoing();

    await expect(append).resolves.toEqual({ generation: "shutdown-drain", sequence: 1 });
    await expect(closing).resolves.toBeUndefined();
    expect(events).toEqual(["append-committed", "lease-closed", "store-closed"]);
  });

  it("waits for an already-running append before acknowledging broker shutdown", async () => {
    let releaseAppend!: () => void;
    const appendCanCommit = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    let appendStarted!: () => void;
    const appendDidStart = new Promise<void>((resolve) => {
      appendStarted = resolve;
    });
    const events: string[] = [];
    const broker = createReplicaStoreRequestBroker({
      async open() {
        return {
          load: async () => ({
            updates: [],
            checkpoint: { generation: "running-shutdown", sequence: 0 },
          }),
          append: async () => {
            appendStarted();
            await appendCanCommit;
            events.push("append-committed");
            return { generation: "running-shutdown", sequence: 1 };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation: "running-shutdown", sequence: 0 }),
          close: async () => {
            events.push("lease-closed");
          },
        };
      },
      close: async () => {
        events.push("store-closed");
      },
    });
    const [clientChannel, hostChannel] = channelPair();
    broker.connect(hostChannel);
    const store = createPortReplicaStore(clientChannel);
    const lease = await store.open(asDocumentId("running-shutdown"));

    const append = lease.append(new Uint8Array([4]));
    await appendDidStart;
    const closing = broker.close();
    let shutdownSettled = false;
    void closing.finally(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    releaseAppend();
    await expect(append).resolves.toEqual({ generation: "running-shutdown", sequence: 1 });
    await expect(closing).resolves.toBeUndefined();
    expect(events).toEqual(["append-committed", "lease-closed", "store-closed"]);
  });

  it("drains operations already accepted by the preload bridge before worker shutdown", async () => {
    let releaseFirstAppend!: () => void;
    const firstAppendCanCommit = new Promise<void>((resolve) => {
      releaseFirstAppend = resolve;
    });
    let markFirstAppendStarted!: () => void;
    const firstAppendDidStart = new Promise<void>((resolve) => {
      markFirstAppendStarted = resolve;
    });
    const committed: number[] = [];
    let sequence = 0;
    const broker = createReplicaStoreRequestBroker({
      async open() {
        return {
          load: async () => ({
            updates: [],
            checkpoint: { generation: "preload-drain", sequence },
          }),
          append: async (update) => {
            if (sequence === 0) {
              markFirstAppendStarted();
              await firstAppendCanCommit;
            }
            committed.push(update[0] ?? -1);
            sequence += 1;
            return { generation: "preload-drain", sequence };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation: "preload-drain", sequence }),
          close: async () => undefined,
        };
      },
      close: async () => undefined,
    });
    const [clientChannel, hostChannel] = channelPair();
    broker.connect(hostChannel);
    const bridge = createReconnectableCollabStoreBridge();
    let markDrainStarted!: () => void;
    const drainDidStart = new Promise<void>((resolve) => {
      markDrainStarted = resolve;
    });
    let portStore!: ReturnType<typeof createPortReplicaStore>;
    portStore = createPortReplicaStore(clientChannel, {
      beforeRemoteDrain: () => {
        markDrainStarted();
        return bridge.drain(portStore);
      },
    });
    await bridge.install(portStore);
    const opened = await bridge.request({ operation: "open", documentId: "preload-drain" });
    if (!opened.ok) throw new Error("expected open success");

    const first = bridge.request({
      operation: "append",
      leaseId: opened.leaseId,
      update: new Uint8Array([1]),
    });
    await firstAppendDidStart;
    const second = bridge.request({
      operation: "append",
      leaseId: opened.leaseId,
      update: new Uint8Array([2]),
    });
    const closing = broker.close();
    await drainDidStart;
    await expect(bridge.request({
      operation: "append",
      leaseId: opened.leaseId,
      update: new Uint8Array([3]),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "store-draining" },
    });
    releaseFirstAppend();

    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    await expect(closing).resolves.toBeUndefined();
    expect(committed).toEqual([1, 2]);
  });

  it("reports an unknown drain outcome but still closes Host resources", async () => {
    vi.useFakeTimers();
    try {
      let listener: ((message: unknown) => void) | undefined;
      const closeChannel = vi.fn();
      const closeStore = vi.fn(async () => undefined);
      const broker = createReplicaStoreRequestBroker({
        open: async () => {
          throw new Error("not used");
        },
        close: closeStore,
      }, { drainTimeoutMs: 25 });
      broker.connect({
        postMessage: vi.fn(),
        subscribe(next) {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        close: closeChannel,
      });

      const closing = broker.close();
      const rejected = expect(closing).rejects.toMatchObject({ code: "store-drain-timeout" });
      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(listener).toBeUndefined();
      expect(closeChannel).toHaveBeenCalledOnce();
      expect(closeStore).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("attempts every broker cleanup and reports all failures", async () => {
    const leaseCloseFailures = [
      new Error("first lease close failed"),
      new Error("second lease close failed"),
    ];
    const leaseCloseCalls: string[] = [];
    const storeClose = vi.fn(async () => {
      throw new Error("host store close failed");
    });
    const broker = createReplicaStoreRequestBroker({
      async open(documentId) {
        const generation = `generation-${documentId}`;
        return {
          load: async () => ({
            updates: [],
            checkpoint: { generation, sequence: 0 },
          }),
          append: async () => ({ generation, sequence: 1 }),
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation, sequence: 0 }),
          close: async () => {
            leaseCloseCalls.push(documentId);
            throw leaseCloseFailures[leaseCloseCalls.length - 1];
          },
        };
      },
      close: storeClose,
    });
    const [clientChannel, hostChannel] = channelPair();
    const closeHostChannel = vi.spyOn(hostChannel, "close");
    broker.connect(hostChannel);
    const store = createPortReplicaStore(clientChannel);
    await store.open(asDocumentId("cleanup-first"));
    await store.open(asDocumentId("cleanup-second"));

    const result = broker.close();
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    expect(leaseCloseCalls).toEqual(["cleanup-first", "cleanup-second"]);
    expect(closeHostChannel).toHaveBeenCalledOnce();
    expect(storeClose).toHaveBeenCalledOnce();
    await expect(store.open(asDocumentId("after-close"))).rejects.toMatchObject(
      {
        code: "store-closed",
      },
    );
    expect(broker.close()).toBe(result);
  });

  it("times out an active Store request, ignores its late reply, and remains recoverable", async () => {
    vi.useFakeTimers();
    try {
      let listener: ((message: unknown) => void) | undefined;
      let closeListener: (() => void) | undefined;
      let timedOutRequestId: string | undefined;
      const channel: CollaborationStoreChannel = {
        postMessage(value) {
          const request = value as {
            readonly requestId: string;
            readonly operation: string;
          };
          if (request.operation === "append") {
            timedOutRequestId = request.requestId;
            return;
          }
          queueMicrotask(() => {
            if (request.operation === "load") {
              listener?.({
                requestId: request.requestId,
                ok: true,
                updates: [new Uint8Array([7])],
                checkpoint: { generation: "timeout-generation", sequence: 1 },
              });
            } else {
              listener?.({ requestId: request.requestId, ok: true });
            }
          });
        },
        subscribe(next) {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        subscribeClose(next) {
          closeListener = next;
          return () => {
            closeListener = undefined;
          };
        },
        close() {
          closeListener?.();
        },
      };
      const store = createPortReplicaStore(channel, { requestTimeoutMs: 25 });
      const lease = await store.open(asDocumentId("timeout-document"));

      const appendResult = lease.append(new Uint8Array([1])).then(
        () => undefined,
        (cause) => cause,
      );
      await vi.advanceTimersByTimeAsync(25);
      await expect(appendResult).resolves.toMatchObject({
        code: "store-request-timeout",
      });

      listener?.({
        requestId: timedOutRequestId,
        ok: true,
        checkpoint: { generation: "timeout-generation", sequence: 1 },
      });
      await expect(lease.load()).resolves.toEqual({
        updates: [new Uint8Array([7])],
        checkpoint: { generation: "timeout-generation", sequence: 1 },
      });

      await lease.close();
      await store.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects and remotely closes an open reply that races Store close", async () => {
    let listener: ((message: unknown) => void) | undefined;
    let closeListener: (() => void) | undefined;
    let openRequestId: string | undefined;
    const operations: string[] = [];
    const channelClosed = vi.fn(() => closeListener?.());
    const channel: CollaborationStoreChannel = {
      postMessage(value) {
        const request = value as {
          readonly requestId: string;
          readonly operation: string;
        };
        operations.push(request.operation);
        if (request.operation === "open") {
          openRequestId = request.requestId;
          return;
        }
        queueMicrotask(() =>
          listener?.({ requestId: request.requestId, ok: true }),
        );
      },
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      subscribeClose(next) {
        closeListener = next;
        return () => {
          closeListener = undefined;
        };
      },
      close: channelClosed,
    };
    const store = createPortReplicaStore(channel);
    const opening = store.open(asDocumentId("port-open-close-race"));
    const closing = store.close();
    if (!openRequestId)
      throw new Error("expected the open request to be sent synchronously");
    listener?.({ requestId: openRequestId, ok: true });

    await expect(opening).rejects.toMatchObject({ code: "store-closed" });
    await expect(closing).resolves.toBeUndefined();
    expect(operations).toEqual(["open", "close"]);
    expect(channelClosed).toHaveBeenCalledOnce();
  });

  it("closes its channel after attempting every remote lease cleanup", async () => {
    let listener: ((message: unknown) => void) | undefined;
    let closeListener: (() => void) | undefined;
    let leaseSequence = 0;
    const closedLeases: string[] = [];
    const closeChannel = vi.fn(() => closeListener?.());
    const channel: CollaborationStoreChannel = {
      postMessage(value) {
        const request = value as {
          readonly requestId: string;
          readonly leaseId?: string;
          readonly operation: string;
        };
        queueMicrotask(() => {
          if (request.operation === "open") {
            leaseSequence += 1;
            listener?.({ requestId: request.requestId, ok: true });
            return;
          }
          if (request.operation === "close") {
            closedLeases.push(request.leaseId ?? "missing");
            listener?.({
              requestId: request.requestId,
              ok: false,
              error: {
                code: "lease-close-failed",
                message: `${request.leaseId} failed`,
              },
            });
          }
        });
      },
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      subscribeClose(next) {
        closeListener = next;
        return () => {
          closeListener = undefined;
        };
      },
      close: closeChannel,
    };
    const store = createPortReplicaStore(channel);
    await store.open(asDocumentId("port-cleanup-first"));
    await store.open(asDocumentId("port-cleanup-second"));

    const result = store.close();
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    expect(closedLeases).toHaveLength(2);
    expect(closeChannel).toHaveBeenCalledOnce();
    await expect(store.open(asDocumentId("after-close"))).rejects.toMatchObject(
      {
        code: "store-closed",
      },
    );
    expect(store.close()).toBe(result);
  });
});
