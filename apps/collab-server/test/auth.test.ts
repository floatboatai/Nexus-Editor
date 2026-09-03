import { describe, expect, it } from "vitest";

import {
  CollaborationTokenError,
  createCollaborationTokenAuthority,
} from "../src/auth";

const secret = "test-only-secret-that-is-at-least-thirty-two-bytes";
const now = new Date("2026-09-03T00:00:00.000Z");

describe("CollaborationTokenAuthority", () => {
  it("issues room-scoped editor and reader credentials", async () => {
    const authority = createCollaborationTokenAuthority({ secret, now: () => now });
    const editor = await authority.issue({
      userId: "alice",
      documentId: "document-a",
      role: "editor",
      lifetimeSeconds: 300,
    });
    const reader = await authority.issue({
      userId: "bob",
      documentId: "document-a",
      role: "reader",
      lifetimeSeconds: 300,
    });

    await expect(authority.verify(editor.token, "document-a")).resolves.toMatchObject({
      userId: "alice",
      documentId: "document-a",
      role: "editor",
      tokenId: editor.tokenId,
    });
    await expect(authority.verify(reader.token, "document-a")).resolves.toMatchObject({
      userId: "bob",
      role: "reader",
    });
    await expect(authority.verify(editor.token, "document-b")).rejects.toMatchObject({
      code: "wrong-document",
    });
  });

  it("fails closed for malformed, forged, expired, and revoked credentials", async () => {
    let current = now;
    const authority = createCollaborationTokenAuthority({ secret, now: () => current });
    const issued = await authority.issue({
      userId: "alice",
      documentId: "document-a",
      role: "editor",
      lifetimeSeconds: 60,
    });

    await expect(authority.verify("not-a-token", "document-a")).rejects.toBeInstanceOf(
      CollaborationTokenError,
    );
    const tokenParts = issued.token.split(".");
    const signature = tokenParts[2]!;
    const forged = `${tokenParts[0]}.${tokenParts[1]}.${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
    await expect(authority.verify(forged, "document-a")).rejects.toMatchObject({ code: "invalid" });

    current = new Date(now.getTime() + 61_000);
    await expect(authority.verify(issued.token, "document-a")).rejects.toMatchObject({
      code: "expired",
    });
    current = now;
    await authority.revoke(issued.tokenId);
    await expect(authority.verify(issued.token, "document-a")).rejects.toMatchObject({
      code: "revoked",
    });
  });

  it("rejects weak secrets and invalid claim bounds", async () => {
    expect(() => createCollaborationTokenAuthority({ secret: "too-short" })).toThrow(
      "at least 32 bytes",
    );
    expect(() => createCollaborationTokenAuthority({
      secret: "replace-with-at-least-32-random-bytes",
    })).toThrow("placeholder");
    const authority = createCollaborationTokenAuthority({ secret, now: () => now });
    await expect(authority.issue({
      userId: "",
      documentId: "document-a",
      role: "editor",
      lifetimeSeconds: 60,
    })).rejects.toMatchObject({ code: "invalid-claims" });
    await expect(authority.issue({
      userId: "alice",
      documentId: "document\0escape",
      role: "editor",
      lifetimeSeconds: 60,
    })).rejects.toMatchObject({ code: "invalid-claims" });
  });
});
