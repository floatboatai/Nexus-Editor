import { contextBridge, ipcRenderer } from "electron";
import {
  parsePluginIpcEvent,
  parsePluginIpcRequest,
  parsePluginIpcResponse,
  type PluginHostBridge,
  type PluginIpcChannel,
  type PluginIpcEventContract,
  type PluginIpcRequest,
  type PluginIpcResponse,
  type PluginVaultProjectionOpeningOwner,
  type VaultSessionId,
} from "../src/shared/plugin-ipc";
import {
  parseHostModeArgument,
  type NexusHostMode,
} from "../src/shared/host-mode";
import { createPortReplicaStore } from "../src/renderer/collab-store-client";
import type { ElectronCollabStoreBridge } from "../src/shared/collab-store-ipc";
import { createReconnectableCollabStoreBridge } from "./collab-store-preload-bridge";
import { rendererMessagePortChannel } from "./collab-store-message-port";
import { COLLAB_NETWORK_CHANNELS, parseCollaborationNetworkConfiguration, type CollaborationInvitationRequest, type ElectronCollabNetworkBridge } from "../src/shared/collab-network-policy";

export interface DemoFileHandle {
  path: string;
  content: string;
}

export interface VaultNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: VaultNode[];
}

export interface VaultState {
  lastVault: string | null;
  recents: string[];
}

export interface VaultBridge {
  pick(): Promise<{ path: string } | null>;
  list(vaultPath: string): Promise<VaultNode[]>;
  read(filePath: string): Promise<DemoFileHandle>;
  readAll(): Promise<Array<{ path: string; content: string }>>;
  write(filePath: string, content: string): Promise<{ path: string }>;
  createFile(parentDir: string, name: string): Promise<{ path: string }>;
  createFolder(parentDir: string, name: string): Promise<{ path: string }>;
  rename(oldPath: string, newName: string): Promise<{ path: string }>;
  delete(targetPath: string): Promise<{ ok: boolean }>;
  getLast(): Promise<VaultState>;
  setLast(vaultPath: string): Promise<{ ok: boolean }>;
  onChanged(cb: (payload: { vault: string }) => void): () => void;
}

export interface DemoBridge {
  openFile(): Promise<DemoFileHandle | null>;
  saveFile(path: string, content: string): Promise<{ path: string }>;
  saveFileAs(content: string): Promise<{ path: string } | null>;
  vault: VaultBridge;
}

export interface NexusHostLifecycleBridge {
  readonly mode: NexusHostMode;
  onShutdown(callback: (event: PluginIpcEventContract["nexus:host:shutdown"]) => void): () => void;
  shutdownComplete(): Promise<{ readonly ok: true }>;
}

const vaultBridge: VaultBridge = {
  pick() {
    return ipcRenderer.invoke("vault:pick");
  },
  list(vaultPath) {
    return ipcRenderer.invoke("vault:list", vaultPath);
  },
  read(filePath) {
    return ipcRenderer.invoke("vault:read", filePath);
  },
  readAll() {
    return ipcRenderer.invoke("vault:read-all");
  },
  write(filePath, content) {
    return ipcRenderer.invoke("vault:write", filePath, content);
  },
  createFile(parentDir, name) {
    return ipcRenderer.invoke("vault:create-file", parentDir, name);
  },
  createFolder(parentDir, name) {
    return ipcRenderer.invoke("vault:create-folder", parentDir, name);
  },
  rename(oldPath, newName) {
    return ipcRenderer.invoke("vault:rename", oldPath, newName);
  },
  delete(targetPath) {
    return ipcRenderer.invoke("vault:delete", targetPath);
  },
  getLast() {
    return ipcRenderer.invoke("vault:get-last");
  },
  setLast(vaultPath) {
    return ipcRenderer.invoke("vault:set-last", vaultPath);
  },
  onChanged(cb) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { vault: string }) => cb(payload);
    ipcRenderer.on("vault:changed", listener);
    return () => {
      ipcRenderer.off("vault:changed", listener);
    };
  },
};

const bridge: DemoBridge = {
  openFile() {
    return ipcRenderer.invoke("demo:open-file");
  },
  saveFile(path: string, content: string) {
    return ipcRenderer.invoke("demo:save-file", path, content);
  },
  saveFileAs(content: string) {
    return ipcRenderer.invoke("demo:save-file-as", content);
  },
  vault: vaultBridge,
};

async function invokePluginHost<C extends PluginIpcChannel>(
  channel: C,
  request: PluginIpcRequest<C>,
): Promise<PluginIpcResponse<C>> {
  const parsedRequest = parsePluginIpcRequest(channel, request);
  const response: unknown = await ipcRenderer.invoke(channel, parsedRequest);
  return parsePluginIpcResponse(channel, response);
}

function subscribePluginEvent<C extends keyof PluginIpcEventContract>(
  channel: C,
  callback: (event: PluginIpcEventContract[C]) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    callback(parsePluginIpcEvent(channel, payload));
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

// Capabilities never cross the contextBridge. Page code identifies the plugin
// it is managing; only this isolated preload world can redeem the opaque token.
const pluginInstanceCapabilities = new Map<string, string>();

function requirePluginInstanceCapability(pluginId: string): string {
  const capability = pluginInstanceCapabilities.get(pluginId);
  if (!capability) throw new Error(`Plugin '${pluginId}' has no active host instance.`);
  return capability;
}

const pluginHostBridge: PluginHostBridge = Object.freeze({
  vault: Object.freeze({
    pick: () => invokePluginHost("nexus:vault:pick", {}),
    restore: () => invokePluginHost("nexus:vault:restore", {}),
    close: (sessionId: VaultSessionId) => invokePluginHost("nexus:vault:close", { sessionId }),
    commit: (sessionId: VaultSessionId) => invokePluginHost("nexus:vault:commit", { sessionId }),
    list: (sessionId: VaultSessionId) => invokePluginHost("nexus:vault:list", { sessionId }),
    read: (sessionId: VaultSessionId, path: string) =>
      invokePluginHost("nexus:vault:read", { sessionId, path }),
    readBinary: (sessionId: VaultSessionId, path: string) =>
      invokePluginHost("nexus:vault:read-binary", { sessionId, path }),
    readAll: (sessionId: VaultSessionId) => invokePluginHost("nexus:vault:read-all", { sessionId }),
    write: (sessionId: VaultSessionId, path: string, content: string, options = {}) =>
      invokePluginHost("nexus:vault:write", { sessionId, path, content, ...options }),
    writeBinary: (sessionId: VaultSessionId, path: string, content: Uint8Array, options = {}) =>
      invokePluginHost("nexus:vault:write-binary", { sessionId, path, content, ...options }),
    createFolder: (sessionId: VaultSessionId, path: string, operationId?: string) =>
      invokePluginHost("nexus:vault:create-folder", {
        sessionId,
        path,
        ...(operationId === undefined ? {} : { operationId }),
      }),
    rename: (
      sessionId: VaultSessionId,
      path: string,
      destination: string,
      operationId?: string,
    ) => invokePluginHost("nexus:vault:rename", {
      sessionId,
      path,
      destination,
      ...(operationId === undefined ? {} : { operationId }),
    }),
    trash: (sessionId: VaultSessionId, path: string, operationId?: string) =>
      invokePluginHost("nexus:vault:trash", {
        sessionId,
        path,
        ...(operationId === undefined ? {} : { operationId }),
      }),
    acquireProjectionWrite: (
      sessionId: VaultSessionId,
      path: string,
      projectionOpeningOperationId?: string,
    ) => invokePluginHost("nexus:vault:projection-write-acquire", {
      sessionId,
      path,
      ...(projectionOpeningOperationId === undefined ? {} : { projectionOpeningOperationId }),
    }),
    releaseProjectionWrite: (sessionId: VaultSessionId, permitId: string) =>
      invokePluginHost("nexus:vault:projection-write-release", { sessionId, permitId }),
    reserveProjectionOpening: (
      sessionId: VaultSessionId,
      path: string,
      documentId: string,
      operationId: string,
      recoveryOwner?: PluginVaultProjectionOpeningOwner,
    ) => invokePluginHost("nexus:vault:projection-opening-reserve", {
      sessionId,
      path,
      documentId,
      operationId,
      ...(recoveryOwner === undefined ? {} : { recoveryOwner }),
    }),
    commitProjectionOpening: (
      sessionId: VaultSessionId,
      path: string,
      documentId: string,
      operationId: string,
    ) => invokePluginHost("nexus:vault:projection-opening-commit", {
      sessionId,
      path,
      documentId,
      operationId,
    }),
    listProjectionOpenings: (sessionId: VaultSessionId) =>
      invokePluginHost("nexus:vault:projection-opening-list", { sessionId }),
    releaseProjectionOpening: (
      sessionId: VaultSessionId,
      path: string,
      documentId: string,
      operationId: string,
    ) => invokePluginHost("nexus:vault:projection-opening-release", {
      sessionId,
      path,
      documentId,
      operationId,
    }),
    reserveDeletion: (
      sessionId: VaultSessionId,
      path: string,
      operationId: string,
      state?: "precommit" | "committed",
    ) => invokePluginHost("nexus:vault:delete-reserve", {
      sessionId,
      path,
      operationId,
      ...(state === undefined ? {} : { state }),
    }),
    listDeletionFences: (sessionId: VaultSessionId) =>
      invokePluginHost("nexus:vault:delete-list", { sessionId }),
    releaseDeletion: (sessionId: VaultSessionId, path: string, operationId: string) =>
      invokePluginHost("nexus:vault:delete-release", { sessionId, path, operationId }),
    createResourceUrl: (sessionId: VaultSessionId, path: string) =>
      invokePluginHost("nexus:vault:resource-url", { sessionId, path }),
    revokeResourceUrl: (sessionId: VaultSessionId, registrationId: string) =>
      invokePluginHost("nexus:vault:revoke-resource-url", { sessionId, registrationId }),
    onChanged: (callback: (event: PluginIpcEventContract["nexus:vault:changed"]) => void) =>
      subscribePluginEvent("nexus:vault:changed", callback),
  }),
  storage: Object.freeze({
    load: (pluginId: string) => invokePluginHost("nexus:storage:load", { pluginId }),
    save: (pluginId: string, expectedRevision: number, data: unknown) =>
      invokePluginHost("nexus:storage:save", { pluginId, expectedRevision, data }),
  }),
  secrets: Object.freeze({
    status: () => invokePluginHost("nexus:secrets:status", {}),
  }),
  host: Object.freeze({
    activatePlugin: async (pluginId: string) => {
      const result = await invokePluginHost("nexus:host:activate-plugin", { pluginId });
      pluginInstanceCapabilities.set(pluginId, result.instanceCapability);
      return { ok: true as const };
    },
    revokePlugin: async (pluginId: string) => {
      const instanceCapability = requirePluginInstanceCapability(pluginId);
      try {
        return await invokePluginHost("nexus:host:revoke-plugin", { instanceCapability });
      } finally {
        pluginInstanceCapabilities.delete(pluginId);
      }
    },
    openExternal: (pluginId: string, url: string) => invokePluginHost("nexus:host:open-external", {
      instanceCapability: requirePluginInstanceCapability(pluginId),
      url,
    }),
    onShutdown: (callback: (event: PluginIpcEventContract["nexus:host:shutdown"]) => void) =>
      subscribePluginEvent("nexus:host:shutdown", callback),
    shutdownComplete: () => invokePluginHost("nexus:host:shutdown-complete", {}),
  }),
});

const hostMode = parseHostModeArgument(process.argv);
const collaborationStoreBridge = createReconnectableCollabStoreBridge();
let collaborationStoreGeneration = 0;

ipcRenderer.on("nexus:collab-store:port", (event, payload: unknown) => {
  const generation = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { readonly generation?: unknown }).generation
    : undefined;
  const port = event.ports[0];
  if (
    Object.keys((payload ?? {}) as object).length !== 1 ||
    !Number.isSafeInteger(generation) ||
    (generation as number) <= collaborationStoreGeneration ||
    event.ports.length !== 1 ||
    !port
  ) {
    event.ports.forEach((candidate) => candidate.close());
    return;
  }
  const replacesExistingGeneration = collaborationStoreGeneration > 0;
  collaborationStoreGeneration = generation as number;
  // A replacement port can arrive before Electron reports the old port closed.
  // Fence that generation before the new Store can become active.
  if (replacesExistingGeneration) collaborationStoreBridge.disconnect();
  const channel = rendererMessagePortChannel(port);
  let store!: ReturnType<typeof createPortReplicaStore>;
  store = createPortReplicaStore(channel, {
    beforeRemoteDrain: () => collaborationStoreBridge.drain(store),
  });
  port.addEventListener("close", () => {
    if (collaborationStoreGeneration === generation) {
      collaborationStoreBridge.disconnect();
    }
  }, { once: true });
  void collaborationStoreBridge.install(store).catch(() => {
    if (collaborationStoreGeneration === generation) collaborationStoreBridge.disconnect();
  });
});

ipcRenderer.on("nexus:collab-store:unavailable", () => {
  collaborationStoreBridge.disconnect();
});

const hostLifecycleBridge: NexusHostLifecycleBridge = Object.freeze({
  mode: hostMode,
  onShutdown: (
    callback: (event: PluginIpcEventContract["nexus:host:shutdown"]) => void,
  ) => subscribePluginEvent("nexus:host:shutdown", callback),
  shutdownComplete: () => invokePluginHost("nexus:host:shutdown-complete", {}),
});

const collaborationNetworkBridge: ElectronCollabNetworkBridge = Object.freeze({
  async getConfiguration() {
    try {
      const value: unknown = await ipcRenderer.invoke(COLLAB_NETWORK_CHANNELS.configuration);
      if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("serverUrls" in value)
        || !Array.isArray(value.serverUrls) || value.serverUrls.length === 0 || value.serverUrls.length > 16
        || value.serverUrls.some((entry) => typeof entry !== "string" || entry.length > 2_048 || entry.includes(","))) throw new TypeError();
      return parseCollaborationNetworkConfiguration(value.serverUrls.join(","));
    } catch { throw new Error("collaboration-network-unavailable"); }
  },
  async issueInvitation(request: CollaborationInvitationRequest) {
    try { return await ipcRenderer.invoke(COLLAB_NETWORK_CHANNELS.issueInvitation, request); }
    catch { return { ok: false, error: "invitation-request-failed" }; }
  },
});

contextBridge.exposeInMainWorld("nexusHost", hostLifecycleBridge);
if (hostMode === "runtime") {
  contextBridge.exposeInMainWorld("nexusCollabNetwork", collaborationNetworkBridge);
  contextBridge.exposeInMainWorld("nexusPlugins", pluginHostBridge);
  contextBridge.exposeInMainWorld(
    "nexusCollabStore",
    collaborationStoreBridge satisfies ElectronCollabStoreBridge,
  );
} else {
  contextBridge.exposeInMainWorld("nexusDemo", bridge);
}
