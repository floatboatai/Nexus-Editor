import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronCollabNetworkBridge } from "../src/shared/collab-network-policy";

const preloadHarness = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  listeners: new Map<string, Array<(...args: unknown[]) => void>>(),
  invoke: vi.fn(),
  collaborationStoreEvents: [] as string[],
  collaborationStoreBridge: {
    request: vi.fn(),
    install: vi.fn(async () => {
      preloadHarness.collaborationStoreEvents.push("install");
    }),
    disconnect: vi.fn(() => {
      preloadHarness.collaborationStoreEvents.push("disconnect");
    }),
    close: vi.fn(async () => undefined),
  },
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => preloadHarness.exposed.set(key, value),
  },
  ipcRenderer: {
    invoke: preloadHarness.invoke,
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      const listeners = preloadHarness.listeners.get(channel) ?? [];
      listeners.push(listener);
      preloadHarness.listeners.set(channel, listeners);
    },
    off: vi.fn(),
  },
}));

vi.mock("../electron/collab-store-preload-bridge", () => ({
  createReconnectableCollabStoreBridge: () =>
    preloadHarness.collaborationStoreBridge,
}));

function rendererPort() {
  return {
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
  };
}

const originalArgv = [...process.argv];

describe("Electron preload host surfaces", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    preloadHarness.exposed.clear();
    preloadHarness.listeners.clear();
    preloadHarness.collaborationStoreEvents.length = 0;
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

    expect([...preloadHarness.exposed.keys()].sort()).toEqual([
      "nexusCollabNetwork",
      "nexusCollabStore",
      "nexusHost",
      "nexusPlugins",
    ]);
    expect(preloadHarness.exposed.get("nexusHost")).toMatchObject({ mode: "runtime" });
    expect(preloadHarness.exposed.has("nexusDemo")).toBe(false);
  });

  it("exposes only fixed invitation operations and suppresses privileged IPC failure details", async () => {
    process.argv.splice(0, process.argv.length, "electron", "--nexus-host-mode=runtime");
    await import("../electron/preload");
    const bridge = preloadHarness.exposed.get("nexusCollabNetwork") as ElectronCollabNetworkBridge;
    expect(bridge).toBeDefined();
    expect(Object.keys(bridge).sort()).toEqual(["getConfiguration", "issueInvitation"]);
    preloadHarness.invoke.mockResolvedValueOnce({ serverUrls: ["wss://collab.example.test"] });
    expect(await bridge.getConfiguration()).toEqual({ serverUrls: ["wss://collab.example.test"] });
    expect(preloadHarness.invoke).toHaveBeenLastCalledWith("nexus:collab-network:configuration");
    const request = { serverUrl: "wss://collab.example.test", token: "owner-token", documentId: "document-1", userId: "invitee", role: "reader", lifetimeSeconds: 60 } as const;
    preloadHarness.invoke.mockRejectedValueOnce(new Error("privileged owner-token details"));
    expect(await bridge.issueInvitation(request)).toEqual({ ok: false, error: "invitation-request-failed" });
    expect(preloadHarness.invoke).toHaveBeenLastCalledWith("nexus:collab-network:issue-invitation", request);
    preloadHarness.invoke.mockResolvedValueOnce({ serverUrls: ["ws://untrusted.example.test"] });
    await expect(bridge.getConfiguration()).rejects.toThrow("collaboration-network-unavailable");
  });

  it("disconnects the active Store before installing a replacement MessagePort generation", async () => {
    process.argv.splice(0, process.argv.length, "electron", "--nexus-host-mode=runtime");
    await import("../electron/preload");
    const receivePort = preloadHarness.listeners.get(
      "nexus:collab-store:port",
    )?.[0];
    if (!receivePort) throw new Error("expected collaboration Store port listener");

    receivePort({ ports: [rendererPort()] }, { generation: 1 });
    await Promise.resolve();
    preloadHarness.collaborationStoreEvents.length = 0;

    receivePort({ ports: [rendererPort()] }, { generation: 2 });

    expect(preloadHarness.collaborationStoreEvents).toEqual([
      "disconnect",
      "install",
    ]);
  });
});
