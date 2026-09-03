import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PluginHostBridge,
  PluginVaultChangeEvent,
  VaultSessionId,
} from "../src/shared/plugin-ipc";

const sessionId = "11111111-1111-4111-8111-111111111111" as VaultSessionId;

function createBridgeHarness() {
  const order: string[] = [];
  const files = new Map([
    ["note.md", "alpha beta"],
    ["folder/other.md", "gamma"],
  ]);
  let legacyVaultChanged: (() => void) | null = null;
  let pluginVaultChanged: ((event: PluginVaultChangeEvent) => void) | null = null;
  let shutdownRequested: (() => void) | null = null;
  const absolute = (relative: string) => `/vault/${relative}`;

  const nexusDemo: DemoBridge = {
    openFile: vi.fn(async () => null),
    saveFile: vi.fn(async (path: string) => ({ path })),
    saveFileAs: vi.fn(async () => null),
    vault: {
      pick: vi.fn(async () => ({ path: "/vault" })),
      list: vi.fn(async () => [
        { name: "note.md", path: absolute("note.md"), kind: "file" as const },
        {
          name: "folder",
          path: absolute("folder"),
          kind: "directory" as const,
          children: [{ name: "other.md", path: absolute("folder/other.md"), kind: "file" as const }],
        },
      ]),
      read: vi.fn(async (path: string) => ({
        path,
        content: files.get(path.replace(/^[/\\]vault[/\\]/i, "").replace(/\\/g, "/")) ?? "",
      })),
      readAll: vi.fn(async () => [...files].map(([path, content]) => ({
        path: absolute(path),
        content,
      }))),
      write: vi.fn(async (path: string) => ({ path })),
      createFile: vi.fn(async (parent: string, name: string) => ({ path: `${parent}/${name}` })),
      createFolder: vi.fn(async (parent: string, name: string) => ({ path: `${parent}/${name}` })),
      rename: vi.fn(async (path: string) => ({ path })),
      delete: vi.fn(async () => ({ ok: true })),
      getLast: vi.fn(async () => ({ lastVault: "/vault", recents: ["/vault"] })),
      setLast: vi.fn(async () => ({ ok: true })),
      onChanged: vi.fn((callback: () => void) => {
        legacyVaultChanged = callback;
        return () => {
          order.push("unsubscribe-app-vault");
          legacyVaultChanged = null;
        };
      }),
    },
  };

  const nexusPlugins: PluginHostBridge = {
    vault: {
      pick: vi.fn(async () => ({ sessionId, name: "vault" })),
      restore: vi.fn(async () => ({ sessionId, name: "vault" })),
      close: vi.fn(async () => {
        order.push("close-plugin-session");
        return { ok: true as const };
      }),
      commit: vi.fn(async () => ({ ok: true as const })),
      list: vi.fn(async () => []),
      read: vi.fn(async (_session, path) => ({ path, content: files.get(path) ?? "", version: "ipc:1" as never })),
      readBinary: vi.fn(async (_session, path) => ({ path, content: new TextEncoder().encode(files.get(path) ?? ""), version: "ipc:1" as never })),
      readAll: vi.fn(async () => [...files].map(([path, content]) => ({ path, content, version: "ipc:1" as never }))),
      write: vi.fn(async (_session, path, _content, options) => ({ path, version: "ipc:2" as never, operationId: options?.operationId ?? "write" })),
      writeBinary: vi.fn(async (_session, path, _content, options) => ({ path, version: "ipc:2" as never, operationId: options?.operationId ?? "write-binary" })),
      createFolder: vi.fn(async (_session, path, operationId) => ({ path, operationId: operationId ?? "folder" })),
      rename: vi.fn(async (_session, _path, destination, operationId) => ({ path: destination, operationId: operationId ?? "rename" })),
      trash: vi.fn(async (_session, path, operationId) => ({ path, operationId: operationId ?? "trash", recoverable: true as const })),
      createResourceUrl: vi.fn(async () => ({ url: "nexus-vault://resource/token", registrationId: "token" })),
      revokeResourceUrl: vi.fn(async () => ({ ok: true as const })),
      onChanged: vi.fn((callback) => {
        pluginVaultChanged = callback;
        return () => {
          order.push("unsubscribe-plugin-vault");
          pluginVaultChanged = null;
        };
      }),
    },
    storage: {
      load: vi.fn(async () => ({ found: false, revision: 0, data: null })),
      save: vi.fn(async (_pluginId, expectedRevision) => ({ ok: true as const, revision: expectedRevision + 1 })),
    },
    secrets: {
      status: vi.fn(async () => ({ status: "unsupported" as const, reason: "test" })),
    },
    host: {
      activatePlugin: vi.fn(async () => ({ ok: true as const })),
      revokePlugin: vi.fn(async () => ({ ok: true as const })),
      openExternal: vi.fn(async () => ({ ok: true as const })),
      onShutdown: vi.fn((callback) => {
        shutdownRequested = () => callback({ reason: "window-close" });
        return () => {
          order.push("unsubscribe-shutdown");
          shutdownRequested = null;
        };
      }),
      shutdownComplete: vi.fn(async () => {
        order.push("shutdown-complete");
        return { ok: true as const };
      }),
    },
  };

  return {
    nexusDemo,
    nexusPlugins,
    files,
    order,
    emitLegacyVaultChange: () => legacyVaultChanged?.(),
    emitPluginVaultChange: (event: PluginVaultChangeEvent) => pluginVaultChanged?.(event),
    requestShutdown: () => shutdownRequested?.(),
  };
}

function installBridgeHarness(
  harness: ReturnType<typeof createBridgeHarness>,
  mode: "legacy" | "runtime",
): void {
  window.nexusHost = {
    mode,
    onShutdown: harness.nexusPlugins.host.onShutdown,
    shutdownComplete: harness.nexusPlugins.host.shutdownComplete,
  };
  if (mode === "runtime") {
    delete window.nexusDemo;
    window.nexusPlugins = harness.nexusPlugins;
  } else {
    window.nexusDemo = harness.nexusDemo;
    delete window.nexusPlugins;
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  // These integration tests locate toolbar buttons by their English labels.
  // The renderer defaults to Chinese, so pin the UI language to English.
  localStorage.setItem("nexus-editor-settings", JSON.stringify({ language: "en" }));
  document.body.replaceChildren();
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
});

describe("Electron renderer plugin runtime integration", () => {
  it("keeps the legacy path as the default and shuts it down once", async () => {
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    installBridgeHarness(harness, "legacy");

    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: false },
      deferVaultRestore: false,
    });

    expect(app.mode).toBe("legacy");
    expect(app.runtime).toBeNull();
    expect(app.productUi).toBeNull();
    expect(app.shell.toolbar).not.toBeNull();
    expect(app.shell.slashMenu).not.toBeNull();
    expect(app.shell.wordcount).not.toBeNull();
    expect(document.querySelectorAll(".nexus-toolbar")).toHaveLength(1);

    app.state.activeFile = "/vault-note.md";
    app.state.filePath = "/vault-note.md";
    app.state.content = "outside";
    const saveButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Save");
    saveButton?.click();
    await vi.waitFor(() => {
      expect(harness.nexusDemo.saveFile).toHaveBeenCalledWith("/vault-note.md", "outside");
    }, { timeout: 5000 });
    expect(harness.nexusDemo.vault.write).not.toHaveBeenCalled();

    const first = app.shutdown();
    const second = app.shutdown();
    expect(second).toBe(first);
    await first;

    expect(document.getElementById("app")?.childElementCount).toBe(0);
    expect(harness.nexusPlugins.host.shutdownComplete).toHaveBeenCalledTimes(1);
    expect(harness.order).toEqual([
      "unsubscribe-app-vault",
      "unsubscribe-shutdown",
      "shutdown-complete",
    ]);
  });

  it("boots one runtime owner, synchronizes relative file context, and preserves slot DOM", async () => {
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    const confirmDangerousAction = vi.spyOn(window, "confirm").mockReturnValue(false);
    harness.files.set("note.md", "See [[folder/other|Other]] and other.");
    installBridgeHarness(harness, "runtime");

    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: true },
      deferVaultRestore: false,
    });

    expect(app.mode).toBe("runtime");
    expect(app.state.linkIndex).toBeNull();
    expect(harness.nexusDemo.vault.readAll).not.toHaveBeenCalled();
    expect(harness.nexusDemo.vault.onChanged).not.toHaveBeenCalled();
    expect(app.shell.toolbar).toBeNull();
    expect(app.shell.slashMenu).toBeNull();
    expect(app.shell.wordcount).toBeNull();
    expect(app.runtime?.pluginManager.list().filter((plugin) => plugin.state === "enabled").map((plugin) => plugin.id)).toEqual([
      "toolbar",
      "slash-menu",
      "wordcount",
    ]);
    expect(app.slots["editor-toolbar"].querySelectorAll("[data-ui-action-id]")).toHaveLength(17);
    const slashCommandIds = app.shell.editor.getSlashCommands().map((command) => command.id);
    expect(slashCommandIds).toHaveLength(new Set(slashCommandIds).size);
    expect(document.body.querySelectorAll(".nexus-slash-menu")).toHaveLength(1);
    expect(document.querySelectorAll(".nexus-toolbar")).toHaveLength(1);
    const wordCountStatus = app.slots["status-bar"].querySelector<HTMLButtonElement>(
      '[data-ui-action-id="wordcount:document-stats"]',
    );
    expect(wordCountStatus).not.toBeNull();
    expect(app.slots["status-bar"].querySelectorAll("[data-ui-action-id]")).toHaveLength(1);
    expect(wordCountStatus?.textContent).toContain("0 words");
    expect(document.querySelector(".status-line__document")?.textContent).not.toContain("words");

    await app.openVault("/vault");
    expect(harness.nexusPlugins.vault.readAll).toHaveBeenCalledTimes(1);
    expect(harness.nexusDemo.vault.list).not.toHaveBeenCalled();
    expect(harness.nexusDemo.vault.readAll).not.toHaveBeenCalled();
    expect(harness.nexusDemo.vault.onChanged).not.toHaveBeenCalled();
    expect(app.runtime?.linkIndex.resolve("folder/other", "note.md")).toBe("folder/other.md");
    expect(app.runtime?.linkIndex.getAllNoteNames()).toEqual(["note", "other"]);
    expect(app.runtime?.linkIndex.getBacklinks("folder/other.md")).toMatchObject([
      { sourcePath: "note.md", target: "folder/other" },
    ]);
    await app.openVaultFile("/vault/folder/other.md");
    expect(harness.nexusPlugins.vault.restore).toHaveBeenCalledTimes(1);
    expect(harness.nexusPlugins.vault.read).not.toHaveBeenCalled();
    expect(harness.nexusDemo.vault.read).not.toHaveBeenCalled();
    expect(app.runtime?.session?.sessionId).toBe(sessionId);
    expect(app.runtime?.workspace.getActiveFile()?.path).toBe("folder/other.md");
    expect(app.runtime?.leaf.filePath).toBe("folder/other.md");
    expect(wordCountStatus?.isConnected).toBe(false);

    app.shell.editor.setDocument("runtime word count updates");
    await vi.waitFor(() => {
      expect(app.slots["status-bar"].querySelector(
        '[data-ui-action-id="wordcount:document-stats"]',
      )?.textContent).toContain("4 words");
    });

    app.state.content = "runtime edit";
    app.state.dirty = true;
    const saveButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((button) => button.textContent === "Save");
    saveButton?.click();
    await vi.waitFor(() => expect(harness.nexusPlugins.vault.write).toHaveBeenCalledWith(
      sessionId,
      "folder/other.md",
      "runtime edit",
      expect.objectContaining({ operationId: expect.stringMatching(/^renderer:nexus-electron-product:/) }),
    ), { timeout: 5000 });
    expect(harness.nexusDemo.vault.write).not.toHaveBeenCalled();

    document.querySelector<HTMLButtonElement>('.nexus-vault-panel button[title="New file at root"]')?.click();
    const createInput = document.querySelector<HTMLInputElement>(".nexus-vault-panel input")!;
    createInput.value = "created.md";
    createInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(app.state.activeFile).toBe("/vault/created.md"));
    expect(harness.nexusPlugins.vault.write).toHaveBeenCalledWith(
      sessionId,
      "created.md",
      "",
      expect.objectContaining({ operationId: expect.stringMatching(/^renderer:nexus-electron-product:/) }),
    );
    expect(harness.nexusDemo.vault.createFile).not.toHaveBeenCalled();

    const createdRow = document.querySelector<HTMLElement>('[data-path="/vault/created.md"]')!;
    createdRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const renameInput = createdRow.querySelector<HTMLInputElement>("input")!;
    renameInput.value = "renamed.md";
    renameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(app.state.activeFile).toBe("/vault/renamed.md"));
    expect(harness.nexusPlugins.vault.rename).toHaveBeenCalledWith(
      sessionId,
      "created.md",
      "renamed.md",
      expect.stringMatching(/^renderer:nexus-electron-product:/),
    );
    expect(harness.nexusDemo.vault.rename).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(
      document.querySelector<HTMLElement>('[data-path="/vault/renamed.md"]'),
    ).not.toBeNull());
    document.querySelector<HTMLElement>('[data-path="/vault/renamed.md"]')!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    let deleteButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      deleteButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button"),
      ).find((button) => button.textContent === "Delete");
      expect(deleteButton).toBeDefined();
    });
    deleteButton!.click();
    await vi.waitFor(() => expect(confirmDangerousAction).toHaveBeenCalledWith(
      expect.stringContaining("Delete"),
    ));
    expect(harness.nexusPlugins.vault.trash).not.toHaveBeenCalled();
    expect(document.querySelector(".nexus-plugin-menu")).not.toBeNull();

    confirmDangerousAction.mockReturnValue(true);
    deleteButton!.click();
    await vi.waitFor(() => expect(harness.nexusPlugins.vault.trash).toHaveBeenCalledWith(
      sessionId,
      "renamed.md",
      expect.stringMatching(/^renderer:nexus-electron-product:/),
    ));
    expect(harness.nexusDemo.vault.delete).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(app.state.activeFile).toBeNull());

    expect(app.productUi).not.toBeNull();
    expect(app.runtime?.workspace.supportedContainers).toContain("sidebar");
    expect(app.productUi?.getViewLeaf("outline")?.containerType).toBe("sidebar");
    expect(app.productUi?.getViewLeaf("backlinks")?.containerType).toBe("sidebar");
    expect(document.querySelectorAll(".nexus-outline-panel")).toHaveLength(1);
    expect(document.querySelectorAll(".backlinks-panel")).toHaveLength(1);
    expect(document.querySelectorAll(".main-area > .nexus-outline-panel, .main-area > .backlinks-panel"))
      .toHaveLength(0);

    const settingsButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((button) => button.title === "Settings");
    settingsButton?.click();
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".nexus-runtime-settings-panel")).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(document.querySelector("[data-setting-id='fontSize'] input")).not.toBeNull();
    });
    const fontSize = document.querySelector<HTMLInputElement>("[data-setting-id='fontSize'] input")!;
    fontSize.value = "19";
    fontSize.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      expect(JSON.parse(localStorage.getItem("nexus-editor-settings") ?? "{}").fontSize).toBe(19);
    });
    settingsButton?.click();
    expect(document.querySelectorAll(".nexus-runtime-settings-panel")).toHaveLength(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector(".nexus-runtime-settings-panel")).toBeNull();
    });

    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    await vi.waitFor(() => {
      expect(document.querySelector(".nexus-plugin-menu")).not.toBeNull();
    });
    expect(document.querySelector(".nexus-vault-ctxmenu")).toBeNull();
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button"))
      .map((button) => button.textContent)).toEqual(expect.arrayContaining([
        "Open",
        "Rename",
        "Delete",
      ]));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector(".nexus-plugin-menu")).toBeNull();
    });
    expect(removeDocumentListener.mock.calls.some(([type]) => type === "mousedown")).toBe(true);

    await app.shutdown();
    expect(document.getElementById("app")?.childElementCount).toBe(0);
    expect(document.body.querySelectorAll(".nexus-slash-menu")).toHaveLength(0);
    expect(document.body.querySelectorAll(".nexus-plugin-menu, .nexus-runtime-settings-panel"))
      .toHaveLength(0);
    expect(app.runtime?.pluginManager.list().every((plugin) => plugin.state === "disabled")).toBe(true);
    expect(document.querySelector(".nexus-vault-ctxmenu")).toBeNull();
    expect(harness.order).toEqual([
      "close-plugin-session",
      "unsubscribe-plugin-vault",
      "unsubscribe-shutdown",
      "shutdown-complete",
    ]);
  });

  it("rolls back a failed runtime boot without acknowledging shutdown and can retry", async () => {
    const actualRuntime = await import("../src/renderer/plugin-runtime-host");
    let failNextEnable = true;
    vi.doMock("../src/renderer/plugin-runtime-host", () => ({
      ...actualRuntime,
      createPluginRuntimeHost: (...args: Parameters<typeof actualRuntime.createPluginRuntimeHost>) => {
        const runtime = actualRuntime.createPluginRuntimeHost(...args);
        const enable = runtime.enableBundledPlugin.bind(runtime);
        runtime.enableBundledPlugin = async (...enableArgs) => {
          if (failNextEnable) {
            failNextEnable = false;
            return {
              ok: false,
              state: "failed",
              diagnostics: [{ message: "injected enable failure" }],
            } as never;
          }
          return enable(...enableArgs);
        };
        return runtime;
      },
    }));
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    installBridgeHarness(harness, "runtime");

    await expect(boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: true },
      deferVaultRestore: false,
    })).rejects.toThrow("Could not enable bundled plugin");
    expect(document.getElementById("app")?.childElementCount).toBe(0);
    expect(harness.nexusPlugins.host.shutdownComplete).not.toHaveBeenCalled();
    expect(harness.order).toEqual(["unsubscribe-plugin-vault", "unsubscribe-shutdown"]);

    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: true },
      deferVaultRestore: false,
    });
    expect(app.mode).toBe("runtime");
    await app.shutdown();
    vi.doUnmock("../src/renderer/plugin-runtime-host");
  });

  it("acknowledges legacy shutdown after a disposer throws", async () => {
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    harness.nexusDemo.vault.onChanged = vi.fn(() => () => {
      harness.order.push("unsubscribe-app-vault");
      throw new Error("injected unsubscribe failure");
    });
    installBridgeHarness(harness, "legacy");

    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: false },
      deferVaultRestore: false,
    });

    await expect(app.shutdown()).rejects.toThrow("Electron renderer shutdown was not clean");
    expect(document.getElementById("app")?.childElementCount).toBe(0);
    expect(harness.nexusPlugins.host.shutdownComplete).toHaveBeenCalledTimes(1);
    expect(harness.order).toEqual([
      "unsubscribe-app-vault",
      "unsubscribe-shutdown",
      "shutdown-complete",
    ]);
  });

  it("keeps the previous Vault context when runtime restore fails", async () => {
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    installBridgeHarness(harness, "runtime");
    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: true },
      deferVaultRestore: false,
    });
    await app.openVault("/vault");
    await app.openVaultFile("/vault/note.md");
    vi.mocked(harness.nexusPlugins.vault.restore).mockRejectedValueOnce(
      new Error("injected restore failure"),
    );

    await expect(app.openVault("/other")).rejects.toThrow("injected restore failure");
    expect(app.state.vaultPath).toBe("/vault");
    expect(app.state.activeFile).toBe("/vault/note.md");
    expect(app.shell.editor.getDocument()).toBe("alpha beta");
    expect(harness.nexusDemo.vault.setLast).not.toHaveBeenCalled();
    expect(app.runtime?.workspace.getActiveFile()?.path).toBe("note.md");
    await app.shutdown();
  });

  it("does not commit a Vault when the runtime restore is cancelled", async () => {
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    vi.mocked(harness.nexusPlugins.vault.restore).mockResolvedValueOnce(null);
    installBridgeHarness(harness, "runtime");
    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: true },
      deferVaultRestore: false,
    });

    await expect(app.openVault("/vault")).rejects.toThrow(
      "could not be restored for the plugin runtime",
    );
    expect(app.state.vaultPath).toBeNull();
    expect(app.runtime?.session).toBeNull();
    expect(document.querySelector('.nexus-vault-panel [data-path="/vault/note.md"]')).toBeNull();
    await app.shutdown();
  });

  it("updates and clears the active document after legacy rename and delete", async () => {
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    let renamed = false;
    vi.mocked(harness.nexusDemo.vault.rename).mockImplementation(async (_path, name) => {
      renamed = true;
      return { path: `/vault/${name}` };
    });
    vi.mocked(harness.nexusDemo.vault.list).mockImplementation(async () => [
      {
        name: renamed ? "renamed.md" : "note.md",
        path: renamed ? "/vault/renamed.md" : "/vault/note.md",
        kind: "file" as const,
      },
    ]);
    installBridgeHarness(harness, "legacy");
    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: false },
      deferVaultRestore: false,
    });
    await app.openVault("/vault");
    await app.openVaultFile("/vault/note.md");

    const row = document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!;
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const renameInput = row.querySelector<HTMLInputElement>("input")!;
    renameInput.value = "renamed.md";
    renameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(app.state.activeFile).toBe("/vault/renamed.md"));
    expect(app.state.filePath).toBe("/vault/renamed.md");

    document.querySelector<HTMLElement>('[data-path="/vault/renamed.md"]')?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
    const deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-vault-ctxmenu button"))
      .find((button) => button.textContent === "Delete");
    deleteButton?.click();
    await vi.waitFor(() => expect(app.state.activeFile).toBeNull());
    expect(app.state.filePath).toBeNull();
    expect(app.shell.editor.getDocument()).toBe("");
    await app.shutdown();
  });
});

describe("toVaultRelativePath", () => {
  it("normalizes separators and rejects paths outside the Vault root", async () => {
    const { toVaultRelativePath } = await import("../src/renderer/app");
    expect(toVaultRelativePath("C:\\Vault", "c:\\vault\\Folder\\Note.md")).toBe("Folder/Note.md");
    expect(toVaultRelativePath("/vault", "/vault-note.md")).toBeNull();
    expect(toVaultRelativePath("/vault", "/other/note.md")).toBeNull();
  });
});
