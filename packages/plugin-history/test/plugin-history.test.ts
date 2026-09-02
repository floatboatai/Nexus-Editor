import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin } from "../src/index";

function makeEditor(initialValue = "start") {
  const container = document.createElement("div");
  const history = createHistoryPlugin();
  const editor = createEditor({
    container,
    initialValue,
    plugins: [history]
  });
  return { container, editor, history };
}

describe("@floatboat/nexus-plugin-history", () => {
  it("undoes the most recent document change through codemirror key handling", () => {
    const { container, editor } = makeEditor();

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
    const { container, editor } = makeEditor();

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

  it("registers undo and redo commands", () => {
    const { editor } = makeEditor();
    const commands = editor.getCommands().map((command) => command.id);
    expect(commands).toContain("history.undo");
    expect(commands).toContain("history.redo");
    editor.destroy();
  });

  it("undo command reverts the last change", () => {
    const { editor } = makeEditor();
    editor.setDocument("next");
    expect(editor.runCommand("history.undo")).toBe(true);
    expect(editor.getDocument()).toBe("start");
    editor.destroy();
  });

  it("redo command re-applies an undone change", () => {
    const { editor } = makeEditor();
    editor.setDocument("next");
    editor.runCommand("history.undo");
    expect(editor.runCommand("history.redo")).toBe(true);
    expect(editor.getDocument()).toBe("next");
    editor.destroy();
  });

  it("groupHistory collapses multiple changes into a single undo entry", () => {
    const { editor, history } = makeEditor("");

    history.groupHistory(() => {
      editor.replaceSelection("a");
      editor.replaceSelection("b");
      editor.replaceSelection("c");
    });

    expect(editor.getDocument()).toBe("abc");

    // One undo reverts the whole group.
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("");
    // Nothing left to undo.
    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  it("groupHistory returns the callback result", () => {
    const { editor, history } = makeEditor("");
    const result = history.groupHistory(() => {
      editor.replaceSelection("x");
      return 42;
    });
    expect(result).toBe(42);
    editor.destroy();
  });

  it("groupHistory does not merge with an edit that happened before the group", () => {
    const { editor, history } = makeEditor("");

    editor.replaceSelection("a");
    history.groupHistory(() => {
      editor.replaceSelection("b");
      editor.replaceSelection("c");
    });

    expect(editor.getDocument()).toBe("abc");

    // First undo reverts the group (b + c).
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a");
    // Second undo reverts the earlier standalone edit (a).
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("");
    editor.destroy();
  });

  it("nested groupHistory calls compose into a single undo entry", () => {
    const { editor, history } = makeEditor("");

    history.groupHistory(() => {
      editor.replaceSelection("a");
      history.groupHistory(() => {
        editor.replaceSelection("b");
        editor.replaceSelection("c");
      });
      editor.replaceSelection("d");
    });

    expect(editor.getDocument()).toBe("abcd");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("");
    editor.destroy();
  });

  it("isolateHistory prevents changes from merging with adjacent edits", () => {
    const { editor, history } = makeEditor("");

    editor.replaceSelection("a");
    history.isolateHistory(() => {
      editor.replaceSelection("b");
    });
    editor.replaceSelection("c");

    expect(editor.getDocument()).toBe("abc");

    // Each change is its own undo entry.
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ab");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("a");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("");
    editor.destroy();
  });

  it("getHistoryDepth reports undoable and redoable events", () => {
    const { editor, history } = makeEditor("");

    expect(history.getHistoryDepth()).toEqual({ undo: 0, redo: 0 });

    editor.replaceSelection("a");
    expect(history.getHistoryDepth().undo).toBe(1);

    editor.undo();
    expect(history.getHistoryDepth().undo).toBe(0);
    expect(history.getHistoryDepth().redo).toBe(1);

    editor.redo();
    expect(history.getHistoryDepth().undo).toBe(1);
    expect(history.getHistoryDepth().redo).toBe(0);
    editor.destroy();
  });

  it("groupHistory produces a single undo depth entry", () => {
    const { editor, history } = makeEditor("");

    history.groupHistory(() => {
      editor.replaceSelection("a");
      editor.replaceSelection("b");
      editor.replaceSelection("c");
    });

    expect(history.getHistoryDepth().undo).toBe(1);
    editor.destroy();
  });
});
