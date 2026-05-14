import { describe, expect, it } from "vitest";
import {
  addSnapshot,
  assertSnapshotContentSize,
  createSnapshotDocumentRef,
  createEmptySnapshotStore,
  createSnapshotEntry,
  DEFAULT_SNAPSHOT_CONTENT_BYTES,
  listSnapshots,
  normalizeDocKey,
  parseSnapshotStore,
  summarizeSnapshot,
} from "../electron/snapshots";

describe("snapshot helpers", () => {
  it("normalizes null file paths to the untitled document scope", () => {
    expect(normalizeDocKey(null)).toBe("untitled");
    expect(normalizeDocKey("C:\\vault\\note.md")).toContain("vault");
  });

  it("derives a document ref from the file path boundary", () => {
    expect(createSnapshotDocumentRef(null)).toEqual({
      documentId: "untitled",
      filePath: null,
    });
    expect(createSnapshotDocumentRef("/tmp/a.md").filePath).toBe("/tmp/a.md");
  });

  it("prefers the first non-heading line in the summary", () => {
    expect(summarizeSnapshot("\n\n# Heading\nbody")).toBe("body");
    expect(summarizeSnapshot("\n\n# Heading")).toBe("# Heading");
    expect(summarizeSnapshot("")).toBe("(empty document)");
  });

  it("adds newest snapshots first and enforces retention", () => {
    const store = createEmptySnapshotStore();
    const first = createSnapshotEntry({
      docKey: "doc-a",
      filePath: "/tmp/a.md",
      content: "# One",
      createdAt: "2026-05-13T10:00:00.000Z",
    });
    const second = createSnapshotEntry({
      docKey: "doc-a",
      filePath: "/tmp/a.md",
      content: "# Two",
      createdAt: "2026-05-13T11:00:00.000Z",
    });

    const withFirst = addSnapshot(store, first, 1);
    const withSecond = addSnapshot(withFirst, second, 1);

    const items = listSnapshots(withSecond, "doc-a");
    expect(items).toHaveLength(1);
    expect(items[0].summary).toBe("# Two");
  });

  it("rejects snapshot content above the byte cap", () => {
    expect(() => {
      assertSnapshotContentSize("a".repeat(DEFAULT_SNAPSHOT_CONTENT_BYTES + 1));
    }).toThrow(/exceeds/i);
  });

  it("throws on corrupt persisted data", () => {
    expect(() => parseSnapshotStore("{not-json")).toThrow();
  });
});
