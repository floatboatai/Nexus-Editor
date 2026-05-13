import { describe, expect, it, vi } from "vitest";

import type {
  NoteVaultChangeEvent,
  NoteVaultFileRef,
  NoteVaultFolderRef,
  NoteVaultNode,
  NoteVaultRef,
} from "@floatboat/nexus-core";
import type { ElectronVaultAdapter } from "../src/renderer/vault-adapter";
import { createVaultPanel } from "../src/renderer/vault-panel";

function waitForAsyncHandlers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createRef(path: string, kind: "file"): NoteVaultFileRef;
function createRef(path: string, kind: "folder"): NoteVaultFolderRef;
function createRef(path: string, kind: "file" | "folder"): NoteVaultFileRef | NoteVaultFolderRef;
function createRef(path: string, kind: "file" | "folder"): NoteVaultFileRef | NoteVaultFolderRef {
  return {
    providerId: "test-vault",
    id: path,
    kind,
    name: path.split("/").pop() || path,
    displayPath: path,
  } as NoteVaultFileRef | NoteVaultFolderRef;
}

function createNode(path: string, kind: "file", children?: NoteVaultNode[]): NoteVaultNode;
function createNode(path: string, kind: "folder", children?: NoteVaultNode[]): NoteVaultNode;
function createNode(path: string, kind: "file" | "folder", children?: NoteVaultNode[]): NoteVaultNode {
  return {
    name: path.split("/").pop() || path,
    kind,
    ref: createRef(path, kind),
    displayPath: path,
    children,
  };
}

function createAdapter() {
  let nodes: NoteVaultNode[] = [
    createNode("/vault/Folder", "folder", [createNode("/vault/Folder/Note.md", "file")]),
  ];
  const unsubscribe = vi.fn();
  const adapter: ElectronVaultAdapter = {
    id: "test-vault",
    label: "Test vault",
    capabilities: {
      watch: true,
      trash: true,
      createFile: true,
      createFolder: true,
      renameFile: true,
      renameFolder: true,
      deleteFile: true,
      deleteFolder: true,
    },
    pick: vi.fn(async () => ({ path: "/vault" })),
    getLast: vi.fn(async () => ({ lastVault: null, recents: [] })),
    setLast: vi.fn(async () => undefined),
    rootRef: (vaultPath: string) => createRef(vaultPath, "folder"),
    refToPath: (ref: NoteVaultRef) => ref.displayPath ?? ref.id,
    pathToFileRef: (filePath: string) => createRef(filePath, "file"),
    pathToFolderRef: (folderPath: string) => createRef(folderPath, "folder"),
    list: vi.fn(async () => nodes),
    read: vi.fn(async (ref) => ({ ref: createRef(ref.displayPath ?? ref.id, "file"), content: "" })),
    write: vi.fn(async (ref) => ({ ref: createRef(ref.displayPath ?? ref.id, "file") })),
    createFile: vi.fn(async (parent, name) => {
      const path = `${parent.displayPath ?? parent.id}/${name}`;
      const created = createNode(path, "file");
      nodes = [created, ...nodes];
      return created.ref as NoteVaultFileRef;
    }),
    createFolder: vi.fn(async (parent, name) => {
      const path = `${parent.displayPath ?? parent.id}/${name}`;
      const created = createNode(path, "folder", []);
      nodes = [created, ...nodes];
      return created.ref as NoteVaultFolderRef;
    }),
    rename: vi.fn(async (ref, name) => createRef(`${(ref.displayPath ?? ref.id).replace(/[\\/][^\\/]+$/, "")}/${name}`, ref.kind)),
    delete: vi.fn(async (ref) => {
      const path = ref.displayPath ?? ref.id;
      nodes = nodes.filter((node) => (node.ref.displayPath ?? node.ref.id) !== path);
    }),
    watch: vi.fn((_listener: (event: NoteVaultChangeEvent) => void) => unsubscribe),
  };
  return { adapter, unsubscribe };
}

describe("createVaultPanel storage adapter integration", () => {
  it("opens a vault through the adapter, renders files, and opens clicked notes", async () => {
    const { adapter, unsubscribe } = createAdapter();
    const onOpenFile = vi.fn();
    const panel = createVaultPanel({
      adapter,
      onOpenFile,
      onError: vi.fn(),
      onStatus: vi.fn(),
    });
    document.body.appendChild(panel.element);

    await panel.openVault("/vault");
    const noteRow = panel.element.querySelector<HTMLElement>('[data-path="/vault/Folder/Note.md"]');
    expect(noteRow).not.toBeNull();

    noteRow!.click();

    expect(adapter.list).toHaveBeenCalledWith({ root: expect.objectContaining({ id: "/vault", kind: "folder" }) });
    expect(adapter.setLast).toHaveBeenCalledWith("/vault");
    expect(adapter.watch).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith("/vault/Folder/Note.md");

    panel.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("creates a root note through the adapter and opens the created file", async () => {
    const { adapter } = createAdapter();
    const onOpenFile = vi.fn();
    const panel = createVaultPanel({
      adapter,
      onOpenFile,
      onError: vi.fn(),
      onStatus: vi.fn(),
    });
    document.body.appendChild(panel.element);
    await panel.openVault("/vault");

    panel.element.querySelector<HTMLButtonElement>('button[title="New file at root"]')!.click();
    const input = panel.element.querySelector<HTMLInputElement>("input")!;
    input.value = "New.md";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await waitForAsyncHandlers();

    expect(adapter.createFile).toHaveBeenCalledWith(expect.objectContaining({ id: "/vault", kind: "folder" }), "New.md");
    expect(onOpenFile).toHaveBeenCalledWith("/vault/New.md");
    expect(panel.element.querySelector('[data-path="/vault/New.md"]')).not.toBeNull();

    panel.destroy();
  });

  it("deletes notes with trash semantics from the context menu", async () => {
    const { adapter } = createAdapter();
    const onStatus = vi.fn();
    const panel = createVaultPanel({
      adapter,
      onOpenFile: vi.fn(),
      onError: vi.fn(),
      onStatus,
    });
    document.body.appendChild(panel.element);
    await panel.openVault("/vault");

    const noteRow = panel.element.querySelector<HTMLElement>('[data-path="/vault/Folder/Note.md"]')!;
    noteRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const deleteButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".nexus-vault-ctxmenu button"))
      .find((button) => button.textContent === "Delete");
    expect(deleteButton).not.toBeUndefined();
    deleteButton!.click();
    await waitForAsyncHandlers();

    expect(adapter.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "/vault/Folder/Note.md", kind: "file" }),
      { trash: true }
    );
    expect(onStatus).toHaveBeenCalledWith("Moved Note.md to Trash");

    panel.destroy();
  });
});
