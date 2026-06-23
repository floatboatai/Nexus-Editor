import { EditorView, ViewPlugin } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import {
  addCursorAbove,
  addCursorBelow,
  collapseToMainSelection,
  createEditor,
  handleMarkdownEnter,
  selectNextOccurrence,
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
