import type {
  DocumentId,
  ReplicaStore,
  ReplicaStoreLease,
} from "@floatboat/nexus-plugin-collab";

import {
  parseCollabStoreRequest,
  type CollabStoreFailure,
  type CollabStoreOperation,
  type CollabStoreRequest,
  type CollabStoreResponseByOperation,
  type ElectronCollabStoreBridge,
} from "../src/shared/collab-store-ipc";

export interface CloseableReplicaStore extends ReplicaStore {
  close(): Promise<void>;
}

export interface ReconnectableCollabStoreBridge
  extends ElectronCollabStoreBridge {
  install(store: CloseableReplicaStore): Promise<void>;
  drain(store: CloseableReplicaStore): Promise<void>;
  disconnect(cause?: unknown): void;
  close(): Promise<void>;
}

export interface ReconnectableCollabStoreBridgeOptions {
  readonly requestTimeoutMs?: number;
  readonly createLeaseId?: () => string;
}

interface ExternalLease {
  readonly documentId: string;
  inner: ReplicaStoreLease | null;
  closing: boolean;
  closed: boolean;
  tail: Promise<void>;
}

interface DeferredStore {
  readonly promise: Promise<CloseableReplicaStore>;
  resolve(store: CloseableReplicaStore): void;
  reject(cause: unknown): void;
  settled: boolean;
}

const CONNECTION_TIMEOUT_MESSAGE =
  "Collaboration persistence is unavailable. Try reconnecting.";

// Every value reaching this seam has already passed parseCollabStoreRequest.
// Keep the preload runtime independent of workspace package build artifacts.
function asValidatedDocumentId(value: string): DocumentId {
  return value as DocumentId;
}

function deferredStore(): DeferredStore {
  let resolvePromise!: (store: CloseableReplicaStore) => void;
  let rejectPromise!: (cause: unknown) => void;
  const deferred: DeferredStore = {
    promise: new Promise<CloseableReplicaStore>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve(store) {
      if (deferred.settled) return;
      deferred.settled = true;
      resolvePromise(store);
    },
    reject(cause) {
      if (deferred.settled) return;
      deferred.settled = true;
      rejectPromise(cause);
    },
    settled: false,
  };
  // A disconnect or shutdown can reject a generation before any request is
  // waiting on it. Mark the promise observed while preserving rejection for
  // callers that subsequently await the same promise.
  void deferred.promise.catch(() => undefined);
  return deferred;
}

function failure(code: string, message: string): CollabStoreFailure {
  return { ok: false, error: { code, message } };
}

function opaqueId(): string {
  const random =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `lease-${random}`;
}

function safeFailure(cause: unknown): CollabStoreFailure {
  const candidate =
    cause && typeof cause === "object"
      ? (cause as { readonly code?: unknown })
      : undefined;
  const code =
    typeof candidate?.code === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(candidate.code)
      ? candidate.code
      : "store-operation-failed";
  return failure(code, "Collaboration persistence operation failed.");
}

export function createReconnectableCollabStoreBridge(
  options: ReconnectableCollabStoreBridgeOptions = {},
): ReconnectableCollabStoreBridge {
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new RangeError("requestTimeoutMs must be a positive safe integer");
  }
  const createLeaseId = options.createLeaseId ?? opaqueId;
  const leases = new Map<string, ExternalLease>();
  const openings = new Set<Promise<string>>();
  let connection = deferredStore();
  let activeStore: CloseableReplicaStore | null = null;
  let generation = 0;
  let drainGeneration: number | null = null;
  let drainPromise: Promise<void> | null = null;
  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;

  function resetConnection(): void {
    if (!connection.settled) return;
    connection = deferredStore();
  }

  async function waitForStore(): Promise<CloseableReplicaStore> {
    if (closed) {
      throw Object.assign(new Error("Collaboration Store bridge is closed"), {
        code: "store-closed",
      });
    }
    if (activeStore) return activeStore;
    const deferred = connection;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        deferred.promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(new Error(CONNECTION_TIMEOUT_MESSAGE), {
                  code: "store-connection-timeout",
                }),
              ),
            requestTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function requireLease(leaseId: string): ExternalLease {
    const lease = leases.get(leaseId);
    if (!lease || lease.closing || lease.closed) {
      throw Object.assign(new Error("Collaboration Store lease is closed"), {
        code: "lease-closed",
      });
    }
    return lease;
  }

  function connectionChangedError(): Error {
    return Object.assign(
      new Error("Collaboration Store connection changed during operation"),
      { code: closed ? "store-closed" : "store-reconnect-failed" },
    );
  }

  function leaseClosedError(): Error {
    return Object.assign(new Error("Collaboration Store lease is closed"), {
      code: "lease-closed",
    });
  }

  async function withLease<T>(
    lease: ExternalLease,
    operation: (inner: ReplicaStoreLease) => Promise<T>,
  ): Promise<T> {
    const result = lease.tail.then(async () => {
      const store = await waitForStore();
      const operationGeneration = generation;
      const inner = lease.inner;
      if (lease.closed || !inner) throw leaseClosedError();
      if (closed || activeStore !== store) throw connectionChangedError();

      let value: T;
      try {
        value = await operation(inner);
      } catch (cause) {
        if (
          closed ||
          operationGeneration !== generation ||
          activeStore !== store ||
          lease.inner !== inner
        ) {
          throw connectionChangedError();
        }
        throw cause;
      }
      if (closed) throw connectionChangedError();
      if (lease.closed) throw leaseClosedError();
      if (
        operationGeneration !== generation ||
        activeStore !== store ||
        lease.inner !== inner
      ) {
        throw connectionChangedError();
      }
      return value;
    });
    lease.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function trackOpening(opening: Promise<string>): Promise<string> {
    openings.add(opening);
    void opening.then(
      () => openings.delete(opening),
      () => openings.delete(opening),
    );
    return opening;
  }

  function openExternalLease(documentId: string): Promise<string> {
    return trackOpening(
      (async () => {
        const store = await waitForStore();
        const openGeneration = generation;
        if (closed || activeStore !== store) {
          throw Object.assign(
            new Error("Collaboration Store connection changed while opening"),
            {
              code: closing || closed ? "store-closed" : "store-reconnect-failed",
            },
          );
        }
        const inner = await store.open(asValidatedDocumentId(documentId));
        if (closing || closed || openGeneration !== generation || activeStore !== store) {
          await inner.close().catch(() => undefined);
          throw Object.assign(
            new Error("Collaboration Store connection changed while opening"),
            {
              code: closing || closed ? "store-closed" : "store-reconnect-failed",
            },
          );
        }
        let leaseId = createLeaseId();
        while (leases.has(leaseId)) leaseId = createLeaseId();
        leases.set(leaseId, {
          documentId,
          inner,
          closing: false,
          closed: false,
          tail: Promise.resolve(),
        });
        return leaseId;
      })(),
    );
  }

  const bridge: ReconnectableCollabStoreBridge = {
    async install(store): Promise<void> {
      if (closing || closed) {
        await store.close().catch(() => undefined);
        throw new Error("Collaboration Store bridge is closed");
      }
      const installGeneration = ++generation;
      drainGeneration = null;
      drainPromise = null;
      const previous = activeStore;
      activeStore = null;
      resetConnection();

      const openLeases = new Map<ExternalLease, ReplicaStoreLease>();
      try {
        await Promise.all(
          [...leases.values()]
            .filter((lease) => !lease.closed)
            .map(async (lease) => {
              openLeases.set(
                lease,
                await store.open(asValidatedDocumentId(lease.documentId)),
              );
            }),
        );
      } catch (cause) {
        await Promise.all(
          [...openLeases.values()].map((lease) =>
            lease.close().catch(() => undefined),
          ),
        );
        await store.close().catch(() => undefined);
        if (installGeneration === generation) {
          connection.reject(
            Object.assign(new Error("Collaboration Store reconnect failed"), {
              code: "store-reconnect-failed",
            }),
          );
        }
        throw cause;
      }

      if (closed || installGeneration !== generation) {
        await Promise.all(
          [...openLeases.values()].map((lease) =>
            lease.close().catch(() => undefined),
          ),
        );
        await store.close().catch(() => undefined);
        return;
      }
      for (const [lease, inner] of openLeases) lease.inner = inner;
      activeStore = store;
      connection.resolve(store);
      if (previous && previous !== store)
        void previous.close().catch(() => undefined);
    },

    drain(store): Promise<void> {
      if (closed) {
        return Promise.reject(Object.assign(
          new Error("Collaboration Store bridge is closed"),
          { code: "store-closed" },
        ));
      }
      if (activeStore !== store) return Promise.reject(connectionChangedError());
      if (drainGeneration === generation && drainPromise) return drainPromise;
      const operationGeneration = generation;
      drainGeneration = operationGeneration;
      drainPromise = (async () => {
        await Promise.allSettled([...openings]);
        await Promise.all([...leases.values()].map((lease) => lease.tail));
        if (
          closed
          || generation !== operationGeneration
          || activeStore !== store
        ) {
          throw connectionChangedError();
        }
      })();
      return drainPromise;
    },

    disconnect(): void {
      if (closed) return;
      generation += 1;
      drainGeneration = null;
      drainPromise = null;
      const previous = activeStore;
      activeStore = null;
      for (const lease of leases.values()) lease.inner = null;
      resetConnection();
      if (previous) void previous.close().catch(() => undefined);
    },

    async request<O extends CollabStoreOperation>(
      untrustedRequest: Extract<CollabStoreRequest, { readonly operation: O }>,
    ): Promise<CollabStoreResponseByOperation[O]> {
      let request: CollabStoreRequest;
      try {
        request = parseCollabStoreRequest(untrustedRequest);
      } catch {
        return failure(
          "store-request-invalid",
          "Collaboration persistence request is invalid.",
        ) as CollabStoreResponseByOperation[O];
      }

      try {
        if (closing || closed) {
          throw Object.assign(
            new Error("Collaboration Store bridge is closed"),
            { code: "store-closed" },
          );
        }
        if (drainGeneration === generation) {
          throw Object.assign(
            new Error("Collaboration Store is draining for utility shutdown"),
            { code: "store-draining" },
          );
        }
        switch (request.operation) {
          case "open": {
            const leaseId = await openExternalLease(request.documentId);
            return { ok: true, leaseId } as CollabStoreResponseByOperation[O];
          }
          case "load": {
            const result = await withLease(
              requireLease(request.leaseId),
              (inner) => inner.load(),
            );
            return {
              ok: true,
              updates: result.updates.map((update) => new Uint8Array(update)),
              checkpoint: result.checkpoint,
            } as unknown as CollabStoreResponseByOperation[O];
          }
          case "append": {
            const checkpoint = await withLease(
              requireLease(request.leaseId),
              (inner) => inner.append(request.update),
            );
            return {
              ok: true,
              checkpoint,
            } as CollabStoreResponseByOperation[O];
          }
          case "flush":
            await withLease(requireLease(request.leaseId), (inner) =>
              inner.flush(),
            );
            return { ok: true } as CollabStoreResponseByOperation[O];
          case "replace-snapshot":
            const checkpoint = await withLease(
              requireLease(request.leaseId),
              (inner) =>
                inner.replaceWithSnapshot(request.update, {
                  through: request.through,
                }),
            );
            return {
              ok: true,
              checkpoint,
            } as CollabStoreResponseByOperation[O];
          case "close": {
            const lease = requireLease(request.leaseId);
            lease.closing = true;
            const closing = lease.tail.then(async () => {
              lease.closed = true;
              leases.delete(request.leaseId);
              const inner = lease.inner;
              lease.inner = null;
              if (inner) await inner.close();
            });
            lease.tail = closing.then(
              () => undefined,
              () => undefined,
            );
            await closing;
            return { ok: true } as CollabStoreResponseByOperation[O];
          }
        }
      } catch (cause) {
        const response = safeFailure(cause);
        if (
          (cause as { readonly code?: unknown } | null)?.code ===
          "store-connection-timeout"
        ) {
          return failure(
            "store-connection-timeout",
            CONNECTION_TIMEOUT_MESSAGE,
          ) as CollabStoreResponseByOperation[O];
        }
        return response as CollabStoreResponseByOperation[O];
      }
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await Promise.allSettled([...openings]);
        await Promise.all([...leases.values()].map((lease) => lease.tail));
        closed = true;
        generation += 1;
        connection.reject(
          Object.assign(new Error("Collaboration Store bridge is closed"), {
            code: "store-closed",
          }),
        );
        const active = activeStore;
        activeStore = null;
        const innerLeases = [...leases.values()].flatMap((lease) =>
          lease.inner ? [lease.inner] : [],
        );
        leases.clear();
        await Promise.all(
          innerLeases.map((lease) => lease.close().catch(() => undefined)),
        );
        if (active) await active.close();
      })();
      return closePromise;
    },
  };

  return bridge;
}
