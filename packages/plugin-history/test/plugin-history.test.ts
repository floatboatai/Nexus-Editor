import { EditorView } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";

import {
  createHistoryPlugin,
  findEditorView,
  redoDepth,
  runInHistoryGroup,
  undoDepth
} from "../src/index";

function mountEditor(initialValue = "alpha beta gamma") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({
    container,
    initialValue,
    plugins: [createHistoryPlugin()]
  });
  const view = findEditorView(container);
  if (!view) {
    throw new Error("expected CodeMirror EditorView");
  }
  return { container, editor, view };
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

  it("keeps two disjoint replaceRange calls as separate undo entries by default", () => {
    const { container, editor, view } = mountEditor("one two three");
    const before = undoDepth(view.state);

    editor.replaceRange(0, 3, "ONE");
    editor.replaceRange(8, 13, "THREE");

    expect(editor.getDocument()).toBe("ONE two THREE");
    expect(undoDepth(view.state)).toBe(before + 2);

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ONE two three");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("one two three");
    expect(editor.undo()).toBe(false);

    editor.destroy();
    container.remove();
  });

  it("collapses multi-step disjoint edits into one undo group via runInHistoryGroup", () => {
    const { container, editor, view } = mountEditor("one two three");
    const before = undoDepth(view.state);

    runInHistoryGroup(view, () => {
      editor.replaceRange(0, 3, "ONE");
      editor.replaceRange(8, 13, "THREE");
    });

    expect(editor.getDocument()).toBe("ONE two THREE");
    expect(undoDepth(view.state)).toBe(before + 1);

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("one two three");
    expect(editor.undo()).toBe(false);

    editor.destroy();
    container.remove();
  });

  it("redoes a history group in a single step", () => {
    const { container, editor, view } = mountEditor("one two three");

    runInHistoryGroup(view, () => {
      editor.replaceRange(0, 3, "ONE");
      editor.replaceRange(8, 13, "THREE");
    });

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("one two three");
    expect(redoDepth(view.state)).toBe(1);

    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toBe("ONE two THREE");
    expect(redoDepth(view.state)).toBe(0);

    editor.destroy();
    container.remove();
  });

  it("does not let the next user edit join the sealed history group", () => {
    const { container, editor, view } = mountEditor("one two three");

    runInHistoryGroup(view, () => {
      editor.replaceRange(0, 3, "ONE");
      editor.replaceRange(8, 13, "THREE");
    });

    // Adjacent-in-time follow-up edit on a touching range must still start a
    // new group because runInHistoryGroup seals with isolateHistory("after").
    editor.replaceRange(4, 7, "TWO");
    expect(undoDepth(view.state)).toBe(2);

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ONE two THREE");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("one two three");

    editor.destroy();
    container.remove();
  });

  it("reuses the outer group for nested runInHistoryGroup calls", () => {
    const { container, editor, view } = mountEditor("one two three");
    const before = undoDepth(view.state);

    runInHistoryGroup(view, () => {
      editor.replaceRange(0, 3, "ONE");
      runInHistoryGroup(view, () => {
        editor.replaceRange(8, 13, "THREE");
      });
    });

    expect(undoDepth(view.state)).toBe(before + 1);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("one two three");

    editor.destroy();
    container.remove();
  });

  it("findEditorView resolves the CodeMirror view from the container", () => {
    const { container, editor } = mountEditor("hello");
    const view = findEditorView(container);
    expect(view).toBeInstanceOf(EditorView);
    editor.destroy();
    container.remove();
  });
});
