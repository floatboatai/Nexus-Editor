import { describe, expect, it, vi } from "vitest";

import { asDocumentId, asFileId } from "@floatboat/nexus-plugin-collab";
import {
  CollaborationEnrollmentStoreError,
  createCollaborationEnrollmentStore,
  type CollaborationEnrollmentInput,
} from "../src/renderer/collaboration-enrollment-store";
import type { PluginHostBridge, PluginStorageSnapshot } from "../src/shared/plugin-ipc";

function enrollment(overrides: Partial<CollaborationEnrollmentInput> = {}): CollaborationEnrollmentInput {
  return {
    fileId: asFileId("file-a"),
    path: "Notes/A.md",
    documentId: asDocumentId("6e917066-f441-49ba-a116-906cb47d88f5"),
    serverUrl: "wss://collab.example.com",
    access: "owner",
    title: "A",
    ...overrides,
  };
}

function storageHarness(initial: PluginStorageSnapshot = { found: false, revision: 0, data: null }) {
  let snapshot = structuredClone(initial);
  const load = vi.fn(async () => structuredClone(snapshot));
  const save = vi.fn(async (_pluginId: string, expectedRevision: number, data: unknown) => {
    if (snapshot.revision !== expectedRevision) {
      return { ok: false as const, revision: snapshot.revision };
    }
    snapshot = {
      found: true,
      revision: snapshot.revision + 1,
      data: structuredClone(data),
    };
    return { ok: true as const, revision: snapshot.revision };
  });
  const bridge = { storage: { load, save } } as Pick<PluginHostBridge, "storage">;
  return {
    bridge,
    load,
    save,
    get snapshot() { return structuredClone(snapshot); },
    replace(next: PluginStorageSnapshot) { snapshot = structuredClone(next); },
  };
}

describe("Electron collaboration enrollment store", () => {
  it("durably advances an exact pending join through Enrollment commit and Host release", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const pending = await store.beginJoin({
      operationId: "join-operation-a",
      owner: {
        vaultId: "vault-a" as never,
        senderId: 41,
        sessionId: "vault-session-join-a" as never,
      },
      enrollment: enrollment({ access: "editor" }),
    });

    expect(pending).toMatchObject({
      phase: "opening",
      operationId: "join-operation-a",
      enrollment: { fileId: "file-a", documentId: "6e917066-f441-49ba-a116-906cb47d88f5" },
    });
    await expect(store.listPendingJoins()).resolves.toEqual([pending]);
    await expect(store.findByFileId(asFileId("file-a"))).resolves.toBeNull();

    const committed = await store.commitJoin(pending);

    await expect(store.findByFileId(asFileId("file-a"))).resolves.toEqual(committed.enrollment);
    await expect(store.listPendingJoins()).resolves.toEqual([committed]);
    expect(committed.phase).toBe("enrollment-committed");

    await expect(store.completeJoin(committed)).resolves.toBe(true);
    await expect(store.listPendingJoins()).resolves.toEqual([]);
    await expect(store.findByFileId(asFileId("file-a"))).resolves.toEqual(committed.enrollment);
  });

  it("reconciles ambiguous pending-join writes and binds projection authority to the exact operation", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const input = {
      operationId: "join-operation-a",
      owner: {
        vaultId: "vault-a" as never,
        senderId: 41,
        sessionId: "vault-session-join-a" as never,
      },
      enrollment: enrollment({ access: "editor" }),
    };
    harness.save.mockImplementationOnce(async (_pluginId, expectedRevision, data) => {
      harness.replace({ found: true, revision: expectedRevision + 1, data });
      throw new Error("response channel closed after durable write");
    });

    const pending = await store.beginJoin(input);

    await expect(store.assertProjectionWriteAuthorized(input.enrollment, {
      openingOperationId: pending.operationId,
    })).resolves.toBeUndefined();
    await expect(store.assertProjectionWriteAuthorized(input.enrollment, {
      openingOperationId: "join-operation-b",
    })).rejects.toMatchObject({ code: "projection-identity-unavailable" });

    harness.save.mockImplementationOnce(async (_pluginId, expectedRevision, data) => {
      harness.replace({ found: true, revision: expectedRevision + 1, data });
      throw new Error("response channel closed after durable write");
    });
    const committed = await store.commitJoin(pending);
    expect(committed.phase).toBe("enrollment-committed");
    await expect(store.listPendingJoins()).resolves.toEqual([committed]);
  });

  it("migrates Enrollment v3 and blocks delete or metadata mutation while a join is recoverable", async () => {
    const v3Enrollment = { schemaVersion: 1 as const, ...enrollment() };
    const harness = storageHarness({
      found: true,
      revision: 3,
      data: {
        schemaVersion: 3,
        enrollments: [v3Enrollment],
        pendingCreations: [],
        identityDeletions: [],
        pathDeletionReservations: [],
      },
    });
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    await expect(store.listPendingJoins()).resolves.toEqual([]);
    await store.upsert({ ...enrollment(), access: "editor" });
    expect(harness.snapshot.data).toMatchObject({ schemaVersion: 4, pendingJoins: [] });

    const joinStore = createCollaborationEnrollmentStore({ bridge: storageHarness().bridge });
    const pending = await joinStore.beginJoin({
      operationId: "join-delete-fence",
      owner: {
        vaultId: "vault-a" as never,
        senderId: 41,
        sessionId: "vault-session-join-a" as never,
      },
      enrollment: enrollment({ access: "editor" }),
    });
    await expect(joinStore.reserveDeletion("Notes"))
      .rejects.toMatchObject({ code: "pending-join-delete-blocked" });
    const committed = await joinStore.commitJoin(pending);
    await expect(joinStore.findByPath(committed.enrollment.path)).resolves.toEqual(committed.enrollment);
    await expect(joinStore.reserveDeletion("Notes"))
      .rejects.toMatchObject({ code: "pending-join-delete-blocked" });
    await expect(joinStore.rename(committed.enrollment, "Notes/Renamed.md"))
      .rejects.toMatchObject({ code: "enrollment-conflict" });
    await expect(joinStore.upsert(enrollment({ access: "editor", title: "changed during recovery" })))
      .rejects.toMatchObject({ code: "enrollment-conflict" });
  });

  it("fails closed when a committed pending join does not have its exact active Enrollment", async () => {
    const record = { schemaVersion: 1 as const, ...enrollment({ access: "editor" }) };
    const harness = storageHarness({
      found: true,
      revision: 4,
      data: {
        schemaVersion: 4,
        enrollments: [],
        pendingCreations: [],
        identityDeletions: [],
        pathDeletionReservations: [],
        pendingJoins: [{
          schemaVersion: 1,
          operationId: "join-corrupt",
          owner: {
            vaultId: "vault-a",
            senderId: 41,
            sessionId: "vault-session-join-a",
          },
          phase: "enrollment-committed",
          enrollment: record,
        }],
      },
    });

    await expect(createCollaborationEnrollmentStore({ bridge: harness.bridge }).list())
      .rejects.toMatchObject({ code: "enrollment-corrupt" });
  });

  it("persists and queries a strictly non-sensitive, versioned enrollment", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });

    const saved = await store.upsert(enrollment({
      path: "Notes/./A.md",
      serverUrl: "wss://collab.example.com/",
      title: " A ",
    }));

    expect(saved).toEqual({
      schemaVersion: 1,
      ...enrollment(),
    });
    await expect(store.findByFileId(asFileId("file-a"))).resolves.toEqual(saved);
    await expect(store.findByPath("Notes//A.md")).resolves.toEqual(saved);
    await expect(store.list()).resolves.toEqual([saved]);
    expect(harness.save).toHaveBeenCalledWith(
      "nexus-collaboration-enrollment",
      0,
      {
        schemaVersion: 4,
        enrollments: [saved],
        pendingCreations: [],
        identityDeletions: [],
        pathDeletionReservations: [],
        pendingJoins: [],
      },
    );
    expect(JSON.stringify(harness.snapshot.data)).not.toMatch(/token|invitation/i);
  });

  it("updates mutable metadata, renames by stable FileId, and forgets explicitly", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    await store.upsert(enrollment());

    await expect(store.upsert(enrollment({ access: "editor", title: "Shared A" }))).resolves.toMatchObject({
      fileId: "file-a",
      documentId: "6e917066-f441-49ba-a116-906cb47d88f5",
      access: "editor",
      title: "Shared A",
    });
    const beforeRename = (await store.findByFileId(asFileId("file-a")))!;
    const renamed = await store.rename(beforeRename, "Archive/A.md", "Archived A");
    expect(renamed).toMatchObject({
      fileId: "file-a",
      documentId: "6e917066-f441-49ba-a116-906cb47d88f5",
      path: "Archive/A.md",
      title: "Archived A",
    });
    await expect(store.findByPath("Notes/A.md")).resolves.toBeNull();
    await expect(store.findByPath("Archive/A.md")).resolves.toEqual(renamed);
    const deletion = await store.forget(renamed);
    expect(deletion).not.toBeNull();
    await expect(store.completeForget(deletion!)).resolves.toBe(true);
    await expect(store.forget(renamed)).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });

  it("rejects identity collisions instead of silently changing mappings", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    await store.upsert(enrollment());

    await expect(store.upsert(enrollment({
      documentId: asDocumentId("another-document"),
    }))).rejects.toMatchObject({ code: "enrollment-conflict" });
    await expect(store.upsert(enrollment({
      fileId: asFileId("file-b"),
    }))).rejects.toMatchObject({ code: "enrollment-conflict" });
    await expect(store.upsert(enrollment({
      fileId: asFileId("file-b"),
      path: "Notes/B.md",
    }))).rejects.toMatchObject({ code: "enrollment-conflict" });

    await expect(store.upsert(enrollment({
      fileId: asFileId("file-b"),
      path: "Notes/B.md",
      serverUrl: "wss://other.example.com",
    }))).resolves.toMatchObject({
      documentId: "6e917066-f441-49ba-a116-906cb47d88f5",
      serverUrl: "wss://other.example.com",
    });
  });

  it("durably records a non-secret pending creation before atomically committing its enrollment", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });

    const pending = await store.beginCreation({ ...enrollment(), access: "owner" });

    await expect(store.findPendingCreationByPath("Notes/A.md")).resolves.toEqual(pending);
    await expect(store.findByPath("Notes/A.md")).resolves.toBeNull();
    expect(harness.snapshot.data).toEqual({
      schemaVersion: 4,
      enrollments: [],
      pendingCreations: [pending],
      identityDeletions: [],
      pathDeletionReservations: [],
      pendingJoins: [],
    });
    expect(JSON.stringify(harness.snapshot.data)).not.toMatch(/token|invitation|credential/i);

    const committed = await store.commitCreation(pending);

    expect(committed).toEqual({ schemaVersion: 1, ...enrollment() });
    await expect(store.findPendingCreationByPath("Notes/A.md")).resolves.toBeNull();
    await expect(store.findByPath("Notes/A.md")).resolves.toEqual(committed);
    expect(harness.snapshot.data).toEqual({
      schemaVersion: 4,
      enrollments: [committed],
      pendingCreations: [],
      identityDeletions: [],
      pathDeletionReservations: [],
      pendingJoins: [],
    });

    await expect(store.commitCreation(pending)).resolves.toEqual(committed);
    expect(harness.save).toHaveBeenCalledTimes(2);
  });

  it("begins the same pending creation idempotently and rejects secret or non-owner intent fields", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const input = { ...enrollment(), access: "owner" as const };

    const first = await store.beginCreation(input);
    await expect(store.beginCreation(input)).resolves.toEqual(first);
    expect(harness.save).toHaveBeenCalledTimes(1);

    await expect(store.beginCreation({ ...input, token: "secret" } as never))
      .rejects.toMatchObject({ code: "enrollment-invalid" });
    await expect(store.beginCreation({ ...input, access: "editor" } as never))
      .rejects.toMatchObject({ code: "enrollment-invalid" });
  });

  it("keeps a pending creation recoverable when the atomic enrollment commit write fails", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const pending = await store.beginCreation({ ...enrollment(), access: "owner" });
    harness.save.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(store.commitCreation(pending)).rejects.toMatchObject({
      code: "enrollment-write-failed",
    });

    await expect(store.findPendingCreationByPath(pending.path)).resolves.toEqual(pending);
    await expect(store.findByPath(pending.path)).resolves.toBeNull();
  });

  it("reconciles an ambiguous commit response by reading back the exact intent", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const pending = await store.beginCreation({ ...enrollment(), access: "owner" });
    harness.save.mockImplementationOnce(async (_pluginId, expectedRevision, data) => {
      harness.replace({ found: true, revision: expectedRevision + 1, data });
      throw new Error("response channel closed after durable write");
    });

    await expect(store.commitCreation(pending)).resolves.toEqual(pending);
    await expect(store.findPendingCreationByPath(pending.path)).resolves.toBeNull();
    await expect(store.findByPath(pending.path)).resolves.toEqual(pending);
  });

  it("checks pending and active records as one identity space and renames a pending file", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const pending = await store.beginCreation({ ...enrollment(), access: "owner" });

    await expect(store.upsert(enrollment({
      fileId: asFileId("file-b"),
      path: "Notes/B.md",
    }))).rejects.toMatchObject({ code: "enrollment-conflict" });

    await expect(store.rename(pending, "Archive/A.md", "Archived A")).resolves.toMatchObject({
      path: "Archive/A.md",
      title: "Archived A",
    });
    await expect(store.findPendingCreationByPath("Notes/A.md")).resolves.toBeNull();
    await expect(store.findPendingCreationByPath("Archive/A.md")).resolves.toMatchObject({
      fileId: "file-a",
      documentId: pending.documentId,
    });
  });

  it("reads legacy v1 enrollment state and migrates it on the next mutation", async () => {
    const legacy = { schemaVersion: 1 as const, ...enrollment() };
    const harness = storageHarness({
      found: true,
      revision: 4,
      data: { schemaVersion: 1, enrollments: [legacy] },
    });
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });

    await expect(store.list()).resolves.toEqual([legacy]);
    await store.upsert(enrollment({ access: "editor" }));

    expect(harness.snapshot.data).toEqual({
      schemaVersion: 4,
      enrollments: [{ ...legacy, access: "editor" }],
      pendingCreations: [],
      identityDeletions: [],
      pathDeletionReservations: [],
      pendingJoins: [],
    });
  });

  it("rejects token or invitation fields at the write boundary", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });

    await expect(store.upsert({
      ...enrollment(),
      token: "secret",
    } as never)).rejects.toMatchObject({ code: "enrollment-invalid" });
    await expect(store.upsert({
      ...enrollment(),
      invitation: "invite-secret",
    } as never)).rejects.toMatchObject({ code: "enrollment-invalid" });
    expect(harness.save).not.toHaveBeenCalled();
  });

  it("fails closed on corrupt or secret-bearing persisted data", async () => {
    const valid = { schemaVersion: 1, ...enrollment() };
    const corruptStates: unknown[] = [
      { schemaVersion: 3, enrollments: [], pendingCreations: [] },
      { schemaVersion: 2, enrollments: [] },
      { schemaVersion: 1, enrollments: [{ ...valid, token: "secret" }] },
      { schemaVersion: 1, enrollments: [{ ...valid, path: "/absolute/A.md" }] },
      { schemaVersion: 1, enrollments: [{ ...valid, serverUrl: "wss://user:secret@collab.example.com" }] },
      { schemaVersion: 1, enrollments: [{ ...valid, access: "revoked" }] },
      { schemaVersion: 1, enrollments: [valid, { ...valid }] },
      { schemaVersion: 1, enrollments: [], invitation: "secret" },
      { schemaVersion: 2, enrollments: [], pendingCreations: [{ ...valid, token: "secret" }] },
      { schemaVersion: 2, enrollments: [], pendingCreations: [{ ...valid, access: "editor" }] },
    ];

    for (const data of corruptStates) {
      const harness = storageHarness({ found: true, revision: 1, data });
      const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });
      await expect(store.list()).rejects.toBeInstanceOf(CollaborationEnrollmentStoreError);
      await expect(store.list()).rejects.toMatchObject({ code: "enrollment-corrupt" });
    }

    const quarantined = storageHarness({ found: false, corrupt: true, revision: 0, data: null });
    const quarantinedStore = createCollaborationEnrollmentStore({ bridge: quarantined.bridge });
    await expect(quarantinedStore.list()).rejects.toMatchObject({ code: "enrollment-corrupt" });
  });

  it("re-reads and merges after a compare-and-swap conflict", async () => {
    const harness = storageHarness();
    const competitor = {
      schemaVersion: 1 as const,
      ...enrollment({
        fileId: asFileId("file-b"),
        path: "Notes/B.md",
        documentId: asDocumentId("document-b"),
        access: "reader",
        title: "B",
      }),
    };
    let conflicted = false;
    harness.save.mockImplementation(async (_pluginId, expectedRevision, data) => {
      if (!conflicted) {
        conflicted = true;
        harness.replace({
          found: true,
          revision: 1,
          data: { schemaVersion: 1, enrollments: [competitor] },
        });
        return { ok: false as const, revision: 1 };
      }
      const current = harness.snapshot;
      expect(expectedRevision).toBe(current.revision);
      harness.replace({ found: true, revision: current.revision + 1, data });
      return { ok: true as const, revision: current.revision + 1 };
    });
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });

    await store.upsert(enrollment());

    await expect(store.list()).resolves.toEqual([competitor, { schemaVersion: 1, ...enrollment() }]);
    expect(harness.save).toHaveBeenCalledTimes(2);
    expect(harness.load).toHaveBeenCalledTimes(3);
  });

  it("bounds repeated compare-and-swap conflicts", async () => {
    const harness = storageHarness();
    harness.save.mockImplementation(async (_pluginId, _expectedRevision) => ({
      ok: false as const,
      revision: harness.snapshot.revision,
    }));
    const store = createCollaborationEnrollmentStore({
      bridge: harness.bridge,
      maxSaveAttempts: 3,
    });

    await expect(store.upsert(enrollment())).rejects.toMatchObject({
      code: "enrollment-write-failed",
    });
    expect(harness.save).toHaveBeenCalledTimes(3);
    expect(harness.load).toHaveBeenCalledTimes(3);
  });

  it("reports a missing rename without creating a new identity", async () => {
    const harness = storageHarness();
    const store = createCollaborationEnrollmentStore({ bridge: harness.bridge });

    await expect(store.rename({
      schemaVersion: 1,
      ...enrollment({ fileId: asFileId("missing"), path: "Notes/Missing.md" }),
    }, "Notes/Missing.md")).rejects.toMatchObject({
      code: "enrollment-not-found",
    });
    expect(harness.save).not.toHaveBeenCalled();
  });

  it("rejects an active-enrollment delete from a window holding a pre-rename record", async () => {
    const harness = storageHarness();
    const staleWindow = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const currentWindow = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const stale = await staleWindow.upsert(enrollment());
    const current = await currentWindow.rename(stale, "Archive/A.md", "Archived A");

    await expect(staleWindow.forget(stale)).rejects.toMatchObject({
      code: "enrollment-conflict",
    });
    await expect(currentWindow.findByFileId(stale.fileId)).resolves.toEqual(current);
  });

  it("rejects a pending-creation abandon from a window holding a pre-rename record", async () => {
    const harness = storageHarness();
    const staleWindow = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const currentWindow = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const stale = await staleWindow.beginCreation({ ...enrollment(), access: "owner" });
    const current = await currentWindow.rename(stale, "Archive/A.md", "Archived A");

    await expect(staleWindow.forgetPendingCreation(stale)).rejects.toMatchObject({
      code: "enrollment-conflict",
    });
    await expect(currentWindow.findPendingCreationByPath(current.path)).resolves.toEqual(current);
  });

  it("restores only its durable identity-deletion marker and never overwrites a newer identity", async () => {
    const harness = storageHarness();
    const deletingWindow = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const currentWindow = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const stale = await deletingWindow.upsert(enrollment());
    const deletion = await deletingWindow.forget(stale);
    expect(deletion).not.toBeNull();

    await currentWindow.completeForget(deletion!);
    const current = await currentWindow.upsert(enrollment({ path: "Archive/A.md", title: "Archived A" }));

    await expect(deletingWindow.restoreForget(deletion!)).rejects.toMatchObject({
      code: "enrollment-conflict",
    });
    await expect(currentWindow.findByFileId(stale.fileId)).resolves.toEqual(current);
  });

  it("reserves a directory delete across Store instances and releases the full subtree afterward", async () => {
    const harness = storageHarness();
    let sequence = 0;
    const deletingWindow = createCollaborationEnrollmentStore({
      bridge: harness.bridge,
      operationIdGenerator: () => `delete-${++sequence}`,
    });
    const creatingWindow = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const reservation = await deletingWindow.reserveDeletion("Notes");

    await expect(creatingWindow.beginCreation({
      ...enrollment({ path: "Notes/Nested/A.md" }),
      access: "owner",
    })).rejects.toMatchObject({ code: "enrollment-delete-reserved" });

    await expect(deletingWindow.releaseDeletion(reservation)).resolves.toBe(true);
    await expect(creatingWindow.beginCreation({
      ...enrollment({ path: "Notes/Nested/A.md" }),
      access: "owner",
    })).resolves.toMatchObject({ path: "Notes/Nested/A.md" });
  });

  it("atomically refuses a delete reservation when a pending creation already exists below it", async () => {
    const harness = storageHarness();
    const pendingWindow = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    const deletingWindow = createCollaborationEnrollmentStore({ bridge: harness.bridge });
    await pendingWindow.beginCreation({
      ...enrollment({ path: "Notes/Nested/A.md" }),
      access: "owner",
    });

    await expect(deletingWindow.reserveDeletion("Notes")).rejects.toMatchObject({
      code: "pending-creation-delete-blocked",
    });
  });

  it("authorizes projection writes only for an exact live identity outside deletion reservations", async () => {
    const harness = storageHarness();
    let sequence = 0;
    const store = createCollaborationEnrollmentStore({
      bridge: harness.bridge,
      operationIdGenerator: () => `mutation-${++sequence}`,
    });
    const identity = enrollment();
    const enrolled = await store.upsert(identity);

    await expect(store.assertProjectionWriteAuthorized(identity)).resolves.toBeUndefined();
    await expect(store.assertProjectionWriteAuthorized({ ...identity, path: "Notes/Stale.md" }))
      .rejects.toMatchObject({ code: "projection-identity-unavailable" });

    const deletion = await store.forget(enrolled);
    expect(deletion).not.toBeNull();
    await expect(store.assertProjectionWriteAuthorized(identity))
      .rejects.toMatchObject({ code: "projection-identity-unavailable" });
    await store.restoreForget(deletion!);

    const reservation = await store.reserveDeletion("Notes");
    await expect(store.assertProjectionWriteAuthorized(identity))
      .rejects.toMatchObject({ code: "enrollment-delete-reserved" });
    await store.releaseDeletion(reservation);

    const restored = (await store.findByFileId(identity.fileId))!;
    const completedDeletion = await store.forget(restored);
    await store.completeForget(completedDeletion!);
    const join = await store.beginJoin({
      operationId: "join-write-a",
      owner: {
        vaultId: "vault-a" as never,
        senderId: 41,
        sessionId: "vault-session-a" as never,
      },
      enrollment: identity,
    });
    await expect(store.assertProjectionWriteAuthorized(identity, {
      openingOperationId: join.operationId,
    })).resolves.toBeUndefined();
    await expect(store.assertProjectionWriteAuthorized(identity, {
      openingOperationId: "join-write-other",
    })).rejects.toMatchObject({ code: "projection-identity-unavailable" });
  });
});
