import { contextBridge, ipcRenderer } from "electron";

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

/** A recent project entry annotated with whether its folder still exists. */
export interface RecentVault {
  path: string;
  name: string;
  exists: boolean;
}

export interface RecentVaultList {
  recents: RecentVault[];
  activeVault: string | null;
}

export interface ImportImageResult {
  markdownPath: string;
  absolutePath: string;
  relative: boolean;
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
  /** Pick an image and copy it into the vault (or return file:// without vault). */
  importImage(): Promise<ImportImageResult | null>;
  /** Persist a pasted/dropped image buffer into the vault (or data-URL fallback). */
  writeImage(payload: {
    name?: string;
    mime?: string;
    bytes: Uint8Array;
  }): Promise<ImportImageResult>;
  getLast(): Promise<VaultState>;
  setLast(vaultPath: string): Promise<{ ok: boolean }>;
  /** Recent projects with existence flags — for the project switcher. */
  listRecents(): Promise<RecentVaultList>;
  /** Drop one path from the recents list. */
  removeRecent(vaultPath: string): Promise<{ ok: boolean }>;
  onChanged(cb: (payload: { vault: string }) => void): () => void;
}

export type HostPlatform = "darwin" | "win32" | "linux" | string;

export interface WindowBridge {
  /** Node `process.platform` of the host. */
  platform: HostPlatform;
  /** True when the OS uses a frameless window with custom controls (not macOS). */
  usesCustomWindowControls: boolean;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  onFullscreenChange(cb: (fullscreen: boolean) => void): () => void;
}

export interface DemoBridge {
  openFile(): Promise<DemoFileHandle | null>;
  saveFile(path: string, content: string): Promise<{ path: string }>;
  saveFileAs(content: string): Promise<{ path: string } | null>;
  vault: VaultBridge;
  window: WindowBridge;
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
  importImage() {
    return ipcRenderer.invoke("vault:import-image");
  },
  writeImage(payload) {
    return ipcRenderer.invoke("vault:write-image", payload);
  },
  getLast() {
    return ipcRenderer.invoke("vault:get-last");
  },
  setLast(vaultPath) {
    return ipcRenderer.invoke("vault:set-last", vaultPath);
  },
  listRecents() {
    return ipcRenderer.invoke("vault:list-recents");
  },
  removeRecent(vaultPath) {
    return ipcRenderer.invoke("vault:remove-recent", vaultPath);
  },
  onChanged(cb) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { vault: string }) => cb(payload);
    ipcRenderer.on("vault:changed", listener);
    return () => {
      ipcRenderer.off("vault:changed", listener);
    };
  },
};

const platform = process.platform;

const windowBridge: WindowBridge = {
  platform,
  usesCustomWindowControls: platform !== "darwin",
  minimize() {
    return ipcRenderer.invoke("window:minimize");
  },
  toggleMaximize() {
    return ipcRenderer.invoke("window:toggle-maximize");
  },
  close() {
    return ipcRenderer.invoke("window:close");
  },
  isMaximized() {
    return ipcRenderer.invoke("window:is-maximized");
  },
  onMaximizedChange(cb) {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => cb(maximized);
    ipcRenderer.on("window:maximized-changed", listener);
    return () => {
      ipcRenderer.off("window:maximized-changed", listener);
    };
  },
  onFullscreenChange(cb) {
    const listener = (_event: Electron.IpcRendererEvent, fullscreen: boolean) => cb(fullscreen);
    ipcRenderer.on("window:fullscreen-changed", listener);
    return () => {
      ipcRenderer.off("window:fullscreen-changed", listener);
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
  window: windowBridge,
};

contextBridge.exposeInMainWorld("nexusDemo", bridge);
