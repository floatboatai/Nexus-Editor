import { describe, expect, it, vi } from "vitest";

import { readAllNoteVaultFiles } from "@floatboat/nexus-core";
import { createElectronVaultAdapter } from "../src/renderer/vault-adapter";

function createBridge(): VaultBridge {
  const nodes: VaultNode[] = [
    {
      name: "Folder",
      path: "/vault/Folder",
      kind: "directory",
      children: [{ name: "Note.md", path: "/vault/Folder/Note.md", kind: "file" }],
    },
  ];
  return {
    pick: vi.fn(),
    list: vi.fn(async () => nodes),
    read: vi.fn(async (filePath: string) => ({ path: filePath, content: "# Note" })),
    readAll: vi.fn(async (vaultPath?: string) => [{ path: `${vaultPath ?? "/vault"}/Folder/Note.md`, content: "# Batch" }]),
    write: vi.fn(async (filePath: string) => ({ path: filePath })),
    createFile: vi.fn(async (parentDir: string, name: string) => ({ path: `${parentDir}/${name}` })),
    createFolder: vi.fn(async (parentDir: string, name: string) => ({ path: `${parentDir}/${name}` })),
    rename: vi.fn(async (oldPath: string, newName: string) => ({
      path: `${oldPath.replace(/[\\/][^\\/]+$/, "")}/${newName}`,
    })),
    delete: vi.fn(async () => ({ ok: true })),
    getLast: vi.fn(async () => ({ lastVault: null, recents: [] })),
    setLast: vi.fn(async () => ({ ok: true })),
    onChanged: vi.fn(() => () => undefined),
  };
}

describe("createElectronVaultAdapter", () => {
  it("maps bridge directory nodes to provider-neutral folder refs", async () => {
    const bridge = createBridge();
    const adapter = createElectronVaultAdapter(bridge);

    const nodes = await adapter.list({ root: adapter.rootRef("/vault") });

    expect(bridge.list).toHaveBeenCalledWith("/vault");
    expect(nodes[0]).toMatchObject({
      name: "Folder",
      kind: "folder",
      ref: {
        providerId: "electron-local-vault",
        id: "/vault/Folder",
        kind: "folder",
      },
    });
    expect(nodes[0].children?.[0].kind).toBe("file");
  });

  it("routes read/write/create/rename/delete through ref paths", async () => {
    const bridge = createBridge();
    const adapter = createElectronVaultAdapter(bridge);
    const folder = adapter.pathToFolderRef("/vault");
    const file = adapter.pathToFileRef("/vault/Note.md");

    await expect(adapter.read(file)).resolves.toMatchObject({
      ref: { id: "/vault/Note.md", kind: "file" },
      content: "# Note",
    });
    await adapter.write(file, "updated");
    const created = await adapter.createFile(folder, "New.md", "body");
    const renamed = await adapter.rename(created, "Renamed.md");
    await adapter.delete(renamed, { trash: true });

    expect(bridge.write).toHaveBeenCalledWith("/vault/Note.md", "updated");
    expect(bridge.createFile).toHaveBeenCalledWith("/vault", "New.md");
    expect(bridge.write).toHaveBeenCalledWith("/vault/New.md", "body");
    expect(bridge.rename).toHaveBeenCalledWith("/vault/New.md", "Renamed.md");
    expect(bridge.delete).toHaveBeenCalledWith("/vault/Renamed.md");
  });

  it("uses ref ids rather than display paths for stable operation identity", async () => {
    const bridge = createBridge();
    const adapter = createElectronVaultAdapter(bridge);
    const file = {
      ...adapter.pathToFileRef("/vault/Note.md"),
      displayPath: "/display-only/Note.md",
    };

    await adapter.read(file);

    expect(bridge.read).toHaveBeenCalledWith("/vault/Note.md");
  });

  it("routes readAllNoteVaultFiles through the batch bridge path", async () => {
    const bridge = createBridge();
    const adapter = createElectronVaultAdapter(bridge);

    const files = await readAllNoteVaultFiles(adapter, {
      root: adapter.rootRef("/vault"),
    });

    expect(bridge.readAll).toHaveBeenCalledWith("/vault");
    expect(bridge.read).not.toHaveBeenCalled();
    expect(files).toEqual([
      {
        ref: {
          providerId: "electron-local-vault",
          id: "/vault/Folder/Note.md",
          kind: "file",
          name: "Note.md",
          displayPath: "/vault/Folder/Note.md",
        },
        content: "# Batch",
      },
    ]);
  });

  it("surfaces hard-delete requests as unsupported because local delete uses trash", async () => {
    const adapter = createElectronVaultAdapter(createBridge());

    await expect(adapter.delete(adapter.pathToFileRef("/vault/Note.md"), { trash: false })).rejects.toMatchObject({
      code: "unsupported-operation",
      operation: "delete",
    });
  });
});
