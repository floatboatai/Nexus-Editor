import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PluginHostBridge,
  PluginVaultChangeEvent,
  VaultSessionId,
} from "../src/shared/plugin-ipc";
import type { ElectronCollabStoreBridge } from "../src/shared/collab-store-ipc";
import type { DocumentContextTransactions } from "../src/renderer/document-context-transaction";

const sessionId = "11111111-1111-4111-8111-111111111111" as VaultSessionId;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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
      pick: vi.fn(async () => ({ sessionId, vaultId: "vault-stable-a" as never, name: "vault" })),
      restore: vi.fn(async () => ({ sessionId, vaultId: "vault-stable-a" as never, name: "vault" })),
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
      acquireProjectionWrite: vi.fn(async (_session, path) => ({ path, permitId: "projection-permit" })),
      releaseProjectionWrite: vi.fn(async () => ({ ok: true as const })),
      reserveProjectionOpening: vi.fn(async (openingSession, path, documentId, operationId) => ({
        active: true,
        documentId,
        operationId,
        owner: { senderId: 7, sessionId: openingSession },
        path,
        state: "precommit" as const,
        vaultId: "vault-stable-a" as never,
      })),
      commitProjectionOpening: vi.fn(async (openingSession, path, documentId, operationId) => ({
        active: true,
        documentId,
        operationId,
        owner: { senderId: 7, sessionId: openingSession },
        path,
        state: "committed" as const,
        vaultId: "vault-stable-a" as never,
      })),
      listProjectionOpenings: vi.fn(async () => []),
      releaseProjectionOpening: vi.fn(async () => ({ released: true })),
      reserveDeletion: vi.fn(async (_session, path, operationId) => ({ path, operationId })),
      listDeletionFences: vi.fn(async () => []),
      releaseDeletion: vi.fn(async () => ({ released: true })),
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
    window.nexusCollabNetwork = {
      getConfiguration: async () => ({ serverUrls: ["ws://127.0.0.1:1234"] }),
      issueInvitation: async () => ({ ok: false, error: "invitation-request-failed" }),
    };
  } else {
    window.nexusDemo = harness.nexusDemo;
    delete window.nexusPlugins;
    delete window.nexusCollabNetwork;
  }
}

async function bootWithTransitioningCollaboration() {
  const prepareForFileChange = vi.fn(async () => false);
  let collaborationPhase: "idle" | "joining" = "idle";
  const product = {
    vaultSessionId: sessionId,
    workspace: {
      getState: () => ({
        phase: collaborationPhase,
        attachment: "none" as const,
        serverPersistence: "unverified" as const,
      }),
    },
    panel: {},
    initialize: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    saveCurrent: vi.fn(async () => undefined),
    prepareForFileChange,
    prepareForFileMutation: vi.fn(async (kind: "rename" | "delete", path: string) => kind === "delete"
      ? { schemaVersion: 1 as const, operationId: "delete-note", path }
      : undefined),
    completeFileMutation: vi.fn(async () => undefined),
    listIncompleteFileDeletions: vi.fn(async () => []),
    recoverFileDeletion: vi.fn(async () => undefined),
    refreshFile: vi.fn(async () => undefined),
    handlePathRenamed: vi.fn(async () => undefined),
    handleFileDeleted: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
  const createElectronCollaborationProduct = vi.fn(() => product);
  vi.doMock("../src/renderer/electron-collaboration-product", () => ({
    createElectronCollaborationProduct,
  }));
  const { boot } = await import("../src/renderer/app");
  const harness = createBridgeHarness();
  installBridgeHarness(harness, "runtime");
  window.nexusCollabStore = { request: vi.fn() } as unknown as ElectronCollabStoreBridge;
  const app = await boot({
    root: document.getElementById("app")!,
    featureFlags: { pluginPlatform: true },
    deferVaultRestore: false,
  });
  await app.openVault("/vault");
  await app.openVaultFile("/vault/note.md");
  collaborationPhase = "joining";
  Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
    .find((candidate) => candidate.textContent === "Collaborate")!
    .click();
  await vi.waitFor(() => expect(product.open).toHaveBeenCalledTimes(1));
  return { app, harness, prepareForFileChange };
}

async function bootWithDocumentContextTransactions() {
  let documentContext!: DocumentContextTransactions;
  let collaborationPhase: "idle" | "active" = "idle";
  const product = {
    vaultSessionId: sessionId,
    workspace: {
      getState: () => ({
        phase: collaborationPhase,
        attachment: collaborationPhase === "active" ? "attached" as const : "none" as const,
        serverPersistence: "unverified" as const,
      }),
    },
    panel: {},
    initialize: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    saveCurrent: vi.fn(async () => undefined),
    prepareForFileChange: vi.fn(async () => true),
    prepareForFileMutation: vi.fn(async (kind: "rename" | "delete", path: string) => kind === "delete"
      ? { schemaVersion: 1 as const, operationId: "delete-note", path }
      : undefined),
    completeFileMutation: vi.fn(async () => undefined),
    listIncompleteFileDeletions: vi.fn(async () => []),
    recoverFileDeletion: vi.fn(async () => undefined),
    refreshFile: vi.fn(async () => undefined),
    handlePathRenamed: vi.fn(async () => undefined),
    handleFileDeleted: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
  const createElectronCollaborationProduct = vi.fn((options: {
    readonly documentContext: DocumentContextTransactions;
  }) => {
    documentContext = options.documentContext;
    return product;
  });
  vi.doMock("../src/renderer/electron-collaboration-product", () => ({
    createElectronCollaborationProduct,
  }));
  const { boot } = await import("../src/renderer/app");
  const harness = createBridgeHarness();
  installBridgeHarness(harness, "runtime");
  window.nexusCollabStore = { request: vi.fn() } as unknown as ElectronCollabStoreBridge;
  const app = await boot({
    root: document.getElementById("app")!,
    featureFlags: { pluginPlatform: true },
    deferVaultRestore: false,
  });
  await app.openVault("/vault");
  await app.openVaultFile("/vault/note.md");
  Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
    .find((candidate) => candidate.textContent === "Collaborate")!
    .click();
  await vi.waitFor(() => expect(product.open).toHaveBeenCalledTimes(1));

  return {
    app,
    harness,
    product,
    setCollaborationPhase(phase: "idle" | "active") {
      collaborationPhase = phase;
    },
    beginCreate() {
      const attach = vi.fn(async () => undefined);
      const opening = documentContext.runOpening(
        documentContext.capture(),
        async (assertContextCurrent) => {
          assertContextCurrent();
          await attach();
        },
      );
      void opening.catch(() => undefined);
      return { attach, opening };
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete window.nexusCollabNetwork;
  delete window.nexusCollabStore;
  document.body.replaceChildren();
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
});

describe("Electron renderer plugin runtime integration", () => {
  it("keeps the explicit legacy compatibility path and shuts it down once", async () => {
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    installBridgeHarness(harness, "legacy");

    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: false },
      deferVaultRestore: false,
    });

    expect(app.mode).toBe("legacy");
    expect(document.getElementById("app")?.dataset.nexusStartupState).toBe("ready");
    expect(app.runtime).toBeNull();
    expect(app.productUi).toBeNull();
    expect(app.shell.toolbar).not.toBeNull();
    expect(app.shell.slashMenu).not.toBeNull();
    expect(app.shell.wordcount).not.toBeNull();
    expect(document.querySelectorAll(".nexus-toolbar")).toHaveLength(1);

    app.state.activeFile = "/vault-note.md";
    app.state.filePath = "/vault-note.md";
    app.shell.editor.setDocument("outside");
    await vi.waitFor(() => expect(app.state.content).toBe("outside"));
    const saveButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "Save");
    saveButton?.click();
    await vi.waitFor(() => {
      expect(harness.nexusDemo.saveFile).toHaveBeenCalledWith("/vault-note.md", "outside");
    });
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
    expect(document.getElementById("app")?.dataset.nexusStartupState).toBe("ready");
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

    app.shell.editor.setDocument("runtime edit");
    await vi.waitFor(() => expect(app.state.content).toBe("runtime edit"));
    const saveButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((button) => button.textContent === "Save");
    saveButton?.click();
    await vi.waitFor(() => expect(harness.nexusPlugins.vault.write).toHaveBeenCalledWith(
      sessionId,
      "folder/other.md",
      "runtime edit",
      expect.objectContaining({ operationId: expect.stringMatching(/^renderer:nexus-electron-product:/) }),
    ));
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

  it("opens the authenticated durable collaboration product instead of the assessment lab", async () => {
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    installBridgeHarness(harness, "runtime");
    window.nexusCollabNetwork!.getConfiguration = async () => ({
      serverUrls: ["wss://review.example.test"],
    });
    const persistenceRequest = vi.fn();
    window.nexusCollabStore = {
      request: persistenceRequest,
    } as unknown as ElectronCollabStoreBridge;

    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: true },
      deferVaultRestore: false,
    });
    await app.openVault("/vault");
    await app.openVaultFile("/vault/note.md");

    const collaborationButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((candidate) => candidate.textContent === "Collaborate")!;
    collaborationButton.click();

    await vi.waitFor(() => {
      const product = document.querySelector<HTMLElement>(".nexus-collaboration");
      expect(product).not.toBeNull();
      expect(product?.hidden).toBe(false);
      expect(product?.textContent).toContain("Create collaboration");
      expect(product?.textContent).toContain("Join collaboration");
    });
    expect(document.querySelector(".nexus-collab-lab")).toBeNull();
    expect(document.querySelector<HTMLInputElement>('[name="create-server-url"]')?.value)
      .toBe("wss://review.example.test");
    expect(persistenceRequest).not.toHaveBeenCalled();

    await app.shutdown();
    expect(document.querySelector(".nexus-collaboration")).toBeNull();
  });

  it("keeps a newer Editor change dirty when an ordinary Save finishes late", async () => {
    const { app, harness } = await bootWithDocumentContextTransactions();
    const releaseWrite = deferred<void>();
    let writeCompleted = false;
    vi.mocked(harness.nexusPlugins.vault.write).mockImplementation(
      async (_session, path, _content, options) => {
        await releaseWrite.promise;
        writeCompleted = true;
        return { path, version: "ipc:2" as never, operationId: options?.operationId ?? "write" };
      },
    );
    app.shell.editor.setDocument("save snapshot");
    await vi.waitFor(() => expect(app.state.content).toBe("save snapshot"));

    Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((candidate) => candidate.textContent === "Save")!
      .click();
    await vi.waitFor(() => expect(harness.nexusPlugins.vault.write).toHaveBeenCalledWith(
      sessionId,
      "note.md",
      "save snapshot",
      expect.anything(),
    ));

    app.shell.editor.setDocument("typed while saving");
    await vi.waitFor(() => expect(app.state.content).toBe("typed while saving"));
    releaseWrite.resolve();
    await vi.waitFor(() => expect(writeCompleted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.state.dirty).toBe(true);
    expect(app.shell.editor.getDocument()).toBe("typed while saving");

    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("keeps a newer Editor change dirty when runtime Save As finishes late", async () => {
    const { app, harness } = await bootWithDocumentContextTransactions();
    const releaseWrite = deferred<void>();
    vi.spyOn(window, "prompt").mockReturnValue("copy.md");
    vi.mocked(harness.nexusPlugins.vault.write).mockImplementation(
      async (_session, path, content, options) => {
        if (path === "copy.md" && content === "save-as snapshot") await releaseWrite.promise;
        return { path, version: "ipc:2" as never, operationId: options?.operationId ?? "write" };
      },
    );
    app.shell.editor.setDocument("save-as snapshot");
    await vi.waitFor(() => expect(app.state.content).toBe("save-as snapshot"));

    Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((candidate) => candidate.textContent === "Save As")!
      .click();
    await vi.waitFor(() => expect(harness.nexusPlugins.vault.write).toHaveBeenLastCalledWith(
      sessionId,
      "copy.md",
      "save-as snapshot",
      expect.anything(),
    ));

    app.shell.editor.setDocument("typed while saving as");
    await vi.waitFor(() => expect(app.state.content).toBe("typed while saving as"));
    releaseWrite.resolve();
    await vi.waitFor(() => expect(app.state.activeFile).toBe("/vault/copy.md"));
    expect(app.state.dirty).toBe(true);
    expect(app.shell.editor.getDocument()).toBe("typed while saving as");

    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("keeps a newer Editor change dirty when legacy Save As finishes late", async () => {
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    const releaseDialog = deferred<void>();
    vi.mocked(harness.nexusDemo.saveFileAs).mockImplementation(async () => {
      await releaseDialog.promise;
      return { path: "/vault/copy.md" };
    });
    installBridgeHarness(harness, "legacy");
    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: false },
      deferVaultRestore: false,
    });
    await app.openVault("/vault");
    await app.openVaultFile("/vault/note.md");
    app.shell.editor.setDocument("legacy save-as snapshot");
    await vi.waitFor(() => expect(app.state.content).toBe("legacy save-as snapshot"));

    Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((candidate) => candidate.textContent === "Save As")!
      .click();
    await vi.waitFor(() => expect(harness.nexusDemo.saveFileAs).toHaveBeenCalledWith(
      "legacy save-as snapshot",
    ));

    app.shell.editor.setDocument("typed while legacy dialog was open");
    await vi.waitFor(() => expect(app.state.content).toBe("typed while legacy dialog was open"));
    releaseDialog.resolve();
    await vi.waitFor(() => expect(app.state.activeFile).toBe("/vault/copy.md"));
    expect(app.state.dirty).toBe(true);
    expect(app.shell.editor.getDocument()).toBe("typed while legacy dialog was open");

    await app.shutdown();
  });

  it("keeps a newer Editor change dirty when collaboration projection Save finishes late", async () => {
    const { app, harness, product, setCollaborationPhase } = await bootWithDocumentContextTransactions();
    const releaseSave = deferred<void>();
    let saveCompleted = false;
    product.saveCurrent.mockImplementation(async () => {
      await releaseSave.promise;
      saveCompleted = true;
    });
    setCollaborationPhase("active");
    app.shell.editor.setDocument("shared save snapshot");
    await vi.waitFor(() => expect(app.state.content).toBe("shared save snapshot"));

    Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((candidate) => candidate.textContent === "Save")!
      .click();
    await vi.waitFor(() => expect(product.saveCurrent).toHaveBeenCalledTimes(1));

    app.shell.editor.setDocument("new shared edit");
    await vi.waitFor(() => expect(app.state.content).toBe("new shared edit"));
    releaseSave.resolve();
    await vi.waitFor(() => expect(saveCompleted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.state.dirty).toBe(true);

    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("waits for an active projection rename before starting collaboration Save", async () => {
    const { app, harness, product, setCollaborationPhase } = await bootWithDocumentContextTransactions();
    const releaseRename = deferred<void>();
    setCollaborationPhase("active");
    vi.mocked(harness.nexusPlugins.vault.rename).mockImplementation(
      async (_session, _path, destination, operationId) => {
        await releaseRename.promise;
        return { path: destination, operationId: operationId ?? "rename" };
      },
    );
    const row = document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!;
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const renameInput = row.querySelector<HTMLInputElement>("input")!;
    renameInput.value = "renamed.md";
    renameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(harness.nexusPlugins.vault.rename).toHaveBeenCalledTimes(1));

    Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((candidate) => candidate.textContent === "Save")!
      .click();
    await Promise.resolve();
    expect(product.saveCurrent).not.toHaveBeenCalled();

    releaseRename.resolve();
    await vi.waitFor(() => expect(product.handlePathRenamed).toHaveBeenCalledWith("note.md", "renamed.md"));
    await vi.waitFor(() => expect(product.saveCurrent).toHaveBeenCalledTimes(1));
    expect(app.state.activeFile).toBe("/vault/renamed.md");

    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("routes Save As through the context-change gate while collaboration is opening", async () => {
    const { app, harness, prepareForFileChange } = await bootWithTransitioningCollaboration();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("copy.md");

    Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((candidate) => candidate.textContent === "Save As")!
      .click();

    await vi.waitFor(() => expect(prepareForFileChange).toHaveBeenCalled());
    expect(prompt).not.toHaveBeenCalled();
    expect(harness.nexusPlugins.vault.write).not.toHaveBeenCalledWith(
      sessionId,
      "copy.md",
      expect.anything(),
      expect.anything(),
    );
    expect(app.state.activeFile).toBe("/vault/note.md");
    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("routes current-file rename through the context-change gate before touching disk", async () => {
    const { app, harness, prepareForFileChange } = await bootWithTransitioningCollaboration();
    const row = document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!;

    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const renameInput = row.querySelector<HTMLInputElement>("input")!;
    renameInput.value = "renamed.md";
    renameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => expect(prepareForFileChange).toHaveBeenCalledTimes(1));
    expect(harness.nexusPlugins.vault.rename).not.toHaveBeenCalled();
    expect(app.state.activeFile).toBe("/vault/note.md");
    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("routes current-file delete through the context-change gate before touching disk", async () => {
    const { app, harness, prepareForFileChange } = await bootWithTransitioningCollaboration();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    let deleteButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button"))
        .find((candidate) => candidate.textContent === "Delete");
      expect(deleteButton).toBeDefined();
    });

    deleteButton!.click();

    await vi.waitFor(() => expect(prepareForFileChange).toHaveBeenCalledTimes(1));
    expect(harness.nexusPlugins.vault.trash).not.toHaveBeenCalled();
    expect(app.state.activeFile).toBe("/vault/note.md");
    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("rejects a create that starts after Save As passed its gate but before the new file commits", async () => {
    const { app, harness, beginCreate } = await bootWithDocumentContextTransactions();
    const releaseWrite = deferred<void>();
    vi.mocked(harness.nexusPlugins.vault.write).mockImplementation(async (_session, path, _content, options) => {
      if (path === "copy.md") await releaseWrite.promise;
      return { path, version: "ipc:2" as never, operationId: options?.operationId ?? "write" };
    });
    vi.spyOn(window, "prompt").mockReturnValue("copy.md");

    Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((candidate) => candidate.textContent === "Save As")!
      .click();
    await vi.waitFor(() => expect(harness.nexusPlugins.vault.write).toHaveBeenCalledWith(
      sessionId,
      "copy.md",
      "",
      expect.anything(),
    ));

    const create = beginCreate();
    await Promise.resolve();
    expect(create.attach).not.toHaveBeenCalled();
    releaseWrite.resolve();

    await vi.waitFor(() => expect(app.state.activeFile).toBe("/vault/copy.md"));
    await expect(create.opening).rejects.toMatchObject({ code: "document-context-changed" });
    expect(create.attach).not.toHaveBeenCalled();
    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("rejects a create that starts after rename passed its gate but before disk coordination finishes", async () => {
    const { app, harness, beginCreate, product } = await bootWithDocumentContextTransactions();
    const releaseRename = deferred<void>();
    vi.mocked(harness.nexusPlugins.vault.rename).mockImplementation(
      async (_session, _path, destination, operationId) => {
        await releaseRename.promise;
        return { path: destination, operationId: operationId ?? "rename" };
      },
    );
    const row = document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!;
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const renameInput = row.querySelector<HTMLInputElement>("input")!;
    renameInput.value = "renamed.md";
    renameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(harness.nexusPlugins.vault.rename).toHaveBeenCalled());

    const create = beginCreate();
    await Promise.resolve();
    expect(create.attach).not.toHaveBeenCalled();
    releaseRename.resolve();

    await vi.waitFor(() => expect(app.state.activeFile).toBe("/vault/renamed.md"));
    await vi.waitFor(() => expect(product.handlePathRenamed).toHaveBeenCalledWith("note.md", "renamed.md"));
    await expect(create.opening).rejects.toMatchObject({ code: "document-context-changed" });
    expect(create.attach).not.toHaveBeenCalled();
    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("rolls back a Host rename when collaboration identity migration fails", async () => {
    const { app, harness, product } = await bootWithDocumentContextTransactions();
    product.handlePathRenamed.mockRejectedValueOnce(Object.assign(
      new Error("enrollment write failed"),
      { code: "enrollment-write-failed" },
    ));
    const row = document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!;
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const renameInput = row.querySelector<HTMLInputElement>("input")!;
    renameInput.value = "renamed.md";
    renameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => expect(harness.nexusPlugins.vault.rename).toHaveBeenCalledTimes(2));
    expect(harness.nexusPlugins.vault.rename).toHaveBeenNthCalledWith(
      1,
      sessionId,
      "note.md",
      "renamed.md",
      expect.any(String),
    );
    expect(harness.nexusPlugins.vault.rename).toHaveBeenNthCalledWith(
      2,
      sessionId,
      "renamed.md",
      "note.md",
      expect.any(String),
    );
    expect(product.handlePathRenamed).toHaveBeenNthCalledWith(1, "note.md", "renamed.md");
    await vi.waitFor(() => expect(product.handlePathRenamed).toHaveBeenCalledTimes(2));
    expect(product.handlePathRenamed).toHaveBeenNthCalledWith(2, "renamed.md", "note.md");
    await vi.waitFor(() => expect(app.state.activeFile).toBe("/vault/note.md"));

    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("rejects a create that starts after delete passed its gate but before disk coordination finishes", async () => {
    const { app, harness, beginCreate, product } = await bootWithDocumentContextTransactions();
    const releaseTrash = deferred<void>();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(harness.nexusPlugins.vault.trash).mockImplementation(
      async (_session, path, operationId) => {
        await releaseTrash.promise;
        return { path, operationId: operationId ?? "trash", recoverable: true as const };
      },
    );
    document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
    let deleteButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button"))
        .find((candidate) => candidate.textContent === "Delete");
      expect(deleteButton).toBeDefined();
    });
    deleteButton!.click();
    await vi.waitFor(() => expect(harness.nexusPlugins.vault.trash).toHaveBeenCalled());

    const create = beginCreate();
    await Promise.resolve();
    expect(create.attach).not.toHaveBeenCalled();
    releaseTrash.resolve();

    await vi.waitFor(() => expect(app.state.activeFile).toBeNull());
    await vi.waitFor(() => expect(product.handleFileDeleted).toHaveBeenCalledWith("note.md"));
    await expect(create.opening).rejects.toMatchObject({ code: "document-context-changed" });
    expect(create.attach).not.toHaveBeenCalled();
    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("prepares the active document change before reserving its file deletion", async () => {
    const { app, harness, product, setCollaborationPhase } = await bootWithDocumentContextTransactions();
    setCollaborationPhase("active");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
    let deleteButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button"))
        .find((candidate) => candidate.textContent === "Delete");
      expect(deleteButton).toBeDefined();
    });
    deleteButton!.click();

    await vi.waitFor(() => expect(product.completeFileMutation).toHaveBeenCalledWith("delete", "note.md", {
      filesystem: "succeeded",
      coordination: "succeeded",
      refresh: "succeeded",
    }));
    expect(harness.nexusPlugins.vault.trash).toHaveBeenCalledWith(
      sessionId,
      "note.md",
      "delete-note",
    );
    expect(product.prepareForFileChange.mock.invocationCallOrder[0]).toBeLessThan(
      product.prepareForFileMutation.mock.invocationCallOrder[0]!,
    );
    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("releases the prepared delete mutation when trash fails", async () => {
    const { app, harness, product } = await bootWithDocumentContextTransactions();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(harness.nexusPlugins.vault.trash).mockRejectedValueOnce(new Error("trash unavailable"));
    document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
    let deleteButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button"))
        .find((candidate) => candidate.textContent === "Delete");
      expect(deleteButton).toBeDefined();
    });
    deleteButton!.click();

    await vi.waitFor(() => expect(product.completeFileMutation).toHaveBeenCalledWith("delete", "note.md", {
      filesystem: "failed",
      coordination: "not-run",
      refresh: "not-run",
    }));
    expect(product.handleFileDeleted).not.toHaveBeenCalled();
    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("settles the prepared delete mutation so the product can retain it when coordination fails", async () => {
    const { app, product } = await bootWithDocumentContextTransactions();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    product.handleFileDeleted.mockRejectedValueOnce(new Error("coordination unavailable"));
    document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
    let deleteButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button"))
        .find((candidate) => candidate.textContent === "Delete");
      expect(deleteButton).toBeDefined();
    });
    deleteButton!.click();

    await vi.waitFor(() => expect(product.handleFileDeleted).toHaveBeenCalledWith("note.md"));
    await vi.waitFor(() => expect(product.completeFileMutation).toHaveBeenCalledWith("delete", "note.md", {
      filesystem: "succeeded",
      coordination: "failed",
      refresh: "not-run",
    }));
    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
  });

  it("does not delete a file while it has a pending collaboration creation", async () => {
    const { app, harness, product } = await bootWithDocumentContextTransactions();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    product.prepareForFileMutation.mockRejectedValueOnce(Object.assign(
      new Error("recover pending collaboration first"),
      { code: "pending-creation-delete-blocked" },
    ));
    document.querySelector<HTMLElement>('[data-path="/vault/note.md"]')!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
    let deleteButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-plugin-menu button"))
        .find((candidate) => candidate.textContent === "Delete");
      expect(deleteButton).toBeDefined();
    });
    deleteButton!.click();

    await vi.waitFor(() => expect(product.prepareForFileMutation).toHaveBeenCalledWith("delete", "note.md"));
    expect(harness.nexusPlugins.vault.trash).not.toHaveBeenCalled();
    expect(app.state.activeFile).toBe("/vault/note.md");

    await app.shutdown();
    vi.doUnmock("../src/renderer/electron-collaboration-product");
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

  it("continues renderer cleanup when an opening developer lab fails during shutdown", async () => {
    const labOpening = deferred<{ element: HTMLElement; destroy(): void }>();
    const createCollaborationLab = vi.fn(() => labOpening.promise);
    vi.doMock("../src/renderer/collaboration-lab", () => ({ createCollaborationLab }));
    let openDeveloperLab: (() => void | Promise<void>) | undefined;
    const product = {
      vaultSessionId: sessionId,
      workspace: {
        getState: () => ({
          phase: "idle" as const,
          attachment: "none" as const,
          serverPersistence: "unverified" as const,
        }),
      },
      panel: {},
      initialize: vi.fn(async () => undefined),
      open: vi.fn(async () => { await openDeveloperLab?.(); }),
      saveCurrent: vi.fn(async () => undefined),
      prepareForFileChange: vi.fn(async () => true),
      prepareForFileMutation: vi.fn(async () => undefined),
      completeFileMutation: vi.fn(async () => undefined),
      listIncompleteFileDeletions: vi.fn(async () => []),
      recoverFileDeletion: vi.fn(async () => undefined),
      refreshFile: vi.fn(async () => undefined),
      handlePathRenamed: vi.fn(async () => undefined),
      handleFileDeleted: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
    };
    vi.doMock("../src/renderer/electron-collaboration-product", () => ({
      createElectronCollaborationProduct: (options: {
        readonly openDeveloperLab?: () => void | Promise<void>;
      }) => {
        openDeveloperLab = options.openDeveloperLab;
        return product;
      },
    }));
    const { boot } = await import("../src/renderer/app");
    const harness = createBridgeHarness();
    installBridgeHarness(harness, "runtime");
    window.nexusCollabStore = { request: vi.fn() } as unknown as ElectronCollabStoreBridge;
    const app = await boot({
      root: document.getElementById("app")!,
      featureFlags: { pluginPlatform: true },
      deferVaultRestore: false,
    });
    await app.openVault("/vault");
    await app.openVaultFile("/vault/note.md");
    Array.from(document.querySelectorAll<HTMLButtonElement>(".toolbar button"))
      .find((candidate) => candidate.textContent === "Collaborate")!
      .click();
    await vi.waitFor(() => expect(createCollaborationLab).toHaveBeenCalledTimes(1));

    const shuttingDown = app.shutdown();
    await vi.waitFor(() => expect(product.destroy).toHaveBeenCalledTimes(1));
    labOpening.reject(new Error("developer lab opening failed"));

    await expect(shuttingDown).rejects.toThrow("renderer shutdown");
    expect(document.getElementById("app")?.childElementCount).toBe(0);
    expect(harness.nexusPlugins.host.shutdownComplete).toHaveBeenCalledTimes(1);
    expect(harness.order).toContain("close-plugin-session");
    expect(harness.order).toContain("unsubscribe-plugin-vault");

    vi.doUnmock("../src/renderer/electron-collaboration-product");
    vi.doUnmock("../src/renderer/collaboration-lab");
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
