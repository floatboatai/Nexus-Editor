import { describe, expect, it, vi } from "vitest";

import { createEditor } from "../src/index";

describe("multi-cursor support", () => {
  it("getSelections returns all cursor ranges", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "hello world",
    });

    editor.addCursor(5);
    const selections = editor.getSelections();
    expect(selections.length).toBe(2);
    editor.destroy();
  });

  it("addCursor adds a cursor without disturbing existing ones", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "abcdef",
    });

    editor.setSelection(2);
    editor.addCursor(4);
    const selections = editor.getSelections();
    expect(selections).toEqual([
      { anchor: 2, head: 2 },
      { anchor: 4, head: 4 },
    ]);
    editor.destroy();
  });

  it("selectionChange event includes ranges array", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({
      container,
      initialValue: "hello world",
    });

    editor.on("selectionChange", handler);
    editor.setSelection(3);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: 3,
        head: 3,
        ranges: [{ anchor: 3, head: 3 }],
      })
    );
    editor.destroy();
  });

  it("selectionChange reports multiple ranges after addCursor", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({
      container,
      initialValue: "hello world",
    });

    editor.on("selectionChange", handler);
    editor.addCursor(5);
    const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(lastCall.ranges.length).toBe(2);
    editor.destroy();
  });

  it("replaceSelection operates on all cursors", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "aa bb aa",
    });

    editor.setSelection(0, 2);
    editor.addCursor(6);
    editor.replaceSelection("X");
    const doc = editor.getDocument();
    expect(doc).toContain("X");
    editor.destroy();
  });

  it("setSelection still works as single-cursor API", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "hello",
    });

    editor.addCursor(3);
    expect(editor.getSelections().length).toBe(2);

    editor.setSelection(1);
    expect(editor.getSelections().length).toBe(1);
    expect(editor.getSelection()).toEqual({ anchor: 1, head: 1 });
    editor.destroy();
  });

  it("getSelection returns the main range even with multiple cursors", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "abcdef",
    });

    editor.setSelection(2);
    editor.addCursor(4);
    const main = editor.getSelection();
    expect(main).toEqual({ anchor: 2, head: 2 });
    editor.destroy();
  });
});
