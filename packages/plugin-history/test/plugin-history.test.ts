import { createEditor } from "@floatboat/nexus-core";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin, getRedoDepth, getUndoDepth, isolateHistory } from "../src/index";

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

  it("groups rapid adjacent edits into a single undo step by default", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()]
    });

    editor.replaceRange(5, 5, "a");
    editor.replaceRange(6, 6, "b");
    expect(editor.getDocument()).toBe("startab");

    // Adjacent edits within newGroupDelay merge into one undo group.
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("start");
    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  it("newGroupDelay: 0 keeps every edit in its own undo group", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin({ newGroupDelay: 0 })]
    });

    editor.replaceRange(5, 5, "a");
    editor.replaceRange(6, 6, "b");
    expect(editor.getDocument()).toBe("startab");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("starta");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("start");
    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  it("reports undo/redo depth for hosts rendering history buttons", () => {
    let state = EditorState.create({ doc: "a", extensions: [history()] });
    expect(getUndoDepth(state)).toBe(0);
    expect(getRedoDepth(state)).toBe(0);

    state = state.update({ changes: { from: 1, insert: "b" } }).state;
    expect(getUndoDepth(state)).toBe(1);
    expect(getRedoDepth(state)).toBe(0);

    const undid = undo({ state, dispatch: (tr) => { state = tr.state; } });
    expect(undid).toBe(true);
    expect(getUndoDepth(state)).toBe(0);
    expect(getRedoDepth(state)).toBe(1);
  });

  it("re-exports the isolateHistory annotation for host-side dispatches", () => {
    expect(typeof isolateHistory.of).toBe("function");
    expect(isolateHistory.of("full").value).toBe("full");
  });
});
