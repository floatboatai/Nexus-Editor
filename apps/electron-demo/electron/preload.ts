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
  snapshots: SnapshotsBridge;
}

export interface SnapshotMeta {
  id: string;
  createdAt: number;
  label?: string;
  size: number;
  hash: string;
}

export interface Snapshot extends SnapshotMeta {
  content: string;
}

export interface SnapshotsBridge {
  list(documentKey: string): Promise<SnapshotMeta[]>;
  load(documentKey: string, id: string): Promise<string | null>;
  save(documentKey: string, snapshot: Snapshot): Promise<void>;
  remove(documentKey: string, id: string): Promise<void>;
  clear(documentKey: string): Promise<void>;
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

const snapshotsBridge: SnapshotsBridge = {
  list(documentKey) {
    return ipcRenderer.invoke("snapshots:list", documentKey);
  },
  load(documentKey, id) {
    return ipcRenderer.invoke("snapshots:load", documentKey, id);
  },
  save(documentKey, snapshot) {
    return ipcRenderer.invoke("snapshots:save", documentKey, snapshot);
  },
  remove(documentKey, id) {
    return ipcRenderer.invoke("snapshots:remove", documentKey, id);
  },
  clear(documentKey) {
    return ipcRenderer.invoke("snapshots:clear", documentKey);
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
  snapshots: snapshotsBridge,
};

contextBridge.exposeInMainWorld("nexusDemo", bridge);
