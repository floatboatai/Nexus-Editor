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
  getLast(): Promise<VaultState>;
  setLast(vaultPath: string): Promise<{ ok: boolean }>;
  onChanged(cb: (payload: { vault: string }) => void): () => void;
}

interface DemoBridge {
  openFile(): Promise<DemoFileHandle | null>;
  saveFile(path: string, content: string): Promise<{ path: string }>;
  saveFileAs(content: string): Promise<{ path: string } | null>;
  vault: VaultBridge;
  snapshots: SnapshotsBridge;
}

interface SnapshotMeta {
  id: string;
  createdAt: number;
  label?: string;
  size: number;
  hash: string;
}

interface Snapshot extends SnapshotMeta {
  content: string;
}

interface SnapshotsBridge {
  list(documentKey: string): Promise<SnapshotMeta[]>;
  load(documentKey: string, id: string): Promise<string | null>;
  save(documentKey: string, snapshot: Snapshot): Promise<void>;
  remove(documentKey: string, id: string): Promise<void>;
  clear(documentKey: string): Promise<void>;
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
