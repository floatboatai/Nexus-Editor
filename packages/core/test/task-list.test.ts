import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { handleToggleTaskItem } from "../src/markdown-keymap";

function createView(
  doc: string,
  cursor?: number,
  readOnly = false,
): EditorView {
  const extensions = [history()];
  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor ?? doc.length },
      extensions,
    }),
  });
}

describe("Task List Pipeline & Keymap", () => {
  it("toggles unchecked task item to checked with handleToggleTaskItem", () => {
    const view = createView("- [ ] Buy milk", 5);
    const handled = handleToggleTaskItem(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] Buy milk");
    view.destroy();
  });

  it("toggles checked task item back to unchecked", () => {
    const view = createView("- [x] Done task", 6);
    const handled = handleToggleTaskItem(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] Done task");
    view.destroy();
  });

  it("promotes standard bullet list item to task item", () => {
    const view = createView("- Regular item", 4);
    const handled = handleToggleTaskItem(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] Regular item");
    view.destroy();
  });

  it("promotes plain text line to task item", () => {
    const view = createView("Plain text line", 3);
    const handled = handleToggleTaskItem(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] Plain text line");
    view.destroy();
  });

  it("supports atomic single-step undo after task toggle", () => {
    const view = createView("- [ ] Step 1", 5);
    handleToggleTaskItem(view);
    expect(view.state.doc.toString()).toBe("- [x] Step 1");

    undo(view);
    expect(view.state.doc.toString()).toBe("- [ ] Step 1");
    view.destroy();
  });

  it("blocks task toggle when editor is readOnly", () => {
    const view = createView("- [ ] Readonly task", 5, true);
    const handled = handleToggleTaskItem(view);
    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe("- [ ] Readonly task");
    view.destroy();
  });

  it("handles multi-line selection task toggling atomically", () => {
    const doc = "- [ ] Task 1\n- [ ] Task 2\n- [x] Task 3";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.single(0, doc.length),
        extensions: [history()],
      }),
    });

    const handled = handleToggleTaskItem(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "- [x] Task 1\n- [x] Task 2\n- [ ] Task 3",
    );
    view.destroy();
  });

  it("preserves indentation when promoting nested list items or plain text", () => {
    const view = createView("    - Nested bullet", 10);
    expect(handleToggleTaskItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("    - [ ] Nested bullet");
    view.destroy();

    const viewIndent = createView("  indented text", 5);
    expect(handleToggleTaskItem(viewIndent)).toBe(true);
    expect(viewIndent.state.doc.toString()).toBe("  - [ ] indented text");
    viewIndent.destroy();
  });

  it("handles ordered list item promotion to task item", () => {
    const view = createView("1. First numbered item", 5);
    expect(handleToggleTaskItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. [ ] First numbered item");
    view.destroy();
  });

  it("toggles tasks across multiple disjoint cursors in a single atomic undo transaction", () => {
    const doc = "- [ ] Line 1\n- [x] Line 2\n- Line 3";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.create([
          EditorSelection.cursor(3),
          EditorSelection.cursor(17),
          EditorSelection.cursor(30),
        ]),
        extensions: [history(), EditorState.allowMultipleSelections.of(true)],
      }),
    });

    const handled = handleToggleTaskItem(view);
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "- [x] Line 1\n- [ ] Line 2\n- [ ] Line 3",
    );

    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });
});
