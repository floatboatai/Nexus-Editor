import { afterEach, describe, expect, it } from "vitest";
import { EditorView, ViewPlugin } from "@codemirror/view";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor, prepareBlockMove, type EditorAPI } from "../src/index";
import { isTableEditing } from "../src/live-preview-table";

const tableSource = "| A | B |\n| --- | --- |\n| 1 | old |";
const source = `${tableSource}\n\nAfter`;
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function createTableEditor(initialValue = source): { editor: EditorAPI; view: EditorView; cell: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let capturedView: EditorView | undefined;
  const editor = createEditor({
    container,
    initialValue,
    livePreview: true,
    plugins: [createGfmPreset(), {
      name: "capture-view",
      cmExtensions: [ViewPlugin.fromClass(class {
        constructor(view: EditorView) { capturedView = view; }
      })],
    }],
  });
  cleanups.push(() => { editor.destroy(); container.remove(); });
  const cell = container.querySelectorAll<HTMLElement>(".nexus-cell")[3];
  if (!capturedView || !cell) throw new Error("Expected an editable table");
  return { editor, view: capturedView, cell };
}

function editCell(cell: HTMLElement, text: string): void {
  document.getSelection()?.removeAllRanges();
  cell.dispatchEvent(new MouseEvent("mousedown", {
    bubbles: true, cancelable: true, button: 0, clientX: 80, clientY: 40,
  }));
  document.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true, button: 0, clientX: 80, clientY: 40,
  }));
  cell.textContent = text;
  cell.dispatchEvent(new Event("input", { bubbles: true }));
}

async function blurCell(cell: HTMLElement): Promise<void> {
  // jsdom does not focus contentEditable table cells, so HTMLElement.blur()
  // alone does not emit the browser event that commits their local input.
  cell.dispatchEvent(new Event("blur"));
  await Promise.resolve();
}

describe("prepareBlockMove", () => {
  it.each(["cancel", "reject-selection", "reject-move"])("keeps tables editable after preparation without a move (%s)", async (scenario) => {
    const { editor, view, cell } = createTableEditor();
    editCell(cell, "saved");
    if (scenario !== "cancel") {
      editor.getContributionSink().registerTransactionFilter("guard", (context) => {
        // A widget refresh must not depend on an accepted selection transaction.
        if (context.changes.length === 0 || context.userEvent === "move.block") {
          return { action: "reject" };
        }
        return { action: "accept" };
      });
    }
    expect(prepareBlockMove(view)).toBe(true);
    if (scenario === "reject-move") {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: `After\n\n${tableSource.replace("old", "saved")}` },
        userEvent: "move.block",
      });
    }
    expect(editor.getDocument()).toBe(source.replace("old", "saved"));
    const current = view.dom.querySelectorAll<HTMLElement>(".nexus-cell")[3];
    expect(current.isConnected).toBe(true);
    editCell(current, "second edit");
    await blurCell(current);
    expect(editor.getDocument()).toBe(source.replace("old", "second edit"));
    expect(isTableEditing(view)).toBe(false);
  });

  it.each([false, true])("commits multiple pending tables without invalidating offsets (reverse focus: %s)", async (reverseFocus) => {
    const initialValue = `${source}\n\n${tableSource}\n\nEnd`;
    const { editor, view, cell } = createTableEditor(initialValue);
    const second = view.dom.querySelectorAll<HTMLElement>(".nexus-cell")[7];
    let reject = true;
    editor.getContributionSink().registerTransactionFilter("guard", (context) =>
      reject && context.changes.length > 0 ? { action: "reject" } : { action: "accept" }
    );
    const pending: Array<[HTMLElement, string]> = [[cell, "first longer edit"], [second, "second edit"]];
    if (reverseFocus) pending.reverse();
    for (const [target, text] of pending) {
      editCell(target, text);
      await blurCell(target);
    }
    reject = false;
    expect(prepareBlockMove(view)).toBe(true);
    expect(editor.getDocument()).toBe(
      `${source.replace("old", "first longer edit")}\n\n${tableSource.replace("old", "second edit")}\n\nEnd`
    );
    expect(isTableEditing(view)).toBe(false);

    const currentSecond = view.dom.querySelectorAll<HTMLElement>(".nexus-cell")[7];
    editCell(currentSecond, "edited again after cancellation");
    await blurCell(currentSecond);
    expect(editor.getDocument()).toContain("edited again after cancellation");
    expect(isTableEditing(view)).toBe(false);
  });

  it("preserves the source formatting of an unchanged focused table", () => {
    const initialValue = "A | B\n--- | ---\n1 | old\n\nAfter";
    const { editor, view, cell } = createTableEditor(initialValue);
    editCell(cell, "old");
    expect(prepareBlockMove(view)).toBe(true);
    expect(editor.getDocument()).toBe(initialValue);
  });

  it("commits the focused cell before blur and releases the widget for a move", async () => {
    const { editor, view, cell } = createTableEditor();
    editCell(cell, "saved");
    expect(editor.getDocument()).toBe(source);
    expect(prepareBlockMove(view)).toBe(true);
    expect(editor.getDocument()).toBe(source.replace("old", "saved"));
    expect(isTableEditing(view)).toBe(false);
    await Promise.resolve();

    const moved = `After\n\n${tableSource.replace("old", "saved")}`;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: moved } });
    expect(editor.getDocument()).toBe(moved);
    expect(view.dom.querySelectorAll(".nexus-table-wrapper")).toHaveLength(1);
    expect(view.dom.textContent).toContain("saved");
  });

  it("preserves rejected input across blur and selection changes and allows a retry", async () => {
    const { editor, view, cell } = createTableEditor();
    let reject = true;
    editor.getContributionSink().registerTransactionFilter("guard", (context) =>
      reject && context.changes.length > 0 ? { action: "reject" } : { action: "accept" }
    );
    editCell(cell, "UNSAVED");
    expect(prepareBlockMove(view)).toBe(false);
    await blurCell(cell);
    editor.setSelection(source.length);
    expect(editor.getDocument()).toBe(source);
    expect(cell.isConnected).toBe(true);
    expect(cell.textContent).toBe("UNSAVED");
    expect(isTableEditing(view)).toBe(true);

    reject = false;
    expect(prepareBlockMove(view)).toBe(true);
    expect(editor.getDocument()).toBe(source.replace("old", "UNSAVED"));
    expect(isTableEditing(view)).toBe(false);
  });

  it("fails closed when a host replaces the pending input with different content", () => {
    const { editor, view, cell } = createTableEditor();
    editor.getContributionSink().registerTransactionFilter("normalizer", (context) => {
      if (context.changes.length === 0) return { action: "accept" };
      return {
        action: "replace",
        transaction: {
          changes: context.changes.map((change) => ({
            ...change, insert: change.insert.replace("pending", "replacement"),
          })),
          origin: ["normalizer"],
        },
      };
    });
    editCell(cell, "pending");
    expect(prepareBlockMove(view)).toBe(false);
    expect(editor.getDocument()).toBe(source.replace("old", "replacement"));
    expect(cell.isConnected).toBe(true);
    expect(cell.textContent).toBe("pending");
    expect(isTableEditing(view)).toBe(true);
    expect(prepareBlockMove(view)).toBe(false);
  });

  it("accepts equivalent replacement transactions", () => {
    const { editor, view, cell } = createTableEditor();
    editor.getContributionSink().registerTransactionFilter("audit", (context) => ({
      action: "replace",
      transaction: { changes: context.changes, selection: context.selectionAfter, origin: ["audit"] },
    }));
    editCell(cell, "accepted");
    expect(prepareBlockMove(view)).toBe(true);
    expect(editor.getDocument()).toBe(source.replace("old", "accepted"));
  });

  it("does not commit an IME candidate and accepts the completed text", () => {
    const { editor, view, cell } = createTableEditor();
    editCell(cell, "");
    cell.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    cell.textContent = "zhong";
    expect(prepareBlockMove(view)).toBe(false);
    expect(editor.getDocument()).toBe(source);
    expect(cell.textContent).toBe("zhong");

    cell.textContent = "中文";
    cell.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }));
    expect(prepareBlockMove(view)).toBe(true);
    expect(editor.getDocument()).toBe(source.replace("old", "中文"));
  });

  it("does not apply pending input at stale table offsets", () => {
    const { editor, view, cell } = createTableEditor();
    editCell(cell, "pending");
    view.dispatch({ changes: { from: 0, insert: "New paragraph\n\n" } });
    const changed = editor.getDocument();
    expect(prepareBlockMove(view)).toBe(false);
    expect(editor.getDocument()).toBe(changed);
    expect(cell.textContent).toBe("pending");
    expect(isTableEditing(view)).toBe(true);
  });

  it("blocks movement until a table mouse gesture finishes", () => {
    const { view, cell } = createTableEditor();
    cell.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, button: 0, clientX: 80, clientY: 40,
    }));
    expect(prepareBlockMove(view)).toBe(false);
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true, button: 0, clientX: 80, clientY: 40,
    }));
    expect(prepareBlockMove(view)).toBe(true);
  });

  it("keeps table sessions isolated between editor views", () => {
    const first = createTableEditor();
    const second = createTableEditor();
    editCell(first.cell, "pending");
    first.cell.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(prepareBlockMove(second.view)).toBe(true);
    expect(first.editor.getDocument()).toBe(source);
    expect(prepareBlockMove(first.view)).toBe(false);
  });
});
