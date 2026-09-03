import { describe, expect, it, vi } from "vitest";

import type {
  DocumentId,
  ReplicaStore,
  ReplicaStoreLease,
} from "@floatboat/nexus-plugin-collab";
import { asDocumentId } from "../../../packages/plugin-collab/src/types";
import { createReconnectableCollabStoreBridge } from "../electron/collab-store-preload-bridge";

interface StoreHarness {
  readonly store: ReplicaStore & { close(): Promise<void> };
  readonly opened: DocumentId[];
  readonly appended: number[][];
  readonly closed: ReturnType<typeof vi.fn>;
}

function createStoreHarness(loadValue: number): StoreHarness {
  const opened: DocumentId[] = [];
  const appended: number[][] = [];
  const closed = vi.fn(async () => undefined);
  const generation = `store-${loadValue}`;
  let sequence = 0;
  const store: StoreHarness["store"] = {
    async open(documentId) {
      opened.push(documentId);
      let leaseClosed = false;
      const lease: ReplicaStoreLease = {
        async load() {
          if (leaseClosed) throw new Error("closed");
          return {
            updates: [new Uint8Array([loadValue])],
            checkpoint: { generation, sequence },
          };
        },
        async append(update) {
          if (leaseClosed) throw new Error("closed");
          appended.push([...update]);
          sequence += 1;
          return { generation, sequence };
        },
        async flush() {
          if (leaseClosed) throw new Error("closed");
        },
        async replaceWithSnapshot(update, options) {
          if (leaseClosed) throw new Error("closed");
          appended.push([...update]);
          return {
            generation,
            sequence: Math.max(sequence, options.through.sequence),
          };
        },
        async close() {
          leaseClosed = true;
        },
      };
      return lease;
    },
    close: closed,
  };
  return { store, opened, appended, closed };
}

describe("reconnectable Electron collaboration Store preload bridge", () => {
  it("keeps renderer lease identifiers opaque while delegating to the active MessagePort Store", async () => {
    const harness = createStoreHarness(7);
    const bridge = createReconnectableCollabStoreBridge({
      requestTimeoutMs: 1_000,
    });
    await bridge.install(harness.store);

    const opened = await bridge.request({
      operation: "open",
      documentId: "997f0f58-d978-462c-8a65-12c845c9d501",
    });
    expect(opened).toMatchObject({ ok: true });
    if (!opened.ok) throw new Error("expected open success");
    expect(opened.leaseId).not.toContain("997f0f58");
    expect(harness.opened).toEqual([
      asDocumentId("997f0f58-d978-462c-8a65-12c845c9d501"),
    ]);

    await expect(
      bridge.request({ operation: "load", leaseId: opened.leaseId }),
    ).resolves.toEqual({
      ok: true,
      updates: [new Uint8Array([7])],
      checkpoint: { generation: "store-7", sequence: 0 },
    });
    await bridge.request({
      operation: "append",
      leaseId: opened.leaseId,
      update: new Uint8Array([1, 2]),
    });
    expect(harness.appended).toEqual([[1, 2]]);

    await bridge.close();
    expect(harness.closed).toHaveBeenCalledTimes(1);
  });

  it("reopens active documents and lets an operation wait across a utility-process restart", async () => {
    const first = createStoreHarness(1);
    const second = createStoreHarness(2);
    const bridge = createReconnectableCollabStoreBridge({
      requestTimeoutMs: 1_000,
    });
    await bridge.install(first.store);
    const opened = await bridge.request({
      operation: "open",
      documentId: "document-reconnect",
    });
    if (!opened.ok) throw new Error("expected open success");

    bridge.disconnect(new Error("utility exited"));
    const pendingAppend = bridge.request({
      operation: "append",
      leaseId: opened.leaseId,
      update: new Uint8Array([9]),
    });
    await bridge.install(second.store);

    await expect(pendingAppend).resolves.toEqual({
      ok: true,
      checkpoint: { generation: "store-2", sequence: 1 },
    });
    expect(second.opened).toEqual([asDocumentId("document-reconnect")]);
    expect(second.appended).toEqual([[9]]);
    await expect(
      bridge.request({ operation: "load", leaseId: opened.leaseId }),
    ).resolves.toEqual({
      ok: true,
      updates: [new Uint8Array([2])],
      checkpoint: { generation: "store-2", sequence: 1 },
    });

    await bridge.close();
  });

  it("fails an old in-flight append after reconnect and keeps the replacement Store usable", async () => {
    let resolveOldAppend!: (checkpoint: {
      readonly generation: string;
      readonly sequence: number;
    }) => void;
    let markOldAppendStarted!: () => void;
    const oldAppendStarted = new Promise<void>((resolve) => {
      markOldAppendStarted = resolve;
    });
    const oldStore: StoreHarness["store"] = {
      async open() {
        return {
          load: async () => ({
            updates: [],
            checkpoint: { generation: "store-old", sequence: 0 },
          }),
          append: async () => {
            markOldAppendStarted();
            return new Promise((resolve) => {
              resolveOldAppend = resolve;
            });
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({
            generation: "store-old",
            sequence: 0,
          }),
          close: async () => undefined,
        };
      },
      close: vi.fn(async () => undefined),
    };
    const replacement = createStoreHarness(2);
    const bridge = createReconnectableCollabStoreBridge({
      requestTimeoutMs: 1_000,
    });
    await bridge.install(oldStore);
    const opened = await bridge.request({
      operation: "open",
      documentId: "append-reconnect-race",
    });
    if (!opened.ok) throw new Error("expected open success");

    const staleAppend = bridge.request({
      operation: "append",
      leaseId: opened.leaseId,
      update: new Uint8Array([1]),
    });
    await oldAppendStarted;
    bridge.disconnect(new Error("replacement MessagePort arrived"));
    await bridge.install(replacement.store);
    resolveOldAppend({ generation: "store-old", sequence: 1 });

    await expect(staleAppend).resolves.toEqual({
      ok: false,
      error: {
        code: "store-reconnect-failed",
        message: "Collaboration persistence operation failed.",
      },
    });
    await expect(
      bridge.request({
        operation: "append",
        leaseId: opened.leaseId,
        update: new Uint8Array([2]),
      }),
    ).resolves.toEqual({
      ok: true,
      checkpoint: { generation: "store-2", sequence: 1 },
    });
    expect(replacement.appended).toEqual([[2]]);

    await bridge.close();
  });

  it("drains accepted per-lease operations before reporting lease close success", async () => {
    let releaseFirstAppend!: () => void;
    const firstAppendCanFinish = new Promise<void>((resolve) => {
      releaseFirstAppend = resolve;
    });
    let markFirstAppendStarted!: () => void;
    const firstAppendDidStart = new Promise<void>((resolve) => {
      markFirstAppendStarted = resolve;
    });
    const committed: number[] = [];
    let sequence = 0;
    const store: StoreHarness["store"] = {
      async open() {
        let closed = false;
        return {
          load: async () => ({
            updates: [],
            checkpoint: { generation: "lease-close-drain", sequence },
          }),
          append: async (update) => {
            if (closed) throw new Error("closed");
            if (sequence === 0) {
              markFirstAppendStarted();
              await firstAppendCanFinish;
            }
            if (closed) throw new Error("closed");
            committed.push(update[0] ?? -1);
            sequence += 1;
            return { generation: "lease-close-drain", sequence };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation: "lease-close-drain", sequence }),
          close: async () => {
            closed = true;
          },
        };
      },
      close: async () => undefined,
    };
    const bridge = createReconnectableCollabStoreBridge();
    await bridge.install(store);
    const opened = await bridge.request({ operation: "open", documentId: "lease-close-drain" });
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
    const closing = bridge.request({ operation: "close", leaseId: opened.leaseId });
    releaseFirstAppend();

    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    await expect(closing).resolves.toEqual({ ok: true });
    expect(committed).toEqual([1, 2]);
    await bridge.close();
  });

  it("drains accepted per-lease operations before reporting bridge close success", async () => {
    let releaseAppend!: () => void;
    const appendCanFinish = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    let markAppendStarted!: () => void;
    const appendDidStart = new Promise<void>((resolve) => {
      markAppendStarted = resolve;
    });
    const committed: number[] = [];
    const store: StoreHarness["store"] = {
      async open() {
        let closed = false;
        return {
          load: async () => ({
            updates: [],
            checkpoint: { generation: "bridge-close-drain", sequence: 0 },
          }),
          append: async (update) => {
            markAppendStarted();
            await appendCanFinish;
            if (closed) throw new Error("closed");
            committed.push(update[0] ?? -1);
            return { generation: "bridge-close-drain", sequence: 1 };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation: "bridge-close-drain", sequence: 0 }),
          close: async () => {
            closed = true;
          },
        };
      },
      close: async () => undefined,
    };
    const bridge = createReconnectableCollabStoreBridge();
    await bridge.install(store);
    const opened = await bridge.request({ operation: "open", documentId: "bridge-close-drain" });
    if (!opened.ok) throw new Error("expected open success");

    const append = bridge.request({
      operation: "append",
      leaseId: opened.leaseId,
      update: new Uint8Array([5]),
    });
    await appendDidStart;
    const closing = bridge.close();
    let closeSettled = false;
    void closing.then(() => {
      closeSettled = true;
    });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    releaseAppend();

    await expect(append).resolves.toMatchObject({ ok: true });
    await expect(closing).resolves.toBeUndefined();
    expect(committed).toEqual([5]);
  });

  it("returns a bounded structured failure when no utility connection arrives", async () => {
    vi.useFakeTimers();
    try {
      const bridge = createReconnectableCollabStoreBridge({
        requestTimeoutMs: 25,
      });
      const responsePromise = bridge.request({
        operation: "open",
        documentId: "document-timeout",
      });
      await vi.advanceTimersByTimeAsync(25);
      await expect(responsePromise).resolves.toEqual({
        ok: false,
        error: {
          code: "store-connection-timeout",
          message:
            "Collaboration persistence is unavailable. Try reconnecting.",
        },
      });
      await bridge.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects and closes an old-generation lease when install overtakes open", async () => {
    let resolveOldOpen!: (lease: ReplicaStoreLease) => void;
    let markOldOpenStarted!: () => void;
    const oldOpenStarted = new Promise<void>((resolve) => {
      markOldOpenStarted = resolve;
    });
    const closeOldLease = vi.fn(async () => undefined);
    const oldStore: StoreHarness["store"] = {
      open: async () => {
        markOldOpenStarted();
        return new Promise<ReplicaStoreLease>((resolve) => {
          resolveOldOpen = resolve;
        });
      },
      close: vi.fn(async () => undefined),
    };
    const replacement = createStoreHarness(2);
    const bridge = createReconnectableCollabStoreBridge({
      requestTimeoutMs: 1_000,
    });
    await bridge.install(oldStore);
    const opening = bridge.request({
      operation: "open",
      documentId: "generation-race",
    });
    await oldOpenStarted;

    await bridge.install(replacement.store);
    resolveOldOpen({
      load: async () => ({
        updates: [],
        checkpoint: { generation: "old", sequence: 0 },
      }),
      append: async () => ({ generation: "old", sequence: 1 }),
      flush: async () => undefined,
      replaceWithSnapshot: async () => ({ generation: "old", sequence: 0 }),
      close: closeOldLease,
    });

    await expect(opening).resolves.toMatchObject({
      ok: false,
      error: { code: "store-reconnect-failed" },
    });
    expect(closeOldLease).toHaveBeenCalledOnce();
    await bridge.close();
  });

  it("waits for and closes an open overtaken by bridge close", async () => {
    let resolveOpen!: (lease: ReplicaStoreLease) => void;
    let markOpenStarted!: () => void;
    const openStarted = new Promise<void>((resolve) => {
      markOpenStarted = resolve;
    });
    const closeLateLease = vi.fn(async () => undefined);
    const store: StoreHarness["store"] = {
      open: async () => {
        markOpenStarted();
        return new Promise<ReplicaStoreLease>((resolve) => {
          resolveOpen = resolve;
        });
      },
      close: vi.fn(async () => undefined),
    };
    const bridge = createReconnectableCollabStoreBridge({
      requestTimeoutMs: 1_000,
    });
    await bridge.install(store);
    const opening = bridge.request({
      operation: "open",
      documentId: "bridge-close-race",
    });
    await openStarted;

    const closing = bridge.close();
    let closeSettled = false;
    void closing.then(() => {
      closeSettled = true;
    });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    resolveOpen({
      load: async () => ({
        updates: [],
        checkpoint: { generation: "late", sequence: 0 },
      }),
      append: async () => ({ generation: "late", sequence: 1 }),
      flush: async () => undefined,
      replaceWithSnapshot: async () => ({ generation: "late", sequence: 0 }),
      close: closeLateLease,
    });

    await expect(opening).resolves.toMatchObject({
      ok: false,
      error: { code: "store-closed" },
    });
    await closing;
    expect(closeLateLease).toHaveBeenCalledOnce();
  });
});
