import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EditorView, ViewPlugin } from "@codemirror/view";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createHistoryPlugin } from "../../plugin-history/src/index";
import { createEditor } from "../src/index";

beforeAll(() => {
  if (!("getClientRects" in Range.prototype)) {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [] as unknown as DOMRectList,
    });
  }
  if (!("getBoundingClientRect" in Range.prototype)) {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
  }
});

function captureEditorView(): { plugin: { name: string; cmExtensions: unknown[] }; get(): EditorView | null } {
  const ref: { current: EditorView | null } = { current: null };
  const captureView = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        ref.current = view;
      }
    }
  );
  return {
    plugin: { name: "capture-view", cmExtensions: [captureView] },
    get: () => ref.current,
  };
}

function findButtonByTitle(container: HTMLElement, title: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll("button")).find(
      (b) => b.title === title
    ) as HTMLButtonElement | undefined) ?? null
  );
}

const TABLE_3x2 =
  "| A | B |\n" +
  "| --- | --- |\n" +
  "| 1 | 2 |";

function pipeCellCount(line: string): number {
  // Header / data line shaped like "| a | b | c |" -> 3 cells.
  return line.split("|").slice(1, -1).filter((s) => s.length > 0).length;
}

afterEach(() => {
  document.body.querySelectorAll(".nexus-table-ctx").forEach((n) => n.remove());
});

describe("live-preview table column/row operations", () => {
  // 1. Trailing body preserved — addColumn must not eat the paragraph that
  //    follows the table. With the old `this.source.length + 512` heuristic
  //    this could overshoot into the blank line and into the next paragraph
  //    when the widget snapshot was stale.
  it("does not eat trailing paragraphs after addColumn", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: TABLE_3x2 + "\n\ntrailing paragraph",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    expect(findButtonByTitle(container, "Add column")).not.toBeNull();
    findButtonByTitle(container, "Add column")!.click();

    const doc = editor.getDocument();
    // Trailing paragraph must still be intact (no characters merged into it).
    expect(doc.endsWith("trailing paragraph")).toBe(true);
    // Separator line still present, table shape intact.
    expect(doc).toContain("| --- | ---");
    // New column was added — original 2-column header became 3 columns.
    const headerLine = doc.split("\n")[0];
    expect(pipeCellCount(headerLine)).toBe(3);

    editor.destroy();
  });

  // 2. Trailing body preserved — addRow must not absorb the trailing paragraph
  //    as part of the new row.
  it("does not eat trailing paragraphs after addRow", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: TABLE_3x2 + "\n\ntrailing paragraph",
      livePreview: true,
      plugins: [createGfmPreset()],
    });

    findButtonByTitle(container, "Add row")!.click();

    const doc = editor.getDocument();
    expect(doc).toContain("trailing paragraph");
    expect(doc.endsWith("trailing paragraph")).toBe(true);
    // Table gained exactly one row (header + separator + original data row
    // + the inserted row -> 4 lines starting with `|`).
    const dataLines = doc.split("\n").filter((l) => l.startsWith("|"));
    expect(dataLines.length).toBe(4);

    editor.destroy();
  });

  // 3. First-click after a cell edit — the bug that motivated the rewrite.
  //    With `editing = true` the widget instance is preserved across a cell
  //    edit, so its `this.source` snapshot is stale. A subsequent addColumn
  //    must read the current cell content from the live doc instead of the
  //    snapshot, otherwise the new column gets the wrong content.
  it("addColumn reads live cell content on the first click after a cell edit", () => {
    const container = document.createElement("div");
    const { plugin, get } = captureEditorView();
    const editor = createEditor({
      container,
      initialValue: TABLE_3x2,
      livePreview: true,
      plugins: [createGfmPreset(), plugin],
    });

    const view = get();
    expect(view).not.toBeNull();

    // Focus a cell → editing lock acquired, widget preserved.
    const cell = container.querySelector<HTMLElement>("tr:nth-child(2) .nexus-cell");
    expect(cell).not.toBeNull();
    cell!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));

    // Simulate the cell's `input` handler committing new content to the doc
    // while the widget snapshot is still the pre-edit baseline.
    const doc = view!.state.doc;
    const tableFrom = doc.toString().indexOf(TABLE_3x2);
    const rowOffset = tableFrom + "| A | B |\n| --- | --- |\n".length;
    const rowEnd = rowOffset + "| 1 | 2 |".length;
    view!.dispatch({
      changes: { from: rowOffset, to: rowEnd, insert: "| 1NEW | 2 |" },
      selection: { anchor: rowOffset + "| 1NEW | 2 |".length },
    });

    // First click — should not need a second click to take effect.
    findButtonByTitle(container, "Add column")!.click();

    const after = editor.getDocument();
    // The cell edit was preserved (search for the new first-cell content;
    // subsequent tokens are padded with trailing spaces by addColumn).
    expect(after).toMatch(/\| 1NEW \| 2\b/);
    // And the new column was added correctly — 3 cells on the data row.
    const dataLine = after.split("\n").find((l) => l.startsWith("| 1NEW")) ?? "";
    expect(pipeCellCount(dataLine)).toBe(3);

    editor.destroy();
  });

  // 4. IME composition — the IME handler dispatches a CM6 transaction that
  //    replaces the cell's source line. Until the cell blurs, the widget
  //    instance is preserved with a stale snapshot. An addColumn click during
  //    this window must still work and must not drop the IME-pending text.
  it("preserves IME composition text across the next addColumn", () => {
    const container = document.createElement("div");
    const { plugin, get } = captureEditorView();
    const editor = createEditor({
      container,
      initialValue: TABLE_3x2,
      livePreview: true,
      plugins: [createGfmPreset(), plugin],
    });

    const view = get();
    expect(view).not.toBeNull();

    const cell = container.querySelector<HTMLElement>("tr:nth-child(2) .nexus-cell");
    expect(cell).not.toBeNull();
    cell!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));

    // Focus the cell (sets contentEditable + active cell), then trigger IME.
    cell!.focus();
    view!.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));

    // Simulate the IME commit — like the cell `input` listener, dispatch a
    // doc change that replaces the row with text containing IME output.
    const doc = view!.state.doc;
    const tableFrom = doc.toString().indexOf(TABLE_3x2);
    const rowOffset = tableFrom + "| A | B |\n| --- | --- |\n".length;
    const rowEnd = rowOffset + "| 1 | 2 |".length;
    const newRow = "| 1中文 | 2 |";
    view!.dispatch({
      changes: { from: rowOffset, to: rowEnd, insert: newRow },
      selection: { anchor: rowOffset + newRow.length },
      userEvent: "input.type.compose",
    });
    view!.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));

    // While IME is still considered active, the user clicks Add column.
    findButtonByTitle(container, "Add column")!.click();

    const after = editor.getDocument();
    // IME text was not dropped.
    expect(after).toMatch(/\| 1中文 \| 2\b/);
    // And the addColumn took effect — 3 cells on the data row.
    const dataLine = after.split("\n").find((l) => l.startsWith("| 1中文")) ?? "";
    expect(pipeCellCount(dataLine)).toBe(3);

    editor.destroy();
  });

  // 5. Undo / redo — addColumn must round-trip through the history stack.
  //    Forward: 2 cols → 3 cols. Undo: back to 2 cols. Redo: forward again.
  it("undoes and redoes addColumn identically", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: TABLE_3x2,
      livePreview: true,
      plugins: [createGfmPreset(), createHistoryPlugin()],
    });

    const before = editor.getDocument();
    findButtonByTitle(container, "Add column")!.click();
    const afterAdd = editor.getDocument();
    expect(afterAdd).not.toBe(before);
    expect(pipeCellCount(afterAdd.split("\n")[0])).toBe(3);

    // Undo via the editor's public API (wraps cmUndo).
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(before);

    // Redo.
    expect(editor.redo()).toBe(true);
    expect(editor.getDocument()).toBe(afterAdd);

    editor.destroy();
  });
});