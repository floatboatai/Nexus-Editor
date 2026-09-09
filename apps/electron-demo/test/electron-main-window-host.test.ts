import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronHarness = vi.hoisted(() => ({
  appListeners: new Map<string, Array<(...args: any[]) => void>>(),
  ipcHandlers: new Map<string, (...args: any[]) => unknown>(),
  quit: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  openPath: vi.fn(async () => ""),
  sessions: [] as Array<{
    readonly partition: string;
    readonly handledSchemes: Set<string>;
    readonly unhandle: ReturnType<typeof vi.fn>;
  }>,
  windows: [] as Array<{
    readonly options: Record<string, any>;
    readonly webContents: {
      readonly id: number;
      readonly sent: Array<{ readonly channel: string; readonly payload: unknown }>;
      getURL(): string;
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

    constructor(readonly id: number) {
      super();
    }

    setWindowOpenHandler(): void {}
    getURL(): string { return "http://trusted.local/"; }
    toggleDevTools(): void {}
    send(channel: string, payload: unknown): void { this.sent.push({ channel, payload }); }
  }

  class FakeBrowserWindow extends FakeEmitter {
    readonly webContents = new FakeWebContents(electronHarness.windows.length + 1);
    private destroyed = false;

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
    loadFile(): Promise<void> { return Promise.resolve(); }
    loadURL(): Promise<void> { return Promise.resolve(); }
    show(): void {}
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

  return {
    app,
    BrowserWindow: FakeBrowserWindow,
    dialog: {
      showOpenDialog: electronHarness.showOpenDialog,
      showSaveDialog: electronHarness.showSaveDialog,
    },
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => unknown) => {
        electronHarness.ipcHandlers.set(channel, handler);
      },
    },
    protocol: { registerSchemesAsPrivileged: vi.fn() },
    session: {
      fromPartition: (partition: string) => {
        const handledSchemes = new Set<string>();
        const unhandle = vi.fn((scheme: string) => handledSchemes.delete(scheme));
        const fakeSession = {
          partition,
          handledSchemes,
          unhandle,
          protocol: {
            handle: (scheme: string) => { handledSchemes.add(scheme); },
            unhandle,
          },
        };
        electronHarness.sessions.push(fakeSession);
        return fakeSession;
      },
    },
    shell: {
      openExternal: vi.fn(),
      openPath: electronHarness.openPath,
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
    electronHarness.sessions.length = 0;
    electronHarness.windows.length = 0;
    electronHarness.quit.mockReset();
    electronHarness.showOpenDialog.mockReset();
    electronHarness.showSaveDialog.mockReset();
    electronHarness.openPath.mockClear();
    process.env.VITE_DEV_SERVER_URL = "http://trusted.local";
  });

  afterEach(() => {
    delete process.env.VITE_DEV_SERVER_URL;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function eventFor(window: typeof electronHarness.windows[number]) {
    return {
      sender: window.webContents,
      senderFrame: { url: window.webContents.getURL() },
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
});
