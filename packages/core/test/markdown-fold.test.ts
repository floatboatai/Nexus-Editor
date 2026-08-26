import { EditorState } from "@codemirror/state";
import { foldable, foldedRanges } from "@codemirror/language";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { createEditor } from "../src/index";
import { markdownFoldService } from "../src/markdown-fold";
import { zhLocale } from "../src/locale";

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

  it("folds a setext heading from the underline through the section body", () => {
    const doc = "Title\n=====\nBody line\n# Next";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range!.from).toBe(view.state.doc.line(2).to);
    expect(range!.to).toBe(view.state.doc.line(3).to);
    expect(foldable(view.state, view.state.doc.line(2).from, view.state.doc.line(2).to)).toBeNull();
    view.destroy();
  });

  it("treats a setext h1 as a boundary for an earlier h2", () => {
    const doc = "## Nested\ninside\nTop\n=====\nafter";
    const view = createView(doc);
    const range = foldable(view.state, view.state.doc.line(1).from, view.state.doc.line(1).to);

    expect(range).not.toBeNull();
    expect(range!.to).toBe(view.state.doc.line(2).to);
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

  it("returns null for non-foldable lines", () => {
    const doc = "Just a paragraph of text.";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).toBeNull();
    view.destroy();
  });

  // ── GFM alert fold ──

  it("folds a GFM alert through consecutive blockquote lines", () => {
    const doc = "> [!NOTE]\n> body one\n> body two\n\nAfter";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    const range = foldable(view.state, line.from, line.to);

    expect(range).not.toBeNull();
    expect(range!.from).toBe(line.to);
    expect(range!.to).toBe(view.state.doc.line(3).to);
    view.destroy();
  });

  it("folds a GFM alert that has a custom title", () => {
    const doc = "> [!WARNING] Watch out\n> details\nplain";
    const view = createView(doc);
    const range = foldable(view.state, 0, view.state.doc.line(1).to);

    expect(range).not.toBeNull();
    expect(range!.to).toBe(view.state.doc.line(2).to);
    view.destroy();
  });

  it("returns null for a one-line alert with no body", () => {
    const doc = "> [!TIP]";
    const view = createView(doc);
    const line = view.state.doc.line(1);
    expect(foldable(view.state, line.from, line.to)).toBeNull();
    view.destroy();
  });
});

describe("createEditor folding", () => {
  it("mounts a fold gutter by default", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Title\nBody\n",
    });

    expect(container.querySelector(".cm-foldGutter")).not.toBeNull();
    editor.destroy();
  });

  it("hides the fold gutter when foldGutter is false", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Title\nBody\n",
      foldGutter: false,
    });

    expect(container.querySelector(".cm-foldGutter")).toBeNull();
    expect(editor.getCommands().map((command) => command.id)).toContain("editor:fold");
    editor.destroy();
  });

  it("folds the heading under the cursor via editor:fold", () => {
    const container = document.createElement("div");
    let view: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "# Title\nHidden body\n",
      plugins: [
        {
          name: "capture-view",
          cmExtensions: [
            ViewPlugin.define((current) => {
              view = current;
              return {};
            }),
          ],
        },
      ],
    });

    editor.setSelection(0);
    expect(editor.runCommand("editor:fold")).toBe(true);

    expect(view).not.toBeNull();
    let folded = false;
    foldedRanges(view!.state).between(0, view!.state.doc.length, () => {
      folded = true;
    });
    expect(folded).toBe(true);
    expect(editor.runCommand("editor:unfold")).toBe(true);
    editor.destroy();
  });

  it("localizes fold gutter marker labels", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Title\nBody\n",
      locale: zhLocale,
    });

    const labels = Array.from(
      container.querySelectorAll(".cm-foldGutter [aria-label]"),
      (el) => el.getAttribute("aria-label")
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(
      labels.every((label) => label === zhLocale.foldHeading || label === zhLocale.unfoldHeading)
    ).toBe(true);
    editor.destroy();
  });
});
