import { describe, expect, it } from "vitest";

import { asDocumentId } from "@floatboat/nexus-plugin-collab";
import {
  ElectronCollabStoreError,
  createElectronCollabReplicaStore,
} from "../src/renderer/collab-ipc-replica-store";
import type {
  CollabStoreOperation,
  CollabStoreRequest,
  CollabStoreResponseByOperation,
  ElectronCollabStoreBridge,
} from "../src/shared/collab-store-ipc";

describe("Electron renderer Replica Store adapter", () => {
  it("maps the Replica Store lifecycle to one opaque privileged lease", async () => {
    const checkpoint = { generation: "store-1", sequence: 2 };
    const requests: CollabStoreRequest[] = [];
    const bridge: ElectronCollabStoreBridge = {
      async request<O extends CollabStoreOperation>(
        request: Extract<CollabStoreRequest, { operation: O }>,
      ) {
        requests.push(request);
        const response =
          request.operation === "open"
            ? { ok: true as const, leaseId: "lease-1" }
            : request.operation === "load"
              ? {
                  ok: true as const,
                  updates: [new Uint8Array([7, 8])],
                  checkpoint,
                }
              : request.operation === "append" ||
                  request.operation === "replace-snapshot"
                ? { ok: true as const, checkpoint }
                : { ok: true as const };
        return response as CollabStoreResponseByOperation[O];
      },
    };
    const store = createElectronCollabReplicaStore({ bridge });
    const lease = await store.open(asDocumentId("document-a"));

    expect((await lease.load()).updates.map((update) => [...update])).toEqual([
      [7, 8],
    ]);
    await lease.append(new Uint8Array([1, 2]));
    await lease.flush();
    await lease.replaceWithSnapshot(new Uint8Array([3, 4]), {
      through: checkpoint,
    });
    await lease.close();
    await lease.close();
    await store.close();

    expect(requests).toEqual([
      { operation: "open", documentId: "document-a" },
      { operation: "load", leaseId: "lease-1" },
      {
        operation: "append",
        leaseId: "lease-1",
        update: new Uint8Array([1, 2]),
      },
      { operation: "flush", leaseId: "lease-1" },
      {
        operation: "replace-snapshot",
        leaseId: "lease-1",
        update: new Uint8Array([3, 4]),
        through: checkpoint,
      },
      { operation: "close", leaseId: "lease-1" },
    ]);
  });

  it("surfaces a structured broker failure and invalidates closed leases", async () => {
    const bridge: ElectronCollabStoreBridge = {
      async request<O extends CollabStoreOperation>(
        request: Extract<CollabStoreRequest, { operation: O }>,
      ) {
        const response =
          request.operation === "open"
            ? { ok: true as const, leaseId: "lease-2" }
            : request.operation === "close"
              ? { ok: true as const }
              : {
                  ok: false as const,
                  error: {
                    code: "sqlite-unavailable",
                    message: "SQLite unavailable",
                  },
                };
        return response as CollabStoreResponseByOperation[O];
      },
    };
    const store = createElectronCollabReplicaStore({ bridge });
    const lease = await store.open(asDocumentId("document-b"));

    await expect(lease.load()).rejects.toMatchObject({
      name: "ElectronCollabStoreError",
      code: "sqlite-unavailable",
    });
    await lease.close();
    await expect(lease.flush()).rejects.toBeInstanceOf(
      ElectronCollabStoreError,
    );
    await store.close();
  });

  it("attempts every lease cleanup and remains closed when cleanup fails", async () => {
    let leaseSequence = 0;
    const closedLeases: string[] = [];
    const bridge: ElectronCollabStoreBridge = {
      async request<O extends CollabStoreOperation>(
        request: Extract<CollabStoreRequest, { operation: O }>,
      ) {
        const response =
          request.operation === "open"
            ? { ok: true as const, leaseId: `lease-${++leaseSequence}` }
            : request.operation === "close"
              ? (() => {
                  const leaseId = (
                    request as Extract<
                      CollabStoreRequest,
                      { operation: "close" }
                    >
                  ).leaseId;
                  closedLeases.push(leaseId);
                  return {
                    ok: false as const,
                    error: {
                      code: "lease-close-failed",
                      message: `${leaseId} failed`,
                    },
                  };
                })()
              : { ok: true as const };
        return response as CollabStoreResponseByOperation[O];
      },
    };
    const store = createElectronCollabReplicaStore({ bridge });
    await store.open(asDocumentId("document-first"));
    await store.open(asDocumentId("document-second"));

    const result = store.close();
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    expect(closedLeases).toEqual(["lease-1", "lease-2"]);
    await expect(store.open(asDocumentId("after-close"))).rejects.toMatchObject(
      {
        code: "store-closed",
      },
    );
    expect(store.close()).toBe(result);
  });

  it("rejects and closes a privileged lease whose open response races Store close", async () => {
    let resolveOpen!: (value: CollabStoreResponseByOperation["open"]) => void;
    const closedLeases: string[] = [];
    const bridge: ElectronCollabStoreBridge = {
      request<O extends CollabStoreOperation>(
        request: Extract<CollabStoreRequest, { operation: O }>,
      ) {
        if (request.operation === "open") {
          return new Promise<CollabStoreResponseByOperation["open"]>(
            (resolve) => {
              resolveOpen = resolve;
            },
          ) as Promise<CollabStoreResponseByOperation[O]>;
        }
        if (request.operation === "close") {
          closedLeases.push(
            (
              request as Extract<
                CollabStoreRequest,
                { readonly operation: "close" }
              >
            ).leaseId,
          );
        }
        return Promise.resolve({ ok: true }) as Promise<
          CollabStoreResponseByOperation[O]
        >;
      },
    };
    const store = createElectronCollabReplicaStore({ bridge });
    const opening = store.open(asDocumentId("ipc-open-close-race"));
    const closing = store.close();
    resolveOpen({ ok: true, leaseId: "late-lease" });

    await expect(opening).rejects.toMatchObject({ code: "store-closed" });
    await expect(closing).resolves.toBeUndefined();
    expect(closedLeases).toEqual(["late-lease"]);
  });
});
