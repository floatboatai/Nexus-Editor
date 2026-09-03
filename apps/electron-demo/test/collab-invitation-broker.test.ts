// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { CollaborationInvitationBroker } from "../electron/collab-invitation-broker";

const request = {
  serverUrl: "wss://collab.example.test/socket", token: "owner-secret", documentId: "document-1",
  userId: "invited-user", role: "reader", lifetimeSeconds: 60,
} as const;
const invitation = {
  token: "invitation-secret", tokenId: "token-1", expiresAt: 1_060,
  documentId: request.documentId, userId: request.userId, role: request.role,
};

describe("Host collaboration invitation broker", () => {
  it("posts a bounded invitation operation to the exact trusted server without ambient credentials", async () => {
    const fetchRequest = vi.fn(async () => Response.json(invitation, { status: 201 }));
    const broker = new CollaborationInvitationBroker({ serverUrls: [request.serverUrl] }, { fetch: fetchRequest, now: () => 1_000_000 });

    expect(await broker.issueInvitation(1, request)).toEqual({ ok: true, invitation });
    expect(fetchRequest).toHaveBeenCalledOnce();
    const [url, options] = fetchRequest.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://collab.example.test/v1/invitations");
    expect(options).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", cache: "no-store" });
    expect(new Headers(options.headers).get("authorization")).toBe("Bearer owner-secret");
    expect(new Headers(options.headers).has("origin")).toBe(false);
    expect(new Headers(options.headers).has("cookie")).toBe(false);
    expect(JSON.parse(String(options.body))).toEqual({ documentId: "document-1", userId: "invited-user", role: "reader", lifetimeSeconds: 60 });
  });

  it.each([
    { ...request, serverUrl: "wss://attacker.example.test" },
    { ...request, serverUrl: "wss://collab.example.test/other-path" },
    { ...request, serverUrl: "wss://COLLAB.example.test:443/socket" },
    { ...request, serverUrl: "wss://collab.example.test/socket?token=secret" },
    { ...request, token: "secret\r\ncookie: steal" },
    { ...request, token: "x".repeat(8_193) },
    { ...request, documentId: "x".repeat(257) },
    { ...request, role: "owner" },
    { ...request, lifetimeSeconds: 3_601 },
    { ...request, lifetimeSeconds: 0 },
    { ...request, headers: { cookie: "secret" } },
    null,
  ])("rejects unauthorized endpoints and malformed requests without network activity", async (candidate) => {
    const fetchRequest = vi.fn(async () => Response.json(invitation, { status: 201 }));
    const broker = new CollaborationInvitationBroker({ serverUrls: [request.serverUrl] }, { fetch: fetchRequest });
    expect(await broker.issueInvitation(1, candidate)).toMatchObject({ ok: false });
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it.each([
    { ...invitation, documentId: "another-document" },
    { ...invitation, userId: "another-user" },
    { ...invitation, role: "editor" },
    { ...invitation, expiresAt: 999 },
    { ...invitation, expiresAt: 1_100 },
    { ...invitation, token: "x".repeat(8_193) },
    { ...invitation, extraSecret: "do-not-return" },
  ])("rejects malformed or mismatched invitation responses", async (candidate) => {
    const broker = new CollaborationInvitationBroker({ serverUrls: [request.serverUrl] }, {
      fetch: async () => Response.json(candidate, { status: 201 }), now: () => 1_000_000,
    });
    expect(await broker.issueInvitation(1, request)).toEqual({ ok: false, error: "invitation-response-invalid" });
  });

  it("returns only stable error codes, never upstream secrets", async () => {
    const broker = new CollaborationInvitationBroker({ serverUrls: [request.serverUrl] }, {
      fetch: async () => { throw new Error("owner-secret invitation-secret"); },
    });
    expect(await broker.issueInvitation(1, request)).toEqual({ ok: false, error: "invitation-request-failed" });
  });

  it("allows only a bounded clock skew for remote invitation expiry", async () => {
    const broker = new CollaborationInvitationBroker({ serverUrls: [request.serverUrl] }, {
      fetch: async () => Response.json({ ...invitation, expiresAt: 1_061 }, { status: 201 }), now: () => 1_000_000,
    });
    expect(await broker.issueInvitation(1, request)).toMatchObject({ ok: true });
  });

  it("bounds response bytes, requires JSON, and does not echo arbitrary rejection bodies", async () => {
    for (const response of [
      new Response(JSON.stringify(invitation), { status: 201, headers: { "content-type": "text/plain" } }),
      new Response(" ".repeat(16_385), { status: 201, headers: { "content-type": "application/json" } }),
      Response.json({ error: "owner-secret" }, { status: 403 }),
    ]) {
      const broker = new CollaborationInvitationBroker({ serverUrls: [request.serverUrl] }, { fetch: async () => response, now: () => 1_000_000 });
      expect(await broker.issueInvitation(1, request)).toMatchObject({ ok: false });
    }
  });

  it("limits concurrent invitations per sender and aborts all when the sender closes", async () => {
    const signals: AbortSignal[] = [];
    const fetchRequest = vi.fn((_url: string | URL | Request, options?: RequestInit) => {
      signals.push(options!.signal!);
      return new Promise<Response>(() => undefined);
    });
    const broker = new CollaborationInvitationBroker({ serverUrls: [request.serverUrl] }, { fetch: fetchRequest });
    const first = broker.issueInvitation(1, request);
    const second = broker.issueInvitation(1, request);
    expect(await broker.issueInvitation(1, request)).toEqual({ ok: false, error: "invitation-request-busy" });
    const otherSender = broker.issueInvitation(2, request);
    broker.closeSender(1);
    expect(await first).toEqual({ ok: false, error: "invitation-request-cancelled" });
    expect(await second).toEqual({ ok: false, error: "invitation-request-cancelled" });
    expect(signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true);
    expect(signals[2]?.aborted).toBe(false);
    broker.closeSender(2);
    await otherSender;
  });

  it("times out a stalled response stream and releases its sender slot", async () => {
    vi.useFakeTimers();
    try {
      const broker = new CollaborationInvitationBroker({ serverUrls: [request.serverUrl] }, {
        fetch: async () => new Response(new ReadableStream({ start() {} }), { status: 201, headers: { "content-type": "application/json" } }), timeoutMs: 100,
      });
      const pending = broker.issueInvitation(1, request);
      await vi.advanceTimersByTimeAsync(101);
      expect(await pending).toEqual({ ok: false, error: "invitation-request-timeout" });
      const next = broker.issueInvitation(1, request);
      await vi.advanceTimersByTimeAsync(101);
      expect(await next).toEqual({ ok: false, error: "invitation-request-timeout" });
    } finally { vi.useRealTimers(); }
  });

  it("uses real Node networking without Origin or cookies and never follows a redirect", async () => {
    const observed: Array<{ path: string; authorization?: string; origin?: string; cookie?: string }> = [];
    let redirect = false;
    const server = createServer((incoming, response) => {
      observed.push({ path: incoming.url ?? "", authorization: incoming.headers.authorization, origin: incoming.headers.origin, cookie: incoming.headers.cookie });
      incoming.resume();
      if (redirect) {
        response.writeHead(302, { location: "/credential-leak" });
        response.end();
      } else {
        response.writeHead(201, { "content-type": "application/json", "set-cookie": "ambient=do-not-resend" });
        response.end(JSON.stringify(invitation));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing loopback fixture port");
      const serverUrl = `ws://127.0.0.1:${address.port}`;
      const broker = new CollaborationInvitationBroker({ serverUrls: [serverUrl] }, { now: () => 1_000_000 });
      expect(await broker.issueInvitation(1, { ...request, serverUrl })).toEqual({ ok: true, invitation });
      redirect = true;
      expect(await broker.issueInvitation(1, { ...request, serverUrl })).toEqual({ ok: false, error: "invitation-request-failed" });
      expect(observed).toEqual([
        { path: "/v1/invitations", authorization: "Bearer owner-secret", origin: undefined, cookie: undefined },
        { path: "/v1/invitations", authorization: "Bearer owner-secret", origin: undefined, cookie: undefined },
      ]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
