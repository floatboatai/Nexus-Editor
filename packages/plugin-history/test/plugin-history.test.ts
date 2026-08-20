import { EditorView } from "@codemirror/view";
import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin, groupUndo, undoDepth, redoDepth } from "../src/index";

function createDOM(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

function createEditorWithHistory(container: HTMLDivElement, initialValue = "alpha beta gamma") {
  return createEditor({
    container,
    initialValue,
    plugins: [createHistoryPlugin()]
  });
}

function getView(container: HTMLDivElement): EditorView {
  const content = container.querySelector("[contenteditable='true']") as HTMLElement;
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error("EditorView not found — was the editor mounted?");
  return view;
}

/**
 * Call groupUndo with replacements specified by text content rather than
 * absolute positions. Each oldText is found via indexOf at runtime, so
 * sequential replacements automatically account for position shifts.
 */
function groupedReplaceByText(
  container: HTMLDivElement,
  editor: ReturnType<typeof createEditor>,
  replacements: Array<{ oldText: string; insert: string }>
) {
  const view = getView(container);
  groupUndo(view, () => {
    for (const { oldText, insert } of replacements) {
      const doc = editor.getDocument();
      const from = doc.indexOf(oldText);
      if (from === -1) throw new Error(`Text "${oldText}" not found in "${doc}"`);
      editor.replaceRange(from, from + oldText.length, insert);
    }
  });
}

function pressUndo(container: HTMLDivElement) {
  container
    .querySelector("[contenteditable='true']")
    ?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );
}

function pressRedo(container: HTMLDivElement) {
  container
    .querySelector("[contenteditable='true']")
    ?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );
}

describe("@floatboat/nexus-plugin-history", () => {
  it("undoes the most recent document change through codemirror key handling", () => {
    const container = createDOM();
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
    container.remove();
  });

  it("redoes an undone change through codemirror key handling", () => {
    const container = createDOM();
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
    container.remove();
  });

  describe("groupUndo", () => {
    it("groups multiple replaceRange calls into a single undo step", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);

      groupedReplaceByText(container, editor, [
        { oldText: "alpha", insert: "first" },
        { oldText: "beta", insert: "second" }
      ]);

      expect(editor.getDocument()).toBe("first second gamma");

      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      editor.destroy();
      container.remove();
    });

    it("redoes a grouped undo as a single step", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);

      groupedReplaceByText(container, editor, [
        { oldText: "alpha", insert: "first" },
        { oldText: "beta", insert: "second" }
      ]);

      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      pressRedo(container);
      expect(editor.getDocument()).toBe("first second gamma");

      editor.destroy();
      container.remove();
    });

    it("isolates grouped changes from edits before the group", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);

      // Pre-group edit — undo step 1.
      editor.replaceRange(0, "alpha".length, "edit1");

      // Grouped edits — undo step 2.
      groupedReplaceByText(container, editor, [
        { oldText: "beta", insert: "edit2" },
        { oldText: "gamma", insert: "edit3" }
      ]);

      expect(editor.getDocument()).toBe("edit1 edit2 edit3");

      // First undo reverts the group.
      pressUndo(container);
      expect(editor.getDocument()).toBe("edit1 beta gamma");

      // Second undo reverts the pre-group edit.
      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      editor.destroy();
      container.remove();
    });

    it("isolates grouped changes from edits after the group", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);

      // Group first.
      groupedReplaceByText(container, editor, [
        { oldText: "alpha", insert: "first" },
        { oldText: "beta", insert: "second" }
      ]);

      // Post-group standalone edit.
      editor.replaceRange(
        editor.getDocument().indexOf("gamma"),
        editor.getDocument().indexOf("gamma") + "gamma".length,
        "delta"
      );

      expect(editor.getDocument()).toBe("first second delta");

      // First undo reverts the standalone edit.
      pressUndo(container);
      expect(editor.getDocument()).toBe("first second gamma");

      // Second undo reverts the group.
      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      editor.destroy();
      container.remove();
    });

    it("supports nested groupUndo calls — outermost boundary defines the step", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);
      const view = getView(container);

      groupUndo(view, () => {
        // Replace "alpha" → "outer-1"
        let doc = editor.getDocument();
        let from = doc.indexOf("alpha");
        editor.replaceRange(from, from + "alpha".length, "outer-1");

        groupUndo(view, () => {
          // Replace "beta" → "inner-1"
          doc = editor.getDocument();
          from = doc.indexOf("beta");
          editor.replaceRange(from, from + "beta".length, "inner-1");

          // Replace "gamma" → "inner-2"
          doc = editor.getDocument();
          from = doc.indexOf("gamma");
          editor.replaceRange(from, from + "gamma".length, "inner-2");
        });

        // Replace "inner-2" → "outer-2"
        doc = editor.getDocument();
        from = doc.indexOf("inner-2");
        editor.replaceRange(from, from + "inner-2".length, "outer-2");
      });

      expect(editor.getDocument()).toBe("outer-1 inner-1 outer-2");

      // One undo reverts everything.
      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      editor.destroy();
      container.remove();
    });

    it("does not create an undo entry for an empty group", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);

      // Make a standalone edit first.
      editor.replaceRange(0, "alpha".length, "edit1");
      expect(editor.getDocument()).toBe("edit1 beta gamma");

      // Empty group.
      const view = getView(container);
      groupUndo(view, () => {
        // intentionally empty
      });

      expect(editor.getDocument()).toBe("edit1 beta gamma");

      // One undo reverts the standalone edit.
      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      editor.destroy();
      container.remove();
    });

    it("closes the group properly when the callback throws", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);
      const view = getView(container);

      expect(() => {
        groupUndo(view, () => {
          editor.replaceRange(0, "alpha".length, "before-error");
          throw new Error("boom");
        });
      }).toThrow("boom");

      // The edit inside the group was applied.
      expect(editor.getDocument()).toBe("before-error beta gamma");

      // Subsequent edits must NOT be joined into the broken group.
      const doc = editor.getDocument();
      const from = doc.indexOf("beta");
      editor.replaceRange(from, from + "beta".length, "recovery");

      // First undo: reverts the recovery edit.
      pressUndo(container);
      expect(editor.getDocument()).toBe("before-error beta gamma");

      // Second undo: reverts the group edit.
      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      editor.destroy();
      container.remove();
    });

    it("supports multiple sequential groups", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);

      // Group 1.
      groupedReplaceByText(container, editor, [
        { oldText: "alpha", insert: "g1-1" },
        { oldText: "beta", insert: "g1-2" }
      ]);

      // Group 2.
      groupedReplaceByText(container, editor, [
        { oldText: "g1-1", insert: "g2-1" },
        { oldText: "g1-2", insert: "g2-2" }
      ]);

      expect(editor.getDocument()).toBe("g2-1 g2-2 gamma");

      // First undo reverts group 2.
      pressUndo(container);
      expect(editor.getDocument()).toBe("g1-1 g1-2 gamma");

      // Second undo reverts group 1.
      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      editor.destroy();
      container.remove();
    });

    it("reports correct undo depth after grouping", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);
      const view = getView(container);

      expect(undoDepth(view.state)).toBe(0);

      groupedReplaceByText(container, editor, [
        { oldText: "alpha", insert: "alpha2" },
        { oldText: "beta", insert: "beta2" }
      ]);

      expect(undoDepth(view.state)).toBeGreaterThanOrEqual(1);

      editor.destroy();
      container.remove();
    });

    it("uses groupUndo correctly with a single replaceRange call", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);
      const view = getView(container);

      groupUndo(view, () => {
        const doc = editor.getDocument();
        const from = doc.indexOf("alpha");
        editor.replaceRange(from, from + "alpha".length, "hello");
      });

      expect(editor.getDocument()).toBe("hello beta gamma");

      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      pressRedo(container);
      expect(editor.getDocument()).toBe("hello beta gamma");

      editor.destroy();
      container.remove();
    });

    it("handles groupUndo after setDocument", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);

      // setDocument is a standalone change.
      editor.setDocument("completely new content");

      // Group on the new content.
      groupedReplaceByText(container, editor, [
        { oldText: "completely", insert: "different" },
        { oldText: "content", insert: "text" }
      ]);

      expect(editor.getDocument()).toBe("different new text");

      // First undo: reverts the group.
      pressUndo(container);
      expect(editor.getDocument()).toBe("completely new content");

      // Second undo: reverts setDocument.
      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      editor.destroy();
      container.remove();
    });

    it("handles redo after multiple sequential undo steps including groups", () => {
      const container = createDOM();
      const editor = createEditorWithHistory(container);

      // Step 1: standalone edit.
      editor.replaceRange(0, "alpha".length, "edit1");

      // Step 2: group.
      groupedReplaceByText(container, editor, [
        { oldText: "beta", insert: "edit2a" },
        { oldText: "gamma", insert: "edit2b" }
      ]);

      expect(editor.getDocument()).toBe("edit1 edit2a edit2b");

      // Undo step 2 (the group).
      pressUndo(container);
      expect(editor.getDocument()).toBe("edit1 beta gamma");

      // Undo step 1.
      pressUndo(container);
      expect(editor.getDocument()).toBe("alpha beta gamma");

      // Redo step 1.
      pressRedo(container);
      expect(editor.getDocument()).toBe("edit1 beta gamma");

      // Redo step 2 (the group).
      pressRedo(container);
      expect(editor.getDocument()).toBe("edit1 edit2a edit2b");

      editor.destroy();
      container.remove();
    });
  });

  describe("createHistoryPlugin options", () => {
    it("accepts newGroupDelay and minDepth options", () => {
      const container = createDOM();
      const editor = createEditor({
        container,
        initialValue: "start",
        plugins: [createHistoryPlugin({ newGroupDelay: 300, minDepth: 50 })]
      });

      editor.setDocument("changed");
      expect(editor.getDocument()).toBe("changed");

      pressUndo(container);
      expect(editor.getDocument()).toBe("start");

      editor.destroy();
      container.remove();
    });
  });
});
