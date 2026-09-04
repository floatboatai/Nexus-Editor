import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor, type EditorAPI } from "../src/index";

beforeAll(() => {
  // jsdom lacks Range geometry; live-preview table widget relies on it for
  // grip positioning and cursor mapping. Stub with empty rects (mirrors
  // live-preview.test.ts setup so table widgets mount without throwing).
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

afterEach(() => {
  vi.useRealTimers();
});

// Table actions contract tests.
//
// These tests exercise the four context-menu / + -button actions
// (addRow / addColumn / deleteRow / deleteColumn) through the same
// user-reachable DOM paths the context menu and + buttons use internally.
// They serve as the regression net for the type tightening in
// live-preview-table.ts: if the TableWidgetActions interface or the mdast
// node types drift from the actual widget implementation, these tests fail.
describe("EditableTableWidget actions contract", () => {
  function makeEditor(initialValue: string): { editor: EditorAPI; container: HTMLDivElement } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue,
      plugins: [createGfmPreset()],
      livePreview: true,
    });
    return { editor, container };
  }

  function findAddRowButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('button[title="Add row"]');
  }

  function findAddColumnButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('button[title="Add column"]');
  }

  function findMenuItem(text: string): HTMLButtonElement | null {
    const items = document.body.querySelectorAll<HTMLButtonElement>('.nexus-table-ctx button[role="menuitem"]');
    return Array.from(items).find((b) => b.textContent === text) ?? null;
  }

  function triggerContextMenu(row: HTMLElement, clientX = 10, clientY = 10): void {
    row.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }));
  }

  // ── addRow ──

  it("appends a new data row when the + (Add row) button is clicked", () => {
    const { editor, container } = makeEditor("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const before = editor.getDocument().split("\n").filter((l) => l.startsWith("|")).length;

    const btn = findAddRowButton(container);
    expect(btn).not.toBeNull();
    btn!.click();

    const after = editor.getDocument().split("\n").filter((l) => l.startsWith("|")).length;
    expect(after).toBe(before + 1);
    editor.destroy();
    container.remove();
  });

  it("preserves the existing column count in the newly added row", () => {
    const { editor, container } = makeEditor("| A | B |\n| --- | --- |\n| 1 | 2 |");
    findAddRowButton(container)!.click();

    const lines = editor.getDocument().split("\n").filter((l) => l.startsWith("|"));
    const newRow = lines[lines.length - 1];
    // 2 columns → 3 pipes (leading + 1 separator + trailing)
    expect(newRow.split("|").length - 1).toBe(3);
    editor.destroy();
    container.remove();
  });

  // ── addColumn ──

  it("appends a new column to every row when the + (Add column) button is clicked", () => {
    const { editor, container } = makeEditor("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const beforePipes = editor.getDocument().split("\n")[0].split("|").length - 1;

    const btn = findAddColumnButton(container);
    expect(btn).not.toBeNull();
    btn!.click();

    const afterPipes = editor.getDocument().split("\n")[0].split("|").length - 1;
    expect(afterPipes).toBe(beforePipes + 1);
    editor.destroy();
    container.remove();
  });

  // ── deleteRow ──

  it("removes the targeted data row via the context menu Delete row action", () => {
    const { editor, container } = makeEditor("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |");
    const before = editor.getDocument().split("\n").filter((l) => l.startsWith("|")).length;

    // Right-click the first data row (tr[2]: tr[0] is colgroup row, tr[1] is header).
    const dataRow = container.querySelectorAll<HTMLElement>("tr")[2];
    expect(dataRow).not.toBeUndefined();
    triggerContextMenu(dataRow);

    const item = findMenuItem("Delete row");
    expect(item).not.toBeNull();
    item!.click();

    const after = editor.getDocument().split("\n").filter((l) => l.startsWith("|")).length;
    expect(after).toBe(before - 1);
    editor.destroy();
    container.remove();
  });

  it("does not offer Delete row on the header row", () => {
    const { editor, container } = makeEditor("| A | B |\n| --- | --- |\n| 1 | 2 |");

    // Header row is tr[1].
    const headerRow = container.querySelectorAll<HTMLElement>("tr")[1];
    triggerContextMenu(headerRow);

    expect(findMenuItem("Delete row")).toBeNull();
    editor.destroy();
    container.remove();
  });

  // ── deleteColumn ──

  it("removes the targeted column via the context menu Delete column action", () => {
    const { editor, container } = makeEditor("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const beforePipes = editor.getDocument().split("\n")[0].split("|").length - 1;

    const dataRow = container.querySelectorAll<HTMLElement>("tr")[2];
    triggerContextMenu(dataRow);

    const item = findMenuItem("Delete column");
    expect(item).not.toBeNull();
    item!.click();

    const afterPipes = editor.getDocument().split("\n")[0].split("|").length - 1;
    expect(afterPipes).toBe(beforePipes - 1);
    editor.destroy();
    container.remove();
  });

  it("disables Delete column when the table has only one column", () => {
    const { editor, container } = makeEditor("| A |\n| --- |\n| 1 |");
    const dataRow = container.querySelectorAll<HTMLElement>("tr")[2];
    triggerContextMenu(dataRow);

    const item = findMenuItem("Delete column");
    expect(item).not.toBeNull();
    expect(item!.disabled).toBe(true);
    editor.destroy();
    container.remove();
  });
});
