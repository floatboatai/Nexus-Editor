import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronHarness = vi.hoisted(() => ({
  appListeners: new Map<string, Array<(...args: any[]) => void>>(),
  ipcHandlers: new Map<string, (...args: any[]) => unknown>(),
  quit: vi.fn(),
  applicationMenu: null as null | {
    readonly items: Array<{
      readonly id?: string;
      readonly label?: string;
      readonly submenu?: {
        readonly items: Array<{ readonly id?: string; click?: () => void }>;
        append(item: { readonly id?: string; click?: () => void }): void;
      };
    }>;
  },
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showErrorBox: vi.fn(),
  loadFailure: null as Error | null,
  rendererStartupState: null as string | null,
  sessions: [] as Array<{
    readonly partition: string;
    readonly handledSchemes: Set<string>;
    readonly unhandle: ReturnType<typeof vi.fn>;
    readonly protocolHandlers: Map<string, (request: Request) => Promise<Response>>;
    readonly onHeadersReceived: ReturnType<typeof vi.fn>;
  }>,
  windows: [] as Array<{
    readonly shown: boolean;
    readonly options: Record<string, any>;
    readonly webContents: {
      readonly id: number;
      readonly mainFrame: { url: string };
      readonly sent: Array<{ readonly channel: string; readonly payload: unknown }>;
      executeJavaScript(source: string): Promise<unknown>;
      getURL(): string;
      isDestroyed(): boolean;
      emit(event: string, ...args: unknown[]): void;
    };
    close(): void;
    isDestroyed(): boolean;
  }>,
}));

vi.mock("electron", () => {
  class FakeEmitter {
    private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

    on(event: string, listener: (...args: any[]) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    once(event: string, listener: (...args: any[]) => void): this {
      const wrapped = (...args: any[]) => {
        this.removeListener(event, wrapped);
        listener(...args);
      };
      return this.on(event, wrapped);
    }

    emit(event: string, ...args: any[]): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
    }

    private removeListener(event: string, listener: (...args: any[]) => void): void {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
      );
    }
  }

  class FakeWebContents extends FakeEmitter {
    readonly sent: Array<{ readonly channel: string; readonly payload: unknown }> = [];
    readonly mainFrame = { url: "http://localhost:5173/" };

    constructor(readonly id: number) {
      super();
    }

    setWindowOpenHandler(): void {}
    executeJavaScript(): Promise<unknown> {
      return Promise.resolve(electronHarness.rendererStartupState);
    }
    getURL(): string { return this.mainFrame.url; }
    isDestroyed(): boolean { return false; }
    toggleDevTools(): void {}
    send(channel: string, payload: unknown): void { this.sent.push({ channel, payload }); }
  }

  class FakeBrowserWindow extends FakeEmitter {
    readonly webContents = new FakeWebContents(electronHarness.windows.length + 1);
    private destroyed = false;
    shown = false;

    constructor(readonly options: Record<string, unknown>) {
      super();
      electronHarness.windows.push(this);
    }

    close(): void {
      let prevented = false;
      this.emit("close", { preventDefault: () => { prevented = true; } });
      if (!prevented) this.destroy();
    }

    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      this.webContents.emit("destroyed");
    }

    isDestroyed(): boolean { return this.destroyed; }
    isMinimized(): boolean { return false; }
    loadFile(): Promise<void> {
      return electronHarness.loadFailure
        ? Promise.reject(electronHarness.loadFailure)
        : Promise.resolve();
    }
    loadURL(url: string): Promise<void> {
      this.webContents.mainFrame.url = url;
      return electronHarness.loadFailure
        ? Promise.reject(electronHarness.loadFailure)
        : Promise.resolve();
    }
    show(): void { this.shown = true; }
    focus(): void {}
    restore(): void {}
  }

  const app = {
    getPath: () => "/tmp/nexus-electron-main-test",
    on: (event: string, listener: (...args: any[]) => void) => {
      const listeners = electronHarness.appListeners.get(event) ?? [];
      listeners.push(listener);
      electronHarness.appListeners.set(event, listeners);
    },
    quit: electronHarness.quit,
    whenReady: () => new Promise<void>(() => undefined),
  };

  class FakeMenuItem {
    readonly id?: string;
    readonly label?: string;
    readonly submenu?: { readonly items: FakeMenuItem[]; append(item: FakeMenuItem): void };
    readonly click?: () => void;

    constructor(options: {
      readonly id?: string;
      readonly label?: string;
      readonly submenu?: Array<Record<string, unknown>>;
      readonly click?: () => void;
    }) {
      this.id = options.id;
      this.label = options.label;
      this.click = options.click;
      if (options.submenu) {
        const items = options.submenu.map((entry) => new FakeMenuItem(entry));
        this.submenu = { items, append: (item) => items.push(item) };
      }
    }
  }

  const Menu = {
    getApplicationMenu: () => electronHarness.applicationMenu,
    setApplicationMenu: (menu: typeof electronHarness.applicationMenu) => {
      electronHarness.applicationMenu = menu;
    },
    buildFromTemplate: (template: Array<Record<string, unknown>>) => ({
      items: template.map((entry) => new FakeMenuItem(entry)),
    }),
  };

  return {
    app,
    BrowserWindow: FakeBrowserWindow,
    dialog: {
      showOpenDialog: electronHarness.showOpenDialog,
      showSaveDialog: electronHarness.showSaveDialog,
      showErrorBox: electronHarness.showErrorBox,
    },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => unknown) => {
        electronHarness.ipcHandlers.set(channel, handler);
      },
    },
    Menu,
    MenuItem: FakeMenuItem,
    protocol: { registerSchemesAsPrivileged: vi.fn() },
    session: {
      fromPartition: (partition: string) => {
        const handledSchemes = new Set<string>();
        const protocolHandlers = new Map<string, (request: Request) => Promise<Response>>();
        const unhandle = vi.fn((scheme: string) => handledSchemes.delete(scheme));
        const fakeSession = {
          partition,
          handledSchemes,
          unhandle,
          protocolHandlers,
          onHeadersReceived: vi.fn(),
          protocol: {
            handle: (scheme: string, handler: (request: Request) => Promise<Response>) => { handledSchemes.add(scheme); protocolHandlers.set(scheme, handler); },
            unhandle,
          },
          get webRequest() { return { onHeadersReceived: this.onHeadersReceived }; },
        };
        electronHarness.sessions.push(fakeSession);
        return fakeSession;
      },
    },
    shell: {
      openExternal: vi.fn(),
      trashItem: vi.fn(),
    },
  };
});

describe("Electron main window host", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    electronHarness.appListeners.clear();
    electronHarness.ipcHandlers.clear();
    electronHarness.applicationMenu = null;
    electronHarness.sessions.length = 0;
    electronHarness.windows.length = 0;
    electronHarness.quit.mockReset();
    electronHarness.showOpenDialog.mockReset();
    electronHarness.showSaveDialog.mockReset();
    electronHarness.showErrorBox.mockReset();
    electronHarness.loadFailure = null;
    electronHarness.rendererStartupState = null;
    process.env.VITE_DEV_SERVER_URL = "http://localhost:5173";
  });

  afterEach(() => {
    delete process.env.VITE_DEV_SERVER_URL;
    delete process.env.NEXUS_COLLAB_SERVERS;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function eventFor(window: typeof electronHarness.windows[number]) {
    return {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    };
  }

  it("binds persistent isolated sessions and main-owned mode arguments", async () => {
    const { createWindow } = await import("../electron/main");
    createWindow({ hostMode: "legacy", windowId: "legacy-test" });
    createWindow({ hostMode: "runtime", windowId: "runtime-test" });

    expect(electronHarness.sessions.map(({ partition }) => partition)).toEqual([
      "persist:nexus-window-legacy-test",
      "persist:nexus-window-runtime-test",
    ]);
    expect(electronHarness.windows[0].options.webPreferences.additionalArguments).toEqual([
      "--nexus-host-mode=legacy",
    ]);
    expect(electronHarness.windows[1].options.webPreferences.additionalArguments).toEqual([
      "--nexus-host-mode=runtime",
    ]);
  });

  it("loads the built editor from a secure static origin with an enforced configured CSP", async () => {
    delete process.env.VITE_DEV_SERVER_URL;
    process.env.NEXUS_COLLAB_SERVERS = "wss://collab.example.test/socket";
    const { createWindow, registerPluginHostIpc } = await import("../electron/main");
    registerPluginHostIpc();
    createWindow({ hostMode: "runtime", windowId: "built-network" });
    const window = electronHarness.windows[0]!;
    expect(window.webContents.getURL()).toBe("nexus-app://editor/index.html");
    expect(electronHarness.sessions[0]?.handledSchemes.has("nexus-app")).toBe(true);
    const configuration = electronHarness.ipcHandlers.get("nexus:collab-network:configuration")!;
    expect(await configuration(eventFor(window))).toEqual({ serverUrls: ["wss://collab.example.test/socket"] });
    expect(window.options.webPreferences.webSecurity).not.toBe(false);
  });

  it("injects configured CSP before development responses reach the renderer", async () => {
    process.env.NEXUS_COLLAB_SERVERS = "wss://collab.example.test";
    const { createWindow } = await import("../electron/main");
    createWindow({ hostMode: "runtime", windowId: "dev-network" });
    const hook = electronHarness.sessions[0]!.onHeadersReceived.mock.calls[0]?.[1];
    expect(hook).toBeTypeOf("function");
    const callback = vi.fn();
    hook({ responseHeaders: { "Content-Security-Policy": ["default-src *"], "Content-Type": ["text/html"] } }, callback);
    const headers = callback.mock.calls[0]?.[0].responseHeaders;
    expect(headers["Content-Security-Policy"]).toEqual([expect.stringContaining("connect-src 'self' wss://collab.example.test ws://localhost:5173;")]);
  });

  it("denies network authority to subframes, unknown senders, legacy windows, and navigated renderers", async () => {
    const { createWindow, registerPluginHostIpc } = await import("../electron/main");
    registerPluginHostIpc();
    createWindow({ hostMode: "runtime", windowId: "network-runtime" });
    createWindow({ hostMode: "legacy", windowId: "network-legacy" });
    const runtime = electronHarness.windows[0]!;
    const legacy = electronHarness.windows[1]!;
    const issue = electronHarness.ipcHandlers.get("nexus:collab-network:issue-invitation")!;
    expect(issue).toBeTypeOf("function");
    for (const event of [
      { ...eventFor(runtime), senderFrame: { url: runtime.webContents.getURL() } },
      { ...eventFor(runtime), sender: { ...runtime.webContents, id: 999 } },
      eventFor(legacy),
    ]) expect(await issue(event, {})).toEqual({ ok: false, error: "sender-not-authorized" });
    runtime.webContents.mainFrame.url = "https://attacker.example.test";
    expect(await issue(eventFor(runtime), {})).toEqual({ ok: false, error: "sender-not-authorized" });
  });

  it("cancels pending invitations as soon as a runtime window begins closing", async () => {
    let requestSignal: AbortSignal | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => {
      requestSignal = options?.signal ?? null;
      return new Promise<Response>(() => undefined);
    });
    const { createWindow, registerPluginHostIpc } = await import("../electron/main");
    registerPluginHostIpc();
    createWindow({ hostMode: "runtime", windowId: "close-network" });
    const window = electronHarness.windows[0]!;
    const issue = electronHarness.ipcHandlers.get("nexus:collab-network:issue-invitation")!;
    const pending = issue(eventFor(window), { serverUrl: "ws://127.0.0.1:1234", token: "owner-token", documentId: "document-1", userId: "invitee", role: "reader", lifetimeSeconds: 60 });
    window.close();
    expect(requestSignal).toMatchObject({ aborted: true });
    expect(await pending).toEqual({ ok: false, error: "invitation-request-cancelled" });
    expect(await issue(eventFor(window), {})).toEqual({ ok: false, error: "sender-not-authorized" });
  });

  it("shows a bounded diagnostic when renderer navigation fails", async () => {
    electronHarness.loadFailure = new Error(
      "http://user:secret@localhost/private markdown should not be disclosed",
    );
    const { createWindow } = await import("../electron/main");
    createWindow({ hostMode: "runtime", windowId: "load-failure" });

    await vi.waitFor(() => expect(electronHarness.showErrorBox).toHaveBeenCalledOnce());

    expect(electronHarness.showErrorBox).toHaveBeenCalledWith(
      "Nexus Editor could not start",
      "Error code: renderer-load-failed\n\n" +
      "Restart the client after checking that its development server or packaged files are available.",
    );
    expect(electronHarness.windows[0]?.shown).toBe(true);
    expect(JSON.stringify(electronHarness.showErrorBox.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(electronHarness.showErrorBox.mock.calls)).not.toContain("private markdown");
  });

  it("shows a bounded diagnostic when the sandboxed preload fails", async () => {
    const { createWindow } = await import("../electron/main");
    const window = createWindow({ hostMode: "runtime", windowId: "preload-failure" });

    window.webContents.emit(
      "preload-error",
      {},
      "/private/path/preload.cjs",
      new Error("token=secret private markdown"),
    );

    expect(electronHarness.showErrorBox).toHaveBeenCalledWith(
      "Nexus Editor could not start",
      "Error code: preload-load-failed\n\n" +
      "Restart the client after checking that its development server or packaged files are available.",
    );
    expect(electronHarness.windows[0]?.shown).toBe(true);
    expect(JSON.stringify(electronHarness.showErrorBox.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(electronHarness.showErrorBox.mock.calls)).not.toContain("private markdown");
    expect(JSON.stringify(electronHarness.showErrorBox.mock.calls)).not.toContain("/private/path");
  });

  it("shows a bounded diagnostic when renderer boot never settles", async () => {
    electronHarness.rendererStartupState = "starting";
    const { createWindow } = await import("../electron/main");
    createWindow({ hostMode: "runtime", windowId: "startup-timeout" });

    electronHarness.windows[0]?.webContents.emit("did-finish-load");
    await vi.advanceTimersByTimeAsync(15_000);

    expect(electronHarness.showErrorBox).toHaveBeenCalledWith(
      "Nexus Editor could not start",
      "Error code: renderer-startup-timeout\n\n" +
      "Restart the client after checking that its development server or packaged files are available.",
    );
  });

  it("does not report a startup timeout after renderer boot is ready", async () => {
    electronHarness.rendererStartupState = "ready";
    const { createWindow } = await import("../electron/main");
    createWindow({ hostMode: "runtime", windowId: "startup-ready" });

    electronHarness.windows[0]?.webContents.emit("did-finish-load");
    await vi.advanceTimersByTimeAsync(15_000);

    expect(electronHarness.showErrorBox).not.toHaveBeenCalled();
  });

  it("rejects an untrusted renderer development URL without disclosing it", async () => {
    process.env.VITE_DEV_SERVER_URL =
      "http://user:secret@localhost:5173/private-markdown?token=secret";
    const { createWindow } = await import("../electron/main");
    createWindow({ hostMode: "runtime", windowId: "invalid-renderer-url" });

    expect(electronHarness.showErrorBox).toHaveBeenCalledWith(
      "Nexus Editor could not start",
      "Error code: renderer-url-invalid\n\n" +
      "Restart the client after checking that its development server or packaged files are available.",
    );
    expect(JSON.stringify(electronHarness.showErrorBox.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(electronHarness.showErrorBox.mock.calls)).not.toContain("private-markdown");
  });

  it("rejects legacy filesystem IPC from a runtime window", async () => {
    const { createWindow } = await import("../electron/main");
    const legacy = createWindow({ hostMode: "legacy", windowId: "legacy-ipc" });
    const runtime = createWindow({ hostMode: "runtime", windowId: "runtime-ipc" });
    electronHarness.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const openFile = electronHarness.ipcHandlers.get("demo:open-file")!;

    await expect(openFile(eventFor(electronHarness.windows[1]))).rejects.toThrow(
      "Legacy filesystem IPC is not available to runtime windows",
    );
    await expect(openFile(eventFor(electronHarness.windows[0]))).resolves.toBeNull();
    expect(runtime.isDestroyed()).toBe(false);
    expect(legacy.isDestroyed()).toBe(false);
  });

  it("rejects an unsolicited shutdown ACK and keeps the window alive", async () => {
    const { createWindow, registerPluginHostIpc } = await import("../electron/main");
    registerPluginHostIpc();
    const window = createWindow({ hostMode: "runtime", windowId: "shutdown-gate" });
    const fake = electronHarness.windows[0];
    const shutdownComplete = electronHarness.ipcHandlers.get("nexus:host:shutdown-complete")!;

    await expect(shutdownComplete(eventFor(fake), {})).rejects.toThrow(
      "Shutdown completion was not requested",
    );
    expect(window.isDestroyed()).toBe(false);

    fake.close();
    await expect(shutdownComplete(eventFor(fake), {})).resolves.toEqual({ ok: true });
    expect(window.isDestroyed()).toBe(true);
  });

  it("forces app exit at 2.1 seconds when storage drain never settles", async () => {
    const { ElectronPluginStorageBroker } = await import("../electron/plugin-host-broker");
    const drain = vi.spyOn(ElectronPluginStorageBroker.prototype, "drain")
      .mockReturnValue(new Promise<void>(() => undefined));
    const { createWindow, registerPluginHostIpc } = await import("../electron/main");
    registerPluginHostIpc();
    const window = createWindow({ hostMode: "runtime", windowId: "hanging-storage" });
    const beforeQuit = electronHarness.appListeners.get("before-quit")?.[0];

    beforeQuit?.({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(2_099);
    expect(window.isDestroyed()).toBe(true);
    expect(drain).toHaveBeenCalledOnce();
    expect(electronHarness.quit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(electronHarness.quit).toHaveBeenCalledOnce();
  });

  it("creates and routes two live BrowserWindows and shuts them down independently", async () => {
    const { createWindow, windowForSenderId } = await import("../electron/main");
    const first = createWindow();
    const second = createWindow();
    const firstFake = electronHarness.windows[0];
    const secondFake = electronHarness.windows[1];

    expect(first).toBe(firstFake);
    expect(second).toBe(secondFake);
    expect(electronHarness.sessions).toHaveLength(2);
    expect(electronHarness.sessions[0].partition).not.toBe(electronHarness.sessions[1].partition);
    expect(electronHarness.sessions[0].handledSchemes).toContain("nexus-vault");
    expect(electronHarness.sessions[1].handledSchemes).toContain("nexus-vault");
    expect(windowForSenderId(firstFake.webContents.id)).toBe(first);
    expect(windowForSenderId(secondFake.webContents.id)).toBe(second);

    firstFake.close();
    expect(firstFake.webContents.sent).toEqual([{
      channel: "nexus:host:shutdown",
      payload: { reason: "window-close" },
    }]);
    expect(secondFake.webContents.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(firstFake.isDestroyed()).toBe(true);
    expect(windowForSenderId(firstFake.webContents.id)).toBeNull();
    expect(windowForSenderId(secondFake.webContents.id)).toBe(second);
    expect(electronHarness.sessions[0].handledSchemes).not.toContain("nexus-vault");
    expect(electronHarness.sessions[1].handledSchemes).toContain("nexus-vault");

    const beforeQuit = electronHarness.appListeners.get("before-quit")?.[0];
    expect(beforeQuit).toBeTypeOf("function");
    const firstQuitEvent = { preventDefault: vi.fn() };
    const repeatedQuitEvent = { preventDefault: vi.fn() };
    beforeQuit?.(firstQuitEvent);
    beforeQuit?.(repeatedQuitEvent);

    expect(firstQuitEvent.preventDefault).toHaveBeenCalledOnce();
    expect(repeatedQuitEvent.preventDefault).toHaveBeenCalledOnce();
    expect(secondFake.webContents.sent).toEqual([{
      channel: "nexus:host:shutdown",
      payload: { reason: "app-quit" },
    }]);
    await vi.advanceTimersByTimeAsync(2_100);

    expect(secondFake.isDestroyed()).toBe(true);
    expect(electronHarness.quit).toHaveBeenCalledOnce();
  });

  it("fails closed on renderer crash, retains exact join openings, and allows deterministic rebind", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nexus-renderer-crash-"));
    await mkdir(path.join(root, "Notes"));
    await writeFile(path.join(root, "Notes", "A.md"), "a");
    await writeFile(path.join(root, "Notes", "B.md"), "b");
    const { createWindow, registerPluginHostIpc, windowForSenderId } = await import("../electron/main");
    registerPluginHostIpc();
    createWindow({ hostMode: "runtime", windowId: "crashing-renderer" });
    createWindow({ hostMode: "runtime", windowId: "surviving-renderer" });
    const crashed = electronHarness.windows[0];
    const survivor = electronHarness.windows[1];
    electronHarness.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [root] });
    const pick = electronHarness.ipcHandlers.get("nexus:vault:pick")!;
    const crashedSession = await pick(eventFor(crashed), {}) as { readonly sessionId: string };
    const survivingSession = await pick(eventFor(survivor), {}) as { readonly sessionId: string };
    const reserveOpening = electronHarness.ipcHandlers.get("nexus:vault:projection-opening-reserve")!;
    const commitOpening = electronHarness.ipcHandlers.get("nexus:vault:projection-opening-commit")!;
    const listOpenings = electronHarness.ipcHandlers.get("nexus:vault:projection-opening-list")!;
    const releaseOpening = electronHarness.ipcHandlers.get("nexus:vault:projection-opening-release")!;
    const reserveDeletion = electronHarness.ipcHandlers.get("nexus:vault:delete-reserve")!;
    const write = electronHarness.ipcHandlers.get("nexus:vault:write")!;

    const opening = await reserveOpening(eventFor(crashed), {
      sessionId: crashedSession.sessionId,
      path: "Notes/A.md",
      documentId: "document-before-crash",
      operationId: "join-before-crash",
    }) as { readonly owner: { readonly senderId: number; readonly sessionId: string } };
    await commitOpening(eventFor(crashed), {
      sessionId: crashedSession.sessionId,
      path: "Notes/A.md",
      documentId: "document-before-crash",
      operationId: "join-before-crash",
    });
    await reserveDeletion(eventFor(crashed), {
      sessionId: crashedSession.sessionId,
      path: "Notes/B.md",
      operationId: "delete-before-crash",
      state: "committed",
    });

    crashed.webContents.emit("render-process-gone", {}, { reason: "crashed" });

    expect(crashed.isDestroyed()).toBe(true);
    expect(windowForSenderId(crashed.webContents.id)).toBeNull();
    expect(windowForSenderId(survivor.webContents.id)).not.toBeNull();
    await expect(listOpenings(eventFor(survivor), {
      sessionId: survivingSession.sessionId,
    })).resolves.toEqual([expect.objectContaining({
      path: "Notes/A.md",
      documentId: "document-before-crash",
      operationId: "join-before-crash",
      state: "committed",
      active: false,
      owner: opening.owner,
    })]);
    await expect(reserveOpening(eventFor(survivor), {
      sessionId: survivingSession.sessionId,
      path: "Notes/A.md",
      documentId: "document-after-crash",
      operationId: "join-after-crash",
    })).rejects.toMatchObject({ code: "vault-projection-opening-conflict" });
    await expect(reserveOpening(eventFor(survivor), {
      sessionId: survivingSession.sessionId,
      path: "Notes/A.md",
      documentId: "document-before-crash",
      operationId: "join-before-crash",
      recoveryOwner: opening.owner,
    })).resolves.toMatchObject({ operationId: "join-before-crash", active: true });
    await expect(releaseOpening(eventFor(survivor), {
      sessionId: survivingSession.sessionId,
      path: "Notes/A.md",
      documentId: "document-before-crash",
      operationId: "join-before-crash",
    })).resolves.toEqual({ released: true });
    await expect(write(eventFor(survivor), {
      sessionId: survivingSession.sessionId,
      path: "Notes/B.md",
      content: "must stay blocked",
    })).rejects.toMatchObject({ code: "vault-delete-reserved" });
    await expect(write(eventFor(survivor), {
      sessionId: survivingSession.sessionId,
      path: "Notes/C.md",
      content: "survivor still works",
      expectedVersion: null,
    })).resolves.toMatchObject({ path: "Notes/C.md" });
  });

  it("exposes a Host-owned command that opens a second runtime collaboration window", async () => {
    const { installCollaborationWindowCommand } = await import("../electron/main");

    installCollaborationWindowCommand();
    installCollaborationWindowCommand();

    const fileMenu = electronHarness.applicationMenu?.items.find((item) => item.label === "File");
    const commands = fileMenu?.submenu?.items.filter((item) => item.id === "nexus-new-collaboration-window");
    expect(commands).toHaveLength(1);

    commands?.[0]?.click?.();
    expect(electronHarness.windows).toHaveLength(1);
    expect(electronHarness.windows[0]?.options.webPreferences.additionalArguments).toEqual([
      "--nexus-host-mode=runtime",
    ]);
  });
});
