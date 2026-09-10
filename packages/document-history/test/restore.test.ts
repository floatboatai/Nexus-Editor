import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkpointDocument,
  MemoryDocumentVersionStore,
  restoreDocumentVersion,
  type DocumentVersionStore,
} from "../src/index";

const editors: EditorAPI[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(markdown = "current unsaved", options: { readOnly?: boolean; history?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const editor = createEditor({
    container, initialValue: markdown, readOnly: options.readOnly,
    plugins: options.history === false ? [] : [createHistoryPlugin()],
  });
  editors.push(editor);
  const revision = editor.getDocumentRevision?.();
  if (!revision) throw new Error("Expected revision support");
  return { editor, revision };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function historicalStore() {
  const store = new MemoryDocumentVersionStore();
  const target = await store.append("A", { markdown: "historical content", reason: "saved" });
  if (target.status !== "appended") throw new Error("Expected history version");
  return { store, versionId: target.version.id };
}

describe("document history editor adapters", () => {
  it("checkpoints actual editor content and never writes or changes the buffer", async () => {
    const { editor } = setup();
    editor.replaceRange(0, editor.getDocument().length, "latest input");
    const store = new MemoryDocumentVersionStore();
    const result = await checkpointDocument(editor, store, { documentKey: "A", reason: "saved", expectedHead: null });
    expect(result).toMatchObject({ status: "appended", version: { markdown: "latest input", reason: "saved" } });
    expect(editor.getDocument()).toBe("latest input");
  });

  it("checkpoints before restoration and preserves a standalone undo entry", async () => {
    const { editor, revision } = setup();
    const { store, versionId } = await historicalStore();
    const result = await restoreDocumentVersion(editor, store, { documentKey: "A", versionId, expectedRevision: revision });
    expect(result).toMatchObject({ status: "applied" });
    expect(editor.getDocument()).toBe("historical content");
    expect(store.exportSnapshot().versions.at(-1)).toMatchObject({ markdown: "current unsaved", reason: "before-restore", id: result.checkpointId });
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("current unsaved");
    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toBe("historical content");
  });

  it("rejects a changed revision during an asynchronous history read", async () => {
    const { editor, revision } = setup();
    const { store, versionId } = await historicalStore();
    const gate = deferred<void>();
    const read = store.read.bind(store);
    vi.spyOn(store, "read").mockImplementation(async (...args) => { await gate.promise; return read(...args); });
    const pending = restoreDocumentVersion(editor, store, { documentKey: "A", versionId, expectedRevision: revision });
    editor.replaceRange(0, editor.getDocument().length, "newer user input");
    gate.resolve();
    expect(await pending).toMatchObject({ status: "conflict" });
    expect(editor.getDocument()).toBe("newer user input");
    expect(store.exportSnapshot().versions).toHaveLength(1);
  });

  it("does not overwrite edits made while the recovery checkpoint is persisted", async () => {
    const { editor, revision } = setup();
    const { store, versionId } = await historicalStore();
    const entered = deferred<void>(), gate = deferred<void>();
    const append = store.append.bind(store);
    vi.spyOn(store, "append").mockImplementation(async (...args) => { entered.resolve(); await gate.promise; return append(...args); });
    const pending = restoreDocumentVersion(editor, store, { documentKey: "A", versionId, expectedRevision: revision });
    await entered.promise;
    editor.replaceRange(0, editor.getDocument().length, "typed during save");
    gate.resolve();
    expect(await pending).toMatchObject({ status: "conflict", checkpointId: expect.any(String) });
    expect(editor.getDocument()).toBe("typed during save");
    expect(store.exportSnapshot().versions.at(-1)?.markdown).toBe("current unsaved");
  });

  it("binds document identity and revision before caller-owned options can change", async () => {
    const { editor, revision } = setup();
    const { store, versionId } = await historicalStore();
    const gate = deferred<void>();
    const read = store.read.bind(store);
    vi.spyOn(store, "read").mockImplementation(async (...args) => { await gate.promise; return read(...args); });
    const options = { documentKey: "A", versionId, expectedRevision: revision };
    const pending = restoreDocumentVersion(editor, store, options);
    options.documentKey = "B";
    options.versionId = "different";
    gate.resolve();
    expect(await pending).toMatchObject({ status: "applied" });
    expect((await store.list("B")).items).toHaveLength(0);
    expect(store.exportSnapshot().versions.at(-1)?.documentKey).toBe("A");
  });

  it("honors read-only, missing history, unsupported old APIs, and unchanged content", async () => {
    const { store, versionId } = await historicalStore();
    const readonly = setup("read only", { readOnly: true });
    expect(await restoreDocumentVersion(readonly.editor, store, { documentKey: "A", versionId, expectedRevision: readonly.revision })).toMatchObject({ status: "read-only" });
    const noUndo = setup("no undo", { history: false });
    expect(await restoreDocumentVersion(noUndo.editor, store, { documentKey: "A", versionId, expectedRevision: noUndo.revision })).toMatchObject({ status: "history-unavailable" });
    const old = setup();
    old.editor.restoreDocumentBuffer = undefined;
    expect(await restoreDocumentVersion(old.editor, store, { documentKey: "A", versionId, expectedRevision: old.revision })).toEqual({ status: "unsupported" });
    const identical = setup("historical content");
    const count = store.exportSnapshot().versions.length;
    expect(await restoreDocumentVersion(identical.editor, store, { documentKey: "A", versionId, expectedRevision: identical.revision })).toMatchObject({ status: "unchanged" });
    expect(store.exportSnapshot().versions).toHaveLength(count);
  });

  it("does not restore when checkpoint storage fails or races another history append", async () => {
    const { editor, revision } = setup();
    const { store, versionId } = await historicalStore();
    const append = vi.spyOn(store, "append").mockRejectedValueOnce(new Error("Disk full"));
    await expect(restoreDocumentVersion(editor, store, { documentKey: "A", versionId, expectedRevision: revision })).rejects.toThrow("Disk full");
    expect(editor.getDocument()).toBe("current unsaved");
    append.mockResolvedValueOnce({ status: "conflict", currentHead: "new-head" });
    expect(await restoreDocumentVersion(editor, store, { documentKey: "A", versionId, expectedRevision: revision })).toEqual({ status: "store-conflict" });
    expect(editor.getDocument()).toBe("current unsaved");
  });

  it("returns cancellation promptly for a slow provider and observes its late failure", async () => {
    const { editor, revision } = setup();
    const { store, versionId } = await historicalStore();
    const controller = new AbortController();
    const gate = deferred<Awaited<ReturnType<DocumentVersionStore["read"]>>>();
    vi.spyOn(store, "read").mockReturnValue(gate.promise);
    const pending = restoreDocumentVersion(editor, store, { documentKey: "A", versionId, expectedRevision: revision, signal: controller.signal });
    const aborted = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await aborted;
    gate.reject(new Error("Late provider failure"));
    await Promise.resolve();
    expect(editor.getDocument()).toBe("current unsaved");
  });

  it("rejects an invalid checkpoint acknowledgement instead of restoring without recovery content", async () => {
    const { editor, revision } = setup();
    const { store, versionId } = await historicalStore();
    vi.spyOn(store, "append").mockResolvedValue({ status: "appended", version: {
      id: "wrong-checkpoint", documentKey: "B", markdown: "different", createdAt: 1, reason: "before-restore",
    } });
    await expect(restoreDocumentVersion(editor, store, { documentKey: "A", versionId, expectedRevision: revision })).rejects.toMatchObject({ code: "invalid-store-result" });
    expect(editor.getDocument()).toBe("current unsaved");
  });

  it("honors editor destruction and verifies the store's document identity", async () => {
    const { editor, revision } = setup();
    const { store, versionId } = await historicalStore();
    const read = vi.spyOn(store, "read").mockResolvedValueOnce({ id: versionId, documentKey: "B", createdAt: 1, markdown: "wrong", reason: "saved" });
    await expect(restoreDocumentVersion(editor, store, { documentKey: "A", versionId, expectedRevision: revision })).rejects.toMatchObject({ code: "invalid-store-result" });
    read.mockRestore();
    editor.destroy();
    await expect(restoreDocumentVersion(editor, store, { documentKey: "A", versionId, expectedRevision: revision })).rejects.toMatchObject({ name: "AbortError" });
  });
});
