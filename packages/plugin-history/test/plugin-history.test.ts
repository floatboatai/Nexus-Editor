import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin } from "../src/index";

describe("@floatboat/nexus-plugin-history", () => {
  it("undoes a recorded replacement through codemirror key handling", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()]
    });

    const content = container.querySelector("[contenteditable='true']");

    editor.setDocument("next", { history: "record" });

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

    editor.setDocument("next", { history: "record" });

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    expect(editor.getDocument()).toBe("start");

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

  // A file load must never become an undo step: undoing it would erase the
  // opened document or restore the previously open file into the buffer.
  it("does not undo a programmatic document load", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "previous document",
      plugins: [createHistoryPlugin()]
    });

    editor.setDocument("opened file", { history: "reset" });

    expect(editor.undo()).toBe(false);
    expect(editor.getDocument()).toBe("opened file");
    editor.destroy();
  });

  it("keeps undo history isolated to the document loaded last", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "document A",
      plugins: [createHistoryPlugin()]
    });

    editor.setDocument("document A edited", { history: "record" });
    editor.setDocument("document B", { history: "reset" });
    editor.setDocument("document B edited", { history: "record" });

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("document B");
    expect(editor.undo()).toBe(false);
    expect(editor.getDocument()).toBe("document B");
    editor.destroy();
  });
});
