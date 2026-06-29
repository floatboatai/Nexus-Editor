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

export interface VaultBridge {
  pick(): Promise<{ path: string } | null>;
  list(vaultPath: string): Promise<VaultNode[]>;
  read(filePath: string): Promise<DemoFileHandle>;
  readAll(): Promise<Array<{ path: string; content: string }>>;
  write(filePath: string, content: string): Promise<{ path: string }>;
  writeAsset(mimeType: string, bytes: Uint8Array): Promise<string | null>;
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
  writeAsset(mimeType, bytes) {
    return ipcRenderer.invoke("vault:write-asset", mimeType, bytes);
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

contextBridge.exposeInMainWorld("nexusDemo", bridge);
