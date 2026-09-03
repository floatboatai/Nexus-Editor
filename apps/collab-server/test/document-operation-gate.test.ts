import { describe, expect, it, vi } from "vitest";

import {
  documentOperationKey,
  DocumentOperationGate,
  tokenOperationKey,
} from "../src/document-operation-gate";

describe("DocumentOperationGate", () => {
  it("linearizes revocation after an admitted update while another room keeps progressing", async () => {
    const gate = new DocumentOperationGate();
    const tokenKey = tokenOperationKey("alice-token");
    const documentKey = documentOperationKey("room-a");
    const releaseUpdateToken = await gate.acquire(tokenKey);
    const releaseUpdateDocument = await gate.acquire(documentKey);
    let revoked = false;
    let applied = false;
    const revoke = gate.runExclusive(tokenKey, () => {
      revoked = true;
    });
    const revokeSettled = vi.fn();
    void revoke.then(revokeSettled);

    await expect(gate.runExclusive(tokenOperationKey("bob-token"), () => {
      return gate.runExclusive(documentOperationKey("room-b"), () => "healthy");
    })).resolves.toBe("healthy");
    expect(revokeSettled).not.toHaveBeenCalled();
    applied = true;
    releaseUpdateDocument();
    releaseUpdateToken();
    await revoke;

    expect(applied).toBe(true);
    expect(revoked).toBe(true);
    await expect(gate.runExclusive(tokenKey, () => {
      return gate.runExclusive(documentKey, () => {
        if (revoked) return "rejected";
        applied = true;
        return "applied";
      });
    })).resolves.toBe("rejected");
  });

  it("releases a failed operation so revocation cannot deadlock", async () => {
    const gate = new DocumentOperationGate();
    const tokenKey = tokenOperationKey("alice-token");
    const documentKey = documentOperationKey("room-a");
    await expect(gate.runExclusive(tokenKey, () => {
      return gate.runExclusive(documentKey, () => {
        throw new Error("validation failed");
      });
    })).rejects.toThrow("validation failed");
    await expect(gate.runExclusive(tokenKey, () => "revoked")).resolves.toBe("revoked");
  });
});
