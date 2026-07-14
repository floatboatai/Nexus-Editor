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

  it("groups multiple changes into a single undo step with groupChanges", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "hello world",
      plugins: [createHistoryPlugin()]
    });

    // Group two changes together
    editor.groupChanges(() => {
      editor.replaceRange(0, 5, "hey");
      // After first replace: "hey world" (length 9)
      editor.replaceRange(4, 9, "earth");
    });
    expect(editor.getDocument()).toBe("hey earth");

    // One undo should revert the entire group back to initial
    editor.undo();
    expect(editor.getDocument()).toBe("hello world");

    // Redo should restore the grouped result
    editor.redo();
    expect(editor.getDocument()).toBe("hey earth");

    editor.destroy();
  });

  it("accepts newGroupDelay option", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "test",
      plugins: [createHistoryPlugin({ newGroupDelay: 100 })]
    });

    editor.setDocument("modified");
    editor.undo();
    expect(editor.getDocument()).toBe("test");
    editor.destroy();
  });
});
