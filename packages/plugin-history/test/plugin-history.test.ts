import { EditorView, ViewPlugin } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { describe, expect, it, vi } from "vitest";

import { createHistoryPlugin } from "../src/index";

function captureView(): { plugin: ViewPlugin<unknown>; getView: () => EditorView } {
  let view: EditorView | null = null;
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(current: EditorView) {
        view = current;
      }
    }
  );
  return {
    plugin,
    getView: () => {
      if (!view) throw new Error("EditorView was not captured");
      return view;
    }
  };
}

function activateTableCell(cell: HTMLElement, clientX = 80, clientY = 40): void {
  document.getSelection()?.removeAllRanges();
  cell.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY
  }));
  document.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true,
    button: 0,
    clientX,
    clientY
  }));
}

async function blurCellOutsideTable(cell: HTMLElement): Promise<void> {
  const activeElementSpy = vi.spyOn(document, "activeElement", "get").mockReturnValue(document.body);
  cell.dispatchEvent(new Event("blur"));
  await Promise.resolve();
  activeElementSpy.mockRestore();
}

function editCell(cell: HTMLElement, text: string): void {
  activateTableCell(cell);
  cell.textContent = text;
  cell.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
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

  it("keeps CodeMirror typing joins: consecutive input.type is one undo", () => {
    const container = document.createElement("div");
    const captured = captureView();
    const editor = createEditor({
      container,
      initialValue: "ab",
      plugins: [createHistoryPlugin(), { name: "capture-view", cmExtensions: [captured.plugin] }]
    });
    const view = captured.getView();

    view.dispatch({ changes: { from: 2, insert: "c" }, userEvent: "input.type" });
    view.dispatch({ changes: { from: 3, insert: "d" }, userEvent: "input.type" });
    expect(editor.getDocument()).toBe("abcd");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ab");
    expect(editor.undo()).toBe(false);

    editor.destroy();
  });

  it("does not join a table cell commit with following typed input", () => {
    const container = document.createElement("div");
    const captured = captureView();
    const editor = createEditor({
      container,
      initialValue: "ab",
      plugins: [createHistoryPlugin(), { name: "capture-view", cmExtensions: [captured.plugin] }]
    });
    const view = captured.getView();

    view.dispatch({ changes: { from: 2, insert: "!" }, userEvent: "input.table.cell" });
    view.dispatch({ changes: { from: 3, insert: "x" }, userEvent: "input.type" });
    expect(editor.getDocument()).toBe("ab!x");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ab!");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ab");

    editor.destroy();
  });

  it("treats each isolated table cell commit as its own undo group", () => {
    const container = document.createElement("div");
    const captured = captureView();
    const editor = createEditor({
      container,
      initialValue: "ab",
      plugins: [createHistoryPlugin(), { name: "capture-view", cmExtensions: [captured.plugin] }]
    });
    const view = captured.getView();

    view.dispatch({ changes: { from: 2, insert: "1" }, userEvent: "input.table.cell" });
    view.dispatch({ changes: { from: 3, insert: "2" }, userEvent: "input.table.cell" });
    expect(editor.getDocument()).toBe("ab12");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ab1");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("ab");

    editor.destroy();
  });

  it("commits one table cell blur as a single undo and restores on redo", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      livePreview: true,
      plugins: [createHistoryPlugin(), createGfmPreset()]
    });
    const cell = container.querySelectorAll<HTMLElement>("tr")[2]?.querySelectorAll<HTMLElement>(".nexus-cell")[0];
    if (!cell) throw new Error("Expected table cell");

    editCell(cell, "edited");
    await blurCellOutsideTable(cell);
    expect(editor.getDocument()).toContain("| edited | 2 |");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toContain("| 1 | 2 |");
    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toContain("| edited | 2 |");

    editor.destroy();
    container.remove();
  });

  it("keeps adjacent table cells as separate undo groups after blur", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      livePreview: true,
      plugins: [createHistoryPlugin(), createGfmPreset()]
    });
    const cells = container.querySelectorAll<HTMLElement>("tr")[2]?.querySelectorAll<HTMLElement>(".nexus-cell");
    const first = cells?.[0];
    const second = cells?.[1];
    if (!first || !second) throw new Error("Expected table cells");

    editCell(first, "one");
    const activeSpy = vi.spyOn(document, "activeElement", "get").mockReturnValue(second);
    first.dispatchEvent(new Event("blur"));
    await Promise.resolve();
    activeSpy.mockRestore();

    editCell(second, "two");
    await blurCellOutsideTable(second);

    expect(editor.getDocument()).toContain("| one | two |");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toContain("| one | 2 |");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toContain("| 1 | 2 |");

    editor.destroy();
    container.remove();
  });

  it("treats adding a table column as one undo group", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const original = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const editor = createEditor({
      container,
      initialValue: original,
      livePreview: true,
      plugins: [createHistoryPlugin(), createGfmPreset()]
    });
    const addColumn = container.querySelector<HTMLButtonElement>('button[title="Add column"]');
    if (!addColumn) throw new Error("Expected add-column button");

    addColumn.click();
    expect(editor.getDocument()).not.toBe(original);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(original);
    expect(editor.undo()).toBe(false);

    editor.destroy();
    container.remove();
  });
});
