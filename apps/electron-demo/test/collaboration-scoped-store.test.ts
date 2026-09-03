import {
  asDocumentId,
  type DocumentId,
  type ReplicaStore,
  type ReplicaStoreLease,
} from "@floatboat/nexus-plugin-collab";
import { describe, expect, it } from "vitest";

import { createServerScopedReplicaStore } from "../src/renderer/collaboration-scoped-store";

function emptyLease(): ReplicaStoreLease {
  return {
    load: async () => ({ updates: [], checkpoint: { generation: "test", sequence: 0 } }),
    append: async () => ({ generation: "test", sequence: 1 }),
    flush: async () => undefined,
    replaceWithSnapshot: async () => ({ generation: "test", sequence: 1 }),
    close: async () => undefined,
  };
}

describe("server-scoped collaboration storage", () => {
  it("isolates the same remote DocumentId across two Provider servers", async () => {
    const opened: DocumentId[] = [];
    const store: ReplicaStore = {
      async open(documentId) {
        opened.push(documentId);
        return emptyLease();
      },
    };
    const documentId = asDocumentId("shared-document");

    await createServerScopedReplicaStore(store, "wss://alpha.example.com").open(documentId);
    await createServerScopedReplicaStore(store, "wss://beta.example.com").open(documentId);

    expect(opened).toHaveLength(2);
    expect(opened[0]).not.toBe(opened[1]);
    expect(opened.every((value) => /^v2\.[0-9a-f]{64}$/u.test(value))).toBe(true);
    expect(opened).not.toContain(documentId);
  });

  it("uses a stable opaque key and never reopens ambiguous version-1 rows", async () => {
    const opened: DocumentId[] = [];
    const store: ReplicaStore = {
      async open(documentId) {
        opened.push(documentId);
        return emptyLease();
      },
    };
    const documentId = asDocumentId("private-room-name");
    const first = createServerScopedReplicaStore(store, "wss://collab.example.com/team");
    const second = createServerScopedReplicaStore(store, "wss://collab.example.com/team");

    await first.open(documentId);
    await second.open(documentId);

    expect(opened[0]).toBe(opened[1]);
    expect(opened[0]).not.toContain("collab.example.com");
    expect(opened[0]).not.toContain("private-room-name");
    expect(opened[0]?.length).toBeLessThanOrEqual(256);
  });
});
