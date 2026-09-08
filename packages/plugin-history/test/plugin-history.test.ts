import { createEditor } from "@floatboat/nexus-core";
import { isolateHistory } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  createHistoryPlugin,
  runInHistoryGroup,
  withIsolatedHistory
} from "../src/index";

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

  it("accepts history options without changing default undo", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin({ newGroupDelay: 50, minDepth: 20 })]
    });

    editor.setDocument("next");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("start");
    editor.destroy();
  });

  it("withIsolatedHistory attaches isolateHistory annotation", () => {
    const spec = withIsolatedHistory(
      { changes: { from: 0, to: 0, insert: "x" } },
      "before"
    );
    const annotations = Array.isArray(spec.annotations)
      ? spec.annotations
      : spec.annotations
        ? [spec.annotations]
        : [];
    expect(annotations.some((a) => a.type === isolateHistory && a.value === "before")).toBe(
      true
    );
  });

  it("runInHistoryGroup isolates grouped edits from surrounding history", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "base",
      plugins: [createHistoryPlugin({ newGroupDelay: 10_000 })]
    });

    const view = EditorView.findFromDOM(container);
    expect(view).toBeTruthy();
    if (!view) return;

    view.dispatch({
      changes: { from: 4, insert: "A" },
      userEvent: "input.type"
    });

    runInHistoryGroup(view, (v) => {
      v.dispatch({
        changes: { from: 5, insert: "B" },
        userEvent: "input.type"
      });
    });

    view.dispatch({
      changes: { from: 6, insert: "C" },
      userEvent: "input.type"
    });

    expect(editor.getDocument()).toBe("baseABC");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("baseAB");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("baseA");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("base");

    editor.destroy();
  });
});
