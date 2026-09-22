import { describe, expect, it, vi } from "vitest";
import { history } from "@codemirror/commands";

import { createEditor, editorHistory } from "../src";

describe("alternative editor history", () => {
  it("preserves positional undo and redo when no alternative backend is installed", () => {
    const editor = createEditor({
      container: document.createElement("div"), initialValue: "before",
      plugins: [{ name: "history", cmExtensions: [history()] }],
    });
    try {
      editor.replaceRange(0, 6, "after");
      expect(editor.undo()).toBe(true);
      expect(editor.getDocument()).toBe("before");
      expect(editor.redo()).toBe(true);
      expect(editor.getDocument()).toBe("after");
    } finally {
      editor.destroy();
    }
  });

  it("uses the selected backend without falling back when its history is empty", () => {
    const undo = vi.fn(() => false);
    const redo = vi.fn(() => false);
    const editor = createEditor({
      container: document.createElement("div"), initialValue: "before",
      plugins: [{ name: "history", cmExtensions: [history(), editorHistory.of({ undo, redo })] }],
    });
    editor.setDocument("after");
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(false);
    expect(editor.getDocument()).toBe("after");
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
    editor.destroy();
    editor.undo();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("rejects ambiguous history backends", () => {
    const backend = { undo: () => false, redo: () => false };
    expect(() => createEditor({
      container: document.createElement("div"),
      plugins: [{ name: "ambiguous", cmExtensions: [editorHistory.of(backend), editorHistory.of({ ...backend })] }],
    })).toThrow("Only one");
  });
});
