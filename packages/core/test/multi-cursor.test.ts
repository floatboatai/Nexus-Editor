import { EditorView, ViewPlugin } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import {
  addCursorAbove,
  addCursorBelow,
  addCursorToLineEnds,
  collapseToMainSelection,
  createEditor,
  handleMarkdownEnter,
  selectAllOccurrences,
  selectAllWordOccurrences,
  selectNextOccurrence,
  skipNextOccurrence,
  undoSkipOccurrence,
} from "../src/index";

function createTestEditor(initialValue: string, multiCursor = true) {
  const container = document.createElement("div");
  let captured: EditorView | null = null;
  const editor = createEditor({
    container,
    initialValue,
    multiCursor,
    plugins: [
      {
        name: "capture-view",
        cmExtensions: [
          ViewPlugin.define((view) => {
            captured = view;
            return {};
          }),
        ],
      },
    ],
  });
  if (!captured) throw new Error("Expected CodeMirror view to be captured");
  return { editor, view: captured as EditorView, container };
}

describe("multiCursor config gating", () => {
  it("collapses multi-range selections when the flag is off (default)", () => {
    const { editor } = createTestEditor("hello world", false);

    editor.setSelections([{ anchor: 0, head: 5 }, { anchor: 6, head: 11 }]);

    const { ranges, mainIndex } = editor.getSelections();
    expect(ranges).toEqual([{ anchor: 6, head: 11 }]);
    expect(mainIndex).toBe(0);
    editor.destroy();
  });

  it("retains multiple ranges when the flag is on", () => {
    const { editor } = createTestEditor("hello world");

    editor.setSelections([{ anchor: 0, head: 5 }, { anchor: 6, head: 11 }]);

    const { ranges, mainIndex } = editor.getSelections();
    expect(ranges).toEqual([
      { anchor: 0, head: 5 },
      { anchor: 6, head: 11 },
    ]);
    expect(mainIndex).toBe(1);
    editor.destroy();
  });

  it("honours an explicit mainIndex and keeps getSelection() on the main range", () => {
    const { editor } = createTestEditor("hello world");

    editor.setSelections([{ anchor: 2 }, { anchor: 6, head: 11 }], 0);

    expect(editor.getSelections().mainIndex).toBe(0);
    expect(editor.getSelection()).toEqual({ anchor: 2, head: 2 });
    editor.destroy();
  });

  it("emits selectionChange with all ranges and the main index", () => {
    const { editor } = createTestEditor("hello world");
    const handler = vi.fn();
    editor.on("selectionChange", handler);

    editor.setSelections([{ anchor: 1 }, { anchor: 7 }]);

    expect(handler).toHaveBeenCalledWith({
      anchor: 7,
      head: 7,
      ranges: [
        { anchor: 1, head: 1 },
        { anchor: 7, head: 7 },
      ],
      mainIndex: 1,
    });
    editor.destroy();
  });
});

describe("selectNextOccurrence", () => {
  const DOC = "foo bar foo baz foo";

  it("expands an empty cursor to the word under it without adding a range", () => {
    const { editor, view } = createTestEditor(DOC);
    editor.setSelection(1);

    expect(selectNextOccurrence(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([{ anchor: 0, head: 3 }]);
    editor.destroy();
  });

  it("adds the next occurrence as the new main range", () => {
    const { editor, view } = createTestEditor(DOC);
    editor.setSelection(0, 3);

    expect(selectNextOccurrence(view)).toBe(true);

    const { ranges, mainIndex } = editor.getSelections();
    expect(ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
    ]);
    expect(mainIndex).toBe(1);
    editor.destroy();
  });

  it("skips occurrences already covered by a range", () => {
    const { editor, view } = createTestEditor(DOC);
    editor.setSelections([{ anchor: 0, head: 3 }, { anchor: 8, head: 11 }]);

    expect(selectNextOccurrence(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
      { anchor: 16, head: 19 },
    ]);
    editor.destroy();
  });

  it("wraps past the document end", () => {
    const { editor, view } = createTestEditor(DOC);
    editor.setSelection(16, 19);

    expect(selectNextOccurrence(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 16, head: 19 },
    ]);
    editor.destroy();
  });

  it("returns false when every occurrence is selected", () => {
    const { editor, view } = createTestEditor(DOC);
    editor.setSelections([
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
      { anchor: 16, head: 19 },
    ]);

    expect(selectNextOccurrence(view)).toBe(false);
    expect(editor.getSelections().ranges).toHaveLength(3);
    editor.destroy();
  });

  it("returns false when the empty cursor has no word under it", () => {
    const { editor, view } = createTestEditor("   ");
    editor.setSelection(1);

    expect(selectNextOccurrence(view)).toBe(false);
    editor.destroy();
  });
});

describe("addCursorAbove / addCursorBelow", () => {
  const DOC = "alpha\nbeta!\ngamma";

  it("adds a cursor below, preserving the column", () => {
    const { editor, view } = createTestEditor(DOC);
    editor.setSelection(4);

    expect(addCursorBelow(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 4, head: 4 },
      { anchor: 10, head: 10 },
    ]);
    editor.destroy();
  });

  it("stacks downward from the bottommost cursor on repeated calls", () => {
    const { editor, view } = createTestEditor(DOC);
    editor.setSelection(4);

    addCursorBelow(view);
    expect(addCursorBelow(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 4, head: 4 },
      { anchor: 10, head: 10 },
      { anchor: 16, head: 16 },
    ]);
    editor.destroy();
  });

  it("clamps the column to a shorter target line", () => {
    const { editor, view } = createTestEditor("abcdefghij\nabc");
    editor.setSelection(9);

    expect(addCursorBelow(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 9, head: 9 },
      { anchor: 14, head: 14 },
    ]);
    editor.destroy();
  });

  it("returns false at the document edges", () => {
    const { editor, view } = createTestEditor(DOC);

    editor.setSelection(2);
    expect(addCursorAbove(view)).toBe(false);

    editor.setSelection(DOC.length);
    expect(addCursorBelow(view)).toBe(false);
    editor.destroy();
  });

  it("adds a cursor above from the topmost range", () => {
    const { editor, view } = createTestEditor(DOC);
    editor.setSelection(8);

    expect(addCursorAbove(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 2, head: 2 },
      { anchor: 8, head: 8 },
    ]);
    editor.destroy();
  });
});

describe("collapseToMainSelection", () => {
  it("drops secondary ranges and keeps the main one", () => {
    const { editor, view } = createTestEditor("alpha\nbeta!\ngamma");
    editor.setSelections([{ anchor: 1 }, { anchor: 7 }, { anchor: 13 }], 1);

    expect(collapseToMainSelection(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([{ anchor: 7, head: 7 }]);
    editor.destroy();
  });

  it("returns false on a single-range selection so Escape falls through", () => {
    const { editor, view } = createTestEditor("alpha");
    editor.setSelection(2);

    expect(collapseToMainSelection(view)).toBe(false);
    editor.destroy();
  });
});

describe("selectAllOccurrences", () => {
  it("selects all occurrences of the selected text", () => {
    const { editor, view } = createTestEditor("foo bar foo baz foo");
    editor.setSelection(0, 3);

    expect(selectAllOccurrences(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
      { anchor: 16, head: 19 },
    ]);
    editor.destroy();
  });

  it("expands empty cursor to word and selects all occurrences", () => {
    const { editor, view } = createTestEditor("foo bar foo");
    editor.setSelection(1);

    expect(selectAllOccurrences(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
    ]);
    editor.destroy();
  });

  it("returns false when there are no occurrences", () => {
    const { editor, view } = createTestEditor("foo");
    editor.setSelection(0, 3);

    expect(selectAllOccurrences(view)).toBe(false);
    editor.destroy();
  });

  it("returns false when there is only one occurrence", () => {
    const { editor, view } = createTestEditor("foo bar baz");
    editor.setSelection(0, 3);

    expect(selectAllOccurrences(view)).toBe(false);
    editor.destroy();
  });

  it("returns false when selection is empty and no word is under cursor", () => {
    const { editor, view } = createTestEditor("");
    editor.setSelection(0);

    expect(selectAllOccurrences(view)).toBe(false);
    editor.destroy();
  });
});

describe("selectAllWordOccurrences", () => {
  it("selects all word-boundary occurrences (does not match substring)", () => {
    const { editor, view } = createTestEditor("foo bar foobar foo");
    editor.setSelection(0, 3);

    expect(selectAllWordOccurrences(view)).toBe(true);

    // Only matches complete words "foo", not "foo" inside "foobar"
    // "foo bar foobar foo": positions are 0-3, 15-18
    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 15, head: 18 },
    ]);
    editor.destroy();
  });

  it("expands empty cursor to word and selects all word occurrences", () => {
    const { editor, view } = createTestEditor("foo bar foo");
    editor.setSelection(1);

    expect(selectAllWordOccurrences(view)).toBe(true);

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
    ]);
    editor.destroy();
  });

  it("returns false when there are no word occurrences", () => {
    const { editor, view } = createTestEditor("foo");
    editor.setSelection(0, 3);

    expect(selectAllWordOccurrences(view)).toBe(false);
    editor.destroy();
  });

  it("returns false when there is only one word occurrence", () => {
    const { editor, view } = createTestEditor("foo bar baz");
    editor.setSelection(0, 3);

    expect(selectAllWordOccurrences(view)).toBe(false);
    editor.destroy();
  });
});

describe("addCursorToLineEnds", () => {
  it("adds cursor at end of each line in selection", () => {
    const { editor, view } = createTestEditor("line1\nline2\nline3");
    editor.setSelection(0, 16); // Select all three lines

    expect(addCursorToLineEnds(view)).toBe(true);

    // Cursors at end of each line: line1 ends at 5, line2 ends at 11, line3 ends at 17
    expect(editor.getSelections().ranges).toEqual([
      { anchor: 5, head: 5 },
      { anchor: 11, head: 11 },
      { anchor: 17, head: 17 },
    ]);
    editor.destroy();
  });

  it("returns false when only one line is selected", () => {
    const { editor, view } = createTestEditor("single line");
    editor.setSelection(0, 11);

    expect(addCursorToLineEnds(view)).toBe(false);
    editor.destroy();
  });
});

describe("skipNextOccurrence", () => {
  it("skips current selection and selects next occurrence", () => {
    const { editor, view } = createTestEditor("foo bar foo baz foo");
    // Select first two "foo" via selectNextOccurrence
    editor.setSelection(0, 3);
    selectNextOccurrence(view); // adds second foo (8-11)

    // Now skip the second foo, should select third foo (16-19)
    expect(skipNextOccurrence(view)).toBe(true);

    // Should have first foo and third foo (second was skipped)
    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 16, head: 19 },
    ]);
    editor.destroy();
  });

  it("skipped occurrence is not re-selected by subsequent Ctrl+D", () => {
    const { editor, view } = createTestEditor("foo bar foo baz foo");
    editor.setSelection(0, 3);
    selectNextOccurrence(view); // adds second foo (8-11)

    // Skip second foo
    skipNextOccurrence(view); // selects third foo (16-19)

    // Press Ctrl+D again — should not re-select skipped second foo
    expect(selectNextOccurrence(view)).toBe(false); // no more unselected, unskipped occurrences

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 16, head: 19 },
    ]);
    editor.destroy();
  });

  it("selectAllOccurrences respects skip list", () => {
    const { editor, view } = createTestEditor("foo bar foo baz foo");
    editor.setSelection(0, 3);
    selectNextOccurrence(view); // adds second foo (8-11)
    skipNextOccurrence(view); // skip second, select third (16-19)

    // Ctrl+Shift+L should select all except skipped
    expect(selectAllOccurrences(view)).toBe(false); // only 2 unskipped occurrences, already selected

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 16, head: 19 },
    ]);
    editor.destroy();
  });

  it("returns false when there is no next occurrence to skip to", () => {
    const { editor, view } = createTestEditor("foo bar baz");
    editor.setSelection(0, 3);

    expect(skipNextOccurrence(view)).toBe(false);
    editor.destroy();
  });

  it("returns false when main selection is empty", () => {
    const { editor, view } = createTestEditor("foo bar foo");
    editor.setSelection(1);

    expect(skipNextOccurrence(view)).toBe(false);
    editor.destroy();
  });
});

describe("undoSkipOccurrence", () => {
  it("restores the last skipped position", () => {
    const { editor, view } = createTestEditor("foo bar foo baz foo");
    editor.setSelection(0, 3);
    selectNextOccurrence(view); // adds second foo (8-11)
    skipNextOccurrence(view); // skip second, select third (16-19)

    // Undo the skip — should re-select second foo (8-11)
    expect(undoSkipOccurrence(view)).toBe(true);

    // EditorSelection.create sorts ranges by position
    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
      { anchor: 16, head: 19 },
    ]);
    editor.destroy();
  });

  it("returns false when skip list is empty", () => {
    const { editor, view } = createTestEditor("foo bar foo");
    editor.setSelection(0, 3);

    expect(undoSkipOccurrence(view)).toBe(false);
    editor.destroy();
  });
});

describe("multi-cursor keymap", () => {
  function keydown(container: HTMLElement, init: KeyboardEventInit): void {
    const content = container.querySelector("[contenteditable='true']");
    content?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
    );
  }

  it("binds Mod-d to selectNextOccurrence", () => {
    const { editor, container } = createTestEditor("foo bar foo");
    editor.setSelection(1);

    keydown(container, { key: "d", ctrlKey: true });

    expect(editor.getSelections().ranges).toEqual([{ anchor: 0, head: 3 }]);
    editor.destroy();
  });

  it("binds Mod-Shift-l to selectAllOccurrences", () => {
    const { editor, container } = createTestEditor("foo bar foo");
    editor.setSelection(0, 3);

    keydown(container, { key: "l", ctrlKey: true, shiftKey: true });

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
    ]);
    editor.destroy();
  });

  it("binds Mod-F2 to selectAllWordOccurrences", () => {
    const { editor, container } = createTestEditor("foo bar foobar foo");
    editor.setSelection(0, 3);

    keydown(container, { key: "F2", ctrlKey: true });

    // Only matches complete words, not "foo" inside "foobar"
    expect(editor.getSelections().ranges).toEqual([
      { anchor: 0, head: 3 },
      { anchor: 15, head: 18 },
    ]);
    editor.destroy();
  });

  it("binds Mod-Shift-; to addCursorToLineEnds", () => {
    const { editor, container } = createTestEditor("line1\nline2\nline3");
    editor.setSelection(0, 16);

    keydown(container, { key: ";", ctrlKey: true, shiftKey: true });

    expect(editor.getSelections().ranges).toEqual([
      { anchor: 5, head: 5 },
      { anchor: 11, head: 11 },
      { anchor: 17, head: 17 },
    ]);
    editor.destroy();
  });

  it("binds Escape to collapseToMainSelection", () => {
    const { editor, container } = createTestEditor("foo bar foo");
    editor.setSelections([{ anchor: 0, head: 3 }, { anchor: 8, head: 11 }]);

    keydown(container, { key: "Escape" });

    expect(editor.getSelections().ranges).toEqual([{ anchor: 8, head: 11 }]);
    editor.destroy();
  });

  it("does not install the keymap when the flag is off", () => {
    const { editor, container } = createTestEditor("foo bar foo", false);
    editor.setSelection(1);

    keydown(container, { key: "d", ctrlKey: true });

    expect(editor.getSelections().ranges).toEqual([{ anchor: 1, head: 1 }]);
    editor.destroy();
  });
});

describe("markdown Enter with multiple cursors", () => {
  it("continues two list items in one undo step", () => {
    const { editor, view } = createTestEditor("- a\n- b");
    editor.setSelections([{ anchor: 3 }, { anchor: 7 }]);

    expect(handleMarkdownEnter(view)).toBe(true);

    expect(editor.getDocument()).toBe("- a\n- \n- b\n- ");
    expect(editor.getSelections().ranges).toEqual([
      { anchor: 6, head: 6 },
      { anchor: 13, head: 13 },
    ]);
    editor.destroy();
  });

  it("mixes list continuation and plain newline across cursors", () => {
    const { editor, view } = createTestEditor("- a\nplain");
    editor.setSelections([{ anchor: 3 }, { anchor: 9 }]);

    expect(handleMarkdownEnter(view)).toBe(true);

    expect(editor.getDocument()).toBe("- a\n- \nplain\n");
    editor.destroy();
  });

  it("exits an empty item once when two cursors share the line", () => {
    const { editor, view } = createTestEditor("- a\n- ");
    editor.setSelections([{ anchor: 5 }, { anchor: 6 }]);

    expect(handleMarkdownEnter(view)).toBe(true);

    expect(editor.getDocument()).toBe("- a\n");
    editor.destroy();
  });

  it("defers to the default Enter when no cursor is on a continuable line", () => {
    const { editor, view } = createTestEditor("plain\ntext");
    editor.setSelections([{ anchor: 2 }, { anchor: 8 }]);

    expect(handleMarkdownEnter(view)).toBe(false);
    expect(editor.getDocument()).toBe("plain\ntext");
    editor.destroy();
  });
});

describe("markdown auto-pair with multiple cursors", () => {
  function runInputHandlers(view: EditorView, text: string): boolean {
    const main = view.state.selection.main;
    return view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, main.from, main.to, text, () => {
        throw new Error("default insert not expected in these tests");
      }));
  }

  it("wraps two selections in backticks", () => {
    const { editor, view } = createTestEditor("one two");
    editor.setSelections([{ anchor: 0, head: 3 }, { anchor: 4, head: 7 }]);

    expect(runInputHandlers(view, "`")).toBe(true);

    expect(editor.getDocument()).toBe("`one` `two`");
    expect(editor.getSelections().ranges).toEqual([
      { anchor: 1, head: 4 },
      { anchor: 7, head: 10 },
    ]);
    editor.destroy();
  });

  it("completes double markers at every cursor", () => {
    const { editor, view } = createTestEditor("*\n*");
    editor.setSelections([{ anchor: 1 }, { anchor: 3 }]);

    expect(runInputHandlers(view, "*")).toBe(true);

    expect(editor.getDocument()).toBe("****\n****");
    expect(editor.getSelections().ranges).toEqual([
      { anchor: 2, head: 2 },
      { anchor: 7, head: 7 },
    ]);
    editor.destroy();
  });

  it("plain-inserts at cursors that are not completing a double marker", () => {
    const { editor, view } = createTestEditor("*\nx");
    editor.setSelections([{ anchor: 1 }, { anchor: 3 }]);

    expect(runInputHandlers(view, "*")).toBe(true);

    expect(editor.getDocument()).toBe("****\nx*");
    editor.destroy();
  });
});
