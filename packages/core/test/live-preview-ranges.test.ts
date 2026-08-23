import { EditorSelection } from "@codemirror/state";
import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { lezerStringToMdast } from "../src/lezer-mdast-adapter";
import { collectLivePreviewRanges, selectionInsideSpan } from "../src/live-preview-ranges";

function parse(markdown: string): Root {
  return unified().use(remarkParse).parse(markdown) as Root;
}

describe("live preview ranges", () => {
  it("collects stable ranges for block and image previews", () => {
    const doc = "Intro\n\n# Heading\n\n> Quote\n\n![Alt](https://example.com/image.png)";
    const ranges = collectLivePreviewRanges(
      parse(doc),
      doc,
      [EditorSelection.cursor(0)]
    );

    expect(ranges.map((range) => range.node.type)).toEqual(["heading", "blockquote", "image"]);
    expect(ranges.at(-1)?.source).toBe("![Alt](https://example.com/image.png)");
  });

  it("always emits inline ranges regardless of cursor position", () => {
    const doc = "Text **bold** *italic*\n\nother line";
    // Inline ranges are always emitted; buildDecorations decides styling
    const rangesSameLine = collectLivePreviewRanges(
      parse(doc),
      doc,
      [EditorSelection.cursor(8)]
    );
    expect(rangesSameLine.map((r) => r.node.type)).toEqual(["strong", "emphasis"]);

    const rangesDiffLine = collectLivePreviewRanges(
      parse(doc),
      doc,
      [EditorSelection.cursor(doc.length)]
    );
    expect(rangesDiffLine.map((r) => r.node.type)).toEqual(["strong", "emphasis"]);
  });

  it("does not emit inline ranges inside table widgets", () => {
    const doc = [
      "| Source | Address |",
      "|---|---|",
      "| 百度热搜 | `https://top.baidu.com/board?tab=realtime` and [link](https://example.com) |",
      "",
      "## After",
    ].join("\n");

    const ranges = collectLivePreviewRanges(
      lezerStringToMdast(doc),
      doc,
      [EditorSelection.cursor(doc.length)]
    );

    expect(ranges.map((range) => range.node.type)).toEqual(["table", "heading"]);
  });
});

describe("selectionInsideSpan", () => {
  it("returns true when a head is strictly inside the span", () => {
    expect(selectionInsideSpan(10, 20, [15])).toBe(true);
  });

  it("returns false at span boundaries (strict containment)", () => {
    expect(selectionInsideSpan(10, 20, [10])).toBe(false);
    expect(selectionInsideSpan(10, 20, [20])).toBe(false);
  });

  it("returns false for a head on the same line but outside the span", () => {
    // one character before the span (e.g. a space adjacent to a word)
    expect(selectionInsideSpan(10, 20, [9])).toBe(false);
  });

  it("returns true when ANY of multiple heads is inside", () => {
    expect(selectionInsideSpan(10, 20, [0, 15, 99])).toBe(true);
  });

  it("returns false for an empty heads list", () => {
    expect(selectionInsideSpan(10, 20, [])).toBe(false);
  });
});
