import { asDocumentId } from "@floatboat/nexus-plugin-collab";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CollaborationNetworkError,
  createCollaborationConnectionAdapter,
  createCollaborationInvitationAdapter,
  createHostCollaborationInvitationIssuer,
  createMemoryCollaborationCredentialRegistry,
  decodeCollaborationInvitation,
  encodeCollaborationInvitation,
  type CollaborationInvitationEnvelope,
  type CollaborationNetworkFetch,
} from "../src/renderer/collaboration-network-adapters";

const now = Date.parse("2026-09-03T00:00:00.000Z");
const nowSeconds = Math.floor(now / 1_000);

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function invitation(
  patch: Partial<CollaborationInvitationEnvelope> = {},
): CollaborationInvitationEnvelope {
  return {
    version: 1,
    serverUrl: "wss://collab.example.test/socket",
    documentId: asDocumentId("document-a"),
    userId: "invitee-a",
    role: "reader",
    token: "header.claims.signature",
    expiresAt: nowSeconds + 300,
    ...patch,
  };
}

describe("in-memory Collaboration Credential Registry", () => {
  it("saves, replaces, resolves, and clears credentials without storage or logging", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const documentId = asDocumentId("registry-document");
    const registry = createMemoryCollaborationCredentialRegistry();

    registry.set(documentId, { token: "token-one", role: "owner", userId: "owner-a" });
    expect(registry.get(documentId)).toEqual({ token: "token-one", role: "owner", userId: "owner-a" });
    expect(Object.isFrozen(registry.get(documentId))).toBe(true);
    expect(registry.resolveToken(documentId)).toBe("token-one");

    registry.set(documentId, { token: "token-two", role: "reader", userId: "reader-a" });
    expect(registry.get(documentId)).toEqual({ token: "token-two", role: "reader", userId: "reader-a" });
    registry.clear(documentId);
    expect(registry.get(documentId)).toBeUndefined();
    expect(() => registry.resolveToken(documentId)).toThrowError(CollaborationNetworkError);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("Collaboration invitation envelope codec", () => {
  it("round-trips a compact pasteable JSON envelope", () => {
    const encoded = encodeCollaborationInvitation(invitation(), { now: () => now });

    expect(encoded.startsWith("{")).toBe(true);
    expect(() => new URL(encoded)).toThrow();
    expect(JSON.parse(encoded)).toEqual(invitation());
    expect(decodeCollaborationInvitation(encoded, { now: () => now })).toEqual(invitation());
  });

  it("rejects non-WebSocket URLs, URL secrets, extra or missing keys, oversized values, and expiry", () => {
    const decode = (value: unknown) => decodeCollaborationInvitation(
      typeof value === "string" ? value : JSON.stringify(value),
      { now: () => now },
    );
    const valid = invitation() as unknown as Record<string, unknown>;

    for (const serverUrl of [
      "https://collab.example.test",
      "wss://user:secret@collab.example.test",
      "wss://collab.example.test?token=secret",
      "wss://collab.example.test#secret",
    ]) {
      expect(() => decode({ ...valid, serverUrl })).toThrowError(CollaborationNetworkError);
    }
    expect(() => decode({ ...valid, extra: true })).toThrowError(CollaborationNetworkError);
    const { token: _token, ...missingToken } = valid;
    expect(() => decode(missingToken)).toThrowError(CollaborationNetworkError);
    expect(() => decode({ ...valid, token: "x".repeat(8_193) })).toThrowError(CollaborationNetworkError);
    expect(() => decode({ ...valid, expiresAt: nowSeconds })).toThrowError(CollaborationNetworkError);
    expect(() => decode({ ...valid, expiresAt: nowSeconds + 3_601 })).toThrowError(
      CollaborationNetworkError,
    );
    expect(() => decode("x".repeat(12_289))).toThrowError(CollaborationNetworkError);
  });
});

describe("Collaboration Invitation Adapter", () => {
  it("does not expose raw Host failures or credentials to the panel", async () => {
    const request = {
      serverUrl: "wss://collab.example.test",
      token: "owner-secret-capability",
      documentId: asDocumentId("host-failure-document"),
      userId: "bob",
      role: "reader" as const,
      lifetimeSeconds: 300,
    };
    const rejectedIssuer = createHostCollaborationInvitationIssuer({
      async issueInvitation() { throw new Error(`network failed: ${request.token}`); },
    });
    const unknownFailureIssuer = createHostCollaborationInvitationIssuer({
      async issueInvitation() { return { ok: false, error: `unexpected: ${request.token}` }; },
    });
    for (const issue of [rejectedIssuer, unknownFailureIssuer]) {
      const failure = await issue(request).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CollaborationNetworkError);
      expect(failure).toMatchObject({ code: "invitation-request-failed" });
      expect(String(failure)).not.toContain(request.token);
      expect((failure as Error).cause).toBeUndefined();
    }
    const untrustedIssuer = createHostCollaborationInvitationIssuer({
      async issueInvitation() { return { ok: false, error: "server-not-trusted" }; },
    });
    await expect(untrustedIssuer(request)).rejects.toMatchObject({ code: "server-not-trusted" });
  });

  it("revalidates delegated identity even when an invitation came from the Host", async () => {
    const documentId = asDocumentId("host-identity-document");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(documentId, { token: "owner-capability", role: "owner", userId: "alice" });
    const adapter = createCollaborationInvitationAdapter({
      serverUrl: "wss://collab.example.test",
      credentials,
      issueInvitation: createHostCollaborationInvitationIssuer({
        async issueInvitation() {
          return { ok: true, invitation: {
            token: "delegated-capability", tokenId: "delegated-id",
            documentId: "a-different-document", userId: "bob", role: "reader",
            expiresAt: nowSeconds + 300,
          } };
        },
      }),
      now: () => now,
      idGenerator: () => "bob",
    });
    await expect(adapter.create({ documentId, role: "reader" })).rejects.toMatchObject({
      code: "invitation-response-invalid",
    });
  });

  it("creates a validated invitation through the trusted Host without renderer fetch", async () => {
    const documentId = asDocumentId("host-issued-document");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(documentId, { token: "owner-capability", role: "owner", userId: "alice" });
    const fetch = vi.fn<CollaborationNetworkFetch>(async () => {
      throw new Error("Renderer networking must not run for a Host-issued invitation");
    });
    const issueInvitation = vi.fn(async () => ({
      token: "delegated-capability",
      tokenId: "delegated-id",
      documentId,
      userId: "bob",
      role: "reader",
      expiresAt: nowSeconds + 300,
    }));
    const adapter = createCollaborationInvitationAdapter({
      serverUrl: "wss://collab.example.test",
      credentials,
      fetch,
      issueInvitation,
      now: () => now,
      idGenerator: () => "bob",
    });

    const created = await adapter.create({ documentId, role: "reader" });

    expect(decodeCollaborationInvitation(created.value, { now: () => now })).toEqual({
      version: 1,
      serverUrl: "wss://collab.example.test",
      documentId,
      userId: "bob",
      role: "reader",
      token: "delegated-capability",
      expiresAt: nowSeconds + 300,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(issueInvitation).toHaveBeenCalledWith({
      serverUrl: "wss://collab.example.test",
      token: "owner-capability",
      documentId,
      userId: "bob",
      role: "reader",
      lifetimeSeconds: 300,
    });
  });

  it("bounds invitation requests and aborts a fetch that exceeds the deadline", async () => {
    vi.useFakeTimers();
    try {
      const documentId = asDocumentId("document-invitation-timeout");
      const credentials = createMemoryCollaborationCredentialRegistry();
      credentials.set(documentId, {
        token: "owner-secret-token",
        role: "owner",
        userId: "owner-a",
      });
      const fetch = vi.fn<CollaborationNetworkFetch>(() => new Promise<Response>(() => undefined));
      const adapter = createCollaborationInvitationAdapter({
        serverUrl: "wss://collab.example.test/socket",
        credentials,
        fetch,
        now: () => now,
        idGenerator: () => "invitee-a",
        requestTimeoutMs: 50,
      });

      const creation = adapter.create({ documentId, role: "reader" });
      const rejection = expect(creation).rejects.toMatchObject({
        code: "invitation-request-timeout",
        message: "Collaboration invitation service did not respond before the deadline",
      });
      await vi.advanceTimersByTimeAsync(50);

      await rejection;
      expect(fetch.mock.calls[0]?.[1].signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("delegates through the same server origin with a header bearer and exact body", async () => {
    const documentId = asDocumentId("document-create-invite");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(documentId, { token: "owner-secret-token", role: "owner", userId: "owner-a" });
    const fetch = vi.fn<CollaborationNetworkFetch>(async () => new Response(JSON.stringify({
      token: "delegated.header.signature",
      tokenId: "invitation-token-id",
      expiresAt: nowSeconds + 300,
      documentId,
      userId: "generated-invitee",
      role: "editor",
    }), {
      status: 201,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    }));
    const adapter = createCollaborationInvitationAdapter({
      serverUrl: "wss://collab.example.test/socket",
      credentials,
      fetch,
      now: () => now,
      idGenerator: () => "generated-invitee",
    });

    const created = await adapter.create({ documentId, role: "editor" });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://collab.example.test/v1/invitations");
    expect(url).not.toContain("owner-secret-token");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      headers: {
        authorization: "Bearer owner-secret-token",
        "content-type": "application/json",
        accept: "application/json",
      },
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      documentId,
      userId: "generated-invitee",
      role: "editor",
      lifetimeSeconds: 300,
    });
    expect(Object.keys(JSON.parse(init!.body as string)).sort()).toEqual([
      "documentId",
      "lifetimeSeconds",
      "role",
      "userId",
    ]);
    expect(created).toMatchObject({ role: "editor", expiresAt: "2026-09-03T00:05:00.000Z" });
    expect(decodeCollaborationInvitation(created.value, { now: () => now })).toEqual({
      version: 1,
      serverUrl: "wss://collab.example.test/socket",
      documentId,
      userId: "generated-invitee",
      role: "editor",
      token: "delegated.header.signature",
      expiresAt: nowSeconds + 300,
    });
    expect(credentials.get(documentId)).toMatchObject({ token: "owner-secret-token" });
  });

  it("maps only an exact bounded delegation failure without exposing response or credential data", async () => {
    const documentId = asDocumentId("document-delegation-expiry");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(documentId, {
      token: "owner-secret-token",
      role: "owner",
      userId: "owner-a",
    });
    const fetch = vi.fn<CollaborationNetworkFetch>(async () => new Response(JSON.stringify({
      error: "delegation-outlives-authority",
    }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    }));
    const adapter = createCollaborationInvitationAdapter({
      serverUrl: "wss://collab.example.test/socket",
      credentials,
      fetch,
      now: () => now,
      idGenerator: () => "invitee-a",
    });

    const failure = await adapter.create({ documentId, role: "reader" }).catch((cause) => cause);
    expect(failure).toMatchObject({
      code: "delegation-outlives-authority",
      message: "The active collaboration credential expires too soon for this invitation",
    });
    expect(String(failure)).not.toContain("owner-secret-token");

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: "delegation-outlives-authority",
      detail: "owner-secret-token",
    }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }));
    await expect(adapter.create({ documentId, role: "reader" })).rejects.toMatchObject({
      code: "invitation-request-failed",
      message: "Collaboration invitation service rejected the request with status 403",
    });

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      error: "delegation-outlives-authority",
      padding: "x".repeat(12_289),
    }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }));
    await expect(adapter.create({ documentId, role: "reader" })).rejects.toMatchObject({
      code: "invitation-request-failed",
    });
  });

  it("fails closed before fetch for a missing or read-only credential and validates the response", async () => {
    const documentId = asDocumentId("document-delegation-failure");
    const credentials = createMemoryCollaborationCredentialRegistry();
    const fetch = vi.fn<CollaborationNetworkFetch>(async () => new Response(JSON.stringify({
      token: "delegated.header.signature",
      tokenId: "invitation-token-id",
      expiresAt: nowSeconds + 300,
      documentId: "wrong-document",
      userId: "invitee",
      role: "reader",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const adapter = createCollaborationInvitationAdapter({
      serverUrl: "wss://collab.example.test",
      credentials,
      fetch,
      now: () => now,
      idGenerator: () => "invitee",
    });

    await expect(adapter.create({ documentId, role: "reader" })).rejects.toMatchObject({
      code: "credential-unavailable",
    });
    credentials.set(documentId, { token: "reader-token", role: "reader", userId: "reader" });
    await expect(adapter.create({ documentId, role: "reader" })).rejects.toMatchObject({
      code: "delegation-not-authorized",
    });
    expect(fetch).not.toHaveBeenCalled();

    credentials.set(documentId, { token: "editor-token", role: "editor", userId: "editor" });
    fetch.mockResolvedValueOnce(new Response("x".repeat(12_289), {
      status: 201,
      headers: { "cache-control": "no-store", "content-type": "application/json" },
    }));
    await expect(adapter.create({ documentId, role: "reader" })).rejects.toMatchObject({
      code: "invitation-response-invalid",
    });
    await expect(adapter.create({ documentId, role: "reader" })).rejects.toMatchObject({
      code: "invitation-response-invalid",
    });
  });

  it("prepares an invitation before stack creation but rejects acceptance by another server", async () => {
    const credentials = createMemoryCollaborationCredentialRegistry();
    const adapter = createCollaborationInvitationAdapter({
      serverUrl: "wss://default.example.test",
      credentials,
      fetch: vi.fn(),
      now: () => now,
      idGenerator: () => "unused",
    });
    const encoded = encodeCollaborationInvitation(invitation({
      serverUrl: "ws://127.0.0.1:1234/collaboration",
      role: "reader",
    }), { now: () => now });

    const prepared = adapter.prepareInvitation(encoded);
    expect(prepared).toEqual({
      serverUrl: "ws://127.0.0.1:1234/collaboration",
      documentId: asDocumentId("document-a"),
      userId: "invitee-a",
      role: "reader",
      expiresAt: nowSeconds + 300,
    });
    expect(credentials.get(asDocumentId("document-a"))).toBeUndefined();

    await expect(adapter.accept(encoded)).rejects.toMatchObject({
      code: "invitation-server-mismatch",
      message: "This invitation belongs to a different collaboration server",
    });
    expect(credentials.get(asDocumentId("document-a"))).toBeUndefined();
    expect(adapter.getAcceptedServerUrl(asDocumentId("document-a"))).toBeUndefined();

    const invitedServerAdapter = createCollaborationInvitationAdapter({
      serverUrl: "ws://127.0.0.1:1234/collaboration",
      credentials,
      fetch: vi.fn(),
      now: () => now,
      idGenerator: () => "unused",
    });
    await expect(invitedServerAdapter.accept(encoded)).resolves.toEqual({
      document: {
        id: asDocumentId("document-a"),
        hostIdentity: "ws://127.0.0.1:1234/collaboration",
      },
      access: "reader",
    });
    expect(credentials.get(asDocumentId("document-a"))).toEqual({
      token: "header.claims.signature",
      userId: "invitee-a",
      role: "reader",
    });
    expect(invitedServerAdapter.getAcceptedServerUrl(asDocumentId("document-a"))).toBe(
      "ws://127.0.0.1:1234/collaboration",
    );
  });
});

describe("Collaboration Connection Adapter", () => {
  it("shares one failed reconnect for concurrent calls without restoring the attempted credential", async () => {
    const documentId = asDocumentId("document-concurrent-reauthentication");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(documentId, { token: "old-token", role: "editor", userId: "alice" });
    const firstReconnect = deferred<void>();
    const control = {
      reconnect: vi.fn(() => firstReconnect.promise),
    };
    const adapter = createCollaborationConnectionAdapter({ credentials, control });
    adapter.stageCredential(documentId, { token: "new-token", role: "reader", userId: "alice" });

    const first = adapter.reauthenticate(documentId);
    const second = adapter.reauthenticate(documentId);
    expect(control.reconnect).toHaveBeenCalledTimes(1);

    firstReconnect.reject(new Error("credential rejected"));
    await expect(first).rejects.toThrow("credential rejected");
    await expect(second).rejects.toThrow("credential rejected");
    expect(credentials.get(documentId)).toMatchObject({ token: "old-token", role: "editor" });

    control.reconnect.mockResolvedValueOnce(undefined);
    await expect(adapter.reauthenticate(documentId)).resolves.toEqual({ access: "reader" });
    expect(credentials.get(documentId)).toMatchObject({ token: "new-token", role: "reader" });
    expect(control.reconnect).toHaveBeenCalledTimes(2);
  });

  it("does not roll back over a credential activated while reconnect is pending", async () => {
    const documentId = asDocumentId("document-reauthentication-cas");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(documentId, { token: "old-token", role: "editor", userId: "alice" });
    const reconnect = deferred<void>();
    const control = {
      reconnect: vi.fn()
        .mockImplementationOnce(() => reconnect.promise)
        .mockResolvedValueOnce(undefined),
    };
    const adapter = createCollaborationConnectionAdapter({
      credentials,
      control,
    });
    adapter.stageCredential(documentId, { token: "attempted-token", role: "reader", userId: "alice" });

    const authentication = adapter.reauthenticate(documentId);
    adapter.stageCredential(documentId, {
      token: "newer-active-token",
      role: "owner",
      userId: "alice",
    });
    credentials.set(documentId, { token: "newer-active-token", role: "owner", userId: "alice" });
    reconnect.reject(new Error("attempted credential rejected"));

    await expect(authentication).rejects.toThrow("attempted credential rejected");
    expect(credentials.get(documentId)).toEqual({
      token: "newer-active-token",
      role: "owner",
      userId: "alice",
    });
    await expect(adapter.reauthenticate(documentId)).resolves.toEqual({ access: "owner" });
    expect(control.reconnect).toHaveBeenCalledTimes(2);
  });

  it("keeps a credential staged during a flight for the next explicit retry", async () => {
    const documentId = asDocumentId("document-staged-during-flight");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(documentId, { token: "old-token", role: "editor", userId: "alice" });
    const firstReconnect = deferred<void>();
    const seenTokens: string[] = [];
    const control = {
      reconnect: vi.fn(async (id: typeof documentId) => {
        seenTokens.push(credentials.resolveToken(id));
        if (seenTokens.length === 1) await firstReconnect.promise;
      }),
    };
    const adapter = createCollaborationConnectionAdapter({ credentials, control });
    adapter.stageCredential(documentId, { token: "first-new-token", role: "reader", userId: "alice" });

    const first = adapter.reauthenticate(documentId);
    adapter.stageCredential(documentId, { token: "second-new-token", role: "owner", userId: "alice" });
    await expect(adapter.reauthenticate(documentId)).rejects.toMatchObject({
      code: "reauthentication-in-progress",
    });
    firstReconnect.resolve(undefined);
    await expect(first).resolves.toEqual({ access: "reader" });
    expect(credentials.get(documentId)).toMatchObject({ token: "first-new-token", role: "reader" });

    await expect(adapter.reauthenticate(documentId)).resolves.toEqual({ access: "owner" });
    expect(credentials.get(documentId)).toMatchObject({ token: "second-new-token", role: "owner" });
    expect(seenTokens).toEqual(["first-new-token", "second-new-token"]);
  });

  it("reauthenticates different documents concurrently without sharing state", async () => {
    const firstId = asDocumentId("document-concurrent-a");
    const secondId = asDocumentId("document-concurrent-b");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(firstId, { token: "old-a", role: "editor", userId: "alice" });
    credentials.set(secondId, { token: "old-b", role: "reader", userId: "bob" });
    const firstReconnect = deferred<void>();
    const secondReconnect = deferred<void>();
    const control = {
      reconnect: vi.fn((documentId: typeof firstId) => (
        documentId === firstId ? firstReconnect.promise : secondReconnect.promise
      )),
    };
    const adapter = createCollaborationConnectionAdapter({ credentials, control });
    adapter.stageCredential(firstId, { token: "new-a", role: "owner", userId: "alice" });
    adapter.stageCredential(secondId, { token: "new-b", role: "editor", userId: "bob" });

    const first = adapter.reauthenticate(firstId);
    const second = adapter.reauthenticate(secondId);
    expect(control.reconnect).toHaveBeenCalledTimes(2);
    expect(credentials.get(firstId)).toMatchObject({ token: "new-a" });
    expect(credentials.get(secondId)).toMatchObject({ token: "new-b" });

    secondReconnect.resolve(undefined);
    firstReconnect.resolve(undefined);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { access: "owner" },
      { access: "editor" },
    ]);
  });

  it("routes retry and atomically activates an explicit pending credential for reauthentication", async () => {
    const documentId = asDocumentId("document-reauthenticate");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(documentId, { token: "old-token", role: "owner", userId: "owner" });
    const seenTokens: string[] = [];
    const control = {
      reconnect: vi.fn(async (id: typeof documentId) => {
        seenTokens.push(credentials.resolveToken(id));
      }),
    };
    const adapter = createCollaborationConnectionAdapter({ credentials, control });

    await adapter.reconnect(documentId);
    expect(seenTokens).toEqual(["old-token"]);
    adapter.stageCredential(documentId, {
      token: "fresh-token",
      role: "editor",
      userId: "owner",
    });
    await expect(adapter.reauthenticate(documentId)).resolves.toEqual({ access: "editor" });
    expect(seenTokens).toEqual(["old-token", "fresh-token"]);
    expect(credentials.get(documentId)).toEqual({
      token: "fresh-token",
      role: "editor",
      userId: "owner",
    });
    await expect(adapter.reauthenticate(documentId)).rejects.toMatchObject({
      code: "pending-credential-unavailable",
    });
  });

  it("rolls back the active credential when reauthentication fails and retains pending for retry", async () => {
    const documentId = asDocumentId("document-reauthentication-rollback");
    const credentials = createMemoryCollaborationCredentialRegistry();
    credentials.set(documentId, { token: "old-token", role: "editor", userId: "alice" });
    let fail = true;
    const control = {
      reconnect: vi.fn(async () => {
        if (fail) throw new Error("network unavailable");
      }),
    };
    const adapter = createCollaborationConnectionAdapter({ credentials, control });
    adapter.stageCredential(documentId, { token: "new-token", role: "reader", userId: "alice" });

    await expect(adapter.reauthenticate(documentId)).rejects.toThrow("network unavailable");
    expect(credentials.get(documentId)).toMatchObject({ token: "old-token", role: "editor" });
    fail = false;
    await expect(adapter.reauthenticate(documentId)).resolves.toEqual({ access: "reader" });
    expect(credentials.get(documentId)).toMatchObject({ token: "new-token", role: "reader" });
  });
});
