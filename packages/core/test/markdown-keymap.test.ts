import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { handleMarkdownEnter } from "../src/markdown-keymap";

function createView(doc: string, cursor?: number): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor ?? doc.length },
    }),
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
        selection: { anchor: 2, head: 6 },
      }),
    });
    const handled = handleMarkdownEnter(view);

    expect(handled).toBe(false);
    view.destroy();
  });
});
