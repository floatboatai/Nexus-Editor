import {
  type DocumentId,
  type ReplicaStore,
  type ReplicaStoreCheckpoint,
  type ReplicaStoreLease,
} from "@floatboat/nexus-plugin-collab";

import {
  parseCollaborationStoreControlMessage,
  parseCollaborationStoreResponse,
  type CollaborationStoreChannel,
  type CollaborationStoreRequest,
  type CollaborationStoreResponse,
} from "../shared/collab-store-protocol";

export class PortReplicaStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PortReplicaStoreError";
  }
}

export interface PortReplicaStore extends ReplicaStore {
  close(): Promise<void>;
}

interface PendingRequest {
  readonly resolve: (response: CollaborationStoreResponse) => void;
  readonly reject: (cause: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

type CollaborationStoreRequestWithoutId =
  CollaborationStoreRequest extends infer Request
    ? Request extends { readonly requestId: string }
      ? Omit<Request, "requestId">
      : never
    : never;

export interface PortReplicaStoreOptions {
  readonly requestTimeoutMs?: number;
  readonly beforeRemoteDrain?: () => Promise<void>;
}

function throwCleanupFailures(
  failures: readonly unknown[],
  message: string,
): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

export function createPortReplicaStore(
  channel: CollaborationStoreChannel,
  options: PortReplicaStoreOptions = {},
): PortReplicaStore {
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new RangeError("requestTimeoutMs must be a positive safe integer");
  }
  const clientId =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const pending = new Map<string, PendingRequest>();
  const openings = new Set<Promise<ReplicaStoreLease>>();
  const leases = new Set<ReplicaStoreLease>();
  let sequence = 0;
  let closed = false;
  let closing = false;
  let remoteDraining = false;
  let remoteDrainReady = false;
  let remoteDrainBarrier: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  const pendingDrainIds = new Set<string>();

  const closeError = () =>
    new PortReplicaStoreError(
      "store-channel-closed",
      "Electron collaboration persistence channel closed",
    );

  function acknowledgeDrains(): void {
    if (!remoteDrainReady || pending.size > 0) return;
    for (const drainId of [...pendingDrainIds]) {
      pendingDrainIds.delete(drainId);
      try {
        channel.postMessage({ type: "drain-ack", drainId });
      } catch {
        // The worker-side timeout/exit path reports that the drain outcome is unknown.
      }
    }
  }

  const unsubscribe = channel.subscribe((value) => {
    let response: CollaborationStoreResponse;
    try {
      const control = parseCollaborationStoreControlMessage(value);
      if (control) {
        if (control.type === "drain-request") {
          pendingDrainIds.add(control.drainId);
          if (!remoteDrainBarrier) {
            try {
              remoteDrainBarrier = options.beforeRemoteDrain?.() ?? Promise.resolve();
            } catch (cause) {
              remoteDrainBarrier = Promise.reject(cause);
            }
            void remoteDrainBarrier.then(
              () => {
                remoteDrainReady = true;
                remoteDraining = true;
                acknowledgeDrains();
              },
              () => {
                // Do not acknowledge an incomplete upstream drain. The worker
                // reports the bounded timeout as an unknown shutdown outcome.
              },
            );
          }
        }
        return;
      }
      response = parseCollaborationStoreResponse(value);
    } catch (cause) {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(cause);
      }
      pending.clear();
      acknowledgeDrains();
      return;
    }
    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    clearTimeout(request.timer);
    if (response.ok) request.resolve(response);
    else
      request.reject(
        new PortReplicaStoreError(response.error.code, response.error.message),
      );
    acknowledgeDrains();
  });
  const unsubscribeClose = channel.subscribeClose?.(() => {
    if (closed) return;
    closed = true;
    const error = closeError();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  });

  function assertOpen(allowClosing = false): void {
    if (closed || ((closing || remoteDraining) && !allowClosing)) {
      throw new PortReplicaStoreError(
        "store-closed",
        "Renderer Replica Store is closed",
      );
    }
  }

  function send(
    request: CollaborationStoreRequestWithoutId,
    allowClosing = false,
  ): Promise<CollaborationStoreResponse> {
    try {
      assertOpen(allowClosing);
    } catch (cause) {
      return Promise.reject(cause);
    }
    const requestId = `${clientId}:${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const request = pending.get(requestId);
        if (!request) return;
        pending.delete(requestId);
        request.reject(
          new PortReplicaStoreError(
            "store-request-timeout",
            "Electron collaboration persistence operation timed out",
          ),
        );
        acknowledgeDrains();
      }, requestTimeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      try {
        channel.postMessage({ ...request, requestId });
      } catch (cause) {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(cause);
        acknowledgeDrains();
      }
    });
  }

  function requireCheckpoint(
    response: CollaborationStoreResponse,
  ): ReplicaStoreCheckpoint {
    if (!response.ok || !response.checkpoint) {
      throw new TypeError(
        "Collaboration Store response is missing its durability checkpoint",
      );
    }
    return response.checkpoint;
  }

  function trackOpening(
    opening: Promise<ReplicaStoreLease>,
  ): Promise<ReplicaStoreLease> {
    openings.add(opening);
    void opening.then(
      () => openings.delete(opening),
      () => openings.delete(opening),
    );
    return opening;
  }

  const store: PortReplicaStore = {
    async open(documentId: DocumentId): Promise<ReplicaStoreLease> {
      assertOpen();
      return trackOpening(
        (async () => {
          const leaseId = `${clientId}:lease:${++sequence}`;
          await send({ operation: "open", leaseId, documentId });
          if (closing || closed) {
            await send({ operation: "close", leaseId }, true).catch(
              () => undefined,
            );
            throw new PortReplicaStoreError(
              "store-closed",
              "Renderer Replica Store is closed",
            );
          }
          let leaseClosed = false;
          let leaseClosePromise: Promise<void> | null = null;

          function assertLeaseOpen(): void {
            assertOpen();
            if (leaseClosed)
              throw new PortReplicaStoreError(
                "lease-closed",
                "Renderer Store lease is closed",
              );
          }

          const lease: ReplicaStoreLease = {
            async load() {
              assertLeaseOpen();
              const response = await send({ operation: "load", leaseId });
              if (!response.ok || !response.updates) {
                throw new TypeError(
                  "Collaboration Store load response is incomplete",
                );
              }
              return {
                updates: response.updates,
                checkpoint: requireCheckpoint(response),
              };
            },
            async append(update) {
              assertLeaseOpen();
              return requireCheckpoint(
                await send({
                  operation: "append",
                  leaseId,
                  update: new Uint8Array(update),
                }),
              );
            },
            async flush() {
              assertLeaseOpen();
              await send({ operation: "flush", leaseId });
            },
            async replaceWithSnapshot(update, options) {
              assertLeaseOpen();
              return requireCheckpoint(
                await send({
                  operation: "snapshot",
                  leaseId,
                  update: new Uint8Array(update),
                  through: options.through,
                }),
              );
            },
            close() {
              if (leaseClosed) return Promise.resolve();
              if (leaseClosePromise) return leaseClosePromise;
              leaseClosePromise = send(
                { operation: "close", leaseId },
                true,
              ).then(() => {
                leaseClosed = true;
                leases.delete(lease);
              });
              void leaseClosePromise.catch(() => {
                leaseClosePromise = null;
              });
              return leaseClosePromise;
            },
          };
          leases.add(lease);
          return lease;
        })(),
      );
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      if (closed) return Promise.resolve();
      closing = true;
      closePromise = Promise.resolve().then(async () => {
        const failures: unknown[] = [];
        await Promise.allSettled([...openings]);
        const results = await Promise.allSettled(
          [...leases].map((lease) => lease.close()),
        );
        failures.push(
          ...results
            .filter(
              (result): result is PromiseRejectedResult =>
                result.status === "rejected",
            )
            .map((result) => result.reason),
        );
        closed = true;
        closing = false;
        leases.clear();
        try {
          unsubscribe();
        } catch (cause) {
          failures.push(cause);
        }
        try {
          unsubscribeClose?.();
        } catch (cause) {
          failures.push(cause);
        }
        try {
          channel.close();
        } catch (cause) {
          failures.push(cause);
        }
        const error = new PortReplicaStoreError(
          "store-closed",
          "Renderer Replica Store is closed",
        );
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.reject(error);
        }
        pending.clear();
        throwCleanupFailures(failures, "Renderer Replica Store cleanup failed");
      });
      return closePromise;
    },
  };

  return store;
}
