// Default (jsdom) environment: compares the headless renderer with the
// browser-side `editor.exportHTML()` so server and client output never drift.

import { describe, expect, it } from "vitest";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createEditor, renderMarkdownToHtml } from "../src/index";

describe("renderMarkdownToHtml vs editor.exportHTML()", () => {
  it("produces identical HTML for the same document and plugins", () => {
    const markdown = [
      "# Title",
      "",
      "Some *emphasis*, `code` and a [link](https://example.com).",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "- [ ] todo",
      "- [x] done",
    ].join("\n");
    const plugins = [createGfmPreset()];
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: markdown, plugins });

    try {
      const fromEditor = editor.exportHTML();
      const headless = renderMarkdownToHtml(markdown, { plugins });

      expect(fromEditor).toContain("<table>");
      expect(headless).toBe(fromEditor);
    } finally {
      editor.destroy();
    }
  });
});
