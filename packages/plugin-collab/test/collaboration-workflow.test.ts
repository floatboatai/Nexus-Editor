import type { EditorAPI } from "@floatboat/nexus-core";
import { describe, expect, it, vi } from "vitest";

import {
  createCollaborationWorkflow,
  type CollaborationInvitationAdapter,
  type CollaborationWorkflowEditor,
} from "../src/collaboration-workflow";
import {
  asFileId,
  type FileProjectionAttachOptions,
  type FileConflictResolution,
  type FileProjectionController,
  type FileProjectionHandle,
  type FileProjectionSnapshot,
} from "../src/file-projection";
import {
  CollaborationError,
  asDocumentId,
  type CollabDocumentRef,
  type CollaborationEngine,
  type CollaborationOpenOptions,
  type CollaborativeDocumentHandle,
  type CollaborativeDocumentSnapshot,
  type EditorBindingHandle,
  type LocalPresence,
} from "../src/types";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function documentState(id: ReturnType<typeof asDocumentId>): CollaborativeDocumentSnapshot {
  return {
    id,
    lifecycle: "open",
    transport: "online",
    sync: "synced",
    authentication: "authenticated",
    access: "read-write",
    persistence: "clean",
    consistency: "healthy",
    peers: [],
    bindings: 0,
  };
}

class FakeDocument implements CollaborativeDocumentHandle {
  closed = false;
  closeError: Error | null = null;
  subscribeError: Error | null = null;
  unsubscribeError: Error | null = null;
  markdownRevision = 1;
  state: CollaborativeDocumentSnapshot;
  listeners = new Set<(snapshot: CollaborativeDocumentSnapshot) => void>();
  bindings: EditorBindingHandle[] = [];
  attachedContentModes: Array<"replace-editor" | "require-match"> = [];
  attachedAccessModes: Array<"read-only" | "read-write" | undefined> = [];
  persistenceReconciliations = 0;
  attachOverride: (() => Promise<EditorBindingHandle>) | null = null;

  constructor(
    readonly id: ReturnType<typeof asDocumentId>,
    private markdown: string,
  ) {
    this.state = documentState(id);
  }

  async whenReady(): Promise<void> {}
  getMarkdown(): string | undefined { return this.closed ? undefined : this.markdown; }
  getMarkdownSnapshot() { return { markdown: this.markdown, revision: String(this.markdownRevision) }; }
  async replaceMarkdown(markdown: string) {
    this.markdown = markdown;
    return this.getMarkdownSnapshot();
  }
  subscribeMarkdown() { return () => undefined; }
  getState(): CollaborativeDocumentSnapshot { return this.state; }
  subscribe(listener: (snapshot: CollaborativeDocumentSnapshot) => void) {
    if (this.subscribeError) throw this.subscribeError;
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
      if (this.unsubscribeError) throw this.unsubscribeError;
    };
  }
  async reconcilePersistence(): Promise<void> {
    this.persistenceReconciliations++;
    this.emit({ persistence: "clean", diagnostic: undefined });
  }
  emit(patch: Partial<CollaborativeDocumentSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
  async attach(
    _editor: EditorAPI,
    options: {
      readonly content: "replace-editor" | "require-match";
      readonly access?: "read-only" | "read-write";
    },
  ): Promise<EditorBindingHandle> {
    this.attachedContentModes.push(options.content);
    this.attachedAccessModes.push(options.access);
    const binding: EditorBindingHandle = this.attachOverride
      ? await this.attachOverride()
      : {
          id: `binding-${this.bindings.length + 1}`,
          detached: false,
          getState: () => "ready",
          setPresence: vi.fn<(presence: LocalPresence | null) => void>(),
          detach: vi.fn(async () => undefined),
        };
    this.bindings.push(binding);
    return binding;
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.closeError) throw this.closeError;
  }
}

class FakeEngine implements CollaborationEngine {
  readonly created: Array<{ document: CollabDocumentRef; initialMarkdown: string }> = [];
  readonly opened: CollabDocumentRef[] = [];
  readonly openOptions: Array<CollaborationOpenOptions | undefined> = [];
  readonly documents = new Map<string, FakeDocument>();
  openFailure: unknown = undefined;

  async create(document: CollabDocumentRef, options: { readonly initialMarkdown: string }) {
    this.created.push({ document, initialMarkdown: options.initialMarkdown });
    const handle = new FakeDocument(document.id, options.initialMarkdown);
    this.documents.set(document.id, handle);
    return handle;
  }
  async open(document: CollabDocumentRef, options?: CollaborationOpenOptions) {
    this.opened.push(document);
    this.openOptions.push(options);
    if (this.openFailure !== undefined) throw this.openFailure;
    const handle = this.documents.get(document.id) ?? new FakeDocument(document.id, "remote\n");
    this.documents.set(document.id, handle);
    return handle;
  }
  getSnapshot() { return undefined; }
  list(): readonly CollaborativeDocumentSnapshot[] { return []; }
  subscribe() { return () => undefined; }
  async close(): Promise<void> {}
}

class FakeProjection implements FileProjectionHandle {
  closed = false;
  closing = false;
  flushed = 0;
  listeners = new Set<(snapshot: FileProjectionSnapshot) => void>();
  resolved: FileConflictResolution[] = [];
  closeError: Error | null = null;
  unsubscribeError: Error | null = null;
  closeOverride: (() => Promise<void>) | null = null;
  flushOverride: (() => Promise<void>) | null = null;

  constructor(public state: FileProjectionSnapshot) {}
  getState() { return this.state; }
  subscribe(listener: (snapshot: FileProjectionSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
      if (this.unsubscribeError) throw this.unsubscribeError;
    };
  }
  async flush() {
    this.flushed++;
    await this.flushOverride?.();
    if (this.state.projection === "failed" || this.state.projection === "missing") {
      this.emit({ ...this.state, projection: "clean", diagnostic: undefined });
    }
  }
  async settle() {}
  async move() {}
  async resolve(resolution: FileConflictResolution) {
    this.resolved.push(resolution);
    this.emit({ ...this.state, projection: "clean", conflict: undefined });
  }
  async close() {
    this.closing = true;
    await this.closeOverride?.();
    this.closed = true;
    if (this.closeError) throw this.closeError;
  }
  emit(snapshot: FileProjectionSnapshot) {
    this.state = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

class FakeProjections implements FileProjectionController {
  readonly attached: FileProjectionAttachOptions[] = [];
  handles: FakeProjection[] = [];
  async attach(options: FileProjectionAttachOptions) {
    this.attached.push(options);
    const handle = new FakeProjection({
      documentId: options.document.id,
      file: options.file,
      projection: "clean",
    });
    this.handles.push(handle);
    return handle;
  }
  async close() {}
}

describe("Collaboration product workflow", () => {
  it("enrolls a file explicitly, attaches an editor, publishes Presence, and creates an invite", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const invitations: CollaborationInvitationAdapter = {
      create: vi.fn(async ({ documentId, role }) => ({
        value: JSON.stringify({ documentId, role }),
        role,
      })),
      accept: vi.fn(),
    };
    const workflow = createCollaborationWorkflow({ engine, projections, invitations });
    const file = { id: asFileId("workflow-file"), path: "notes/workflow.md" };
    const document = { id: asDocumentId("workflow-document"), title: "Workflow" };

    const session = await workflow.create({ file, document, initialMarkdown: "initial\n" });
    const setReadOnly = vi.fn<(readOnly: boolean) => void>();
    const surface: CollaborationWorkflowEditor = {
      editor: {} as EditorAPI,
      setReadOnly,
    };
    const binding = await session.attachEditor(surface, {
      presence: { userId: "owner-1", name: "Owner" },
    });
    const invite = await session.createInvite("editor");

    expect(engine.created).toEqual([{ document, initialMarkdown: "initial\n" }]);
    expect(projections.attached).toMatchObject([{ mode: "enroll", file }]);
    expect(setReadOnly).toHaveBeenCalledWith(false);
    expect(binding.setPresence).toHaveBeenCalledWith({ userId: "owner-1", name: "Owner" });
    expect(invite).toEqual({
      value: JSON.stringify({ documentId: "workflow-document", role: "editor" }),
      role: "editor",
    });
    expect(session.getState()).toMatchObject({
      enrollment: "active",
      access: "owner",
      documentId: document.id,
      file,
      capabilities: {
        canEdit: true,
        canInvite: true,
        canResolveConflict: false,
        canRetryConnection: false,
      },
    });

    await session.leave();
    await workflow.close();
  });

  it("joins through a Host invitation without seeding content and enforces reader mode before attach", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const remote = { id: asDocumentId("remote-document"), hostIdentity: "workspace" };
    const invitations: CollaborationInvitationAdapter = {
      create: vi.fn(),
      accept: vi.fn(async () => ({ document: remote, access: "reader" as const })),
    };
    const workflow = createCollaborationWorkflow({ engine, projections, invitations });
    const file = { id: asFileId("joined-file"), path: "notes/joined.md" };
    const session = await workflow.join({ file, invitation: "opaque-invite" });
    const setReadOnly = vi.fn<(readOnly: boolean) => void>();

    await session.attachEditor({ editor: {} as EditorAPI, setReadOnly });

    expect(invitations.accept).toHaveBeenCalledWith("opaque-invite");
    expect(engine.created).toHaveLength(0);
    expect(engine.opened).toEqual([remote]);
    expect(engine.openOptions).toEqual([{ readiness: "require-authenticated-sync" }]);
    expect(projections.attached).toMatchObject([{ mode: "enroll", file }]);
    expect(projections.attached[0]!.canApplyToDocument?.()).toBe(false);
    expect(setReadOnly).toHaveBeenCalledWith(true);
    expect(engine.documents.get(remote.id)!.attachedContentModes).toEqual(["require-match"]);
    expect(engine.documents.get(remote.id)!.attachedAccessModes).toEqual(["read-only"]);
    expect(session.getState()).toMatchObject({
      access: "reader",
      capabilities: { canEdit: false, canInvite: false },
    });
    await expect(session.createInvite("reader")).rejects.toMatchObject({ code: "not-authorized" });

    await workflow.close();
  });

  it("waits for and closes an Editor binding whose attach loses the leave race", async () => {
    const engine = new FakeEngine();
    const workflow = createCollaborationWorkflow({
      engine,
      projections: new FakeProjections(),
    });
    const ref = { id: asDocumentId("attach-leave-race-document") };
    const session = await workflow.create({
      file: {
        id: asFileId("attach-leave-race-file"),
        path: "notes/attach-leave-race.md",
      },
      document: ref,
      initialMarkdown: "racing\n",
    });
    const document = engine.documents.get(ref.id)!;
    const attachStarted = deferred<void>();
    const attached = deferred<EditorBindingHandle>();
    const detach = vi.fn(async () => undefined);
    document.attachOverride = async () => {
      attachStarted.resolve();
      return attached.promise;
    };

    const opening = session.attachEditor({
      editor: {} as EditorAPI,
      setReadOnly: vi.fn(),
    });
    await attachStarted.promise;
    const leaving = session.leave({ discardUnprojected: true });
    let leaveSettled = false;
    void leaving.finally(() => {
      leaveSettled = true;
    });
    await Promise.resolve();
    expect(leaveSettled).toBe(false);

    attached.resolve({
      id: "late-binding",
      detached: false,
      getState: () => "ready",
      setPresence: vi.fn(),
      detach,
    });

    await expect(opening).rejects.toMatchObject({ code: "session-closed" });
    await expect(leaving).resolves.toBeUndefined();
    expect(detach).toHaveBeenCalledOnce();
    expect(document.closed).toBe(true);
  });

  it("restores a reader surface when its late Editor attach is rolled back during leave", async () => {
    const engine = new FakeEngine();
    const ref = { id: asDocumentId("reader-late-attach-document") };
    const workflow = createCollaborationWorkflow({
      engine,
      projections: new FakeProjections(),
      invitations: {
        create: vi.fn(),
        accept: vi.fn(async () => ({ document: ref, access: "reader" as const })),
      },
    });
    const session = await workflow.join({
      file: { id: asFileId("reader-late-attach-file"), path: "notes/reader-late.md" },
      invitation: "reader-invite",
    });
    const document = engine.documents.get(ref.id)!;
    const attached = deferred<EditorBindingHandle>();
    const setReadOnly = vi.fn<(readOnly: boolean) => void>();
    const detach = vi.fn(async () => undefined);
    document.attachOverride = () => attached.promise;

    const opening = session.attachEditor({ editor: {} as EditorAPI, setReadOnly });
    const leaving = session.leave({ discardUnprojected: true });
    attached.resolve({
      id: "reader-late-binding",
      detached: false,
      getState: () => "ready",
      setPresence: vi.fn(),
      detach,
    });

    await expect(opening).rejects.toMatchObject({ code: "session-closed" });
    await expect(leaving).resolves.toBeUndefined();
    expect(detach).toHaveBeenCalledOnce();
    expect(setReadOnly).toHaveBeenNthCalledWith(1, true);
    expect(setReadOnly).toHaveBeenLastCalledWith(false);
  });

  it("rolls back a pending Editor attach when its authorization generation changes", async () => {
    const engine = new FakeEngine();
    const ref = { id: asDocumentId("pending-attach-authorization-document") };
    const workflow = createCollaborationWorkflow({ engine, projections: new FakeProjections() });
    const session = await workflow.create({
      file: { id: asFileId("pending-attach-authorization-file"), path: "notes/auth-change.md" },
      document: ref,
      initialMarkdown: "secure\n",
    });
    const document = engine.documents.get(ref.id)!;
    const attached = deferred<EditorBindingHandle>();
    const detach = vi.fn(async () => undefined);
    const setReadOnly = vi.fn<(readOnly: boolean) => void>();
    document.attachOverride = () => attached.promise;

    const opening = session.attachEditor({ editor: {} as EditorAPI, setReadOnly });
    document.emit({
      authentication: "revoked",
      access: "none",
      diagnostic: {
        code: "authorization-revoked",
        message: "Permission revoked",
        documentId: ref.id,
      },
    });
    attached.resolve({
      id: "stale-authorization-binding",
      detached: false,
      getState: () => "ready",
      setPresence: vi.fn(),
      detach,
    });

    await expect(opening).rejects.toMatchObject({ code: "not-authorized" });
    expect(detach).toHaveBeenCalledOnce();
    expect(setReadOnly).toHaveBeenLastCalledWith(false);
    await workflow.close();
  });

  it("preserves a binding rollback error together with surface restoration failure", async () => {
    const engine = new FakeEngine();
    const workflow = createCollaborationWorkflow({ engine, projections: new FakeProjections() });
    const ref = { id: asDocumentId("binding-rollback-aggregate-document") };
    const session = await workflow.create({
      file: { id: asFileId("binding-rollback-aggregate-file"), path: "notes/rollback.md" },
      document: ref,
      initialMarkdown: "rollback\n",
    });
    const document = engine.documents.get(ref.id)!;
    const presenceFailure = Object.assign(new Error("presence rejected"), { code: "presence-rejected" });
    const surfaceFailure = new Error("surface restoration failed");
    document.attachOverride = async () => ({
      id: "rollback-aggregate-binding",
      detached: false,
      getState: () => "ready",
      setPresence: () => { throw presenceFailure; },
      detach: vi.fn(async () => undefined),
    });
    let surfaceConfigured = false;
    const setReadOnly = vi.fn((readOnly: boolean) => {
      if (surfaceConfigured && !readOnly) throw surfaceFailure;
      surfaceConfigured = true;
    });

    const result = await Promise.allSettled([session.attachEditor(
      { editor: {} as EditorAPI, setReadOnly },
      { presence: { userId: "owner", name: "Owner" } },
    )]);

    expect(result[0]).toMatchObject({ status: "rejected", reason: { code: "presence-rejected" } });
    if (result[0]?.status === "rejected") {
      expect(result[0].reason).toBeInstanceOf(AggregateError);
      expect((result[0].reason as AggregateError).errors).toEqual([presenceFailure, surfaceFailure]);
    }
    await session.leave({ discardUnprojected: true });
  });

  it("detaches an Editor binding when publishing its initial Presence fails", async () => {
    const engine = new FakeEngine();
    const workflow = createCollaborationWorkflow({
      engine,
      projections: new FakeProjections(),
    });
    const ref = { id: asDocumentId("presence-rollback-document") };
    const session = await workflow.create({
      file: { id: asFileId("presence-rollback-file"), path: "notes/presence-rollback.md" },
      document: ref,
      initialMarkdown: "presence\n",
    });
    const presenceFailure = new Error("presence unavailable");
    const detach = vi.fn(async () => undefined);
    engine.documents.get(ref.id)!.attachOverride = async () => ({
      id: "presence-binding",
      detached: false,
      getState: () => "ready",
      setPresence: vi.fn(() => { throw presenceFailure; }),
      detach,
    });

    await expect(session.attachEditor(
      { editor: {} as EditorAPI, setReadOnly: vi.fn() },
      { presence: { userId: "owner", name: "Owner" } },
    )).rejects.toBe(presenceFailure);

    expect(detach).toHaveBeenCalledOnce();
    await session.leave({ discardUnprojected: true });
  });

  it("does not create a projection or active session when authenticated join readiness fails", async () => {
    const engine = new FakeEngine();
    engine.openFailure = new CollaborationError("authentication-denied", "Credential was denied");
    const projections = new FakeProjections();
    const remote = { id: asDocumentId("denied-join-document"), hostIdentity: "workspace" };
    const workflow = createCollaborationWorkflow({
      engine,
      projections,
      invitations: {
        create: vi.fn(),
        accept: vi.fn(async () => ({ document: remote, access: "reader" as const })),
      },
    });

    await expect(workflow.join({
      file: { id: asFileId("denied-join-file"), path: "notes/denied.md" },
      invitation: "denied-invitation",
    })).rejects.toMatchObject({ code: "authentication-denied" });

    expect(engine.openOptions).toEqual([{ readiness: "require-authenticated-sync" }]);
    expect(projections.attached).toHaveLength(0);
    expect(workflow.list()).toHaveLength(0);
    await workflow.close();
  });

  it("uses require-match by default and exposes an explicit File Projection retry", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const ref = { id: asDocumentId("safe-attach-document") };
    const session = await workflow.create({
      file: { id: asFileId("safe-attach-file"), path: "notes/safe.md" },
      document: ref,
      initialMarkdown: "safe\n",
    });

    await session.attachEditor({ editor: {} as EditorAPI, setReadOnly: vi.fn() });
    expect(engine.documents.get(ref.id)!.attachedContentModes).toEqual(["require-match"]);
    await session.flushFileProjection();
    expect(projections.handles[0]!.flushed).toBe(1);

    const projection = projections.handles[0]!;
    projection.emit({
      ...projection.state,
      projection: "failed",
      diagnostic: {
        code: "file-write-failed",
        message: "disk unavailable",
        documentId: ref.id,
        fileId: asFileId("safe-attach-file"),
      },
    });
    expect(session.getState().capabilities.canRetryProjection).toBe(true);

    await session.retryFileProjection();
    expect(projection.flushed).toBe(2);
    expect(session.getState()).toMatchObject({
      projection: { projection: "clean" },
      capabilities: { canRetryProjection: false },
    });

    await workflow.close();
  });

  it("exposes an explicit durable persistence retry only after Store failure", async () => {
    const engine = new FakeEngine();
    const workflow = createCollaborationWorkflow({ engine, projections: new FakeProjections() });
    const ref = { id: asDocumentId("persistence-retry-document") };
    const session = await workflow.create({
      file: { id: asFileId("persistence-retry-file"), path: "notes/persistence.md" },
      document: ref,
      initialMarkdown: "durable\n",
    });
    const document = engine.documents.get(ref.id)!;

    expect(session.getState().capabilities.canRetryPersistence).toBe(false);
    await expect(session.retryPersistence()).rejects.toMatchObject({ code: "not-authorized" });

    document.emit({
      persistence: "failed",
      diagnostic: { code: "store-failed", message: "durable Store unavailable", documentId: ref.id },
    });
    expect(session.getState().capabilities.canRetryPersistence).toBe(true);

    await session.retryPersistence();
    expect(document.persistenceReconciliations).toBe(1);
    expect(session.getState()).toMatchObject({
      collaboration: { persistence: "clean" },
      capabilities: { canRetryPersistence: false },
    });

    await workflow.close();
  });

  it("exposes offline state and routes an explicit retry through the Host connection adapter", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const reconnect = vi.fn(async () => undefined);
    const workflow = createCollaborationWorkflow({
      engine,
      projections,
      connections: {
        reconnect,
        reauthenticate: vi.fn(async () => ({ access: "owner" as const })),
      },
    });
    const file = { id: asFileId("offline-file"), path: "notes/offline.md" };
    const ref = { id: asDocumentId("offline-document") };
    const session = await workflow.create({ file, document: ref, initialMarkdown: "offline\n" });

    engine.documents.get(ref.id)!.emit({ transport: "offline", sync: "stale" });

    expect(session.getState()).toMatchObject({
      collaboration: { transport: "offline", sync: "stale" },
      capabilities: { canEdit: true, canRetryConnection: true },
    });
    await session.retryConnection();
    expect(reconnect).toHaveBeenCalledWith(ref.id);

    await workflow.close();
  });

  it("suspends editing on authorization revocation and resumes only after reauthentication", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const ref = { id: asDocumentId("revoked-document") };
    const reauthenticate = vi.fn(async () => {
      engine.documents.get(ref.id)!.emit({
        authentication: "authenticated",
        access: "read-write",
        transport: "online",
        sync: "synced",
        diagnostic: undefined,
      });
      return { access: "editor" as const };
    });
    const workflow = createCollaborationWorkflow({
      engine,
      projections,
      connections: { reconnect: vi.fn(async () => undefined), reauthenticate },
    });
    const file = { id: asFileId("revoked-file"), path: "notes/revoked.md" };
    const session = await workflow.create({ file, document: ref, initialMarkdown: "secure\n" });
    const setReadOnly = vi.fn<(readOnly: boolean) => void>();
    const firstBinding = await session.attachEditor({ editor: {} as EditorAPI, setReadOnly });

    engine.documents.get(ref.id)!.emit({
      transport: "failed",
      sync: "failed",
      diagnostic: {
        code: "authorization-revoked",
        message: "Permission revoked",
        documentId: ref.id,
      },
    });
    await vi.waitFor(() => expect(firstBinding.detach).toHaveBeenCalledTimes(1));

    expect(setReadOnly).toHaveBeenLastCalledWith(true);
    expect(session.getState()).toMatchObject({
      access: "revoked",
      capabilities: { canEdit: false, canReauthenticate: true },
    });
    expect(projections.attached[0]!.canApplyToDocument?.()).toBe(false);

    await session.reauthenticate();
    expect(reauthenticate).toHaveBeenCalledWith(ref.id);
    expect(setReadOnly).toHaveBeenLastCalledWith(false);
    expect(engine.documents.get(ref.id)!.bindings).toHaveLength(2);
    expect(engine.documents.get(ref.id)!.attachedAccessModes).toEqual(["read-write", "read-write"]);
    expect(session.getState()).toMatchObject({
      access: "editor",
      capabilities: { canEdit: true, canReauthenticate: false },
    });
    expect(projections.attached[0]!.canApplyToDocument?.()).toBe(true);

    await workflow.close();
  });

  it("does not publish a resumed Editor binding when authorization is revoked again during attach", async () => {
    const engine = new FakeEngine();
    const ref = { id: asDocumentId("reauthentication-epoch-document") };
    const workflow = createCollaborationWorkflow({
      engine,
      projections: new FakeProjections(),
      connections: {
        reconnect: vi.fn(async () => undefined),
        reauthenticate: vi.fn(async () => {
          engine.documents.get(ref.id)!.emit({
            authentication: "authenticated",
            access: "read-write",
            transport: "online",
            sync: "synced",
            diagnostic: undefined,
          });
          return { access: "editor" as const };
        }),
      },
    });
    const session = await workflow.create({
      file: { id: asFileId("reauthentication-epoch-file"), path: "notes/auth-epoch.md" },
      document: ref,
      initialMarkdown: "secure\n",
    });
    const document = engine.documents.get(ref.id)!;
    const firstBinding = await session.attachEditor({
      editor: {} as EditorAPI,
      setReadOnly: vi.fn(),
    });
    document.emit({
      authentication: "revoked",
      access: "none",
      transport: "offline",
      sync: "stale",
      diagnostic: {
        code: "authorization-revoked",
        message: "Permission revoked",
        documentId: ref.id,
      },
    });
    await vi.waitFor(() => expect(firstBinding.detach).toHaveBeenCalledOnce());

    const attachStarted = deferred<void>();
    const resumed = deferred<EditorBindingHandle>();
    const candidateCleanupFailure = new Error("candidate detach failed");
    const resumedDetach = vi.fn(async () => {
      throw candidateCleanupFailure;
    });
    document.attachOverride = async () => {
      attachStarted.resolve();
      return resumed.promise;
    };
    const authentication = session.reauthenticate();
    await attachStarted.promise;

    document.emit({
      authentication: "revoked",
      access: "none",
      transport: "offline",
      sync: "stale",
      diagnostic: {
        code: "authorization-revoked",
        message: "Permission revoked again",
        documentId: ref.id,
      },
    });
    resumed.resolve({
      id: "stale-resumed-binding",
      detached: false,
      getState: () => "ready",
      setPresence: vi.fn(),
      detach: resumedDetach,
    });

    const [authenticationResult] = await Promise.allSettled([authentication]);
    expect(authenticationResult.status).toBe("rejected");
    if (authenticationResult.status === "rejected") {
      expect(authenticationResult.reason).toBeInstanceOf(AggregateError);
      expect(authenticationResult.reason).toMatchObject({
        code: "not-authorized",
        errors: [expect.objectContaining({ code: "not-authorized" }), candidateCleanupFailure],
      });
    }
    expect(resumedDetach).toHaveBeenCalledOnce();
    expect(session.getState()).toMatchObject({
      access: "revoked",
      capabilities: { canEdit: false, canReauthenticate: true },
    });
    await workflow.close();
  });

  it("rejects a concurrent reauthentication before it can resume Editor bindings twice", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const ref = { id: asDocumentId("concurrent-reauthentication-document") };
    const grant = deferred<{ readonly access: "editor" }>();
    const reauthenticate = vi.fn(() => grant.promise);
    const workflow = createCollaborationWorkflow({
      engine,
      projections,
      connections: { reconnect: vi.fn(async () => undefined), reauthenticate },
    });
    const session = await workflow.create({
      file: { id: asFileId("concurrent-reauthentication-file"), path: "notes/concurrent.md" },
      document: ref,
      initialMarkdown: "secure\n",
    });
    const document = engine.documents.get(ref.id)!;
    const setReadOnly = vi.fn<(readOnly: boolean) => void>();
    const firstBinding = await session.attachEditor({ editor: {} as EditorAPI, setReadOnly });
    document.emit({
      authentication: "revoked",
      access: "none",
      transport: "offline",
      sync: "stale",
      diagnostic: {
        code: "authorization-revoked",
        message: "Permission revoked",
        documentId: ref.id,
      },
    });
    await vi.waitFor(() => expect(firstBinding.detach).toHaveBeenCalledTimes(1));

    const first = session.reauthenticate();
    const second = session.reauthenticate();
    document.emit({
      authentication: "authenticated",
      access: "read-write",
      transport: "online",
      sync: "synced",
      diagnostic: undefined,
    });
    grant.resolve({ access: "editor" });
    await first;
    await expect(second).rejects.toMatchObject({ code: "reauthentication-in-progress" });

    expect(reauthenticate).toHaveBeenCalledTimes(1);
    expect(document.bindings).toHaveLength(2);
    expect(setReadOnly).toHaveBeenLastCalledWith(false);
    await workflow.close();
  });

  it("clears the Workflow reauthentication gate after a failed attempt", async () => {
    const engine = new FakeEngine();
    const ref = { id: asDocumentId("failed-reauthentication-document") };
    const firstGrant = deferred<{ readonly access: "editor" }>();
    const reauthenticate = vi.fn()
      .mockImplementationOnce(() => firstGrant.promise)
      .mockImplementationOnce(async () => {
        engine.documents.get(ref.id)!.emit({
          authentication: "authenticated",
          access: "read-write",
          transport: "online",
          sync: "synced",
          diagnostic: undefined,
        });
        return { access: "editor" as const };
      });
    const workflow = createCollaborationWorkflow({
      engine,
      projections: new FakeProjections(),
      connections: { reconnect: vi.fn(async () => undefined), reauthenticate },
    });
    const session = await workflow.create({
      file: { id: asFileId("failed-reauthentication-file"), path: "notes/retry.md" },
      document: ref,
      initialMarkdown: "secure\n",
    });
    engine.documents.get(ref.id)!.emit({
      authentication: "expired",
      access: "none",
      transport: "offline",
      sync: "stale",
      diagnostic: {
        code: "authentication-expired",
        message: "Credential expired",
        documentId: ref.id,
      },
    });

    const first = session.reauthenticate();
    const concurrent = session.reauthenticate();
    firstGrant.reject(new Error("refresh rejected"));
    await expect(first).rejects.toThrow("refresh rejected");
    await expect(concurrent).rejects.toMatchObject({ code: "reauthentication-in-progress" });
    await expect(session.reauthenticate()).resolves.toBeUndefined();

    expect(reauthenticate).toHaveBeenCalledTimes(2);
    expect(session.getState()).toMatchObject({
      access: "editor",
      capabilities: { canEdit: true, canReauthenticate: false },
    });
    await workflow.close();
  });

  it("does not resume an Editor binding after leave starts during reauthentication", async () => {
    const engine = new FakeEngine();
    const ref = { id: asDocumentId("leave-during-reauthentication-document") };
    const grant = deferred<{ readonly access: "editor" }>();
    const workflow = createCollaborationWorkflow({
      engine,
      projections: new FakeProjections(),
      connections: {
        reconnect: vi.fn(async () => undefined),
        reauthenticate: vi.fn(() => grant.promise),
      },
    });
    const session = await workflow.create({
      file: { id: asFileId("leave-during-reauthentication-file"), path: "notes/leaving.md" },
      document: ref,
      initialMarkdown: "secure\n",
    });
    const document = engine.documents.get(ref.id)!;
    const firstBinding = await session.attachEditor({
      editor: {} as EditorAPI,
      setReadOnly: vi.fn(),
    });
    document.emit({
      authentication: "revoked",
      access: "none",
      transport: "offline",
      sync: "stale",
      diagnostic: {
        code: "authorization-revoked",
        message: "Permission revoked",
        documentId: ref.id,
      },
    });
    await vi.waitFor(() => expect(firstBinding.detach).toHaveBeenCalledTimes(1));

    const authentication = session.reauthenticate();
    const leaving = session.leave({ discardUnprojected: true });
    await vi.waitFor(() => expect(session.closed).toBe(true));
    grant.resolve({ access: "editor" });

    await expect(authentication).rejects.toMatchObject({ code: "session-closed" });
    await expect(leaving).resolves.toBeUndefined();
    expect(document.bindings).toHaveLength(1);
    expect(firstBinding.detach).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["denied", "authentication-denied"],
    ["expired", "authentication-expired"],
  ] as const)("suspends bindings and offers reauthentication when authentication is %s", async (
    authentication,
    diagnosticCode,
  ) => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const ref = { id: asDocumentId("expired-document") };
    const workflow = createCollaborationWorkflow({
      engine,
      projections,
      connections: {
        reconnect: vi.fn(async () => undefined),
        reauthenticate: vi.fn(async () => ({ access: "editor" as const })),
      },
    });
    const session = await workflow.create({
      file: { id: asFileId("expired-file"), path: "notes/expired.md" },
      document: ref,
      initialMarkdown: "secure\n",
    });
    const setReadOnly = vi.fn<(readOnly: boolean) => void>();
    const binding = await session.attachEditor({ editor: {} as EditorAPI, setReadOnly });

    engine.documents.get(ref.id)!.emit({
      authentication,
      access: "none",
      transport: "offline",
      sync: "stale",
      diagnostic: {
        code: diagnosticCode,
        message: "Credential unavailable",
        documentId: ref.id,
      },
    });
    await vi.waitFor(() => expect(binding.detach).toHaveBeenCalledTimes(1));

    expect(session.getState()).toMatchObject({
      access: "owner",
      diagnostic: { code: diagnosticCode },
      capabilities: {
        canEdit: false,
        canRetryConnection: false,
        canReauthenticate: true,
      },
    });
    expect(setReadOnly).toHaveBeenLastCalledWith(true);
    await expect(session.attachEditor({ editor: {} as EditorAPI, setReadOnly: vi.fn() }))
      .rejects.toMatchObject({ code: "not-authorized" });

    await workflow.close();
  });

  it("can reopen an existing document while enrolling a missing local projection", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const ref = { id: asDocumentId("pending-create-document") };
    const file = { id: asFileId("pending-create-file"), path: "notes/recovered.md" };

    const session = await workflow.resume({
      file,
      document: ref,
      access: "owner",
      projectionMode: "enroll",
    });

    expect(engine.opened).toEqual([ref]);
    expect(engine.openOptions).toEqual([{ readiness: "allow-local-authority" }]);
    expect(projections.attached).toMatchObject([{ mode: "enroll", file }]);
    await session.leave();
    await workflow.close();
  });

  it("surfaces File Conflict actions and blocks an unsafe leave until resolution", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const file = { id: asFileId("conflict-workflow-file"), path: "notes/conflict.md" };
    const ref = { id: asDocumentId("conflict-workflow-document") };
    const session = await workflow.create({ file, document: ref, initialMarkdown: "base\n" });
    const projection = projections.handles[0]!;
    projection.emit({
      ...projection.state,
      projection: "conflicted",
      conflict: {
        id: "conflict-1",
        reason: "overlapping-edits",
        base: "base\n",
        live: { markdown: "live\n", revision: "2" },
        incoming: { markdown: "disk\n", version: "v2" },
        hunks: [],
      },
    });

    expect(session.getState().capabilities.canResolveConflict).toBe(true);
    await expect(session.leave()).rejects.toMatchObject({ code: "unsafe-leave" });

    const resolution = { conflictId: "conflict-1", choice: "manual" as const, markdown: "merged\n" };
    await session.resolveFileConflict(resolution);
    expect(projection.resolved).toEqual([resolution]);
    expect(session.getState().capabilities.canResolveConflict).toBe(false);
    await session.leave();
    expect(projection.closed).toBe(true);

    await workflow.close();
  });

  it("keeps the session open when projection becomes dirty again during the leave flush", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const ref = { id: asDocumentId("leave-flush-fence-document") };
    const session = await workflow.create({
      file: { id: asFileId("leave-flush-fence-file"), path: "notes/leave-flush.md" },
      document: ref,
      initialMarkdown: "base\n",
    });
    const setReadOnly = vi.fn<(readOnly: boolean) => void>();
    await session.attachEditor({ editor: {} as EditorAPI, setReadOnly });
    const projection = projections.handles[0]!;
    projection.emit({ ...projection.state, projection: "dirty" });
    const flushStarted = deferred<void>();
    const allowFlush = deferred<void>();
    projection.flushOverride = async () => {
      projection.emit({ ...projection.state, projection: "clean" });
      flushStarted.resolve();
      await allowFlush.promise;
    };

    const leaving = session.leave();
    await flushStarted.promise;
    const readOnlyDuringFlush = setReadOnly.mock.lastCall?.[0];
    const attachDuringLeave = session.attachEditor({
      editor: {} as EditorAPI,
      setReadOnly: vi.fn(),
    });
    projection.emit({ ...projection.state, projection: "dirty" });
    allowFlush.resolve();

    await expect(attachDuringLeave).rejects.toMatchObject({ code: "session-closed" });
    await expect(leaving).rejects.toMatchObject({ code: "unsafe-leave" });
    expect(readOnlyDuringFlush).toBe(true);
    expect(session.closed).toBe(false);
    expect(session.getState()).toMatchObject({ enrollment: "active", projection: { projection: "dirty" } });
    expect(setReadOnly).toHaveBeenLastCalledWith(false);
    expect(projection.closed).toBe(false);
    expect(engine.documents.get(ref.id)!.closed).toBe(false);

    await session.leave({ discardUnprojected: true });
    await workflow.close();
  });

  it("closes the Projection observation at the final clean leave boundary before async teardown", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const ref = { id: asDocumentId("leave-projection-cutoff-document") };
    const document = new FakeDocument(ref.id, "base\n");
    engine.documents.set(ref.id, document);
    const detachStarted = deferred<void>();
    const allowDetach = deferred<void>();
    document.attachOverride = async () => ({
      id: "blocking-binding",
      detached: false,
      getState: () => "ready",
      setPresence: vi.fn(),
      detach: vi.fn(async () => {
        detachStarted.resolve();
        await allowDetach.promise;
      }),
    });
    const session = await workflow.resume({
      file: { id: asFileId("leave-projection-cutoff-file"), path: "notes/cutoff.md" },
      document: ref,
      access: "editor",
    });
    await session.attachEditor({ editor: {} as EditorAPI, setReadOnly: vi.fn() });
    const projection = projections.handles[0]!;

    const leaving = session.leave();
    await detachStarted.promise;
    const acceptedAfterCleanBoundary = !projection.closing;
    if (acceptedAfterCleanBoundary) {
      projection.emit({ ...projection.state, projection: "dirty" });
    }
    allowDetach.resolve();

    await expect(leaving).resolves.toBeUndefined();
    expect(acceptedAfterCleanBoundary).toBe(false);
    expect(projection.closed).toBe(true);
    expect(document.closed).toBe(true);
    await workflow.close();
  });

  it("allows a reader to keep shared projection but not replace the document from disk", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const remote = { id: asDocumentId("reader-conflict-document") };
    const workflow = createCollaborationWorkflow({
      engine,
      projections,
      invitations: {
        create: vi.fn(),
        accept: vi.fn(async () => ({ document: remote, access: "reader" as const })),
      },
    });
    const session = await workflow.join({
      file: { id: asFileId("reader-conflict-file"), path: "notes/reader-conflict.md" },
      invitation: "reader-invitation",
    });
    const projection = projections.handles[0]!;
    projection.emit({
      ...projection.state,
      projection: "conflicted",
      conflict: {
        id: "reader-conflict-1",
        reason: "read-only",
        base: "base\n",
        live: { markdown: "shared\n", revision: "2" },
        incoming: { markdown: "disk\n", version: "v2" },
        hunks: [],
      },
    });

    await expect(session.resolveFileConflict({ conflictId: "reader-conflict-1", choice: "use-disk" }))
      .rejects.toMatchObject({ code: "not-authorized" });
    await expect(session.resolveFileConflict({
      conflictId: "reader-conflict-1",
      choice: "manual",
      markdown: "manual\n",
    })).rejects.toMatchObject({ code: "not-authorized" });
    expect(projection.resolved).toHaveLength(0);

    await session.resolveFileConflict({ conflictId: "reader-conflict-1", choice: "use-live" });
    expect(projection.resolved).toEqual([{ conflictId: "reader-conflict-1", choice: "use-live" }]);
    await workflow.close();
  });

  it("reserves FileId and DocumentId while an enrollment is still opening", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    class DelayedEngine extends FakeEngine {
      override async create(document: CollabDocumentRef, options: { readonly initialMarkdown: string }) {
        await gate;
        return super.create(document, options);
      }
    }
    const engine = new DelayedEngine();
    const workflow = createCollaborationWorkflow({ engine, projections: new FakeProjections() });
    const file = { id: asFileId("reserved-file"), path: "notes/reserved.md" };
    const opening = workflow.create({
      file,
      document: { id: asDocumentId("reserved-document") },
      initialMarkdown: "first\n",
    });

    await expect(workflow.create({
      file,
      document: { id: asDocumentId("other-document") },
      initialMarkdown: "second\n",
    })).rejects.toMatchObject({ code: "session-already-active" });

    release();
    const session = await opening;
    await session.leave();
    await workflow.close();
  });

  it("does not release another opening operation's DocumentId reservation after a join collision", async () => {
    const gate = deferred<void>();
    let createCalls = 0;
    class DelayedEngine extends FakeEngine {
      override async create(document: CollabDocumentRef, options: { readonly initialMarkdown: string }) {
        createCalls++;
        await gate.promise;
        return super.create(document, options);
      }
    }
    const document = { id: asDocumentId("join-reservation-document") };
    const engine = new DelayedEngine();
    const workflow = createCollaborationWorkflow({
      engine,
      projections: new FakeProjections(),
      invitations: {
        create: vi.fn(),
        accept: vi.fn(async () => ({ document, access: "reader" as const })),
      },
    });
    const first = workflow.create({
      file: { id: asFileId("join-reservation-first-file"), path: "notes/first.md" },
      document,
      initialMarkdown: "first\n",
    });
    await vi.waitFor(() => expect(createCalls).toBe(1));

    await expect(workflow.join({
      file: { id: asFileId("join-reservation-second-file"), path: "notes/second.md" },
      invitation: "same-document",
    })).rejects.toMatchObject({ code: "session-already-active" });
    const third = workflow.create({
      file: { id: asFileId("join-reservation-third-file"), path: "notes/third.md" },
      document,
      initialMarkdown: "third\n",
    });
    gate.resolve();

    const [firstResult, thirdResult] = await Promise.allSettled([first, third]);
    expect(firstResult.status).toBe("fulfilled");
    expect(thirdResult).toMatchObject({
      status: "rejected",
      reason: { code: "session-already-active" },
    });
    expect(createCalls).toBe(1);
    await workflow.close();
  });

  it("waits for an opening session and prevents it from becoming active after workflow close", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    class DelayedEngine extends FakeEngine {
      override async create(document: CollabDocumentRef, options: { readonly initialMarkdown: string }) {
        await gate;
        return super.create(document, options);
      }
    }
    const engine = new DelayedEngine();
    const workflow = createCollaborationWorkflow({ engine, projections: new FakeProjections() });
    const ref = { id: asDocumentId("closing-document") };
    const opening = workflow.create({
      file: { id: asFileId("closing-file"), path: "notes/closing.md" },
      document: ref,
      initialMarkdown: "closing\n",
    });

    const closing = workflow.close();
    release();

    await expect(opening).rejects.toMatchObject({ code: "workflow-closed" });
    await closing;
    expect(engine.documents.get(ref.id)?.closed).toBe(true);
    expect(workflow.list()).toHaveLength(0);
  });

  it("shares one complete cleanup result across concurrent workflow close calls", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const ref = { id: asDocumentId("single-flight-close-document") };
    await workflow.create({
      file: { id: asFileId("single-flight-close-file"), path: "notes/close.md" },
      document: ref,
      initialMarkdown: "close\n",
    });
    const closeStarted = deferred<void>();
    const allowClose = deferred<void>();
    projections.handles[0]!.closeOverride = async () => {
      closeStarted.resolve();
      await allowClose.promise;
    };

    const first = workflow.close();
    await closeStarted.promise;
    const second = workflow.close();
    let secondSettled = false;
    void second.finally(() => { secondSettled = true; });
    await Promise.resolve();

    expect(second).toBe(first);
    expect(secondSettled).toBe(false);
    expect(engine.documents.get(ref.id)!.closed).toBe(false);

    allowClose.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(projections.handles[0]!.closed).toBe(true);
    expect(engine.documents.get(ref.id)!.closed).toBe(true);
  });

  it("mirrors Provider read-only and read-write changes into the attached editor surface", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const ref = { id: asDocumentId("access-document") };
    const session = await workflow.create({
      file: { id: asFileId("access-file"), path: "notes/access.md" },
      document: ref,
      initialMarkdown: "access\n",
    });
    const setReadOnly = vi.fn<(readOnly: boolean) => void>();
    await session.attachEditor({ editor: {} as EditorAPI, setReadOnly });

    engine.documents.get(ref.id)!.emit({ access: "read-only" });
    expect(setReadOnly).toHaveBeenLastCalledWith(true);
    expect(session.getState().capabilities.canEdit).toBe(false);
    expect(projections.attached[0]!.canApplyToDocument?.()).toBe(false);

    engine.documents.get(ref.id)!.emit({ access: "read-write" });
    expect(setReadOnly).toHaveBeenLastCalledWith(false);
    expect(session.getState().capabilities.canEdit).toBe(true);
    expect(projections.attached[0]!.canApplyToDocument?.()).toBe(true);

    await workflow.close();
  });

  it("releases the document and registry even when one leave cleanup step fails", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const ref = { id: asDocumentId("cleanup-document") };
    const session = await workflow.create({
      file: { id: asFileId("cleanup-file"), path: "notes/cleanup.md" },
      document: ref,
      initialMarkdown: "cleanup\n",
    });
    projections.handles[0]!.closeError = new Error("watcher close failed");

    await expect(session.leave()).rejects.toThrow("watcher close failed");

    expect(engine.documents.get(ref.id)?.closed).toBe(true);
    expect(workflow.list()).toHaveLength(0);
    await workflow.close();
  });

  it("continues teardown when subscription and Editor surface cleanup callbacks throw", async () => {
    const engine = new FakeEngine();
    const projections = new FakeProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const ref = { id: asDocumentId("callback-cleanup-document") };
    const session = await workflow.create({
      file: { id: asFileId("callback-cleanup-file"), path: "notes/callback-cleanup.md" },
      document: ref,
      initialMarkdown: "cleanup callbacks\n",
    });
    const document = engine.documents.get(ref.id)!;
    const projection = projections.handles[0]!;
    const documentUnsubscribeFailure = new Error("document unsubscribe failed");
    const projectionUnsubscribeFailure = new Error("projection unsubscribe failed");
    const surfaceFailure = new Error("surface cleanup failed");
    document.unsubscribeError = documentUnsubscribeFailure;
    projection.unsubscribeError = projectionUnsubscribeFailure;
    let failSurfaceCleanup = false;
    const surface: CollaborationWorkflowEditor = {
      editor: {} as EditorAPI,
      setReadOnly: vi.fn((readOnly: boolean) => {
        if (!readOnly && failSurfaceCleanup) throw surfaceFailure;
      }),
    };
    await session.attachEditor(surface);
    failSurfaceCleanup = true;

    const result = await Promise.allSettled([session.leave()]);

    expect(result[0]?.status).toBe("rejected");
    if (result[0]?.status === "rejected") {
      expect(result[0].reason).toBeInstanceOf(AggregateError);
      expect((result[0].reason as AggregateError).errors).toEqual([
        documentUnsubscribeFailure,
        projectionUnsubscribeFailure,
        surfaceFailure,
      ]);
    }
    expect(document.bindings[0]?.detach).toHaveBeenCalledTimes(1);
    expect(projection.closed).toBe(true);
    expect(document.closed).toBe(true);
    expect(workflow.list()).toHaveLength(0);
    await workflow.close();
  });

  it("reports the opening error and every rollback failure while releasing all acquired resources", async () => {
    const openingFailure = Object.assign(new Error("document subscription failed"), {
      code: "subscription-failed",
    });
    const projectionCleanupFailure = new Error("projection watcher cleanup failed");
    const documentCleanupFailure = new Error("provider cleanup failed");
    class FailingEngine extends FakeEngine {
      override async create(document: CollabDocumentRef, options: { readonly initialMarkdown: string }) {
        const handle = await super.create(document, options);
        handle.subscribeError = openingFailure;
        handle.closeError = documentCleanupFailure;
        return handle;
      }
    }
    class FailingProjections extends FakeProjections {
      override async attach(options: FileProjectionAttachOptions) {
        const handle = await super.attach(options);
        handle.closeError = projectionCleanupFailure;
        return handle;
      }
    }
    const engine = new FailingEngine();
    const projections = new FailingProjections();
    const workflow = createCollaborationWorkflow({ engine, projections });
    const ref = { id: asDocumentId("opening-rollback-document") };

    const result = await Promise.allSettled([workflow.create({
      file: { id: asFileId("opening-rollback-file"), path: "notes/opening-rollback.md" },
      document: ref,
      initialMarkdown: "opening\n",
    })]);

    expect(result[0]?.status).toBe("rejected");
    if (result[0]?.status === "rejected") {
      expect(result[0].reason).toBeInstanceOf(AggregateError);
      expect(result[0].reason).toMatchObject({ code: "subscription-failed" });
      expect((result[0].reason as AggregateError).errors).toEqual([
        openingFailure,
        projectionCleanupFailure,
        documentCleanupFailure,
      ]);
    }
    expect(projections.handles[0]?.closed).toBe(true);
    expect(engine.documents.get(ref.id)?.closed).toBe(true);
    expect(workflow.list()).toHaveLength(0);
    await workflow.close();
  });
});
