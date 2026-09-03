import type { EditorAPI } from "@floatboat/nexus-core";
import {
  asFileId,
  type CollaborationInvitation,
  type CollaborationWorkflow,
  type CollaborationWorkflowEditor,
  type CollaborationWorkflowSession,
  type CollaborationWorkflowSnapshot,
  type DocumentId,
  type FileConflictResolution,
  type FileId,
  type ProjectionMetadataEntry,
  type ProjectionMetadataStore,
  type Unsubscribe,
} from "@floatboat/nexus-plugin-collab";

import type {
  CollaborationEnrollmentAccess,
  CollaborationIdentityDeletion,
  CollaborationEnrollmentInput,
  CollaborationEnrollmentRecord,
  CollaborationEnrollmentStore,
  CollaborationPathDeletionReservation,
  CollaborationPendingCreationRecord,
  CollaborationPendingJoin,
} from "./collaboration-enrollment-store";

export interface CollaborationWorkspaceCredential {
  readonly token: string;
  readonly userId: string;
  readonly role: "editor" | "reader";
}

export interface CollaborationInspectedInvitation {
  readonly serverUrl: string;
  readonly documentId: DocumentId;
  readonly userId: string;
  readonly role: "editor" | "reader";
  readonly expiresAt: number;
}

/**
 * One server-scoped composition of Provider, Engine, File Projection, and
 * Workflow. Credentials remain inside this in-memory backend.
 */
export interface CollaborationWorkspaceBackend {
  readonly serverUrl: string;
  readonly workflow: CollaborationWorkflow;
  activateCredential(
    documentId: DocumentId,
    credential: CollaborationWorkspaceCredential,
    access: CollaborationEnrollmentAccess,
  ): void;
  stageReauthentication(
    documentId: DocumentId,
    credential: CollaborationWorkspaceCredential,
    access: CollaborationEnrollmentAccess,
  ): void;
  close(): Promise<void>;
}

export interface CollaborationWorkspaceBackendFactory {
  /** Optional Host policy check; must not allocate resources or perform network I/O. */
  assertServerTrusted?(serverUrl: string): void;
  inspectInvitation(value: string): CollaborationInspectedInvitation;
  create(serverUrl: string): CollaborationWorkspaceBackend;
}

export interface CollaborationWorkspaceFile {
  /** Vault-relative canonical path. */
  readonly path: string;
  readonly title: string;
  /** Current Editor buffer, including explicitly unsaved local work. */
  readonly markdown: string;
  readonly editor: EditorAPI;
  setReadOnly(readOnly: boolean): void;
}

export type CollaborationWorkspacePhase =
  | "idle"
  | "creating"
  | "joining"
  | "resuming"
  | "active"
  | "leaving"
  | "failed"
  | "closed";

export type CollaborationWorkspaceAttachment =
  | "none"
  | "attached"
  | "content-mismatch"
  | "projection-conflict";

/** Hocuspocus sync is observable; an individual server fsync acknowledgement is not. */
export type CollaborationServerPersistenceState =
  | "unverified"
  | "server-synchronized"
  | "unavailable";

export interface CollaborationWorkspaceDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface CollaborationWorkspaceSnapshot {
  readonly phase: CollaborationWorkspacePhase;
  readonly attachment: CollaborationWorkspaceAttachment;
  readonly serverPersistence: CollaborationServerPersistenceState;
  readonly enrollment?: CollaborationEnrollmentRecord;
  readonly pendingCreation?: CollaborationPendingCreationRecord;
  readonly pendingCreationRecovery?: "in-memory" | "credential-required";
  readonly session?: CollaborationWorkflowSnapshot;
  readonly diagnostic?: CollaborationWorkspaceDiagnostic;
}

export interface CollaborationWorkspaceCreateOptions {
  readonly file: CollaborationWorkspaceFile;
  readonly serverUrl: string;
  readonly documentId: DocumentId;
  readonly credential: CollaborationWorkspaceCredential;
  readonly displayName: string;
  /** Revalidates the UI-captured Editor/Vault context immediately before attachment. */
  readonly assertContextCurrent?: () => void;
}

export interface CollaborationWorkspaceJoinOptions {
  readonly file: CollaborationWorkspaceFile;
  readonly invitation: string;
  readonly displayName: string;
  readonly assertContextCurrent?: () => void;
}

export interface CollaborationWorkspaceResumeOptions {
  readonly file: CollaborationWorkspaceFile;
  readonly credential: CollaborationWorkspaceCredential;
  readonly displayName: string;
  readonly assertContextCurrent?: () => void;
}

export interface CollaborationWorkspaceRetryPendingCreationOptions {
  readonly file: CollaborationWorkspaceFile;
  /** Required after restart; omitted when the original capability is still retained in memory. */
  readonly credential?: CollaborationWorkspaceCredential;
  /** Required together with credential after restart. */
  readonly displayName?: string;
  readonly assertContextCurrent?: () => void;
}

export interface CollaborationWorkspaceOptions {
  readonly enrollments: CollaborationEnrollmentStore;
  readonly projectionMetadata: ProjectionMetadataStore;
  readonly backends: CollaborationWorkspaceBackendFactory;
  readonly joinTransactions?: CollaborationWorkspaceJoinTransactions;
  readonly createFileId?: () => FileId;
}

export interface CollaborationWorkspaceJoinTransaction {
  readonly intent: CollaborationPendingJoin;
  commitEnrollment(): Promise<CollaborationEnrollmentRecord>;
  /** Releases the Host fence before removing the durable recovery intent. */
  complete(): Promise<void>;
}

export interface CollaborationWorkspaceJoinTransactions {
  begin(input: CollaborationEnrollmentInput): Promise<CollaborationWorkspaceJoinTransaction>;
}

export interface CollaborationWorkspace {
  readonly closed: boolean;
  getState(): CollaborationWorkspaceSnapshot;
  subscribe(listener: (snapshot: CollaborationWorkspaceSnapshot) => void): Unsubscribe;
  findEnrollment(path: string): Promise<CollaborationEnrollmentRecord | null>;
  findPendingCreation(path: string): Promise<CollaborationPendingCreationRecord | null>;
  canRetryPendingCreationWithoutCredential(path: string): boolean;
  listIncompleteEnrollmentMutations(): Promise<readonly {
    readonly deletion: CollaborationIdentityDeletion;
    readonly projectionState: "present" | "missing";
  }[]>;
  finishIncompleteEnrollmentMutation(deletion: CollaborationIdentityDeletion): Promise<void>;
  restoreIncompleteEnrollmentMutation(
    deletion: CollaborationIdentityDeletion,
    reservation: CollaborationPathDeletionReservation,
  ): Promise<void>;
  create(options: CollaborationWorkspaceCreateOptions): Promise<void>;
  join(options: CollaborationWorkspaceJoinOptions): Promise<void>;
  resume(options: CollaborationWorkspaceResumeOptions): Promise<void>;
  retryPendingCreation(options: CollaborationWorkspaceRetryPendingCreationOptions): Promise<void>;
  useSharedContent(): Promise<void>;
  createInvite(role: "editor" | "reader"): Promise<CollaborationInvitation>;
  retryConnection(): Promise<void>;
  retryPersistence(): Promise<void>;
  flushFileProjection(): Promise<void>;
  retryFileProjection(): Promise<void>;
  reauthenticate(credential: CollaborationWorkspaceCredential): Promise<void>;
  resolveFileConflict(resolution: FileConflictResolution): Promise<void>;
  moveFile(path: string, title?: string): Promise<void>;
  leave(options?: { readonly discardUnprojected?: boolean }): Promise<void>;
  forget(path: string): Promise<boolean>;
  forgetEnrollment(expected: CollaborationEnrollmentRecord): Promise<boolean>;
  forgetPendingCreation(path: string): Promise<boolean>;
  close(options?: { readonly discardUnprojected?: boolean }): Promise<void>;
}

export type CollaborationWorkspaceErrorCode =
  | "workspace-closed"
  | "workspace-busy"
  | "workspace-not-active"
  | "workspace-already-enrolled"
  | "workspace-pending-creation"
  | "workspace-not-enrolled"
  | "pending-creation-not-found"
  | "pending-creation-credential-required"
  | "credential-role-mismatch"
  | "editor-content-mismatch"
  | "file-move-failed"
  | "projection-conflict"
  | "projection-cleanup-failed"
  | "projection-metadata-mismatch"
  | "unsafe-leave";

export class CollaborationWorkspaceError extends Error {
  constructor(
    readonly code: CollaborationWorkspaceErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CollaborationWorkspaceError";
  }
}

interface ActiveSession {
  readonly backend: CollaborationWorkspaceBackend;
  readonly session: CollaborationWorkflowSession;
  readonly file: CollaborationWorkspaceFile;
  enrollment: CollaborationEnrollmentRecord;
  readonly displayName: string;
  readonly userId: string;
  bindingAttached: boolean;
  unsubscribe: Unsubscribe | null;
}

interface PendingCreationRecovery {
  readonly backend: CollaborationWorkspaceBackend;
  readonly session: CollaborationWorkflowSession;
  readonly file: CollaborationWorkspaceFile;
  readonly pendingCreation: CollaborationPendingCreationRecord;
  readonly displayName: string;
  readonly userId: string;
}

function nextFileId(): FileId {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("A cryptographically random UUID source is required for FileId allocation");
  return asFileId(uuid);
}

function publicMessage(cause: unknown, fallback: string): string {
  const code = cause && typeof cause === "object" ? Reflect.get(cause, "code") : undefined;
  const recovery = cause && typeof cause === "object" ? Reflect.get(cause, "recovery") : undefined;
  if (recovery === "join-enrollment-retained") {
    return "The collaboration join was not activated, but its Enrollment was retained without credentials. Resume or forget it from this file.";
  }
  if (recovery === "join-cleanup-pending") {
    return "The collaboration join was not activated. Its Enrollment cleanup is retained for explicit recovery.";
  }
  if (recovery === "join-cleanup-unavailable") {
    return "The collaboration join was not activated, and its local identity cleanup could not be completed safely. Reopen this file and resolve the retained identity before joining again.";
  }
  if (code === "content-mismatch") return "The current Editor and shared document differ. Choose which content to keep.";
  if (code === "unsafe-leave") return "File Projection is not safe to close. Resolve it or explicitly discard unprojected changes.";
  if (code === "authentication-failed") return "The collaboration credential was rejected.";
  if (code === "authorization-revoked") return "Collaboration access was revoked. Supply a fresh credential to continue.";
  if (code === "remote-authority-unavailable") {
    return "This window already opened a local Replica. Close it before joining from an invitation.";
  }
  return fallback;
}

function causeCode(cause: unknown): string | undefined {
  const code = cause && typeof cause === "object" ? Reflect.get(cause, "code") : undefined;
  return typeof code === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(code) ? code : undefined;
}

function flattenFailures(cause: unknown): unknown[] {
  return cause instanceof AggregateError ? [...cause.errors] : [cause];
}

function withCleanupFailures(
  cause: unknown,
  cleanupFailures: readonly unknown[],
  message: string,
  fallbackCode: string,
): unknown {
  if (cleanupFailures.length === 0) return cause;
  return Object.assign(
    new AggregateError([...flattenFailures(cause), ...cleanupFailures], message),
    { code: causeCode(cause) ?? fallbackCode },
  );
}

function roleMatches(access: CollaborationEnrollmentAccess, role: "editor" | "reader"): boolean {
  return access === "reader" ? role === "reader" : role === "editor";
}

function presenceColor(userId: string): string {
  let hash = 0;
  for (const character of userId) hash = ((hash * 31) + character.codePointAt(0)!) >>> 0;
  return ["#2563eb", "#7c3aed", "#0f766e", "#b45309", "#be123c", "#0369a1"][hash % 6]!;
}

function serverPersistence(snapshot?: CollaborationWorkflowSnapshot): CollaborationServerPersistenceState {
  if (!snapshot) return "unverified";
  if (snapshot.collaboration.transport === "offline" || snapshot.collaboration.transport === "failed") {
    return "unavailable";
  }
  return snapshot.collaboration.authentication === "authenticated" && snapshot.collaboration.sync === "synced"
    ? "server-synchronized"
    : "unverified";
}

class CollaborationWorkspaceImpl implements CollaborationWorkspace {
  private listeners = new Set<(snapshot: CollaborationWorkspaceSnapshot) => void>();
  private state: CollaborationWorkspaceSnapshot = {
    phase: "idle",
    attachment: "none",
    serverPersistence: "unverified",
  };
  private active: ActiveSession | null = null;
  private creationRecovery: PendingCreationRecovery | null = null;
  private pending = false;
  private openingTask: Promise<void> | null = null;
  private closingTask: Promise<void> | null = null;
  private reauthenticationTask: Promise<void> | null = null;
  private isClosing = false;
  private isClosed = false;

  constructor(private readonly options: CollaborationWorkspaceOptions) {}

  get closed(): boolean { return this.isClosed; }

  getState(): CollaborationWorkspaceSnapshot { return this.state; }

  subscribe(listener: (snapshot: CollaborationWorkspaceSnapshot) => void): Unsubscribe {
    this.assertOpen();
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  findEnrollment(path: string): Promise<CollaborationEnrollmentRecord | null> {
    this.assertOpen();
    return this.options.enrollments.findByPath(path);
  }

  findPendingCreation(path: string): Promise<CollaborationPendingCreationRecord | null> {
    this.assertOpen();
    return this.options.enrollments.findPendingCreationByPath(path);
  }

  canRetryPendingCreationWithoutCredential(path: string): boolean {
    this.assertOpen();
    return this.creationRecovery?.pendingCreation.path === path;
  }

  async listIncompleteEnrollmentMutations(): Promise<readonly {
    readonly deletion: CollaborationIdentityDeletion;
    readonly projectionState: "present" | "missing";
  }[]> {
    this.assertOpen();
    const recoveries: Array<{
      readonly deletion: CollaborationIdentityDeletion;
      readonly projectionState: "present" | "missing";
    }> = [];
    for (const deletion of await this.options.enrollments.listIdentityDeletions()) {
      const projection = await this.options.projectionMetadata.load(deletion.record.fileId);
      if (projection) this.assertProjectionIdentity(deletion.record, projection);
      recoveries.push({ deletion, projectionState: projection ? "present" : "missing" });
    }
    return recoveries;
  }

  async finishIncompleteEnrollmentMutation(deletion: CollaborationIdentityDeletion): Promise<void> {
    this.assertMutationRecoveryAvailable();
    const current = (await this.options.enrollments.listIdentityDeletions())
      .find((candidate) => candidate.operationId === deletion.operationId);
    if (!current || JSON.stringify(current) !== JSON.stringify(deletion)) {
      throw new CollaborationWorkspaceError(
        "projection-cleanup-failed",
        "The incomplete enrollment cleanup changed before recovery",
      );
    }
    const projection = await this.options.projectionMetadata.load(deletion.record.fileId);
    if (projection) {
      this.assertProjectionIdentity(deletion.record, projection);
      await this.options.projectionMetadata.delete(projection.record, projection.revision);
    }
    await this.options.enrollments.completeForget(deletion);
  }

  async restoreIncompleteEnrollmentMutation(
    deletion: CollaborationIdentityDeletion,
    reservation: CollaborationPathDeletionReservation,
  ): Promise<void> {
    this.assertMutationRecoveryAvailable();
    const projection = await this.options.projectionMetadata.load(deletion.record.fileId);
    if (!projection) {
      throw new CollaborationWorkspaceError(
        "projection-cleanup-failed",
        "Projection Base is missing, so this enrollment cannot be restored safely",
      );
    }
    this.assertProjectionIdentity(deletion.record, projection);
    await this.options.enrollments.restoreForget(deletion, reservation);
  }

  async create(options: CollaborationWorkspaceCreateOptions): Promise<void> {
    this.assertCredential(options.credential, "owner");
    await this.opening("creating", async () => {
      if (await this.options.enrollments.findByPath(options.file.path)) {
        throw new CollaborationWorkspaceError(
          "workspace-already-enrolled",
          "This Markdown file already has a collaboration enrollment",
        );
      }
      if (await this.options.enrollments.findPendingCreationByPath(options.file.path)) {
        throw new CollaborationWorkspaceError(
          "workspace-pending-creation",
          "This Markdown file has a pending remote creation that must be recovered first",
        );
      }
      options.assertContextCurrent?.();
      // Reject an untrusted endpoint before creating any durable recovery intent.
      this.options.backends.assertServerTrusted?.(options.serverUrl);
      const fileId = (this.options.createFileId ?? nextFileId)();
      const pendingCreation = await this.options.enrollments.beginCreation({
        fileId,
        path: options.file.path,
        documentId: options.documentId,
        serverUrl: options.serverUrl,
        access: "owner",
        title: options.file.title,
      });
      let backend: CollaborationWorkspaceBackend | null = null;
      let session: CollaborationWorkflowSession | null = null;
      let committed = false;
      try {
        options.assertContextCurrent?.();
        backend = this.options.backends.create(pendingCreation.serverUrl);
        backend.activateCredential(pendingCreation.documentId, options.credential, "owner");
        session = await backend.workflow.create({
          file: { id: pendingCreation.fileId, path: pendingCreation.path },
          document: {
            id: pendingCreation.documentId,
            hostIdentity: backend.serverUrl,
            sourcePath: pendingCreation.path,
            title: pendingCreation.title,
          },
          initialMarkdown: options.file.markdown,
        });
        options.assertContextCurrent?.();
        const enrollment = await this.options.enrollments.commitCreation(pendingCreation);
        committed = true;
        options.assertContextCurrent?.();
        await this.activate(backend, session, options.file, enrollment, options.displayName, options.credential.userId);
      } catch (cause) {
        if (!committed) {
          if (session && backend) {
            this.creationRecovery = {
              backend,
              session,
              file: options.file,
              pendingCreation,
              displayName: options.displayName,
              userId: options.credential.userId,
            };
            this.exposePendingCreation(pendingCreation, "in-memory");
          } else {
            this.exposePendingCreation(pendingCreation, "credential-required");
            throw await this.rollbackOpening(cause, null, backend);
          }
          throw cause;
        }
        throw await this.rollbackOpening(cause, session, backend);
      }
    });
  }

  async join(options: CollaborationWorkspaceJoinOptions): Promise<void> {
    await this.opening("joining", async () => {
      if (await this.options.enrollments.findByPath(options.file.path)) {
        throw new CollaborationWorkspaceError(
          "workspace-already-enrolled",
          "This Markdown file already has a collaboration enrollment",
        );
      }
      const invitation = this.options.backends.inspectInvitation(options.invitation);
      const backend = this.options.backends.create(invitation.serverUrl);
      const candidateFileId = (this.options.createFileId ?? nextFileId)();
      let enrollmentInput: CollaborationEnrollmentInput = {
        fileId: candidateFileId,
        path: options.file.path,
        documentId: invitation.documentId,
        serverUrl: backend.serverUrl,
        access: invitation.role,
        title: options.file.title,
      };
      let expectedEnrollment: CollaborationEnrollmentRecord = {
        schemaVersion: 1,
        ...enrollmentInput,
      };
      let session: CollaborationWorkflowSession | null = null;
      let transaction: CollaborationWorkspaceJoinTransaction | null = null;
      let transactionCompleted = false;
      try {
        transaction = await this.options.joinTransactions?.begin(enrollmentInput) ?? null;
        if (transaction) {
          const retained = transaction.intent.enrollment;
          enrollmentInput = {
            fileId: retained.fileId,
            path: retained.path,
            documentId: retained.documentId,
            serverUrl: retained.serverUrl,
            access: retained.access,
            title: retained.title,
          };
          expectedEnrollment = retained;
        }
        session = await backend.workflow.join({
          file: { id: enrollmentInput.fileId, path: enrollmentInput.path },
          invitation: options.invitation,
          projectionMode: "enroll",
        });
        options.assertContextCurrent?.();
        const enrollment = transaction
          ? await transaction.commitEnrollment()
          : await this.options.enrollments.upsert(enrollmentInput);
        if (transaction) {
          await transaction.complete();
          transactionCompleted = true;
        }
        options.assertContextCurrent?.();
        await this.activate(backend, session, options.file, enrollment, options.displayName, invitation.userId);
      } catch (cause) {
        if (transaction && !transactionCompleted) {
          // Once the durable join transaction exists, a failed workflow may
          // already have changed the file even when Projection Base save did
          // not finish. Keep its Enrollment intent and Host fence intact for
          // evidence-based startup recovery; ordinary rollback must not turn
          // that file into an unidentifiable orphan.
          throw await this.rollbackOpening(cause, session, backend);
        }
        const rollbackFailure = await this.rollbackJoinOpening(
          cause,
          session,
          backend,
          expectedEnrollment,
        );
        throw rollbackFailure;
      }
    });
  }

  async resume(options: CollaborationWorkspaceResumeOptions): Promise<void> {
    await this.opening("resuming", async () => {
      const enrollment = await this.options.enrollments.findByPath(options.file.path);
      if (!enrollment) {
        throw new CollaborationWorkspaceError(
          "workspace-not-enrolled",
          "This Markdown file has no saved collaboration enrollment",
        );
      }
      this.assertCredential(options.credential, enrollment.access);
      const backend = this.options.backends.create(enrollment.serverUrl);
      backend.activateCredential(enrollment.documentId, options.credential, enrollment.access);
      let session: CollaborationWorkflowSession | null = null;
      try {
        session = await backend.workflow.resume({
          file: { id: enrollment.fileId, path: enrollment.path },
          document: {
            id: enrollment.documentId,
            hostIdentity: backend.serverUrl,
            sourcePath: enrollment.path,
            title: enrollment.title,
          },
          access: enrollment.access,
        });
        options.assertContextCurrent?.();
        await this.activate(
          backend,
          session,
          options.file,
          enrollment,
          options.displayName,
          options.credential.userId,
        );
      } catch (cause) {
        throw await this.rollbackOpening(cause, session, backend);
      }
    });
  }

  async retryPendingCreation(options: CollaborationWorkspaceRetryPendingCreationOptions): Promise<void> {
    if (
      this.creationRecovery &&
      this.creationRecovery.pendingCreation.path !== options.file.path
    ) {
      throw new CollaborationWorkspaceError(
        "workspace-busy",
        "Recover or abandon the retained collaboration creation before opening another file",
      );
    }
    await this.opening("resuming", async () => {
      const retainedForPath = this.creationRecovery?.pendingCreation.path === options.file.path
        ? this.creationRecovery
        : null;
      const pendingCreation = retainedForPath?.pendingCreation
        ?? await this.options.enrollments.findPendingCreationByPath(options.file.path);
      if (!pendingCreation) {
        throw new CollaborationWorkspaceError(
          "pending-creation-not-found",
          "This Markdown file has no pending collaboration creation to recover",
        );
      }
      const retained = retainedForPath?.pendingCreation.fileId === pendingCreation.fileId
        ? retainedForPath
        : null;
      if (retained) {
        let committed = false;
        try {
          options.assertContextCurrent?.();
          const enrollment = await this.options.enrollments.commitCreation(pendingCreation);
          committed = true;
          options.assertContextCurrent?.();
          this.creationRecovery = null;
          await this.activate(
            retained.backend,
            retained.session,
            options.file,
            enrollment,
            retained.displayName,
            retained.userId,
          );
        } catch (cause) {
          if (!committed) {
            this.exposePendingCreation(pendingCreation, "in-memory");
          } else {
            this.creationRecovery = null;
            throw await this.rollbackOpening(cause, retained.session, retained.backend);
          }
          throw cause;
        }
        return;
      }

      const credential = options.credential;
      const displayName = options.displayName?.trim();
      if (!credential || !displayName) {
        throw new CollaborationWorkspaceError(
          "pending-creation-credential-required",
          "Recovering a pending creation after restart requires its owner credential and display name",
        );
      }
      this.assertCredential(credential, pendingCreation.access);
      const backend = this.options.backends.create(pendingCreation.serverUrl);
      backend.activateCredential(pendingCreation.documentId, credential, pendingCreation.access);
      let session: CollaborationWorkflowSession | null = null;
      let committed = false;
      try {
        const document = {
          id: pendingCreation.documentId,
          hostIdentity: backend.serverUrl,
          sourcePath: pendingCreation.path,
          title: pendingCreation.title,
        };
        try {
          session = await backend.workflow.resume({
            file: { id: pendingCreation.fileId, path: pendingCreation.path },
            document,
            access: pendingCreation.access,
            projectionMode: "enroll",
          });
        } catch (cause) {
          if (causeCode(cause) !== "document-not-found") throw cause;
          session = await backend.workflow.create({
            file: { id: pendingCreation.fileId, path: pendingCreation.path },
            document,
            initialMarkdown: options.file.markdown,
          });
        }
        options.assertContextCurrent?.();
        const enrollment = await this.options.enrollments.commitCreation(pendingCreation);
        committed = true;
        options.assertContextCurrent?.();
        await this.activate(
          backend,
          session,
          options.file,
          enrollment,
          displayName,
          credential.userId,
        );
      } catch (cause) {
        if (!committed && session) {
          this.creationRecovery = {
            backend,
            session,
            file: options.file,
            pendingCreation,
            displayName,
            userId: credential.userId,
          };
          this.exposePendingCreation(pendingCreation, "in-memory");
        } else {
          if (!committed) this.exposePendingCreation(pendingCreation, "credential-required");
          throw await this.rollbackOpening(cause, session, backend);
        }
        throw cause;
      }
    }, { allowCreationRecovery: true });
  }

  async useSharedContent(): Promise<void> {
    const active = this.requireActive();
    if (this.state.attachment !== "content-mismatch") {
      throw new CollaborationWorkspaceError(
        "workspace-not-active",
        "There is no Editor content mismatch to resolve",
      );
    }
    await this.attach(active, "replace-editor");
  }

  createInvite(role: "editor" | "reader"): Promise<CollaborationInvitation> {
    return this.requireActive().session.createInvite(role);
  }

  retryConnection(): Promise<void> { return this.requireActive().session.retryConnection(); }

  retryPersistence(): Promise<void> { return this.requireActive().session.retryPersistence(); }

  async flushFileProjection(): Promise<void> {
    const active = this.requireActive();
    if (this.pending || this.state.phase !== "active") {
      throw new CollaborationWorkspaceError("workspace-busy", "The collaboration session is changing state");
    }
    if (!active.bindingAttached || this.state.attachment !== "attached") {
      throw new CollaborationWorkspaceError(
        this.state.attachment === "projection-conflict" ? "projection-conflict" : "editor-content-mismatch",
        "Resolve the current Editor or file conflict before saving the shared Markdown projection",
      );
    }
    await active.session.flushFileProjection();
  }

  retryFileProjection(): Promise<void> { return this.requireActive().session.retryFileProjection(); }

  async reauthenticate(credential: CollaborationWorkspaceCredential): Promise<void> {
    const active = this.requireActive();
    if (this.pending || this.isClosing || this.reauthenticationTask) {
      throw new CollaborationWorkspaceError(
        "workspace-busy",
        "A collaboration credential refresh is already in progress",
      );
    }
    this.assertCredential(credential, active.enrollment.access);
    active.backend.stageReauthentication(
      active.enrollment.documentId,
      credential,
      active.enrollment.access,
    );
    const operation = active.session.reauthenticate();
    this.reauthenticationTask = operation;
    try {
      await operation;
    } finally {
      if (this.reauthenticationTask === operation) this.reauthenticationTask = null;
    }
  }

  async resolveFileConflict(resolution: FileConflictResolution): Promise<void> {
    const active = this.requireActive();
    await active.session.resolveFileConflict(resolution);
    if (!active.bindingAttached) {
      await this.attach(active, resolution.choice === "use-disk" ? "require-match" : "replace-editor");
    }
  }

  async moveFile(path: string, title?: string): Promise<void> {
    this.assertOpen();
    if (!this.active) {
      const pendingCreation = this.state.pendingCreation;
      if (!pendingCreation) {
        throw new CollaborationWorkspaceError("workspace-not-active", "No collaboration session is active");
      }
      const renamedRecord = await this.options.enrollments.rename(pendingCreation, path, title);
      if (renamedRecord.access !== "owner") {
        throw new CollaborationWorkspaceError(
          "file-move-failed",
          "The pending creation identity became invalid while its file was renamed",
        );
      }
      const renamed: CollaborationPendingCreationRecord = {
        ...renamedRecord,
        access: "owner",
      };
      const recovery = this.creationRecovery?.pendingCreation.fileId === renamed.fileId
        ? this.creationRecovery
        : null;
      if (!recovery) {
        this.exposePendingCreation(renamed, "credential-required");
        return;
      }
      this.creationRecovery = { ...recovery, pendingCreation: renamed };
      try {
        await recovery.session.moveFile({ id: renamed.fileId, path: renamed.path });
      } catch (cause) {
        const failure = new CollaborationWorkspaceError(
          "file-move-failed",
          "The pending creation path was saved, but its retained projection could not move. Supply the owner credential to recover it from the new path.",
          cause,
        );
        const cleanupFailures: unknown[] = [];
        await recovery.session.leave({ discardUnprojected: true }).catch((error) => cleanupFailures.push(error));
        await recovery.backend.close().catch((error) => cleanupFailures.push(error));
        this.creationRecovery = null;
        this.exposePendingCreation(renamed, "credential-required");
        if (cleanupFailures.length > 0) {
          throw Object.assign(
            new AggregateError([failure, ...cleanupFailures], "Pending creation move and cleanup failed"),
            { code: failure.code },
          );
        }
        throw failure;
      }
      this.exposePendingCreation(renamed, "in-memory");
      return;
    }
    const active = this.active;
    const enrollment = await this.options.enrollments.rename(active.enrollment, path, title);
    try {
      await active.session.moveFile({ id: enrollment.fileId, path: enrollment.path });
    } catch (cause) {
      // The Host rename has already happened and the durable enrollment now
      // identifies its new path. Continuing an active session against the old
      // projection would create a split-brain file identity, so fail closed.
      active.enrollment = enrollment;
      const failure = new CollaborationWorkspaceError(
        "file-move-failed",
        "The file was renamed, but its collaboration projection could not move. The session was closed; resume it from the new path.",
        cause,
      );
      this.patch({
        attachment: "none",
        enrollment,
        diagnostic: { code: failure.code, message: failure.message },
      });
      let closeFailure: unknown;
      try {
        await active.session.leave({ discardUnprojected: true });
      } catch (leaveCause) {
        closeFailure = leaveCause;
      }
      if (active.session.closed) {
        await this.releaseActive(active, failure);
      } else {
        // If even fail-closed teardown is unavailable, prevent local edits and
        // expose a non-attached state until the user retries Leave.
        active.file.setReadOnly(true);
        this.patch({
          phase: "active",
          attachment: "none",
          enrollment,
          diagnostic: { code: failure.code, message: failure.message },
        });
      }
      if (closeFailure !== undefined) {
        throw Object.assign(
          new AggregateError([failure, closeFailure], "File move and fail-closed collaboration teardown both failed"),
          { code: failure.code },
        );
      }
      throw failure;
    }
    active.enrollment = enrollment;
    this.patch({ enrollment });
  }

  async leave(options: { readonly discardUnprojected?: boolean } = {}): Promise<void> {
    const active = this.requireActive();
    if (this.pending) throw new CollaborationWorkspaceError("workspace-busy", "A collaboration operation is already running");
    if (!options.discardUnprojected && (!active.bindingAttached || this.state.attachment !== "attached")) {
      throw new CollaborationWorkspaceError(
        "unsafe-leave",
        "The current Editor is not reconciled with the shared document; leaving requires an explicit discard",
      );
    }
    this.pending = true;
    this.patch({ phase: "leaving", diagnostic: undefined });
    try {
      await this.reauthenticationTask?.catch(() => undefined);
      await active.session.leave({ discardUnprojected: options.discardUnprojected === true });
    } catch (cause) {
      if (!active.session.closed) {
        this.patch({
          phase: "active",
          diagnostic: {
            code: causeCode(cause) ?? "leave-failed",
            message: publicMessage(cause, "The collaboration session could not be closed safely."),
          },
        });
        throw cause;
      }
      await this.releaseActive(active, cause);
      throw cause;
    } finally {
      this.pending = false;
    }
    await this.releaseActive(active);
  }

  async forget(path: string): Promise<boolean> {
    const enrollment = await this.findForgettableEnrollment(path);
    return enrollment ? this.forgetEnrollment(enrollment) : false;
  }

  async forgetEnrollment(enrollment: CollaborationEnrollmentRecord): Promise<boolean> {
    this.assertOpen();
    if (this.pending || this.isClosing) {
      throw new CollaborationWorkspaceError(
        "workspace-busy",
        "Wait for the active collaboration operation before forgetting an enrollment",
      );
    }
    if (this.active?.enrollment.fileId === enrollment.fileId) {
      throw new CollaborationWorkspaceError(
        "workspace-busy",
        "Leave the active collaboration before forgetting its enrollment",
      );
    }
    return this.forgetWithProjectionBase(
      enrollment,
      () => this.options.enrollments.forget(enrollment),
    );
  }

  private async findForgettableEnrollment(path: string): Promise<CollaborationEnrollmentRecord | null> {
    this.assertOpen();
    if (this.pending || this.isClosing) {
      throw new CollaborationWorkspaceError(
        "workspace-busy",
        "Wait for the active collaboration operation before forgetting an enrollment",
      );
    }
    return this.options.enrollments.findByPath(path);
  }

  async forgetPendingCreation(path: string): Promise<boolean> {
    this.assertOpen();
    if (this.active || this.pending || this.isClosing) {
      throw new CollaborationWorkspaceError(
        "workspace-busy",
        "Wait for the active collaboration operation before abandoning recovery",
      );
    }
    const pendingCreation = await this.options.enrollments.findPendingCreationByPath(path);
    if (!pendingCreation) return false;
    const recovery = this.creationRecovery?.pendingCreation.fileId === pendingCreation.fileId
      ? this.creationRecovery
      : null;
    if (recovery) {
      const failures: unknown[] = [];
      await recovery.session.leave({ discardUnprojected: true }).catch((cause) => failures.push(cause));
      await recovery.backend.close().catch((cause) => failures.push(cause));
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, "Pending collaboration creation cleanup failed");
      }
      this.creationRecovery = null;
    }
    let forgotten: boolean;
    try {
      forgotten = await this.forgetWithProjectionBase(
        pendingCreation,
        () => this.options.enrollments.forgetPendingCreation(pendingCreation),
      );
    } catch (cause) {
      const current = (await this.options.enrollments.listPendingCreations())
        .find((candidate) => candidate.fileId === pendingCreation.fileId);
      if (current) this.exposePendingCreation(current, "credential-required");
      throw cause;
    }
    this.state = {
      phase: "idle",
      attachment: "none",
      serverPersistence: "unverified",
    };
    this.emit();
    return forgotten;
  }

  close(options: { readonly discardUnprojected?: boolean } = {}): Promise<void> {
    if (this.isClosed) return Promise.resolve();
    if (this.closingTask) return this.closingTask;
    this.isClosing = true;
    const closing = (async () => {
      await this.openingTask?.catch(() => undefined);
      if (this.active) await this.leave(options);
      if (this.creationRecovery) {
        const recovery = this.creationRecovery;
        this.creationRecovery = null;
        const failures: unknown[] = [];
        await recovery.session.leave({ discardUnprojected: true }).catch((cause) => failures.push(cause));
        await recovery.backend.close().catch((cause) => failures.push(cause));
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, "Pending collaboration creation cleanup failed");
        }
      }
      this.isClosed = true;
      this.state = { phase: "closed", attachment: "none", serverPersistence: "unverified" };
      this.emit();
      this.listeners.clear();
    })();
    this.closingTask = closing;
    void closing.then(
      () => {
        if (this.closingTask === closing) this.closingTask = null;
      },
      () => {
        if (this.closingTask === closing) this.closingTask = null;
        this.isClosing = false;
      },
    );
    return closing;
  }

  private opening(
    phase: "creating" | "joining" | "resuming",
    operation: () => Promise<void>,
    options: { readonly allowCreationRecovery?: boolean } = {},
  ): Promise<void> {
    this.assertOpen();
    if (
      this.active ||
      this.pending ||
      this.isClosing ||
      (this.creationRecovery && !options.allowCreationRecovery)
    ) {
      throw new CollaborationWorkspaceError("workspace-busy", "A collaboration session is already active or opening");
    }
    this.pending = true;
    this.state = { phase, attachment: "none", serverPersistence: "unverified" };
    this.emit();
    const opening = (async () => {
      try {
        await operation();
      } catch (cause) {
        if (!this.state.pendingCreation) {
          this.state = {
            phase: "failed",
            attachment: "none",
            serverPersistence: "unavailable",
            diagnostic: {
              code: causeCode(cause) ?? "workspace-open-failed",
              message: publicMessage(cause, "The collaboration session could not be opened."),
            },
          };
          this.emit();
        }
        throw cause;
      } finally {
        this.pending = false;
      }
    })();
    this.openingTask = opening;
    return opening.finally(() => {
      if (this.openingTask === opening) this.openingTask = null;
    });
  }

  private async activate(
    backend: CollaborationWorkspaceBackend,
    session: CollaborationWorkflowSession,
    file: CollaborationWorkspaceFile,
    enrollment: CollaborationEnrollmentRecord,
    displayName: string,
    userId: string,
  ): Promise<void> {
    const active: ActiveSession = {
      backend,
      session,
      file,
      enrollment,
      displayName,
      userId,
      bindingAttached: false,
      unsubscribe: null,
    };
    this.active = active;
    try {
      active.unsubscribe = session.subscribe((snapshot) => {
        if (this.active !== active) return;
        const conflict = snapshot.projection.projection === "conflicted" && !active.bindingAttached;
        this.state = {
          ...this.state,
          phase: "active",
          attachment: conflict ? "projection-conflict" : this.state.attachment,
          serverPersistence: serverPersistence(snapshot),
          enrollment: active.enrollment,
          session: snapshot,
          ...(conflict
            ? { diagnostic: { code: "projection-conflict", message: "Choose how to reconcile the shared and local Markdown." } }
            : {}),
        };
        this.emit();
      });
      const snapshot = session.getState();
      this.state = {
        phase: "active",
        attachment: snapshot.projection.projection === "conflicted" ? "projection-conflict" : "none",
        serverPersistence: serverPersistence(snapshot),
        enrollment,
        session: snapshot,
        ...(snapshot.projection.projection === "conflicted"
          ? { diagnostic: { code: "projection-conflict", message: "Choose how to reconcile the shared and local Markdown." } }
          : {}),
      };
      this.emit();
      if (snapshot.projection.projection !== "conflicted") await this.attach(active, "require-match");
    } catch (cause) {
      const cleanupFailures: unknown[] = [];
      try { active.unsubscribe?.(); } catch (cleanupFailure) { cleanupFailures.push(cleanupFailure); }
      active.unsubscribe = null;
      try { active.file.setReadOnly(false); } catch (cleanupFailure) { cleanupFailures.push(cleanupFailure); }
      if (this.active === active) this.active = null;
      throw withCleanupFailures(
        cause,
        cleanupFailures,
        "Collaboration activation and local rollback cleanup failed",
        "workspace-open-failed",
      );
    }
  }

  private async rollbackOpening(
    cause: unknown,
    session: CollaborationWorkflowSession | null,
    backend: CollaborationWorkspaceBackend | null,
  ): Promise<unknown> {
    const cleanupFailures: unknown[] = [];
    await session?.leave({ discardUnprojected: true })
      .catch((cleanupFailure) => cleanupFailures.push(cleanupFailure));
    await backend?.close().catch((cleanupFailure) => cleanupFailures.push(cleanupFailure));
    return withCleanupFailures(
      cause,
      cleanupFailures,
      "Collaboration opening and rollback cleanup failed",
      "workspace-open-failed",
    );
  }

  private async rollbackJoinOpening(
    cause: unknown,
    session: CollaborationWorkflowSession | null,
    backend: CollaborationWorkspaceBackend,
    expectedEnrollment: CollaborationEnrollmentRecord,
  ): Promise<unknown> {
    const cleanupFailures: unknown[] = [];
    let recovery:
      | "join-enrollment-retained"
      | "join-cleanup-pending"
      | "join-cleanup-unavailable"
      | undefined;
    await session?.leave({ discardUnprojected: true })
      .catch((cleanupFailure) => cleanupFailures.push(cleanupFailure));
    await backend.close().catch((cleanupFailure) => cleanupFailures.push(cleanupFailure));
    if (!session || session.closed) {
      try {
        await this.cleanupFailedJoinIdentity(expectedEnrollment);
      } catch (cleanupFailure) {
        cleanupFailures.push(cleanupFailure);
        try {
          const retained = await this.retainFailedJoinIdentity(expectedEnrollment);
          recovery = retained === "enrollment"
            ? "join-enrollment-retained"
            : retained === "deletion"
              ? "join-cleanup-pending"
              : undefined;
        } catch (recoveryFailure) {
          recovery = "join-cleanup-unavailable";
          cleanupFailures.push(new CollaborationWorkspaceError(
            "projection-cleanup-failed",
            "The failed join identity could not be retained for explicit recovery",
            recoveryFailure,
          ));
        }
      }
    } else if (session) {
      try {
        const retained = await this.retainFailedJoinIdentity(expectedEnrollment);
        recovery = retained === "enrollment"
          ? "join-enrollment-retained"
          : retained === "deletion"
            ? "join-cleanup-pending"
            : undefined;
        if (retained) {
          cleanupFailures.push(new CollaborationWorkspaceError(
            "projection-cleanup-failed",
            "The collaboration session did not close, so its exact Enrollment was retained for resume or forget",
          ));
        }
      } catch (recoveryFailure) {
        recovery = "join-cleanup-unavailable";
        cleanupFailures.push(new CollaborationWorkspaceError(
          "projection-cleanup-failed",
          "The collaboration session did not close and its failed join identity could not be retained safely",
          recoveryFailure,
        ));
      }
    }
    const failure = withCleanupFailures(
      cause,
      cleanupFailures,
      "Collaboration join and rollback cleanup failed",
      "projection-cleanup-failed",
    );
    if (recovery && failure && typeof failure === "object") {
      Object.assign(failure, { recovery });
    }
    return failure;
  }

  private async cleanupFailedJoinIdentity(
    expected: CollaborationEnrollmentRecord,
  ): Promise<void> {
    const enrollment = await this.options.enrollments.findByFileId(expected.fileId);
    if (enrollment) {
      this.assertExactEnrollment(expected, enrollment);
      const forgotten = await this.forgetWithProjectionBase(
        expected,
        () => this.options.enrollments.forget(expected),
      );
      if (!forgotten) {
        throw new CollaborationWorkspaceError(
          "projection-cleanup-failed",
          "The failed join Enrollment disappeared before exact cleanup",
        );
      }
      return;
    }

    const projection = await this.options.projectionMetadata.load(expected.fileId);
    this.assertProjectionIdentity(expected, projection);
    if (!projection) return;
    const racedEnrollment = await this.options.enrollments.findByFileId(expected.fileId);
    if (racedEnrollment) {
      this.assertExactEnrollment(expected, racedEnrollment);
      const forgotten = await this.forgetWithProjectionBase(
        expected,
        () => this.options.enrollments.forget(expected),
      );
      if (!forgotten) {
        throw new CollaborationWorkspaceError(
          "projection-cleanup-failed",
          "The failed join Enrollment disappeared before exact cleanup",
        );
      }
      return;
    }
    await this.options.projectionMetadata.delete(projection.record, projection.revision);
  }

  private async retainFailedJoinIdentity(
    expected: CollaborationEnrollmentRecord,
  ): Promise<"enrollment" | "deletion" | null> {
    const deletion = (await this.options.enrollments.listIdentityDeletions())
      .find((candidate) => candidate.record.fileId === expected.fileId);
    if (deletion) {
      this.assertExactEnrollment(expected, deletion.record);
      const projection = await this.options.projectionMetadata.load(expected.fileId);
      this.assertProjectionIdentity(expected, projection);
      return "deletion";
    }

    const current = await this.options.enrollments.findByFileId(expected.fileId);
    if (current) {
      this.assertExactEnrollment(expected, current);
      const projection = await this.options.projectionMetadata.load(expected.fileId);
      this.assertProjectionIdentity(expected, projection);
      return "enrollment";
    }
    const projection = await this.options.projectionMetadata.load(expected.fileId);
    this.assertProjectionIdentity(expected, projection);
    if (!projection) return null;
    const retained = await this.options.enrollments.upsert({
      fileId: expected.fileId,
      path: expected.path,
      documentId: expected.documentId,
      serverUrl: expected.serverUrl,
      access: expected.access,
      title: expected.title,
    });
    this.assertExactEnrollment(expected, retained);
    return "enrollment";
  }

  private assertExactEnrollment(
    expected: CollaborationEnrollmentRecord,
    current: CollaborationEnrollmentRecord,
  ): void {
    if (
      current.schemaVersion !== expected.schemaVersion ||
      current.fileId !== expected.fileId ||
      current.path !== expected.path ||
      current.documentId !== expected.documentId ||
      current.serverUrl !== expected.serverUrl ||
      current.access !== expected.access ||
      current.title !== expected.title
    ) {
      throw new CollaborationWorkspaceError(
        "projection-cleanup-failed",
        "The collaboration enrollment changed before failed join cleanup",
      );
    }
  }

  private async forgetWithProjectionBase(
    identity: CollaborationEnrollmentRecord,
    forgetEnrollment: () => Promise<CollaborationIdentityDeletion | null>,
  ): Promise<boolean> {
    const projection = await this.options.projectionMetadata.load(identity.fileId);
    this.assertProjectionIdentity(identity, projection);
    const deletion = await forgetEnrollment();
    if (!deletion) return false;
    if (projection) {
      try {
        await this.options.projectionMetadata.delete(projection.record, projection.revision);
      } catch (cause) {
        const cleanupFailures: unknown[] = [];
        await this.options.enrollments.restoreForget(deletion)
          .catch((restoreFailure) => cleanupFailures.push(restoreFailure));
        throw withCleanupFailures(
          cause,
          cleanupFailures,
          "Projection Base cleanup and enrollment restoration failed",
          "projection-cleanup-failed",
        );
      }
    }
    await this.options.enrollments.completeForget(deletion);
    return true;
  }

  private assertProjectionIdentity(
    identity: CollaborationEnrollmentRecord,
    projection: ProjectionMetadataEntry | null,
  ): void {
    if (!projection) return;
    if (
      projection.record.file.id !== identity.fileId ||
      projection.record.file.path !== identity.path ||
      projection.record.documentId !== identity.documentId
    ) {
      throw new CollaborationWorkspaceError(
        "projection-metadata-mismatch",
        "Projection metadata no longer matches this collaboration enrollment",
      );
    }
  }

  private async attach(active: ActiveSession, content: "replace-editor" | "require-match"): Promise<void> {
    const surface: CollaborationWorkflowEditor = {
      editor: active.file.editor,
      setReadOnly: (readOnly) => active.file.setReadOnly(readOnly),
    };
    try {
      await active.session.attachEditor(surface, {
        content,
        presence: {
          userId: active.userId,
          name: active.displayName,
          color: presenceColor(active.userId),
        },
      });
      active.bindingAttached = true;
      this.patch({ attachment: "attached", diagnostic: undefined });
    } catch (cause) {
      if (causeCode(cause) !== "content-mismatch") throw cause;
      this.patch({
        attachment: "content-mismatch",
        diagnostic: {
          code: "editor-content-mismatch",
          message: "The current Editor and shared document differ. Choose shared content or leave without replacing it.",
        },
      });
    }
  }

  private async releaseActive(active: ActiveSession, failure?: unknown): Promise<void> {
    if (this.active !== active) return;
    const cleanupFailures: unknown[] = [];
    try { active.unsubscribe?.(); } catch (cause) { cleanupFailures.push(cause); }
    active.unsubscribe = null;
    this.active = null;
    await active.backend.close().catch((cause) => cleanupFailures.push(cause));
    try { active.file.setReadOnly(false); } catch (cause) { cleanupFailures.push(cause); }
    const cleanupFailed = cleanupFailures.length > 0;
    this.state = {
      phase: "idle",
      attachment: "none",
      serverPersistence: "unverified",
      ...(cleanupFailed
        ? {
            diagnostic: {
              code: "backend-cleanup-failed",
              message: "The collaboration session closed, but one or more local resources could not be released cleanly.",
            },
          }
        : failure
          ? {
              diagnostic: {
                code: causeCode(failure) ?? "leave-failed",
                message: failure instanceof CollaborationWorkspaceError
                  ? failure.message
                  : publicMessage(failure, "The collaboration session closed after an operation failed."),
              },
            }
        : {}),
    };
    this.emit();
    if (cleanupFailed) {
      const errors = failure === undefined ? cleanupFailures : [failure, ...cleanupFailures];
      if (errors.length === 1) throw errors[0];
      throw Object.assign(
        new AggregateError(errors, "Collaboration session and backend cleanup failed"),
        { code: causeCode(failure) ?? "backend-cleanup-failed" },
      );
    }
  }

  private patch(patch: Partial<CollaborationWorkspaceSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private exposePendingCreation(
    pendingCreation: CollaborationPendingCreationRecord,
    recovery: "in-memory" | "credential-required",
  ): void {
    this.state = {
      phase: "failed",
      attachment: "none",
      serverPersistence: "unavailable",
      pendingCreation,
      pendingCreationRecovery: recovery,
      diagnostic: {
        code: "enrollment-recovery-required",
        message: recovery === "in-memory"
          ? "The remote document opened, but its local enrollment was not committed. Retry while the owner credential remains in memory."
          : "Remote creation may have completed, but its local enrollment was not committed. Supply the owner credential to recover it.",
      },
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try { listener(this.state); } catch { /* UI observers do not own workspace state. */ }
    }
  }

  private assertCredential(
    credential: CollaborationWorkspaceCredential,
    access: CollaborationEnrollmentAccess,
  ): void {
    if (!credential.token || credential.token.length > 8_192 || !credential.userId.trim()) {
      throw new CollaborationWorkspaceError("credential-role-mismatch", "A bounded credential and user identity are required");
    }
    if (!roleMatches(access, credential.role)) {
      throw new CollaborationWorkspaceError(
        "credential-role-mismatch",
        `A ${access === "reader" ? "reader" : "writer"} credential is required for this enrollment`,
      );
    }
  }

  private requireActive(): ActiveSession {
    this.assertOpen();
    if (!this.active) throw new CollaborationWorkspaceError("workspace-not-active", "No collaboration session is active");
    return this.active;
  }

  private assertOpen(): void {
    if (this.isClosed) throw new CollaborationWorkspaceError("workspace-closed", "Collaboration Workspace is closed");
  }

  private assertMutationRecoveryAvailable(): void {
    this.assertOpen();
    if (this.active || this.pending || this.isClosing) {
      throw new CollaborationWorkspaceError(
        "workspace-busy",
        "Wait for the active collaboration operation before recovering enrollment cleanup",
      );
    }
  }
}

export function createCollaborationWorkspace(options: CollaborationWorkspaceOptions): CollaborationWorkspace {
  return new CollaborationWorkspaceImpl(options);
}
