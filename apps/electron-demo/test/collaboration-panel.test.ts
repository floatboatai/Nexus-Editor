import type { EditorAPI } from "@floatboat/nexus-core";
import {
  asDocumentId,
  asFileId,
  type CollaborationWorkflowSnapshot,
} from "@floatboat/nexus-plugin-collab";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCollaborationPanel } from "../src/renderer/collaboration-panel";
import type {
  CollaborationEnrollmentRecord,
  CollaborationPendingCreationRecord,
  CollaborationPendingJoin,
} from "../src/renderer/collaboration-enrollment-store";
import type {
  CollaborationWorkspace,
  CollaborationWorkspaceFile,
  CollaborationWorkspaceSnapshot,
} from "../src/renderer/collaboration-workspace";

function enrollment(): CollaborationEnrollmentRecord {
  return {
    schemaVersion: 1,
    fileId: asFileId("file-a"),
    path: "Notes/A.md",
    documentId: asDocumentId("document-a"),
    serverUrl: "wss://collab.example.com",
    access: "editor",
    title: "A",
  };
}

function sessionSnapshot(): CollaborationWorkflowSnapshot {
  const record = enrollment();
  return {
    enrollment: "active",
    access: "editor",
    documentId: record.documentId,
    file: { id: record.fileId, path: record.path },
    collaboration: {
      id: record.documentId,
      lifecycle: "open",
      transport: "online",
      sync: "synced",
      authentication: "authenticated",
      access: "read-write",
      persistence: "clean",
      consistency: "healthy",
      peers: [{ clientId: 2, userId: "peer", name: "Peer", color: "#2563eb" }],
      bindings: 1,
    },
    projection: {
      documentId: record.documentId,
      file: { id: record.fileId, path: record.path },
      projection: "clean",
    },
    peers: [{ clientId: 2, userId: "peer", name: "Peer", color: "#2563eb" }],
    capabilities: {
      canEdit: true,
      canInvite: false,
      canResolveConflict: false,
      canRetryConnection: false,
      canRetryPersistence: false,
      canReauthenticate: false,
      canRetryProjection: false,
      canLeave: true,
    },
  };
}

function workspaceHarness(initial: CollaborationWorkspaceSnapshot) {
  let state = initial;
  const listeners = new Set<(snapshot: CollaborationWorkspaceSnapshot) => void>();
  const workspace = {
    closed: false,
    getState: () => state,
    subscribe: vi.fn((listener: (snapshot: CollaborationWorkspaceSnapshot) => void) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    }),
    findEnrollment: vi.fn<CollaborationWorkspace["findEnrollment"]>(async () => null),
    findPendingCreation: vi.fn<CollaborationWorkspace["findPendingCreation"]>(async () => null),
    canRetryPendingCreationWithoutCredential: vi.fn<CollaborationWorkspace["canRetryPendingCreationWithoutCredential"]>(() => false),
    listIncompleteEnrollmentMutations: vi.fn(async () => []),
    finishIncompleteEnrollmentMutation: vi.fn(async () => undefined),
    restoreIncompleteEnrollmentMutation: vi.fn(async () => undefined),
    create: vi.fn<CollaborationWorkspace["create"]>(async () => undefined),
    join: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    retryPendingCreation: vi.fn<CollaborationWorkspace["retryPendingCreation"]>(async () => undefined),
    useSharedContent: vi.fn(async () => undefined),
    createInvite: vi.fn(async () => ({ value: "invite-secret", role: "reader" as const })),
    retryConnection: vi.fn(async () => undefined),
    retryPersistence: vi.fn(async () => undefined),
    flushFileProjection: vi.fn(async () => undefined),
    retryFileProjection: vi.fn(async () => undefined),
    reauthenticate: vi.fn(async () => undefined),
    resolveFileConflict: vi.fn(async () => undefined),
    moveFile: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    forget: vi.fn(async () => true),
    forgetEnrollment: vi.fn(async () => true),
    forgetPendingCreation: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
  } satisfies CollaborationWorkspace;
  return {
    workspace,
    emit(next: CollaborationWorkspaceSnapshot) {
      state = next;
      for (const listener of listeners) listener(next);
    },
  };
}

function pendingCreation(): CollaborationPendingCreationRecord {
  return {
    ...enrollment(),
    access: "owner",
  };
}

function pendingJoin(): CollaborationPendingJoin {
  return {
    schemaVersion: 1,
    operationId: "join-crash",
    owner: {
      vaultId: "vault-a" as CollaborationPendingJoin["owner"]["vaultId"],
      senderId: 7,
      sessionId: "11111111-1111-4111-8111-panel" as CollaborationPendingJoin["owner"]["sessionId"],
    },
    phase: "opening",
    enrollment: enrollment(),
  };
}

const currentEditor = {} as EditorAPI;

function currentFile(): CollaborationWorkspaceFile {
  return {
    path: "Notes/A.md",
    title: "A",
    markdown: "# A\n",
    editor: currentEditor,
    setReadOnly: vi.fn(),
  };
}

function input(name: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
}

beforeEach(() => document.body.replaceChildren());

describe("Collaboration product panel", () => {
  it("offers resume for a durable enrollment and never renders a credential after submit", async () => {
    const harness = workspaceHarness({
      phase: "idle",
      attachment: "none",
      serverPersistence: "unverified",
    });
    harness.workspace.findEnrollment.mockResolvedValue(enrollment());
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
      createDocumentId: () => asDocumentId("generated-document"),
    });
    document.body.append(panel.element);
    await panel.open();

    expect(document.body.textContent).toContain("Resume collaboration");
    input("resume-user-id").value = "editor-a";
    input("resume-display-name").value = "Editor";
    input("resume-token").value = "top-secret-token";
    document.querySelector<HTMLFormElement>("[data-collaboration-form='resume']")!
      .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(harness.workspace.resume).toHaveBeenCalled());
    expect(harness.workspace.resume).toHaveBeenCalledWith(expect.objectContaining({
      credential: { token: "top-secret-token", userId: "editor-a", role: "editor" },
      displayName: "Editor",
    }));
    expect(panel.element.textContent).not.toContain("top-secret-token");
    expect(panel.element.querySelector<HTMLInputElement>("[name='resume-token']")?.value ?? "").toBe("");
    panel.destroy();
  });

  it("recovers a pending creation after restart with an owner credential that is immediately cleared", async () => {
    const harness = workspaceHarness({
      phase: "idle",
      attachment: "none",
      serverPersistence: "unverified",
    });
    harness.workspace.findPendingCreation.mockResolvedValue(pendingCreation());
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
    });
    document.body.append(panel.element);
    await panel.open();

    expect(panel.element.textContent).toContain("Recover pending creation");
    expect(panel.element.textContent).toContain("document-a");
    expect(panel.element.querySelector("[data-collaboration-form='create']")).toBeNull();
    input("pending-user-id").value = "owner-a";
    input("pending-display-name").value = "Owner";
    input("pending-token").value = "pending-owner-secret";
    panel.element.querySelector<HTMLFormElement>("[data-collaboration-form='pending-creation']")!
      .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(harness.workspace.retryPendingCreation).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: { token: "pending-owner-secret", userId: "owner-a", role: "editor" },
        displayName: "Owner",
        assertContextCurrent: expect.any(Function),
      }),
    ));
    expect(panel.element.textContent).not.toContain("pending-owner-secret");
    expect(panel.element.querySelector<HTMLInputElement>("[name='pending-token']")?.value ?? "").toBe("");
    panel.destroy();
  });

  it("retries an in-memory pending enrollment without asking for the owner token again", async () => {
    const pending = pendingCreation();
    const harness = workspaceHarness({
      phase: "failed",
      attachment: "none",
      serverPersistence: "unavailable",
      pendingCreation: pending,
      pendingCreationRecovery: "in-memory",
      diagnostic: { code: "enrollment-recovery-required", message: "Retry enrollment." },
    });
    harness.workspace.findPendingCreation.mockResolvedValue(pending);
    harness.workspace.canRetryPendingCreationWithoutCredential.mockReturnValue(true);
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
    });
    document.body.append(panel.element);
    await panel.open();

    expect(panel.element.textContent).toContain("Retry enrollment and attach");
    expect(panel.element.querySelector("[name='pending-token']")).toBeNull();
    panel.element.querySelector<HTMLButtonElement>("[data-pending-action='retry']")!.click();

    await vi.waitFor(() => expect(harness.workspace.retryPendingCreation).toHaveBeenCalledWith({
      file: expect.objectContaining({ path: "Notes/A.md" }),
      assertContextCurrent: expect.any(Function),
    }));
    panel.destroy();
  });

  it("creates with an explicit DocumentId and shows unsaved-buffer risk before enrollment", async () => {
    const harness = workspaceHarness({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    const runOpening = vi.fn(async (
      file: CollaborationWorkspaceFile,
      operation: (
        currentFile: CollaborationWorkspaceFile,
        assertContextCurrent: () => void,
      ) => Promise<void>,
    ) => operation(file, () => undefined));
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => true,
      createDocumentId: () => asDocumentId("generated-document"),
      runOpening,
    });
    document.body.append(panel.element);
    await panel.open();

    expect(panel.element.textContent).toContain("unsaved");
    input("create-server-url").value = "wss://collab.example.com";
    input("create-document-id").value = "generated-document";
    input("create-user-id").value = "owner-a";
    input("create-display-name").value = "Owner";
    input("create-token").value = "editor-token";
    document.querySelector<HTMLFormElement>("[data-collaboration-form='create']")!
      .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(harness.workspace.create).toHaveBeenCalledWith(expect.objectContaining({
      serverUrl: "wss://collab.example.com",
      documentId: "generated-document",
      credential: { token: "editor-token", userId: "owner-a", role: "editor" },
    })));
    expect(runOpening).toHaveBeenCalledWith(expect.objectContaining({ path: "Notes/A.md" }), expect.any(Function));
    expect(harness.workspace.create).toHaveBeenCalledWith(expect.objectContaining({
      assertContextCurrent: expect.any(Function),
    }));
    panel.destroy();
  });

  it("shows an actionable local-storage error when post-action enrollment refresh fails", async () => {
    const harness = workspaceHarness({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    harness.workspace.findEnrollment
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(Object.assign(new Error("storage offline"), {
        code: "enrollment-read-failed",
      }));
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
      createDocumentId: () => asDocumentId("generated-document"),
    });
    document.body.append(panel.element);
    await panel.open();

    input("create-user-id").value = "owner-a";
    input("create-display-name").value = "Owner";
    input("create-token").value = "owner-token";
    panel.element.querySelector<HTMLFormElement>("[data-collaboration-form='create']")!
      .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(panel.element.textContent).toContain(
      "Local collaboration enrollment storage could not be read",
    ));
    expect(panel.element.textContent).not.toContain("storage offline");
    panel.destroy();
  });

  it("reads the latest Editor buffer instead of publishing the file snapshot captured by render", async () => {
    const harness = workspaceHarness({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    let file = currentFile();
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: () => file,
      isCurrentFileDirty: () => true,
      createDocumentId: () => asDocumentId("generated-document"),
    });
    document.body.append(panel.element);
    await panel.open();

    file = { ...file, markdown: "# edited after panel render\n" };
    input("create-user-id").value = "owner-a";
    input("create-display-name").value = "Owner";
    input("create-token").value = "editor-token";
    document.querySelector<HTMLFormElement>("[data-collaboration-form='create']")!
      .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(harness.workspace.create).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ markdown: "# edited after panel render\n" }),
      assertContextCurrent: expect.any(Function),
    })));
    panel.destroy();
  });

  it("allocates a fresh default DocumentId for each consecutively enrolled file", async () => {
    const harness = workspaceHarness({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    const files: Record<string, CollaborationWorkspaceFile> = {
      "Notes/A.md": currentFile(),
      "Notes/B.md": {
        ...currentFile(),
        path: "Notes/B.md",
        title: "B",
        markdown: "# B\n",
      },
    };
    let current = files["Notes/A.md"]!;
    const records = new Map<string, CollaborationEnrollmentRecord>();
    harness.workspace.findEnrollment.mockImplementation(async (path) => records.get(path) ?? null);
    harness.workspace.create.mockImplementation(async (options) => {
      const record: CollaborationEnrollmentRecord = {
        schemaVersion: 1,
        fileId: asFileId(`file-${options.file.title.toLocaleLowerCase()}`),
        path: options.file.path,
        documentId: options.documentId,
        serverUrl: options.serverUrl,
        access: "owner",
        title: options.file.title,
      };
      records.set(record.path, record);
      harness.emit({
        phase: "active",
        attachment: "attached",
        serverPersistence: "server-synchronized",
        enrollment: record,
        session: sessionSnapshot(),
      });
    });
    const documentIds = [asDocumentId("document-for-a"), asDocumentId("document-for-b")];
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: () => current,
      isCurrentFileDirty: () => false,
      createDocumentId: vi.fn(() => documentIds.shift()!),
    });
    document.body.append(panel.element);
    await panel.open();

    expect(input("create-document-id").value).toBe("document-for-a");
    input("create-user-id").value = "owner-a";
    input("create-display-name").value = "Owner A";
    input("create-token").value = "token-a";
    document.querySelector<HTMLFormElement>("[data-collaboration-form='create']")!
      .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(harness.workspace.create).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(harness.workspace.findEnrollment).toHaveBeenCalledTimes(2));

    harness.emit({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    current = files["Notes/B.md"]!;
    await panel.refreshFile();

    expect(input("create-document-id").value).toBe("document-for-b");
    input("create-user-id").value = "owner-b";
    input("create-display-name").value = "Owner B";
    input("create-token").value = "token-b";
    document.querySelector<HTMLFormElement>("[data-collaboration-form='create']")!
      .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(harness.workspace.create).toHaveBeenCalledTimes(2));

    expect(harness.workspace.create.mock.calls.map(([options]) => ({
      path: options.file.path,
      documentId: options.documentId,
    }))).toEqual([
      { path: "Notes/A.md", documentId: "document-for-a" },
      { path: "Notes/B.md", documentId: "document-for-b" },
    ]);
    panel.destroy();
  });

  it("renders orthogonal status, safe Presence text, and generation-bound conflict actions", async () => {
    const baseActive = sessionSnapshot();
    const maliciousPeer = {
      ...baseActive.peers[0]!,
      name: "<img src=x onerror=alert(1)>",
    };
    const active = {
      ...baseActive,
      peers: [maliciousPeer],
      collaboration: { ...baseActive.collaboration, peers: [maliciousPeer] },
    };
    const conflict = {
      id: "conflict-generation-2",
      reason: "overlapping-edits" as const,
      base: "base\n",
      live: { markdown: "live\n", revision: "r2" },
      incoming: { markdown: "disk\n", version: "v2" },
      hunks: [],
    };
    const harness = workspaceHarness({
      phase: "active",
      attachment: "projection-conflict",
      serverPersistence: "server-synchronized",
      enrollment: enrollment(),
      session: {
        ...active,
        projection: { ...active.projection, projection: "conflicted", conflict },
        capabilities: { ...active.capabilities, canResolveConflict: true },
      },
    });
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
      createDocumentId: () => asDocumentId("generated-document"),
    });
    document.body.append(panel.element);
    await panel.open();

    expect(panel.element.textContent).toContain("Network");
    expect(panel.element.textContent).toContain("Local replica");
    expect(panel.element.textContent).toContain("Server sync");
    expect(panel.element.textContent).toContain("File projection");
    expect(panel.element.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(panel.element.querySelector("img")).toBeNull();

    document.querySelector<HTMLButtonElement>("[data-conflict-action='use-live']")!.click();
    await vi.waitFor(() => expect(harness.workspace.resolveFileConflict).toHaveBeenCalledWith({
      conflictId: "conflict-generation-2",
      choice: "use-live",
    }));
    panel.destroy();
  });

  it("exposes local persistence recovery only when the active workflow reports it as retryable", async () => {
    const active = sessionSnapshot();
    const harness = workspaceHarness({
      phase: "active",
      attachment: "attached",
      serverPersistence: "server-synchronized",
      enrollment: enrollment(),
      session: {
        ...active,
        collaboration: { ...active.collaboration, persistence: "failed" },
        capabilities: { ...active.capabilities, canRetryPersistence: true },
      },
    });
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
    });
    document.body.append(panel.element);
    await panel.open();

    panel.element.querySelector<HTMLButtonElement>("[data-session-action='retry-persistence']")!.click();
    await vi.waitFor(() => expect(harness.workspace.retryPersistence).toHaveBeenCalledTimes(1));
    panel.destroy();
  });

  it.each([
    [
      "delegation-not-authorized",
      "This credential cannot create invitations. Reauthenticate with an editor credential.",
    ],
    [
      "delegation-outlives-authority",
      "This credential expires too soon for a new invitation. Reauthenticate and try again.",
    ],
    [
      "invitation-request-failed",
      "The collaboration server could not create an invitation. Check the connection and try again.",
    ],
    [
      "invitation-server-mismatch",
      "This invitation belongs to a different collaboration server. Check the invitation server and try again.",
    ],
    [
      "remote-authority-unavailable",
      "This window already opened a local Replica. Close it before joining from an invitation.",
    ],
  ])("shows a safe actionable invite failure for %s", async (code, expectedMessage) => {
    const active = sessionSnapshot();
    const harness = workspaceHarness({
      phase: "active",
      attachment: "attached",
      serverPersistence: "server-synchronized",
      enrollment: enrollment(),
      session: {
        ...active,
        capabilities: { ...active.capabilities, canInvite: true },
      },
    });
    harness.workspace.createInvite.mockRejectedValueOnce(Object.assign(
      new Error("server body contained owner-secret-token"),
      { code },
    ));
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
    });
    document.body.append(panel.element);
    await panel.open();

    Array.from(panel.element.querySelectorAll("button"))
      .find((candidate) => candidate.textContent === "Create reader invite")!
      .click();

    await vi.waitFor(() => expect(panel.element.textContent).toContain(expectedMessage));
    expect(panel.element.textContent).not.toContain("owner-secret-token");
    panel.destroy();
  });

  it.each([
    { access: "reader", role: "reader" },
    { access: "editor", role: "editor" },
    { access: "owner", role: "editor" },
  ] as const)("reauthenticates a revoked $access with the retained Enrollment role", async ({ access, role }) => {
    const active = sessionSnapshot();
    const harness = workspaceHarness({
      phase: "active",
      attachment: "attached",
      serverPersistence: "unverified",
      enrollment: { ...enrollment(), access },
      session: {
        ...active,
        access: "revoked",
        collaboration: { ...active.collaboration, authentication: "revoked", access: "none" },
        capabilities: { ...active.capabilities, canEdit: false, canReauthenticate: true },
      },
    });
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
    });
    document.body.append(panel.element);
    await panel.open();

    input("reauth-user-id").value = "participant-a";
    input("reauth-token").value = "replacement-participant-token";
    panel.element.querySelector<HTMLFormElement>(".nexus-collaboration__reauth")!
      .dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(harness.workspace.reauthenticate).toHaveBeenCalledWith({
      token: "replacement-participant-token", userId: "participant-a", role,
    }));
    expect(panel.element.textContent).not.toContain("replacement-participant-token");
    expect(input("reauth-token").value).toBe("");
    panel.destroy();
  });

  it("does not guess a reauthentication role when Enrollment membership is unavailable", async () => {
    const active = sessionSnapshot();
    const harness = workspaceHarness({
      phase: "active",
      attachment: "attached",
      serverPersistence: "unverified",
      session: {
        ...active,
        access: "revoked",
        capabilities: { ...active.capabilities, canEdit: false, canReauthenticate: true },
      },
    });
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
    });
    document.body.append(panel.element);
    await panel.open();

    expect(panel.element.querySelector(".nexus-collaboration__reauth")).toBeNull();
    expect(harness.workspace.reauthenticate).not.toHaveBeenCalled();
    panel.destroy();
  });

  it("absorbs an asynchronous developer action failure and shows a safe visible error", async () => {
    const harness = workspaceHarness({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      unhandled.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
      openDeveloperLab: async () => {
        throw new Error("developer-secret-diagnostic");
      },
    });
    document.body.append(panel.element);
    await panel.open();

    Array.from(panel.element.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent === "Open developer lab")!
      .click();

    await vi.waitFor(() => expect(panel.element.textContent).toContain(
      "The collaboration action failed. Review the status details and try again.",
    ));
    expect(panel.element.textContent).not.toContain("developer-secret-diagnostic");
    expect(unhandled).toEqual([]);

    window.removeEventListener("unhandledrejection", onUnhandled);
    panel.destroy();
  });

  it("offers a read-only participant only the conflict action that cannot replace shared content", async () => {
    const active = sessionSnapshot();
    const conflict = {
      id: "reader-conflict",
      reason: "read-only" as const,
      base: "base\n",
      live: { markdown: "shared\n", revision: "r2" },
      incoming: { markdown: "disk\n", version: "v2" },
      hunks: [],
    };
    const harness = workspaceHarness({
      phase: "active",
      attachment: "projection-conflict",
      serverPersistence: "server-synchronized",
      enrollment: { ...enrollment(), access: "reader" },
      session: {
        ...active,
        access: "reader",
        collaboration: { ...active.collaboration, access: "read-only" },
        projection: { ...active.projection, projection: "conflicted", conflict },
        capabilities: { ...active.capabilities, canEdit: false, canResolveConflict: true },
      },
    });
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
    });
    document.body.append(panel.element);
    await panel.open();

    expect(panel.element.textContent).toContain("Read-only participants");
    expect(panel.element.querySelector("[data-conflict-action='use-live']")).not.toBeNull();
    expect(panel.element.querySelector("[data-conflict-action='use-disk']")).toBeNull();
    expect(panel.element.querySelector(".nexus-collaboration__manual-merge")).toBeNull();

    panel.element.querySelector<HTMLButtonElement>("[data-conflict-action='use-live']")!.click();
    await vi.waitFor(() => expect(harness.workspace.resolveFileConflict).toHaveBeenCalledWith({
      conflictId: "reader-conflict",
      choice: "use-live",
    }));
    panel.destroy();
  });

  it("shows durable file-delete recovery and requires an explicit matching action", async () => {
    const harness = workspaceHarness({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    const recover = vi.fn(async () => undefined);
    const list = vi.fn(async () => [{
      reservation: {
        schemaVersion: 1 as const,
        operationId: "delete-crash",
        path: "Notes/A.md",
      },
      pathState: "present" as const,
    }]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
      fileDeletionRecovery: { list, recover },
    });
    document.body.append(panel.element);
    await panel.open();

    expect(panel.element.textContent).toContain("Incomplete file deletion");
    expect(panel.element.textContent).toContain("Notes/A.md · file still exists");
    Array.from(panel.element.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent === "Abort stale delete")!
      .click();

    await vi.waitFor(() => expect(recover).toHaveBeenCalledWith("delete-crash", "abort"));
    panel.destroy();
  });

  it("shows an uncertain pending join with safe recovery, same-invitation retry, and explicit abandon", async () => {
    const harness = workspaceHarness({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    const recover = vi.fn(async () => undefined);
    const abandon = vi.fn(async () => undefined);
    const list = vi.fn(async () => [{
      pending: pendingJoin(),
      outcome: "pending-evidence" as const,
      message: "Projection outcome is uncertain; pending join and Host fence were retained.",
      hasProjectionMetadata: false,
      canAbandon: true,
    }]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
      pendingJoinRecovery: { list, recover, abandon },
    });
    document.body.append(panel.element);
    await panel.open();

    expect(panel.element.textContent).toContain("Interrupted collaboration join");
    expect(panel.element.textContent).toContain("Paste the same invitation below");
    expect(panel.element.textContent).toContain("never rewrites or deletes the Markdown file");

    panel.element.querySelector<HTMLButtonElement>("[data-pending-join-action='recover']")!.click();
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(
      panel.element.querySelector<HTMLButtonElement>("[data-pending-join-action='abandon']")?.disabled,
    ).toBe(false));

    panel.element.querySelector<HTMLButtonElement>("[data-pending-join-action='abandon']")!.click();
    await vi.waitFor(() => expect(abandon).toHaveBeenCalledWith("join-crash"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(
      "will not rewrite or delete the Markdown file",
    ));
    panel.destroy();
  });

  it("does not offer abandon when a pending join has Projection metadata", async () => {
    const harness = workspaceHarness({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    const recover = vi.fn(async () => undefined);
    const abandon = vi.fn(async () => undefined);
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
      pendingJoinRecovery: {
        list: vi.fn(async () => [{
          pending: pendingJoin(),
          outcome: "blocked-conflict" as const,
          message: "Host release is temporarily unavailable.",
          hasProjectionMetadata: true,
          canAbandon: false,
        }]),
        recover,
        abandon,
      },
    });
    document.body.append(panel.element);
    await panel.open();

    expect(panel.element.textContent).toContain("Projection metadata exists");
    expect(panel.element.textContent).toContain("cannot be abandoned");
    expect(panel.element.querySelector("[data-pending-join-action='abandon']")).toBeNull();
    panel.element.querySelector<HTMLButtonElement>("[data-pending-join-action='recover']")!.click();
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    expect(abandon).not.toHaveBeenCalled();
    panel.destroy();
  });

  it("shows an identity tombstone without recovering it until the user explicitly finishes cleanup", async () => {
    const harness = workspaceHarness({ phase: "idle", attachment: "none", serverPersistence: "unverified" });
    const deletion = {
      schemaVersion: 1 as const,
      operationId: "forget-crash",
      kind: "enrollment" as const,
      record: enrollment(),
    };
    const finish = vi.fn(async () => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const panel = createCollaborationPanel({
      ownerDocument: document,
      workspace: harness.workspace,
      getCurrentFile: currentFile,
      isCurrentFileDirty: () => false,
      enrollmentMutationRecovery: {
        list: vi.fn(async () => [{ deletion, projectionState: "present" as const }]),
        finish,
      },
    });
    document.body.append(panel.element);
    await panel.open();

    expect(finish).not.toHaveBeenCalled();
    expect(panel.element.textContent).toContain("Incomplete enrollment cleanup");
    Array.from(panel.element.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => candidate.textContent === "Finish enrollment cleanup")!
      .click();

    await vi.waitFor(() => expect(finish).toHaveBeenCalledWith(deletion));
    panel.destroy();
  });
});
