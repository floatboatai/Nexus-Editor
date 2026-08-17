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
    await expect(storage.saveData({ count: 1 })).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "storage-corrupt" },
    });
    expect(corrupt).toHaveBeenCalledTimes(1);
    expect(diagnostics).toContain("storage-corrupt");
    expect(backend.getRaw(pluginId)).toBe("{not-json");
  });

  it("validates existing data before the first save", async () => {
    const backend = new MemoryPluginStorageBackend();
    const pluginId = "corrupt-first-save" as PluginId;
    backend.putCorrupt(pluginId, "{not-json");
    const storage = service(new PluginStorageRuntime({ backend }), "corrupt-first-save");

    await expect(storage.saveData({ count: 1 })).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "storage-corrupt" },
    });
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
