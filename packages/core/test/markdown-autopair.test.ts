import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { handleAutopair } from "../src/markdown-autopair";

function createView(doc: string, cursor?: number): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: cursor != null ? { anchor: cursor } : undefined,
    }),
  });
  return view;
}

function createViewWithSelection(
  doc: string,
  anchor: number,
  head: number,
): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head },
    }),
  });
  return view;
}

describe("handleAutopair", () => {
  describe("backtick (`)", () => {
    it("inserts paired backticks and places cursor between them", () => {
      const view = createView("test", 4);
      const handled = handleAutopair(view, 4, 4, "`");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("test``");
      expect(view.state.selection.main.anchor).toBe(5); // test`|`
      view.destroy();
    });

    it("wraps selection with backticks", () => {
      const view = createViewWithSelection("test code here", 5, 9);
      const handled = handleAutopair(view, 5, 9, "`");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("test `code` here");
      view.destroy();
    });

    it("preserves selection content inside wrapped backticks", () => {
      const view = createViewWithSelection("test code here", 5, 9);
      handleAutopair(view, 5, 9, "`");

      const sel = view.state.selection.main;
      expect(view.state.sliceDoc(sel.from, sel.to)).toBe("code");
      view.destroy();
    });

    it("returns false for unrelated characters", () => {
      const view = createView("test", 4);
      const handled = handleAutopair(view, 4, 4, "x");

      expect(handled).toBe(false);
      expect(view.state.doc.toString()).toBe("test");
      view.destroy();
    });

    it("inserts paired backticks on empty document", () => {
      const view = createView("", 0);
      const handled = handleAutopair(view, 0, 0, "`");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("``");
      expect(view.state.selection.main.anchor).toBe(1);
      view.destroy();
    });

    it("wraps multi-line selection with backticks", () => {
      const view = createViewWithSelection("line one\nline two", 0, 17);
      const handled = handleAutopair(view, 0, 17, "`");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("`line one\nline two`");
      view.destroy();
    });
  });

  describe("bold (**)", () => {
    it("completes ** pair when second * is typed without selection", () => {
      // First * already typed at position 4. User types second *.
      const view = createView("test*", 5);
      const handled = handleAutopair(view, 5, 5, "*");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("test****");
      // Cursor placed between the `** | **` group
      expect(view.state.selection.main.anchor).toBe(6);
      view.destroy();
    });

    it("wraps selection with ** when second * is typed over selection", () => {
      // First * already typed. Selected text after it. User types second *.
      const view = createViewWithSelection("*bold text", 1, 10);
      const handled = handleAutopair(view, 1, 10, "*");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("**bold text**");
      view.destroy();
    });

    it("does not autopair on first * (no preceding *)", () => {
      const view = createView("test", 4);
      const handled = handleAutopair(view, 4, 4, "*");

      expect(handled).toBe(false);
      view.destroy();
    });

    it("does not autopair when cursor at position 0 (no preceding char)", () => {
      const view = createView("*start", 0);
      const handled = handleAutopair(view, 0, 0, "*");

      expect(handled).toBe(false);
      view.destroy();
    });

    it("completes ** pair at start of document when preceded by *", () => {
      const view = createView("*", 1);
      const handled = handleAutopair(view, 1, 1, "*");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("****");
      expect(view.state.selection.main.anchor).toBe(2);
      view.destroy();
    });
  });

  describe("strikethrough (~~)", () => {
    it("completes ~~ pair when second ~ is typed without selection", () => {
      const view = createView("test~", 5);
      const handled = handleAutopair(view, 5, 5, "~");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("test~~~~");
      expect(view.state.selection.main.anchor).toBe(6);
      view.destroy();
    });

    it("wraps selection with ~~ when second ~ is typed over selection", () => {
      const view = createViewWithSelection("~del text", 1, 9);
      const handled = handleAutopair(view, 1, 9, "~");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("~~del text~~");
      view.destroy();
    });

    it("does not autopair on first ~ (no preceding ~)", () => {
      const view = createView("test", 4);
      const handled = handleAutopair(view, 4, 4, "~");

      expect(handled).toBe(false);
      view.destroy();
    });

    it("does not autopair ~ when cursor at position 0", () => {
      const view = createView("~start", 0);
      const handled = handleAutopair(view, 0, 0, "~");

      expect(handled).toBe(false);
      view.destroy();
    });

    it("completes ~~ pair at start of document when preceded by ~", () => {
      const view = createView("~", 1);
      const handled = handleAutopair(view, 1, 1, "~");

      expect(handled).toBe(true);
      expect(view.state.doc.toString()).toBe("~~~~");
      expect(view.state.selection.main.anchor).toBe(2);
      view.destroy();
    });
  });
});
