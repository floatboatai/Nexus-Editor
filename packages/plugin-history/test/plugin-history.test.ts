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

  it("supports disabling time-based grouping for independent undo steps", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [createHistoryPlugin({ newGroupDelay: 0 })]
    });

    editor.replaceRange(0, 0, "a", { anchor: 1 });
    editor.replaceRange(1, 1, "b", { anchor: 2 });

    expect(editor.getDocument()).toBe("ab");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("");
    editor.destroy();
  });

  it("supports custom grouping predicates for non-adjacent edits", () => {
    const container = document.createElement("div");
    const adjacencyChecks: boolean[] = [];
    const editor = createEditor({
      container,
      initialValue: "ab",
      plugins: [
        createHistoryPlugin({
          joinToEvent(_transaction, isAdjacent) {
            adjacencyChecks.push(isAdjacent);
            return true;
          }
        })
      ]
    });

    editor.replaceRange(0, 0, "x", { anchor: 1 });
    editor.replaceRange(editor.getDocument().length, editor.getDocument().length, "y", { anchor: 4 });

    expect(editor.getDocument()).toBe("xaby");
    expect(adjacencyChecks).toContain(false);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ab");
    editor.destroy();
  });
});
