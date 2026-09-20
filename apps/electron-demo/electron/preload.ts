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
  type VaultSessionId,
} from "../src/shared/plugin-ipc";
import {
  parseHostModeArgument,
  type NexusHostMode,
} from "../src/shared/host-mode";

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
  createResourceUrl(filePath: string): Promise<{ url: string; registrationId: string }>;
  revokeResourceUrl(registrationId: string): Promise<{ ok: boolean }>;
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
  createResourceUrl(filePath) {
    return ipcRenderer.invoke("vault:resource-url", filePath);
  },
  revokeResourceUrl(registrationId) {
    return ipcRenderer.invoke("vault:revoke-resource-url", registrationId);
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
const hostLifecycleBridge: NexusHostLifecycleBridge = Object.freeze({
  mode: hostMode,
  onShutdown: (
    callback: (event: PluginIpcEventContract["nexus:host:shutdown"]) => void,
  ) => subscribePluginEvent("nexus:host:shutdown", callback),
  shutdownComplete: () => invokePluginHost("nexus:host:shutdown-complete", {}),
});

contextBridge.exposeInMainWorld("nexusHost", hostLifecycleBridge);
if (hostMode === "runtime") {
  contextBridge.exposeInMainWorld("nexusPlugins", pluginHostBridge);
} else {
  contextBridge.exposeInMainWorld("nexusDemo", bridge);
}
