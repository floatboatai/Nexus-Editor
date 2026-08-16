// @vitest-environment node

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { atomicWriteFile } from "../electron/atomic-file";
import { VaultStateStore } from "../electron/vault-state-store";

const roots: string[] = [];

async function fixture(name: string): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(path.join(tmpdir(), `${name}-`));
  roots.push(root);
  return { root, file: path.join(root, "vault.json") };
}

async function waitForWriteStart(started: Promise<void>, mutation: Promise<unknown>): Promise<void> {
  await Promise.race([
    started,
    mutation.then(
      () => { throw new Error("Mutation settled before the atomic writer started"); },
      (error: unknown) => { throw error; },
    ),
  ]);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("VaultStateStore", () => {
  it("returns an immutable empty state without creating a missing file", async () => {
    const { root, file } = await fixture("nexus-vault-state-empty");
    const store = new VaultStateStore(file);

    const state = await store.read();

    expect(state).toEqual({ lastVault: null, recents: [] });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.recents)).toBe(true);
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it("normalizes invalid fields, duplicates, and excess entries", async () => {
    const { file } = await fixture("nexus-vault-state-normalize");
    await writeFile(file, JSON.stringify({
      lastVault: 42,
      recents: ["a", "a", false, "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"],
    }));

    await expect(new VaultStateStore(file).read()).resolves.toEqual({
      lastVault: null,
      recents: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
    });
  });

  it("quarantines malformed JSON and returns an empty state", async () => {
    const { root, file } = await fixture("nexus-vault-state-corrupt");
    await writeFile(file, "{broken");
    const store = new VaultStateStore(file, { now: () => 123 });

    await expect(store.read()).resolves.toEqual({ lastVault: null, recents: [] });
    await expect(readFile(path.join(root, "vault.json.corrupt-123"), "utf8"))
      .resolves.toBe("{broken");
  });

  it("quarantines an invalid top-level value", async () => {
    const { root, file } = await fixture("nexus-vault-state-invalid-top-level");
    await writeFile(file, "[]");
    const store = new VaultStateStore(file, { now: () => 456 });

    await expect(store.read()).resolves.toEqual({ lastVault: null, recents: [] });
    await expect(readFile(path.join(root, "vault.json.corrupt-456"), "utf8")).resolves.toBe("[]");
  });

  it("returns an empty state when corrupt-file quarantine fails", async () => {
    const { file } = await fixture("nexus-vault-state-quarantine-failure");
    await writeFile(file, "{broken");
    const store = new VaultStateStore(file, {
      renameFile: async () => { throw new Error("rename failed"); },
    });

    await expect(store.read()).resolves.toEqual({ lastVault: null, recents: [] });
    await expect(readFile(file, "utf8")).resolves.toBe("{broken");
  });

  it("repairs a corrupt source during pruning when quarantine fails", async () => {
    const { file } = await fixture("nexus-vault-state-quarantine-repair");
    await writeFile(file, "{broken");
    const atomicWriter = vi.fn(atomicWriteFile);
    const store = new VaultStateStore(file, {
      atomicWriter,
      renameFile: async () => { throw new Error("rename failed"); },
    });

    await expect(store.pruneUnavailable()).resolves.toEqual({ lastVault: null, recents: [] });
    expect(atomicWriter).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ lastVault: null, recents: [] });
  });

  it("maintains exact-path MRU order and caps recents at ten", async () => {
    const { file } = await fixture("nexus-vault-state-mru");
    const store = new VaultStateStore(file);
    for (let index = 0; index < 12; index += 1) {
      await store.recordRecent(`/vault/${index}`);
    }
    await store.recordRecent("/vault/5");

    await expect(store.read()).resolves.toEqual({
      lastVault: "/vault/5",
      recents: [
        "/vault/5",
        "/vault/11",
        "/vault/10",
        "/vault/9",
        "/vault/8",
        "/vault/7",
        "/vault/6",
        "/vault/4",
        "/vault/3",
        "/vault/2",
      ],
    });
  });

  it("rejects an empty recent path before writing", async () => {
    const { root, file } = await fixture("nexus-vault-state-invalid-path");
    const store = new VaultStateStore(file);

    await expect(store.recordRecent("")).rejects.toThrow(TypeError);
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it("preserves concurrent updates in invocation order", async () => {
    const { file } = await fixture("nexus-vault-state-concurrent");
    const store = new VaultStateStore(file);

    await Promise.all([
      store.recordRecent("/vault/a"),
      store.recordRecent("/vault/b"),
      store.recordRecent("/vault/c"),
    ]);

    await expect(store.read()).resolves.toEqual({
      lastVault: "/vault/c",
      recents: ["/vault/c", "/vault/b", "/vault/a"],
    });
  });

  it("queues reads behind a pending write", async () => {
    const { file } = await fixture("nexus-vault-state-read-order");
    let markWriteStarted!: () => void;
    let releaseWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const atomicWriter = vi.fn(async (target: string, data: string | Uint8Array) => {
      markWriteStarted();
      await writeGate;
      await atomicWriteFile(target, data);
    });
    const store = new VaultStateStore(file, { atomicWriter });

    const mutation = store.recordRecent("/vault/a");
    await waitForWriteStart(writeStarted, mutation);
    const queuedRead = store.read();
    releaseWrite();

    await mutation;
    await expect(queuedRead).resolves.toEqual({ lastVault: "/vault/a", recents: ["/vault/a"] });
  });

  it("drain waits for accepted work", async () => {
    const { file } = await fixture("nexus-vault-state-drain");
    let markWriteStarted!: () => void;
    let releaseWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const store = new VaultStateStore(file, {
      atomicWriter: async () => {
        markWriteStarted();
        await writeGate;
      },
    });

    const mutation = store.recordRecent("/vault/a");
    await waitForWriteStart(writeStarted, mutation);
    let drained = false;
    const draining = store.drain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    releaseWrite();
    await mutation;
    await draining;
    expect(drained).toBe(true);
  });

  it("prunes unavailable paths and clears an unavailable last Vault", async () => {
    const { root, file } = await fixture("nexus-vault-state-prune");
    const existing = path.join(root, "existing");
    const missing = path.join(root, "missing");
    await mkdir(existing);
    await writeFile(file, JSON.stringify({ lastVault: missing, recents: [missing, existing] }));
    const store = new VaultStateStore(file);

    await expect(store.pruneUnavailable()).resolves.toEqual({
      lastVault: null,
      recents: [existing],
    });
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ lastVault: null, recents: [existing] });
  });

  it("rewrites normalized state while preserving available paths", async () => {
    const { root, file } = await fixture("nexus-vault-state-normalize-write");
    const existing = path.join(root, "existing");
    await mkdir(existing);
    await writeFile(file, JSON.stringify({
      lastVault: existing,
      recents: [existing, existing, false],
    }));
    const atomicWriter = vi.fn(atomicWriteFile);
    const store = new VaultStateStore(file, { atomicWriter });

    await expect(store.pruneUnavailable()).resolves.toEqual({
      lastVault: existing,
      recents: [existing],
    });
    expect(atomicWriter).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      lastVault: existing,
      recents: [existing],
    });
  });

  it("does not rewrite an already canonical available state", async () => {
    const { root, file } = await fixture("nexus-vault-state-noop");
    const existing = path.join(root, "existing");
    await mkdir(existing);
    await writeFile(file, JSON.stringify({ lastVault: existing, recents: [existing] }, null, 2));
    const atomicWriter = vi.fn(atomicWriteFile);
    const store = new VaultStateStore(file, { atomicWriter });

    await expect(store.pruneUnavailable()).resolves.toEqual({
      lastVault: existing,
      recents: [existing],
    });
    expect(atomicWriter).not.toHaveBeenCalled();
  });

  it("recovers the queue after a rejected write", async () => {
    const { file } = await fixture("nexus-vault-state-write-recovery");
    let fail = false;
    const atomicWriter = vi.fn(async (target: string, data: string | Uint8Array) => {
      if (fail) {
        fail = false;
        throw new Error("write failed");
      }
      await atomicWriteFile(target, data);
    });
    const store = new VaultStateStore(file, { atomicWriter });

    await store.recordRecent("/vault/old");
    fail = true;
    await expect(store.recordRecent("/vault/a")).rejects.toThrow("write failed");
    await expect(store.read()).resolves.toEqual({
      lastVault: "/vault/old",
      recents: ["/vault/old"],
    });
    await expect(store.recordRecent("/vault/b")).resolves.toEqual({
      lastVault: "/vault/b",
      recents: ["/vault/b", "/vault/old"],
    });
    await store.drain();
  });
});
