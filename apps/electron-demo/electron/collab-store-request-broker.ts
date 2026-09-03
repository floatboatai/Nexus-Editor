import type { ReplicaStore, ReplicaStoreLease } from "@floatboat/nexus-plugin-collab";

import {
  collaborationStoreErrorResponse,
  parseCollaborationStoreControlMessage,
  parseCollaborationStoreRequest,
  type CollaborationStoreChannel,
  type CollaborationStoreRequest,
} from "../src/shared/collab-store-protocol";

export interface HostOwnedReplicaStore extends ReplicaStore {
  close(): Promise<void>;
}

export interface ReplicaStoreRequestBroker {
  connect(channel: CollaborationStoreChannel): () => Promise<void>;
  close(): Promise<void>;
}

interface Connection {
  readonly channel: CollaborationStoreChannel;
  readonly leases: Map<string, ReplicaStoreLease>;
  readonly unsubscribe: () => void;
  unsubscribeClose?: () => void;
  closed: boolean;
  closePromise: Promise<void> | null;
  outstanding: number;
  drain: {
    readonly id: string;
    readonly promise: Promise<void>;
    readonly resolve: () => void;
    readonly reject: (cause: unknown) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  } | null;
}

function throwCleanupFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

function requestIdFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const requestId = (value as { readonly requestId?: unknown }).requestId;
  return typeof requestId === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,255}$/.test(requestId)
    ? requestId
    : undefined;
}

export function createReplicaStoreRequestBroker(
  store: HostOwnedReplicaStore,
  options: {
    readonly maxQueuedRequestsPerConnection?: number;
    readonly drainTimeoutMs?: number;
  } = {},
): ReplicaStoreRequestBroker {
  const maxQueuedRequests = options.maxQueuedRequestsPerConnection ?? 1_024;
  if (!Number.isSafeInteger(maxQueuedRequests) || maxQueuedRequests <= 0) {
    throw new RangeError("maxQueuedRequestsPerConnection must be a positive safe integer");
  }
  const drainTimeoutMs = options.drainTimeoutMs ?? 500;
  if (!Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs <= 0) {
    throw new RangeError("drainTimeoutMs must be a positive safe integer");
  }
  const connections = new Set<Connection>();
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let backgroundCleanupFailure: unknown = null;
  let drainSequence = 0;

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }

  function requireLease(connection: Connection, leaseId: string): ReplicaStoreLease {
    const lease = connection.leases.get(leaseId);
    if (!lease) {
      const error = new Error("Collaboration Store lease is missing or closed") as Error & { code: string };
      error.code = "lease-closed";
      throw error;
    }
    return lease;
  }

  async function execute(connection: Connection, request: CollaborationStoreRequest): Promise<void> {
    switch (request.operation) {
      case "open": {
        if (connection.leases.has(request.leaseId)) {
          const error = new Error("Collaboration Store lease already exists") as Error & { code: string };
          error.code = "lease-conflict";
          throw error;
        }
        const lease = await store.open(request.documentId as Parameters<ReplicaStore["open"]>[0]);
        connection.leases.set(request.leaseId, lease);
        connection.channel.postMessage({ requestId: request.requestId, ok: true });
        return;
      }
      case "load": {
        const result = await requireLease(connection, request.leaseId).load();
        connection.channel.postMessage({
          requestId: request.requestId,
          ok: true,
          updates: result.updates.map((update) => new Uint8Array(update)),
          checkpoint: result.checkpoint,
        });
        return;
      }
      case "append": {
        const checkpoint = await requireLease(connection, request.leaseId).append(request.update);
        connection.channel.postMessage({ requestId: request.requestId, ok: true, checkpoint });
        return;
      }
      case "flush":
        await requireLease(connection, request.leaseId).flush();
        break;
      case "snapshot": {
        const lease = requireLease(connection, request.leaseId);
        const checkpoint = await lease.replaceWithSnapshot(
          request.update,
          { through: request.through },
        );
        connection.channel.postMessage({ requestId: request.requestId, ok: true, checkpoint });
        return;
      }
      case "close": {
        const lease = requireLease(connection, request.leaseId);
        await lease.close();
        connection.leases.delete(request.leaseId);
        break;
      }
    }
    connection.channel.postMessage({ requestId: request.requestId, ok: true });
  }

  function settleDrain(connection: Connection, cause?: unknown): void {
    const drain = connection.drain;
    if (!drain) return;
    connection.drain = null;
    clearTimeout(drain.timer);
    if (cause === undefined) drain.resolve();
    else drain.reject(cause);
  }

  function requestDrain(connection: Connection): Promise<void> {
    if (connection.closed) return Promise.resolve();
    if (connection.drain) return connection.drain.promise;
    const id = `drain:${++drainSequence}`;
    let resolve!: () => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const timer = setTimeout(() => {
      settleDrain(connection, Object.assign(
        new Error("Collaboration Store renderer drain timed out"),
        { code: "store-drain-timeout" },
      ));
    }, drainTimeoutMs);
    connection.drain = { id, promise, resolve, reject, timer };
    try {
      connection.channel.postMessage({ type: "drain-request", drainId: id });
    } catch (cause) {
      settleDrain(connection, cause);
    }
    return promise;
  }

  function disconnect(connection: Connection): Promise<void> {
    if (connection.closePromise) return connection.closePromise;
    connection.closed = true;
    settleDrain(connection, Object.assign(
      new Error("Collaboration Store channel closed before drain acknowledgement"),
      { code: "store-drain-unacknowledged" },
    ));
    connections.delete(connection);

    connection.closePromise = Promise.resolve().then(async () => {
      const failures: unknown[] = [];
      try {
        connection.unsubscribe();
      } catch (cause) {
        failures.push(cause);
      }
      try {
        connection.unsubscribeClose?.();
      } catch (cause) {
        failures.push(cause);
      }

      try {
        const results = await enqueue(() => Promise.allSettled(
          [...connection.leases.values()].map((lease) => Promise.resolve().then(() => lease.close())),
        ));
        failures.push(...results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason));
      } catch (cause) {
        failures.push(cause);
      }
      connection.leases.clear();

      try {
        connection.channel.close();
      } catch (cause) {
        failures.push(cause);
      }
      throwCleanupFailures(failures, "Collaboration Store connection cleanup failed");
    });
    return connection.closePromise;
  }

  return {
    connect(channel): () => Promise<void> {
      if (closed) throw new Error("Collaboration Store request broker is closed");
      let connection!: Connection;
      const unsubscribe = channel.subscribe((value) => {
        if (connection.closed) return;
        try {
          const control = parseCollaborationStoreControlMessage(value);
          if (control) {
            if (control.type === "drain-ack" && control.drainId === connection.drain?.id) {
              settleDrain(connection);
            }
            return;
          }
        } catch {
          return;
        }
        const fallbackRequestId = requestIdFrom(value);
        let request: CollaborationStoreRequest;
        try {
          request = parseCollaborationStoreRequest(value);
        } catch (cause) {
          if (fallbackRequestId) channel.postMessage(collaborationStoreErrorResponse(fallbackRequestId, cause));
          return;
        }
        if (connection.outstanding >= maxQueuedRequests) {
          channel.postMessage(collaborationStoreErrorResponse(request.requestId, Object.assign(
            new Error("Collaboration Store request queue is full"),
            { code: "store-queue-full" },
          )));
          return;
        }
        connection.outstanding += 1;
        void enqueue(() => execute(connection, request))
          .catch((cause) => {
            if (!connection.closed) {
              channel.postMessage(collaborationStoreErrorResponse(request.requestId, cause));
            }
          })
          .finally(() => {
            connection.outstanding -= 1;
          });
      });
      connection = {
        channel,
        leases: new Map(),
        unsubscribe,
        closed: false,
        closePromise: null,
        outstanding: 0,
        drain: null,
      };
      connection.unsubscribeClose = channel.subscribeClose?.(() => {
        void disconnect(connection).catch((cause) => {
          backgroundCleanupFailure ??= cause;
        });
      });
      connections.add(connection);
      return () => disconnect(connection);
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = Promise.resolve().then(async () => {
        const failures: unknown[] = [];
        const drainResults = await Promise.allSettled([...connections].map(requestDrain));
        failures.push(...drainResults
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason));
        const results = await Promise.allSettled([...connections].map(disconnect));
        failures.push(...results
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason));
        try {
          await queue;
        } catch (cause) {
          failures.push(cause);
        }
        try {
          await store.close();
        } catch (cause) {
          failures.push(cause);
        }
        if (backgroundCleanupFailure !== null) failures.push(backgroundCleanupFailure);
        throwCleanupFailures(failures, "Collaboration Store broker cleanup failed");
      });
      return closePromise;
    },
  };
}
