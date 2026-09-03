import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DocumentStoreCorruptionError,
  createFileDocumentStore,
  createFileTokenRevocationStore,
} from "../src/file-store";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nexus-collab-server-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileDocumentStore", () => {
  it("atomically restores the latest binary Yjs snapshot after restart", async () => {
    const root = await tempRoot();
    const first = createFileDocumentStore({ directory: root });
    await first.store("document-a", Uint8Array.of(1, 2, 3));
    await first.store("document-a", Uint8Array.of(4, 5, 6, 7));

    const restarted = createFileDocumentStore({ directory: root });
    await expect(restarted.fetch("document-a")).resolves.toEqual(Uint8Array.of(4, 5, 6, 7));
    await expect(restarted.fetch("missing")).resolves.toBeNull();
  });

  it("hashes opaque DocumentIds instead of resolving them as paths", async () => {
    const root = await tempRoot();
    const store = createFileDocumentStore({ directory: root });
    await store.store("../outside/../../document", Uint8Array.of(9));

    const entries = await readdir(join(root, "documents"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[a-f0-9]{64}\.nxc$/u);
    expect(resolve(join(root, "documents", entries[0]!)).startsWith(resolve(root))).toBe(true);
    await expect(store.fetch("../outside/../../document")).resolves.toEqual(Uint8Array.of(9));
  });

  it("fails closed for corrupt, mismatched, and oversized snapshots", async () => {
    const root = await tempRoot();
    const store = createFileDocumentStore({ directory: root, maxDocumentBytes: 8 });
    await expect(store.store("document-a", new Uint8Array(9))).rejects.toThrow("maximum");
    await store.store("document-a", Uint8Array.of(1, 2));
    const [filename] = await readdir(join(root, "documents"));
    const snapshotPath = join(root, "documents", filename!);
    const original = await readFile(snapshotPath);
    await writeFile(snapshotPath, Buffer.from("corrupt"));
    await expect(store.fetch("document-a")).rejects.toBeInstanceOf(DocumentStoreCorruptionError);

    await writeFile(snapshotPath, original);
    await expect(store.fetch("another-document")).resolves.toBeNull();
  });
});

describe("FileTokenRevocationStore", () => {
  it("prunes already expired records before concurrent revocations are atomically persisted", async () => {
    const root = await tempRoot();
    const store = createFileTokenRevocationStore({ directory: root, now: () => 100 });

    await Promise.all([
      store.add("expired-token", 100),
      store.add("active-token", 200),
      store.add("permanent-token"),
    ]);

    await expect(readFile(join(root, "auth", "revocations.json"), "utf8").then(JSON.parse))
      .resolves.toEqual({
        version: 1,
        records: {
          "active-token": 200,
          "permanent-token": null,
        },
      });
    await expect(readdir(join(root, "auth"))).resolves.toEqual(["revocations.json"]);
  });

  it("atomically rewrites expired disk records during load so another restart cannot resurrect them", async () => {
    const root = await tempRoot();
    let now = 50;
    const first = createFileTokenRevocationStore({ directory: root, now: () => now });
    await first.add("expired-after-shutdown", 75);
    await first.add("still-active", 200);
    const path = join(root, "auth", "revocations.json");
    await expect(readFile(path, "utf8").then(JSON.parse)).resolves.toEqual({
      version: 1,
      records: {
        "expired-after-shutdown": 75,
        "still-active": 200,
      },
    });

    now = 100;
    const restarted = createFileTokenRevocationStore({ directory: root, now: () => now });
    await expect(restarted.has("still-active")).resolves.toBe(true);
    await expect(readFile(path, "utf8").then(JSON.parse)).resolves.toEqual({
      version: 1,
      records: { "still-active": 200 },
    });

    const restartedAgain = createFileTokenRevocationStore({ directory: root, now: () => now });
    await expect(restartedAgain.has("expired-after-shutdown")).resolves.toBe(false);
    await expect(restartedAgain.has("still-active")).resolves.toBe(true);
  });

  it("durably removes a revocation that expires while the store is running", async () => {
    const root = await tempRoot();
    let now = 100;
    const store = createFileTokenRevocationStore({ directory: root, now: () => now });
    await store.add("short-lived", 110);
    const path = join(root, "auth", "revocations.json");

    now = 111;
    const [wasRevoked] = await Promise.all([
      store.has("short-lived"),
      store.add("concurrent-active", 300),
    ]);
    expect(wasRevoked).toBe(false);
    await expect(readFile(path, "utf8").then(JSON.parse)).resolves.toEqual({
      version: 1,
      records: { "concurrent-active": 300 },
    });

    const restarted = createFileTokenRevocationStore({ directory: root, now: () => now });
    await expect(restarted.has("short-lived")).resolves.toBe(false);
    await expect(restarted.has("concurrent-active")).resolves.toBe(true);
  });

  it("persists revocations across restart and prunes expired records", async () => {
    const root = await tempRoot();
    let now = 100;
    const first = createFileTokenRevocationStore({ directory: root, now: () => now });
    await first.add("active-token", 200);
    await first.add("expired-token", 99);

    const restarted = createFileTokenRevocationStore({ directory: root, now: () => now });
    await expect(restarted.has("active-token")).resolves.toBe(true);
    await expect(restarted.has("expired-token")).resolves.toBe(false);
    now = 201;
    await expect(restarted.has("active-token")).resolves.toBe(false);
  });
});
