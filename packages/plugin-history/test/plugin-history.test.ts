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

  it("starts a new undo group per change when newGroupDelay is 0", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      // Without grouping (delay 0) each edit is its own undo step, so a single
      // undo only rolls back the most recent change rather than both.
      plugins: [createHistoryPlugin({ newGroupDelay: 0 })]
    });

    editor.setDocument("step one");
    editor.setDocument("step two");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("step one");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("start");

    editor.destroy();
  });
});
