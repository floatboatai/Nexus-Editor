import { describe, expect, it } from "vitest";
import {
  addSnapshot,
  createEmptySnapshotStore,
  createSnapshotEntry,
  listSnapshots,
  normalizeDocKey,
  parseSnapshotStore,
  summarizeSnapshot,
} from "../electron/snapshots";

describe("snapshot helpers", () => {
  it("normalizes null file paths to the untitled document scope", () => {
    expect(normalizeDocKey(null)).toBe("untitled");
    expect(normalizeDocKey("C:\\vault\\note.md")).toBe("C:/vault/note.md");
  });

  it("summarizes the first non-empty line", () => {
    expect(summarizeSnapshot("\n\n# Heading\nbody")).toBe("# Heading");
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

  it("falls back to an empty store on corrupt persisted data", () => {
    expect(parseSnapshotStore("{not-json")).toEqual(createEmptySnapshotStore());
  });
});
