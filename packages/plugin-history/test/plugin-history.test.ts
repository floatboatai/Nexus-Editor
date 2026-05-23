import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin } from "../src/index";

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

  describe("undoDepth / redoDepth", () => {
    it("reports zero depths on a fresh editor", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "hello",
        plugins: [createHistoryPlugin()]
      });

      expect(editor.undoDepth()).toBe(0);
      expect(editor.redoDepth()).toBe(0);
      editor.destroy();
    });

    it("increments undoDepth after a change", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "hello",
        plugins: [createHistoryPlugin()]
      });

      editor.setDocument("world");
      expect(editor.undoDepth()).toBeGreaterThan(0);
      expect(editor.redoDepth()).toBe(0);
      editor.destroy();
    });

    it("increments redoDepth after an undo", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "hello",
        plugins: [createHistoryPlugin()]
      });

      editor.setDocument("world");
      editor.undo();
      expect(editor.getDocument()).toBe("hello");
      expect(editor.redoDepth()).toBeGreaterThan(0);
      editor.destroy();
    });
  });

  describe("groupChanges", () => {
    it("groups multiple changes into a single undo step", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "start",
        plugins: [createHistoryPlugin()]
      });

      editor.groupChanges(() => {
        editor.setDocument("step1");
        editor.setDocument("step2");
        editor.setDocument("step3");
      });

      expect(editor.getDocument()).toBe("step3");

      editor.undo();
      expect(editor.getDocument()).toBe("start");
      editor.destroy();
    });

    it("isolates grouped changes from preceding changes", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "original",
        plugins: [createHistoryPlugin()]
      });

      editor.setDocument("before-group");

      editor.groupChanges(() => {
        editor.setDocument("inside-group");
      });

      // First undo reverts the group
      editor.undo();
      expect(editor.getDocument()).toBe("before-group");

      // Second undo reverts the pre-group change
      editor.undo();
      expect(editor.getDocument()).toBe("original");
      editor.destroy();
    });

    it("isolates grouped changes from subsequent changes", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "original",
        plugins: [createHistoryPlugin()]
      });

      editor.groupChanges(() => {
        editor.setDocument("grouped");
      });

      editor.setDocument("after-group");

      // Undo the post-group change
      editor.undo();
      expect(editor.getDocument()).toBe("grouped");

      // Undo the group
      editor.undo();
      expect(editor.getDocument()).toBe("original");
      editor.destroy();
    });

    it("does not create a history entry when no changes are made inside", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "unchanged",
        plugins: [createHistoryPlugin()]
      });

      const depthBefore = editor.undoDepth();
      editor.groupChanges(() => {
        // no-op
      });
      expect(editor.undoDepth()).toBe(depthBefore);
      editor.destroy();
    });
  });

  describe("backward compatibility", () => {
    it("works without options (default behavior)", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "a",
        plugins: [createHistoryPlugin()]
      });

      editor.setDocument("b");
      editor.undo();
      expect(editor.getDocument()).toBe("a");
      editor.destroy();
    });

    it("accepts custom minDepth and newGroupDelay", () => {
      const container = document.createElement("div");
      const editor = createEditor({
        container,
        initialValue: "a",
        plugins: [createHistoryPlugin({ minDepth: 50, newGroupDelay: 200 })]
      });

      editor.setDocument("b");
      editor.undo();
      expect(editor.getDocument()).toBe("a");
      editor.destroy();
    });
  });
});
