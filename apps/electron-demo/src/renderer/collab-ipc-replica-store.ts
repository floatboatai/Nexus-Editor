import type {
  DocumentId,
  ReplicaStore,
  ReplicaStoreLease,
} from "@floatboat/nexus-plugin-collab";
import type {
  CollabStoreFailure,
  CollabStoreOperation,
  CollabStoreRequest,
  CollabStoreResponseByOperation,
  ElectronCollabStoreBridge,
} from "../shared/collab-store-ipc";

export class ElectronCollabStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ElectronCollabStoreError";
  }
}

export interface ElectronCollabReplicaStore extends ReplicaStore {
  close(): Promise<void>;
}

export interface ElectronCollabReplicaStoreOptions {
  readonly bridge: ElectronCollabStoreBridge;
}

function failure(result: CollabStoreFailure): ElectronCollabStoreError {
  return new ElectronCollabStoreError(result.error.code, result.error.message);
}

function throwCleanupFailures(
  failures: readonly unknown[],
  message: string,
): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

export function createElectronCollabReplicaStore(
  options: ElectronCollabReplicaStoreOptions,
): ElectronCollabReplicaStore {
  const bridge = options.bridge;
  const openings = new Set<Promise<ReplicaStoreLease>>();
  const leases = new Set<ReplicaStoreLease>();
  let closed = false;
  let closePromise: Promise<void> | null = null;

  async function request<O extends CollabStoreOperation>(
    value: Extract<CollabStoreRequest, { readonly operation: O }>,
  ): Promise<
    Extract<CollabStoreResponseByOperation[O], { readonly ok: true }>
  > {
    const result = await bridge.request(value);
    if (!result.ok) throw failure(result);
    return result as Extract<
      CollabStoreResponseByOperation[O],
      { readonly ok: true }
    >;
  }

  function assertStoreOpen(): void {
    if (closed)
      throw new ElectronCollabStoreError(
        "store-closed",
        "Electron Replica Store is closed",
      );
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

  const store: ElectronCollabReplicaStore = {
    async open(documentId: DocumentId): Promise<ReplicaStoreLease> {
      assertStoreOpen();
      return trackOpening(
        (async () => {
          const opened = await request({ operation: "open", documentId });
          if (closed) {
            await request({
              operation: "close",
              leaseId: opened.leaseId,
            }).catch(() => undefined);
            throw new ElectronCollabStoreError(
              "store-closed",
              "Electron Replica Store is closed",
            );
          }
          let leaseClosed = false;

          function assertLeaseOpen(): void {
            assertStoreOpen();
            if (leaseClosed) {
              throw new ElectronCollabStoreError(
                "lease-closed",
                "Electron Replica Store lease is closed",
              );
            }
          }

          const lease: ReplicaStoreLease = {
            async load() {
              assertLeaseOpen();
              const result = await request({
                operation: "load",
                leaseId: opened.leaseId,
              });
              return {
                updates: result.updates.map((update) => new Uint8Array(update)),
                checkpoint: result.checkpoint,
              };
            },
            async append(update) {
              assertLeaseOpen();
              const result = await request({
                operation: "append",
                leaseId: opened.leaseId,
                update: new Uint8Array(update),
              });
              return result.checkpoint;
            },
            async flush() {
              assertLeaseOpen();
              await request({ operation: "flush", leaseId: opened.leaseId });
            },
            async replaceWithSnapshot(update, options) {
              assertLeaseOpen();
              const result = await request({
                operation: "replace-snapshot",
                leaseId: opened.leaseId,
                update: new Uint8Array(update),
                through: options.through,
              });
              return result.checkpoint;
            },
            async close() {
              if (leaseClosed) return;
              leaseClosed = true;
              leases.delete(lease);
              const result = await bridge.request({
                operation: "close",
                leaseId: opened.leaseId,
              });
              if (!result.ok) throw failure(result);
            },
          };
          leases.add(lease);
          return lease;
        })(),
      );
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = Promise.resolve().then(async () => {
        await Promise.allSettled([...openings]);
        const results = await Promise.allSettled(
          [...leases].map((lease) => lease.close()),
        );
        const failures = results
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          )
          .map((result) => result.reason);
        leases.clear();
        throwCleanupFailures(failures, "Electron Replica Store cleanup failed");
      });
      return closePromise;
    },
  };

  return store;
}
