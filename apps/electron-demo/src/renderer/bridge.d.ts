interface DemoFileHandle {
  path: string;
  content: string;
}

interface VaultNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: VaultNode[];
}

interface VaultState {
  lastVault: string | null;
  recents: string[];
}

interface RecentVault {
  path: string;
  name: string;
  exists: boolean;
}

interface RecentVaultList {
  recents: RecentVault[];
  activeVault: string | null;
}

interface ImportImageResult {
  markdownPath: string;
  absolutePath: string;
  relative: boolean;
}

interface VaultBridge {
  pick(): Promise<{ path: string } | null>;
  list(vaultPath: string): Promise<VaultNode[]>;
  read(filePath: string): Promise<DemoFileHandle>;
  readAll(): Promise<Array<{ path: string; content: string }>>;
  write(filePath: string, content: string): Promise<{ path: string }>;
  createFile(parentDir: string, name: string): Promise<{ path: string }>;
  createFolder(parentDir: string, name: string): Promise<{ path: string }>;
  rename(oldPath: string, newName: string): Promise<{ path: string }>;
  delete(targetPath: string): Promise<{ ok: boolean }>;
  importImage(): Promise<ImportImageResult | null>;
  writeImage(payload: {
    name?: string;
    mime?: string;
    bytes: Uint8Array;
  }): Promise<ImportImageResult>;
  getLast(): Promise<VaultState>;
  setLast(vaultPath: string): Promise<{ ok: boolean }>;
  listRecents(): Promise<RecentVaultList>;
  removeRecent(vaultPath: string): Promise<{ ok: boolean }>;
  onChanged(cb: (payload: { vault: string }) => void): () => void;
}

type HostPlatform = "darwin" | "win32" | "linux" | string;

interface WindowBridge {
  platform: HostPlatform;
  usesCustomWindowControls: boolean;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onMaximizedChange(cb: (maximized: boolean) => void): () => void;
  onFullscreenChange(cb: (fullscreen: boolean) => void): () => void;
}

interface DemoBridge {
  openFile(): Promise<DemoFileHandle | null>;
  saveFile(path: string, content: string): Promise<{ path: string }>;
  saveFileAs(content: string): Promise<{ path: string } | null>;
  vault: VaultBridge;
  window: WindowBridge;
}

interface Window {
  nexusDemo: DemoBridge;
}

declare module "*?worker" {
  const WorkerCtor: {
    new (options?: { name?: string }): Worker;
  };
  export default WorkerCtor;
}
