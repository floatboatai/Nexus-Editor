import { asDocumentId, asFileId } from "@floatboat/nexus-plugin-collab";
import { describe, expect, it, vi } from "vitest";

import type {
  CollaborationEnrollmentRecord,
  CollaborationIdentityDeletion,
  CollaborationPendingCreationRecord,
  CollaborationPendingJoin,
} from "../src/renderer/collaboration-enrollment-store";
import type {
  PluginVaultProjectionOpeningFence,
  VaultId,
  VaultSessionId,
} from "../src/shared/plugin-ipc";
import {
  createElectronCollaborationFileLifecycleCoordinator,
  createElectronCollaborationProductDestroy,
  createElectronProjectionOpeningCoordinator,
} from "../src/renderer/electron-collaboration-product";

function workspaceMutationStubs() {
  return {
    forgetEnrollment: vi.fn(async () => true),
    listIncompleteEnrollmentMutations: vi.fn(async (): Promise<readonly {
      readonly deletion: CollaborationIdentityDeletion;
      readonly projectionState: "present" | "missing";
    }[]> => []),
    finishIncompleteEnrollmentMutation: vi.fn(async () => undefined),
    restoreIncompleteEnrollmentMutation: vi.fn(async () => undefined),
  };
}

describe("Electron collaboration product cleanup", () => {
  it("is idempotent and always attempts every owned resource", async () => {
    const workspaceFailure = new Error("workspace close failed");
    const panelFailure = new Error("panel destroy failed");
    const storeFailure = new Error("store close failed");
    const closeWorkspace = vi.fn(async () => { throw workspaceFailure; });
    const unsubscribeWorkspace = vi.fn();
    const destroyPanel = vi.fn(() => { throw panelFailure; });
    const closeReplicaStore = vi.fn(async () => { throw storeFailure; });
    const destroy = createElectronCollaborationProductDestroy({
      closeWorkspace,
      unsubscribeWorkspace,
      destroyPanel,
      closeReplicaStore,
    });

    const first = destroy();
    const second = destroy();
    expect(second).toBe(first);
    await expect(first).rejects.toMatchObject({
      errors: [workspaceFailure, panelFailure, storeFailure],
    });
    expect(closeWorkspace).toHaveBeenCalledTimes(1);
    expect(unsubscribeWorkspace).toHaveBeenCalledTimes(1);
    expect(destroyPanel).toHaveBeenCalledTimes(1);
    expect(closeReplicaStore).toHaveBeenCalledTimes(1);
  });

  it("completes once when every cleanup succeeds", async () => {
    const resources = {
      closeWorkspace: vi.fn(async () => undefined),
      unsubscribeWorkspace: vi.fn(),
      destroyPanel: vi.fn(),
      closeReplicaStore: vi.fn(async () => undefined),
    };
    const destroy = createElectronCollaborationProductDestroy(resources);

    await destroy();
    await destroy();

    for (const operation of Object.values(resources)) expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("Electron collaboration projection openings", () => {
  const vaultId = "vault-opening" as VaultId;
  const owner = {
    senderId: 7,
    sessionId: "11111111-1111-4111-8111-opening" as VaultSessionId,
  };
  const enrollment: CollaborationEnrollmentRecord = {
    schemaVersion: 1,
    fileId: asFileId("file-opening"),
    path: "Notes/A.md",
    documentId: asDocumentId("document-opening"),
    serverUrl: "wss://collab.example.com",
    access: "editor",
    title: "A",
  };

  const fence = (
    state: "precommit" | "committed",
    overrides: Partial<PluginVaultProjectionOpeningFence> = {},
  ): PluginVaultProjectionOpeningFence => ({
    active: true,
    documentId: enrollment.documentId,
    operationId: "join-opening",
    owner,
    path: enrollment.path,
    state,
    vaultId,
    ...overrides,
  });

  const pending = (phase: "opening" | "enrollment-committed" = "opening"):
    CollaborationPendingJoin => ({
      schemaVersion: 1,
      operationId: "join-opening",
      owner: { ...owner, vaultId },
      phase,
      enrollment,
    });

  it("persists intent between Host precommit and commit, then retries release before clearing it", async () => {
    const releaseFailure = new Error("Host release response lost");
    const release = vi.fn()
      .mockRejectedValueOnce(releaseFailure)
      .mockResolvedValueOnce({ released: false });
    const beginJoin = vi.fn(async () => pending());
    const commitJoin = vi.fn(async () => pending("enrollment-committed"));
    const completeJoin = vi.fn(async () => true);
    const reserve = vi.fn(async () => fence("precommit"));
    const commit = vi.fn(async () => fence("committed"));
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => []),
        beginJoin,
        commitJoin,
        completeJoin,
        abortJoin: vi.fn(async () => true),
      },
      metadata: { load: vi.fn(async () => null) },
      vaultId,
      operationId: () => "join-opening",
      host: { reserve, commit, list: vi.fn(async () => []), release },
    });
    const transaction = await openings.begin(enrollment);

    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(beginJoin.mock.invocationCallOrder[0]!);
    expect(beginJoin.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]!);
    expect(openings.resolve(enrollment)).toEqual({
      documentId: enrollment.documentId,
      operationId: "join-opening",
    });
    await expect(transaction.commitEnrollment()).resolves.toEqual(enrollment);
    await expect(transaction.complete()).resolves.toBeUndefined();

    expect(commitJoin).toHaveBeenCalledWith(pending());
    expect(release).toHaveBeenCalledTimes(2);
    expect(completeJoin).toHaveBeenCalledWith(pending("enrollment-committed"));
    expect(openings.resolve(enrollment)).toBeUndefined();
  });

  it("restores a committed Host fence when commit rollback cannot abort the durable intent", async () => {
    const commitFailure = new Error("Host commit response unavailable");
    const abortFailure = new Error("pending join abort unavailable");
    let durable: readonly CollaborationPendingJoin[] = [];
    let hostFence: PluginVaultProjectionOpeningFence | null = fence("precommit");
    const reserve = vi.fn(async () => {
      hostFence = hostFence ?? fence("precommit");
      return hostFence;
    });
    const commit = vi.fn()
      .mockRejectedValueOnce(commitFailure)
      .mockImplementationOnce(async () => {
        hostFence = fence("committed");
        return hostFence;
      });
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => durable),
        beginJoin: vi.fn(async () => {
          durable = [pending()];
          return pending();
        }),
        commitJoin: vi.fn(),
        completeJoin: vi.fn(),
        abortJoin: vi.fn(async () => { throw abortFailure; }),
      },
      metadata: { load: vi.fn(async () => null) },
      vaultId,
      operationId: () => "join-opening",
      host: {
        reserve,
        commit,
        list: vi.fn(async () => hostFence ? [hostFence] : []),
        release: vi.fn(async () => {
          hostFence = null;
          return { released: true };
        }),
      },
    });

    await expect(openings.begin(enrollment)).rejects.toMatchObject({
      code: "projection-opening-commit-failed",
      errors: [commitFailure, abortFailure],
    });
    expect(hostFence).toMatchObject({
      active: true,
      operationId: "join-opening",
      state: "committed",
    });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(openings.resolve(enrollment)).toEqual({
      documentId: enrollment.documentId,
      operationId: "join-opening",
    });
  });

  it("keeps a same-renderer failed join immediately retryable and explicitly abandonable", async () => {
    let durable: readonly CollaborationPendingJoin[] = [];
    let hostFence = fence("precommit");
    const abortJoin = vi.fn(async () => {
      durable = [];
      return true;
    });
    const reserve = vi.fn(async () => hostFence);
    const release = vi.fn(async () => ({ released: true }));
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => durable),
        beginJoin: vi.fn(async () => {
          durable = [pending()];
          return pending();
        }),
        commitJoin: vi.fn(),
        completeJoin: vi.fn(),
        abortJoin,
      },
      metadata: { load: vi.fn(async () => null) },
      vaultId,
      operationId: () => "join-opening",
      host: {
        reserve,
        commit: vi.fn(async () => {
          hostFence = fence("committed");
          return hostFence;
        }),
        list: vi.fn(async () => [hostFence]),
        release,
      },
    });

    await openings.begin(enrollment);
    await expect(openings.inspect()).resolves.toEqual([expect.objectContaining({
      outcome: "pending-evidence",
      hasProjectionMetadata: false,
      canAbandon: true,
    })]);
    await expect(openings.recover()).resolves.toEqual([expect.objectContaining({
      outcome: "pending-evidence",
    })]);
    await expect(openings.begin(enrollment)).resolves.toMatchObject({ intent: pending() });

    await openings.abandon("join-opening");
    expect(abortJoin).toHaveBeenCalledWith(pending());
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("recovers exact Projection metadata behind a same-renderer active opening", async () => {
    let durable: readonly CollaborationPendingJoin[] = [];
    let hostFence = fence("precommit");
    let projected = false;
    const commitJoin = vi.fn(async () => {
      durable = [pending("enrollment-committed")];
      return durable[0]!;
    });
    const completeJoin = vi.fn(async () => {
      durable = [];
      return true;
    });
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => durable),
        beginJoin: vi.fn(async () => {
          durable = [pending()];
          return pending();
        }),
        commitJoin,
        completeJoin,
        abortJoin: vi.fn(),
      },
      metadata: {
        load: vi.fn(async () => projected ? {
          revision: "projection-1",
          record: {
            file: { id: enrollment.fileId, path: enrollment.path },
            documentId: enrollment.documentId,
            base: null,
          },
        } : null),
      },
      vaultId,
      operationId: () => "join-opening",
      host: {
        reserve: vi.fn(async () => hostFence),
        commit: vi.fn(async () => {
          hostFence = fence("committed");
          return hostFence;
        }),
        list: vi.fn(async () => [hostFence]),
        release: vi.fn(async () => ({ released: true })),
      },
    });

    await openings.begin(enrollment);
    projected = true;
    await expect(openings.recover()).resolves.toEqual([expect.objectContaining({
      outcome: "completed-enrollment",
    })]);
    expect(commitJoin).toHaveBeenCalledWith(pending());
    expect(completeJoin).toHaveBeenCalledWith(pending("enrollment-committed"));
  });

  it("keeps a persistent Host release failure visible and retryable", async () => {
    const firstFailure = new Error("Host release unavailable");
    const secondFailure = new Error("Host release still unavailable");
    const release = vi.fn()
      .mockRejectedValueOnce(firstFailure)
      .mockRejectedValueOnce(secondFailure)
      .mockResolvedValue({ released: true });
    const completeJoin = vi.fn(async () => true);
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => []),
        beginJoin: vi.fn(async () => pending()),
        commitJoin: vi.fn(async () => pending("enrollment-committed")),
        completeJoin,
        abortJoin: vi.fn(async () => true),
      },
      metadata: { load: vi.fn(async () => null) },
      vaultId,
      operationId: () => "join-opening",
      host: {
        reserve: vi.fn(async () => fence("precommit")),
        commit: vi.fn(async () => fence("committed")),
        list: vi.fn(async () => []),
        release,
      },
    });
    const transaction = await openings.begin(enrollment);
    await transaction.commitEnrollment();

    await expect(transaction.complete()).rejects.toMatchObject({
      code: "projection-opening-release-failed",
      errors: [firstFailure, secondFailure],
    });
    expect(openings.resolve(enrollment)).toMatchObject({ operationId: "join-opening" });
    expect(completeJoin).not.toHaveBeenCalled();

    await expect(transaction.complete()).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(3);
    expect(completeJoin).toHaveBeenCalledTimes(1);
  });

  it("recovers when pending cleanup fails after the committed Enrollment releases its Host fence", async () => {
    let durable: readonly CollaborationPendingJoin[] = [];
    let hostFence: PluginVaultProjectionOpeningFence | null = fence("precommit");
    const completeFailure = new Error("pending cleanup unavailable");
    const completeJoin = vi.fn()
      .mockRejectedValueOnce(completeFailure)
      .mockImplementationOnce(async () => {
        durable = [];
        return true;
      });
    const reserve = vi.fn(async () => {
      hostFence = hostFence ?? fence("precommit");
      return hostFence;
    });
    const commit = vi.fn(async () => {
      hostFence = fence("committed");
      return hostFence;
    });
    const release = vi.fn(async () => {
      hostFence = null;
      return { released: true };
    });
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => durable),
        beginJoin: vi.fn(async () => {
          durable = [pending()];
          return pending();
        }),
        commitJoin: vi.fn(async () => {
          durable = [pending("enrollment-committed")];
          return durable[0]!;
        }),
        completeJoin,
        abortJoin: vi.fn(),
      },
      metadata: { load: vi.fn(async () => null) },
      vaultId,
      operationId: () => "join-opening",
      host: {
        reserve,
        commit,
        list: vi.fn(async () => hostFence ? [hostFence] : []),
        release,
      },
    });
    const transaction = await openings.begin(enrollment);
    await transaction.commitEnrollment();

    await expect(transaction.complete()).rejects.toBe(completeFailure);
    expect(durable).toEqual([pending("enrollment-committed")]);
    expect(hostFence).toBeNull();

    await expect(openings.recover()).resolves.toEqual([expect.objectContaining({
      outcome: "completed-enrollment",
    })]);
    expect(completeJoin).toHaveBeenCalledTimes(2);
    expect(durable).toEqual([]);
  });

  it("recovers writeAtomic-before-base-save by committing the exact null-base identity without touching the file", async () => {
    let durable = pending();
    let hostFence = fence("committed", { active: false });
    const commitJoin = vi.fn(async () => {
      durable = pending("enrollment-committed");
      return durable;
    });
    const completeJoin = vi.fn(async () => true);
    const release = vi.fn(async () => {
      hostFence = { ...hostFence, active: false };
      return { released: true };
    });
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => [durable]),
        beginJoin: vi.fn(),
        commitJoin,
        completeJoin,
        abortJoin: vi.fn(),
      },
      metadata: {
        load: vi.fn(async () => ({
          revision: "1",
          record: {
            file: { id: enrollment.fileId, path: enrollment.path },
            documentId: enrollment.documentId,
            base: null,
          },
        })),
      },
      vaultId,
      host: {
        reserve: vi.fn(async () => ({ ...hostFence, active: true })),
        commit: vi.fn(async () => fence("committed")),
        list: vi.fn(async () => [hostFence]),
        release,
      },
    });

    await expect(openings.recover()).resolves.toEqual([expect.objectContaining({
      operationId: "join-opening",
      outcome: "completed-enrollment",
    })]);
    expect(commitJoin).toHaveBeenCalledWith(pending());
    expect(release).toHaveBeenCalledTimes(1);
    expect(completeJoin).toHaveBeenCalledWith(pending("enrollment-committed"));
  });

  it("retains an uncertain opening fail-closed and abandons it explicitly without deleting the file", async () => {
    let durable: readonly CollaborationPendingJoin[] = [pending()];
    let hostFence = fence("committed", { active: false });
    const release = vi.fn(async () => {
      hostFence = { ...hostFence, active: false };
      return { released: true };
    });
    const abortJoin = vi.fn(async () => {
      durable = [];
      return true;
    });
    const host = {
      reserve: vi.fn(async () => {
        hostFence = { ...hostFence, active: true };
        return hostFence;
      }),
      commit: vi.fn(async () => fence("committed")),
      list: vi.fn(async () => hostFence ? [hostFence] : []),
      release,
    };
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => durable),
        beginJoin: vi.fn(),
        commitJoin: vi.fn(),
        completeJoin: vi.fn(),
        abortJoin,
      },
      metadata: { load: vi.fn(async () => null) },
      vaultId,
      host,
    });

    await expect(openings.recover()).resolves.toEqual([expect.objectContaining({
      outcome: "pending-evidence",
    })]);
    await expect(openings.inspect()).resolves.toEqual([expect.objectContaining({
      pending: pending(),
      outcome: "pending-evidence",
      hasProjectionMetadata: false,
      canAbandon: true,
    })]);
    expect(host.commit).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(abortJoin).not.toHaveBeenCalled();

    await openings.abandon("join-opening");
    expect(release).toHaveBeenCalledTimes(1);
    expect(abortJoin).toHaveBeenCalledWith(pending());
  });

  it("restores the exact Host fence when durable pending-join abandon fails after release", async () => {
    const abortFailure = new Error("pending join storage unavailable");
    let durable: readonly CollaborationPendingJoin[] = [pending()];
    let hostFence: PluginVaultProjectionOpeningFence | null = fence("committed", { active: false });
    const reserve = vi.fn(async () => {
      hostFence = hostFence
        ? { ...hostFence, active: true }
        : fence("precommit");
      return hostFence;
    });
    const commit = vi.fn(async () => {
      hostFence = fence("committed");
      return hostFence;
    });
    const release = vi.fn(async () => {
      hostFence = null;
      return { released: true };
    });
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => durable),
        beginJoin: vi.fn(),
        commitJoin: vi.fn(),
        completeJoin: vi.fn(),
        abortJoin: vi.fn(async () => { throw abortFailure; }),
      },
      metadata: { load: vi.fn(async () => null) },
      vaultId,
      host: {
        reserve,
        commit,
        list: vi.fn(async () => hostFence ? [hostFence] : []),
        release,
      },
    });

    await expect(openings.abandon("join-opening")).rejects.toBe(abortFailure);
    expect(hostFence).toMatchObject({
      active: true,
      operationId: "join-opening",
      state: "committed",
    });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(openings.resolve(enrollment)).toEqual({
      documentId: enrollment.documentId,
      operationId: "join-opening",
    });
  });

  it("refuses to abandon an opening once exact Projection metadata exists", async () => {
    const release = vi.fn(async () => ({ released: true }));
    const abortJoin = vi.fn(async () => true);
    const reserve = vi.fn(async () => fence("committed"));
    const openings = createElectronProjectionOpeningCoordinator({
      enrollments: {
        listPendingJoins: vi.fn(async () => [pending()]),
        beginJoin: vi.fn(),
        commitJoin: vi.fn(),
        completeJoin: vi.fn(),
        abortJoin,
      },
      metadata: {
        load: vi.fn(async () => ({
          revision: "projection-1",
          record: {
            file: { id: enrollment.fileId, path: enrollment.path },
            documentId: enrollment.documentId,
            base: null,
          },
        })),
      },
      vaultId,
      host: {
        reserve,
        commit: vi.fn(),
        list: vi.fn(async () => [fence("committed", { active: false })]),
        release,
      },
    });

    await expect(openings.inspect()).resolves.toEqual([expect.objectContaining({
      pending: pending(),
      hasProjectionMetadata: true,
      canAbandon: false,
    })]);
    await expect(openings.abandon("join-opening")).rejects.toMatchObject({
      code: "pending-join-projection-present",
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(abortJoin).not.toHaveBeenCalled();
  });
});

describe("Electron collaboration file lifecycle", () => {
  it("blocks rename and delete while a path has a recoverable pending join", async () => {
    const pendingJoin: CollaborationPendingJoin = {
      schemaVersion: 1,
      operationId: "join-pending-file-mutation",
      owner: {
        vaultId: "vault-pending-file-mutation" as VaultId,
        senderId: 9,
        sessionId: "22222222-2222-4222-8222-pending" as VaultSessionId,
      },
      phase: "opening",
      enrollment: {
        schemaVersion: 1,
        fileId: asFileId("file-pending-join"),
        path: "Notes/Pending.md",
        documentId: asDocumentId("document-pending-join"),
        serverUrl: "wss://collab.example.com",
        access: "editor",
        title: "Pending",
      },
    };
    const reserveDeletion = vi.fn();
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => []),
        listPendingCreations: vi.fn(async () => []),
        listPendingJoins: vi.fn(async () => [pendingJoin]),
        listDeletionReservations: vi.fn(async () => []),
        rename: vi.fn(),
        reserveDeletion,
        releaseDeletion: vi.fn(async () => true),
      },
      refreshFile: vi.fn(async () => undefined),
    });

    await expect(coordinator.prepareForFileMutation("rename", "Notes/Pending.md"))
      .rejects.toMatchObject({ code: "pending-join-file-mutation-blocked" });
    await expect(coordinator.prepareForFileMutation("delete", "Notes"))
      .rejects.toMatchObject({ code: "pending-join-file-mutation-blocked" });
    expect(reserveDeletion).not.toHaveBeenCalled();
  });

  it("rehydrates durable deletion fences and returns the exact Host trash operation", async () => {
    const recovered = { schemaVersion: 1 as const, operationId: "delete-recovered", path: "Archive" };
    const prepared = { schemaVersion: 1 as const, operationId: "delete-prepared", path: "Notes" };
    const hostReserve = vi.fn(async () => undefined);
    const hostRelease = vi.fn(async () => true);
    const releaseDeletion = vi.fn(async () => true);
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => []),
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => [recovered]),
        rename: vi.fn(),
        reserveDeletion: vi.fn(async () => prepared),
        releaseDeletion,
      },
      hostDeletionFences: { reserve: hostReserve, release: hostRelease },
      deletionOperationId: () => prepared.operationId,
      refreshFile: vi.fn(async () => undefined),
    });

    await coordinator.initializeDeletionFences();
    await expect(coordinator.prepareForFileMutation("delete", "Notes")).resolves.toEqual(prepared);
    expect(hostReserve.mock.calls).toEqual([
      [recovered, "committed"],
      [prepared, "precommit"],
      [prepared, "committed"],
    ]);

    await coordinator.completeFileMutation("delete", "Notes", {
      filesystem: "failed",
      coordination: "not-run",
      refresh: "not-run",
    });
    expect(releaseDeletion).toHaveBeenCalledWith(prepared);
    expect(hostRelease).toHaveBeenCalledWith(prepared);
  });

  it("clears a stale local reservation after another window explicitly recovers it", async () => {
    const first = { schemaVersion: 1 as const, operationId: "delete-first", path: "Notes" };
    const second = { schemaVersion: 1 as const, operationId: "delete-second", path: "Notes" };
    let durable: readonly typeof first[] = [];
    const reserveDeletion = vi.fn(async () => {
      const reservation = reserveDeletion.mock.calls.length === 1 ? first : second;
      durable = [reservation];
      return reservation;
    });
    const hostRelease = vi.fn(async () => true);
    const operationIds = [first.operationId, second.operationId];
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => []),
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => durable),
        rename: vi.fn(),
        reserveDeletion,
        releaseDeletion: vi.fn(async () => true),
      },
      hostDeletionFences: {
        reserve: vi.fn(async () => undefined),
        release: hostRelease,
      },
      deletionOperationId: () => operationIds.shift()!,
      refreshFile: vi.fn(async () => undefined),
    });

    await coordinator.prepareForFileMutation("delete", "Notes");
    durable = [];
    await expect(coordinator.prepareForFileMutation("delete", "Notes")).resolves.toEqual(second);

    expect(hostRelease).toHaveBeenCalledWith(first);
  });

  it("keeps the Host fence closed when durable release fails", async () => {
    const reservation = { schemaVersion: 1 as const, operationId: "delete-retained", path: "Notes" };
    const durableFailure = new Error("durable CAS unavailable");
    const hostRelease = vi.fn(async () => true);
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => []),
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => []),
        rename: vi.fn(),
        reserveDeletion: vi.fn(async () => reservation),
        releaseDeletion: vi.fn(async () => { throw durableFailure; }),
      },
      hostDeletionFences: {
        reserve: vi.fn(async () => undefined),
        release: hostRelease,
      },
      deletionOperationId: () => reservation.operationId,
      refreshFile: vi.fn(async () => undefined),
    });
    await coordinator.prepareForFileMutation("delete", "Notes");

    await expect(coordinator.completeFileMutation("delete", "Notes", {
      filesystem: "failed",
      coordination: "not-run",
      refresh: "not-run",
    })).rejects.toBe(durableFailure);

    expect(hostRelease).not.toHaveBeenCalled();
  });

  it("keeps a Host-first precommit enumerable when durable reservation fails without committing", async () => {
    const reservation = { schemaVersion: 1 as const, operationId: "delete-ambiguous", path: "Notes" };
    const durableFailure = new Error("durable write response lost without commit");
    let hostFence: { readonly path: string; readonly operationId: string; readonly state: "precommit" | "committed" } | null = null;
    const hostReserve = vi.fn(async (
      candidate: typeof reservation,
      state: "precommit" | "committed" = "committed",
    ) => { hostFence = { path: candidate.path, operationId: candidate.operationId, state }; });
    const hostRelease = vi.fn(async (candidate: typeof reservation) => {
      if (hostFence?.operationId !== candidate.operationId) return false;
      hostFence = null;
      return true;
    });
    const sharedEnrollments = {
      list: vi.fn(async () => []),
      listPendingCreations: vi.fn(async () => []),
      listDeletionReservations: vi.fn(async () => []),
      rename: vi.fn(),
      reserveDeletion: vi.fn(async () => { throw durableFailure; }),
      releaseDeletion: vi.fn(async () => false),
    };
    const makeCoordinator = () => createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments: sharedEnrollments,
      hostDeletionFences: {
        reserve: hostReserve,
        list: vi.fn(async () => hostFence ? [hostFence] : []),
        release: hostRelease,
      },
      deletionOperationId: () => reservation.operationId,
      pathExists: vi.fn(async () => true),
      refreshFile: vi.fn(async () => undefined),
    });
    const crashedWindow = makeCoordinator();

    await expect(crashedWindow.prepareForFileMutation("delete", "Notes")).rejects.toBe(durableFailure);
    expect(hostRelease).not.toHaveBeenCalled();

    const recoveryWindow = makeCoordinator();
    await expect(recoveryWindow.listIncompleteFileDeletions()).resolves.toEqual([{
      reservation,
      pathState: "present",
    }]);
    await recoveryWindow.recoverFileDeletion(reservation.operationId, "abort");
    expect(sharedEnrollments.releaseDeletion).toHaveBeenCalledWith(reservation);
    expect(hostRelease).toHaveBeenCalledWith(reservation);
    expect(hostFence).toBeNull();
  });

  it("promotes a surviving Host precommit when a renderer crashes after the durable CAS", async () => {
    const reservation = { schemaVersion: 1 as const, operationId: "delete-after-cas", path: "Notes" };
    const crash = new Error("renderer disappeared before Host commit");
    let durable: readonly typeof reservation[] = [];
    let hostState: "precommit" | "committed" | null = null;
    let failFirstCommit = true;
    const hostReserve = vi.fn(async (
      _candidate: typeof reservation,
      state: "precommit" | "committed" = "committed",
    ) => {
      if (state === "committed" && failFirstCommit) {
        failFirstCommit = false;
        throw crash;
      }
      hostState = state;
    });
    const enrollments = {
      list: vi.fn(async () => []),
      listPendingCreations: vi.fn(async () => []),
      listDeletionReservations: vi.fn(async () => durable),
      rename: vi.fn(),
      reserveDeletion: vi.fn(async (_path: string, operationId?: string) => {
        durable = [{ ...reservation, operationId: operationId! }];
        return durable[0]!;
      }),
      releaseDeletion: vi.fn(async () => true),
    };
    const makeCoordinator = () => createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments,
      hostDeletionFences: {
        reserve: hostReserve,
        list: vi.fn(async () => hostState ? [{ ...reservation, state: hostState }] : []),
        release: vi.fn(async () => true),
      },
      deletionOperationId: () => reservation.operationId,
      refreshFile: vi.fn(async () => undefined),
    });

    await expect(makeCoordinator().prepareForFileMutation("delete", reservation.path)).rejects.toBe(crash);
    expect(durable).toEqual([reservation]);
    expect(hostState).toBe("precommit");

    await makeCoordinator().initializeDeletionFences();
    expect(hostState).toBe("committed");
    expect(hostReserve).toHaveBeenLastCalledWith(reservation, "committed");
  });

  it("migrates pending creation paths on rename and blocks deletion until recovery is resolved", async () => {
    const pending: CollaborationPendingCreationRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-pending"),
      path: "Notes/Pending.md",
      documentId: asDocumentId("document-pending"),
      serverUrl: "wss://collab.example.com",
      access: "owner",
      title: "Pending",
    };
    const rename = vi.fn(async (_fileId, path: string, title?: string) => ({
      ...pending,
      path,
      ...(title ? { title } : {}),
    }));
    const reserveDeletion = vi.fn(async () => {
      throw Object.assign(new Error("pending creation blocks delete"), {
        code: "pending-creation-delete-blocked",
      });
    });
    const moveFile = vi.fn(async () => undefined);
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({
          phase: "failed",
          attachment: "none",
          serverPersistence: "unavailable",
          pendingCreation: pending,
          pendingCreationRecovery: "in-memory",
          diagnostic: { code: "enrollment-recovery-required", message: "Retry enrollment." },
        }),
        subscribe: vi.fn(() => () => undefined),
        moveFile,
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => []),
        listPendingCreations: vi.fn(async () => [pending]),
        listDeletionReservations: vi.fn(async () => []),
        rename,
        reserveDeletion,
        releaseDeletion: vi.fn(async () => true),
      },
      pathExists: vi.fn(async () => false),
      refreshFile: vi.fn(async () => undefined),
    });

    await expect(coordinator.prepareForFileMutation("delete", "Notes"))
      .rejects.toMatchObject({ code: "pending-creation-delete-blocked" });
    await expect(coordinator.prepareForFileMutation("rename", "Notes/Pending.md"))
      .resolves.toBeUndefined();

    await coordinator.handlePathRenamed("Notes/Pending.md", "Archive/Pending.md");
    expect(moveFile).toHaveBeenCalledWith("Archive/Pending.md", "Pending");
    expect(rename).not.toHaveBeenCalled();
  });

  it("waits for an opening file context before applying its captured rename", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    let state = {
      phase: "joining" as const,
      attachment: "none" as const,
      serverPersistence: "unverified" as const,
    };
    const listeners = new Set<(snapshot: typeof state | (typeof state & { enrollment: CollaborationEnrollmentRecord })) => void>();
    const moveFile = vi.fn(async () => undefined);
    const list = vi.fn(async () => [record]);
    const rename = vi.fn(async () => record);
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => state,
        subscribe(listener) {
          listeners.add(listener as never);
          listener(state);
          return () => listeners.delete(listener as never);
        },
        moveFile,
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list,
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => []),
        rename,
        reserveDeletion: vi.fn(),
        releaseDeletion: vi.fn(async () => true),
      },
      refreshFile: vi.fn(async () => undefined),
    });

    const moving = coordinator.handlePathRenamed("Notes/A.md", "Archive/A.md");
    await Promise.resolve();
    expect(list).not.toHaveBeenCalled();
    expect(moveFile).not.toHaveBeenCalled();

    state = { ...state, phase: "active", enrollment: record } as never;
    for (const listener of listeners) listener(state);
    await moving;

    expect(moveFile).toHaveBeenCalledWith("Archive/A.md", "A");
    expect(rename).not.toHaveBeenCalled();
  });

  it("refreshes the captured file context even when active projection migration fails closed", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const moveFailure = Object.assign(new Error("projection move failed"), { code: "file-move-failed" });
    const refreshFile = vi.fn(async () => undefined);
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({
          phase: "active",
          attachment: "attached",
          serverPersistence: "server-synchronized",
          enrollment: record,
        }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => { throw moveFailure; }),
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => [record]),
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => []),
        rename: vi.fn(async () => record),
        reserveDeletion: vi.fn(),
        releaseDeletion: vi.fn(async () => true),
      },
      refreshFile,
    });

    await expect(coordinator.handlePathRenamed("Notes/A.md", "Archive/A.md"))
      .rejects.toBe(moveFailure);
    expect(refreshFile).toHaveBeenCalledTimes(1);
  });

  it("releases on trash failure or completed coordination, but retains on post-trash coordination failure", async () => {
    const reservation = {
      schemaVersion: 1 as const,
      operationId: "delete-1",
      path: "Notes",
    };
    const reserveDeletion = vi.fn(async () => reservation);
    const releaseDeletion = vi.fn(async () => true);
    const hostReserve = vi.fn(async () => undefined);
    const hostRelease = vi.fn(async () => true);
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => []),
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => [reservation]),
        rename: vi.fn(),
        reserveDeletion,
        releaseDeletion,
      },
      hostDeletionFences: { reserve: hostReserve, release: hostRelease },
      deletionOperationId: () => reservation.operationId,
      pathExists: vi.fn(async () => false),
      refreshFile: vi.fn(async () => undefined),
    });

    await coordinator.prepareForFileMutation("delete", "Notes");
    expect(reserveDeletion).toHaveBeenCalledWith("Notes", reservation.operationId);
    expect(releaseDeletion).not.toHaveBeenCalled();

    await coordinator.completeFileMutation("delete", "Notes", {
      filesystem: "failed",
      coordination: "not-run",
      refresh: "not-run",
    });
    expect(releaseDeletion).toHaveBeenCalledWith(reservation);
    expect(hostRelease).toHaveBeenCalledWith(reservation);

    await coordinator.prepareForFileMutation("delete", "Notes");
    expect(reserveDeletion).toHaveBeenCalledTimes(2);
    await coordinator.completeFileMutation("delete", "Notes", {
      filesystem: "succeeded",
      coordination: "failed",
      refresh: "not-run",
    });
    expect(releaseDeletion).toHaveBeenCalledTimes(1);
    expect(hostRelease).toHaveBeenCalledTimes(1);

    await coordinator.recoverFileDeletion(reservation.operationId, "complete");
    expect(releaseDeletion).toHaveBeenCalledTimes(2);
    expect(hostRelease).toHaveBeenCalledTimes(2);
    await coordinator.prepareForFileMutation("delete", "Notes");
    expect(reserveDeletion).toHaveBeenCalledTimes(3);
    await coordinator.completeFileMutation("delete", "Notes", {
      filesystem: "succeeded",
      coordination: "succeeded",
      refresh: "failed",
    });
    expect(releaseDeletion).toHaveBeenCalledTimes(3);
    expect(hostRelease).toHaveBeenCalledTimes(3);
  });

  it("requires explicit incomplete-delete recovery and retains its reservation when coordination fails", async () => {
    const reservation = {
      schemaVersion: 1 as const,
      operationId: "delete-crash",
      path: "Notes/A.md",
    };
    const coordinationFailure = new Error("leave failed");
    const releaseDeletion = vi.fn(async () => true);
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutationStubs(),
        getState: () => ({
          phase: "active",
          attachment: "attached",
          serverPersistence: "server-synchronized",
          enrollment: {
            schemaVersion: 1,
            fileId: asFileId("file-a"),
            path: "Notes/A.md",
            documentId: asDocumentId("document-a"),
            serverUrl: "wss://collab.example.com",
            access: "editor",
            title: "A",
          },
        }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => { throw coordinationFailure; }),
      },
      enrollments: {
        list: vi.fn(async () => []),
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => [reservation]),
        rename: vi.fn(),
        reserveDeletion: vi.fn(),
        releaseDeletion,
      },
      pathExists: vi.fn(async () => false),
      refreshFile: vi.fn(async () => undefined),
    });

    await expect(coordinator.listIncompleteFileDeletions()).resolves.toEqual([{
      reservation,
      pathState: "missing",
    }]);
    expect(releaseDeletion).not.toHaveBeenCalled();

    await expect(coordinator.recoverFileDeletion("delete-crash", "complete"))
      .rejects.toBe(coordinationFailure);
    expect(releaseDeletion).not.toHaveBeenCalled();
  });

  it("forgets every exact enrollment below a deleted directory before releasing its reservation", async () => {
    const records: CollaborationEnrollmentRecord[] = ["A", "Nested/B"].map((suffix, index) => ({
      schemaVersion: 1,
      fileId: asFileId(`file-${index}`),
      path: `Notes/${suffix}.md`,
      documentId: asDocumentId(`document-${index}`),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: suffix,
    }));
    const outside = { ...records[0]!, fileId: asFileId("file-outside"), path: "Elsewhere/C.md" };
    const workspaceMutations = workspaceMutationStubs();
    const refreshFile = vi.fn(async () => {
      throw new Error("UI refresh failed");
    });
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutations,
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => [...records, outside]),
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => []),
        rename: vi.fn(),
        reserveDeletion: vi.fn(),
        releaseDeletion: vi.fn(async () => true),
      },
      refreshFile,
    });

    await expect(coordinator.handleFileDeleted("Notes")).resolves.toBeUndefined();

    expect(workspaceMutations.forgetEnrollment.mock.calls).toEqual(records.map((record) => [record]));
    expect(workspaceMutations.forgetEnrollment).not.toHaveBeenCalledWith(outside);
    expect(refreshFile).not.toHaveBeenCalled();
  });

  it("finishes descendant tombstones before releasing a missing-path recovery reservation", async () => {
    const reservation = { schemaVersion: 1 as const, operationId: "delete-crash", path: "Notes" };
    const deletion: CollaborationIdentityDeletion = {
      schemaVersion: 1,
      operationId: "forget-crash",
      kind: "enrollment",
      record: {
        schemaVersion: 1,
        fileId: asFileId("file-a"),
        path: "Notes/Nested/A.md",
        documentId: asDocumentId("document-a"),
        serverUrl: "wss://collab.example.com",
        access: "editor",
        title: "A",
      },
    };
    const workspaceMutations = workspaceMutationStubs();
    workspaceMutations.listIncompleteEnrollmentMutations.mockResolvedValue([{
      deletion,
      projectionState: "present",
    }]);
    const releaseDeletion = vi.fn(async () => true);
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutations,
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => []),
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => [reservation]),
        rename: vi.fn(),
        reserveDeletion: vi.fn(),
        releaseDeletion,
      },
      pathExists: vi.fn(async () => false),
      refreshFile: vi.fn(async () => undefined),
    });

    await coordinator.recoverFileDeletion(reservation.operationId, "complete");

    expect(workspaceMutations.finishIncompleteEnrollmentMutation).toHaveBeenCalledWith(deletion);
    expect(releaseDeletion).toHaveBeenCalledWith(reservation);
  });

  it("restores exact descendant tombstones before explicitly aborting a stale delete", async () => {
    const reservation = { schemaVersion: 1 as const, operationId: "delete-crash", path: "Notes" };
    const deletion: CollaborationIdentityDeletion = {
      schemaVersion: 1,
      operationId: "forget-crash",
      kind: "enrollment",
      record: {
        schemaVersion: 1,
        fileId: asFileId("file-a"),
        path: "Notes/A.md",
        documentId: asDocumentId("document-a"),
        serverUrl: "wss://collab.example.com",
        access: "editor",
        title: "A",
      },
    };
    const workspaceMutations = workspaceMutationStubs();
    workspaceMutations.listIncompleteEnrollmentMutations.mockResolvedValue([{
      deletion,
      projectionState: "present",
    }]);
    const releaseDeletion = vi.fn(async () => true);
    const coordinator = createElectronCollaborationFileLifecycleCoordinator({
      workspace: {
        ...workspaceMutations,
        getState: () => ({ phase: "idle", attachment: "none", serverPersistence: "unverified" }),
        subscribe: vi.fn(() => () => undefined),
        moveFile: vi.fn(async () => undefined),
        leave: vi.fn(async () => undefined),
      },
      enrollments: {
        list: vi.fn(async () => []),
        listPendingCreations: vi.fn(async () => []),
        listDeletionReservations: vi.fn(async () => [reservation]),
        rename: vi.fn(),
        reserveDeletion: vi.fn(),
        releaseDeletion,
      },
      pathExists: vi.fn(async () => true),
      refreshFile: vi.fn(async () => undefined),
    });

    await coordinator.recoverFileDeletion(reservation.operationId, "abort");

    expect(workspaceMutations.restoreIncompleteEnrollmentMutation)
      .toHaveBeenCalledWith(deletion, reservation);
    expect(releaseDeletion).toHaveBeenCalledWith(reservation);
  });
});
