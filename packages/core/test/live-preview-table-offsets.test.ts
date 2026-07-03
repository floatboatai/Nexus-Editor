import { describe, expect, it } from "vitest";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor } from "../src/index";

// Regression suite for the "stale table offset" bug.
//
// EditableTableWidget.eq() compares only `source` (a deliberate perf choice: an
// unchanged table keeps its DOM so typing above it doesn't rebuild the table).
// When document content *before* a table changes, CM6 rebuilds a fresh widget
// with the correct `tableFrom`, but because eq() returns true it KEEPS the old
// DOM — whose event-listener closures still capture the *old* widget instance
// and its now-stale `tableFrom`. Any subsequent table mutation then dispatches
// an out-of-date range:
//   * doc got shorter → RangeError (swallowed) → mutation silently no-ops
//   * doc got longer  → in-bounds but wrong position → corrupts unrelated prose
//
// All fixtures use WELL-FORMED tables (leading + trailing pipes on every row)
// to isolate this bug from the separate ragged-table defect.
//
// Interaction is coordinate-free: click a column grip to select the column,
// then press Delete on the wrapper to delete it (the exact user event chain).

const TABLE1 = "| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |";
const TABLE2 = "| x | y | z |\n| --- | --- | --- |\n| 4 | 5 | 6 |";
const TABLE1_NO_COL0 = "| b | c |\n| --- | --- |\n| 2 | 3 |";
const TABLE2_NO_COL0 = "| y | z |\n| --- | --- |\n| 5 | 6 |";

function flush(): Promise<void> {
  // Let CM6 tear down / rebuild the reused widget DOM between operations.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Select column `colIndex` of the table rendered in wrapper `wrapperIndex`,
// then delete it via the real grip-click + Delete-key event chain. Re-queries
// the DOM on every call because prior mutations rebuild the widget subtree.
function deleteColumn(container: HTMLElement, wrapperIndex: number, colIndex: number): void {
  const wrappers = container.querySelectorAll<HTMLElement>(".nexus-table-wrapper");
  const wrapper = wrappers[wrapperIndex];
  expect(wrapper, `wrapper[${wrapperIndex}] should be rendered`).toBeTruthy();

  const grips = wrapper.querySelectorAll<HTMLElement>(".nexus-col-grip");
  const grip = grips[colIndex];
  expect(grip, `col grip[${colIndex}] should exist`).toBeTruthy();

  grip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
}

describe("live preview table — stale offset regression", () => {
  // Case A: editing one table shifts the offsets of a later table. The later
  // table's reused DOM carries a stale (now too-large) tableFrom, so on main the
  // second delete dispatches an out-of-range change → RangeError (swallowed) →
  // table 2 is left untouched. Fixed: table 2 loses its first column.
  it("A: deletes a column from a second table after an earlier table shrank", async () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: `Intro\n\n${TABLE1}\n\n${TABLE2}`,
      livePreview: true,
      plugins: [createGfmPreset()]
    });

    // Cursor outside every table so both widgets render.
    editor.setSelection(0);

    // Delete table 1's first column → the whole document gets shorter, so
    // every offset after table 1 (including table 2's) shifts left.
    deleteColumn(container, 0, 0);
    await flush();

    // Keep the cursor outside the tables so widgets re-render after the change.
    editor.setSelection(0);
    await flush();

    // Delete table 2's first column. On main the reused widget dispatches a
    // stale, out-of-range span here.
    deleteColumn(container, 1, 0);
    await flush();

    expect(editor.getDocument()).toBe(
      `Intro\n\n${TABLE1_NO_COL0}\n\n${TABLE2_NO_COL0}`
    );

    editor.destroy();
  });

  // Case B: text *above* an otherwise-unchanged table grows. eq() sees the same
  // table source → DOM reused → stale (now too-small) tableFrom. The doc is now
  // long enough that the stale range stays in bounds, so on main the delete
  // rewrites the WRONG location and corrupts the prose above the table.
  it("B: deletes the correct column after the text above the table grew", async () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: `Hi\n\n${TABLE1}`,
      livePreview: true,
      plugins: [createGfmPreset()]
    });

    editor.setSelection(0);

    // Replace the whole document: intro grows, table source is byte-identical.
    // eq() → true → CM6 keeps the old table DOM (with its stale tableFrom).
    const longerIntro = "Hello world, a longer intro";
    editor.setDocument(`${longerIntro}\n\n${TABLE1}`);
    await flush();

    editor.setSelection(0);
    await flush();

    deleteColumn(container, 0, 0);
    await flush();

    const doc = editor.getDocument();
    // Prose above the table must survive verbatim.
    expect(doc).toContain(longerIntro);
    // Full document is exactly the longer intro + the de-columned table.
    expect(doc).toBe(`${longerIntro}\n\n${TABLE1_NO_COL0}`);

    editor.destroy();
  });

  // Case D: the same staleness through the widget's own locked dispatches.
  // Typing into a cell dispatches under the focus editing lock, so the
  // StateField keeps this widget instance alive (rule 12) and its captured
  // `source` no longer matches the document. A structural edit right after —
  // without clicking outside first — must build on (and size its replacement
  // range by) the live source, not the pre-typing snapshot.
  it("D: deletes a column correctly right after typing into a cell", async () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: `Intro\n\n${TABLE1}`,
      livePreview: true,
      plugins: [createGfmPreset()]
    });

    editor.setSelection(0);

    // Focus the "1" cell (the focus handler acquires the editing lock, so the
    // StateField will retain this widget across the typing dispatch), then type.
    const cell = Array.from(container.querySelectorAll<HTMLElement>("td.nexus-cell"))
      .find((el) => (el.dataset.source ?? el.textContent) === "1");
    expect(cell, 'the "1" body cell should be rendered').toBeTruthy();
    cell!.contentEditable = "true";
    // jsdom's focus() does not reliably fire the focus event; dispatch it
    // directly so the widget's focus handler acquires the editing lock.
    cell!.dispatchEvent(new FocusEvent("focus"));
    cell!.textContent = "typed";
    cell!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    // The typed text must be in the document already.
    expect(editor.getDocument()).toContain("typed");

    // Delete the LAST column while the cell edit is still "hot".
    deleteColumn(container, 0, 2);
    await flush();

    const doc = editor.getDocument();
    // The typed text survives and the table is exactly the two remaining columns.
    expect(doc).toBe("Intro\n\n| a | b |\n| --- | --- |\n| typed | 2 |");

    editor.destroy();
  });

  // Case C: green baseline — no prior edit, so tableFrom is fresh. Guards the
  // fix against breaking the first (uncontaminated) interaction. Green on both
  // main and the fixed branch.
  it("C: deletes a column correctly with no prior editing (green baseline)", async () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: `Intro\n\n${TABLE1}`,
      livePreview: true,
      plugins: [createGfmPreset()]
    });

    editor.setSelection(0);

    deleteColumn(container, 0, 0);
    await flush();

    expect(editor.getDocument()).toBe(`Intro\n\n${TABLE1_NO_COL0}`);

    editor.destroy();
  });
});
