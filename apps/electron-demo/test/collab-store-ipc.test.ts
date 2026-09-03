import { describe, expect, it } from "vitest";

import {
  CollabStoreIpcSchemaError,
  parseCollabStoreRequest,
  parseCollabStoreResponse,
} from "../src/shared/collab-store-ipc";

describe("collaboration Store IPC schema", () => {
  it("accepts bounded document and opaque lease operations", () => {
    expect(parseCollabStoreRequest({ operation: "open", documentId: "document-a" })).toEqual({
      operation: "open",
      documentId: "document-a",
    });
    expect(parseCollabStoreRequest({
      operation: "append",
      leaseId: "lease-a",
      update: new Uint8Array([1, 2, 3]),
    })).toMatchObject({ operation: "append", leaseId: "lease-a" });
    expect(parseCollabStoreResponse("load", {
      ok: true,
      updates: [new Uint8Array([4, 5])],
      checkpoint: { generation: "store-a", sequence: 3 },
    })).toEqual({
      ok: true,
      updates: [new Uint8Array([4, 5])],
      checkpoint: { generation: "store-a", sequence: 3 },
    });
    expect(parseCollabStoreRequest({
      operation: "replace-snapshot",
      leaseId: "lease-a",
      update: new Uint8Array([6]),
      through: { generation: "store-a", sequence: 3 },
    })).toMatchObject({ operation: "replace-snapshot", through: { sequence: 3 } });
  });

  it("rejects filesystem, SQL, oversized binary, and malformed union fields", () => {
    for (const value of [
      { operation: "open", documentId: "" },
      { operation: "open", documentId: "a".repeat(257) },
      { operation: "open", documentId: "document-a", databasePath: "/secret/store.sqlite" },
      { operation: "append", leaseId: "lease-a", update: "not-binary" },
      { operation: "append", leaseId: "lease-a", update: new Uint8Array(4 * 1024 * 1024 + 1) },
      { operation: "replace-snapshot", leaseId: "lease-a", update: new Uint8Array([1]) },
      { operation: "sql", statement: "DROP TABLE collab_updates" },
    ]) {
      expect(() => parseCollabStoreRequest(value)).toThrow(CollabStoreIpcSchemaError);
    }
  });

  it("allows structured Store failures without leaking causes", () => {
    expect(parseCollabStoreResponse("append", {
      ok: false,
      error: { code: "document-too-large", message: "Document limit reached" },
    })).toEqual({
      ok: false,
      error: { code: "document-too-large", message: "Document limit reached" },
    });
    expect(() => parseCollabStoreResponse("append", {
      ok: false,
      error: { code: "store-failed", message: "failed", cause: "/private/path" },
    })).toThrow(CollabStoreIpcSchemaError);
  });
});
