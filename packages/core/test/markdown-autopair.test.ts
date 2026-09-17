import type { KeyBinding } from "@codemirror/view";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { createEditor, type EditorAPI } from "../src/index";

interface Harness {
  editor: EditorAPI;
  view: EditorView;
  container: HTMLDivElement;
}

function createTestEditor(
  initialValue: string,
  options: { multiCursor?: boolean; readOnly?: boolean } = {}
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let captured: EditorView | null = null;
  const editor = createEditor({
    container,
    initialValue,
    multiCursor: options.multiCursor ?? false,
    readOnly: options.readOnly ?? false,
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

/** Drive the real input-handler chain the way typed characters reach it. */
function typeText(view: EditorView, text: string): boolean {
  const main = view.state.selection.main;
  return view.state
    .facet(EditorView.inputHandler)
    .some((handler) =>
      handler(view, main.from, main.to, text, () => {
        throw new Error("these tests assert the handler's own transaction");
      })
    );
}

/** Drive the real keymap chain the way a key press reaches it. */
function pressKey(view: EditorView, key: string): boolean {
  const bindings: KeyBinding[] = view.state.facet(keymap).flat();
  return bindings
    .filter((binding) => binding.key === key)
    .some((binding) => binding.run?.(view) ?? false);
}

function destroy(harness: Harness): void {
  harness.editor.destroy();
  harness.container.remove();
}

describe("markdown auto-pair: stepping over the closing marker", () => {
  it("closes the backtick pair it inserted instead of doubling it", () => {
    const harness = createTestEditor("");
    const { editor, view } = harness;

    expect(typeText(view, "`")).toBe(true);
    expect(editor.getDocument()).toBe("``");
    expect(editor.getSelection().anchor).toBe(1);

    expect(typeText(view, "`")).toBe(true);
    expect(editor.getDocument()).toBe("``");
    expect(editor.getSelection().anchor).toBe(2);

    destroy(harness);
  });

  it("steps over a closing backtick that is already in the document", () => {
    const harness = createTestEditor("`code`");
    harness.editor.setSelection(5);

    expect(typeText(harness.view, "`")).toBe(true);

    expect(harness.editor.getDocument()).toBe("`code`");
    expect(harness.editor.getSelection().anchor).toBe(6);
    destroy(harness);
  });

  it("still inserts a pair when no closing marker follows", () => {
    const harness = createTestEditor("");
    harness.editor.setSelection(0);

    expect(typeText(harness.view, "`")).toBe(true);

    expect(harness.editor.getDocument()).toBe("``");
    expect(harness.editor.getSelection().anchor).toBe(1);
    destroy(harness);
  });

  it("closes a code span end to end", () => {
    const harness = createTestEditor("");
    const { editor, view } = harness;

    typeText(view, "`");
    editor.replaceRange(1, 1, "x");
    editor.setSelection(2);

    expect(typeText(view, "`")).toBe(true);
    expect(editor.getDocument()).toBe("`x`");
    expect(editor.getSelection().anchor).toBe(3);
    destroy(harness);
  });

  it("steps over the closing marker of a strong pair", () => {
    const harness = createTestEditor("**bold**");
    harness.editor.setSelection(6);

    expect(typeText(harness.view, "*")).toBe(true);

    expect(harness.editor.getDocument()).toBe("**bold**");
    expect(harness.editor.getSelection().anchor).toBe(8);
    destroy(harness);
  });

  it("steps over the closing marker of a strikethrough pair", () => {
    const harness = createTestEditor("~~gone~~");
    harness.editor.setSelection(6);

    expect(typeText(harness.view, "~")).toBe(true);

    expect(harness.editor.getDocument()).toBe("~~gone~~");
    expect(harness.editor.getSelection().anchor).toBe(8);
    destroy(harness);
  });

  it("steps over the closing marker from inside an empty strong pair", () => {
    const harness = createTestEditor("****");
    harness.editor.setSelection(2);

    expect(typeText(harness.view, "*")).toBe(true);

    expect(harness.editor.getDocument()).toBe("****");
    expect(harness.editor.getSelection().anchor).toBe(4);
    destroy(harness);
  });

  it("completes the second marker when only one asterisk precedes the cursor", () => {
    const harness = createTestEditor("*");
    harness.editor.setSelection(1);

    expect(typeText(harness.view, "*")).toBe(true);

    expect(harness.editor.getDocument()).toBe("****");
    expect(harness.editor.getSelection().anchor).toBe(2);
    destroy(harness);
  });

  it("does not step over a single asterisk that cannot close a strong pair", () => {
    const harness = createTestEditor("*italic*");
    harness.editor.setSelection(7);

    expect(typeText(harness.view, "*")).toBe(false);

    expect(harness.editor.getDocument()).toBe("*italic*");
    destroy(harness);
  });

  it("wraps the selection instead of stepping over a closing marker", () => {
    const harness = createTestEditor("`ab`");
    harness.editor.setSelection(1, 3);

    expect(typeText(harness.view, "`")).toBe(true);

    expect(harness.editor.getDocument()).toBe("``ab``");
    expect(harness.editor.getSelections().ranges).toEqual([{ anchor: 2, head: 4 }]);
    destroy(harness);
  });
});

describe("markdown auto-pair: wrapping a selection", () => {
  it("wraps the selection in backticks", () => {
    const harness = createTestEditor("hello");
    harness.editor.setSelection(0, 5);

    expect(typeText(harness.view, "`")).toBe(true);

    expect(harness.editor.getDocument()).toBe("`hello`");
    expect(harness.editor.getSelections().ranges).toEqual([{ anchor: 1, head: 6 }]);
    destroy(harness);
  });
});

describe("markdown auto-pair: Backspace inside an empty pair", () => {
  it("removes both backticks", () => {
    const harness = createTestEditor("``");
    harness.editor.setSelection(1);

    expect(pressKey(harness.view, "Backspace")).toBe(true);

    expect(harness.editor.getDocument()).toBe("");
    expect(harness.editor.getSelection().anchor).toBe(0);
    destroy(harness);
  });

  it("removes both markers of an empty strong pair", () => {
    const harness = createTestEditor("****");
    harness.editor.setSelection(2);

    expect(pressKey(harness.view, "Backspace")).toBe(true);

    expect(harness.editor.getDocument()).toBe("");
    destroy(harness);
  });

  it("removes both markers of an empty strikethrough pair", () => {
    const harness = createTestEditor("~~~~");
    harness.editor.setSelection(2);

    expect(pressKey(harness.view, "Backspace")).toBe(true);

    expect(harness.editor.getDocument()).toBe("");
    destroy(harness);
  });

  it("leaves a fenced code block marker alone", () => {
    const harness = createTestEditor("```");
    harness.editor.setSelection(1);

    expect(pressKey(harness.view, "Backspace")).toBe(false);

    expect(harness.editor.getDocument()).toBe("```");
    destroy(harness);
  });

  it("leaves a marker cluster alone", () => {
    const harness = createTestEditor("*****");
    harness.editor.setSelection(2);

    expect(pressKey(harness.view, "Backspace")).toBe(false);

    expect(harness.editor.getDocument()).toBe("*****");
    destroy(harness);
  });

  it("defers outside an empty pair", () => {
    const harness = createTestEditor("ab");
    harness.editor.setSelection(1);

    expect(pressKey(harness.view, "Backspace")).toBe(false);

    expect(harness.editor.getDocument()).toBe("ab");
    destroy(harness);
  });

  it("defers while a selection is active", () => {
    const harness = createTestEditor("``");
    harness.editor.setSelection(0, 2);

    expect(pressKey(harness.view, "Backspace")).toBe(false);

    expect(harness.editor.getDocument()).toBe("``");
    destroy(harness);
  });

  it("defers in a read-only editor", () => {
    const harness = createTestEditor("``x", { readOnly: true });
    harness.editor.setSelection(1);

    expect(pressKey(harness.view, "Backspace")).toBe(false);

    expect(harness.editor.getDocument()).toBe("``x");
    destroy(harness);
  });
});

describe("markdown auto-pair with multiple cursors", () => {
  it("steps over one closing marker while pairing at another cursor", () => {
    const harness = createTestEditor("**bold**\n*", { multiCursor: true });
    const { editor, view } = harness;
    editor.setSelections([{ anchor: 6 }, { anchor: 10 }]);

    expect(typeText(view, "*")).toBe(true);

    expect(editor.getDocument()).toBe("**bold**\n****");
    expect(editor.getSelections().ranges).toEqual([
      { anchor: 8, head: 8 },
      { anchor: 11, head: 11 },
    ]);
    destroy(harness);
  });

  it("deletes two empty pairs in one Backspace", () => {
    const harness = createTestEditor("``\n``", { multiCursor: true });
    const { editor, view } = harness;
    editor.setSelections([{ anchor: 1 }, { anchor: 4 }]);

    expect(pressKey(view, "Backspace")).toBe(true);

    expect(editor.getDocument()).toBe("\n");
    destroy(harness);
  });
});
