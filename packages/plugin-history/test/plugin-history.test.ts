import { historyKeymap, undo as cmundo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import { beginUndoGroup, createHistoryPlugin, endUndoGroup } from "../src/index";

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

// 撤销分组测试（需要直接操作 EditorView）
describe("undo grouping", () => {
  function createView(doc: string, parent: HTMLElement): EditorView {
    const plugin = createHistoryPlugin();
    return new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          ...(plugin.cmExtensions ?? []),
          keymap.of(historyKeymap)
        ]
      }),
      parent
    });
  }

  it("batch undoes all changes within a group", () => {
    const container = document.createElement("div");
    const view = createView("hello world", container);

    beginUndoGroup(view);
    view.dispatch({ changes: { from: 0, to: 5, insert: "goodbye" } });
    view.dispatch({ changes: { from: 8, to: 13, insert: "everyone" } });
    endUndoGroup(view);

    expect(view.state.doc.toString()).toBe("goodbye everyone");
    cmundo(view);
    expect(view.state.doc.toString()).toBe("goodbye world");
    cmundo(view);
    expect(view.state.doc.toString()).toBe("hello world");

    view.destroy();
  });

  it("undo of single change in group works", () => {
    const container = document.createElement("div");
    const view = createView("start", container);

    beginUndoGroup(view);
    view.dispatch({ changes: { from: 0, to: 5, insert: "middle" } });
    endUndoGroup(view);

    cmundo(view);
    expect(view.state.doc.toString()).toBe("start");

    view.destroy();
  });

  it("empty group does not break undo", () => {
    const container = document.createElement("div");
    const view = createView("hello", container);

    beginUndoGroup(view);
    endUndoGroup(view);

    view.dispatch({ changes: { from: 0, to: 5, insert: "hi" } });
    cmundo(view);
    expect(view.state.doc.toString()).toBe("hello");

    view.destroy();
  });

  it("beginUndoGroup and endUndoGroup are exported", () => {
    expect(typeof beginUndoGroup).toBe("function");
    expect(typeof endUndoGroup).toBe("function");
  });
});
