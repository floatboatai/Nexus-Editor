import {
  createNoteVaultError,
  type AnyNoteVaultRef,
  type NoteVaultAdapter,
  type NoteVaultCapabilities,
  type NoteVaultChangeEvent,
  type NoteVaultFileRef,
  type NoteVaultFolderRef,
  type NoteVaultNode,
  type NoteVaultRef,
} from "@floatboat/nexus-core";

const PROVIDER_ID = "electron-local-vault";

export interface ElectronVaultAdapter extends NoteVaultAdapter {
  pick(): Promise<{ path: string } | null>;
  getLast(): Promise<VaultState>;
  setLast(vaultPath: string): Promise<void>;
  rootRef(vaultPath: string): NoteVaultFolderRef;
  refToPath(ref: NoteVaultRef): string;
  pathToFileRef(filePath: string): NoteVaultFileRef;
  pathToFolderRef(folderPath: string): NoteVaultFolderRef;
}

const capabilities: NoteVaultCapabilities = {
  watch: true,
  trash: true,
  renameFile: true,
  renameFolder: true,
  createFile: true,
  createFolder: true,
  deleteFile: true,
  deleteFolder: true,
  optimisticWrites: false,
};

export function createElectronVaultAdapter(bridge: VaultBridge = window.nexusDemo.vault): ElectronVaultAdapter {
  function nameFromPath(value: string): string {
    const norm = value.replace(/\\/g, "/");
    return norm.slice(norm.lastIndexOf("/") + 1) || value;
  }

  function pathFromRef(ref: NoteVaultRef): string {
    if (ref.providerId !== PROVIDER_ID) {
      throw createNoteVaultError("invalid-ref", `Unsupported vault provider: ${ref.providerId}`, {
        ref,
      });
    }
    return ref.displayPath ?? ref.id;
  }

  function fileRef(filePath: string): NoteVaultFileRef {
    return {
      providerId: PROVIDER_ID,
      id: filePath,
      kind: "file",
      name: nameFromPath(filePath),
      displayPath: filePath,
    };
  }

  function folderRef(folderPath: string): NoteVaultFolderRef {
    return {
      providerId: PROVIDER_ID,
      id: folderPath,
      kind: "folder",
      name: nameFromPath(folderPath),
      displayPath: folderPath,
    };
  }

  function nodeFromBridge(node: VaultNode): NoteVaultNode {
    const kind = node.kind === "directory" ? "folder" : "file";
    const ref = kind === "folder" ? folderRef(node.path) : fileRef(node.path);
    return {
      ref,
      name: node.name,
      kind,
      displayPath: node.path,
      children: node.children?.map(nodeFromBridge),
    };
  }

  const adapter: ElectronVaultAdapter = {
    id: PROVIDER_ID,
    label: "Local vault",
    capabilities,
    pick() {
      return bridge.pick();
    },
    async getLast() {
      return bridge.getLast();
    },
    async setLast(vaultPath) {
      await bridge.setLast(vaultPath);
    },
    rootRef: folderRef,
    refToPath: pathFromRef,
    pathToFileRef: fileRef,
    pathToFolderRef: folderRef,
    async list(options = {}) {
      const root = options.root ? pathFromRef(options.root) : null;
      if (!root) {
        throw createNoteVaultError("invalid-ref", "Local vault list requires a root folder ref", {
          operation: "list",
        });
      }
      const nodes = await bridge.list(root);
      return nodes.map(nodeFromBridge);
    },
    async read(ref) {
      const result = await bridge.read(pathFromRef(ref));
      return {
        ref: fileRef(result.path),
        content: result.content,
      };
    },
    async write(ref, content) {
      const result = await bridge.write(pathFromRef(ref), content);
      return { ref: fileRef(result.path) };
    },
    async createFile(parent, name, content = "") {
      const result = await bridge.createFile(pathFromRef(parent), name);
      if (content) await bridge.write(result.path, content);
      return fileRef(result.path);
    },
    async createFolder(parent, name) {
      const result = await bridge.createFolder(pathFromRef(parent), name);
      return folderRef(result.path);
    },
    async rename(ref, name): Promise<AnyNoteVaultRef> {
      const result = await bridge.rename(pathFromRef(ref), name);
      return ref.kind === "folder" ? folderRef(result.path) : fileRef(result.path);
    },
    async delete(ref, options = {}) {
      if (options.trash === false) {
        throw createNoteVaultError("unsupported-operation", "Local vault delete always uses the system trash", {
          ref,
          operation: "delete",
        });
      }
      await bridge.delete(pathFromRef(ref));
    },
    watch(listener: (event: NoteVaultChangeEvent) => void) {
      return bridge.onChanged((payload) => {
        listener({
          kind: "refreshed",
          ref: folderRef(payload.vault),
        });
      });
    },
  };

  return adapter;
}
