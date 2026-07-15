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
});



describe("@floatboat/nexus-plugin-history — options", () => {

  it("newGroupDelay groups rapid edits into one undo step", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [createHistoryPlugin({ newGroupDelay: 100_000 })],
    });

    editor.setDocument("hello world");
    editor.setDocument("hello world!");

    // Both changes should be in one undo group
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });

  it("default options behave identically to the original plugin", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });

    editor.setDocument("end");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("start");
    editor.destroy();
  });
});
