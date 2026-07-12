import { EditorSelection } from "@codemirror/state";
import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

import { lezerStringToMdast } from "../src/lezer-mdast-adapter";
import { collectLivePreviewRanges } from "../src/live-preview-ranges";

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

  it("does not emit image ranges for image syntax inside code contexts", () => {
    const doc = "```\n![alt](https://example.com/a.png)\n```\n\nUse `![x](https://example.com/b.png)` inline";
    const ranges = collectLivePreviewRanges(
      lezerStringToMdast(doc),
      doc,
      [EditorSelection.cursor(doc.length)]
    );

    expect(ranges.some((range) => range.node.type === "image")).toBe(false);
  });

  it("keeps balanced parentheses in image URLs and preserves the title", () => {
    const doc = '![Wiki](https://en.wikipedia.org/wiki/Foo_(bar) "Disambiguation")';
    const ranges = collectLivePreviewRanges(
      lezerStringToMdast(doc),
      doc,
      [EditorSelection.cursor(0)]
    );

    const image = ranges.find((range) => range.node.type === "image");
    expect(image).toBeDefined();
    expect(image?.node).toMatchObject({
      url: "https://en.wikipedia.org/wiki/Foo_(bar)",
      title: "Disambiguation"
    });
    expect(image?.to).toBe(doc.length);
  });

  it("strips every CommonMark title delimiter form", () => {
    const cases: Array<[string, string | null]> = [
      ['![a](https://example.com/i.png "double")', "double"],
      ["![a](https://example.com/i.png 'single')", "single"],
      ["![a](https://example.com/i.png (paren))", "paren"],
      ["![a](https://example.com/i.png)", null]
    ];
    for (const [doc, title] of cases) {
      const ranges = collectLivePreviewRanges(lezerStringToMdast(doc), doc, [EditorSelection.cursor(0)]);
      const image = ranges.find((range) => range.node.type === "image");
      expect(image?.node).toMatchObject({ title });
    }
  });

  it("does not emit image ranges for image syntax inside raw HTML blocks", () => {
    const doc = "<div>\n![alt](https://example.com/a.png)\n</div>";
    const ranges = collectLivePreviewRanges(
      lezerStringToMdast(doc),
      doc,
      [EditorSelection.cursor(doc.length)]
    );

    expect(ranges.some((range) => range.node.type === "image")).toBe(false);
  });

  it("emits the link and its nested image for a linked image", () => {
    const doc = "[![logo](https://example.com/l.png)](https://example.com)";
    const ranges = collectLivePreviewRanges(
      lezerStringToMdast(doc),
      doc,
      [EditorSelection.cursor(0)]
    );

    // The child image range is intentionally still emitted — buildDecorations
    // suppresses it via parentSpans when the link renders as one widget.
    expect(ranges.map((range) => range.node.type)).toEqual(["link", "image"]);
    const [link, image] = ranges;
    expect(link.from).toBe(0);
    expect(link.to).toBe(doc.length);
    expect(link.node).toMatchObject({ url: "https://example.com" });
    expect(image.node).toMatchObject({ url: "https://example.com/l.png" });
    expect(image.from).toBeGreaterThan(link.from);
    expect(image.to).toBeLessThan(link.to);
  });

  it("emits an empty url for reference-style links instead of raw source", () => {
    const doc = "[![logo](https://example.com/l.png)][badge]\n\n[badge]: https://example.com";
    const ranges = collectLivePreviewRanges(
      lezerStringToMdast(doc),
      doc,
      [EditorSelection.cursor(0)]
    );

    const link = ranges.find((range) => range.node.type === "link");
    expect(link?.node).toMatchObject({ url: "" });
  });

  it("leaves reference-style images without an inline URL as raw text", () => {
    const doc = "![alt][logo]\n\n[logo]: https://example.com/l.png";
    const ranges = collectLivePreviewRanges(
      lezerStringToMdast(doc),
      doc,
      [EditorSelection.cursor(0)]
    );

    expect(ranges.some((range) => range.node.type === "image")).toBe(false);
  });
});
