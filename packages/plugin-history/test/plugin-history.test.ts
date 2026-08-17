import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin, SnapshotManager } from "../src/index";

describe("@floatboat/nexus-plugin-history", () => {
  it("undoes the most recent document change through codemirror key handling", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()]
    });

    const content = container.querySelector("[contenteditable='true']");

    editor.setDocument("next");

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );

    expect(editor.getDocument()).toBe("start");
    editor.destroy();
  });

  it("redoes an undone change through codemirror key handling", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()]
    });

    const content = container.querySelector("[contenteditable='true']");

    editor.setDocument("next");

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );

    expect(editor.getDocument()).toBe("next");
    editor.destroy();
  });

  describe("SnapshotManager", () => {
    it("saves and restores document snapshots", () => {
      const manager = new SnapshotManager();
      const content = "Hello, World!";

      const snapshot = manager.saveSnapshot(content);

      expect(snapshot.content).toBe(content);
      expect(snapshot.id).toBeDefined();
      expect(snapshot.timestamp).toBeDefined();

      const restored = manager.restoreSnapshot(snapshot.id);
      expect(restored).toBe(content);
    });

    it("supports optional labels for snapshots", () => {
      const manager = new SnapshotManager();
      const label = "Important Version";

      const snapshot = manager.saveSnapshot("content", label);

      expect(snapshot.label).toBe(label);
      expect(manager.getSnapshot(snapshot.id)?.label).toBe(label);
    });

    it("lists snapshots sorted by timestamp descending", async () => {
      const manager = new SnapshotManager();

      const snap1 = manager.saveSnapshot("content1");
      // Wait a bit to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      const snap2 = manager.saveSnapshot("content2");
      await new Promise(resolve => setTimeout(resolve, 10));
      const snap3 = manager.saveSnapshot("content3");

      const list = manager.listSnapshots();

      expect(list).toHaveLength(3);
      // Verify that more recent snapshots come first
      expect(list[0].timestamp).toBeGreaterThanOrEqual(list[1].timestamp);
      expect(list[1].timestamp).toBeGreaterThanOrEqual(list[2].timestamp);
      // Verify all three snapshots are present
      const ids = list.map(s => s.id);
      expect(ids).toContain(snap1.id);
      expect(ids).toContain(snap2.id);
      expect(ids).toContain(snap3.id);
    });

    it("deletes snapshots by ID", () => {
      const manager = new SnapshotManager();
      const snapshot = manager.saveSnapshot("content");

      expect(manager.getSnapshot(snapshot.id)).toBeDefined();
      expect(manager.deleteSnapshot(snapshot.id)).toBe(true);
      expect(manager.getSnapshot(snapshot.id)).toBeNull();
      expect(manager.deleteSnapshot(snapshot.id)).toBe(false);
    });

    it("enforces maximum snapshot limit", async () => {
      const manager = new SnapshotManager({ maxSnapshots: 5 });

      const createdSnapshots = [];
      for (let i = 0; i < 10; i++) {
        createdSnapshots.push(manager.saveSnapshot(`content-${i}`));
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      expect(manager.getSnapshotCount()).toBe(5);
      
      // Verify that the 5 most recent snapshots are kept
      const list = manager.listSnapshots();
      const contents = list.map(s => s.content);
      // The 5 newest should be content-9, 8, 7, 6, 5
      expect(contents.length).toBe(5);
      expect(contents.some(c => c === "content-9")).toBe(true);
      expect(contents.some(c => c === "content-5")).toBe(true);
      // The 5 oldest (content-0 to content-4) should be removed
      expect(contents.some(c => c === "content-0")).toBe(false);
      expect(contents.some(c => c === "content-4")).toBe(false);
    });

    it("clears all snapshots", () => {
      const manager = new SnapshotManager();
      manager.saveSnapshot("content1");
      manager.saveSnapshot("content2");

      expect(manager.getSnapshotCount()).toBeGreaterThan(0);

      manager.clearAllSnapshots();

      expect(manager.getSnapshotCount()).toBe(0);
      expect(manager.listSnapshots()).toHaveLength(0);
    });

    it("exports and imports snapshots", () => {
      const manager1 = new SnapshotManager();
      manager1.saveSnapshot("content1", "snap1");
      manager1.saveSnapshot("content2", "snap2");

      const exported = manager1.exportSnapshots();

      const manager2 = new SnapshotManager();
      manager2.importSnapshots(exported);

      expect(manager2.getSnapshotCount()).toBe(2);
      const labels = manager2.listSnapshots().map(s => s.label).filter(Boolean);
      expect(labels).toContain("snap1");
      expect(labels).toContain("snap2");
    });

    it("returns null for non-existent snapshot", () => {
      const manager = new SnapshotManager();
      expect(manager.restoreSnapshot("non-existent")).toBeNull();
      expect(manager.getSnapshot("non-existent")).toBeNull();
    });

    it("generates unique snapshot IDs", () => {
      const manager = new SnapshotManager();
      const snap1 = manager.saveSnapshot("content1");
      const snap2 = manager.saveSnapshot("content2");

      expect(snap1.id).not.toBe(snap2.id);
    });
  });
});
