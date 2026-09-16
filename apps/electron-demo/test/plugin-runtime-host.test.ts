import {
  EDITOR_CLIPBOARD_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  EDITOR_TRANSACTIONS_CAPABILITY,
  FILE_MANAGER_CAPABILITY,
  METADATA_CAPABILITY,
  RESOURCES_CAPABILITY,
  SECRETS_CAPABILITY,
  UI_CAPABILITY,
  VAULT_CAPABILITY,
  NexusPluginBase,
  type AuthorPluginManifest,
  type FileManagerService,
  type ManagedResource,
  type MetadataService,
  type NexusApp,
  type NormalizedPluginManifest,
  type ResourceService,
  type UiPolicyService,
  type UiService,
  type VaultService,
} from "@floatboat/nexus-plugin-api";
import { createEditor } from "@floatboat/nexus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPluginRuntimeHost } from "../src/renderer/plugin-runtime-host";
import type {
  PluginHostBridge,
  PluginVaultChangeEvent,
  VaultSessionId,
} from "../src/shared/plugin-ipc";

const sessionId = "11111111-1111-4111-8111-111111111111" as VaultSessionId;
const nextSessionId = "22222222-2222-4222-8222-222222222222" as VaultSessionId;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function manifest(
  requiredCapabilities: AuthorPluginManifest["requiredCapabilities"],
  permissions: AuthorPluginManifest["permissions"] = [],
): AuthorPluginManifest {
  return {
    schemaVersion: 1,
    id: "electron-host-fixture",
    name: "Electron Host Fixture",
    version: "1.0.0",
    entrypoint: "fixture.js",
    apiVersion: "^1.0.0",
    requiredCapabilities,
    permissions,
  };
}

function bridgeHarness() {
  const files = new Map([["note.md", "alpha"]]);
  let changeListener: ((event: PluginVaultChangeEvent) => void) | null = null;
  let shutdownListener: (() => void) | null = null;
  let revision = 1;
  const order: string[] = [];
  const bridge: PluginHostBridge = {
    vault: {
      pick: vi.fn(async () => ({ sessionId, name: "Fixture" })),
      restore: vi.fn(async () => ({ sessionId, name: "Fixture" })),
      close: vi.fn(async () => { order.push("close-session"); return { ok: true as const }; }),
      commit: vi.fn(async () => ({ ok: true as const })),
      list: vi.fn(async () => []),
      read: vi.fn(async (_session, path) => ({
        path,
        content: files.get(path) ?? "",
        version: `ipc:${revision}` as never,
      })),
      readBinary: vi.fn(async (_session, path) => ({
        path,
        content: new TextEncoder().encode(files.get(path) ?? ""),
        version: `ipc:${revision}` as never,
      })),
      readAll: vi.fn(async () => [...files].map(([path, content]) => ({
        path,
        content,
        version: `ipc:${revision}` as never,
      }))),
      write: vi.fn(async (_session, path, content, options) => {
        files.set(path, content);
        revision += 1;
        const operationId = options?.operationId ?? `operation:${revision}`;
        changeListener?.({
          sessionId,
          kind: path === "note.md" ? "modify" : "create",
          path,
          version: `ipc:${revision}` as never,
          operationId,
          origin: "host",
        });
        return { path, version: `ipc:${revision}` as never, operationId };
      }),
      writeBinary: vi.fn(async (_session, path, content, options) => {
        files.set(path, new TextDecoder().decode(content));
        revision += 1;
        return { path, version: `ipc:${revision}` as never, operationId: options?.operationId ?? "binary" };
      }),
      createFolder: vi.fn(async (_session, path, operationId) => ({ path, operationId: operationId ?? "folder" })),
      rename: vi.fn(async (_session, path, destination, operationId) => {
        const content = files.get(path);
        if (content !== undefined) {
          files.delete(path);
          files.set(destination, content);
        }
        return { path: destination, operationId: operationId ?? "rename" };
      }),
      trash: vi.fn(async (_session, path, operationId) => {
        files.delete(path);
        return { path, operationId: operationId ?? "trash", recoverable: true as const };
      }),
      createResourceUrl: vi.fn(async () => ({
        url: "nexus-vault://resource/token",
        registrationId: "token",
      })),
      revokeResourceUrl: vi.fn(async () => ({ ok: true as const })),
      onChanged: vi.fn((callback) => {
        changeListener = callback;
        return () => { order.push("unsubscribe-vault"); changeListener = null; };
      }),
    },
    storage: {
      load: vi.fn(async () => ({ found: false, revision: 0, data: null })),
      save: vi.fn(async (_pluginId, expectedRevision) => ({ ok: true as const, revision: expectedRevision + 1 })),
    },
    secrets: {
      status: vi.fn(async () => ({ status: "unsupported" as const, reason: "fixture" })),
    },
    host: {
      activatePlugin: vi.fn(async () => ({ ok: true as const })),
      revokePlugin: vi.fn(async () => ({ ok: true as const })),
      openExternal: vi.fn(async () => ({ ok: true as const })),
      onShutdown: vi.fn((callback) => {
        shutdownListener = () => callback({ reason: "window-close" });
        return () => { order.push("unsubscribe-shutdown"); shutdownListener = null; };
      }),
      shutdownComplete: vi.fn(async () => { order.push("shutdown-complete"); return { ok: true as const }; }),
    },
  };
  return { bridge, files, order, emit: (event: PluginVaultChangeEvent) => changeListener?.(event), shutdown: () => shutdownListener?.() };
}

describe("createPluginRuntimeHost", () => {
  beforeEach(() => document.body.replaceChildren());

  it("commits plugin writes only after durable IPC succeeds and coalesces its echo", async () => {
    const harness = bridgeHarness();
    let vault!: VaultService;
    class FixturePlugin extends NexusPluginBase {
      constructor(app: NexusApp, pluginManifest: NormalizedPluginManifest) {
        super(app, pluginManifest);
      }
      override onload(): void {
        vault = this.app.capabilities.require(VAULT_CAPABILITY, "^1.0.0", {
          workspaceId: "runtime-workspace" as never,
        });
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    const enabled = await host.enableBundledPlugin(
      manifest([{ id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" }]),
      FixturePlugin,
    );
    expect(enabled.ok).toBe(true);
    const file = vault.getFileByPath("note.md" as never)!;
    const events: string[] = [];
    vault.events.on("modify", ({ origin }) => events.push(`${origin.kind}:${origin.operationId}`));

    const written = await vault.modify(file, "beta");

    expect(written.ok).toBe(true);
    expect(await vault.read(file)).toBe("beta");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatch(/^plugin:renderer:electron-host-fixture:/);
    expect(harness.bridge.vault.write).toHaveBeenCalledWith(
      sessionId,
      "note.md",
      "beta",
      expect.objectContaining({ operationId: expect.stringMatching(/^renderer:/) }),
    );
    await host.shutdown();
  });

  it("does not mutate the mirror when durable IPC rejects", async () => {
    const harness = bridgeHarness();
    harness.bridge.vault.write = vi.fn(async () => { throw new Error("disk full"); });
    let vault!: VaultService;
    class FixturePlugin extends NexusPluginBase {
      override onload(): void {
        vault = this.app.capabilities.require(VAULT_CAPABILITY, "^1.0.0", {
          workspaceId: "runtime-workspace" as never,
        });
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(
      manifest([{ id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" }]),
      FixturePlugin,
    );
    const file = vault.getFileByPath("note.md" as never)!;

    const result = await vault.modify(file, "lost");

    expect(result).toMatchObject({ ok: false });
    expect(await vault.read(file)).toBe("alpha");
    await host.shutdown();
  });

  it("finishes a deferred write in its original session before switching Vault mirrors", async () => {
    const harness = bridgeHarness();
    const written = deferred<Awaited<ReturnType<PluginHostBridge["vault"]["write"]>>>();
    vi.mocked(harness.bridge.vault.write).mockImplementationOnce(() => written.promise);
    let vault!: VaultService;
    class FixturePlugin extends NexusPluginBase {
      override onload(): void {
        vault = this.app.capabilities.require(VAULT_CAPABILITY, "^1.0.0", {
          workspaceId: "runtime-workspace" as never,
        });
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(
      manifest([{ id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" }]),
      FixturePlugin,
    );
    const previousVault = host.vault;
    const file = vault.getFileByPath("note.md" as never)!;
    const picked = deferred<Awaited<ReturnType<PluginHostBridge["vault"]["pick"]>>>();
    vi.mocked(harness.bridge.vault.pick).mockImplementationOnce(() => picked.promise);

    const writing = vault.modify(file, "beta");
    await vi.waitFor(() => expect(harness.bridge.vault.write).toHaveBeenCalledOnce());
    const switching = host.pickSession();
    expect(harness.bridge.vault.pick).not.toHaveBeenCalled();
    written.resolve({ path: "note.md", version: "ipc:2" as never, operationId: "deferred-write" });

    await expect(writing).resolves.toMatchObject({ ok: true });
    await vi.waitFor(() => expect(harness.bridge.vault.pick).toHaveBeenCalledOnce());
    expect(await previousVault.read(previousVault.getFileByPath("note.md")!)).toBe("beta");
    picked.resolve({ sessionId: nextSessionId, name: "Next" });
    await expect(switching).resolves.toMatchObject({ sessionId: nextSessionId });
    expect(host.vault).not.toBe(previousVault);
    expect(await host.vault.read(host.vault.getFileByPath("note.md")!)).toBe("alpha");
    await host.shutdown();
  });

  it("waits for an in-flight product write during shutdown and rejects queued mutations", async () => {
    const harness = bridgeHarness();
    const written = deferred<Awaited<ReturnType<PluginHostBridge["vault"]["write"]>>>();
    vi.mocked(harness.bridge.vault.write).mockImplementationOnce(() => written.promise);
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();

    const first = host.productContent.write("note.md", "beta");
    await vi.waitFor(() => expect(harness.bridge.vault.write).toHaveBeenCalledOnce());
    const second = host.productContent.write("queued.md", "queued");
    const shuttingDown = host.shutdown();
    expect(harness.bridge.host.shutdownComplete).not.toHaveBeenCalled();

    written.resolve({ path: "note.md", version: "ipc:2" as never, operationId: "product-write" });
    await expect(first).resolves.toEqual({ path: "note.md" });
    await expect(second).rejects.toThrow("Vault write was rejected");
    await shuttingDown;
    expect(harness.bridge.vault.write).toHaveBeenCalledTimes(1);
    expect(harness.bridge.host.shutdownComplete).toHaveBeenCalledOnce();
  });

  it("publishes watcher CRUD through Vault, metadata, then the renderer using relative paths", async () => {
    const harness = bridgeHarness();
    const observed: string[] = [];
    const visiblePaths: string[] = [];
    class ObserverPlugin extends NexusPluginBase {
      override onload(): void {
        const context = { workspaceId: "runtime-workspace" as never };
        const vault = this.app.capabilities.require(VAULT_CAPABILITY, "^1.0.0", context);
        const metadata = this.app.capabilities.require(METADATA_CAPABILITY, "^1.0.0", context);
        vault.events.on("create", ({ file }) => {
          visiblePaths.push(file.path);
          observed.push(`vault:create:${file.path}`);
        });
        vault.events.on("modify", ({ file }) => {
          visiblePaths.push(file.path);
          observed.push(`vault:modify:${file.path}`);
        });
        vault.events.on("rename", ({ file, oldPath }) => {
          visiblePaths.push(oldPath, file.path);
          observed.push(`vault:rename:${oldPath}->${file.path}`);
        });
        vault.events.on("delete", ({ path }) => {
          visiblePaths.push(path);
          observed.push(`vault:delete:${path}`);
        });
        metadata.events.on("changed", ({ file }) => {
          visiblePaths.push(file.path);
          observed.push(`metadata:changed:${file.path}`);
        });
        metadata.events.on("resolved", () => observed.push("metadata:resolved"));
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    const rendererUpdates: string[] = [];
    const unsubscribeRenderer = host.linkIndex.subscribe(() => {
      observed.push("renderer");
      rendererUpdates.push(host.linkIndex.resolve("note", null) ?? "missing");
    });
    await host.enableBundledPlugin(
      manifest([
        { id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
        { id: METADATA_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
      ]),
      ObserverPlugin,
    );

    harness.files.set("created.md", "See [[note]].");
    harness.emit({
      sessionId,
      kind: "create",
      path: "created.md",
      version: "ipc:2" as never,
      operationId: "watch:create",
      origin: "external",
    });
    await vi.waitFor(() => expect(observed).toEqual([
      "vault:create:created.md",
      "metadata:changed:created.md",
      "metadata:resolved",
      "renderer",
    ]));

    observed.length = 0;
    harness.files.set("created.md", "Updated [[note]].");
    harness.emit({
      sessionId,
      kind: "modify",
      path: "created.md",
      version: "ipc:3" as never,
      operationId: "watch:modify",
      origin: "external",
    });
    await vi.waitFor(() => expect(observed).toEqual([
      "vault:modify:created.md",
      "metadata:changed:created.md",
      "metadata:resolved",
      "renderer",
    ]));

    observed.length = 0;
    harness.files.delete("created.md");
    harness.files.set("renamed.md", "Updated [[note]].");
    harness.emit({
      sessionId,
      kind: "rename",
      path: "renamed.md",
      oldPath: "created.md",
      version: "ipc:4" as never,
      operationId: "watch:rename",
      origin: "external",
    });
    await vi.waitFor(() => expect(observed).toEqual([
      "vault:rename:created.md->renamed.md",
      "metadata:changed:renamed.md",
      "metadata:resolved",
      "renderer",
    ]));

    observed.length = 0;
    harness.files.delete("renamed.md");
    harness.emit({
      sessionId,
      kind: "delete",
      path: "renamed.md",
      operationId: "watch:delete",
      origin: "external",
    });
    await vi.waitFor(() => expect(observed).toEqual([
      "vault:delete:renamed.md",
      "metadata:resolved",
      "renderer",
    ]));

    expect(rendererUpdates).toEqual(["note.md", "note.md", "note.md", "note.md"]);
    expect(visiblePaths.length).toBeGreaterThan(0);
    expect(visiblePaths.every((path) => (
      !path.startsWith("/") &&
      !/^[a-z]:[\\/]/i.test(path) &&
      !path.includes("/vault/")
    ))).toBe(true);
    unsubscribeRenderer();
    await host.shutdown();
  });

  it("waits for a durable write before exposing metadata and renderer backlinks", async () => {
    const harness = bridgeHarness();
    harness.files.set("source.md", "No links yet.");
    let vault!: VaultService;
    let metadata!: MetadataService;
    class FixturePlugin extends NexusPluginBase {
      override onload(): void {
        const context = { workspaceId: "runtime-workspace" as never };
        vault = this.app.capabilities.require(VAULT_CAPABILITY, "^1.0.0", context);
        metadata = this.app.capabilities.require(METADATA_CAPABILITY, "^1.0.0", context);
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(
      manifest([
        { id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
        { id: METADATA_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
      ]),
      FixturePlugin,
    );
    const source = vault.getFileByPath("source.md" as never)!;
    const target = vault.getFileByPath("note.md" as never)!;

    const written = await vault.modify(source, "See [[note]].");
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error(written.diagnostic.message);
    const indexed = await metadata.waitForVersion(source, written.version);

    expect(indexed.version).toBe(written.version);
    expect(metadata.getBacklinks(target).map((link) => link.source.path)).toEqual(["source.md"]);
    expect(host.linkIndex.getBacklinks("note.md")).toMatchObject([
      { sourcePath: "source.md", target: "note" },
    ]);
    await host.shutdown();
  });

  it("migrates an unresolved link after its target is durably created", async () => {
    const harness = bridgeHarness();
    harness.files.set("source.md", "See [[Later]].");
    let vault!: VaultService;
    let metadata!: MetadataService;
    class FixturePlugin extends NexusPluginBase {
      override onload(): void {
        const context = { workspaceId: "runtime-workspace" as never };
        vault = this.app.capabilities.require(VAULT_CAPABILITY, "^1.0.0", context);
        metadata = this.app.capabilities.require(METADATA_CAPABILITY, "^1.0.0", context);
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(
      manifest([
        { id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
        { id: METADATA_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
      ]),
      FixturePlugin,
    );
    const source = vault.getFileByPath("source.md" as never)!;
    expect(metadata.getUnresolvedLinks(source).map((link) => link.target)).toEqual(["Later"]);
    expect(host.linkIndex.resolve("Later", "source.md")).toBeNull();

    const created = await vault.create("Later.md" as never, "Target");
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.diagnostic.message);
    await metadata.waitForVersion(created.file, created.version);

    expect(metadata.getUnresolvedLinks(source)).toEqual([]);
    expect(metadata.resolveLink("Later", source.path)?.id).toBe(created.file.id);
    expect(metadata.getBacklinks(created.file).map((link) => link.source.path)).toEqual(["source.md"]);
    expect(host.linkIndex.resolve("Later", "source.md")).toBe("Later.md");
    await host.shutdown();
  });

  it("moves a file and rewrites links before a queued Vault switch can start", async () => {
    const harness = bridgeHarness();
    harness.files.set("source.md", "See [[note]].");
    const referenceWrite = deferred<Awaited<ReturnType<PluginHostBridge["vault"]["write"]>>>();
    let vault!: VaultService;
    let fileManager!: FileManagerService;
    class FixturePlugin extends NexusPluginBase {
      override onload(): void {
        const context = { workspaceId: "runtime-workspace" as never };
        vault = this.app.capabilities.require(VAULT_CAPABILITY, "^1.0.0", context);
        fileManager = this.app.capabilities.require(FILE_MANAGER_CAPABILITY, "^1.0.0", context);
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(
      manifest([
        { id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
        { id: FILE_MANAGER_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
      ]),
      FixturePlugin,
    );
    const target = vault.getFileByPath("note.md" as never)!;
    const targetId = target.id;
    vi.mocked(harness.bridge.vault.write).mockImplementationOnce(async (_session, path, content) => {
      harness.files.set(path, content);
      return referenceWrite.promise;
    });
    const picked = deferred<Awaited<ReturnType<PluginHostBridge["vault"]["pick"]>>>();
    vi.mocked(harness.bridge.vault.pick).mockImplementationOnce(() => picked.promise);

    const moving = fileManager.moveFile(target, "renamed.md" as never, { updateLinks: "always" });
    await vi.waitFor(() => expect(harness.bridge.vault.write).toHaveBeenCalledWith(
      sessionId,
      "source.md",
      "See [[renamed]].",
      expect.objectContaining({ operationId: expect.stringMatching(/^renderer:/) }),
    ));
    const switching = host.pickSession();
    expect(harness.bridge.vault.pick).not.toHaveBeenCalled();

    referenceWrite.resolve({
      path: "source.md",
      version: "ipc:3" as never,
      operationId: "rewrite-reference",
    });
    await expect(moving).resolves.toMatchObject({ ok: true, value: { id: targetId, path: "renamed.md" } });
    await vi.waitFor(() => expect(harness.bridge.vault.pick).toHaveBeenCalledOnce());
    expect(await host.vault.read(host.vault.getFileByPath("source.md")!)).toBe("See [[renamed]].");
    expect(host.linkIndex.getBacklinks("renamed.md")).toMatchObject([
      { sourcePath: "source.md", target: "renamed" },
    ]);

    picked.resolve(null);
    await expect(switching).resolves.toBeNull();
    await host.shutdown();
  });

  it("hydrates empty folders and durably applies safe frontmatter without overwriting files", async () => {
    const harness = bridgeHarness();
    harness.files.set("note.md", "Body\r\ncontinues\r\n");
    vi.mocked(harness.bridge.vault.list).mockResolvedValueOnce([{
      name: "Empty",
      path: "Empty",
      kind: "folder",
      children: [],
    }]);
    let vault!: VaultService;
    let fileManager!: FileManagerService;
    class FixturePlugin extends NexusPluginBase {
      override onload(): void {
        const context = { workspaceId: "runtime-workspace" as never };
        vault = this.app.capabilities.require(VAULT_CAPABILITY, "^1.0.0", context);
        fileManager = this.app.capabilities.require(FILE_MANAGER_CAPABILITY, "^1.0.0", context);
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(
      manifest([
        { id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
        { id: FILE_MANAGER_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
      ]),
      FixturePlugin,
    );
    const file = vault.getFileByPath("note.md" as never)!;
    vi.mocked(harness.bridge.vault.write).mockClear();

    const duplicate = await vault.create("note.md" as never, "replacement");
    const frontmatter = await fileManager.processFrontmatter(file, (data) => {
      data.status = "done";
      data.count = 2;
    });

    expect(host.vault.getFolderByPath("Empty")).not.toBeNull();
    expect(duplicate).toMatchObject({ ok: false });
    expect(frontmatter.ok).toBe(true);
    expect(await vault.read(file)).toContain("status: done\r\ncount: 2");
    expect((await vault.read(file)).endsWith("Body\r\ncontinues\r\n")).toBe(true);
    expect(harness.bridge.vault.write).toHaveBeenCalledTimes(1);
    expect(harness.bridge.vault.write).toHaveBeenCalledWith(
      sessionId,
      "note.md",
      expect.stringContaining("status: done"),
      expect.objectContaining({ operationId: expect.stringMatching(/^renderer:/) }),
    );
    await host.shutdown();
  });

  it("routes host-owned product CRUD through relative durable operations", async () => {
    const harness = bridgeHarness();
    vi.mocked(harness.bridge.vault.list).mockResolvedValueOnce([{
      name: "Empty",
      path: "Empty",
      kind: "folder",
      children: [],
    }]);
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();

    expect(host.productContent.list()).toMatchObject([{
      name: "Empty",
      path: "Empty",
      kind: "folder",
      children: [],
    }, {
      name: "note.md",
      path: "note.md",
      kind: "file",
    }]);
    await expect(host.productContent.read("note.md")).resolves.toEqual({
      path: "note.md",
      content: "alpha",
    });
    await host.productContent.write("note.md", "updated");
    await host.productContent.createFolder("Folder");
    await host.productContent.createFile("Folder/new.md");
    await host.productContent.rename("Folder/new.md", "Folder/renamed.md");
    await host.productContent.trash("Folder/renamed.md");

    expect(harness.bridge.vault.write).toHaveBeenNthCalledWith(
      1,
      sessionId,
      "note.md",
      "updated",
      expect.objectContaining({ operationId: expect.stringMatching(/^renderer:nexus-electron-product:/) }),
    );
    expect(harness.bridge.vault.write).toHaveBeenNthCalledWith(
      2,
      sessionId,
      "Folder/new.md",
      "",
      expect.objectContaining({ operationId: expect.stringMatching(/^renderer:nexus-electron-product:/) }),
    );
    expect(harness.bridge.vault.createFolder).toHaveBeenCalledWith(
      sessionId,
      "Folder",
      expect.stringMatching(/^renderer:nexus-electron-product:/),
    );
    expect(harness.bridge.vault.rename).toHaveBeenCalledWith(
      sessionId,
      "Folder/new.md",
      "Folder/renamed.md",
      expect.stringMatching(/^renderer:nexus-electron-product:/),
    );
    expect(harness.bridge.vault.trash).toHaveBeenCalledWith(
      sessionId,
      "Folder/renamed.md",
      expect.stringMatching(/^renderer:nexus-electron-product:/),
    );
    expect(host.vault.getAbstractFileByPath("Folder/renamed.md")).toBeNull();
    await host.shutdown();
  });

  it("rescans external empty-folder changes into the shared mirror", async () => {
    const harness = bridgeHarness();
    vi.mocked(harness.bridge.vault.list).mockResolvedValueOnce([{
      name: "OldEmpty",
      path: "OldEmpty",
      kind: "folder",
      children: [],
    }]);
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    expect(host.vault.getFolderByPath("OldEmpty")).not.toBeNull();
    vi.mocked(harness.bridge.vault.list).mockResolvedValueOnce([{
      name: "NewEmpty",
      path: "NewEmpty",
      kind: "folder",
      children: [],
    }]);

    harness.emit({
      sessionId,
      kind: "rescan",
      path: "",
      origin: "external",
    });

    await vi.waitFor(() => {
      expect(host.vault.getFolderByPath("OldEmpty")).toBeNull();
      expect(host.vault.getFolderByPath("NewEmpty")).not.toBeNull();
    });
    await host.shutdown();
  });

  it("revokes IPC resource URLs on plugin disable", async () => {
    const harness = bridgeHarness();
    let resources!: ResourceService;
    class FixturePlugin extends NexusPluginBase {
      override async onload(): Promise<void> {
        const vault = this.app.capabilities.require(VAULT_CAPABILITY, "^1.0.0", {
          workspaceId: "runtime-workspace" as never,
        });
        resources = this.app.capabilities.require(RESOURCES_CAPABILITY, "^1.0.0", {
          workspaceId: "runtime-workspace" as never,
        });
        await resources.createResourceUrl(vault.getFileByPath("note.md" as never)!);
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(
      manifest([
        { id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
        { id: RESOURCES_CAPABILITY.id, version: "^1.0.0", scope: "workspace" },
      ]),
      FixturePlugin,
    );

    await host.pluginManager.disable("electron-host-fixture");

    expect(harness.bridge.vault.revokeResourceUrl).toHaveBeenCalledWith(sessionId, "token");
    await host.shutdown();
  });

  it("requires both manifest declaration and host approval for external navigation", async () => {
    const harness = bridgeHarness();
    vi.mocked(harness.bridge.host.openExternal).mockRejectedValue(new Error("host-permission-denied"));
    let policy!: UiPolicyService;
    class FixturePlugin extends NexusPluginBase {
      override onload(): void {
        policy = this.app.capabilities.require(UI_CAPABILITY, "^1.0.0", {
          windowId: "electron-window" as never,
        }).policy;
      }
    }
    const host = createPluginRuntimeHost({
      bridge: harness.bridge,
      document,
      permissionDecisions: () => ({ "host.external-url.https": "granted" }),
    });
    const enabled = await host.enableBundledPlugin(
      manifest([{ id: UI_CAPABILITY.id, version: "^1.0.0", scope: "window" }]),
      FixturePlugin,
    );
    expect(enabled.ok).toBe(true);

    await expect(policy.openExternalUrl("https://example.com", host.windowContext))
      .resolves.toMatchObject({ ok: false, diagnostic: { code: "permission-denied" } });
    expect(harness.bridge.host.activatePlugin).not.toHaveBeenCalled();
    expect(harness.bridge.host.openExternal).toHaveBeenCalledWith(
      "electron-host-fixture",
      "https://example.com/",
    );
    await host.shutdown();
  });

  it("keeps HTTPS and mailto grants independent and revokes them on plugin disable", async () => {
    const harness = bridgeHarness();
    vi.mocked(harness.bridge.host.openExternal).mockImplementation(async (_pluginId, url) => {
      if (url.startsWith("mailto:")) throw new Error("host-permission-denied");
      return { ok: true as const };
    });
    let policy!: UiPolicyService;
    class FixturePlugin extends NexusPluginBase {
      override onload(): void {
        policy = this.app.capabilities.require(UI_CAPABILITY, "^1.0.0", {
          windowId: "electron-window" as never,
        }).policy;
      }
    }
    const host = createPluginRuntimeHost({
      bridge: harness.bridge,
      document,
      permissionDecisions: () => ({
        "host.external-url.https": "granted",
        "host.external-protocol.mailto": "denied",
      }),
    });
    await host.enableBundledPlugin(
      manifest(
        [{ id: UI_CAPABILITY.id, version: "^1.0.0", scope: "window" }],
        [
          { id: "host.external-url.https", purpose: "Open documentation" },
          { id: "host.external-protocol.mailto", purpose: "Compose support email" },
        ],
      ),
      FixturePlugin,
    );

    await expect(policy.openExternalUrl("https://example.com/docs", host.windowContext))
      .resolves.toEqual({ ok: true, value: undefined });
    await expect(policy.openExternalUrl("mailto:support@example.com", host.windowContext))
      .resolves.toMatchObject({ ok: false, diagnostic: { code: "permission-denied" } });
    expect(harness.bridge.host.activatePlugin).toHaveBeenCalledWith("electron-host-fixture");

    await host.pluginManager.disable("electron-host-fixture");

    await vi.waitFor(() => expect(harness.bridge.host.revokePlugin)
      .toHaveBeenCalledWith("electron-host-fixture"));
    vi.mocked(harness.bridge.host.openExternal).mockClear();
    await expect(policy.openExternalUrl("https://example.com/after-disable", host.windowContext))
      .resolves.toMatchObject({ ok: false, diagnostic: { code: "permission-denied" } });
    expect(harness.bridge.host.openExternal).not.toHaveBeenCalled();
    await host.shutdown();
  });

  it("keeps plugin-wide external grants active when one UI capability owner is disposed", async () => {
    const harness = bridgeHarness();
    class FixturePlugin extends NexusPluginBase {}
    const host = createPluginRuntimeHost({
      bridge: harness.bridge,
      document,
      permissionDecisions: () => ({ "host.external-url.https": "granted" }),
    });
    await host.enableBundledPlugin(
      manifest(
        [{ id: UI_CAPABILITY.id, version: "^1.0.0", scope: "window" }],
        [{ id: "host.external-url.https", purpose: "Open documentation" }],
      ),
      FixturePlugin,
    );
    const internals = host as unknown as {
      createUiService(
        owner: { pluginId: string; componentId: string },
        registerResource: (resource: ManagedResource) => void,
      ): UiService;
    };
    const firstResources: ManagedResource[] = [];
    const secondResources: ManagedResource[] = [];
    const first = internals.createUiService(
      { pluginId: "electron-host-fixture", componentId: "electron-host-fixture/child:first" },
      (resource) => firstResources.push(resource),
    );
    const second = internals.createUiService(
      { pluginId: "electron-host-fixture", componentId: "electron-host-fixture/child:second" },
      (resource) => secondResources.push(resource),
    );

    await firstResources[0]!.dispose();
    await expect(first.policy.openExternalUrl("https://example.com/first", host.windowContext))
      .resolves.toMatchObject({ ok: false, diagnostic: { code: "permission-denied" } });
    expect(harness.bridge.host.revokePlugin).not.toHaveBeenCalled();
    await expect(second.policy.openExternalUrl("https://example.com/second", host.windowContext))
      .resolves.toEqual({ ok: true, value: undefined });

    await secondResources[0]!.dispose();
    await host.pluginManager.disable("electron-host-fixture");
    await vi.waitFor(() => expect(harness.bridge.host.revokePlugin)
      .toHaveBeenCalledTimes(1));
    await host.shutdown();
  });

  it("revokes and restores host grants while switching Vault sessions", async () => {
    const harness = bridgeHarness();
    class FixturePlugin extends NexusPluginBase {}
    const host = createPluginRuntimeHost({
      bridge: harness.bridge,
      document,
      permissionDecisions: () => ({ "host.external-url.https": "granted" }),
    });
    await host.restoreSession();
    await host.enableBundledPlugin(
      manifest([], [{ id: "host.external-url.https", purpose: "Open documentation" }]),
      FixturePlugin,
    );
    vi.mocked(harness.bridge.vault.pick).mockResolvedValueOnce({
      sessionId: nextSessionId,
      name: "Next",
    });

    await host.pickSession();

    expect(harness.bridge.host.revokePlugin).toHaveBeenCalledTimes(1);
    expect(harness.bridge.host.activatePlugin).toHaveBeenCalledTimes(2);
    expect(harness.bridge.host.activatePlugin).toHaveBeenLastCalledWith("electron-host-fixture");
    await host.shutdown();
  });

  it("attaches one editor and destroys it after detach/leaf close but before IPC close", async () => {
    const harness = bridgeHarness();
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    const root = document.createElement("div");
    document.body.append(root);
    let registrationSequence = 0;
    const registration = (ownerId: string, kind: string) => {
      let disposed = false;
      return {
        id: `${kind}:${++registrationSequence}`,
        ownerId,
        get disposed() { return disposed; },
        ready: Promise.resolve(),
        dispose: vi.fn(async () => { disposed = true; }),
      };
    };
    const sink = {
      registerExtension: vi.fn((ownerId: string) => ({
        ...registration(ownerId, "extension"),
      })),
      registerDomEvent: vi.fn((ownerId: string) => registration(ownerId, "dom")),
      registerInputTarget: vi.fn(),
      registerTransactionFilter: vi.fn(),
      registerUpdateListener: vi.fn(),
      isInteractionActive: () => false,
      refresh: vi.fn(async () => undefined),
    };
    const editorEvents = new Map<string, Set<() => void>>();
    const on = vi.fn((event: string, handler: () => void) => {
      const handlers = editorEvents.get(event) ?? new Set<() => void>();
      handlers.add(handler);
      editorEvents.set(event, handlers);
    });
    const off = vi.fn((event: string, handler: () => void) => {
      editorEvents.get(event)?.delete(handler);
    });
    const editor = { getContributionSink: () => sink, on, off } as never;
    const markRecent = vi.spyOn(host.editorHost, "markRecent");
    const attachment = await host.attachEditor(editor, root);
    expect(markRecent).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(sink.registerDomEvent).toHaveBeenCalledTimes(4);
    const recentChanged = vi.fn();
    const recentEvents = host.editorHost.createService({
      pluginId: "host-test" as never,
      componentId: "host-test:root" as never,
    }, (resource) => void resource.activate?.()).events.on("recentChanged", recentChanged);
    editorEvents.get("focus")?.forEach((handler) => handler());
    expect(markRecent).toHaveBeenCalledTimes(2);
    expect(recentChanged).not.toHaveBeenCalled();
    await host.setActiveFile("note.md");
    expect(attachment.context.file?.path).toBe("note.md");
    expect(host.leaf.editorId).toBe(attachment.editorId);

    await host.shutdown({
      destroyEditor: () => {
        expect(attachment.detached).toBe(true);
        expect(host.workspace.getLeaves()).toHaveLength(0);
        harness.order.push("destroy-editor");
      },
    });

    expect(off).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(editorEvents.get("focus")).toHaveLength(0);
    await recentEvents.dispose();
    expect(harness.order).toEqual([
      "destroy-editor",
      "close-session",
      "unsubscribe-vault",
      "unsubscribe-shutdown",
      "shutdown-complete",
    ]);
  });

  it("rejects a required Secret capability before constructing the plugin", async () => {
    const harness = bridgeHarness();
    let constructions = 0;
    class SecretRequiredPlugin extends NexusPluginBase {
      constructor(app: NexusApp, pluginManifest: NormalizedPluginManifest) {
        super(app, pluginManifest);
        constructions += 1;
      }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    const result = await host.enableBundledPlugin(
      manifest([{
        id: SECRETS_CAPABILITY.id,
        version: "^1.0.0",
        scope: "application",
      }]),
      SecretRequiredPlugin,
    );

    expect(result).toMatchObject({
      ok: false,
      state: "incompatible",
      diagnostics: [expect.objectContaining({
        code: "capability-unsupported",
        capability: expect.objectContaining({ id: SECRETS_CAPABILITY.id }),
      })],
    });
    expect(constructions).toBe(0);
    await host.shutdown();
  });

  it("wires editor-scoped clipboard filters to real DOM events and leaves secrets unsupported", async () => {
    const harness = bridgeHarness();
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({ container, initialValue: "alpha" });
    const attachment = await host.attachEditor(editor, container);
    let secretResolution: ReturnType<NexusApp["capabilities"]["resolve"]> | null = null;
    const beforeInputs: string[] = [];

    class ClipboardPlugin extends NexusPluginBase {
      override onload(): void {
        const context = { editorId: "electron-primary-editor" as never };
        const clipboard = this.app.capabilities.require(
          EDITOR_CLIPBOARD_CAPABILITY,
          "^1.0.0",
          context,
        );
        const editorHost = this.app.capabilities.require(EDITOR_HOST_CAPABILITY);
        const beforeInput = editorHost.registerDomEvent("beforeinput", (event) => {
          beforeInputs.push(event.inputType);
          return "consume";
        }, { matches: (context) => context.editorId === attachment.editorId });
        if (!beforeInput.ok) throw new Error("Could not register beforeinput hook");
        secretResolution = this.app.capabilities.resolve(SECRETS_CAPABILITY, "^1.0.0");
        for (const operation of ["paste", "drop", "copy", "cut"] as const) {
          const result = clipboard.registerFilter(operation, (payload) => ({
            action: "replace",
            payload: { ...payload, text: `${operation}:${payload.text ?? ""}` },
          }));
          if (!result.ok) throw new Error(`Could not register ${operation} filter`);
        }
      }
    }

    const enabled = await host.enableBundledPlugin({
      ...manifest([{
        id: EDITOR_CLIPBOARD_CAPABILITY.id,
        version: "^1.0.0",
        scope: "editor",
      }, {
        id: EDITOR_HOST_CAPABILITY.id,
        version: "^1.0.0",
        scope: "application",
      }]),
      optionalCapabilities: [{
        id: SECRETS_CAPABILITY.id,
        version: "^1.0.0",
        scope: "application",
      }],
    }, ClipboardPlugin);
    expect(enabled.ok).toBe(true);
    expect(secretResolution).toMatchObject({
      status: "unsupported",
      diagnostic: { code: "capability-unsupported" },
    });
    expect(host.capabilities.listProviders({ editorId: attachment.editorId }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ descriptor: expect.objectContaining({ id: EDITOR_CLIPBOARD_CAPABILITY.id }) }),
      ]));
    expect(host.capabilities.listProviders({}))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ descriptor: expect.objectContaining({ id: SECRETS_CAPABILITY.id }) }),
      ]));

    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("Expected CodeMirror content DOM");
    const beforeInput = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "x",
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(true);
    expect(beforeInputs).toEqual(["insertText"]);
    const incomingEvent = (
      type: "paste" | "drop",
      property: "clipboardData" | "dataTransfer",
      text: string,
    ): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, property, {
        value: {
          types: ["text/plain"],
          files: [],
          items: [],
          getData: (format: string) => format === "text/plain" ? text : "",
        },
      });
      return event;
    };
    const outgoingEvent = (
      type: "copy" | "cut",
      setData: (format: string, value: string) => void,
    ): ClipboardEvent => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", {
        value: { clearData: vi.fn(), setData, items: { add: vi.fn() } },
      });
      return event;
    };

    editor.setSelection(5);
    const paste = incomingEvent("paste", "clipboardData", "incoming");
    content.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(editor.getDocument()).toBe("alphapaste:incoming");

    editor.setSelection(editor.getDocument().length);
    const drop = incomingEvent("drop", "dataTransfer", "dropped");
    content.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(editor.getDocument()).toBe("alphapaste:incomingdrop:dropped");

    editor.setSelection(0, 5);
    const copied = new Map<string, string>();
    const copy = outgoingEvent("copy", (format, value) => copied.set(format, value));
    content.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(copied.get("text/plain")).toBe("copy:alpha");
    expect(editor.getDocument()).toBe("alphapaste:incomingdrop:dropped");

    editor.setSelection(0, 5);
    const cutValues = new Map<string, string>();
    const cut = outgoingEvent("cut", (format, value) => cutValues.set(format, value));
    content.dispatchEvent(cut);
    expect(cut.defaultPrevented).toBe(true);
    expect(cutValues.get("text/plain")).toBe("cut:alpha");
    expect(editor.getDocument()).toBe("paste:incomingdrop:dropped");

    editor.setSelection(0, 5);
    const beforeFailedCut = editor.getDocument();
    const failedCut = outgoingEvent("cut", () => { throw new DOMException("denied", "NotAllowedError"); });
    content.dispatchEvent(failedCut);
    expect(failedCut.defaultPrevented).toBe(true);
    expect(editor.getDocument()).toBe(beforeFailedCut);

    await attachment.detach();
    expect(host.capabilities.listProviders({ editorId: attachment.editorId }))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ descriptor: expect.objectContaining({ id: EDITOR_CLIPBOARD_CAPABILITY.id }) }),
      ]));
    editor.destroy();
    await host.shutdown();
  });

  it("provides the editor transaction capability and lets a plugin filter a real edit", async () => {
    const harness = bridgeHarness();
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({ container, initialValue: "alpha" });
    const attachment = await host.attachEditor(editor, container);

    class TransactionsPlugin extends NexusPluginBase {
      override onload(): void {
        const transactions = this.app.capabilities.require(
          EDITOR_TRANSACTIONS_CAPABILITY,
          "^1.0.0",
          { editorId: attachment.editorId },
        );
        const registered = transactions.registerFilter((context) => ({
          action: "replace",
          transaction: {
            ...context.transaction,
            changes: context.transaction.changes.map((change) => ({
              ...change,
              insert: `X${change.insert}`,
            })),
          },
        }));
        if (!registered.ok) throw new Error("Could not register the transaction filter");
      }
    }

    const enabled = await host.enableBundledPlugin({
      ...manifest([{
        id: EDITOR_TRANSACTIONS_CAPABILITY.id,
        version: "^1.0.0",
        scope: "editor",
      }]),
    }, TransactionsPlugin);
    expect(enabled).toMatchObject({ ok: true, state: "enabled" });
    expect(host.capabilities.listProviders({ editorId: attachment.editorId }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          descriptor: expect.objectContaining({ id: EDITOR_TRANSACTIONS_CAPABILITY.id }),
        }),
      ]));

    editor.replaceRange(0, 5, "beta");
    expect(editor.getDocument()).toBe("Xbeta");

    await attachment.detach();
    expect(host.capabilities.listProviders({ editorId: attachment.editorId }))
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          descriptor: expect.objectContaining({ id: EDITOR_TRANSACTIONS_CAPABILITY.id }),
        }),
      ]));
    editor.destroy();
    await host.shutdown();
  });

  it("keeps the current session and restores enabled plugins when picking is cancelled", async () => {
    const harness = bridgeHarness();
    let loads = 0;
    let unloads = 0;
    class LifecyclePlugin extends NexusPluginBase {
      override onload(): void { loads += 1; }
      override onunload(): void { unloads += 1; }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(manifest([]), LifecyclePlugin);
    const previousVault = host.vault;
    const previousMetadata = host.metadata;
    vi.mocked(harness.bridge.vault.pick).mockResolvedValueOnce(null);
    vi.mocked(harness.bridge.vault.readAll).mockClear();
    vi.mocked(harness.bridge.vault.close).mockClear();

    await expect(host.pickSession()).resolves.toBeNull();

    expect(host.session?.sessionId).toBe(sessionId);
    expect(host.vault).toBe(previousVault);
    expect(host.metadata).toBe(previousMetadata);
    expect(await host.vault.read(host.vault.getFileByPath("note.md")!)).toBe("alpha");
    expect(host.pluginManager.get("electron-host-fixture")?.state).toBe("enabled");
    expect({ loads, unloads }).toEqual({ loads: 2, unloads: 1 });
    expect(harness.bridge.vault.readAll).not.toHaveBeenCalled();
    expect(harness.bridge.vault.close).not.toHaveBeenCalled();
    await host.shutdown();
  });

  it("waits for a deferred pick during shutdown without committing or re-enabling plugins", async () => {
    const harness = bridgeHarness();
    let loads = 0;
    let unloads = 0;
    class LifecyclePlugin extends NexusPluginBase {
      override onload(): void { loads += 1; }
      override onunload(): void { unloads += 1; }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(manifest([]), LifecyclePlugin);
    const picked = deferred<Awaited<ReturnType<PluginHostBridge["vault"]["pick"]>>>();
    vi.mocked(harness.bridge.vault.pick).mockImplementationOnce(() => picked.promise);
    vi.mocked(harness.bridge.vault.close).mockClear();

    const picking = host.pickSession();
    await vi.waitFor(() => expect(harness.bridge.vault.pick).toHaveBeenCalledTimes(1));
    const shuttingDown = host.shutdown();
    expect(harness.bridge.host.shutdownComplete).not.toHaveBeenCalled();
    picked.resolve({ sessionId: nextSessionId, name: "Next" });

    await expect(picking).rejects.toThrow("shutting down");
    await shuttingDown;
    expect(harness.bridge.vault.readAll).toHaveBeenCalledTimes(1);
    expect(harness.bridge.vault.close).toHaveBeenNthCalledWith(1, nextSessionId);
    expect(harness.bridge.vault.close).toHaveBeenNthCalledWith(2, sessionId);
    expect(host.pluginManager.get("electron-host-fixture")?.state).toBe("disabled");
    expect({ loads, unloads }).toEqual({ loads: 1, unloads: 1 });
    expect(harness.bridge.host.shutdownComplete).toHaveBeenCalledTimes(1);
  });

  it("cancels a deferred restore before hydration when shutdown starts", async () => {
    const harness = bridgeHarness();
    const restored = deferred<Awaited<ReturnType<PluginHostBridge["vault"]["restore"]>>>();
    vi.mocked(harness.bridge.vault.restore).mockImplementationOnce(() => restored.promise);
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });

    const restoring = host.restoreSession();
    await vi.waitFor(() => expect(harness.bridge.vault.restore).toHaveBeenCalledTimes(1));
    const shuttingDown = host.shutdown();
    restored.resolve({ sessionId, name: "Fixture" });

    await expect(restoring).rejects.toThrow("shutting down");
    await shuttingDown;
    expect(harness.bridge.vault.readAll).not.toHaveBeenCalled();
    expect(harness.bridge.vault.close).toHaveBeenCalledTimes(1);
    expect(harness.bridge.vault.close).toHaveBeenCalledWith(sessionId);
    expect(harness.bridge.host.shutdownComplete).toHaveBeenCalledTimes(1);
  });

  it("disposes hydrated data and cancels queued opens when shutdown interrupts readAll", async () => {
    const harness = bridgeHarness();
    const files = deferred<Awaited<ReturnType<PluginHostBridge["vault"]["readAll"]>>>();
    vi.mocked(harness.bridge.vault.readAll).mockImplementationOnce(() => files.promise);
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    const replaceMirror = vi.spyOn(host.linkIndex, "replaceMirror");

    const restoring = host.restoreSession();
    await vi.waitFor(() => expect(harness.bridge.vault.readAll).toHaveBeenCalledTimes(1));
    const queuedPick = host.pickSession();
    const shuttingDown = host.shutdown();
    files.resolve([{
      path: "late.md",
      content: "late",
      version: "ipc:2" as never,
    }]);

    await expect(restoring).rejects.toThrow("shutting down");
    await expect(queuedPick).rejects.toThrow("shutting down");
    await shuttingDown;
    expect(harness.bridge.vault.pick).not.toHaveBeenCalled();
    expect(replaceMirror).not.toHaveBeenCalled();
    expect(harness.bridge.vault.close).toHaveBeenCalledTimes(1);
    expect(harness.bridge.vault.close).toHaveBeenCalledWith(sessionId);
    expect(harness.bridge.host.shutdownComplete).toHaveBeenCalledTimes(1);
  });

  it("rolls back to the current session when reading a picked session fails", async () => {
    const harness = bridgeHarness();
    let loads = 0;
    let unloads = 0;
    class LifecyclePlugin extends NexusPluginBase {
      override onload(): void { loads += 1; }
      override onunload(): void { unloads += 1; }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(manifest([]), LifecyclePlugin);
    const previousVault = host.vault;
    const previousMetadata = host.metadata;
    vi.mocked(harness.bridge.vault.pick).mockResolvedValueOnce({
      sessionId: nextSessionId,
      name: "Next",
    });
    vi.mocked(harness.bridge.vault.readAll).mockRejectedValueOnce(new Error("read failed"));
    vi.mocked(harness.bridge.vault.close).mockClear();

    await expect(host.pickSession()).rejects.toThrow("read failed");

    expect(host.session?.sessionId).toBe(sessionId);
    expect(host.vault).toBe(previousVault);
    expect(host.metadata).toBe(previousMetadata);
    expect(await host.vault.read(host.vault.getFileByPath("note.md")!)).toBe("alpha");
    expect(host.pluginManager.get("electron-host-fixture")?.state).toBe("enabled");
    expect({ loads, unloads }).toEqual({ loads: 2, unloads: 1 });
    expect(harness.bridge.vault.close).toHaveBeenCalledTimes(1);
    expect(harness.bridge.vault.close).toHaveBeenCalledWith(nextSessionId);
    await host.shutdown();
  });

  it("does not commit a picked mirror when closing the current session fails", async () => {
    const harness = bridgeHarness();
    let loads = 0;
    let unloads = 0;
    class LifecyclePlugin extends NexusPluginBase {
      override onload(): void { loads += 1; }
      override onunload(): void { unloads += 1; }
    }
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.enableBundledPlugin(manifest([]), LifecyclePlugin);
    const previousVault = host.vault;
    const previousMetadata = host.metadata;
    vi.mocked(harness.bridge.vault.pick).mockResolvedValueOnce({
      sessionId: nextSessionId,
      name: "Next",
    });
    vi.mocked(harness.bridge.vault.readAll).mockResolvedValueOnce([{
      path: "next.md",
      content: "next",
      version: "ipc:2" as never,
    }]);
    vi.mocked(harness.bridge.vault.close).mockImplementation(async (closedSessionId) => {
      if (closedSessionId === sessionId) throw new Error("close failed");
      return { ok: true as const };
    });

    await expect(host.pickSession()).rejects.toThrow("close failed");

    expect(host.session?.sessionId).toBe(sessionId);
    expect(host.vault).toBe(previousVault);
    expect(host.metadata).toBe(previousMetadata);
    expect(host.vault.getFileByPath("next.md")).toBeNull();
    expect(await host.vault.read(host.vault.getFileByPath("note.md")!)).toBe("alpha");
    expect(host.pluginManager.get("electron-host-fixture")?.state).toBe("enabled");
    expect({ loads, unloads }).toEqual({ loads: 2, unloads: 1 });
    expect(harness.bridge.vault.close).toHaveBeenNthCalledWith(1, sessionId);
    expect(harness.bridge.vault.close).toHaveBeenNthCalledWith(2, nextSessionId);
    vi.mocked(harness.bridge.vault.close).mockResolvedValue({ ok: true as const });
    await host.shutdown();
  });

  it("restores every current mirror reference when link-index commit fails", async () => {
    const harness = bridgeHarness();
    const host = createPluginRuntimeHost({ bridge: harness.bridge, document });
    await host.restoreSession();
    await host.setActiveFile("note.md");
    const previousVault = host.vault;
    const previousMetadata = host.metadata;
    vi.mocked(harness.bridge.vault.pick).mockResolvedValueOnce({
      sessionId: nextSessionId,
      name: "Next",
    });
    vi.mocked(harness.bridge.vault.readAll).mockResolvedValueOnce([{
      path: "next.md",
      content: "next",
      version: "ipc:2" as never,
    }]);
    const replaceMirror = vi.spyOn(host.linkIndex, "replaceMirror");
    replaceMirror.mockImplementationOnce(() => { throw new Error("index switch failed"); });
    vi.mocked(harness.bridge.vault.close).mockClear();

    await expect(host.pickSession()).rejects.toThrow("index switch failed");

    expect(host.session?.sessionId).toBe(sessionId);
    expect(host.vault).toBe(previousVault);
    expect(host.metadata).toBe(previousMetadata);
    expect(host.workspace.getActiveFile()?.path).toBe("note.md");
    expect(host.linkIndex.resolve("note", null)).toBe("note.md");
    expect(host.vault.getFileByPath("next.md")).toBeNull();
    expect(harness.bridge.vault.close).toHaveBeenCalledTimes(1);
    expect(harness.bridge.vault.close).toHaveBeenCalledWith(nextSessionId);
    await host.shutdown();
  });
});
