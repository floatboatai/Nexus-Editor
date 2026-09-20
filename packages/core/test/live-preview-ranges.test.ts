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

  it("collects Obsidian image embeds without rewriting their source", () => {
    const doc = "Before\n\n![[assets/Pasted image.png|320x180]]\n\nAfter";
    const ranges = collectLivePreviewRanges(
      parse(doc),
      doc,
      [EditorSelection.cursor(0)],
    );

    const image = ranges.find((range) => range.node.type === "image");
    expect(image).toMatchObject({
      source: "![[assets/Pasted image.png|320x180]]",
      node: {
        type: "image",
        url: "assets/Pasted image.png",
        alt: "|320x180",
      },
    });
  });

  it("keeps spaces in standard Markdown image destinations", () => {
    const doc = "![Screenshot](assets/Pasted image.png)";
    const ranges = collectLivePreviewRanges(
      parse(doc),
      doc,
      [EditorSelection.cursor(0)],
    );

    expect(ranges.at(-1)?.node).toMatchObject({
      type: "image",
      url: "assets/Pasted image.png",
    });
  });

  it("ignores escaped, malformed, and nested image embeds", () => {
    const doc = "\\![[escaped.png]]\n![[broken\n![[nested/[[image.png]]]]";
    const ranges = collectLivePreviewRanges(
      parse(doc),
      doc,
      [EditorSelection.cursor(0)],
    );

    expect(ranges.filter((range) => range.node.type === "image")).toHaveLength(0);
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
