import type { EditorAPI } from "@floatboat/nexus-core";

import type {
  CollaborativeMarkdownPort,
  FileConflictResolution,
  FileId,
  FileProjectionController,
  FileProjectionHandle,
  FileProjectionRef,
  FileProjectionSnapshot,
  MarkdownFilePolicy,
} from "./file-projection";
import type {
  CollabDocumentRef,
  CollaborationEngine,
  CollaborativeDocumentHandle,
  CollaborativeDocumentSnapshot,
  DocumentId,
  EditorBindingAccess,
  EditorBindingHandle,
  LocalPresence,
  PeerSnapshot,
  Unsubscribe,
} from "./types";

export type CollaborationMembershipRole = "owner" | "editor" | "reader" | "revoked";
export type CollaborationEnrollment =
  | "creating"
  | "joining"
  | "resuming"
  | "active"
  | "leaving"
  | "left"
  | "failed";

export interface CollaborationInvitation {
  /** Opaque, short-lived value for an explicit copy/paste handoff. It is never a navigation URL. */
  readonly value: string;
  readonly role: "editor" | "reader";
  readonly expiresAt?: string;
}

export interface CollaborationInvitationGrant {
  readonly document: CollabDocumentRef;
  readonly access: "editor" | "reader";
}

/** Host-owned invitation and token activation seam. Tokens never enter workflow snapshots. */
export interface CollaborationInvitationAdapter {
  create(input: {
    readonly documentId: DocumentId;
    readonly role: "editor" | "reader";
  }): Promise<CollaborationInvitation>;
  accept(invitation: string): Promise<CollaborationInvitationGrant>;
}

/** Optional Host adapter for Provider reconnect and credential refresh commands. */
export interface CollaborationConnectionAdapter {
  reconnect(documentId: DocumentId): Promise<void>;
  reauthenticate(documentId: DocumentId): Promise<{
    readonly access: "owner" | "editor" | "reader";
  }>;
}

/** Host surface that can enforce read-only before an Editor is bound. */
export interface CollaborationWorkflowEditor {
  readonly editor: EditorAPI;
  setReadOnly(readOnly: boolean): void;
}

export interface CollaborationWorkflowCapabilities {
  readonly canEdit: boolean;
  readonly canInvite: boolean;
  readonly canResolveConflict: boolean;
  readonly canRetryConnection: boolean;
  readonly canReauthenticate: boolean;
  readonly canRetryPersistence: boolean;
  readonly canRetryProjection: boolean;
  readonly canLeave: boolean;
}

export interface CollaborationWorkflowDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly documentId?: DocumentId;
  readonly fileId?: FileId;
  readonly cause?: unknown;
}

export interface CollaborationWorkflowSnapshot {
  readonly enrollment: CollaborationEnrollment;
  readonly access: CollaborationMembershipRole;
  readonly documentId: DocumentId;
  readonly file: FileProjectionRef;
  readonly collaboration: CollaborativeDocumentSnapshot;
  readonly projection: FileProjectionSnapshot;
  readonly peers: readonly PeerSnapshot[];
  readonly capabilities: CollaborationWorkflowCapabilities;
  readonly diagnostic?: CollaborationWorkflowDiagnostic;
}

export interface CollaborationWorkflowCreateOptions {
  readonly file: FileProjectionRef;
  readonly document: CollabDocumentRef;
  readonly initialMarkdown: string;
  readonly projectionPolicy?: MarkdownFilePolicy;
}

export interface CollaborationWorkflowJoinOptions {
  readonly file: FileProjectionRef;
  readonly invitation: string;
  readonly projectionMode?: "enroll" | "resume";
  readonly projectionPolicy?: MarkdownFilePolicy;
}

export interface CollaborationWorkflowResumeOptions {
  readonly file: FileProjectionRef;
  readonly document: CollabDocumentRef;
  readonly access: Exclude<CollaborationMembershipRole, "revoked">;
  /** Defaults to `resume`; use `enroll` when recovering a remote create before local enrollment committed. */
  readonly projectionMode?: "resume" | "enroll";
  readonly projectionPolicy?: MarkdownFilePolicy;
}

export interface CollaborationWorkflowSession {
  readonly closed: boolean;
  getState(): CollaborationWorkflowSnapshot;
  subscribe(listener: (snapshot: CollaborationWorkflowSnapshot) => void): Unsubscribe;
  attachEditor(
    surface: CollaborationWorkflowEditor,
    options?: {
      readonly content?: "replace-editor" | "require-match";
      readonly presence?: LocalPresence;
    },
  ): Promise<EditorBindingHandle>;
  createInvite(role: "editor" | "reader"): Promise<CollaborationInvitation>;
  retryConnection(): Promise<void>;
  reauthenticate(): Promise<void>;
  retryPersistence(): Promise<void>;
  flushFileProjection(): Promise<void>;
  retryFileProjection(): Promise<void>;
  resolveFileConflict(resolution: FileConflictResolution): Promise<void>;
  moveFile(file: FileProjectionRef): Promise<void>;
  leave(options?: { readonly discardUnprojected?: boolean }): Promise<void>;
}

export interface CollaborationWorkflowOptions {
  readonly engine: CollaborationEngine;
  readonly projections: FileProjectionController;
  readonly invitations?: CollaborationInvitationAdapter;
  readonly connections?: CollaborationConnectionAdapter;
  readonly diagnostics?: (diagnostic: CollaborationWorkflowDiagnostic) => void;
}

export interface CollaborationWorkflow {
  create(options: CollaborationWorkflowCreateOptions): Promise<CollaborationWorkflowSession>;
  join(options: CollaborationWorkflowJoinOptions): Promise<CollaborationWorkflowSession>;
  resume(options: CollaborationWorkflowResumeOptions): Promise<CollaborationWorkflowSession>;
  get(fileId: FileId): CollaborationWorkflowSnapshot | undefined;
  list(): readonly CollaborationWorkflowSnapshot[];
  subscribe(listener: (snapshot: CollaborationWorkflowSnapshot) => void): Unsubscribe;
  close(): Promise<void>;
}

export type CollaborationWorkflowErrorCode =
  | "workflow-closed"
  | "session-closed"
  | "session-already-active"
  | "not-authorized"
  | "invitation-unavailable"
  | "connection-control-unavailable"
  | "reauthentication-in-progress"
  | "unsafe-leave"
  | "document-port-unavailable";

export class CollaborationWorkflowError extends Error {
  constructor(
    readonly code: CollaborationWorkflowErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CollaborationWorkflowError";
  }
}

type WorkflowDocumentHandle = CollaborativeDocumentHandle & CollaborativeMarkdownPort;

interface WorkflowBinding {
  handle: EditorBindingHandle;
  readonly surface: CollaborationWorkflowEditor;
  readonly content: "replace-editor" | "require-match";
  readonly presence?: LocalPresence;
  suspended: boolean;
}

interface ProjectionAuthorization {
  canApplyToDocument: boolean;
}

function membershipBindingAccess(access: CollaborationMembershipRole): EditorBindingAccess {
  return access === "owner" || access === "editor" ? "read-write" : "read-only";
}

function requiresReauthentication(
  authentication: CollaborativeDocumentSnapshot["authentication"],
): boolean {
  return authentication === "denied" ||
    authentication === "expired" ||
    authentication === "failed" ||
    authentication === "revoked";
}

function stableFailureCode(cause: unknown, fallback: string): string {
  const code = cause && typeof cause === "object" ? Reflect.get(cause, "code") : undefined;
  return typeof code === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(code)
    ? code
    : fallback;
}

function openingRollbackFailure(
  cause: unknown,
  cleanupFailures: readonly unknown[],
): unknown {
  if (cleanupFailures.length === 0) return cause;
  return Object.assign(
    new AggregateError(
      [cause, ...cleanupFailures],
      "Collaboration opening and rollback cleanup failed",
    ),
    { code: stableFailureCode(cause, "workflow-open-failed") },
  );
}

function bindingAttachRollbackFailure(
  cause: unknown,
  cleanupFailures: readonly unknown[],
): unknown {
  if (cleanupFailures.length === 0) return cause;
  return Object.assign(
    new AggregateError(
      [cause, ...cleanupFailures],
      "Editor binding attachment and rollback cleanup failed",
    ),
    { code: stableFailureCode(cause, "binding-attach-failed") },
  );
}

function reauthenticationRollbackFailure(
  cause: unknown,
  cleanupFailures: readonly unknown[],
): unknown {
  if (cleanupFailures.length === 0) return cause;
  return Object.assign(
    new AggregateError(
      [cause, ...cleanupFailures],
      "Collaboration reauthentication and binding rollback cleanup failed",
    ),
    { code: stableFailureCode(cause, "reauthentication-resume-failed") },
  );
}

function requireProjectionPort(handle: CollaborativeDocumentHandle): WorkflowDocumentHandle {
  const candidate = handle as Partial<WorkflowDocumentHandle>;
  if (
    typeof candidate.getMarkdownSnapshot !== "function" ||
    typeof candidate.replaceMarkdown !== "function" ||
    typeof candidate.subscribeMarkdown !== "function"
  ) {
    throw new CollaborationWorkflowError(
      "document-port-unavailable",
      "The Collaboration Engine handle does not expose the Markdown File Projection port",
    );
  }
  return handle as WorkflowDocumentHandle;
}

class WorkflowSession implements CollaborationWorkflowSession {
  private listeners = new Set<(snapshot: CollaborationWorkflowSnapshot) => void>();
  private bindings = new Set<WorkflowBinding>();
  private pendingBindingAttachments = new Set<Promise<EditorBindingHandle>>();
  private stopDocument: Unsubscribe | null = null;
  private stopProjection: Unsubscribe | null = null;
  private leaving: Promise<void> | null = null;
  private suspendingBindings: Promise<void> | null = null;
  private reauthenticating: Promise<void> | null = null;
  private leaveRequested = false;
  private authorizationGeneration = 0;
  private isClosed = false;
  private enrollment: CollaborationEnrollment = "active";
  private access: CollaborationMembershipRole;
  private collaboration: CollaborativeDocumentSnapshot;
  private projection: FileProjectionSnapshot;
  private file: FileProjectionRef;
  private diagnostic: CollaborationWorkflowDiagnostic | undefined;

  constructor(
    private readonly owner: CollaborationWorkflowImpl,
    private readonly document: WorkflowDocumentHandle,
    private readonly fileProjection: FileProjectionHandle,
    file: FileProjectionRef,
    access: CollaborationMembershipRole,
    private readonly projectionAuthorization: ProjectionAuthorization,
  ) {
    this.file = file;
    this.access = access;
    this.collaboration = document.getState();
    this.projection = fileProjection.getState();
    this.stopDocument = document.subscribe((snapshot) => this.onDocumentState(snapshot));
    this.stopProjection = fileProjection.subscribe((snapshot) => {
      this.projection = snapshot;
      this.file = snapshot.file;
      this.emit();
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  getState(): CollaborationWorkflowSnapshot {
    return {
      enrollment: this.enrollment,
      access: this.access,
      documentId: this.document.id,
      file: this.file,
      collaboration: this.collaboration,
      projection: this.projection,
      peers: this.collaboration.peers,
      capabilities: this.capabilities(),
      ...(this.diagnostic ? { diagnostic: this.diagnostic } : {}),
    };
  }

  subscribe(listener: (snapshot: CollaborationWorkflowSnapshot) => void): Unsubscribe {
    this.assertOpen();
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async attachEditor(
    surface: CollaborationWorkflowEditor,
    options: {
      readonly content?: "replace-editor" | "require-match";
      readonly presence?: LocalPresence;
    } = {},
  ): Promise<EditorBindingHandle> {
    this.assertOpen();
    if (
      this.access === "revoked" ||
      this.suspendingBindings !== null ||
      this.reauthenticating !== null ||
      this.authenticationUnavailable()
    ) {
      throw new CollaborationWorkflowError(
        "not-authorized",
        "Reauthenticate before attaching another Editor",
      );
    }
    const readOnly = !this.capabilities().canEdit;
    surface.setReadOnly(readOnly);
    const content = options.content ?? "require-match";
    const authorizationGeneration = this.authorizationGeneration;
    const operation = (async () => {
      let handle: EditorBindingHandle | null = null;
      try {
        handle = await this.document.attach(surface.editor, {
          content,
          access: membershipBindingAccess(this.access),
        });
        this.assertAuthorizationGeneration(authorizationGeneration);
        if (options.presence) handle.setPresence(options.presence);
        this.assertAuthorizationGeneration(authorizationGeneration);
        this.bindings.add({
          handle,
          surface,
          content,
          ...(options.presence ? { presence: options.presence } : {}),
          suspended: false,
        });
        this.emit();
        return handle;
      } catch (cause) {
        const cleanupFailures: unknown[] = [];
        await handle?.detach().catch((cause) => cleanupFailures.push(cause));
        try {
          surface.setReadOnly(false);
        } catch (cleanupFailure) {
          cleanupFailures.push(cleanupFailure);
        }
        throw bindingAttachRollbackFailure(cause, cleanupFailures);
      }
    })();
    this.pendingBindingAttachments.add(operation);
    try {
      return await operation;
    } finally {
      this.pendingBindingAttachments.delete(operation);
    }
  }

  async createInvite(role: "editor" | "reader"): Promise<CollaborationInvitation> {
    this.assertOpen();
    if (!this.capabilities().canInvite) {
      throw new CollaborationWorkflowError("not-authorized", "Only the collaboration owner can invite members");
    }
    const invitations = this.owner.options.invitations;
    if (!invitations) {
      throw new CollaborationWorkflowError("invitation-unavailable", "This Host has no invitation adapter");
    }
    return invitations.create({ documentId: this.document.id, role });
  }

  async retryConnection(): Promise<void> {
    this.assertOpen();
    if (!this.capabilities().canRetryConnection) {
      throw new CollaborationWorkflowError("not-authorized", "The current connection state is not retryable");
    }
    const connections = this.owner.options.connections;
    if (!connections) {
      throw new CollaborationWorkflowError(
        "connection-control-unavailable",
        "This Host has no connection control adapter",
      );
    }
    await connections.reconnect(this.document.id);
  }

  async reauthenticate(): Promise<void> {
    this.assertOpen();
    if (this.leaving) {
      throw new CollaborationWorkflowError(
        "session-closed",
        "Collaboration session is leaving",
      );
    }
    if (this.reauthenticating) {
      throw new CollaborationWorkflowError(
        "reauthentication-in-progress",
        "Collaboration reauthentication is already in progress",
      );
    }
    if (!this.capabilities().canReauthenticate) {
      throw new CollaborationWorkflowError("not-authorized", "Reauthentication is not currently required");
    }
    const connections = this.owner.options.connections;
    if (!connections) {
      throw new CollaborationWorkflowError(
        "connection-control-unavailable",
        "This Host has no connection control adapter",
      );
    }
    const operation = this.performReauthentication(connections);
    this.reauthenticating = operation;
    try {
      await operation;
    } finally {
      if (this.reauthenticating === operation) this.reauthenticating = null;
    }
  }

  private async performReauthentication(connections: CollaborationConnectionAdapter): Promise<void> {
    await this.suspendingBindings;
    const grant = await connections.reauthenticate(this.document.id);
    this.assertOpen();
    if (this.providerAuthenticationUnavailable()) {
      throw new CollaborationWorkflowError(
        "not-authorized",
        "Authentication became unavailable while refreshing credentials",
      );
    }
    const authorizationGeneration = this.authorizationGeneration;
    this.access = grant.access;
    this.refreshProjectionAuthorization();
    this.diagnostic = undefined;
    const resumed: Array<{ binding: WorkflowBinding; handle: EditorBindingHandle }> = [];
    try {
      for (const binding of this.bindings) {
        binding.surface.setReadOnly(!this.capabilities().canEdit);
        const handle = await this.document.attach(binding.surface.editor, {
          content: "require-match",
          access: membershipBindingAccess(this.access),
        });
        resumed.push({ binding, handle });
        this.assertAuthorizationGeneration(authorizationGeneration);
        if (binding.presence) handle.setPresence(binding.presence);
        this.assertAuthorizationGeneration(authorizationGeneration);
      }
      this.assertAuthorizationGeneration(authorizationGeneration);
      for (const candidate of resumed) {
        candidate.binding.handle = candidate.handle;
        candidate.binding.suspended = false;
      }
    } catch (cause) {
      const cleanupFailures: unknown[] = [];
      const detachResults = await Promise.allSettled(
        resumed.map(({ handle }) => handle.detach()),
      );
      for (const result of detachResults) {
        if (result.status === "rejected") cleanupFailures.push(result.reason);
      }
      for (const binding of this.bindings) {
        binding.suspended = true;
        try {
          binding.surface.setReadOnly(true);
        } catch (cleanupFailure) {
          cleanupFailures.push(cleanupFailure);
        }
      }
      this.access = "revoked";
      this.refreshProjectionAuthorization();
      const failure = reauthenticationRollbackFailure(cause, cleanupFailures);
      this.diagnostic = {
        code: "reauthentication-resume-failed",
        message: "Credentials were refreshed but Editor bindings could not safely resume",
        documentId: this.document.id,
        fileId: this.file.id,
        cause: failure,
      };
      this.suspendingBindings = null;
      this.emit();
      throw failure;
    }
    this.suspendingBindings = null;
    this.emit();
  }

  async retryPersistence(): Promise<void> {
    this.assertOpen();
    if (!this.capabilities().canRetryPersistence) {
      throw new CollaborationWorkflowError(
        "not-authorized",
        "The current durable persistence state is not retryable",
      );
    }
    await this.document.reconcilePersistence();
  }

  async resolveFileConflict(resolution: FileConflictResolution): Promise<void> {
    this.assertOpen();
    if (!this.capabilities().canResolveConflict) {
      throw new CollaborationWorkflowError("not-authorized", "There is no active File Conflict to resolve");
    }
    if (resolution.choice !== "use-live" && !this.capabilities().canEdit) {
      throw new CollaborationWorkflowError(
        "not-authorized",
        "This participant cannot replace the collaborative document from a Markdown file",
      );
    }
    await this.fileProjection.resolve(resolution);
  }

  async retryFileProjection(): Promise<void> {
    this.assertOpen();
    if (!this.capabilities().canRetryProjection) {
      throw new CollaborationWorkflowError(
        "not-authorized",
        "The current File Projection state is not retryable",
      );
    }
    await this.fileProjection.flush();
  }

  async flushFileProjection(): Promise<void> {
    this.assertOpen();
    await this.fileProjection.flush();
  }

  async moveFile(file: FileProjectionRef): Promise<void> {
    this.assertOpen();
    await this.fileProjection.move(file);
  }

  leave(options: { readonly discardUnprojected?: boolean } = {}): Promise<void> {
    if (this.leaving) return this.leaving;
    this.leaveRequested = true;
    const leaving = this.performLeave(options);
    this.leaving = leaving;
    void leaving.catch(() => {
      if (this.leaving === leaving) {
        this.leaving = null;
        this.leaveRequested = false;
      }
    });
    return leaving;
  }

  private async performLeave(options: { readonly discardUnprojected?: boolean }): Promise<void> {
    if (this.isClosed) return;
    const discardUnprojected = options.discardUnprojected === true;
    const initialProjection = this.fileProjection.getState().projection;
    if (!discardUnprojected && initialProjection !== "clean" && initialProjection !== "dirty") {
      throw this.unsafeLeaveError(initialProjection);
    }

    this.enrollment = "leaving";
    this.refreshProjectionAuthorization();
    const failures: unknown[] = [];
    for (const binding of this.bindings) {
      try {
        binding.surface.setReadOnly(true);
      } catch (cause) {
        failures.push(cause);
      }
    }
    this.emit();
    if (discardUnprojected) this.isClosed = true;
    let projectionClose: Promise<void> | null = null;

    try {
      await Promise.allSettled([...this.pendingBindingAttachments]);
      await this.reauthenticating?.catch(() => undefined);
      await this.suspendingBindings?.catch((cause) => { failures.push(cause); });
      if (!discardUnprojected) {
        if (failures.length > 0) {
          throw Object.assign(
            new AggregateError(failures, "Collaboration leave could not establish an Editor fence"),
            { code: "unsafe-leave" },
          );
        }
        await this.fileProjection.settle();
        if (this.fileProjection.getState().projection === "dirty") {
          await this.fileProjection.flush();
        }
        const projection = this.fileProjection.getState().projection;
        if (projection !== "clean") throw this.unsafeLeaveError(projection);
        // `close()` synchronously stops the document and file watchers before
        // its first await. Keeping this call adjacent to the final clean check
        // makes that subscription cutoff the linearization point for Leave:
        // no remote update can slip between validation and observation stop.
        projectionClose = this.fileProjection.close();
        void projectionClose.catch(() => undefined);
        this.isClosed = true;
      }
    } catch (cause) {
      if (!this.isClosed) {
        const restoreFailures = this.restoreAfterFailedLeave();
        throw bindingAttachRollbackFailure(cause, restoreFailures);
      }
      throw cause;
    }

    if (!projectionClose) {
      projectionClose = this.fileProjection.close();
      void projectionClose.catch(() => undefined);
    }

    const stopDocument = this.stopDocument;
    this.stopDocument = null;
    if (stopDocument) {
      try {
        stopDocument();
      } catch (cause) {
        failures.push(cause);
      }
    }
    const stopProjection = this.stopProjection;
    this.stopProjection = null;
    if (stopProjection) {
      try {
        stopProjection();
      } catch (cause) {
        failures.push(cause);
      }
    }
    for (const binding of [...this.bindings]) {
      try {
        await binding.handle.detach();
      } catch (cause) {
        failures.push(cause);
      }
      try {
        binding.surface.setReadOnly(false);
      } catch (cause) {
        failures.push(cause);
      }
    }
    this.bindings.clear();
    await projectionClose.catch((cause) => { failures.push(cause); });
    await this.document.close().catch((cause) => { failures.push(cause); });
    this.enrollment = "left";
    this.emit();
    this.listeners.clear();
    this.owner.release(this.file.id, this.document.id, this);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Collaboration session cleanup failed");
  }

  private unsafeLeaveError(projection: FileProjectionSnapshot["projection"]): CollaborationWorkflowError {
    return new CollaborationWorkflowError(
      "unsafe-leave",
      `Cannot leave while File Projection is ${projection}; resolve it or explicitly discard unprojected changes`,
    );
  }

  private restoreAfterFailedLeave(): unknown[] {
    this.enrollment = "active";
    this.refreshProjectionAuthorization();
    const failures: unknown[] = [];
    const readOnly = !this.capabilities().canEdit;
    for (const binding of this.bindings) {
      try {
        binding.surface.setReadOnly(readOnly);
      } catch (cause) {
        failures.push(cause);
      }
    }
    this.emit();
    return failures;
  }

  private onDocumentState(snapshot: CollaborativeDocumentSnapshot): void {
    if (this.authorizationStateKey(snapshot) !== this.authorizationStateKey(this.collaboration)) {
      this.authorizationGeneration++;
    }
    this.collaboration = snapshot;
    const revoked = snapshot.authentication === "revoked" ||
      snapshot.diagnostic?.code === "authorization-revoked";
    const authenticationUnavailable = revoked || requiresReauthentication(snapshot.authentication);
    if (revoked && this.access !== "revoked") {
      this.access = "revoked";
    }
    if (authenticationUnavailable && this.suspendingBindings === null) {
      this.diagnostic = {
        code: snapshot.diagnostic?.code ?? "authentication-failed",
        message: snapshot.diagnostic?.message ?? "Collaboration authentication is unavailable",
        documentId: this.document.id,
        fileId: this.file.id,
      };
      this.suspendingBindings = this.suspendBindings();
    }
    this.refreshProjectionAuthorization();
    const readOnly = !this.capabilities().canEdit;
    for (const binding of this.bindings) binding.surface.setReadOnly(readOnly);
    this.emit();
  }

  private capabilities(): CollaborationWorkflowCapabilities {
    const active = this.enrollment === "active" && !this.isClosed;
    const authenticationUnavailable = this.access === "revoked" ||
      requiresReauthentication(this.collaboration.authentication);
    const providerAllowsWrite = this.collaboration.access === "read-write" ||
      this.collaboration.access === "local-only";
    return {
      canEdit: active && providerAllowsWrite && (this.access === "owner" || this.access === "editor"),
      canInvite: active && providerAllowsWrite && this.access === "owner" && Boolean(this.owner.options.invitations),
      canResolveConflict: active && this.projection.projection === "conflicted",
      canRetryConnection: active && !authenticationUnavailable && (
        this.collaboration.transport === "offline" ||
        this.collaboration.transport === "failed" ||
        this.collaboration.sync === "stale" ||
        this.collaboration.sync === "failed"
      ),
      canReauthenticate: active && (
        this.access === "revoked" ||
        this.collaboration.authentication === "denied" ||
        this.collaboration.authentication === "expired" ||
        this.collaboration.authentication === "failed" ||
        this.collaboration.authentication === "revoked"
      ),
      canRetryPersistence: active && this.collaboration.persistence === "failed",
      canRetryProjection: active && (
        this.projection.projection === "failed" || this.projection.projection === "missing"
      ),
      canLeave: active,
    };
  }

  private refreshProjectionAuthorization(): void {
    this.projectionAuthorization.canApplyToDocument = this.capabilities().canEdit;
  }

  private authenticationUnavailable(): boolean {
    return this.access === "revoked" || this.providerAuthenticationUnavailable();
  }

  private providerAuthenticationUnavailable(): boolean {
    return this.collaboration.diagnostic?.code === "authorization-revoked" ||
      requiresReauthentication(this.collaboration.authentication);
  }

  private authorizationStateKey(snapshot: CollaborativeDocumentSnapshot): string {
    return [
      snapshot.authentication,
      snapshot.access,
      snapshot.diagnostic?.code === "authorization-revoked" ? "revoked" : "available",
    ].join(":");
  }

  private assertAuthorizationGeneration(generation: number): void {
    this.assertOpen();
    if (generation !== this.authorizationGeneration || this.authenticationUnavailable()) {
      throw new CollaborationWorkflowError(
        "not-authorized",
        "Collaboration authorization changed while attaching the Editor",
      );
    }
  }

  private async suspendBindings(): Promise<void> {
    await Promise.all([...this.bindings].map(async (binding) => {
      if (binding.suspended) return;
      binding.suspended = true;
      try {
        await binding.handle.detach();
      } catch (cause) {
        const diagnostic = {
          code: "binding-suspend-failed",
          message: "An Editor binding could not be detached after authorization was revoked",
          documentId: this.document.id,
          fileId: this.file.id,
          cause,
        } satisfies CollaborationWorkflowDiagnostic;
        this.diagnostic = diagnostic;
        this.owner.reportDiagnostic(diagnostic);
      }
    }));
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch {
        // Product observers do not own workflow lifecycle.
      }
    }
    this.owner.emit(snapshot);
  }

  private assertOpen(): void {
    if (this.isClosed || this.leaveRequested) {
      throw new CollaborationWorkflowError("session-closed", "Collaboration session is closed");
    }
  }
}

class CollaborationWorkflowImpl implements CollaborationWorkflow {
  readonly listeners = new Set<(snapshot: CollaborationWorkflowSnapshot) => void>();
  readonly sessionsByFile = new Map<FileId, WorkflowSession>();
  readonly sessionsByDocument = new Map<DocumentId, WorkflowSession>();
  private readonly openingFiles = new Set<FileId>();
  private readonly openingDocuments = new Set<DocumentId>();
  private readonly pendingOpenings = new Set<Promise<void>>();
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(readonly options: CollaborationWorkflowOptions) {}

  async create(options: CollaborationWorkflowCreateOptions): Promise<CollaborationWorkflowSession> {
    this.reserve(options.file.id, options.document.id);
    const finishOpening = this.beginOpening();
    try {
      const document = await this.openProjectionPort(() => this.options.engine.create(options.document, {
        initialMarkdown: options.initialMarkdown,
      }));
      return await this.finishOpen(document, options.file, "owner", "enroll", options.projectionPolicy);
    } finally {
      this.releaseReservation(options.file.id, options.document.id);
      finishOpening();
    }
  }

  async join(options: CollaborationWorkflowJoinOptions): Promise<CollaborationWorkflowSession> {
    if (this.closed) throw new CollaborationWorkflowError("workflow-closed", "Collaboration workflow is closed");
    const invitations = this.options.invitations;
    if (!invitations) {
      throw new CollaborationWorkflowError("invitation-unavailable", "This Host has no invitation adapter");
    }
    this.reserveFile(options.file.id);
    const finishOpening = this.beginOpening();
    let documentId: DocumentId | undefined;
    let documentReserved = false;
    try {
      const grant = await invitations.accept(options.invitation);
      documentId = grant.document.id;
      this.reserveDocument(documentId);
      documentReserved = true;
      const document = await this.openProjectionPort(() => this.options.engine.open(grant.document, {
        readiness: "require-authenticated-sync",
      }));
      return await this.finishOpen(
        document,
        options.file,
        grant.access,
        options.projectionMode ?? "enroll",
        options.projectionPolicy,
      );
    } finally {
      this.openingFiles.delete(options.file.id);
      if (documentReserved && documentId) this.openingDocuments.delete(documentId);
      finishOpening();
    }
  }

  async resume(options: CollaborationWorkflowResumeOptions): Promise<CollaborationWorkflowSession> {
    this.reserve(options.file.id, options.document.id);
    const finishOpening = this.beginOpening();
    try {
      const document = await this.openProjectionPort(() => this.options.engine.open(options.document, {
        readiness: "allow-local-authority",
      }));
      return await this.finishOpen(
        document,
        options.file,
        options.access,
        options.projectionMode ?? "resume",
        options.projectionPolicy,
      );
    } finally {
      this.releaseReservation(options.file.id, options.document.id);
      finishOpening();
    }
  }

  get(fileId: FileId): CollaborationWorkflowSnapshot | undefined {
    return this.sessionsByFile.get(fileId)?.getState();
  }

  list(): readonly CollaborationWorkflowSnapshot[] {
    return [...this.sessionsByFile.values()].map((session) => session.getState());
  }

  subscribe(listener: (snapshot: CollaborationWorkflowSnapshot) => void): Unsubscribe {
    if (this.closed) throw new CollaborationWorkflowError("workflow-closed", "Collaboration workflow is closed");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(snapshot: CollaborationWorkflowSnapshot): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (cause) {
        this.report({
          code: "workflow-listener-failed",
          message: "A collaboration workflow listener failed",
          documentId: snapshot.documentId,
          fileId: snapshot.file.id,
          cause,
        });
      }
    }
  }

  reportDiagnostic(diagnostic: CollaborationWorkflowDiagnostic): void {
    this.report(diagnostic);
  }

  release(fileId: FileId, documentId: DocumentId, session: WorkflowSession): void {
    if (this.sessionsByFile.get(fileId) === session) this.sessionsByFile.delete(fileId);
    if (this.sessionsByDocument.get(documentId) === session) this.sessionsByDocument.delete(documentId);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const operation = this.performClose();
    this.closePromise = operation;
    return operation;
  }

  private async performClose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([...this.pendingOpenings]);
    const sessions = [...this.sessionsByFile.values()];
    const results = await Promise.allSettled(
      sessions.map((session) => session.leave({ discardUnprojected: true })),
    );
    this.listeners.clear();
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Collaboration workflow cleanup failed");
  }

  private async finishOpen(
    document: WorkflowDocumentHandle,
    file: FileProjectionRef,
    access: CollaborationMembershipRole,
    mode: "enroll" | "resume",
    policy?: MarkdownFilePolicy,
  ): Promise<CollaborationWorkflowSession> {
    let projection: FileProjectionHandle | null = null;
    try {
      if (this.closed) throw new CollaborationWorkflowError("workflow-closed", "Collaboration workflow is closed");
      await document.whenReady();
      if (this.closed) throw new CollaborationWorkflowError("workflow-closed", "Collaboration workflow is closed");
      const collaboration = document.getState();
      const projectionAuthorization: ProjectionAuthorization = {
        canApplyToDocument: (
          access === "owner" || access === "editor"
        ) && (
          collaboration.access === "read-write" || collaboration.access === "local-only"
        ),
      };
      projection = await this.options.projections.attach({
        mode,
        file,
        document,
        canApplyToDocument: () => projectionAuthorization.canApplyToDocument,
        ...(policy ? { policy } : {}),
      });
      if (this.closed) throw new CollaborationWorkflowError("workflow-closed", "Collaboration workflow is closed");
      const session = new WorkflowSession(
        this,
        document,
        projection,
        file,
        access,
        projectionAuthorization,
      );
      this.sessionsByFile.set(file.id, session);
      this.sessionsByDocument.set(document.id, session);
      this.emit(session.getState());
      return session;
    } catch (cause) {
      const cleanupFailures: unknown[] = [];
      await projection?.close().catch((cleanupFailure) => cleanupFailures.push(cleanupFailure));
      await document.close().catch((cleanupFailure) => cleanupFailures.push(cleanupFailure));
      throw openingRollbackFailure(cause, cleanupFailures);
    }
  }

  private assertAvailable(fileId: FileId, documentId: DocumentId): void {
    if (this.closed) throw new CollaborationWorkflowError("workflow-closed", "Collaboration workflow is closed");
    if (
      this.sessionsByFile.has(fileId) ||
      this.sessionsByDocument.has(documentId) ||
      this.openingFiles.has(fileId) ||
      this.openingDocuments.has(documentId)
    ) {
      throw new CollaborationWorkflowError(
        "session-already-active",
        "The file or Collaborative Document already has an active product session",
      );
    }
  }

  private reserve(fileId: FileId, documentId: DocumentId): void {
    this.assertAvailable(fileId, documentId);
    this.openingFiles.add(fileId);
    this.openingDocuments.add(documentId);
  }

  private reserveFile(fileId: FileId): void {
    if (this.closed) throw new CollaborationWorkflowError("workflow-closed", "Collaboration workflow is closed");
    if (this.sessionsByFile.has(fileId) || this.openingFiles.has(fileId)) {
      throw new CollaborationWorkflowError("session-already-active", "The file already has an active product session");
    }
    this.openingFiles.add(fileId);
  }

  private reserveDocument(documentId: DocumentId): void {
    if (this.closed) throw new CollaborationWorkflowError("workflow-closed", "Collaboration workflow is closed");
    if (this.sessionsByDocument.has(documentId) || this.openingDocuments.has(documentId)) {
      throw new CollaborationWorkflowError(
        "session-already-active",
        "The Collaborative Document already has an active product session",
      );
    }
    this.openingDocuments.add(documentId);
  }

  private releaseReservation(fileId: FileId, documentId: DocumentId): void {
    this.openingFiles.delete(fileId);
    this.openingDocuments.delete(documentId);
  }

  private beginOpening(): () => void {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    this.pendingOpenings.add(pending);
    return () => {
      this.pendingOpenings.delete(pending);
      finish();
    };
  }

  private async openProjectionPort(
    open: () => Promise<CollaborativeDocumentHandle>,
  ): Promise<WorkflowDocumentHandle> {
    const raw = await open();
    try {
      return requireProjectionPort(raw);
    } catch (cause) {
      const cleanupFailures: unknown[] = [];
      await raw.close().catch((cleanupFailure) => cleanupFailures.push(cleanupFailure));
      throw openingRollbackFailure(cause, cleanupFailures);
    }
  }

  private report(diagnostic: CollaborationWorkflowDiagnostic): void {
    try {
      this.options.diagnostics?.(diagnostic);
    } catch {
      // Diagnostic observers are isolated from workflow behavior.
    }
  }
}

export function createCollaborationWorkflow(
  options: CollaborationWorkflowOptions,
): CollaborationWorkflow {
  return new CollaborationWorkflowImpl(options);
}
