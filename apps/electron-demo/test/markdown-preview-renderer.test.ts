import { describe, expect, it } from "vitest";
import type { Root } from "mdast";
import { renderMarkdownPreview } from "../src/renderer/markdown-preview-renderer";

describe("markdown preview renderer", () => {
  it("renders block elements with stable source line and offset metadata", () => {
    const root: Root = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 1,
          children: [{ type: "text", value: "Title" }],
          position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 8, offset: 7 } },
        },
        {
          type: "paragraph",
          children: [{ type: "text", value: "Repeated" }],
          position: { start: { line: 3, column: 1, offset: 9 }, end: { line: 3, column: 9, offset: 17 } },
        },
        {
          type: "paragraph",
          children: [{ type: "text", value: "Repeated" }],
          position: { start: { line: 5, column: 1, offset: 19 }, end: { line: 5, column: 9, offset: 27 } },
        },
      ],
    };

    const host = document.createElement("div");
    host.appendChild(renderMarkdownPreview(root));

    const blocks = Array.from(host.querySelectorAll<HTMLElement>("[data-source-line]"));
    expect(blocks.map((block) => block.dataset.sourceLine)).toEqual(["1", "3", "5"]);
    expect(blocks.map((block) => block.dataset.sourceOffset)).toEqual(["0", "9", "19"]);
    expect(blocks.map((block) => block.dataset.sourceType)).toEqual(["heading", "paragraph", "paragraph"]);
  });

  it("renders source end metadata for long block mapping", () => {
    const root: Root = {
      type: "root",
      children: [
        {
          type: "html",
          value: "<table><tr><td>large</td></tr></table>",
          position: {
            start: { line: 10, column: 1, offset: 100 },
            end: { line: 40, column: 9, offset: 900 },
          },
        },
      ],
    };

    const host = document.createElement("div");
    host.appendChild(renderMarkdownPreview(root));

    const block = host.querySelector<HTMLElement>("[data-source-type='html']");
    expect(block?.dataset.sourceLine).toBe("10");
    expect(block?.dataset.sourceOffset).toBe("100");
    expect(block?.dataset.sourceEndLine).toBe("40");
    expect(block?.dataset.sourceEndOffset).toBe("900");
  });
});
