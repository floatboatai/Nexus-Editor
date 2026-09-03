import {
  createCollaborationEngine,
  createCollaborationWorkflow,
  createFileProjectionController,
  type DocumentId,
  type FileId,
  type FileProjectionAdapter,
  type ProjectionMetadataStore,
  type ReplicaStore,
} from "@floatboat/nexus-plugin-collab";
import {
  createHocuspocusProviderFactory,
  type HocuspocusCollaborationProvider,
} from "@floatboat/nexus-plugin-collab/hocuspocus";

import type { ElectronCollabStoreBridge } from "../shared/collab-store-ipc";
import type {
  PluginHostBridge,
  PluginVaultProjectionOpeningFence,
  PluginVaultProjectionOpeningOwner,
  VaultId,
  VaultSessionId,
} from "../shared/plugin-ipc";
import { createElectronCollabReplicaStore } from "./collab-ipc-replica-store";
import { createServerScopedReplicaStore } from "./collaboration-scoped-store";
import {
  DocumentContextChangedError,
  type DocumentContextTransactions,
} from "./document-context-transaction";
import {
  createCollaborationEnrollmentStore,
  type CollaborationEnrollmentRecord,
  type CollaborationEnrollmentStore,
  type CollaborationPathDeletionReservation,
  type CollaborationPendingJoin,
} from "./collaboration-enrollment-store";
import { canonicalCollaborationServerUrl } from "./collaboration-server-url";
import {
  createCollaborationConnectionAdapter,
  createCollaborationInvitationAdapter,
  createMemoryCollaborationCredentialRegistry,
  decodeCollaborationInvitation,
  CollaborationNetworkError,
  type CollaborationCredential,
  type CollaborationInvitationIssuer,
  type CollaborationNetworkFetch,
} from "./collaboration-network-adapters";
import {
  createCollaborationPanel,
  type CollaborationPanel,
  type CollaborationPendingJoinRecovery,
} from "./collaboration-panel";
import {
  createPluginProjectionMetadataStore,
  createPluginVaultFileProjectionAdapter,
} from "./collaboration-vault-adapters";
import {
  createCollaborationWorkspace,
  type CollaborationWorkspace,
  type CollaborationWorkspaceBackend,
  type CollaborationWorkspaceBackendFactory,
  type CollaborationWorkspaceCredential,
  type CollaborationWorkspaceFile,
  type CollaborationWorkspaceJoinTransaction,
} from "./collaboration-workspace";

export interface ElectronCollaborationBackendFactoryOptions {
  readonly store: ReplicaStore;
  readonly files: FileProjectionAdapter;
  readonly metadata: ProjectionMetadataStore;
  readonly fetch?: CollaborationNetworkFetch;
  readonly issueInvitation?: CollaborationInvitationIssuer;
  /** Omitted only for independently configured Hosts and adapter qualification fixtures. */
  readonly trustedServerUrls?: readonly string[];
  readonly now?: () => number;
  readonly invitationIdGenerator?: () => string;
  readonly invitationLifetimeSeconds?: number;
  readonly createProvider?: (
    serverUrl: string,
    resolveToken: (documentId: DocumentId) => string,
  ) => HocuspocusCollaborationProvider;
}

function backendCredential(
  credential: CollaborationWorkspaceCredential,
  access: "owner" | "editor" | "reader",
): CollaborationCredential {
  return {
    token: credential.token,
    userId: credential.userId,
    role: access,
  };
}

/** Creates the real server-scoped stack while keeping every credential in one in-memory registry. */
export function createElectronCollaborationBackendFactory(
  options: ElectronCollaborationBackendFactoryOptions,
): CollaborationWorkspaceBackendFactory {
  const trustedServers = options.trustedServerUrls
    ? new Set(options.trustedServerUrls.map(canonicalCollaborationServerUrl))
    : undefined;
  const requireTrustedServer = (value: string): string => {
    const url = canonicalCollaborationServerUrl(value);
    if (trustedServers && !trustedServers.has(url)) {
      throw new CollaborationNetworkError(
        "server-not-trusted",
        "Configure this endpoint as a trusted server in NEXUS_COLLAB_SERVERS and restart the application.",
      );
    }
    return url;
  };
  return {
    assertServerTrusted(value) { requireTrustedServer(value); },
    inspectInvitation(value) {
      const envelope = decodeCollaborationInvitation(value, options.now ? { now: options.now } : {});
      requireTrustedServer(envelope.serverUrl);
      return {
        serverUrl: envelope.serverUrl,
        documentId: envelope.documentId,
        userId: envelope.userId,
        role: envelope.role,
        expiresAt: envelope.expiresAt,
      };
    },

    create(value): CollaborationWorkspaceBackend {
      const serverUrl = requireTrustedServer(value);
      const credentials = createMemoryCollaborationCredentialRegistry();
      const provider = options.createProvider?.(serverUrl, (documentId) => credentials.resolveToken(documentId))
        ?? createHocuspocusProviderFactory({
          url: serverUrl,
          token: (documentId) => credentials.resolveToken(documentId),
          reconnect: {
            initialDelayMs: 500,
            maximumDelayMs: 15_000,
            maximumAttempts: 12,
            factor: 1.8,
            jitter: true,
          },
        });
      const invitations = createCollaborationInvitationAdapter({
        serverUrl,
        credentials,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.issueInvitation ? { issueInvitation: options.issueInvitation } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.invitationIdGenerator ? { idGenerator: options.invitationIdGenerator } : {}),
        ...(options.invitationLifetimeSeconds
          ? { lifetimeSeconds: options.invitationLifetimeSeconds }
          : {}),
      });
      const connections = createCollaborationConnectionAdapter({
        credentials,
        control: provider.control,
      });
      const engine = createCollaborationEngine({
        providers: provider,
        store: createServerScopedReplicaStore(options.store, serverUrl),
      });
      const projections = createFileProjectionController({
        files: options.files,
        metadata: options.metadata,
      });
      const workflow = createCollaborationWorkflow({
        engine,
        projections,
        invitations,
        connections,
      });
      const documentIds = new Set<DocumentId>();
      let closed = false;

      return {
        serverUrl,
        workflow,
        activateCredential(documentId, credential, access) {
          if (closed) throw new Error("Collaboration backend is closed");
          documentIds.add(documentId);
          credentials.set(documentId, backendCredential(credential, access));
        },
        stageReauthentication(documentId, credential, access) {
          if (closed) throw new Error("Collaboration backend is closed");
          documentIds.add(documentId);
          connections.stageCredential(documentId, backendCredential(credential, access));
        },
        async close() {
          if (closed) return;
          closed = true;
          for (const snapshot of workflow.list()) documentIds.add(snapshot.documentId);
          const failures: unknown[] = [];
          await workflow.close().catch((cause) => failures.push(cause));
          await projections.close().catch((cause) => failures.push(cause));
          await engine.close().catch((cause) => failures.push(cause));
          for (const documentId of documentIds) {
            connections.clearPendingCredential(documentId);
            credentials.clear(documentId);
          }
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1) throw new AggregateError(failures, "Collaboration backend cleanup failed");
        },
      };
    },
  };
}

export interface ElectronCollaborationProductOptions {
  readonly ownerDocument?: Document;
  readonly pluginBridge: Pick<PluginHostBridge, "vault" | "storage">;
  readonly storeBridge: ElectronCollabStoreBridge;
  readonly network: {
    readonly serverUrls: readonly string[];
    readonly issueInvitation: CollaborationInvitationIssuer;
  };
  readonly vaultSessionId: VaultSessionId;
  /** Stable opaque Host identity used only to partition non-secret collaboration metadata. */
  readonly vaultId: string;
  readonly documentContext: DocumentContextTransactions;
  readonly getCurrentFile: () => CollaborationWorkspaceFile | null;
  readonly isCurrentFileDirty: () => boolean;
  readonly confirmDiscardEditorContent: () => boolean | Promise<boolean>;
  readonly confirmDiscardUnprojected: () => boolean | Promise<boolean>;
  readonly onProjectionClean?: (projection: {
    readonly path: string;
    readonly markdown: string;
  }) => void;
  readonly openDeveloperLab?: () => void | Promise<void>;
  readonly fetch?: CollaborationNetworkFetch;
}

export interface ElectronCollaborationProduct {
  readonly vaultSessionId: VaultSessionId;
  readonly workspace: CollaborationWorkspace;
  readonly panel: CollaborationPanel;
  initialize(): Promise<void>;
  recoverPendingJoins(): Promise<readonly ElectronProjectionOpeningRecovery[]>;
  listPendingJoins(): Promise<readonly CollaborationPendingJoin[]>;
  /** Explicitly abandons only local coordination; it never rewrites or deletes the Markdown file. */
  abandonPendingJoin(operationId: string): Promise<void>;
  open(): Promise<void>;
  saveCurrent(): Promise<void>;
  prepareForFileChange(): Promise<boolean>;
  prepareForFileMutation(
    kind: "rename" | "delete",
    path: string,
  ): Promise<CollaborationPathDeletionReservation | void>;
  completeFileMutation(
    kind: "rename" | "delete",
    path: string,
    outcome: CollaborationFileMutationOutcome,
  ): Promise<void>;
  listIncompleteFileDeletions(): Promise<readonly CollaborationFileDeletionRecovery[]>;
  recoverFileDeletion(operationId: string, resolution: "abort" | "complete"): Promise<void>;
  refreshFile(): Promise<void>;
  handlePathRenamed(oldPath: string, newPath: string): Promise<void>;
  handleFileDeleted(path: string): Promise<void>;
  destroy(): Promise<void>;
}

export interface CollaborationFileMutationOutcome {
  readonly filesystem: "failed" | "succeeded";
  readonly coordination: "not-run" | "failed" | "succeeded";
  readonly refresh: "not-run" | "failed" | "succeeded";
}

export interface CollaborationFileDeletionRecovery {
  readonly reservation: CollaborationPathDeletionReservation;
  readonly pathState: "present" | "missing";
}

interface ElectronCollaborationProductResources {
  readonly closeWorkspace: () => Promise<void>;
  readonly unsubscribeWorkspace: () => void;
  readonly destroyPanel: () => void;
  readonly closeReplicaStore: () => Promise<void>;
}

/**
 * Application teardown cannot safely be made conditional on a modal prompt.
 * This helper makes shutdown idempotent and attempts every owned cleanup even
 * when an earlier resource reports a failure.
 */
export function createElectronCollaborationProductDestroy(
  resources: ElectronCollaborationProductResources,
): () => Promise<void> {
  let task: Promise<void> | null = null;
  return () => {
    if (task) return task;
    task = (async () => {
      const failures: unknown[] = [];
      await resources.closeWorkspace().catch((cause) => failures.push(cause));
      try { resources.unsubscribeWorkspace(); } catch (cause) { failures.push(cause); }
      try { resources.destroyPanel(); } catch (cause) { failures.push(cause); }
      await resources.closeReplicaStore().catch((cause) => failures.push(cause));
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, "Electron collaboration product cleanup failed");
      }
    })();
    return task;
  };
}

function storageScope(prefix: string, sessionId: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of sessionId) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${prefix}.${hash.toString(16).padStart(16, "0")}`;
}

function pathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix.replace(/\/+$/u, "")}/`);
}

function renamedPath(path: string, oldPrefix: string, newPrefix: string): string {
  return `${newPrefix.replace(/\/+$/u, "")}${path.slice(oldPrefix.replace(/\/+$/u, "").length)}`;
}

function vaultTreeContainsPath(
  nodes: readonly { readonly path: string; readonly children?: readonly unknown[] }[],
  path: string,
): boolean {
  for (const node of nodes) {
    if (node.path === path) return true;
    if (node.children && vaultTreeContainsPath(
      node.children as readonly { readonly path: string; readonly children?: readonly unknown[] }[],
      path,
    )) return true;
  }
  return false;
}

type CollaborationFileLifecycleWorkspace = Pick<
  CollaborationWorkspace,
  | "getState"
  | "subscribe"
  | "moveFile"
  | "leave"
  | "forgetEnrollment"
  | "listIncompleteEnrollmentMutations"
  | "finishIncompleteEnrollmentMutation"
  | "restoreIncompleteEnrollmentMutation"
>;

interface ElectronCollaborationFileLifecycleCoordinatorOptions {
  readonly workspace: CollaborationFileLifecycleWorkspace;
  readonly enrollments: Pick<
    CollaborationEnrollmentStore,
    | "list"
    | "listPendingCreations"
    | "listDeletionReservations"
    | "rename"
    | "reserveDeletion"
    | "releaseDeletion"
  > & Partial<Pick<CollaborationEnrollmentStore, "listPendingJoins">>;
  readonly hostDeletionFences?: {
    reserve(
      reservation: CollaborationPathDeletionReservation,
      state?: "precommit" | "committed",
    ): Promise<void>;
    list?(): Promise<readonly {
      readonly path: string;
      readonly operationId: string;
      readonly state: "precommit" | "committed";
    }[]>;
    release(reservation: CollaborationPathDeletionReservation): Promise<unknown>;
  };
  readonly deletionOperationId?: () => string;
  readonly refreshFile: () => Promise<void>;
  readonly pathExists?: (path: string) => Promise<boolean>;
}

function isWorkspaceContextTransition(phase: ReturnType<CollaborationWorkspace["getState"]>["phase"]): boolean {
  return ["creating", "joining", "resuming", "leaving"].includes(phase);
}

async function waitForWorkspaceContextTransition(workspace: CollaborationFileLifecycleWorkspace): Promise<void> {
  if (!isWorkspaceContextTransition(workspace.getState().phase)) return;
  await new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | undefined;
    let unsubscribeWhenReady = false;
    const finish = (): void => {
      if (unsubscribe) unsubscribe();
      else unsubscribeWhenReady = true;
      resolve();
    };
    unsubscribe = workspace.subscribe((snapshot) => {
      if (!isWorkspaceContextTransition(snapshot.phase)) finish();
    });
    if (unsubscribeWhenReady) unsubscribe();
  });
}

/** Coordinates Host file mutations with any collaboration transition that began during filesystem I/O. */
export function createElectronCollaborationFileLifecycleCoordinator(
  options: ElectronCollaborationFileLifecycleCoordinatorOptions,
) {
  const localDeletionReservations = new Map<string, CollaborationPathDeletionReservation>();
  const hostDeletionFences = options.hostDeletionFences ?? {
    reserve: async () => undefined,
    list: async () => [],
    release: async () => undefined,
  };
  const nextDeletionOperationId = options.deletionOperationId ?? (() => globalThis.crypto.randomUUID());
  let deletionFenceInitialization: Promise<void> | null = null;
  const initializeDeletionFences = (): Promise<void> => {
    if (deletionFenceInitialization) return deletionFenceInitialization;
    deletionFenceInitialization = (async () => {
      for (const reservation of await options.enrollments.listDeletionReservations()) {
        await hostDeletionFences.reserve(reservation, "committed");
      }
    })().catch((cause) => {
      deletionFenceInitialization = null;
      throw cause;
    });
    return deletionFenceInitialization;
  };
  const releaseDeletionFence = async (
    reservation: CollaborationPathDeletionReservation,
  ): Promise<void> => {
    // The durable authority is the recovery source after a main-process restart.
    // Never open the in-memory Host fence while that durable release is uncertain.
    await options.enrollments.releaseDeletion(reservation);
    await hostDeletionFences.release(reservation);
    if (localDeletionReservations.get(reservation.path)?.operationId === reservation.operationId) {
      localDeletionReservations.delete(reservation.path);
    }
  };
  const runAndRefresh = async (operation: () => Promise<void>): Promise<void> => {
    let operationFailure: unknown;
    try {
      await operation();
    } catch (cause) {
      operationFailure = cause;
    }
    try {
      await options.refreshFile();
    } catch (refreshFailure) {
      if (operationFailure !== undefined) {
        throw new AggregateError(
          [operationFailure, refreshFailure],
          "Collaboration file coordination and UI refresh both failed",
        );
      }
      throw refreshFailure;
    }
    if (operationFailure !== undefined) throw operationFailure;
  };

  return {
    initializeDeletionFences,
    async prepareForFileMutation(
      kind: "rename" | "delete",
      path: string,
    ): Promise<CollaborationPathDeletionReservation | void> {
      const pendingJoins = await options.enrollments.listPendingJoins?.() ?? [];
      if (pendingJoins.some((pending) => pathWithin(pending.enrollment.path, path))) {
        throw Object.assign(
          new Error("Recover or explicitly abandon the pending collaboration join before changing this path."),
          { code: "pending-join-file-mutation-blocked" },
        );
      }
      if (kind !== "delete") return;
      await initializeDeletionFences();
      const localReservation = localDeletionReservations.get(path);
      if (localReservation) {
        const stillDurable = (await options.enrollments.listDeletionReservations()).some(
          (candidate) => candidate.operationId === localReservation.operationId,
        );
        if (stillDurable) {
          throw Object.assign(new Error("This file delete is already prepared."), {
            code: "enrollment-delete-reserved",
          });
        }
        await hostDeletionFences.release(localReservation);
        localDeletionReservations.delete(path);
      }
      const reservation: CollaborationPathDeletionReservation = {
        schemaVersion: 1,
        operationId: nextDeletionOperationId(),
        path,
      };
      localDeletionReservations.set(path, reservation);
      try {
        await hostDeletionFences.reserve(reservation, "precommit");
      } catch (cause) {
        // The Host may have installed the fence before its reply was lost. Keep
        // the local recovery marker; another renderer can enumerate the Host
        // precommit and release it explicitly.
        throw cause;
      }
      let durableReservation: CollaborationPathDeletionReservation;
      try {
        durableReservation = await options.enrollments.reserveDeletion(
          reservation.path,
          reservation.operationId,
        );
      } catch (cause) {
        const failures: unknown[] = [cause];
        try {
          const readBack = (await options.enrollments.listDeletionReservations()).find(
            (candidate) => candidate.operationId === reservation.operationId,
          );
          if (readBack && readBack.path === reservation.path) {
            await hostDeletionFences.reserve(readBack, "committed");
            localDeletionReservations.set(path, readBack);
            return readBack;
          }
        } catch (readBackFailure) {
          failures.push(readBackFailure);
        }
        if (failures.length > 1) {
          throw new AggregateError(failures, "Durable deletion reservation and read-back both failed");
        }
        throw cause;
      }
      if (
        durableReservation.operationId !== reservation.operationId ||
        durableReservation.path !== reservation.path
      ) {
        throw Object.assign(new Error("Durable deletion reservation did not preserve its exact identity."), {
          code: "enrollment-conflict",
        });
      }
      localDeletionReservations.set(path, durableReservation);
      await hostDeletionFences.reserve(durableReservation, "committed");
      return durableReservation;
    },
    async completeFileMutation(
      kind: "rename" | "delete",
      path: string,
      outcome: CollaborationFileMutationOutcome,
    ): Promise<void> {
      if (kind !== "delete") return;
      const reservation = localDeletionReservations.get(path);
      if (!reservation) return;
      if (outcome.filesystem === "succeeded" && outcome.coordination !== "succeeded") return;
      await releaseDeletionFence(reservation);
    },
    async listIncompleteFileDeletions(): Promise<readonly CollaborationFileDeletionRecovery[]> {
      await initializeDeletionFences();
      const durableReservations = await options.enrollments.listDeletionReservations();
      const reservations = [...durableReservations];
      for (const fence of await hostDeletionFences.list?.() ?? []) {
        if (!reservations.some((candidate) => candidate.operationId === fence.operationId)) {
          reservations.push({ schemaVersion: 1, path: fence.path, operationId: fence.operationId });
        }
      }
      for (const reservation of localDeletionReservations.values()) {
        if (!reservations.some((candidate) => candidate.operationId === reservation.operationId)) {
          reservations.push(reservation);
        }
      }
      const recoveries: CollaborationFileDeletionRecovery[] = [];
      for (const reservation of reservations) {
        const present = options.pathExists ? await options.pathExists(reservation.path) : true;
        recoveries.push({ reservation, pathState: present ? "present" : "missing" });
      }
      return recoveries;
    },
    async recoverFileDeletion(
      operationId: string,
      resolution: "abort" | "complete",
    ): Promise<void> {
      await initializeDeletionFences();
      const reservation = (await options.enrollments.listDeletionReservations())
        .find((candidate) => candidate.operationId === operationId) ??
        [...localDeletionReservations.values()].find((candidate) => candidate.operationId === operationId) ??
        (await hostDeletionFences.list?.() ?? [])
          .filter((candidate) => candidate.operationId === operationId)
          .map((candidate) => ({
            schemaVersion: 1 as const,
            path: candidate.path,
            operationId: candidate.operationId,
          }))[0];
      if (!reservation) return;
      const present = options.pathExists ? await options.pathExists(reservation.path) : true;
      if ((resolution === "abort") !== present) {
        throw Object.assign(
          new Error(present
            ? "The file still exists; abort the incomplete delete instead."
            : "The file is gone; finish its collaboration cleanup instead."),
          { code: "file-delete-recovery-state-changed" },
        );
      }
      if (resolution === "complete") {
        await this.handleFileDeleted(reservation.path);
      } else {
        const recoveries = await options.workspace.listIncompleteEnrollmentMutations();
        for (const recovery of recoveries) {
          if (!pathWithin(recovery.deletion.record.path, reservation.path)) continue;
          await options.workspace.restoreIncompleteEnrollmentMutation(
            recovery.deletion,
            reservation,
          );
        }
      }
      await releaseDeletionFence(reservation);
    },
    async handlePathRenamed(oldPath: string, newPath: string): Promise<void> {
      await waitForWorkspaceContextTransition(options.workspace);
      if (options.workspace.getState().phase === "closed") return;
      await runAndRefresh(async () => {
        const [enrollments, pendingCreations, pendingJoins] = await Promise.all([
          options.enrollments.list(),
          options.enrollments.listPendingCreations(),
          options.enrollments.listPendingJoins?.() ?? Promise.resolve([]),
        ]);
        if (pendingJoins.some((pending) => pathWithin(pending.enrollment.path, oldPath))) {
          throw Object.assign(
            new Error("A renamed path still has a pending collaboration join recovery."),
            { code: "pending-join-file-mutation-blocked" },
          );
        }
        const records = [...enrollments, ...pendingCreations];
        const workspaceState = options.workspace.getState();
        const coordinatedFileIds = new Set([
          workspaceState.enrollment?.fileId,
          workspaceState.pendingCreation?.fileId,
        ].filter((fileId): fileId is NonNullable<typeof fileId> => fileId !== undefined));
        for (const record of records) {
          if (!pathWithin(record.path, oldPath)) continue;
          const nextPath = renamedPath(record.path, oldPath, newPath);
          const slash = nextPath.lastIndexOf("/");
          const title = (slash < 0 ? nextPath : nextPath.slice(slash + 1)).replace(/\.md$/iu, "");
          if (coordinatedFileIds.has(record.fileId)) await options.workspace.moveFile(nextPath, title);
          else await options.enrollments.rename(record, nextPath, title);
        }
      });
    },
    async handleFileDeleted(path: string): Promise<void> {
      await waitForWorkspaceContextTransition(options.workspace);
      if (options.workspace.getState().phase === "closed") return;
      const [enrollments, pendingCreations, pendingJoins] = await Promise.all([
        options.enrollments.list(),
        options.enrollments.listPendingCreations(),
        options.enrollments.listPendingJoins?.() ?? Promise.resolve([]),
      ]);
      if (pendingCreations.some((record) => pathWithin(record.path, path))) {
        throw Object.assign(
          new Error("A deleted path still has a pending collaboration creation recovery."),
          { code: "pending-creation-delete-blocked" },
        );
      }
      if (pendingJoins.some((pending) => pathWithin(pending.enrollment.path, path))) {
        throw Object.assign(
          new Error("A deleted path still has a pending collaboration join recovery."),
          { code: "pending-join-file-mutation-blocked" },
        );
      }
      const active = options.workspace.getState().enrollment;
      if (active && pathWithin(active.path, path)) {
        await options.workspace.leave({ discardUnprojected: true });
      }
      for (const enrollment of enrollments) {
        if (pathWithin(enrollment.path, path)) {
          await options.workspace.forgetEnrollment(enrollment);
        }
      }
      const incomplete = await options.workspace.listIncompleteEnrollmentMutations();
      for (const recovery of incomplete) {
        if (pathWithin(recovery.deletion.record.path, path)) {
          await options.workspace.finishIncompleteEnrollmentMutation(recovery.deletion);
        }
      }
    },
  };
}

interface ElectronProjectionOpeningIdentity {
  readonly fileId: FileId;
  readonly path: string;
  readonly documentId: DocumentId;
}

export interface ElectronProjectionOpeningRecovery {
  readonly operationId: string;
  readonly path: string;
  readonly outcome:
    | "completed-enrollment"
    | "pending-active-renderer"
    | "pending-evidence"
    | "blocked-conflict"
    | "released-host-precommit"
    | "blocked-host-commit";
  readonly message: string;
}

interface ElectronProjectionOpeningHost {
  reserve(
    identity: { readonly path: string; readonly documentId: string },
    operationId: string,
    recoveryOwner?: PluginVaultProjectionOpeningOwner,
  ): Promise<PluginVaultProjectionOpeningFence>;
  commit(
    identity: { readonly path: string; readonly documentId: string },
    operationId: string,
  ): Promise<PluginVaultProjectionOpeningFence>;
  list(): Promise<readonly PluginVaultProjectionOpeningFence[]>;
  release(
    identity: { readonly path: string; readonly documentId: string },
    operationId: string,
  ): Promise<unknown>;
}

function projectionOpeningFailure(code: string, message: string, cause?: unknown): Error {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

/**
 * Coordinates one crash-recoverable join transaction across Host admission,
 * durable Enrollment intent, strict File Projection, and Enrollment commit.
 */
export function createElectronProjectionOpeningCoordinator(options: {
  readonly enrollments: Pick<CollaborationEnrollmentStore,
    "listPendingJoins" | "beginJoin" | "commitJoin" | "completeJoin" | "abortJoin">;
  readonly metadata: Pick<ProjectionMetadataStore, "load">;
  readonly vaultId: VaultId;
  readonly host: ElectronProjectionOpeningHost;
  readonly operationId?: () => string;
}) {
  const openings = new Map<string, {
    readonly documentId: DocumentId;
    readonly operationId: string;
  }>();
  const recoveryResults = new Map<string, ElectronProjectionOpeningRecovery>();
  const keyOf = (identity: Pick<ElectronProjectionOpeningIdentity, "fileId" | "path">): string =>
    `${identity.fileId}\0${identity.path}`;

  const releaseTwice = async (
    identity: { readonly path: string; readonly documentId: string },
    operationId: string,
  ): Promise<void> => {
    try {
      await options.host.release(identity, operationId);
    } catch (firstFailure) {
      try {
        await options.host.release(identity, operationId);
      } catch (secondFailure) {
        throw Object.assign(new AggregateError(
          [firstFailure, secondFailure],
          "Projection opening Host release failed twice",
        ), { code: "projection-opening-release-failed" });
      }
    }
  };

  const exactFence = (
    fence: PluginVaultProjectionOpeningFence,
    intent: CollaborationPendingJoin,
  ): boolean => fence.vaultId === intent.owner.vaultId &&
    fence.path === intent.enrollment.path &&
    fence.documentId === intent.enrollment.documentId &&
    fence.operationId === intent.operationId &&
    fence.owner.senderId === intent.owner.senderId &&
    fence.owner.sessionId === intent.owner.sessionId;

  const assertFence = (
    fence: PluginVaultProjectionOpeningFence,
    expected: {
      readonly path: string;
      readonly documentId: DocumentId;
      readonly operationId: string;
      readonly state?: "precommit" | "committed";
    },
  ): void => {
    if (
      fence.vaultId !== options.vaultId ||
      fence.path !== expected.path ||
      fence.documentId !== expected.documentId ||
      fence.operationId !== expected.operationId ||
      !fence.active ||
      (expected.state !== undefined && fence.state !== expected.state)
    ) {
      throw projectionOpeningFailure(
        "projection-opening-mismatch",
        "Vault Host returned a mismatched projection opening fence",
      );
    }
  };

  const rebind = async (
    intent: CollaborationPendingJoin,
  ): Promise<PluginVaultProjectionOpeningFence> => {
    const fence = await options.host.reserve(
      intent.enrollment,
      intent.operationId,
      intent.owner,
    );
    if (!exactFence(fence, intent) || !fence.active) {
      throw projectionOpeningFailure(
        "projection-opening-mismatch",
        "The recovered Host fence does not match the durable pending join",
      );
    }
    openings.set(keyOf(intent.enrollment), {
      documentId: intent.enrollment.documentId,
      operationId: intent.operationId,
    });
    return fence;
  };

  const restoreCommittedFence = async (
    intent: CollaborationPendingJoin,
  ): Promise<void> => {
    let fence = await rebind(intent);
    if (fence.state === "precommit") {
      fence = await options.host.commit(intent.enrollment, intent.operationId);
    }
    if (!exactFence(fence, intent) || fence.state !== "committed" || !fence.active) {
      throw projectionOpeningFailure(
        "projection-opening-mismatch",
        "The restored Host fence does not match the retained durable pending join",
      );
    }
  };

  const abortAfterHostRelease = async (
    intent: CollaborationPendingJoin,
  ): Promise<void> => {
    try {
      await options.enrollments.abortJoin(intent);
      openings.delete(keyOf(intent.enrollment));
      return;
    } catch (abortFailure) {
      let durableIntent: CollaborationPendingJoin | null | undefined;
      try {
        durableIntent = (await options.enrollments.listPendingJoins())
          .find((candidate) => candidate.operationId === intent.operationId) ?? null;
      } catch {
        // The durable outcome is unknown. Rebuild from the last exact intent so
        // the path remains fail-closed until storage can be inspected again.
      }
      if (durableIntent === null) {
        openings.delete(keyOf(intent.enrollment));
        return;
      }
      try {
        await restoreCommittedFence(durableIntent ?? intent);
      } catch (restoreFailure) {
        throw Object.assign(new AggregateError(
          [abortFailure, restoreFailure],
          "Pending join abort failed and its Host fence could not be restored",
        ), { code: "projection-opening-restore-failed" });
      }
      throw abortFailure;
    }
  };

  const finalize = async (intent: CollaborationPendingJoin): Promise<void> => {
    await releaseTwice(intent.enrollment, intent.operationId);
    openings.delete(keyOf(intent.enrollment));
    await options.enrollments.completeJoin(intent);
  };

  const transactionFor = (
    intent: CollaborationPendingJoin,
  ): CollaborationWorkspaceJoinTransaction => {
    const key = keyOf(intent.enrollment);
    openings.set(key, {
      documentId: intent.enrollment.documentId,
      operationId: intent.operationId,
    });
    let currentIntent = intent;
    let completeTask: Promise<void> | null = null;
    let completed = false;
    return {
      intent,
      async commitEnrollment() {
        currentIntent = await options.enrollments.commitJoin(currentIntent);
        return currentIntent.enrollment;
      },
      complete() {
        if (completed) return Promise.resolve();
        completeTask ??= finalize(currentIntent).then(() => {
          completed = true;
        }).finally(() => {
          completeTask = null;
        });
        return completeTask;
      },
    };
  };

  return {
    resolve(file: Pick<ElectronProjectionOpeningIdentity, "fileId" | "path">) {
      const opening = openings.get(keyOf(file));
      return opening && {
        documentId: opening.documentId,
        operationId: opening.operationId,
      };
    },

    async begin(input: CollaborationEnrollmentRecord | Omit<CollaborationEnrollmentRecord, "schemaVersion">):
      Promise<CollaborationWorkspaceJoinTransaction> {
      const existingIntent = (await options.enrollments.listPendingJoins())
        .find((candidate) => candidate.enrollment.path === input.path);
      if (existingIntent) {
        if (
          existingIntent.phase !== "opening" ||
          existingIntent.enrollment.documentId !== input.documentId ||
          existingIntent.enrollment.serverUrl !== input.serverUrl ||
          existingIntent.enrollment.access !== input.access ||
          existingIntent.enrollment.title !== input.title
        ) {
          throw projectionOpeningFailure(
            "projection-opening-conflict",
            "The retained pending join does not match this invitation and file",
          );
        }
        const existingOpening = openings.get(keyOf(existingIntent.enrollment));
        if (existingOpening && (
          existingOpening.operationId !== existingIntent.operationId ||
          existingOpening.documentId !== existingIntent.enrollment.documentId
        )) {
          throw projectionOpeningFailure(
            "projection-opening-conflict",
            "This collaboration path has another renderer-local opening",
          );
        }
        let recoveredFence = await options.host.reserve(
          existingIntent.enrollment,
          existingIntent.operationId,
          existingIntent.owner,
        );
        if (!exactFence(recoveredFence, existingIntent) || !recoveredFence.active) {
          throw projectionOpeningFailure(
            "projection-opening-mismatch",
            "The retained pending join could not rebind its exact Host fence",
          );
        }
        if (recoveredFence.state === "precommit") {
          recoveredFence = await options.host.commit(
            existingIntent.enrollment,
            existingIntent.operationId,
          );
          if (
            !exactFence(recoveredFence, existingIntent) ||
            !recoveredFence.active ||
            recoveredFence.state !== "committed"
          ) {
            throw projectionOpeningFailure(
              "projection-opening-mismatch",
              "The retained pending join could not commit its exact Host fence",
            );
          }
        }
        return transactionFor(existingIntent);
      }
      const identity: ElectronProjectionOpeningIdentity = input;
      const key = keyOf(identity);
      if (openings.has(key)) {
        throw projectionOpeningFailure(
          "projection-opening-conflict",
          "This collaboration identity already has an unfinished join",
        );
      }
      const operationId = (options.operationId ?? (() => globalThis.crypto.randomUUID()))();
      const reserved = await options.host.reserve(identity, operationId);
      assertFence(reserved, { ...identity, operationId, state: "precommit" });
      let intent: CollaborationPendingJoin;
      try {
        intent = await options.enrollments.beginJoin({
          operationId,
          owner: {
            vaultId: reserved.vaultId,
            senderId: reserved.owner.senderId,
            sessionId: reserved.owner.sessionId,
          },
          enrollment: {
            fileId: input.fileId,
            path: input.path,
            documentId: input.documentId,
            serverUrl: input.serverUrl,
            access: input.access,
            title: input.title,
          },
        });
      } catch (cause) {
        try {
          await releaseTwice(identity, operationId);
        } catch (releaseFailure) {
          throw Object.assign(new AggregateError(
            [cause, releaseFailure],
            "Pending join persistence and Host precommit release both failed",
          ), { code: "projection-opening-release-failed" });
        }
        throw cause;
      }
      try {
        const committedFence = await options.host.commit(identity, operationId);
        assertFence(committedFence, { ...identity, operationId, state: "committed" });
      } catch (cause) {
        const cleanupFailures: unknown[] = [];
        let released = false;
        try {
          await releaseTwice(identity, operationId);
          released = true;
        } catch (cleanupFailure) {
          cleanupFailures.push(cleanupFailure);
        }
        if (released) {
          await abortAfterHostRelease(intent)
            .catch((cleanupFailure) => cleanupFailures.push(cleanupFailure));
        }
        if (cleanupFailures.length > 0) {
          throw Object.assign(new AggregateError(
            [cause, ...cleanupFailures],
            "Host projection opening commit and safe rollback failed",
          ), { code: "projection-opening-commit-failed" });
        }
        throw cause;
      }
      return transactionFor(intent);
    },

    async recover(): Promise<readonly ElectronProjectionOpeningRecovery[]> {
      const [intents, hostFences] = await Promise.all([
        options.enrollments.listPendingJoins(),
        options.host.list(),
      ]);
      const results: ElectronProjectionOpeningRecovery[] = [];
      const intentOperations = new Set(intents.map((intent) => intent.operationId));
      for (const intent of intents) {
        let fence = hostFences.find((candidate) => candidate.operationId === intent.operationId);
        if (fence && !exactFence(fence, intent)) {
          results.push({
            operationId: intent.operationId,
            path: intent.enrollment.path,
            outcome: "blocked-conflict",
            message: "Host fence and durable pending join identities conflict; both were retained.",
          });
          continue;
        }
        const localOpening = openings.get(keyOf(intent.enrollment));
        const locallyOwned = localOpening?.operationId === intent.operationId
          && localOpening.documentId === intent.enrollment.documentId;
        if (fence?.active && !locallyOwned) {
          results.push({
            operationId: intent.operationId,
            path: intent.enrollment.path,
            outcome: "pending-active-renderer",
            message: "Another live renderer still owns this pending join.",
          });
          continue;
        }
        try {
          if (!fence?.active) fence = await rebind(intent);
          if (intent.phase === "enrollment-committed") {
            if (fence.state === "precommit") {
              fence = await options.host.commit(intent.enrollment, intent.operationId);
              if (!exactFence(fence, intent) || fence.state !== "committed" || !fence.active) {
                throw projectionOpeningFailure(
                  "projection-opening-mismatch",
                  "Host commit did not preserve the exact pending join identity",
                );
              }
            }
            await finalize(intent);
            results.push({
              operationId: intent.operationId,
              path: intent.enrollment.path,
              outcome: "completed-enrollment",
              message: "Recovered the committed Enrollment and cleared its Host fence.",
            });
            continue;
          }
          const metadata = await options.metadata.load(intent.enrollment.fileId);
          if (!metadata) {
            results.push({
              operationId: intent.operationId,
              path: intent.enrollment.path,
              outcome: "pending-evidence",
              message: "Projection outcome is uncertain; pending join and Host fence were retained.",
            });
            continue;
          }
          if (
            metadata.record.file.id !== intent.enrollment.fileId ||
            metadata.record.file.path !== intent.enrollment.path ||
            metadata.record.documentId !== intent.enrollment.documentId
          ) {
            results.push({
              operationId: intent.operationId,
              path: intent.enrollment.path,
              outcome: "blocked-conflict",
              message: "Projection metadata conflicts with the pending join; no state was overwritten.",
            });
            continue;
          }
          if (fence.state === "precommit") {
            fence = await options.host.commit(intent.enrollment, intent.operationId);
            if (!exactFence(fence, intent) || fence.state !== "committed" || !fence.active) {
              throw projectionOpeningFailure(
                "projection-opening-mismatch",
                "Host commit did not preserve the exact pending join identity",
              );
            }
          }
          const committed = await options.enrollments.commitJoin(intent);
          await finalize(committed);
          results.push({
            operationId: intent.operationId,
            path: intent.enrollment.path,
            outcome: "completed-enrollment",
            message: metadata.record.base === null
              ? "Recovered the Enrollment after interrupted base confirmation; recovery preserved the file for explicit no-base reconciliation."
              : "Recovered the exact projected identity and completed its Enrollment.",
          });
        } catch (cause) {
          results.push({
            operationId: intent.operationId,
            path: intent.enrollment.path,
            outcome: "blocked-conflict",
            message: cause instanceof Error ? cause.message : "Pending join recovery failed closed.",
          });
        }
      }
      for (const fence of hostFences) {
        if (intentOperations.has(fence.operationId)) continue;
        if (fence.state !== "precommit" || fence.active) {
          results.push({
            operationId: fence.operationId,
            path: fence.path,
            outcome: fence.state === "committed" ? "blocked-host-commit" : "pending-active-renderer",
            message: fence.state === "committed"
              ? "A Host committed fence has no durable Enrollment proof and remains fail-closed."
              : "A live renderer still owns this Host precommit.",
          });
          continue;
        }
        try {
          const rebound = await options.host.reserve(fence, fence.operationId, fence.owner);
          if (
            rebound.vaultId !== fence.vaultId ||
            rebound.path !== fence.path ||
            rebound.documentId !== fence.documentId ||
            rebound.operationId !== fence.operationId ||
            rebound.state !== "precommit" ||
            !rebound.active
          ) throw projectionOpeningFailure("projection-opening-mismatch", "Host precommit rebind mismatched");
          await releaseTwice(fence, fence.operationId);
          results.push({
            operationId: fence.operationId,
            path: fence.path,
            outcome: "released-host-precommit",
            message: "Released an inactive Host-only precommit that could never authorize file writes.",
          });
        } catch (cause) {
          results.push({
            operationId: fence.operationId,
            path: fence.path,
            outcome: "blocked-conflict",
            message: cause instanceof Error ? cause.message : "Host precommit recovery failed closed.",
          });
        }
      }
      for (const result of results) recoveryResults.set(result.operationId, result);
      return results;
    },

    async inspect(): Promise<readonly CollaborationPendingJoinRecovery[]> {
      const intents = await options.enrollments.listPendingJoins();
      return Promise.all(intents.map(async (pending) => {
        const metadata = await options.metadata.load(pending.enrollment.fileId);
        const hasProjectionMetadata = metadata !== null;
        const previous = recoveryResults.get(pending.operationId);
        const localOpening = openings.get(keyOf(pending.enrollment));
        const locallyOwned = localOpening?.operationId === pending.operationId
          && localOpening.documentId === pending.enrollment.documentId;
        const fallback: ElectronProjectionOpeningRecovery = {
          operationId: pending.operationId,
          path: pending.enrollment.path,
          outcome: pending.phase === "opening" && !hasProjectionMetadata && locallyOwned
            ? "pending-evidence"
            : "blocked-conflict",
          message: pending.phase === "enrollment-committed"
            ? "The Enrollment commit is durable and is waiting for safe Host-fence completion."
            : hasProjectionMetadata
              ? "Projection metadata is durable and must be recovered into its exact Enrollment."
              : locallyOwned
                ? "The same renderer retained this failed join without Projection metadata; retry the same invitation or explicitly abandon it."
                : "Recovery has not yet established the Projection outcome.",
        };
        const recovery = previous ?? fallback;
        return {
          pending,
          outcome: recovery.outcome,
          message: recovery.message,
          hasProjectionMetadata,
          canAbandon: pending.phase === "opening"
            && !hasProjectionMetadata
            && recovery.outcome === "pending-evidence",
        };
      }));
    },

    async abandon(operationId: string): Promise<void> {
      const intent = (await options.enrollments.listPendingJoins())
        .find((candidate) => candidate.operationId === operationId);
      if (!intent) throw projectionOpeningFailure("pending-join-not-found", "Pending join was not found");
      if (intent.phase !== "opening") {
        throw projectionOpeningFailure(
          "pending-join-committed",
          "A committed pending join must be completed rather than abandoned",
        );
      }
      const metadata = await options.metadata.load(intent.enrollment.fileId);
      if (metadata) {
        throw projectionOpeningFailure(
          "pending-join-projection-present",
          "Projection metadata exists for this pending join. Recover it first, then use the exact enrolled-file forget flow; abandon never removes Projection metadata or rewrites Markdown.",
        );
      }
      const hostFence = (await options.host.list())
        .find((candidate) => candidate.operationId === intent.operationId);
      const locallyRebound = openings.get(keyOf(intent.enrollment))?.operationId === intent.operationId;
      if (hostFence && (!exactFence(hostFence, intent) || (hostFence.active && !locallyRebound))) {
        throw projectionOpeningFailure(
          "projection-opening-conflict",
          "The pending join Host fence is mismatched or still owned by a live renderer",
        );
      }
      if (!hostFence || !hostFence.active) await rebind(intent);
      await releaseTwice(intent.enrollment, intent.operationId);
      await abortAfterHostRelease(intent);
    },
  };
}

export function createElectronCollaborationProduct(
  options: ElectronCollaborationProductOptions,
): ElectronCollaborationProduct {
  if (options.network.serverUrls.length === 0 || options.network.serverUrls.length > 16) {
    throw new Error("A bounded trusted collaboration server configuration is required");
  }
  const serverUrls = options.network.serverUrls.map(canonicalCollaborationServerUrl);
  const ownerDocument = options.ownerDocument ?? document;
  const replicaStore = createElectronCollabReplicaStore({ bridge: options.storeBridge });
  const enrollmentStore = createCollaborationEnrollmentStore({
    bridge: options.pluginBridge,
    pluginId: storageScope("nexus-collaboration-enrollment", options.vaultId),
  });
  const metadata = createPluginProjectionMetadataStore({
    bridge: options.pluginBridge,
    pluginId: storageScope("nexus-collaboration-projection", options.vaultId),
  });
  const projectionOpenings = createElectronProjectionOpeningCoordinator({
    enrollments: enrollmentStore,
    metadata,
    vaultId: options.vaultId as VaultId,
    host: {
      reserve: (identity, operationId, recoveryOwner) =>
        options.pluginBridge.vault.reserveProjectionOpening(
          options.vaultSessionId,
          identity.path,
          identity.documentId,
          operationId,
          recoveryOwner,
        ),
      commit: (identity, operationId) => options.pluginBridge.vault.commitProjectionOpening(
        options.vaultSessionId,
        identity.path,
        identity.documentId,
        operationId,
      ),
      list: () => options.pluginBridge.vault.listProjectionOpenings(options.vaultSessionId),
      release: (identity, operationId) => options.pluginBridge.vault.releaseProjectionOpening(
        options.vaultSessionId,
        identity.path,
        identity.documentId,
        operationId,
      ),
    },
  });
  let ensureDeletionFences = async (): Promise<void> => undefined;
  const files = createPluginVaultFileProjectionAdapter({
    bridge: options.pluginBridge,
    sessionId: options.vaultSessionId,
    metadata,
    authorizeProjectionWrite: async (identity, authorizationOptions) => {
      await ensureDeletionFences();
      await enrollmentStore.assertProjectionWriteAuthorized(identity, authorizationOptions);
    },
    resolveUnenrolledProjectionOpening: (file) => projectionOpenings.resolve(file),
  });
  const backends = createElectronCollaborationBackendFactory({
    store: replicaStore,
    files,
    metadata,
    trustedServerUrls: serverUrls,
    issueInvitation: options.network.issueInvitation,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const workspace = createCollaborationWorkspace({
    enrollments: enrollmentStore,
    projectionMetadata: metadata,
    backends,
    joinTransactions: projectionOpenings,
  });
  let panel!: CollaborationPanel;
  const fileLifecycle = createElectronCollaborationFileLifecycleCoordinator({
    workspace,
    enrollments: enrollmentStore,
    hostDeletionFences: {
      reserve: async (reservation, state = "committed") => {
        const fenced = await options.pluginBridge.vault.reserveDeletion(
          options.vaultSessionId,
          reservation.path,
          reservation.operationId,
          state,
        );
        if (fenced.path !== reservation.path || fenced.operationId !== reservation.operationId) {
          throw new Error("Vault Host returned a mismatched deletion fence");
        }
      },
      list: () => options.pluginBridge.vault.listDeletionFences(options.vaultSessionId),
      release: (reservation) => options.pluginBridge.vault.releaseDeletion(
        options.vaultSessionId,
        reservation.path,
        reservation.operationId,
      ),
    },
    refreshFile: () => panel.refreshFile(),
    pathExists: async (path) => vaultTreeContainsPath(
      await options.pluginBridge.vault.list(options.vaultSessionId),
      path,
    ),
  });
  ensureDeletionFences = () => fileLifecycle.initializeDeletionFences();
  const initialize = async (): Promise<void> => {
    await ensureDeletionFences();
    await projectionOpenings.recover();
  };
  panel = createCollaborationPanel({
    ownerDocument,
    workspace,
    serverUrls,
    getCurrentFile: options.getCurrentFile,
    isCurrentFileDirty: options.isCurrentFileDirty,
    runOpening: (file, operation) => {
      const captured = options.documentContext.capture();
      return options.documentContext.runOpening(captured, (assertTransactionCurrent) => {
        const currentFile = options.getCurrentFile();
        if (!currentFile || currentFile.path !== file.path || currentFile.editor !== file.editor) {
          throw new DocumentContextChangedError();
        }
        const assertContextCurrent = (): void => {
          assertTransactionCurrent();
          const current = options.getCurrentFile();
          if (
            !current
            || current.path !== currentFile.path
            || current.editor !== currentFile.editor
            || current.markdown !== currentFile.markdown
          ) {
            throw new DocumentContextChangedError();
          }
        };
        assertContextCurrent();
        return operation(currentFile, assertContextCurrent);
      });
    },
    pendingJoinRecovery: {
      list: () => projectionOpenings.inspect(),
      recover: () => projectionOpenings.recover(),
      abandon: (operationId) => projectionOpenings.abandon(operationId),
    },
    fileDeletionRecovery: {
      list: () => fileLifecycle.listIncompleteFileDeletions(),
      recover: (operationId, resolution) => fileLifecycle.recoverFileDeletion(operationId, resolution),
    },
    enrollmentMutationRecovery: {
      list: async () => {
        const [recoveries, reservations] = await Promise.all([
          workspace.listIncompleteEnrollmentMutations(),
          enrollmentStore.listDeletionReservations(),
        ]);
        return recoveries.filter((recovery) => !reservations.some((reservation) =>
          pathWithin(recovery.deletion.record.path, reservation.path)));
      },
      finish: (deletion) => workspace.finishIncompleteEnrollmentMutation(deletion),
    },
    ...(options.openDeveloperLab ? { openDeveloperLab: options.openDeveloperLab } : {}),
  });
  ownerDocument.body.append(panel.element);
  const unsubscribeWorkspace = workspace.subscribe((snapshot) => {
    const projection = snapshot.session?.projection;
    if (
      snapshot.phase === "active"
      && snapshot.attachment === "attached"
      && projection?.projection === "clean"
      && projection.base
    ) {
      options.onProjectionClean?.({
        path: projection.file.path,
        markdown: projection.base.markdown,
      });
    }
  });
  const destroy = createElectronCollaborationProductDestroy({
    closeWorkspace: () => workspace.close({ discardUnprojected: true }),
    unsubscribeWorkspace,
    destroyPanel: () => panel.destroy(),
    closeReplicaStore: () => replicaStore.close(),
  });
  const leaveForContextChange = async (): Promise<boolean> => {
    const snapshot = workspace.getState();
    if (["creating", "joining", "resuming", "leaving"].includes(snapshot.phase)) return false;
    if (snapshot.phase !== "active") return true;
    if (snapshot.attachment === "content-mismatch") {
      if (!(await options.confirmDiscardEditorContent())) return false;
      await workspace.leave({ discardUnprojected: true });
      return true;
    }
    if (snapshot.attachment === "projection-conflict") {
      if (!(await options.confirmDiscardUnprojected())) return false;
      await workspace.leave({ discardUnprojected: true });
      return true;
    }
    try {
      await workspace.leave();
      return true;
    } catch (cause) {
      const code = cause && typeof cause === "object" ? Reflect.get(cause, "code") : undefined;
      if (code !== "unsafe-leave") throw cause;
      if (!(await options.confirmDiscardUnprojected())) return false;
      await workspace.leave({ discardUnprojected: true });
      return true;
    }
  };

  return {
    vaultSessionId: options.vaultSessionId,
    workspace,
    panel,
    initialize,
    recoverPendingJoins: () => projectionOpenings.recover(),
    listPendingJoins: () => enrollmentStore.listPendingJoins(),
    abandonPendingJoin: (operationId) => projectionOpenings.abandon(operationId),
    open: () => panel.open(),
    saveCurrent: () => workspace.flushFileProjection(),
    prepareForFileChange: leaveForContextChange,
    prepareForFileMutation: (kind, path) => fileLifecycle.prepareForFileMutation(kind, path),
    completeFileMutation: (kind, path, outcome) =>
      fileLifecycle.completeFileMutation(kind, path, outcome),
    listIncompleteFileDeletions: () => fileLifecycle.listIncompleteFileDeletions(),
    recoverFileDeletion: (operationId, resolution) =>
      fileLifecycle.recoverFileDeletion(operationId, resolution),
    refreshFile: () => panel.refreshFile(),
    handlePathRenamed: (oldPath, newPath) => fileLifecycle.handlePathRenamed(oldPath, newPath),
    handleFileDeleted: (path) => fileLifecycle.handleFileDeleted(path),
    destroy,
  };
}
