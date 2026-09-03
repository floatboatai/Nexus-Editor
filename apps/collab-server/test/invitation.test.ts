import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCollaborationServer,
  type CollaborationServer,
  type CollaborationServerOptions,
} from "../src";

const secret = "invitation-test-secret-that-is-at-least-thirty-two-bytes";
let root: string | undefined;
let server: CollaborationServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function startServer(
  options: Pick<CollaborationServerOptions, "address" | "invitationAllowedOrigins"> = {},
): Promise<CollaborationServer> {
  root = await mkdtemp(join(tmpdir(), "nexus-collab-invitation-"));
  server = createCollaborationServer({
    address: options.address ?? "127.0.0.1",
    port: 0,
    storageDirectory: root,
    authSecret: secret,
    invitationMaximumLifetimeSeconds: 600,
    ...(options.invitationAllowedOrigins
      ? { invitationAllowedOrigins: options.invitationAllowedOrigins }
      : {}),
  });
  await server.start();
  return server;
}

async function delegate(
  target: CollaborationServer,
  bearer: string | undefined,
  body: unknown,
  origin?: string,
): Promise<Response> {
  return fetch(`${target.httpUrl}/v1/invitations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("invitation delegation endpoint", () => {
  it("answers an allowed invitation CORS preflight without exposing a wildcard", async () => {
    const target = await startServer({
      invitationAllowedOrigins: ["https://EDITOR.example.test:443/"],
    });

    const response = await fetch(`${target.httpUrl}/v1/invitations`, {
      method: "OPTIONS",
      headers: {
        origin: "https://editor.example.test",
        "access-control-request-method": "POST",
        "access-control-request-headers": " Content-Type, AUTHORIZATION ",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://editor.example.test",
    );
    expect(response.headers.get("access-control-allow-methods")).toBe("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type",
    );
    expect(response.headers.get("vary")).toBe(
      "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    );

    const withQuery = await fetch(`${target.httpUrl}/v1/invitations?token=forbidden`, {
      method: "OPTIONS",
      headers: {
        origin: "https://editor.example.test",
        "access-control-request-method": "POST",
      },
    });
    expect(withQuery.status).toBe(400);
    expect(withQuery.headers.get("access-control-allow-origin")).toBe(
      "https://editor.example.test",
    );
  });

  it("rejects an allowed-origin preflight for any undeclared method or header", async () => {
    const target = await startServer({
      invitationAllowedOrigins: ["https://editor.example.test"],
    });
    const preflight = (method: string, headers?: string) => fetch(
      `${target.httpUrl}/v1/invitations`,
      {
        method: "OPTIONS",
        headers: {
          origin: "https://editor.example.test",
          "access-control-request-method": method,
          ...(headers ? { "access-control-request-headers": headers } : {}),
        },
      },
    );

    for (const response of [
      await preflight("DELETE", "authorization"),
      await preflight("POST", "authorization,x-unexpected"),
    ]) {
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("limits the invitation route to POST and its OPTIONS preflight", async () => {
    const target = await startServer({
      invitationAllowedOrigins: ["https://editor.example.test"],
    });

    const response = await fetch(`${target.httpUrl}/v1/invitations`, {
      method: "GET",
      headers: { origin: "https://editor.example.test" },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://editor.example.test",
    );
  });

  it("returns CORS headers to an allowed origin and rejects an unlisted origin", async () => {
    const target = await startServer({
      invitationAllowedOrigins: ["https://editor.example.test"],
    });
    const editor = await target.tokens.issue({
      userId: "owner",
      documentId: "document-a",
      role: "editor",
      lifetimeSeconds: 900,
    });
    const request = {
      documentId: "document-a",
      userId: "invitee",
      role: "reader",
      lifetimeSeconds: 300,
    };

    const allowed = await delegate(
      target,
      editor.token,
      request,
      "https://editor.example.test",
    );
    expect(allowed.status).toBe(201);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://editor.example.test",
    );
    expect(allowed.headers.get("vary")).toBe("Origin");
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();

    const unauthorized = await delegate(
      target,
      undefined,
      request,
      "https://editor.example.test",
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("access-control-allow-origin")).toBe(
      "https://editor.example.test",
    );
    expect(unauthorized.headers.get("vary")).toBe("Origin");

    const denied = await delegate(
      target,
      editor.token,
      request,
      "https://attacker.example.test",
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    await expect(denied.json()).resolves.toEqual({ error: "origin-not-allowed" });
  });

  it("allows the opaque Electron origin by default only on a loopback listener", async () => {
    const target = await startServer();
    const editor = await target.tokens.issue({
      userId: "owner",
      documentId: "document-a",
      role: "editor",
      lifetimeSeconds: 900,
    });

    const response = await delegate(target, editor.token, {
      documentId: "document-a",
      userId: "invitee",
      role: "reader",
      lifetimeSeconds: 300,
    }, "null");

    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("null");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("lets an explicit empty allowlist disable the loopback Electron default", async () => {
    const target = await startServer({ invitationAllowedOrigins: [] });

    const response = await fetch(`${target.httpUrl}/v1/invitations`, {
      method: "OPTIONS",
      headers: {
        origin: "null",
        "access-control-request-method": "POST",
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not grant the opaque Electron origin by default on a non-loopback listener", async () => {
    const target = await startServer({ address: "0.0.0.0" });
    const endpoint = new URL(target.httpUrl);
    endpoint.hostname = "127.0.0.1";
    endpoint.pathname = "/v1/invitations";

    const response = await fetch(endpoint, {
      method: "OPTIONS",
      headers: {
        origin: "null",
        "access-control-request-method": "POST",
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects wildcard, opaque, credentialed, and non-origin allowlist entries", async () => {
    root = await mkdtemp(join(tmpdir(), "nexus-collab-origin-validation-"));
    const create = (origin: string) => createCollaborationServer({
      address: "127.0.0.1",
      port: 0,
      storageDirectory: root!,
      authSecret: secret,
      invitationAllowedOrigins: [origin],
    });

    for (const origin of [
      "*",
      "file:///tmp/nexus.html",
      "wss://editor.example.test",
      "https://user@editor.example.test",
      "https://editor.example.test/path",
      "https://editor.example.test?query=yes",
      "https://editor.example.test#fragment",
    ]) {
      expect(() => create(origin)).toThrow("invitationAllowedOrigins");
    }
  });

  it("lets a room editor delegate a bounded reader or editor credential", async () => {
    const target = await startServer();
    const editor = await target.tokens.issue({
      userId: "owner",
      documentId: "document-a",
      role: "editor",
      lifetimeSeconds: 900,
    });

    const response = await delegate(target, editor.token, {
      documentId: "document-a",
      userId: "invitee",
      role: "reader",
      lifetimeSeconds: 300,
    });
    const envelope = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(envelope).toMatchObject({
      documentId: "document-a",
      userId: "invitee",
      role: "reader",
      tokenId: expect.any(String),
      token: expect.any(String),
      expiresAt: expect.any(Number),
    });
    await expect(target.tokens.verify(envelope.token as string, "document-a")).resolves.toMatchObject({
      documentId: "document-a",
      userId: "invitee",
      role: "reader",
    });
  });

  it("fails closed for missing, read-only, cross-room, excessive, and oversized delegation", async () => {
    const target = await startServer();
    const editor = await target.tokens.issue({
      userId: "owner",
      documentId: "document-a",
      role: "editor",
      lifetimeSeconds: 900,
    });
    const reader = await target.tokens.issue({
      userId: "reader",
      documentId: "document-a",
      role: "reader",
      lifetimeSeconds: 900,
    });
    const shortLivedEditor = await target.tokens.issue({
      userId: "short-lived-owner",
      documentId: "document-a",
      role: "editor",
      lifetimeSeconds: 60,
    });
    const request = {
      documentId: "document-a",
      userId: "invitee",
      role: "editor",
      lifetimeSeconds: 300,
    };

    expect((await delegate(target, undefined, request)).status).toBe(401);
    expect((await delegate(target, reader.token, request)).status).toBe(403);
    expect((await delegate(target, editor.token, { ...request, documentId: "document-b" })).status).toBe(403);
    expect((await delegate(target, editor.token, { ...request, lifetimeSeconds: 601 })).status).toBe(400);
    const outlivesAuthority = await delegate(target, shortLivedEditor.token, request);
    expect(outlivesAuthority.status).toBe(403);
    await expect(outlivesAuthority.json()).resolves.toEqual({
      error: "delegation-outlives-authority",
    });
    expect((await delegate(target, editor.token, { ...request, userId: "x".repeat(5_000) })).status).toBe(413);
  });
});
