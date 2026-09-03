import type { EditorAPI } from "@floatboat/nexus-core";
import {
  asDocumentId,
  asFileId,
  hashMarkdown,
  type CollaborationInvitation,
  type CollaborationWorkflowSession,
  type CollaborationWorkflowSnapshot,
  type FileConflictResolution,
  type ProjectionMetadataEntry,
  type ProjectionMetadataRecord,
  type ProjectionMetadataStore,
  type Unsubscribe,
} from "@floatboat/nexus-plugin-collab";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCollaborationWorkspace as createWorkspaceUnderTest,
  type CollaborationWorkspaceBackend,
  type CollaborationWorkspaceBackendFactory,
  type CollaborationWorkspaceFile,
  type CollaborationWorkspaceOptions,
} from "../src/renderer/collaboration-workspace";
import type {
  CollaborationIdentityDeletion,
  CollaborationEnrollmentInput,
  CollaborationEnrollmentRecord,
  CollaborationEnrollmentStore,
  CollaborationPathDeletionReservation,
  CollaborationPendingCreationRecord,
  CollaborationPendingJoin,
} from "../src/renderer/collaboration-enrollment-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function collaborationSnapshot(
  access: "owner" | "editor" | "reader" = "owner",
  projection: CollaborationWorkflowSnapshot["projection"]["projection"] = "clean",
): CollaborationWorkflowSnapshot {
  const documentId = asDocumentId("document-a");
  const file = { id: asFileId("file-a"), path: "Notes/A.md" };
  return {
    enrollment: "active",
    access,
    documentId,
    file,
    collaboration: {
      id: documentId,
      lifecycle: "open",
      transport: "online",
      sync: "synced",
      authentication: "authenticated",
      access: access === "reader" ? "read-only" : "read-write",
      persistence: "clean",
      consistency: "healthy",
      peers: [],
      bindings: 0,
    },
    projection: { documentId, file, projection },
    peers: [],
    capabilities: {
      canEdit: access !== "reader",
      canInvite: access === "owner",
      canResolveConflict: projection === "conflicted",
      canRetryConnection: false,
      canRetryPersistence: false,
      canReauthenticate: false,
      canRetryProjection: projection === "missing" || projection === "failed",
      canLeave: true,
    },
  };
}

class FakeSession implements CollaborationWorkflowSession {
  closed = false;
  state = collaborationSnapshot();
  readonly listeners = new Set<(snapshot: CollaborationWorkflowSnapshot) => void>();
  readonly attachEditor = vi.fn(async (
    _surface: unknown,
    _options?: { readonly content?: "replace-editor" | "require-match" },
  ) => ({
    id: "binding-a",
    detached: false,
    getState: () => "ready" as const,
    setPresence: vi.fn(),
    detach: vi.fn(async () => undefined),
  }));
  readonly createInvite = vi.fn(async (role: "editor" | "reader"): Promise<CollaborationInvitation> => ({
    value: JSON.stringify({ role, capability: "secret" }),
    role,
    expiresAt: "2026-09-03T01:00:00.000Z",
  }));
  readonly retryConnection = vi.fn(async () => undefined);
  readonly retryPersistence = vi.fn(async () => undefined);
  readonly reauthenticate = vi.fn<() => Promise<void>>(async () => undefined);
  readonly flushFileProjection = vi.fn(async () => undefined);
  readonly retryFileProjection = vi.fn(async () => undefined);
  readonly resolveFileConflict = vi.fn(async (_resolution: FileConflictResolution) => undefined);
  readonly moveFile = vi.fn(async (file: { readonly id: ReturnType<typeof asFileId>; readonly path: string }) => {
    this.emit({ ...this.state, file, projection: { ...this.state.projection, file } });
  });
  readonly leave = vi.fn(async () => { this.closed = true; });

  getState() { return this.state; }
  subscribe(listener: (snapshot: CollaborationWorkflowSnapshot) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  emit(state: CollaborationWorkflowSnapshot) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function enrollmentStore(
  initial: CollaborationEnrollmentRecord[] = [],
  initialPending: CollaborationPendingCreationRecord[] = [],
): CollaborationEnrollmentStore {
  const records = [...initial];
  const pending = [...initialPending];
  const deletions: CollaborationIdentityDeletion[] = [];
  const reservations: CollaborationPathDeletionReservation[] = [];
  const pendingJoins: CollaborationPendingJoin[] = [];
  let operationSequence = 0;
  const same = (left: CollaborationEnrollmentRecord, right: CollaborationEnrollmentRecord) =>
    JSON.stringify(left) === JSON.stringify(right);
  return {
    async findByPath(path) { return records.find((record) => record.path === path) ?? null; },
    async findByFileId(fileId) { return records.find((record) => record.fileId === fileId) ?? null; },
    async list() { return [...records]; },
    async findPendingCreationByPath(path) {
      return pending.find((record) => record.path === path) ?? null;
    },
    async listPendingCreations() { return [...pending]; },
    async listIdentityDeletions() { return structuredClone(deletions); },
    async listDeletionReservations() { return structuredClone(reservations); },
    async listPendingJoins() { return structuredClone(pendingJoins); },
    async assertProjectionWriteAuthorized() {},
    async beginJoin(input) {
      const pending: CollaborationPendingJoin = {
        schemaVersion: 1,
        operationId: input.operationId,
        owner: input.owner,
        phase: "opening",
        enrollment: { schemaVersion: 1, ...input.enrollment },
      };
      pendingJoins.push(pending);
      return pending;
    },
    async commitJoin(intent) {
      const index = pendingJoins.findIndex((candidate) => candidate.operationId === intent.operationId);
      if (index < 0) throw new Error("missing pending join");
      const committed: CollaborationPendingJoin = { ...pendingJoins[index]!, phase: "enrollment-committed" };
      pendingJoins[index] = committed;
      records.push(committed.enrollment);
      return committed;
    },
    async completeJoin(intent) {
      const index = pendingJoins.findIndex((candidate) => candidate.operationId === intent.operationId);
      if (index < 0) return false;
      pendingJoins.splice(index, 1);
      return true;
    },
    async abortJoin(intent) {
      const index = pendingJoins.findIndex((candidate) => candidate.operationId === intent.operationId);
      if (index < 0) return false;
      pendingJoins.splice(index, 1);
      return true;
    },
    async beginCreation(input) {
      const record = { schemaVersion: 1 as const, ...input };
      const index = pending.findIndex((candidate) => candidate.fileId === input.fileId);
      if (index < 0) pending.push(record);
      else pending[index] = record;
      return record;
    },
    async commitCreation(intent) {
      const index = pending.findIndex((candidate) => candidate.fileId === intent.fileId);
      if (index < 0) throw new Error("missing pending creation");
      const record = pending[index]!;
      pending.splice(index, 1);
      records.push(record);
      return record;
    },
    async forgetPendingCreation(expected) {
      const index = pending.findIndex((candidate) => candidate.fileId === expected.fileId);
      if (index < 0) return null;
      if (!same(pending[index]!, expected)) {
        throw Object.assign(new Error("pending creation changed before delete"), { code: "enrollment-conflict" });
      }
      const deletion: CollaborationIdentityDeletion = {
        schemaVersion: 1,
        operationId: `delete-${++operationSequence}`,
        kind: "pending-creation",
        record: expected,
      };
      pending.splice(index, 1);
      deletions.push(deletion);
      return deletion;
    },
    async upsert(input: CollaborationEnrollmentInput) {
      const record = { schemaVersion: 1 as const, ...input };
      const index = records.findIndex((candidate) => candidate.fileId === input.fileId);
      if (index < 0) records.push(record);
      else records[index] = record;
      return record;
    },
    async rename(expected, path, title) {
      const enrollmentIndex = records.findIndex((candidate) => candidate.fileId === expected.fileId);
      if (enrollmentIndex >= 0) {
        if (!same(records[enrollmentIndex]!, expected)) {
          throw Object.assign(new Error("enrollment changed before rename"), { code: "enrollment-conflict" });
        }
        const record = { ...records[enrollmentIndex]!, path, ...(title ? { title } : {}) };
        records[enrollmentIndex] = record;
        return record;
      }
      const pendingIndex = pending.findIndex((candidate) => candidate.fileId === expected.fileId);
      if (pendingIndex < 0) throw new Error("missing enrollment");
      if (!same(pending[pendingIndex]!, expected)) {
        throw Object.assign(new Error("pending creation changed before rename"), { code: "enrollment-conflict" });
      }
      const record = { ...pending[pendingIndex]!, path, ...(title ? { title } : {}) };
      pending[pendingIndex] = record;
      return record;
    },
    async forget(expected) {
      const index = records.findIndex((candidate) => candidate.fileId === expected.fileId);
      if (index < 0) return null;
      if (!same(records[index]!, expected)) {
        throw Object.assign(new Error("enrollment changed before delete"), { code: "enrollment-conflict" });
      }
      const deletion: CollaborationIdentityDeletion = {
        schemaVersion: 1,
        operationId: `delete-${++operationSequence}`,
        kind: "enrollment",
        record: expected,
      };
      records.splice(index, 1);
      deletions.push(deletion);
      return deletion;
    },
    async restoreForget(deletion) {
      const index = deletions.findIndex((candidate) => candidate.operationId === deletion.operationId);
      if (index < 0) throw Object.assign(new Error("deletion is no longer current"), { code: "enrollment-conflict" });
      if (deletion.kind === "enrollment") records.push(deletion.record);
      else pending.push(deletion.record as CollaborationPendingCreationRecord);
      deletions.splice(index, 1);
      return deletion.record;
    },
    async completeForget(deletion) {
      const index = deletions.findIndex((candidate) => candidate.operationId === deletion.operationId);
      if (index < 0) return false;
      deletions.splice(index, 1);
      return true;
    },
    async reserveDeletion(path) {
      const reservation: CollaborationPathDeletionReservation = {
        schemaVersion: 1,
        operationId: `reservation-${++operationSequence}`,
        path,
      };
      reservations.push(reservation);
      return reservation;
    },
    async releaseDeletion(reservation) {
      const index = reservations.findIndex((candidate) => candidate.operationId === reservation.operationId);
      if (index < 0) return false;
      reservations.splice(index, 1);
      return true;
    },
  };
}

function projectionMetadataStore(
  initial: readonly ProjectionMetadataEntry[] = [],
): {
  readonly store: ProjectionMetadataStore;
  readonly remove: ReturnType<typeof vi.fn>;
} {
  const entries = new Map(initial.map((entry) => [entry.record.file.id, structuredClone(entry)]));
  let sequence = initial.reduce((highest, entry) => Math.max(highest, Number(entry.revision) || 0), 0);
  const remove = vi.fn(async (record: ProjectionMetadataRecord, expectedRevision: string) => {
    const current = entries.get(record.file.id);
    if (!current) return false;
    if (
      current.revision !== expectedRevision ||
      JSON.stringify(current.record) !== JSON.stringify(record)
    ) {
      throw Object.assign(new Error("projection metadata changed before delete"), {
        code: "metadata-conflict",
      });
    }
    entries.delete(record.file.id);
    return true;
  });
  return {
    store: {
      async load(fileId) { return structuredClone(entries.get(fileId) ?? null); },
      async save(record: ProjectionMetadataRecord, expectedRevision: string | null) {
        const current = entries.get(record.file.id);
        if ((current?.revision ?? null) !== expectedRevision) {
          throw Object.assign(new Error("projection metadata changed before save"), {
            code: "metadata-conflict",
          });
        }
        const entry = { record: structuredClone(record), revision: String(++sequence) };
        entries.set(record.file.id, entry);
        return structuredClone(entry);
      },
      delete: remove,
    },
    remove,
  };
}

function projectionEntry(
  fileId = asFileId("file-a"),
  documentId = asDocumentId("document-a"),
): ProjectionMetadataEntry {
  const markdown = "# A\n";
  return {
    revision: "1",
    record: {
      file: { id: fileId, path: "Notes/A.md" },
      documentId,
      base: {
        markdown,
        contentHash: hashMarkdown(markdown),
        documentRevision: "1",
        fileVersion: "sha256:a",
      },
    },
  };
}

function createCollaborationWorkspace(
  options: Omit<CollaborationWorkspaceOptions, "projectionMetadata"> &
    Partial<Pick<CollaborationWorkspaceOptions, "projectionMetadata">>,
) {
  return createWorkspaceUnderTest({
    projectionMetadata: projectionMetadataStore().store,
    ...options,
  });
}

function file(): CollaborationWorkspaceFile {
  return {
    path: "Notes/A.md",
    title: "A",
    markdown: "# A\n",
    editor: {} as EditorAPI,
    setReadOnly: vi.fn(),
  };
}

function backendHarness() {
  const session = new FakeSession();
  const activateCredential = vi.fn();
  const stageReauthentication = vi.fn();
  const close = vi.fn(async () => undefined);
  const backend: CollaborationWorkspaceBackend = {
    serverUrl: "wss://collab.example.com",
    workflow: {
      create: vi.fn(async () => session),
      join: vi.fn(async () => session),
      resume: vi.fn(async () => session),
      get: vi.fn(),
      list: vi.fn(() => []),
      subscribe: vi.fn(() => () => undefined),
      close: vi.fn(async () => undefined),
    },
    activateCredential,
    stageReauthentication,
    close,
  };
  const factory: CollaborationWorkspaceBackendFactory = {
    inspectInvitation: vi.fn(() => ({
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      userId: "invitee-a",
      role: "editor" as const,
      expiresAt: Date.now() + 60_000,
    })),
    create: vi.fn(() => backend),
  };
  return { session, backend, factory, activateCredential, stageReauthentication, close };
}

describe("Electron Collaboration Workspace", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates a durable enrollment and attaches without allowing silent replacement", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });

    await workspace.create({
      file: file(),
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "editor-token", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    });

    expect(harness.activateCredential).toHaveBeenCalledWith(asDocumentId("document-a"), {
      token: "editor-token",
      userId: "owner-a",
      role: "editor",
    }, "owner");
    expect(harness.session.attachEditor).toHaveBeenCalledWith(
      expect.objectContaining({ editor: expect.anything() }),
      expect.objectContaining({
        content: "require-match",
        presence: expect.objectContaining({ userId: "owner-a", name: "Owner" }),
      }),
    );
    expect(await enrollments.findByPath("Notes/A.md")).toMatchObject({
      fileId: "file-a",
      documentId: "document-a",
      serverUrl: "wss://collab.example.com",
      access: "owner",
    });
    expect(JSON.stringify(workspace.getState())).not.toContain("editor-token");
    expect(workspace.getState()).toMatchObject({ phase: "active", attachment: "attached" });
  });

  it("retains the owner capability in memory and retries an atomic enrollment commit after a write failure", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const beginCreation = vi.spyOn(enrollments, "beginCreation");
    const commitCreation = vi.spyOn(enrollments, "commitCreation")
      .mockRejectedValueOnce(Object.assign(new Error("storage unavailable"), {
        code: "enrollment-write-failed",
      }));
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });
    const currentFile = file();

    await expect(workspace.create({
      file: currentFile,
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "owner-secret", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    })).rejects.toMatchObject({ code: "enrollment-write-failed" });

    expect(beginCreation).toHaveBeenCalledWith(expect.objectContaining({
      fileId: "file-a",
      documentId: "document-a",
      access: "owner",
    }));
    expect(beginCreation.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(harness.backend.workflow.create).mock.invocationCallOrder[0]!,
    );
    expect(beginCreation.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(harness.factory.create).mock.invocationCallOrder[0]!,
    );
    await expect(enrollments.findPendingCreationByPath("Notes/A.md")).resolves.toMatchObject({
      fileId: "file-a",
      documentId: "document-a",
    });
    expect(workspace.getState()).toMatchObject({
      phase: "failed",
      attachment: "none",
      pendingCreation: { fileId: "file-a", documentId: "document-a" },
      diagnostic: { code: "enrollment-recovery-required" },
    });
    expect(workspace.canRetryPendingCreationWithoutCredential("Notes/A.md")).toBe(true);
    expect(harness.session.leave).not.toHaveBeenCalled();
    expect(harness.close).not.toHaveBeenCalled();
    expect(harness.session.attachEditor).not.toHaveBeenCalled();
    expect(JSON.stringify(workspace.getState())).not.toContain("owner-secret");

    await workspace.retryPendingCreation({ file: currentFile });

    expect(commitCreation).toHaveBeenCalledTimes(2);
    expect(harness.factory.create).toHaveBeenCalledTimes(1);
    expect(harness.backend.workflow.resume).not.toHaveBeenCalled();
    expect(harness.session.attachEditor).toHaveBeenCalledTimes(1);
    await expect(enrollments.findPendingCreationByPath("Notes/A.md")).resolves.toBeNull();
    await expect(enrollments.findByPath("Notes/A.md")).resolves.toMatchObject({ documentId: "document-a" });
    expect(workspace.getState()).toMatchObject({ phase: "active", attachment: "attached" });
  });

  it("does not create a backend or remote document when the durable creation intent cannot be written", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    vi.spyOn(enrollments, "beginCreation").mockRejectedValueOnce(Object.assign(
      new Error("storage unavailable"),
      { code: "enrollment-write-failed" },
    ));
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });

    await expect(workspace.create({
      file: file(),
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "owner-secret", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    })).rejects.toMatchObject({ code: "enrollment-write-failed" });

    expect(harness.factory.create).not.toHaveBeenCalled();
    expect(harness.backend.workflow.create).not.toHaveBeenCalled();
    expect(workspace.getState()).toMatchObject({ phase: "failed", attachment: "none" });
  });

  it("moves a retained pending creation and its projection to the renamed file identity", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    vi.spyOn(enrollments, "commitCreation").mockRejectedValueOnce(Object.assign(
      new Error("storage unavailable"),
      { code: "enrollment-write-failed" },
    ));
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });
    await expect(workspace.create({
      file: file(),
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "owner-secret", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    })).rejects.toMatchObject({ code: "enrollment-write-failed" });

    await workspace.moveFile("Archive/A.md", "Archived A");

    expect(harness.session.moveFile).toHaveBeenCalledWith({ id: "file-a", path: "Archive/A.md" });
    await expect(enrollments.findPendingCreationByPath("Notes/A.md")).resolves.toBeNull();
    await expect(enrollments.findPendingCreationByPath("Archive/A.md")).resolves.toMatchObject({
      fileId: "file-a",
      title: "Archived A",
    });
    expect(workspace.canRetryPendingCreationWithoutCredential("Notes/A.md")).toBe(false);
    expect(workspace.canRetryPendingCreationWithoutCredential("Archive/A.md")).toBe(true);
  });

  it("recovers a pending creation after restart only with a newly supplied owner credential", async () => {
    const pending: CollaborationPendingCreationRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "owner",
      title: "A",
    };
    const enrollments = enrollmentStore([], [pending]);
    const harness = backendHarness();
    const workspace = createCollaborationWorkspace({ enrollments, backends: harness.factory });
    const currentFile = file();

    await expect(workspace.findPendingCreation("Notes/A.md")).resolves.toEqual(pending);
    expect(workspace.canRetryPendingCreationWithoutCredential("Notes/A.md")).toBe(false);

    await workspace.retryPendingCreation({
      file: currentFile,
      credential: { token: "restored-owner-secret", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    });

    expect(harness.activateCredential).toHaveBeenCalledWith(
      asDocumentId("document-a"),
      { token: "restored-owner-secret", userId: "owner-a", role: "editor" },
      "owner",
    );
    expect(harness.backend.workflow.resume).toHaveBeenCalledWith({
      file: { id: "file-a", path: "Notes/A.md" },
      document: {
        id: "document-a",
        hostIdentity: "wss://collab.example.com",
        sourcePath: "Notes/A.md",
        title: "A",
      },
      access: "owner",
      projectionMode: "enroll",
    });
    expect(harness.session.attachEditor).toHaveBeenCalledTimes(1);
    await expect(enrollments.findPendingCreationByPath("Notes/A.md")).resolves.toBeNull();
    await expect(enrollments.findByPath("Notes/A.md")).resolves.toEqual(pending);
    expect(JSON.stringify(workspace.getState())).not.toContain("restored-owner-secret");
  });

  it("creates the same pending identity only after recovery proves the remote document is absent", async () => {
    const pending: CollaborationPendingCreationRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "owner",
      title: "A",
    };
    const enrollments = enrollmentStore([], [pending]);
    const harness = backendHarness();
    vi.mocked(harness.backend.workflow.resume).mockRejectedValueOnce(Object.assign(
      new Error("missing remote document"),
      { code: "document-not-found" },
    ));
    const workspace = createCollaborationWorkspace({ enrollments, backends: harness.factory });
    const currentFile = file();

    await workspace.retryPendingCreation({
      file: currentFile,
      credential: { token: "restored-owner-secret", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    });

    expect(harness.backend.workflow.resume).toHaveBeenCalledWith(expect.objectContaining({
      projectionMode: "enroll",
    }));
    expect(harness.backend.workflow.create).toHaveBeenCalledWith({
      file: { id: "file-a", path: "Notes/A.md" },
      document: {
        id: "document-a",
        hostIdentity: "wss://collab.example.com",
        sourcePath: "Notes/A.md",
        title: "A",
      },
      initialMarkdown: "# A\n",
    });
    await expect(enrollments.findByPath("Notes/A.md")).resolves.toEqual(pending);
  });

  it("keeps recovery pending and never creates on an ambiguous remote-open failure", async () => {
    const pending: CollaborationPendingCreationRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "owner",
      title: "A",
    };
    const enrollments = enrollmentStore([], [pending]);
    const harness = backendHarness();
    vi.mocked(harness.backend.workflow.resume).mockRejectedValueOnce(Object.assign(
      new Error("request outcome unknown"),
      { code: "network-request-failed" },
    ));
    const workspace = createCollaborationWorkspace({ enrollments, backends: harness.factory });

    await expect(workspace.retryPendingCreation({
      file: file(),
      credential: { token: "restored-owner-secret", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    })).rejects.toMatchObject({ code: "network-request-failed" });

    expect(harness.backend.workflow.create).not.toHaveBeenCalled();
    await expect(enrollments.findPendingCreationByPath("Notes/A.md")).resolves.toEqual(pending);
    expect(workspace.getState()).toMatchObject({
      pendingCreationRecovery: "credential-required",
      diagnostic: { code: "enrollment-recovery-required" },
    });
  });

  it("revalidates the captured document context before persisting or attaching an opened session", async () => {
    const harness = backendHarness();
    const opened = deferred<CollaborationWorkflowSession>();
    vi.mocked(harness.backend.workflow.create).mockImplementationOnce(() => opened.promise);
    const enrollments = enrollmentStore();
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });
    let activePath = "Notes/A.md";

    const creating = workspace.create({
      file: file(),
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "editor-token", userId: "owner-a", role: "editor" },
      displayName: "Owner",
      assertContextCurrent: () => {
        if (activePath !== "Notes/A.md") {
          throw Object.assign(new Error("The active document changed"), {
            code: "document-context-changed",
          });
        }
      },
    });
    await vi.waitFor(() => expect(harness.backend.workflow.create).toHaveBeenCalledTimes(1));

    activePath = "Notes/B.md";
    opened.resolve(harness.session);

    await expect(creating).rejects.toMatchObject({ code: "document-context-changed" });
    expect(await enrollments.findByPath("Notes/A.md")).toBeNull();
    expect(harness.session.attachEditor).not.toHaveBeenCalled();
    expect(await enrollments.findPendingCreationByPath("Notes/A.md")).toMatchObject({
      fileId: "file-a",
      documentId: "document-a",
    });
    expect(workspace.getState()).toMatchObject({
      pendingCreationRecovery: "in-memory",
      diagnostic: { code: "enrollment-recovery-required" },
    });
    expect(harness.session.leave).not.toHaveBeenCalled();
    expect(harness.close).not.toHaveBeenCalled();

    await workspace.close();
    expect(harness.session.leave).toHaveBeenCalledWith({ discardUnprojected: true });
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("joins through an inspected invitation and keeps content mismatch behind an explicit action", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const upsert = vi.spyOn(enrollments, "upsert");
    harness.session.attachEditor.mockRejectedValueOnce(Object.assign(new Error("mismatch"), {
      code: "content-mismatch",
    }));
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });

    await workspace.join({ file: file(), invitation: "opaque invite", displayName: "Editor" });

    expect(harness.factory.inspectInvitation).toHaveBeenCalledWith("opaque invite");
    expect(harness.backend.workflow.join).toHaveBeenCalledWith(expect.objectContaining({
      invitation: "opaque invite",
      projectionMode: "enroll",
    }));
    expect(upsert).toHaveBeenCalledWith({
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    });
    expect(workspace.getState()).toMatchObject({
      phase: "active",
      attachment: "content-mismatch",
      diagnostic: { code: "editor-content-mismatch" },
    });
    await expect(workspace.flushFileProjection()).rejects.toMatchObject({ code: "editor-content-mismatch" });
    expect(harness.session.flushFileProjection).not.toHaveBeenCalled();
    await expect(workspace.leave()).rejects.toMatchObject({ code: "unsafe-leave" });
    expect(harness.session.leave).not.toHaveBeenCalled();

    await workspace.useSharedContent();
    expect(harness.session.attachEditor).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ content: "replace-editor" }),
    );
    expect(workspace.getState()).toMatchObject({ attachment: "attached" });
  });

  it("begins the durable join transaction before workflow projection and completes it before activation", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const commitEnrollment = vi.fn(async () => ({
      schemaVersion: 1 as const,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor" as const,
      title: "A",
    }));
    const complete = vi.fn(async () => undefined);
    const begin = vi.fn(async (input: CollaborationEnrollmentInput) => ({
      intent: {
        schemaVersion: 1 as const,
        operationId: "join-durable-a",
        owner: {
          vaultId: "vault-a" as never,
          senderId: 7,
          sessionId: "session-a" as never,
        },
        phase: "opening" as const,
        enrollment: { schemaVersion: 1 as const, ...input },
      },
      commitEnrollment,
      complete,
    }));
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      joinTransactions: { begin },
      createFileId: () => asFileId("file-a"),
    });

    await workspace.join({ file: file(), invitation: "opaque invite", displayName: "Editor" });

    expect(begin).toHaveBeenCalledWith(expect.objectContaining({
      fileId: "file-a",
      path: "Notes/A.md",
      documentId: "document-a",
    }));
    expect(begin.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(harness.backend.workflow.join).mock.invocationCallOrder[0]!,
    );
    expect(commitEnrollment.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(harness.backend.workflow.join).mock.invocationCallOrder[0]!,
    );
    expect(complete.mock.invocationCallOrder[0]).toBeLessThan(
      harness.session.attachEditor.mock.invocationCallOrder[0]!,
    );
  });

  it("retains the durable join intent and null-base identity when projection may have written before failure", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const metadata = projectionMetadataStore();
    const nullBaseEntry: ProjectionMetadataRecord = {
      ...projectionEntry().record,
      base: null,
    };
    const projectionFailure = Object.assign(
      new Error("metadata save failed after atomic file write"),
      { code: "metadata-write-failed" },
    );
    vi.mocked(harness.backend.workflow.join).mockImplementationOnce(async () => {
      await metadata.store.save(nullBaseEntry, null);
      throw projectionFailure;
    });
    const transaction = {
      intent: {
        schemaVersion: 1 as const,
        operationId: "join-write-before-base",
        owner: {
          vaultId: "vault-a" as never,
          senderId: 7,
          sessionId: "session-a" as never,
        },
        phase: "opening" as const,
        enrollment: {
          schemaVersion: 1 as const,
          fileId: asFileId("file-a"),
          path: "Notes/A.md",
          documentId: asDocumentId("document-a"),
          serverUrl: "wss://collab.example.com",
          access: "editor" as const,
          title: "A",
        },
      },
      commitEnrollment: vi.fn(),
      complete: vi.fn(),
    };
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      joinTransactions: { begin: vi.fn(async () => transaction) },
      createFileId: () => asFileId("file-a"),
    });

    await expect(workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
    })).rejects.toBe(projectionFailure);

    await expect(metadata.store.load(asFileId("file-a"))).resolves.toMatchObject({
      record: { file: { id: "file-a", path: "Notes/A.md" }, documentId: "document-a", base: null },
    });
    expect(metadata.remove).not.toHaveBeenCalled();
    expect(transaction.commitEnrollment).not.toHaveBeenCalled();
    expect(transaction.complete).not.toHaveBeenCalled();
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("removes the exact Projection Base when document context changes after join", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });
    const contextFailure = Object.assign(new Error("The active document changed"), {
      code: "document-context-changed",
    });

    await expect(workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
      assertContextCurrent: () => {
        throw contextFailure;
      },
    })).rejects.toBe(contextFailure);

    await expect(enrollments.findByFileId(asFileId("file-a"))).resolves.toBeNull();
    await expect(metadata.store.load(asFileId("file-a"))).resolves.toBeNull();
    expect(harness.session.closed).toBe(true);
    expect(metadata.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      harness.session.leave.mock.invocationCallOrder.at(-1)!,
    );
    expect(metadata.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      harness.close.mock.invocationCallOrder.at(-1)!,
    );
    expect(harness.session.attachEditor).not.toHaveBeenCalled();
  });

  it("removes a Projection Base created before join rejects without returning a session", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const metadata = projectionMetadataStore();
    const joinFailure = Object.assign(new Error("projection watcher failed"), {
      code: "projection-failed",
    });
    vi.mocked(harness.backend.workflow.join).mockImplementationOnce(async () => {
      await metadata.store.save(projectionEntry().record, null);
      throw joinFailure;
    });
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });

    await expect(workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
    })).rejects.toBe(joinFailure);

    await expect(metadata.store.load(asFileId("file-a"))).resolves.toBeNull();
    await expect(enrollments.findByFileId(asFileId("file-a"))).resolves.toBeNull();
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("retains an exact Enrollment when a pre-session join failure cannot remove its Projection Base", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const metadata = projectionMetadataStore();
    const joinFailure = Object.assign(new Error("projection watcher failed"), {
      code: "projection-failed",
    });
    const cleanupFailure = Object.assign(new Error("projection cleanup failed"), {
      code: "metadata-conflict",
    });
    vi.mocked(harness.backend.workflow.join).mockImplementationOnce(async () => {
      await metadata.store.save(projectionEntry().record, null);
      throw joinFailure;
    });
    metadata.remove.mockRejectedValueOnce(cleanupFailure);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });

    await expect(workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
    })).rejects.toMatchObject({
      code: "projection-failed",
      errors: [joinFailure, cleanupFailure],
      recovery: "join-enrollment-retained",
    });

    await expect(enrollments.findByFileId(asFileId("file-a"))).resolves.toMatchObject({
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      access: "editor",
    });
    await expect(metadata.store.load(asFileId("file-a"))).resolves.toEqual(projectionEntry());
    expect(workspace.getState()).toMatchObject({
      diagnostic: { message: expect.stringContaining("Enrollment was retained") },
    });
  });

  it.each([
    { label: "was not committed", commitBeforeFailure: false },
    { label: "was committed before its acknowledgement failed", commitBeforeFailure: true },
  ])("removes join identity when Enrollment upsert $label", async ({ commitBeforeFailure }) => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const upsert = enrollments.upsert.bind(enrollments);
    const upsertFailure = Object.assign(new Error("Enrollment storage unavailable"), {
      code: "enrollment-write-failed",
    });
    vi.spyOn(enrollments, "upsert").mockImplementationOnce(async (input) => {
      if (commitBeforeFailure) await upsert(input);
      throw upsertFailure;
    });
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });

    await expect(workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
    })).rejects.toBe(upsertFailure);

    await expect(enrollments.findByFileId(asFileId("file-a"))).resolves.toBeNull();
    await expect(enrollments.listIdentityDeletions()).resolves.toEqual([]);
    await expect(metadata.store.load(asFileId("file-a"))).resolves.toBeNull();
    expect(harness.session.closed).toBe(true);
    expect(metadata.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      harness.close.mock.invocationCallOrder.at(-1)!,
    );
  });

  it("exposes the exact Enrollment tombstone when final cleanup acknowledgement fails", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const completionFailure = Object.assign(new Error("Enrollment cleanup acknowledgement failed"), {
      code: "enrollment-write-failed",
    });
    vi.spyOn(enrollments, "completeForget").mockRejectedValueOnce(completionFailure);
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });
    const contextFailure = Object.assign(new Error("The active document changed"), {
      code: "document-context-changed",
    });
    let contextChecks = 0;

    const result = await Promise.allSettled([workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
      assertContextCurrent: () => {
        contextChecks += 1;
        if (contextChecks === 2) throw contextFailure;
      },
    })]);

    expect(result[0]?.status).toBe("rejected");
    if (result[0]?.status === "rejected") {
      expect(result[0].reason).toMatchObject({
        code: "document-context-changed",
        errors: [contextFailure, completionFailure],
      });
    }
    await expect(enrollments.findByFileId(asFileId("file-a"))).resolves.toBeNull();
    await expect(enrollments.listIdentityDeletions()).resolves.toEqual([
      expect.objectContaining({
        kind: "enrollment",
        record: expect.objectContaining({
          fileId: asFileId("file-a"),
          path: "Notes/A.md",
          documentId: asDocumentId("document-a"),
        }),
      }),
    ]);
    await expect(metadata.store.load(asFileId("file-a"))).resolves.toBeNull();
    expect(workspace.getState()).toMatchObject({
      diagnostic: { message: expect.stringContaining("cleanup is retained") },
    });
  });

  it("retains an exact Enrollment recovery marker when failed join teardown cannot confirm session close", async () => {
    const harness = backendHarness();
    const sessionCloseFailure = new Error("session did not close");
    harness.session.leave.mockRejectedValueOnce(sessionCloseFailure);
    const enrollments = enrollmentStore();
    const upsert = vi.spyOn(enrollments, "upsert");
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });
    const contextFailure = Object.assign(new Error("The active document changed"), {
      code: "document-context-changed",
    });

    const result = await Promise.allSettled([workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
      assertContextCurrent: () => {
        throw contextFailure;
      },
    })]);

    expect(result[0]?.status).toBe("rejected");
    if (result[0]?.status === "rejected") {
      expect(result[0].reason).toMatchObject({
        code: "document-context-changed",
        errors: expect.arrayContaining([
          contextFailure,
          sessionCloseFailure,
          expect.objectContaining({ code: "projection-cleanup-failed" }),
        ]),
      });
    }
    await expect(enrollments.findByFileId(asFileId("file-a"))).resolves.toEqual({
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    });
    expect(upsert.mock.invocationCallOrder[0]).toBeGreaterThan(
      harness.close.mock.invocationCallOrder.at(-1)!,
    );
    await expect(metadata.store.load(asFileId("file-a"))).resolves.toEqual(projectionEntry());
    expect(metadata.remove).not.toHaveBeenCalled();
    expect(workspace.getState()).toMatchObject({
      phase: "failed",
      diagnostic: {
        code: "document-context-changed",
        message: expect.stringContaining("Enrollment was retained"),
      },
    });
  });

  it("preserves a concurrently advanced Projection Base and aggregates the failed join cleanup", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const metadata = projectionMetadataStore([projectionEntry()]);
    const concurrentMarkdown = "# Concurrent base\n";
    const metadataConflict = Object.assign(
      new Error("Projection Base changed before cleanup"),
      { code: "metadata-conflict" },
    );
    metadata.remove.mockImplementationOnce(async (record, expectedRevision) => {
      await metadata.store.save({
        ...record,
        base: {
          markdown: concurrentMarkdown,
          contentHash: hashMarkdown(concurrentMarkdown),
          documentRevision: "2",
          fileVersion: "sha256:concurrent",
        },
      }, expectedRevision);
      throw metadataConflict;
    });
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });
    const contextFailure = Object.assign(new Error("The active document changed"), {
      code: "document-context-changed",
    });

    const result = await Promise.allSettled([workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
      assertContextCurrent: () => {
        throw contextFailure;
      },
    })]);

    expect(result[0]?.status).toBe("rejected");
    if (result[0]?.status === "rejected") {
      expect(result[0].reason).toMatchObject({
        code: "document-context-changed",
        errors: [contextFailure, metadataConflict],
      });
    }
    await expect(metadata.store.load(asFileId("file-a"))).resolves.toMatchObject({
      revision: "2",
      record: {
        base: {
          markdown: concurrentMarkdown,
          documentRevision: "2",
          fileVersion: "sha256:concurrent",
        },
      },
    });
    await expect(enrollments.findByFileId(asFileId("file-a"))).resolves.toMatchObject({
      path: "Notes/A.md",
      documentId: "document-a",
      serverUrl: "wss://collab.example.com",
      access: "editor",
    });
    expect(workspace.getState()).toMatchObject({
      diagnostic: { message: expect.stringContaining("Enrollment was retained") },
    });
  });

  it("fails closed when another Enrollment claims the allocated FileId during join cleanup", async () => {
    const harness = backendHarness();
    const enrollments = enrollmentStore();
    const findByFileId = enrollments.findByFileId.bind(enrollments);
    let lookupCount = 0;
    vi.spyOn(enrollments, "findByFileId").mockImplementation(async (fileId) => {
      lookupCount += 1;
      if (lookupCount === 2) {
        await enrollments.upsert({
          fileId,
          path: "Notes/Other.md",
          documentId: asDocumentId("document-other"),
          serverUrl: "wss://collab.example.com",
          access: "reader",
          title: "Other",
        });
      }
      return findByFileId(fileId);
    });
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });
    const contextFailure = Object.assign(new Error("The active document changed"), {
      code: "document-context-changed",
    });

    const result = await Promise.allSettled([workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
      assertContextCurrent: () => {
        throw contextFailure;
      },
    })]);

    expect(result[0]?.status).toBe("rejected");
    if (result[0]?.status === "rejected") {
      expect(result[0].reason).toMatchObject({
        code: "document-context-changed",
        errors: expect.arrayContaining([
          contextFailure,
          expect.objectContaining({ code: "projection-cleanup-failed" }),
        ]),
      });
    }
    await expect(enrollments.findByFileId(asFileId("file-a"))).resolves.toMatchObject({
      path: "Notes/Other.md",
      documentId: "document-other",
      access: "reader",
    });
    await expect(metadata.store.load(asFileId("file-a"))).resolves.toEqual(projectionEntry());
    expect(metadata.remove).not.toHaveBeenCalled();
    expect(workspace.getState()).toMatchObject({
      diagnostic: { message: expect.stringContaining("could not be completed safely") },
    });
  });

  it("surfaces a safe action when strict join cannot reuse local Registry authority", async () => {
    const harness = backendHarness();
    vi.mocked(harness.backend.workflow.join).mockRejectedValueOnce(Object.assign(
      new Error("cached replica failure contained invitation-secret"),
      { code: "remote-authority-unavailable" },
    ));
    const workspace = createCollaborationWorkspace({
      enrollments: enrollmentStore(),
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });

    await expect(workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
    })).rejects.toMatchObject({ code: "remote-authority-unavailable" });
    expect(workspace.getState()).toMatchObject({
      phase: "failed",
      attachment: "none",
      diagnostic: {
        code: "remote-authority-unavailable",
        message: "This window already opened a local Replica. Close it before joining from an invitation.",
      },
    });
    expect(workspace.getState().diagnostic?.message).not.toContain("invitation-secret");
  });

  it("waits for an opening session before closing it instead of activating after close", async () => {
    const harness = backendHarness();
    const opened = deferred<CollaborationWorkflowSession>();
    vi.mocked(harness.backend.workflow.create).mockImplementationOnce(() => opened.promise);
    const workspace = createCollaborationWorkspace({
      enrollments: enrollmentStore(),
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });

    const creating = workspace.create({
      file: file(),
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "editor-token", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    });
    await vi.waitFor(() => expect(workspace.getState().phase).toBe("creating"));

    const closing = workspace.close({ discardUnprojected: true });
    await Promise.resolve();
    expect(workspace.closed).toBe(false);
    expect(harness.close).not.toHaveBeenCalled();

    opened.resolve(harness.session);
    await creating;
    await closing;

    expect(harness.session.leave).toHaveBeenCalledWith({ discardUnprojected: true });
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(workspace.getState().phase).toBe("closed");
  });

  it("rolls back an activation that fails before an Editor binding is established", async () => {
    const harness = backendHarness();
    harness.session.attachEditor.mockRejectedValueOnce(new Error("source registration failed"));
    const workspace = createCollaborationWorkspace({
      enrollments: enrollmentStore(),
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });

    await expect(workspace.create({
      file: file(),
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "editor-token", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    })).rejects.toThrow("source registration failed");

    expect(workspace.getState()).toMatchObject({ phase: "failed", attachment: "none" });
    expect(harness.session.leave).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);

    await workspace.close();
    expect(harness.session.leave).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(workspace.getState().phase).toBe("closed");
  });

  it("preserves the opening failure and every session/backend rollback failure", async () => {
    const harness = backendHarness();
    const openingFailure = Object.assign(new Error("source registration failed"), {
      code: "binding-attach-failed",
    });
    const sessionCleanupFailure = new Error("watcher cleanup failed");
    const backendCleanupFailure = new Error("provider cleanup failed");
    harness.session.attachEditor.mockRejectedValueOnce(openingFailure);
    harness.session.leave.mockImplementationOnce(async () => {
      harness.session.closed = true;
      throw sessionCleanupFailure;
    });
    harness.close.mockRejectedValueOnce(backendCleanupFailure);
    const enrollments = enrollmentStore();
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });

    const result = await Promise.allSettled([workspace.join({
      file: file(),
      invitation: "opaque invite",
      displayName: "Editor",
    })]);

    expect(result[0]?.status).toBe("rejected");
    if (result[0]?.status === "rejected") {
      expect(result[0].reason).toBeInstanceOf(AggregateError);
      expect(result[0].reason).toMatchObject({ code: "binding-attach-failed" });
      expect((result[0].reason as AggregateError).errors).toEqual([
        openingFailure,
        sessionCleanupFailure,
        backendCleanupFailure,
      ]);
    }
    expect(harness.session.leave).toHaveBeenCalledWith({ discardUnprojected: true });
    expect(harness.close).toHaveBeenCalledTimes(1);
    await expect(enrollments.findByFileId(asFileId("file-a"))).resolves.toBeNull();
    await expect(enrollments.listIdentityDeletions()).resolves.toEqual([]);
    await expect(metadata.store.load(asFileId("file-a"))).resolves.toBeNull();
  });

  it("does not attach a conflicting projection until the user chooses an authority", async () => {
    const harness = backendHarness();
    const conflict = {
      id: "conflict-a",
      reason: "no-base" as const,
      base: null,
      live: { markdown: "remote\n", revision: "r1" },
      incoming: { markdown: "local\n", version: "v1" },
      hunks: [],
    };
    harness.session.state = {
      ...collaborationSnapshot("editor", "conflicted"),
      projection: {
        ...collaborationSnapshot("editor", "conflicted").projection,
        conflict,
      },
    };
    const workspace = createCollaborationWorkspace({
      enrollments: enrollmentStore(),
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });

    await workspace.join({ file: file(), invitation: "opaque invite", displayName: "Editor" });
    expect(harness.session.attachEditor).not.toHaveBeenCalled();
    expect(workspace.getState()).toMatchObject({ attachment: "projection-conflict" });

    await workspace.resolveFileConflict({ conflictId: "conflict-a", choice: "use-live" });
    expect(harness.session.resolveFileConflict).toHaveBeenCalledWith({
      conflictId: "conflict-a",
      choice: "use-live",
    });
    expect(harness.session.attachEditor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ content: "replace-editor" }),
    );
  });

  it("resumes by persisted identity, reauthenticates in memory, renames, and leaves safely", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const enrollments = enrollmentStore([record]);
    const harness = backendHarness();
    const workspace = createCollaborationWorkspace({ enrollments, backends: harness.factory });

    await workspace.resume({
      file: file(),
      credential: { token: "fresh-token", userId: "editor-a", role: "editor" },
      displayName: "Editor",
    });
    expect(harness.backend.workflow.resume).toHaveBeenCalledWith(expect.objectContaining({
      file: { id: "file-a", path: "Notes/A.md" },
      document: expect.objectContaining({ id: "document-a" }),
      access: "editor",
    }));

    await workspace.reauthenticate({ token: "replacement", userId: "editor-a", role: "editor" });
    expect(harness.stageReauthentication).toHaveBeenCalledWith(asDocumentId("document-a"), {
      token: "replacement",
      userId: "editor-a",
      role: "editor",
    }, "editor");
    expect(harness.session.reauthenticate).toHaveBeenCalledTimes(1);

    await workspace.moveFile("Archive/A.md", "Archived A");
    expect(harness.session.moveFile).toHaveBeenCalledWith({ id: "file-a", path: "Archive/A.md" });
    expect(await enrollments.findByPath("Archive/A.md")).toMatchObject({ documentId: "document-a" });

    await workspace.leave();
    expect(harness.session.leave).toHaveBeenCalledWith({ discardUnprojected: false });
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(workspace.getState()).toMatchObject({ phase: "idle", attachment: "none" });
    expect(await enrollments.findByFileId(asFileId("file-a"))).not.toBeNull();
  });

  it("rejects a concurrent credential refresh before staging over the in-flight credential", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const harness = backendHarness();
    const reconnect = deferred<void>();
    harness.session.reauthenticate.mockImplementation(() => reconnect.promise);
    const workspace = createCollaborationWorkspace({
      enrollments: enrollmentStore([record]),
      backends: harness.factory,
    });
    await workspace.resume({
      file: file(),
      credential: { token: "initial-token", userId: "editor-a", role: "editor" },
      displayName: "Editor",
    });

    const first = workspace.reauthenticate({ token: "first-token", userId: "editor-a", role: "editor" });
    const second = workspace.reauthenticate({ token: "second-token", userId: "editor-a", role: "editor" });
    reconnect.resolve(undefined);
    await first;
    await expect(second).rejects.toMatchObject({ code: "workspace-busy" });

    expect(harness.stageReauthentication).toHaveBeenCalledTimes(1);
    expect(harness.stageReauthentication).toHaveBeenCalledWith(
      asDocumentId("document-a"),
      { token: "first-token", userId: "editor-a", role: "editor" },
      "editor",
    );
    expect(harness.session.reauthenticate).toHaveBeenCalledTimes(1);

    harness.session.reauthenticate.mockResolvedValueOnce(undefined);
    await workspace.reauthenticate({ token: "third-token", userId: "editor-a", role: "editor" });
    expect(harness.stageReauthentication).toHaveBeenCalledTimes(2);
    expect(harness.stageReauthentication).toHaveBeenLastCalledWith(
      asDocumentId("document-a"),
      { token: "third-token", userId: "editor-a", role: "editor" },
      "editor",
    );
    expect(harness.session.reauthenticate).toHaveBeenCalledTimes(2);
  });

  it("clears the Workspace reauthentication gate after failure so the staged credential can be retried", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const harness = backendHarness();
    const reconnect = deferred<void>();
    harness.session.reauthenticate.mockImplementationOnce(() => reconnect.promise);
    const workspace = createCollaborationWorkspace({
      enrollments: enrollmentStore([record]),
      backends: harness.factory,
    });
    await workspace.resume({
      file: file(),
      credential: { token: "initial-token", userId: "editor-a", role: "editor" },
      displayName: "Editor",
    });

    const first = workspace.reauthenticate({ token: "retry-token", userId: "editor-a", role: "editor" });
    const concurrent = workspace.reauthenticate({
      token: "must-not-be-staged",
      userId: "editor-a",
      role: "editor",
    });
    reconnect.reject(new Error("network unavailable"));
    await expect(first).rejects.toThrow("network unavailable");
    await expect(concurrent).rejects.toMatchObject({ code: "workspace-busy" });

    harness.session.reauthenticate.mockResolvedValueOnce(undefined);
    await expect(workspace.reauthenticate({
      token: "retry-token",
      userId: "editor-a",
      role: "editor",
    })).resolves.toBeUndefined();
    expect(harness.stageReauthentication).toHaveBeenCalledTimes(2);
    expect(harness.stageReauthentication.mock.calls.map(([, credential]) => credential.token)).toEqual([
      "retry-token",
      "retry-token",
    ]);
    expect(harness.session.reauthenticate).toHaveBeenCalledTimes(2);
  });

  it.each(["leave", "close"] as const)(
    "waits for reauthentication before Workspace %s releases the active backend",
    async (operation) => {
      const record: CollaborationEnrollmentRecord = {
        schemaVersion: 1,
        fileId: asFileId("file-a"),
        path: "Notes/A.md",
        documentId: asDocumentId("document-a"),
        serverUrl: "wss://collab.example.com",
        access: "editor",
        title: "A",
      };
      const harness = backendHarness();
      const reconnect = deferred<void>();
      harness.session.reauthenticate.mockImplementationOnce(() => reconnect.promise);
      const workspace = createCollaborationWorkspace({
        enrollments: enrollmentStore([record]),
        backends: harness.factory,
      });
      await workspace.resume({
        file: file(),
        credential: { token: "initial-token", userId: "editor-a", role: "editor" },
        displayName: "Editor",
      });

      const authentication = workspace.reauthenticate({
        token: "replacement-token",
        userId: "editor-a",
        role: "editor",
      });
      const shutdown = operation === "leave"
        ? workspace.leave({ discardUnprojected: true })
        : workspace.close({ discardUnprojected: true });
      await Promise.resolve();
      await Promise.resolve();
      const leaveCallsBeforeAuthenticationSettled = harness.session.leave.mock.calls.length;
      const closeCallsBeforeAuthenticationSettled = harness.close.mock.calls.length;

      reconnect.resolve(undefined);
      await expect(authentication).resolves.toBeUndefined();
      await expect(shutdown).resolves.toBeUndefined();

      expect(leaveCallsBeforeAuthenticationSettled).toBe(0);
      expect(closeCallsBeforeAuthenticationSettled).toBe(0);
      expect(harness.session.leave).toHaveBeenCalledTimes(1);
      expect(harness.close).toHaveBeenCalledTimes(1);
      expect(workspace.getState()).toMatchObject({
        phase: operation === "close" ? "closed" : "idle",
        attachment: "none",
      });
    },
  );

  it("fails closed on the new path when projection migration fails after a Vault rename", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const enrollments = enrollmentStore([record]);
    const harness = backendHarness();
    const currentFile = file();
    const workspace = createCollaborationWorkspace({ enrollments, backends: harness.factory });
    await workspace.resume({
      file: currentFile,
      credential: { token: "fresh-token", userId: "editor-a", role: "editor" },
      displayName: "Editor",
    });
    harness.session.moveFile.mockRejectedValueOnce(new Error("projection metadata unavailable"));

    await expect(workspace.moveFile("Archive/A.md", "Archived A")).rejects.toMatchObject({
      code: "file-move-failed",
    });

    expect(await enrollments.findByPath("Archive/A.md")).toMatchObject({
      fileId: "file-a",
      title: "Archived A",
    });
    expect(await enrollments.findByPath("Notes/A.md")).toBeNull();
    expect(harness.session.leave).toHaveBeenCalledWith({ discardUnprojected: true });
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(workspace.getState()).toMatchObject({
      phase: "idle",
      attachment: "none",
      diagnostic: { code: "file-move-failed" },
    });
  });

  it("locks editing when both projection migration and fail-closed leave fail", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const enrollments = enrollmentStore([record]);
    const harness = backendHarness();
    const currentFile = file();
    const workspace = createCollaborationWorkspace({ enrollments, backends: harness.factory });
    await workspace.resume({
      file: currentFile,
      credential: { token: "fresh-token", userId: "editor-a", role: "editor" },
      displayName: "Editor",
    });
    harness.session.moveFile.mockRejectedValueOnce(new Error("projection metadata unavailable"));
    harness.session.leave.mockRejectedValueOnce(new Error("provider close failed"));

    await expect(workspace.moveFile("Archive/A.md", "Archived A")).rejects.toBeInstanceOf(AggregateError);

    expect(currentFile.setReadOnly).toHaveBeenLastCalledWith(true);
    expect(workspace.getState()).toMatchObject({
      phase: "active",
      attachment: "none",
      enrollment: { path: "Archive/A.md" },
      diagnostic: { code: "file-move-failed" },
    });
    await expect(workspace.flushFileProjection()).rejects.toMatchObject({ code: "editor-content-mismatch" });
  });

  it("keeps an unsafe session active until discard is explicitly confirmed", async () => {
    const harness = backendHarness();
    harness.session.leave.mockRejectedValueOnce(Object.assign(new Error("unsafe"), { code: "unsafe-leave" }));
    const workspace = createCollaborationWorkspace({
      enrollments: enrollmentStore(),
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });
    await workspace.create({
      file: file(),
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "editor-token", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    });

    await expect(workspace.leave()).rejects.toMatchObject({ code: "unsafe-leave" });
    expect(workspace.getState().phase).toBe("active");
    expect(harness.close).not.toHaveBeenCalled();

    await workspace.leave({ discardUnprojected: true });
    expect(harness.session.leave).toHaveBeenLastCalledWith({ discardUnprojected: true });
    expect(workspace.getState().phase).toBe("idle");
  });

  it("releases Editor state but propagates backend cleanup failure after leave", async () => {
    const harness = backendHarness();
    const cleanupFailure = new Error("replica store close failed");
    harness.close.mockRejectedValueOnce(cleanupFailure);
    const currentFile = file();
    const workspace = createCollaborationWorkspace({
      enrollments: enrollmentStore(),
      backends: harness.factory,
      createFileId: () => asFileId("file-a"),
    });
    await workspace.create({
      file: currentFile,
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "editor-token", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    });

    await expect(workspace.leave()).rejects.toBe(cleanupFailure);

    expect(currentFile.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(workspace.getState()).toMatchObject({
      phase: "idle",
      attachment: "none",
      diagnostic: { code: "backend-cleanup-failed" },
    });
    await expect(workspace.flushFileProjection()).rejects.toMatchObject({ code: "workspace-not-active" });
  });

  it("forgets an inactive enrollment and its exact Projection Base together", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const enrollments = enrollmentStore([record]);
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: backendHarness().factory,
      projectionMetadata: metadata.store,
    });

    await expect(workspace.forget("Notes/A.md")).resolves.toBe(true);

    await expect(enrollments.findByPath("Notes/A.md")).resolves.toBeNull();
    await expect(metadata.store.load(record.fileId)).resolves.toBeNull();
    const expected = projectionEntry();
    expect(metadata.remove).toHaveBeenCalledWith(expected.record, expected.revision);
  });

  it("keeps the enrollment when a concurrent Projection Base update defeats CAS cleanup", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const enrollments = enrollmentStore([record]);
    const expected = projectionEntry();
    const metadata = projectionMetadataStore([expected]);
    metadata.remove.mockImplementationOnce(async () => {
      throw Object.assign(new Error("projection metadata changed before delete"), {
        code: "metadata-conflict",
      });
    });
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: backendHarness().factory,
      projectionMetadata: metadata.store,
    });

    await expect(workspace.forget("Notes/A.md")).rejects.toMatchObject({ code: "metadata-conflict" });

    await expect(enrollments.findByPath("Notes/A.md")).resolves.toEqual(record);
    await expect(metadata.store.load(record.fileId)).resolves.toEqual(expected);
  });

  it("does not let a stale window forget an enrollment renamed by another window", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const enrollments = enrollmentStore([record]);
    const current = await enrollments.rename(record, "Archive/A.md", "Archived A");
    vi.spyOn(enrollments, "findByPath").mockResolvedValueOnce(record);
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: backendHarness().factory,
      projectionMetadata: metadata.store,
    });

    await expect(workspace.forget("Notes/A.md")).rejects.toMatchObject({ code: "enrollment-conflict" });
    await expect(enrollments.findByFileId(record.fileId)).resolves.toEqual(current);
    expect(metadata.remove).not.toHaveBeenCalled();
  });

  it("does not let stale Projection Base rollback overwrite a newer enrollment", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const enrollments = enrollmentStore([record]);
    const metadata = projectionMetadataStore([projectionEntry()]);
    const current: CollaborationEnrollmentRecord = {
      ...record,
      path: "Archive/A.md",
      title: "Archived A",
    };
    metadata.remove.mockImplementationOnce(async () => {
      const deletion = (await enrollments.listIdentityDeletions())[0]!;
      await enrollments.completeForget(deletion);
      await enrollments.upsert(current);
      throw Object.assign(new Error("projection metadata changed before delete"), {
        code: "metadata-conflict",
      });
    });
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: backendHarness().factory,
      projectionMetadata: metadata.store,
    });

    await expect(workspace.forget("Notes/A.md")).rejects.toMatchObject({
      code: "metadata-conflict",
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "enrollment-conflict" }),
      ]),
    });
    await expect(enrollments.findByFileId(record.fileId)).resolves.toEqual(current);
  });

  it("does not forget an enrollment while another workspace opening can create a new one", async () => {
    const existing: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-existing"),
      path: "Notes/Existing.md",
      documentId: asDocumentId("document-existing"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "Existing",
    };
    const enrollments = enrollmentStore([existing]);
    const metadata = projectionMetadataStore([projectionEntry(existing.fileId, existing.documentId)]);
    const harness = backendHarness();
    const opening = deferred<CollaborationWorkflowSession>();
    vi.mocked(harness.backend.workflow.join).mockImplementationOnce(() => opening.promise);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-new"),
    });
    const joining = workspace.join({
      file: { ...file(), path: "Notes/New.md" },
      invitation: "opaque invite",
      displayName: "Editor",
    });
    await vi.waitFor(() => expect(workspace.getState().phase).toBe("joining"));

    await expect(workspace.forget("Notes/Existing.md")).rejects.toMatchObject({ code: "workspace-busy" });
    expect(metadata.remove).not.toHaveBeenCalled();
    await expect(enrollments.findByPath("Notes/Existing.md")).resolves.toEqual(existing);

    opening.resolve(harness.session);
    await joining;
    await workspace.leave({ discardUnprojected: true });
  });

  it("abandons a pending creation only after its retained resources close, then removes its Projection Base", async () => {
    const enrollments = enrollmentStore();
    vi.spyOn(enrollments, "commitCreation").mockRejectedValueOnce(Object.assign(
      new Error("storage unavailable"),
      { code: "enrollment-write-failed" },
    ));
    const metadata = projectionMetadataStore([projectionEntry()]);
    const harness = backendHarness();
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: harness.factory,
      projectionMetadata: metadata.store,
      createFileId: () => asFileId("file-a"),
    });
    await expect(workspace.create({
      file: file(),
      serverUrl: "wss://collab.example.com",
      documentId: asDocumentId("document-a"),
      credential: { token: "owner-token", userId: "owner-a", role: "editor" },
      displayName: "Owner",
    })).rejects.toMatchObject({ code: "enrollment-write-failed" });

    await expect(workspace.forgetPendingCreation("Notes/A.md")).resolves.toBe(true);

    expect(harness.session.leave).toHaveBeenCalledWith({ discardUnprojected: true });
    expect(harness.close).toHaveBeenCalled();
    expect(metadata.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      harness.close.mock.invocationCallOrder.at(-1)!,
    );
    await expect(enrollments.findPendingCreationByPath("Notes/A.md")).resolves.toBeNull();
    await expect(metadata.store.load(asFileId("file-a"))).resolves.toBeNull();
  });

  it("does not let a stale window abandon a pending creation renamed by another window", async () => {
    const pending: CollaborationPendingCreationRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "owner",
      title: "A",
    };
    const enrollments = enrollmentStore([], [pending]);
    const current = await enrollments.rename(pending, "Archive/A.md", "Archived A");
    vi.spyOn(enrollments, "findPendingCreationByPath").mockResolvedValueOnce(pending);
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: backendHarness().factory,
      projectionMetadata: metadata.store,
    });

    await expect(workspace.forgetPendingCreation("Notes/A.md"))
      .rejects.toMatchObject({ code: "enrollment-conflict" });
    await expect(enrollments.findPendingCreationByPath(current.path)).resolves.toEqual(current);
    expect(metadata.remove).not.toHaveBeenCalled();
  });

  it("enumerates durable identity tombstones and finishes them only after an explicit action", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const enrollments = enrollmentStore([record]);
    await enrollments.forget(record);
    const metadata = projectionMetadataStore([projectionEntry()]);
    const workspace = createCollaborationWorkspace({
      enrollments,
      backends: backendHarness().factory,
      projectionMetadata: metadata.store,
    });

    const [recovery] = await workspace.listIncompleteEnrollmentMutations();
    expect(recovery).toMatchObject({ projectionState: "present" });
    await expect(enrollments.findByFileId(record.fileId)).resolves.toBeNull();
    expect(recovery).toBeDefined();

    await workspace.finishIncompleteEnrollmentMutation(recovery!.deletion);
    await expect(enrollments.findByFileId(record.fileId)).resolves.toBeNull();
    await expect(enrollments.listIdentityDeletions()).resolves.toEqual([]);
    await expect(metadata.store.load(record.fileId)).resolves.toBeNull();
  });

  it("never restores another live window's tombstone while that window is deleting Projection Base", async () => {
    const record: CollaborationEnrollmentRecord = {
      schemaVersion: 1,
      fileId: asFileId("file-a"),
      path: "Notes/A.md",
      documentId: asDocumentId("document-a"),
      serverUrl: "wss://collab.example.com",
      access: "editor",
      title: "A",
    };
    const enrollments = enrollmentStore([record]);
    const metadata = projectionMetadataStore([projectionEntry()]);
    const releaseFirstDelete = deferred<void>();
    metadata.remove.mockImplementationOnce(async () => {
      await releaseFirstDelete.promise;
      return false;
    });
    const firstWindow = createCollaborationWorkspace({
      enrollments,
      backends: backendHarness().factory,
      projectionMetadata: metadata.store,
    });
    const recoveryWindow = createCollaborationWorkspace({
      enrollments,
      backends: backendHarness().factory,
      projectionMetadata: metadata.store,
    });

    const forgetting = firstWindow.forget(record.path);
    await vi.waitFor(async () => expect(await enrollments.listIdentityDeletions()).toHaveLength(1));
    const [recovery] = await recoveryWindow.listIncompleteEnrollmentMutations();
    expect(recovery).toMatchObject({ projectionState: "present" });

    await recoveryWindow.finishIncompleteEnrollmentMutation(recovery!.deletion);
    releaseFirstDelete.resolve();
    await expect(forgetting).resolves.toBe(true);

    await expect(enrollments.findByFileId(record.fileId)).resolves.toBeNull();
    await expect(enrollments.listIdentityDeletions()).resolves.toEqual([]);
    await expect(metadata.store.load(record.fileId)).resolves.toBeNull();
  });
});
