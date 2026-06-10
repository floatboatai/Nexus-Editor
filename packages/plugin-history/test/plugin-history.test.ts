import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin, groupChange, isHistoryEnabled } from "../src/index";

describe("@floatboat/nexus-plugin-history — basic undo/redo", () => {
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

  it("undoes and redoes through the programmatic API", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "initial",
      plugins: [createHistoryPlugin()]
    });

    expect(editor.undo()).toBe(false); // Nothing to undo yet

    editor.setDocument("version 1");
    expect(editor.getDocument()).toBe("version 1");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("initial");

    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toBe("version 1");

    editor.destroy();
  });
});

describe("@floatboat/nexus-plugin-history — canUndo / canRedo", () => {
  it("returns false for canUndo and canRedo on a fresh document", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "fresh",
      plugins: [createHistoryPlugin()]
    });

    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);

    editor.destroy();
  });

  it("returns true for canUndo after a document change", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "base",
      plugins: [createHistoryPlugin()]
    });

    expect(editor.canUndo()).toBe(false);

    editor.setDocument("modified");
    expect(editor.canUndo()).toBe(true);

    editor.destroy();
  });

  it("returns true for canRedo after an undo", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "base",
      plugins: [createHistoryPlugin()]
    });

    editor.setDocument("modified");
    editor.undo();

    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(true);

    editor.destroy();
  });

  it("toggles canUndo/canRedo through basic edit cycles", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [createHistoryPlugin()]
    });

    // Initially nothing to undo or redo
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);

    // Edit: can undo but not redo
    editor.replaceSelection("hello");
    expect(editor.canUndo()).toBe(true);
    expect(editor.canRedo()).toBe(false);

    // Undo just performed: can redo again
    expect(editor.undo()).toBe(true);
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(true);

    // Redo: back to previous
    expect(editor.redo()).toBe(true);
    expect(editor.canUndo()).toBe(true);
    expect(editor.canRedo()).toBe(false);

    editor.destroy();
  });

  it("returns false for canUndo and canRedo after destroy", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "data",
      plugins: [createHistoryPlugin()]
    });

    editor.setDocument("changed");
    editor.destroy();

    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
  });

  it("works with replaceSelection tracking", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [createHistoryPlugin()]
    });

    expect(editor.canUndo()).toBe(false);

    editor.replaceSelection("hello");
    expect(editor.canUndo()).toBe(true);

    editor.undo();
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(true);

    editor.redo();
    expect(editor.canUndo()).toBe(true);
    expect(editor.canRedo()).toBe(false);

    editor.destroy();
  });
});

describe("@floatboat/nexus-plugin-history — groupChange", () => {
  it("executes the callback and applies all changes", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [createHistoryPlugin()]
    });

    groupChange(editor, () => {
      editor.replaceSelection("Hello ");
      editor.replaceSelection("World");
    });

    expect(editor.getDocument()).toBe("Hello World");
    editor.destroy();
  });

  it("does not create an undo step when no changes occur in the callback", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "unchanged",
      plugins: [createHistoryPlugin()]
    });

    groupChange(editor, () => {
      // No changes made
    });

    expect(editor.getDocument()).toBe("unchanged");
    expect(editor.canUndo()).toBe(false);

    editor.destroy();
  });

  it("preserves the final document state after grouping", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()]
    });

    groupChange(editor, () => {
      editor.replaceSelection("middle ");
      editor.setDocument("final");
    });

    expect(editor.getDocument()).toBe("final");

    // Undoing should revert to "start"
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("start");

    editor.destroy();
  });
});

describe("@floatboat/nexus-plugin-history — isHistoryEnabled", () => {
  it("returns true when the history plugin is installed", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "test",
      plugins: [createHistoryPlugin()]
    });

    expect(isHistoryEnabled(editor)).toBe(true);

    editor.destroy();
  });

  it("returns false when no history plugin is installed", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "test",
    });

    expect(isHistoryEnabled(editor)).toBe(false);

    editor.destroy();
  });

  it("does not modify the document after probing", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "original content",
      plugins: [createHistoryPlugin()]
    });

    const before = editor.getDocument();
    isHistoryEnabled(editor);
    expect(editor.getDocument()).toBe(before);

    editor.destroy();
  });
});

describe("@floatboat/nexus-plugin-history — configuration", () => {
  it("accepts minDepth configuration", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "a",
      plugins: [createHistoryPlugin({ minDepth: 10 })]
    });

    // Basic functionality should work
    editor.setDocument("b");
    expect(editor.canUndo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a");

    editor.destroy();
  });

  it("accepts newGroupDelay configuration", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "a",
      plugins: [createHistoryPlugin({ newGroupDelay: 200 })]
    });

    // Basic functionality should work
    editor.setDocument("b");
    expect(editor.canUndo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a");

    editor.destroy();
  });
});
