import type {
  ComponentId,
  JsonValue,
  ManagedResource,
  PluginId,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import {
  MemoryPluginStorageBackend,
  PluginStorageRuntime,
  UnsupportedSecretStorage,
} from "../src/storage";

function owner(id: string): ResourceOwner {
  return {
    pluginId: id as PluginId,
    componentId: `${id}:root` as ComponentId,
  };
}

function service(
  runtime: PluginStorageRuntime,
  id: string,
  resources: ManagedResource[] = [],
) {
  return runtime.createService(owner(id), (resource) => resources.push(resource));
}

async function activate(resources: readonly ManagedResource[]): Promise<void> {
  for (const resource of resources) await resource.activate?.();
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("PluginStorageRuntime", () => {
  it("returns null for first load and isolates plugin namespaces", async () => {
    const runtime = new PluginStorageRuntime();
    const first = service(runtime, "first");
    const second = service(runtime, "second");
    expect(await first.loadData()).toEqual({ data: null, version: null, schemaVersion: null });
    await first.saveData({ private: "first" });
    expect(await second.loadData()).toEqual({ data: null, version: null, schemaVersion: null });
  });

  it("snapshots save input and returns independent load values", async () => {
    const runtime = new PluginStorageRuntime();
    const storage = service(runtime, "snapshot");
    const input = { nested: { count: 1 } };
    const saving = storage.saveData(input);
    input.nested.count = 99;
    expect((await saving).ok).toBe(true);

    const first = await storage.loadData<typeof input>();
    first.data!.nested.count = 7;
    const second = await storage.loadData<typeof input>();
    expect(second.data).toEqual({ nested: { count: 1 } });
  });

  it("serializes concurrent saves in invocation order", async () => {
    const backend = new MemoryPluginStorageBackend();
    const runtime = new PluginStorageRuntime({ backend });
    const storage = service(runtime, "queue");
    const results = await Promise.all([
      storage.saveData({ value: 1 }),
      storage.saveData({ value: 2 }),
      storage.saveData({ value: 3 }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect((await storage.loadData<{ value: number }>()).data).toEqual({ value: 3 });
  });

  it("preserves corrupt source, emits a diagnostic, and does not replace it", async () => {
    const backend = new MemoryPluginStorageBackend();
    const pluginId = "corrupt" as PluginId;
    backend.putCorrupt(pluginId, "{not-json");
    const diagnostics: string[] = [];
    const resources: ManagedResource[] = [];
    const runtime = new PluginStorageRuntime({
      backend,
      reportDiagnostic: (item) => diagnostics.push(item.code),
    });
    const storage = service(runtime, "corrupt", resources);
    const corrupt = vi.fn();
    storage.events.on("corrupt", corrupt);
    await activate(resources);

    await expect(storage.loadData()).rejects.toMatchObject({
      diagnostic: { code: "storage-corrupt" },
    });
    expect(corrupt).toHaveBeenCalledTimes(1);
    expect(diagnostics).toContain("storage-corrupt");
    expect(backend.getRaw(pluginId)).toBe("{not-json");
  });

  it("runs migrations once and leaves old data intact when migration fails", async () => {
    const runtime = new PluginStorageRuntime();
    const storage = service(runtime, "migration");
    await storage.saveData({ count: 1 }, { schemaVersion: 1 });
    const migrate = vi.fn((current) => ({
      count: (current.data as { count: number }).count + 1,
    }));
    const first = await storage.migrateData({ targetSchemaVersion: 2, migrate });
    const second = await storage.migrateData({ targetSchemaVersion: 2, migrate });
    expect(first.ok && second.ok).toBe(true);
    expect(migrate).toHaveBeenCalledTimes(1);

    const failed = await storage.migrateData<JsonValue>({
      targetSchemaVersion: 3,
      migrate: () => { throw new Error("bad migration"); },
    });
    expect(failed).toMatchObject({ ok: false, diagnostic: { code: "storage-migration-failed" } });
    expect(await storage.loadData()).toMatchObject({ data: { count: 2 }, schemaVersion: 2 });
  });

  it("invalidates cached data and notifies active subscribers on external change", async () => {
    const backend = new MemoryPluginStorageBackend();
    const resources: ManagedResource[] = [];
    const runtime = new PluginStorageRuntime({ backend });
    const storage = service(runtime, "external", resources);
    const changed = vi.fn();
    storage.events.on("externalChange", changed);
    await activate(resources);
    await storage.saveData({ value: "cached" }, { schemaVersion: 1 });

    backend.putExternal("external" as PluginId, { value: "outside" }, 2);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 2 }));
    expect((await storage.loadData<{ value: string }>()).data).toEqual({ value: "outside" });
  });

  it.each(["missing", "available"] as const)(
    "does not cache an in-flight %s read after an external change",
    async (initialState) => {
      const backend = new MemoryPluginStorageBackend();
      const pluginId = "read-race" as PluginId;
      if (initialState === "available") backend.putExternal(pluginId, { value: "old" }, 1);
      const started = deferred();
      const resume = deferred();
      const read = backend.read.bind(backend);
      const readSpy = vi.spyOn(backend, "read").mockImplementationOnce(async (id) => {
        const snapshot = await read(id);
        started.resolve();
        await resume.promise;
        return snapshot;
      });
      const runtime = new PluginStorageRuntime({ backend });
      const storage = service(runtime, pluginId);

      const loading = storage.loadData();
      await started.promise;
      const version = backend.putExternal(pluginId, { value: "new" }, 2);
      const reloading = storage.loadData();
      resume.resolve();

      expect((await loading).data).toEqual(initialState === "missing" ? null : { value: "old" });
      const expected = { data: { value: "new" }, version, schemaVersion: 2 };
      expect(await reloading).toEqual(expected);
      expect(await storage.loadData()).toEqual(expected);
      expect(readSpy).toHaveBeenCalledTimes(2);
      await runtime.dispose();
    },
  );

  it.each(["save", "migrate"] as const)(
    "keeps external invalidation when an in-flight %s completes",
    async (operation) => {
      const backend = new MemoryPluginStorageBackend();
      const pluginId = "write-race" as PluginId;
      backend.putExternal(pluginId, { value: "initial" }, 1);
      const committed = deferred<string>();
      const resume = deferred();
      const write = backend.write.bind(backend);
      vi.spyOn(backend, "write").mockImplementationOnce(async (...args) => {
        const result = await write(...args);
        if (!result.ok) throw new Error("Fixture write unexpectedly conflicted");
        committed.resolve(result.version);
        await resume.promise;
        return result;
      });
      const runtime = new PluginStorageRuntime({ backend });
      const resources: ManagedResource[] = [];
      const storage = service(runtime, pluginId, resources);
      const refreshed = deferred<Awaited<ReturnType<typeof storage.loadData>>>();
      storage.events.on("externalChange", () => {
        void storage.loadData().then(refreshed.resolve);
      });
      await activate(resources);

      const localData = { value: "local" };
      const saving = operation === "save"
        ? storage.saveData(localData, { schemaVersion: 2 })
        : storage.migrateData({
          targetSchemaVersion: 2,
          migrate: () => localData,
        });
      const localVersion = await committed.promise;
      localData.value = "mutated after commit";
      const externalVersion = backend.putExternal(pluginId, { value: "external" }, 3);
      resume.resolve();

      expect(await saving).toEqual({
        ok: true,
        value: {
          ...(operation === "migrate" ? { data: { value: "local" } } : {}),
          version: localVersion,
          schemaVersion: 2,
        },
      });
      const expected = { data: { value: "external" }, version: externalVersion, schemaVersion: 3 };
      expect(await refreshed.promise).toEqual(expected);
      expect(await storage.loadData()).toEqual(expected);
      await runtime.dispose();
    },
  );

  it("does not hide external corruption behind an in-flight read", async () => {
    const backend = new MemoryPluginStorageBackend();
    const pluginId = "corrupt-race" as PluginId;
    backend.putExternal(pluginId, { value: "old" });
    const started = deferred();
    const resume = deferred();
    const read = backend.read.bind(backend);
    vi.spyOn(backend, "read").mockImplementationOnce(async (id) => {
      const snapshot = await read(id);
      started.resolve();
      await resume.promise;
      return snapshot;
    });
    const runtime = new PluginStorageRuntime({ backend });
    const storage = service(runtime, pluginId);

    const loading = storage.loadData();
    await started.promise;
    backend.putCorrupt(pluginId, "{not-json");
    resume.resolve();
    await loading;

    await expect(storage.loadData()).rejects.toMatchObject({
      diagnostic: { code: "storage-corrupt" },
    });
    expect(backend.getRaw(pluginId)).toBe("{not-json");
    await runtime.dispose();
  });

  it("keeps other plugin caches valid when one plugin changes externally", async () => {
    const backend = new MemoryPluginStorageBackend();
    const runtime = new PluginStorageRuntime({ backend });
    const storage = service(runtime, "unchanged");
    await storage.saveData({ value: "cached" });
    const read = vi.spyOn(backend, "read");

    backend.putExternal("other" as PluginId, { value: "external" });

    expect((await storage.loadData()).data).toEqual({ value: "cached" });
    expect(read).not.toHaveBeenCalled();
    await runtime.dispose();
  });

  it("rejects a migration when an external write wins before its commit", async () => {
    const backend = new MemoryPluginStorageBackend();
    const pluginId = "migration-conflict" as PluginId;
    backend.putExternal(pluginId, { value: "initial" }, 1);
    const runtime = new PluginStorageRuntime({ backend });
    const storage = service(runtime, pluginId);
    const started = deferred();
    const resume = deferred();

    const migrating = storage.migrateData({
      targetSchemaVersion: 2,
      migrate: async () => {
        started.resolve();
        await resume.promise;
        return { value: "local" };
      },
    });
    await started.promise;
    const version = backend.putExternal(pluginId, { value: "external" }, 3);
    resume.resolve();

    expect(await migrating).toMatchObject({
      ok: false,
      diagnostic: { code: "file-version-conflict" },
    });
    expect(await storage.loadData()).toEqual({
      data: { value: "external" }, version, schemaVersion: 3,
    });
    await runtime.dispose();
  });

  it("detects expected-version conflicts", async () => {
    const runtime = new PluginStorageRuntime();
    const storage = service(runtime, "conflict");
    const first = await storage.saveData({ value: 1 });
    expect(first.ok).toBe(true);
    const result = await storage.saveData(
      { value: 2 },
      { expectedVersion: "stale" },
    );
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "file-version-conflict" } });
    expect((await storage.loadData<{ value: number }>()).data).toEqual({ value: 1 });
  });

  it("rejects non-JSON data before backend mutation", async () => {
    const runtime = new PluginStorageRuntime();
    const storage = service(runtime, "json");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = await storage.saveData(cyclic as never);
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: "storage-serialization-failed" },
    });
    expect(await storage.loadData()).toEqual({ data: null, version: null, schemaVersion: null });
  });
});

describe("UnsupportedSecretStorage", () => {
  it("returns explicit unsupported results without storing secret values", async () => {
    const secrets = new UnsupportedSecretStorage();
    expect(await secrets.set("token", "never-store-this")).toMatchObject({
      ok: false,
      diagnostic: { code: "capability-unsupported" },
    });
    expect(await secrets.get("token")).toMatchObject({
      ok: false,
      diagnostic: { code: "capability-unsupported" },
    });
  });
});
