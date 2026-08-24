import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import {
  handleMarkdownEnter,
  handleMarkdownListBackspace,
  handleMarkdownListIndent
} from "../src/markdown-keymap";

function createView(doc: string, cursor?: number): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor ?? doc.length }
    })
  });
  return view;
}

describe("markdown keymap", () => {
  // ── List continuation ──

  it("continues unordered list on Enter", () => {
    const view = createView("- item", 6);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- item\n- ");
    view.destroy();
  });

  it("continues ordered list with incremented number", () => {
    const view = createView("1. first", 8);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("1. first\n2. ");
    view.destroy();
  });

  it("preserves indentation in nested list continuation", () => {
    const view = createView("  - nested", 10);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - nested\n  - ");
    view.destroy();
  });

  it("exits list on Enter from empty list item", () => {
    const view = createView("- item\n- ", 9);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- item\n");
    view.destroy();
  });

  it("continues task list with unchecked checkbox", () => {
    const view = createView("- [x] done task", 15);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- [x] done task\n- [ ] ");
    view.destroy();
  });

  it("exits list on empty task list item", () => {
    const view = createView("- [ ] ", 6);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    view.destroy();
  });

  // ── Blockquote continuation ──

  it("continues blockquote on Enter", () => {
    const view = createView("> quote text", 12);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> quote text\n> ");
    view.destroy();
  });

  it("exits blockquote on Enter from empty quote line", () => {
    const view = createView("> text\n> ", 9);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> text\n");
    view.destroy();
  });

  it("continues nested blockquotes with spaced markers", () => {
    const view = createView("> > nested quote", 16);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> > nested quote\n> > ");
    view.destroy();
  });

  it("continues unordered lists inside blockquotes", () => {
    const view = createView("> - quoted item", 15);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> - quoted item\n> - ");
    view.destroy();
  });

  it("continues ordered lists inside blockquotes", () => {
    const view = createView("> 1. quoted item", 16);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> 1. quoted item\n> 2. ");
    view.destroy();
  });

  it("continues task lists inside blockquotes", () => {
    const view = createView("> - [x] quoted task", 19);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> - [x] quoted task\n> - [ ] ");
    view.destroy();
  });

  it("continues lists inside nested blockquotes with spaced markers", () => {
    const view = createView("> > - nested item", 17);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> > - nested item\n> > - ");
    view.destroy();
  });

  it("exits quoted lists while preserving the blockquote prefix", () => {
    const view = createView("> - item\n> - ", 12);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> - item\n> ");
    view.destroy();
  });

  // ── No-op cases ──

  it("does not trigger on plain text lines", () => {
    const view = createView("hello world", 11);
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe("hello world");
    view.destroy();
  });

  it("does not trigger when selection is non-empty", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "- item",
        selection: { anchor: 2, head: 6 }
      })
    });
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(false);
    view.destroy();
  });

  // ── List indentation ──

  it("indents the current list item", () => {
    const view = createView("- item", 2);
    const handled = handleMarkdownListIndent(view, "indent");

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - item");
    view.destroy();
  });

  it("outdents the current nested list item", () => {
    const view = createView("  - item", 4);
    const handled = handleMarkdownListIndent(view, "outdent");

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- item");
    view.destroy();
  });

  it("does not outdent top-level list items", () => {
    const view = createView("- item", 2);
    const handled = handleMarkdownListIndent(view, "outdent");

    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe("- item");
    view.destroy();
  });

  it("indents lists inside blockquotes after the quote marker", () => {
    const view = createView("> - item", 4);
    const handled = handleMarkdownListIndent(view, "indent");

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe(">   - item");
    view.destroy();
  });

  it("outdents nested lists inside blockquotes while preserving the quote marker", () => {
    const view = createView(">   - item", 6);
    const handled = handleMarkdownListIndent(view, "outdent");

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> - item");
    view.destroy();
  });

  it("indents selected list items across multiple lines", () => {
    const doc = "- one\n- two\nplain";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0, head: "- one\n- two".length }
      })
    });
    const handled = handleMarkdownListIndent(view, "indent");

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("  - one\n  - two\nplain");
    view.destroy();
  });

  it("outdents selected nested list items across multiple lines", () => {
    const doc = "  - one\n  - two\nplain";
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0, head: "  - one\n  - two".length }
      })
    });
    const handled = handleMarkdownListIndent(view, "outdent");

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- one\n- two\nplain");
    view.destroy();
  });

  it("does not indent plain text lines", () => {
    const view = createView("plain text", 5);
    const handled = handleMarkdownListIndent(view, "indent");

    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe("plain text");
    view.destroy();
  });

  // ── List backspace ──

  it("removes a top-level list marker at the content start", () => {
    const view = createView("- item", 2);
    const handled = handleMarkdownListBackspace(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("item");
    view.destroy();
  });

  it("outdents a nested list item at the content start", () => {
    const view = createView("  - item", 4);
    const handled = handleMarkdownListBackspace(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("- item");
    view.destroy();
  });

  it("removes a task-list marker at the task content start", () => {
    const view = createView("- [x] task", 6);
    const handled = handleMarkdownListBackspace(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("task");
    view.destroy();
  });

  it("removes a quoted top-level list marker while preserving the quote", () => {
    const view = createView("> - item", 4);
    const handled = handleMarkdownListBackspace(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> item");
    view.destroy();
  });

  it("outdents a quoted nested list item at the content start", () => {
    const view = createView(">   - item", 6);
    const handled = handleMarkdownListBackspace(view);

    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("> - item");
    view.destroy();
  });

  it("does not handle Backspace away from the list content start", () => {
    const view = createView("- item", 4);
    const handled = handleMarkdownListBackspace(view);

    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe("- item");
    view.destroy();
  });

  it("does not handle Backspace with a non-empty selection", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "- item",
        selection: { anchor: 2, head: 6 }
      })
    });
    const handled = handleMarkdownListBackspace(view);

    expect(handled).toBe(false);
    expect(view.state.doc.toString()).toBe("- item");
    view.destroy();
  });
});
