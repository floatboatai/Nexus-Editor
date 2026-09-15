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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
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

describe("PluginStorageRuntime", () => {
  it("rejects operations through retained services after disposal", async () => {
    const backend = new MemoryPluginStorageBackend();
    const read = vi.spyOn(backend, "read");
    const write = vi.spyOn(backend, "write");
    const runtime = new PluginStorageRuntime({ backend });
    const storage = service(runtime, "disposed");
    const migrate = vi.fn(() => ({ value: "migrated" }));

    await runtime.dispose();

    await expect(storage.loadData()).rejects.toThrow("Plugin storage runtime has been disposed");
    await expect(storage.saveData({ value: "late" })).rejects.toThrow(
      "Plugin storage runtime has been disposed",
    );
    await expect(storage.migrateData({ targetSchemaVersion: 1, migrate })).rejects.toThrow(
      "Plugin storage runtime has been disposed",
    );
    expect(() => service(runtime, "new")).toThrow("Plugin storage runtime has been disposed");
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(migrate).not.toHaveBeenCalled();
  });

  it("shares shutdown completion and drains accepted operations across plugins", async () => {
    const backend = new MemoryPluginStorageBackend();
    const firstGate = deferred();
    const secondGate = deferred();
    const firstStarted = deferred();
    const secondStarted = deferred();
    const write = backend.write.bind(backend);
    const writes = vi.spyOn(backend, "write").mockImplementation(async (id, data, version) => {
      if (id === "first") {
        firstStarted.resolve();
        await firstGate.promise;
      } else {
        secondStarted.resolve();
        await secondGate.promise;
      }
      return write(id, data, version);
    });
    const unsubscribe = vi.fn();
    vi.spyOn(backend, "subscribe").mockReturnValue(unsubscribe);
    const runtime = new PluginStorageRuntime({ backend });
    const first = service(runtime, "first");
    const second = service(runtime, "second");
    const saves = [
      first.saveData({ value: 1 }),
      first.saveData({ value: 2 }),
      second.saveData({ value: 3 }),
    ];
    await Promise.all([firstStarted.promise, secondStarted.promise]);

    const shutdown = runtime.dispose();
    const concurrentShutdown = runtime.dispose();
    const finished = vi.fn();
    const concurrentFinished = vi.fn();
    void shutdown.then(finished);
    void concurrentShutdown.then(concurrentFinished);
    await Promise.resolve();
    expect(concurrentFinished).not.toHaveBeenCalled();
    await expect(first.saveData({ value: 99 })).rejects.toThrow("disposed");
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    firstGate.resolve();
    await Promise.all(saves.slice(0, 2));
    expect(finished).not.toHaveBeenCalled();
    expect(concurrentFinished).not.toHaveBeenCalled();
    secondGate.resolve();
    await Promise.all([...saves, shutdown, concurrentShutdown]);

    expect(finished).toHaveBeenCalledTimes(1);
    expect(concurrentFinished).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledTimes(3);
    expect(JSON.parse(backend.getRaw("first" as PluginId)!)).toMatchObject({ data: { value: 2 } });
    expect(JSON.parse(backend.getRaw("second" as PluginId)!)).toMatchObject({ data: { value: 3 } });
    await runtime.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("finishes draining after a queued backend operation fails", async () => {
    const backend = new MemoryPluginStorageBackend();
    vi.spyOn(backend, "write").mockRejectedValueOnce(new Error("disk unavailable"));
    const runtime = new PluginStorageRuntime({ backend });
    const storage = service(runtime, "failure");
    const failed = storage.saveData({ value: 1 });
    const recovered = storage.saveData({ value: 2 });
    const rejection = expect(failed).rejects.toThrow("disk unavailable");

    const shutdown = runtime.dispose();
    await Promise.all([rejection, shutdown]);

    expect((await recovered).ok).toBe(true);
    expect(JSON.parse(backend.getRaw("failure" as PluginId)!)).toMatchObject({ data: { value: 2 } });
    await expect(storage.loadData()).rejects.toThrow("disposed");
  });

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
