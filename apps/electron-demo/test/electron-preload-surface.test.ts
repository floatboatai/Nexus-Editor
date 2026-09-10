import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const preloadHarness = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => preloadHarness.exposed.set(key, value),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      const listeners = preloadHarness.listeners.get(channel) ?? [];
      listeners.push(listener);
      preloadHarness.listeners.set(channel, listeners);
    },
    off: vi.fn(),
  },
}));

const originalArgv = [...process.argv];

describe("Electron preload host surfaces", () => {
  beforeEach(() => {
    vi.resetModules();
    preloadHarness.exposed.clear();
    preloadHarness.listeners.clear();
  });

  afterEach(() => {
    process.argv.splice(0, process.argv.length, ...originalArgv);
  });

  it("exposes only lifecycle and legacy bridges in legacy mode", async () => {
    process.argv.splice(0, process.argv.length, "electron", "--nexus-host-mode=legacy");
    await import("../electron/preload");

    expect([...preloadHarness.exposed.keys()].sort()).toEqual(["nexusDemo", "nexusHost"]);
    expect(preloadHarness.exposed.get("nexusHost")).toMatchObject({ mode: "legacy" });
    expect(preloadHarness.exposed.has("nexusPlugins")).toBe(false);
  });

  it("exposes only lifecycle and capability bridges in runtime mode", async () => {
    process.argv.splice(0, process.argv.length, "electron", "--nexus-host-mode=runtime");
    await import("../electron/preload");

    expect([...preloadHarness.exposed.keys()].sort()).toEqual(["nexusHost", "nexusPlugins", "nexusPublicCapabilities"]);
    expect(preloadHarness.exposed.get("nexusHost")).toMatchObject({ mode: "runtime" });
    expect(preloadHarness.exposed.has("nexusDemo")).toBe(false);
  });

  it("exposes the bounded public capability bridge in runtime mode", async () => {
    process.argv.splice(0, process.argv.length, "electron", "--nexus-host-mode=runtime");
    await import("../electron/preload");
    expect([...preloadHarness.exposed.keys()].sort()).toEqual(["nexusHost", "nexusPlugins", "nexusPublicCapabilities"]);
    const bridge = preloadHarness.exposed.get("nexusPublicCapabilities") as import("../src/shared/public-capabilities-ipc").PublicCapabilitiesBridge;
    const { ipcRenderer } = await import("electron");
    await bridge.cancelShutdown();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith("nexus:public-capabilities", { operation: "cancel-shutdown" });
    await bridge.inspectSearchDocument?.({ kind: "selected", id: "fixture" }, { includeContent: false });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith("nexus:public-capabilities", {
      operation: "inspect-search-document", source: { kind: "selected", id: "fixture" }, includeContent: false,
    });
  });
});
