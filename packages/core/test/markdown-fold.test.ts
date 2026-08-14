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

  it("provides fold range for fenced code block", () => {
    const doc = "```js\nconsole.log(1)\nconsole.log(2)\n```";
    const view = createView(doc);
    const line = view.state.doc.line(1); // "```js"
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range!.from).toBe(line.to);
    // Should fold to end of closing fence
    const lastLine = view.state.doc.line(4); // "```"
    expect(range!.to).toBe(lastLine.to);
    view.destroy();
  });

  it("folds tilde fences and accepts a longer closing fence", () => {
    const doc = "  ~~~js\nconst answer = 42;\n  ~~~~~";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toEqual({
      from: line.to,
      to: view.state.doc.line(3).to,
    });
    view.destroy();
  });

  it("skips shorter and mismatched fences before a valid closing fence", () => {
    const doc = "````\ncode\n```\n~~~~\n`````";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toEqual({
      from: line.to,
      to: view.state.doc.line(5).to,
    });
    view.destroy();
  });

  it("accepts up to three spaces before opening and closing fences", () => {
    const doc = "   ```ts\nconst value = true;\n   ```";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toEqual({
      from: line.to,
      to: view.state.doc.line(3).to,
    });
    view.destroy();
  });

  it("does not treat a four-space-indented fence as an opening fence", () => {
    const doc = "    ```\n    code\n    ```";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toBeNull();
    view.destroy();
  });

  it("ignores an over-indented closing fence", () => {
    const doc = "```\ncode\n    ```\nmore code\n```";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toEqual({
      from: line.to,
      to: view.state.doc.line(5).to,
    });
    view.destroy();
  });

  it("allows trailing spaces and tabs after a closing fence", () => {
    const doc = "```\ncode\n``` \t";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toEqual({
      from: line.to,
      to: view.state.doc.line(3).to,
    });
    view.destroy();
  });

  it("ignores a closing fence with trailing text", () => {
    const doc = "```\ncode\n``` not closed\nmore code\n```";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toEqual({
      from: line.to,
      to: view.state.doc.line(5).to,
    });
    view.destroy();
  });

  it("rejects backtick fences whose info string contains a backtick", () => {
    const doc = "```js`invalid\ncode\n```";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toBeNull();
    view.destroy();
  });

  it("folds an unclosed fence to the end of the document", () => {
    const doc = "```\ncode\nmore code";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toEqual({
      from: line.to,
      to: doc.length,
    });
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
