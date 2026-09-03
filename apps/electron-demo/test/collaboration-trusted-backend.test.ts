import { createEditor } from "@floatboat/nexus-core";
import { asDocumentId, asFileId, type FileProjectionAdapter, type ProjectionMetadataStore } from "@floatboat/nexus-plugin-collab";
import { createAssessmentMemoryStore } from "@floatboat/nexus-plugin-collab/assessment";
import { describe, expect, it, vi } from "vitest";

import { createElectronCollaborationBackendFactory } from "../src/renderer/electron-collaboration-product";
import { encodeCollaborationInvitation } from "../src/renderer/collaboration-network-adapters";
import { createCollaborationWorkspace } from "../src/renderer/collaboration-workspace";
import { createCollaborationEnrollmentStore } from "../src/renderer/collaboration-enrollment-store";
import type { PluginStorageSnapshot } from "../src/shared/plugin-ipc";

const files: FileProjectionAdapter = {
  read: async () => null,
  writeAtomic: async () => { throw new Error("No file write is allowed before enrollment"); },
  watch: async () => ({ dispose: async () => undefined }),
};
const metadata: ProjectionMetadataStore = {
  load: async () => null,
  save: async (record) => ({ record, revision: "1" }),
  delete: async () => true,
};

describe("Host-trusted collaboration backend", () => {
  it("rejects an untrusted create before leaving any durable pending enrollment", async () => {
    let snapshot: PluginStorageSnapshot = { found: false, revision: 0, data: null };
    const save = vi.fn(async (_id: string, revision: number, data: unknown) => {
      if (revision !== snapshot.revision) return { ok: false as const, revision: snapshot.revision };
      snapshot = { found: true, revision: revision + 1, data: structuredClone(data) };
      return { ok: true as const, revision: snapshot.revision };
    });
    const enrollments = createCollaborationEnrollmentStore({ bridge: { storage: {
      load: async () => structuredClone(snapshot), save,
    } } });
    const store = createAssessmentMemoryStore();
    const backends = createElectronCollaborationBackendFactory({
      store, files, metadata, trustedServerUrls: ["wss://collab.example.test"],
    });
    const workspace = createCollaborationWorkspace({ enrollments, projectionMetadata: metadata, backends,
      createFileId: () => asFileId("untrusted-file") });
    const editor = createEditor({ container: document.createElement("div"), initialValue: "local content" });
    try {
      await expect(workspace.create({
        file: { path: "note.md", title: "Note", markdown: "local content", editor, setReadOnly: () => undefined },
        serverUrl: "wss://untrusted.example.test", documentId: asDocumentId("untrusted-document"),
        credential: { token: "owner-capability", userId: "alice", role: "editor" }, displayName: "Alice",
      })).rejects.toMatchObject({ code: "server-not-trusted" });
      await expect(enrollments.findPendingCreationByPath("note.md")).resolves.toBeNull();
      await expect(enrollments.findByPath("note.md")).resolves.toBeNull();
      expect(save).not.toHaveBeenCalled();
      expect(editor.getDocument()).toBe("local content");
    } finally { await workspace.close(); await store.close(); editor.destroy(); }
  });

  it("rejects create and invitation inspection outside the configured exact server list", async () => {
    const now = Date.now();
    const store = createAssessmentMemoryStore();
    const factory = createElectronCollaborationBackendFactory({
      store,
      files,
      metadata,
      trustedServerUrls: ["wss://collab.example.test"],
      now: () => now,
    });
    for (const untrusted of ["wss://untrusted.example.test", "wss://collab.example.test:444"]) {
      expect(() => factory.create(untrusted)).toThrowError(/trusted server/i);
      const invitation = encodeCollaborationInvitation({
        version: 1,
        serverUrl: untrusted,
        documentId: asDocumentId("trusted-server-document"),
        userId: "bob",
        role: "reader",
        token: "temporary-invitation",
        expiresAt: Math.floor(now / 1_000) + 300,
      }, { now: () => now });
      expect(() => factory.inspectInvitation(invitation)).toThrowError(/trusted server/i);
    }
    const backend = factory.create("wss://collab.example.test/");
    expect(backend.serverUrl).toBe("wss://collab.example.test");
    await backend.close();
    await store.close();
  });
});
