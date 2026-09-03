import { EditorState } from "@codemirror/state";
import { foldable } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { markdownFoldService } from "../src/markdown-fold";

function createView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdownFoldService()]
    })
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
    expect(range!.from).toBe(line.to); // fold starts after heading
    expect(range!.to).toBe(view.state.doc.line(2).to); // fold ends before "# Second"
    view.destroy();
  });

  it("folds heading to end of document when no next heading", () => {
    const doc = "# Title\nLine 1\nLine 2";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range!.to).toBe(doc.length);
    view.destroy();
  });

  it("h2 does not fold past an h1", () => {
    const doc = "## Sub\nContent\n# Top";
    const view = createView(doc);
    const line = view.state.doc.line(1); // "## Sub"
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    // Should fold only "Content" line, stopping before "# Top"
    expect(range!.to).toBe(view.state.doc.line(2).to);
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

  it.each([
    ["an equal-length backtick fence", "```js", "```"],
    ["a backtick fence longer by one character", "```js", "````"],
    ["a backtick fence longer by multiple characters", "```js", "``````"],
    ["an equal-length tilde fence", "~~~js", "~~~"],
    ["a longer tilde fence", "~~~js", "~~~~~"],
    ["a fence with trailing spaces", "```js", "```  "],
    ["a fence with a trailing tab", "```js", "```\t"]
  ])("folds a code block closed by %s", (_description, opener, closer) => {
    const doc = `${opener}\nconsole.log(1)\n${closer}\nAfter`;
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range!.from).toBe(line.to);
    expect(range!.to).toBe(view.state.doc.line(3).to);
    view.destroy();
  });

  it.each([
    ["a shorter fence", "````js", "```", "````"],
    ["a different fence character", "```js", "~~~", "```"],
    ["non-whitespace trailing content", "```js", "```x", "```"]
  ])("does not close a code block with %s", (_description, opener, candidate, closer) => {
    const doc = `${opener}\ncode\n${candidate}\nstill code\n${closer}`;
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range!.to).toBe(view.state.doc.line(5).to);
    view.destroy();
  });

  it("does not fold Markdown after a longer closing fence", () => {
    const doc = "```js\ncode\n`````\nAfter\n```";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range!.to).toBe(view.state.doc.line(3).to);
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
