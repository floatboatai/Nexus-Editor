import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCollaborationServer, type CollaborationServer } from "../src/server";

const directories: string[] = [];
const servers: CollaborationServer[] = [];

async function createServer(): Promise<CollaborationServer> {
  const storageDirectory = await mkdtemp(join(tmpdir(), "nexus-collab-lifecycle-"));
  directories.push(storageDirectory);
  const server = createCollaborationServer({
    address: "127.0.0.1",
    port: 0,
    storageDirectory,
    authSecret: "0123456789abcdef0123456789abcdef",
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.stop()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("collaboration server lifecycle", () => {
  it("validates the per-document state limit at configuration boundaries", () => {
    const options = {
      address: "127.0.0.1",
      port: 0,
      storageDirectory: "/tmp/nexus-collab-config-validation",
      authSecret: "0123456789abcdef0123456789abcdef",
    } as const;

    expect(() => createCollaborationServer({ ...options, maxDocumentBytes: 0 })).toThrow(
      "maxDocumentBytes must be an integer between 1 and 16777216",
    );
    expect(() => createCollaborationServer({ ...options, maxDocumentBytes: 1.5 })).toThrow(
      "maxDocumentBytes must be an integer between 1 and 16777216",
    );
    expect(() => createCollaborationServer({
      ...options,
      maxDocumentBytes: 16 * 1024 * 1024 + 1,
    })).toThrow("maxDocumentBytes must be an integer between 1 and 16777216");
    expect(() => createCollaborationServer({ ...options, maxDocumentBytes: 1 })).not.toThrow();
    expect(() => createCollaborationServer({
      ...options,
      maxDocumentBytes: 16 * 1024 * 1024,
    })).not.toThrow();
    expect(() => createCollaborationServer({ ...options, maxAuthenticatedQueueBytes: 0 })).toThrow(
      "maxAuthenticatedQueueBytes must be an integer between 1 and 67108864",
    );
    expect(() => createCollaborationServer({ ...options, maxAuthenticatedQueueMessages: 0 })).toThrow(
      "maxAuthenticatedQueueMessages must be an integer between 1 and 1024",
    );
    expect(() => createCollaborationServer({
      ...options,
      maxAuthenticatedQueueBytes: 64 * 1024,
      maxAuthenticatedQueueMessages: 4,
    })).not.toThrow();
  });

  it("honors a stop requested while start is still listening", async () => {
    const server = await createServer();
    let startedHttpUrl: string | undefined;

    const starting = server.start().then(() => {
      startedHttpUrl = server.httpUrl;
    });
    const stopping = server.stop();

    await Promise.all([starting, stopping]);

    expect(server.inspect().running).toBe(false);
    expect(() => server.websocketUrl).toThrow("Collaboration server is not running");
    expect(startedHttpUrl).toBeDefined();
    await expect(fetch(`${startedHttpUrl}/healthz`)).rejects.toThrow();

    await server.start();
    expect(server.inspect().running).toBe(true);
    await server.stop();
  });

  it("honors a start requested while stop is still destroying", async () => {
    const server = await createServer();
    await server.start();

    const stopping = server.stop();
    const restarting = server.start();

    await Promise.all([stopping, restarting]);

    expect(server.inspect().running).toBe(true);
    expect(server.websocketUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/u);
  });

  it("treats repeated concurrent start and stop requests as idempotent", async () => {
    const server = await createServer();

    await Promise.all([server.start(), server.start(), server.start()]);
    expect(server.inspect().running).toBe(true);

    await Promise.all([server.stop(), server.stop(), server.stop()]);
    expect(server.inspect().running).toBe(false);

    await server.stop();
    expect(server.inspect().running).toBe(false);
  });
});
