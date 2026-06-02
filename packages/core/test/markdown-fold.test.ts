import { foldable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { markdownFoldService } from "../src/markdown-fold";

function createView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdownFoldService()],
    }),
  });
}

describe("markdown fold", () => {
  // ── Heading fold ──

  it("provides fold range for heading to next same-level heading", () => {
    const doc = "# First\nContent\n# Second";
    const view = createView(doc);
    const line = view.state.doc.line(1); // "# First"
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range?.from).toBe(line.to); // fold starts after heading
    expect(range?.to).toBe(view.state.doc.line(2).to); // fold ends before "# Second"
    view.destroy();
  });

  it("folds heading to end of document when no next heading", () => {
    const doc = "# Title\nLine 1\nLine 2";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range?.to).toBe(doc.length);
    view.destroy();
  });

  it("h2 does not fold past an h1", () => {
    const doc = "## Sub\nContent\n# Top";
    const view = createView(doc);
    const line = view.state.doc.line(1); // "## Sub"
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    // Should fold only "Content" line, stopping before "# Top"
    expect(range?.to).toBe(view.state.doc.line(2).to);
    view.destroy();
  });

  it("returns null for heading with no content below", () => {
    const doc = "# Title";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toBeNull();
    view.destroy();
  });

  // ── Code block fold ──

  it("provides fold range for fenced code block", () => {
    const doc = "```js\nconsole.log(1)\nconsole.log(2)\n```";
    const view = createView(doc);
    const line = view.state.doc.line(1); // "```js"
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range?.from).toBe(line.to);
    // Should fold to end of closing fence
    const lastLine = view.state.doc.line(4); // "```"
    expect(range?.to).toBe(lastLine.to);
    view.destroy();
  });

  it("returns null for non-foldable lines", () => {
    const doc = "Just a paragraph of text.";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toBeNull();
    view.destroy();
  });
});
