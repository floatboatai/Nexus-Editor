import { EditorView, ViewPlugin } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import {
  createHistoryPlugin,
  forceHistoryBoundary,
  notInHistory,
  withHistoryControl
} from "../src/index";

function captureViewPlugin(onView: (view: EditorView) => void) {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        onView(view);
      }
    }
  );
}

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

  it("accepts history grouping options without breaking undo/redo", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "a",
      plugins: [createHistoryPlugin({ newGroupDelay: 0, minDepth: 50 })]
    });

    editor.setDocument("b");
    editor.setDocument("c");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("b");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a");
    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toBe("b");
    editor.destroy();
  });

  it("notInHistory keeps a programmatic edit off the undo stack", () => {
    const container = document.createElement("div");
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "hello",
      plugins: [
        createHistoryPlugin(),
        {
          name: "capture-view",
          cmExtensions: [captureViewPlugin((view) => (capturedView = view))]
        }
      ]
    });

    expect(capturedView).not.toBeNull();
    const view = capturedView!;

    // User-visible edit — must remain undoable.
    view.dispatch({ changes: { from: 5, to: 5, insert: "!" } });
    expect(editor.getDocument()).toBe("hello!");

    // Host seeding that must not become its own undo step.
    view.dispatch(
      withHistoryControl({ changes: { from: 0, to: 1, insert: "H" } }, { addToHistory: false })
    );
    expect(editor.getDocument()).toBe("Hello!");

    // Undo reverts the "!" insertion; the not-in-history capitalisation stays.
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("Hello");
    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  it("forceHistoryBoundary prevents adjacent transactions from joining", () => {
    const container = document.createElement("div");
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "x",
      // Large delay would otherwise join the two edits below into one group.
      plugins: [
        createHistoryPlugin({ newGroupDelay: 60_000 }),
        {
          name: "capture-view",
          cmExtensions: [captureViewPlugin((view) => (capturedView = view))]
        }
      ]
    });

    expect(capturedView).not.toBeNull();
    const view = capturedView!;

    view.dispatch({
      changes: { from: 0, to: 1, insert: "y" },
      userEvent: "input.type"
    });
    view.dispatch({
      changes: { from: 0, to: 1, insert: "z" },
      userEvent: "input.type",
      annotations: forceHistoryBoundary("before")
    });

    expect(editor.getDocument()).toBe("z");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("y");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("x");
    editor.destroy();
  });

  it("withHistoryControl preserves pre-existing annotations", () => {
    const marker = notInHistory;
    const spec = withHistoryControl(
      { changes: { from: 0, to: 0, insert: "a" }, annotations: marker },
      { isolate: "after" }
    );
    const annotations = Array.isArray(spec.annotations)
      ? spec.annotations
      : [spec.annotations];
    expect(annotations).toHaveLength(2);
    expect(annotations.some((a) => a === marker)).toBe(true);
    expect(annotations.some((a) => a != null && a.value === "after")).toBe(true);
  });

  it("exposes notInHistory as Transaction.addToHistory(false)", () => {
    expect(notInHistory.value).toBe(false);
  });
});
