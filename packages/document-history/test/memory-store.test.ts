// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DocumentHistoryError, MemoryDocumentVersionStore } from "../src/index";

describe("MemoryDocumentVersionStore", () => {
  it("stores immutable content independently of document keys and returns metadata pages", async () => {
    const store = new MemoryDocumentVersionStore({ now: () => 123 });
    const first = await store.append("A", { markdown: "one", label: "First" }, { expectedHead: null });
    const second = await store.append("A", { markdown: "two", reason: "saved" });
    await store.append("B", { markdown: "different" });
    if (first.status !== "appended" || second.status !== "appended") throw new Error("Expected appends");
    expect(await store.read("B", first.version.id)).toBeNull();
    expect(Object.isFrozen(first.version)).toBe(true);
    const page = await store.list("A", { limit: 1 });
    expect(page).toEqual({ items: [{ id: second.version.id, documentKey: "A", createdAt: 123, reason: "saved" }], cursor: second.version.id, head: second.version.id });
    expect((await store.list("A", { cursor: page.cursor ?? undefined })).items).toEqual([
      { id: first.version.id, documentKey: "A", createdAt: 123, reason: "checkpoint", label: "First" },
    ]);
  });

  it("allows only one concurrent append against the same expected head", async () => {
    const store = new MemoryDocumentVersionStore();
    const results = await Promise.all([
      store.append("A", { markdown: "one" }, { expectedHead: null }),
      store.append("A", { markdown: "two" }, { expectedHead: null }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["appended", "conflict"]);
    expect((await store.list("A")).items).toHaveLength(1);
  });

  it("does not skip or repeat older records if an append occurs during pagination", async () => {
    const store = new MemoryDocumentVersionStore();
    const first = await store.append("A", { markdown: "one" });
    await store.append("A", { markdown: "two" });
    const page = await store.list("A", { limit: 1 });
    await store.append("A", { markdown: "three" });
    const older = await store.list("A", { cursor: page.cursor ?? undefined });
    expect(older.items.map((item) => item.id)).toEqual(first.status === "appended" ? [first.version.id] : []);
  });

  it("rejects quotas without deleting the latest checkpoint", async () => {
    const store = new MemoryDocumentVersionStore({ maxVersionsPerDocument: 1 });
    const saved = await store.append("A", { markdown: "unsaved input", reason: "before-restore" });
    await expect(store.append("A", { markdown: "new" })).rejects.toMatchObject({ code: "quota-exceeded" });
    expect(store.exportSnapshot().versions).toEqual(saved.status === "appended" ? [saved.version] : []);
    const bytes = new MemoryDocumentVersionStore({ maxBytesPerDocument: 128, maxTotalBytes: 200 });
    await expect(bytes.append("A", { markdown: "🙂".repeat(100) })).rejects.toMatchObject({ code: "quota-exceeded" });
    expect((await bytes.list("A")).items).toHaveLength(0);
    const documents = new MemoryDocumentVersionStore({ maxDocuments: 1 });
    await documents.append("A", { markdown: "one" });
    await expect(documents.append("B", { markdown: "two" })).rejects.toMatchObject({ code: "quota-exceeded" });
  });

  it("round-trips a JSON snapshot without exposing mutable records or reusing IDs", async () => {
    const original = new MemoryDocumentVersionStore();
    await original.append("A", { markdown: "中文\n", reason: "saved" });
    const encoded = JSON.stringify(original.exportSnapshot());
    const restored = new MemoryDocumentVersionStore({ snapshot: JSON.parse(encoded) });
    expect(restored.exportSnapshot()).toEqual(original.exportSnapshot());
    await restored.append("A", { markdown: "next" });
    const records = restored.exportSnapshot().versions;
    expect(new Set(records.map((record) => record.id)).size).toBe(2);
    expect(original.exportSnapshot().versions).toHaveLength(1);
  });

  it("rejects unknown schemas, invalid fields, duplicate IDs and oversized recovery", async () => {
    expect(() => new MemoryDocumentVersionStore({ snapshot: { schemaVersion: 2, versions: [] } })).toThrow(DocumentHistoryError);
    const store = new MemoryDocumentVersionStore();
    await store.append("A", { markdown: "one" });
    const record = store.exportSnapshot().versions[0];
    for (const versions of [[record, record], [{ ...record, createdAt: NaN }], [{ ...record, reason: "other" }]]) {
      expect(() => new MemoryDocumentVersionStore({ snapshot: { schemaVersion: 1, versions } })).toThrow(DocumentHistoryError);
    }
    expect(() => new MemoryDocumentVersionStore({ maxBytesPerDocument: 1, snapshot: store.exportSnapshot() })).toThrow(DocumentHistoryError);
    await expect(store.list("A", { cursor: "missing" })).rejects.toThrow(RangeError);
    await expect(store.list("A", { limit: 1001 })).rejects.toThrow(RangeError);
  });

  it("honors pre-aborted operations without mutating history", async () => {
    const store = new MemoryDocumentVersionStore();
    const signal = AbortSignal.abort();
    await expect(store.append("A", { markdown: "one" }, { signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(store.list("A", { signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(store.read("A", "version-1", { signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(store.exportSnapshot().versions).toHaveLength(0);
  });
});
