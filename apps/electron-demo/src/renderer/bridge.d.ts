import type { PluginHostBridge } from "../shared/plugin-ipc";
import type { NexusHostMode } from "../shared/host-mode";
import type { ElectronCollabStoreBridge } from "../shared/collab-store-ipc";
import type { ElectronCollabNetworkBridge } from "../shared/collab-network-policy";

declare global {
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
  }

  interface NexusHostLifecycleBridge {
    readonly mode: NexusHostMode;
    onShutdown(
      callback: (event: { readonly reason: "window-close" | "app-quit" }) => void,
    ): () => void;
    shutdownComplete(): Promise<{ readonly ok: true }>;
  }

  interface Window {
    nexusHost: NexusHostLifecycleBridge;
    nexusDemo?: DemoBridge;
    nexusPlugins?: PluginHostBridge;
    nexusCollabStore?: ElectronCollabStoreBridge;
    nexusCollabNetwork?: ElectronCollabNetworkBridge;
  }
}

declare module "*?worker" {
  const WorkerCtor: {
    new (options?: { name?: string }): Worker;
  };
  export default WorkerCtor;
}
