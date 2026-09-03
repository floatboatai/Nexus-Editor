import { describe, expect, it } from "vitest";

import {
  collaborationStoreErrorResponse,
  parseCollaborationStoreControlMessage,
  parseCollaborationStoreRequest,
  parseCollaborationStoreResponse,
} from "../src/shared/collab-store-protocol";

describe("Collaboration Store MessagePort protocol", () => {
  it("accepts only exact bounded drain control messages", () => {
    expect(parseCollaborationStoreControlMessage({
      type: "drain-request",
      drainId: "drain:1",
    })).toEqual({ type: "drain-request", drainId: "drain:1" });
    expect(parseCollaborationStoreControlMessage({ requestId: "ordinary" })).toBeNull();
    expect(() => parseCollaborationStoreControlMessage({
      type: "drain-ack",
      drainId: "drain:1",
      extra: true,
    })).toThrow("unexpected or missing fields");
  });

  it("copies validated binary requests and responses across the process seam", () => {
    const source = new Uint8Array([1, 2, 3]);
    const request = parseCollaborationStoreRequest({
      requestId: "renderer-1:1",
      operation: "append",
      leaseId: "lease-1",
      update: source,
    });
    source.fill(9);
    expect(request.operation === "append" ? [...request.update] : []).toEqual([1, 2, 3]);

    const response = parseCollaborationStoreResponse({
      requestId: "renderer-1:1",
      ok: true,
      updates: [new Uint8Array([4, 5])],
      checkpoint: { generation: "generation-a", sequence: 7 },
    });
    expect(response.ok ? response.updates?.map((update) => [...update]) : []).toEqual([[4, 5]]);
    expect(response.ok ? response.checkpoint : undefined).toEqual({
      generation: "generation-a",
      sequence: 7,
    });

    expect(parseCollaborationStoreRequest({
      requestId: "renderer-1:2",
      operation: "snapshot",
      leaseId: "lease-1",
      update: new Uint8Array([6]),
      through: { generation: "generation-a", sequence: 7 },
    })).toMatchObject({
      operation: "snapshot",
      through: { generation: "generation-a", sequence: 7 },
    });
  });

  it("rejects ambiguous fields and oversized append payloads", () => {
    expect(() => parseCollaborationStoreRequest({
      requestId: "renderer-1:1",
      operation: "flush",
      leaseId: "lease-1",
      unexpected: true,
    })).toThrow("unexpected or missing fields");

    expect(() => parseCollaborationStoreRequest({
      requestId: "renderer-1:2",
      operation: "append",
      leaseId: "lease-1",
      update: new Uint8Array(4 * 1024 * 1024 + 1),
    })).toThrow("update is too large");

    expect(() => parseCollaborationStoreRequest({
      requestId: "renderer-1:3",
      operation: "snapshot",
      leaseId: "lease-1",
      update: new Uint8Array([1]),
      through: { generation: "generation-a", sequence: -1 },
    })).toThrow("checkpoint sequence is invalid");
  });

  it("accepts the full public DocumentId string contract", () => {
    expect(parseCollaborationStoreRequest({
      requestId: "renderer-1:3",
      operation: "open",
      leaseId: "lease-1",
      documentId: "Host document 01",
    })).toMatchObject({
      operation: "open",
      documentId: "Host document 01",
    });
  });

  it("does not expose messages from untyped Host failures", () => {
    expect(collaborationStoreErrorResponse(
      "renderer-1:1",
      new Error("/private/user/path/replicas.sqlite3 could not be opened"),
    )).toEqual({
      requestId: "renderer-1:1",
      ok: false,
      error: {
        code: "store-failed",
        message: "Collaboration Store operation failed",
      },
    });
  });
});
