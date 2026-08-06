import { EditorSelection, EditorState, type EditorStateConfig } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { markdownAutoPair } from "../src/markdown-autopair";

function createView(doc = "", selection?: EditorStateConfig["selection"]): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true), markdownAutoPair()]
    })
  });
}

function type(view: EditorView, text: string): void {
  const selection = view.state.selection.main;
  const handler = view.state.facet(EditorView.inputHandler)[0];
  const handled = handler?.(view, selection.from, selection.to, text, () => {}) ?? false;

  if (!handled) {
    view.dispatch(view.state.replaceSelection(text));
  }
}

function expectCursor(view: EditorView, position: number): void {
  const selection = view.state.selection.main;
  expect(selection.anchor).toBe(position);
  expect(selection.head).toBe(position);
}

describe("markdownAutoPair", () => {
  it("skips an existing inline-code closing marker", () => {
    const view = createView();

    try {
      type(view, "`");
      type(view, "code");
      type(view, "`");

      expect(view.state.doc.toString()).toBe("`code`");
      expectCursor(view, 6);
    } finally {
      view.destroy();
    }
  });

  it.each([
    ["*", "**", "bold"],
    ["~", "~~", "deleted"]
  ] as const)("skips an existing %s closing marker", (character, marker, content) => {
    const view = createView();

    try {
      type(view, character);
      type(view, character);
      type(view, content);
      type(view, character);
      type(view, character);

      expect(view.state.doc.toString()).toBe(`${marker}${content}${marker}`);
      expectCursor(view, marker.length * 2 + content.length);
    } finally {
      view.destroy();
    }
  });

  it("skips and inserts independently across multiple cursors", () => {
    const view = createView(
      "`x`a",
      EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(4)], 1)
    );

    try {
      type(view, "`");

      expect(view.state.doc.toString()).toBe("`x`a``");
      expect(view.state.selection.ranges.map((range) => range.head)).toEqual([3, 5]);
    } finally {
      view.destroy();
    }
  });
});
