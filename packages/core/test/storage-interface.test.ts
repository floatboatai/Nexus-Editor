import { describe, expect, it, vi } from "vitest";

import {
  NoteVaultError,
  createNoteVaultError,
  flattenNoteVaultNodes,
  isNoteVaultError,
  readAllNoteVaultFiles,
  type AnyNoteVaultRef,
  type NoteVaultAdapter,
  type NoteVaultChangeEvent,
  type NoteVaultFile,
  type NoteVaultFileRef,
  type NoteVaultFolderRef,
  type NoteVaultListOptions,
  type NoteVaultNode,
  type NoteVaultRef,
} from "../src/index";

interface MemoryEntry {
  kind: "file" | "folder";
  name: string;
  parent: string | null;
  content?: string;
  revision: number;
}

class InMemoryNoteVaultAdapter implements NoteVaultAdapter {
  readonly id = "memory";
  readonly label = "Memory vault";
  readonly capabilities = {
    watch: true,
    trash: false,
    renameFile: true,
    renameFolder: true,
    createFile: true,
    createFolder: true,
    deleteFile: true,
    deleteFolder: true,
    optimisticWrites: true,
  };

  private entries = new Map<string, MemoryEntry>([
    ["/", { kind: "folder", name: "", parent: null, revision: 1 }],
  ]);
  private listeners = new Set<(event: NoteVaultChangeEvent) => void>();

  rootRef(): NoteVaultFolderRef {
    return this.ref("/", "folder");
  }

  async list(): Promise<NoteVaultNode[]> {
    return this.childrenOf("/");
  }

  async read(ref: NoteVaultRef): Promise<NoteVaultFile> {
    const id = this.assertRef(ref, "file");
    const entry = this.entries.get(id)!;
    return {
      ref: this.ref(id, "file"),
      content: entry.content ?? "",
      revision: String(entry.revision),
    };
  }

  async write(ref: NoteVaultRef, content: string, options: { revision?: string } = {}) {
    const id = this.assertRef(ref, "file");
    const entry = this.entries.get(id)!;
    if (options.revision && options.revision !== String(entry.revision)) {
      throw createNoteVaultError("conflict", "Stale revision", {
        ref: this.ref(id, "file"),
        operation: "write",
      });
    }
    entry.content = content;
    entry.revision += 1;
    this.emit({ kind: "updated", ref: this.ref(id, "file") });
    return { ref: this.ref(id, "file"), revision: String(entry.revision) };
  }

  async createFile(parent: NoteVaultRef, name: string, content = ""): Promise<NoteVaultFileRef> {
    const parentId = this.assertRef(parent, "folder");
    const id = this.childId(parentId, name);
    if (this.entries.has(id)) throw createNoteVaultError("conflict", `Already exists: ${name}`);
    this.entries.set(id, { kind: "file", name, parent: parentId, content, revision: 1 });
    const ref = this.ref(id, "file");
    this.emit({ kind: "created", ref });
    return ref;
  }

  async createFolder(parent: NoteVaultRef, name: string): Promise<NoteVaultFolderRef> {
    const parentId = this.assertRef(parent, "folder");
    const id = this.childId(parentId, name);
    if (this.entries.has(id)) throw createNoteVaultError("conflict", `Already exists: ${name}`);
    this.entries.set(id, { kind: "folder", name, parent: parentId, revision: 1 });
    const ref = this.ref(id, "folder");
    this.emit({ kind: "created", ref });
    return ref;
  }

  async rename(ref: NoteVaultRef, name: string): Promise<AnyNoteVaultRef> {
    const id = this.assertRef(ref);
    const entry = this.entries.get(id)!;
    if (entry.parent === null) throw createNoteVaultError("unsupported-operation", "Cannot rename root");
    const nextId = this.childId(entry.parent, name);
    if (this.entries.has(nextId)) throw createNoteVaultError("conflict", `Already exists: ${name}`);

    const moved = new Map<string, MemoryEntry>();
    for (const [entryId, child] of this.entries) {
      if (entryId === id || entryId.startsWith(`${id}/`)) {
        const rewrittenId = `${nextId}${entryId.slice(id.length)}`;
        moved.set(rewrittenId, {
          ...child,
          name: entryId === id ? name : child.name,
          parent: child.parent === id ? nextId : child.parent?.startsWith(`${id}/`) ? `${nextId}${child.parent.slice(id.length)}` : child.parent,
        });
        this.entries.delete(entryId);
      }
    }
    for (const [entryId, child] of moved) this.entries.set(entryId, child);

    const previousRef = this.ref(id, entry.kind);
    const nextRef = this.ref(nextId, entry.kind);
    this.emit({ kind: "renamed", ref: nextRef, previousRef });
    return nextRef;
  }

  async delete(ref: NoteVaultRef, options: { trash?: boolean } = {}): Promise<void> {
    if (options.trash) {
      throw createNoteVaultError("unsupported-operation", "Trash is not supported", {
        ref,
        operation: "delete",
      });
    }
    const id = this.assertRef(ref);
    for (const entryId of [...this.entries.keys()]) {
      if (entryId === id || entryId.startsWith(`${id}/`)) this.entries.delete(entryId);
    }
    this.emit({ kind: "deleted", ref: { ...ref, id } });
  }

  watch(listener: (event: NoteVaultChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private childrenOf(parent: string): NoteVaultNode[] {
    const children = [...this.entries.entries()]
      .filter(([, entry]) => entry.parent === parent)
      .sort((a, b) => {
        if (a[1].kind !== b[1].kind) return a[1].kind === "folder" ? -1 : 1;
        return a[1].name.localeCompare(b[1].name);
      });

    return children.map(([id, entry]) => ({
      name: entry.name,
      kind: entry.kind,
      ref: this.ref(id, entry.kind),
      revision: String(entry.revision),
      displayPath: id,
      children: entry.kind === "folder" ? this.childrenOf(id) : undefined,
    }));
  }

  private assertRef(ref: NoteVaultRef, kind?: "file"): string;
  private assertRef(ref: NoteVaultRef, kind?: "folder"): string;
  private assertRef(ref: NoteVaultRef, kind?: "file" | "folder"): string {
    if (ref.providerId !== this.id) {
      throw createNoteVaultError("invalid-ref", `Wrong provider: ${ref.providerId}`, { ref });
    }
    const entry = this.entries.get(ref.id);
    if (!entry) throw createNoteVaultError("not-found", `Missing ref: ${ref.id}`, { ref });
    if (kind && entry.kind !== kind) {
      throw createNoteVaultError("invalid-ref", `Expected ${kind}`, { ref });
    }
    return ref.id;
  }

  private ref(id: string, kind: "file"): NoteVaultFileRef;
  private ref(id: string, kind: "folder"): NoteVaultFolderRef;
  private ref(id: string, kind: "file" | "folder"): AnyNoteVaultRef;
  private ref(id: string, kind: "file" | "folder"): AnyNoteVaultRef {
    const entry = this.entries.get(id);
    return {
      providerId: this.id,
      id,
      kind,
      name: entry?.name,
      displayPath: id,
      revision: entry ? String(entry.revision) : undefined,
    } as AnyNoteVaultRef;
  }

  private childId(parent: string, name: string): string {
    return parent === "/" ? `/${name}` : `${parent}/${name}`;
  }

  private emit(event: NoteVaultChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

describe("storage interface", () => {
  it("models list/read/write/create/rename/delete through a provider-neutral adapter", async () => {
    const adapter = new InMemoryNoteVaultAdapter();
    const folder = await adapter.createFolder(adapter.rootRef(), "Daily");
    const file = await adapter.createFile(folder, "today.md", "# Today");

    expect(file.id).toBe("/Daily/today.md");
    expect(file.displayPath).toBe("/Daily/today.md");

    const tree = await adapter.list();
    expect(tree[0].kind).toBe("folder");
    expect(tree[0].children?.[0].name).toBe("today.md");
    expect(flattenNoteVaultNodes(tree).map((ref) => ref.id)).toEqual(["/Daily", "/Daily/today.md"]);

    const before = await adapter.read(file);
    expect(before.content).toBe("# Today");

    const written = await adapter.write(file, "# Updated", { revision: before.revision });
    expect(written.revision).toBe("2");
    await expect(adapter.read(written.ref)).resolves.toMatchObject({ content: "# Updated" });

    const renamed = await adapter.rename(written.ref, "tomorrow.md");
    expect(renamed.id).toBe("/Daily/tomorrow.md");

    await adapter.delete(renamed);
    await expect(adapter.read(renamed)).rejects.toMatchObject({ code: "not-found" });
  });

  it("supports optional read-all helper built from list plus read", async () => {
    const adapter = new InMemoryNoteVaultAdapter();
    await adapter.createFile(adapter.rootRef(), "a.md", "A");
    const folder = await adapter.createFolder(adapter.rootRef(), "Nested");
    await adapter.createFile(folder, "b.md", "B");

    const files = await readAllNoteVaultFiles(adapter);

    expect(files.map((file) => [file.ref.id, file.content])).toEqual([
      ["/Nested/b.md", "B"],
      ["/a.md", "A"],
    ]);
  });

  it("uses an adapter batch readAll implementation when available", async () => {
    const adapter = new InMemoryNoteVaultAdapter() as InMemoryNoteVaultAdapter & {
      readAll: (options?: NoteVaultListOptions) => Promise<NoteVaultFile[]>;
    };
    const root = adapter.rootRef();
    const file = await adapter.createFile(root, "a.md", "A");
    const list = vi.spyOn(adapter, "list");
    const read = vi.spyOn(adapter, "read");
    adapter.readAll = vi.fn(async () => [{ ref: file, content: "batched" }]);

    const files = await readAllNoteVaultFiles(adapter, { root });

    expect(adapter.readAll).toHaveBeenCalledWith({ root, recursive: undefined });
    expect(list).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(files).toEqual([{ ref: file, content: "batched" }]);
  });

  it("falls back to bounded parallel reads when no batch reader is available", async () => {
    const files = Array.from({ length: 40 }, (_, index): NoteVaultFileRef => ({
      providerId: "parallel",
      id: `/note-${index}.md`,
      kind: "file",
    }));
    let activeReads = 0;
    let maxActiveReads = 0;
    const adapter: NoteVaultAdapter = {
      id: "parallel",
      label: "Parallel vault",
      capabilities: {},
      async list() {
        return files.map((ref) => ({
          ref,
          name: ref.id,
          kind: "file",
        }));
      },
      async read(ref) {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeReads -= 1;
        return { ref: ref as NoteVaultFileRef, content: ref.id };
      },
      async write(ref) {
        return { ref: ref as NoteVaultFileRef };
      },
      async createFile() {
        return files[0];
      },
      async createFolder() {
        return { providerId: "parallel", id: "/", kind: "folder" };
      },
      async rename(ref) {
        return ref as AnyNoteVaultRef;
      },
      async delete() {},
    };

    const result = await readAllNoteVaultFiles(adapter);

    expect(result).toHaveLength(files.length);
    expect(maxActiveReads).toBeGreaterThan(1);
    expect(maxActiveReads).toBeLessThanOrEqual(32);
  });

  it("reports typed conflicts for stale optimistic writes", async () => {
    const adapter = new InMemoryNoteVaultAdapter();
    const file = await adapter.createFile(adapter.rootRef(), "note.md", "first");
    const firstRead = await adapter.read(file);
    await adapter.write(file, "second", { revision: firstRead.revision });

    await expect(adapter.write(file, "third", { revision: firstRead.revision })).rejects.toMatchObject({
      name: "NoteVaultError",
      code: "conflict",
      operation: "write",
    });
  });

  it("exposes unsupported capabilities as typed errors", async () => {
    const adapter = new InMemoryNoteVaultAdapter();
    const file = await adapter.createFile(adapter.rootRef(), "note.md", "");

    expect(adapter.capabilities.trash).toBe(false);
    await expect(adapter.delete(file, { trash: true })).rejects.toMatchObject({
      code: "unsupported-operation",
      operation: "delete",
    });
  });

  it("lets hosts capability-gate unsupported watch and rename operations", async () => {
    const fileRef: NoteVaultFileRef = {
      providerId: "limited",
      id: "opaque-file-id",
      kind: "file",
    };
    const adapter: NoteVaultAdapter = {
      id: "limited",
      label: "Limited provider",
      capabilities: {
        watch: false,
        renameFile: false,
        renameFolder: false,
      },
      list: async () => [{ name: "note.md", kind: "file", ref: fileRef }],
      read: async () => ({ ref: fileRef, content: "" }),
      write: async () => ({ ref: fileRef }),
      createFile: async () => fileRef,
      createFolder: async () => {
        throw createNoteVaultError("unsupported-operation", "Folder creation is unsupported");
      },
      rename: async (ref) => {
        throw createNoteVaultError("unsupported-operation", "Rename is unsupported", {
          ref,
          operation: "rename",
        });
      },
      delete: async () => undefined,
    };

    expect(adapter.capabilities.watch).toBe(false);
    expect(adapter.watch).toBeUndefined();
    await expect(adapter.rename(fileRef, "next.md")).rejects.toMatchObject({
      code: "unsupported-operation",
      operation: "rename",
    });
  });

  it("delivers watch events until unsubscribed", async () => {
    const adapter = new InMemoryNoteVaultAdapter();
    const listener = vi.fn();
    const unsubscribe = adapter.watch(listener);

    await adapter.createFile(adapter.rootRef(), "watched.md", "");
    unsubscribe();
    await adapter.createFile(adapter.rootRef(), "quiet.md", "");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: "created" }));
  });

  it("provides a concrete error guard", () => {
    const err = createNoteVaultError("offline", "offline");

    expect(err).toBeInstanceOf(NoteVaultError);
    expect(isNoteVaultError(err)).toBe(true);
    expect(isNoteVaultError(new Error("x"))).toBe(false);
  });
});
